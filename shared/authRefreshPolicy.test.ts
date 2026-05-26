import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTH_REFRESH_RETRY_MAX_MS,
  applyManagedAuthRefreshSession,
  authRefreshDebugInfo,
  buildManagedAuthRefreshSession,
  classifyAuthRefreshError,
  isNewerAuthRefreshSession,
  nextAuthRefreshDelayMs,
  requestManagedAuthRefresh,
  shouldRefreshSessionSoon,
} from './authRefreshPolicy';

function retryableAuthError(message: string, status?: number) {
  const error = new Error(message) as Error & { name: string; status?: number };
  error.name = 'AuthRetryableFetchError';
  if (status !== undefined) error.status = status;
  return error;
}

test('504 AuthRetryableFetchError payload is retryable and sanitized', () => {
  const rawResponse = JSON.stringify({
    type: 'default',
    status: 504,
    ok: false,
    headers: { map: { 'set-cookie': 'secret-cookie', 'cf-cache-status': 'DYNAMIC' } },
    url: 'https://example.supabase.co/auth/v1/token?grant_type=refresh_token',
  });
  const error = retryableAuthError(rawResponse, 504);

  assert.equal(classifyAuthRefreshError(error), 'retryable');
  assert.deepEqual(authRefreshDebugInfo(error), {
    name: 'AuthRetryableFetchError',
    code: null,
    status: 504,
    messagePreview: '<raw auth response 504>',
    kind: 'retryable',
  });
});

test('empty provider payload with retryable status is retryable', () => {
  assert.equal(classifyAuthRefreshError(retryableAuthError('{}', 503)), 'retryable');
});

test('network and timeout refresh failures are retryable', () => {
  assert.equal(classifyAuthRefreshError(new Error('Network request failed')), 'retryable');
  assert.equal(classifyAuthRefreshError(new Error('fetch failed')), 'retryable');
  assert.equal(classifyAuthRefreshError(new Error('Request timed out')), 'retryable');
  assert.equal(classifyAuthRefreshError({ message: 'Load failed' }), 'retryable');
});

test('invalid refresh token and no-session errors clear only local auth', () => {
  assert.equal(classifyAuthRefreshError(new Error('Invalid Refresh Token: Already Used')), 'invalid_session');
  assert.equal(classifyAuthRefreshError({ code: 'refresh_token_not_found' }), 'invalid_session');
  assert.equal(classifyAuthRefreshError(new Error('Auth session missing!')), 'invalid_session');
  assert.equal(classifyAuthRefreshError(new Error('no session')), 'invalid_session');
});

test('retry delay grows with deterministic jitter and caps at 300 seconds', () => {
  assert.equal(nextAuthRefreshDelayMs(1), 35_100);
  assert.equal(nextAuthRefreshDelayMs(2), 67_800);
  assert.equal(nextAuthRefreshDelayMs(3), 130_800);
  assert.equal(nextAuthRefreshDelayMs(4), AUTH_REFRESH_RETRY_MAX_MS);
  assert.equal(nextAuthRefreshDelayMs(10), AUTH_REFRESH_RETRY_MAX_MS);
});

test('session refresh policy only triggers for refreshable sessions near expiry', () => {
  const nowMs = 1_000_000;
  assert.equal(shouldRefreshSessionSoon(null, nowMs), false);
  assert.equal(shouldRefreshSessionSoon({ expires_at: (nowMs + 30_000) / 1000 }, nowMs), false);
  assert.equal(shouldRefreshSessionSoon({ refresh_token: 'r', expires_at: (nowMs + 120_000) / 1000 }, nowMs), false);
  assert.equal(shouldRefreshSessionSoon({ refresh_token: 'r', expires_at: (nowMs + 60_000) / 1000 }, nowMs), true);
  assert.equal(shouldRefreshSessionSoon({ refresh_token: 'r', expires_at: (nowMs + 1_000) / 1000 }, nowMs), true);
});

test('managed refresh request posts directly to Supabase token endpoint', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: 'u1' },
    }), { status: 200 });
  }) as typeof fetch;

  const response = await requestManagedAuthRefresh({
    supabaseUrl: 'https://example.supabase.co/',
    publishableKey: 'anon-key',
    refreshToken: 'old-refresh',
    fetchImpl,
  });

  assert.equal(calls[0]?.url, 'https://example.supabase.co/auth/v1/token?grant_type=refresh_token');
  assert.equal(calls[0]?.init.method, 'POST');
  assert.equal((calls[0]?.init.headers as Record<string, string>).apikey, 'anon-key');
  assert.equal(JSON.parse(String(calls[0]?.init.body)).refresh_token, 'old-refresh');
  assert.equal(response.access_token, 'new-access');
  assert.equal(response.refresh_token, 'new-refresh');
});

test('managed refresh request classifies invalid sessions without exposing raw payloads', async () => {
  const fetchImpl = (async () => new Response(JSON.stringify({
    error: 'refresh_token_not_found',
    message: 'Invalid Refresh Token: Already Used',
    headers: { 'set-cookie': 'secret' },
  }), { status: 400 })) as typeof fetch;

  await assert.rejects(
    requestManagedAuthRefresh({
      supabaseUrl: 'https://example.supabase.co',
      publishableKey: 'anon-key',
      refreshToken: 'old-refresh',
      fetchImpl,
    }),
    (error) => {
      assert.equal(classifyAuthRefreshError(error), 'invalid_session');
      assert.equal(authRefreshDebugInfo(error).messagePreview, 'Invalid Refresh Token: Already Used');
      assert.doesNotMatch(JSON.stringify(authRefreshDebugInfo(error)), /set-cookie|secret/i);
      return true;
    },
  );
});

test('managed refresh response builds and stores session without SDK refreshSession', async () => {
  const currentSession = {
    access_token: 'old-access',
    refresh_token: 'old-refresh',
    expires_in: 100,
    expires_at: 123,
    token_type: 'bearer' as const,
    user: { id: 'u1', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01T00:00:00Z' },
  };
  const nextSession = buildManagedAuthRefreshSession(currentSession, {
    access_token: 'new-access',
    refresh_token: 'new-refresh',
    expires_in: 3600,
    token_type: 'bearer',
  }, 1_000_000);

  assert.equal(nextSession.access_token, 'new-access');
  assert.equal(nextSession.refresh_token, 'new-refresh');
  assert.equal(nextSession.expires_at, 4_600);
  assert.equal(nextSession.user.id, 'u1');

  const events: string[] = [];
  const fakeAuth = {
    async setSession() {
      throw new Error('setSession should not be needed when auth internals exist');
    },
    async _saveSession(session) {
      events.push(`save:${session.refresh_token}`);
    },
    async _notifyAllSubscribers(event, session) {
      events.push(`${event}:${session?.refresh_token ?? 'null'}`);
    },
  };
  const stored = await applyManagedAuthRefreshSession(fakeAuth, currentSession, {
    access_token: 'new-access',
    refresh_token: 'new-refresh',
    expires_in: 3600,
    token_type: 'bearer',
  });

  assert.equal(stored.refresh_token, 'new-refresh');
  assert.deepEqual(events, ['save:new-refresh', 'TOKEN_REFRESHED:new-refresh']);
});

test('managed refresh apply respects the apply guard inside the auth lock', async () => {
  const currentSession = {
    access_token: 'old-access',
    refresh_token: 'old-refresh',
    expires_in: 100,
    expires_at: 123,
    token_type: 'bearer' as const,
    user: { id: 'u1', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01T00:00:00Z' },
  };
  const events: string[] = [];
  const fakeAuth = {
    async _acquireLock<T>(_timeout: number, fn: () => Promise<T>) {
      events.push('lock');
      return fn();
    },
    async setSession() {
      events.push('setSession');
      return { data: { session: null }, error: null };
    },
    async _saveSession() {
      events.push('save');
    },
    async _notifyAllSubscribers() {
      events.push('notify');
    },
  };

  const stored = await applyManagedAuthRefreshSession(fakeAuth, currentSession, {
    access_token: 'new-access',
    refresh_token: 'new-refresh',
    expires_in: 3600,
    token_type: 'bearer',
  }, {
    shouldApply: () => false,
  });

  assert.equal(stored, null);
  assert.deepEqual(events, ['lock']);
});

test('stale refresh race helper accepts only newer sessions for the same user', () => {
  const attemptedSession = {
    access_token: 'old-access',
    refresh_token: 'old-refresh',
    expires_in: 100,
    expires_at: 100,
    token_type: 'bearer' as const,
    user: { id: 'u1', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-01-01T00:00:00Z' },
  };

  assert.equal(isNewerAuthRefreshSession(null, attemptedSession), false);
  assert.equal(isNewerAuthRefreshSession({ ...attemptedSession, user: { ...attemptedSession.user, id: 'u2' } }, attemptedSession), false);
  assert.equal(isNewerAuthRefreshSession({ ...attemptedSession }, attemptedSession), false);
  assert.equal(isNewerAuthRefreshSession({ ...attemptedSession, refresh_token: 'new-refresh' }, attemptedSession), true);
  assert.equal(isNewerAuthRefreshSession({ ...attemptedSession, access_token: 'new-access' }, attemptedSession), true);
  assert.equal(isNewerAuthRefreshSession({ ...attemptedSession, expires_at: 101 }, attemptedSession), true);
});
