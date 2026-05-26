import { authErrorDebugInfo, authErrorStatus } from './authErrorCopy';
import type { Session } from '@supabase/supabase-js';

export type AuthRefreshErrorKind = 'retryable' | 'invalid_session' | 'fatal';

export type RefreshableAuthSession = {
  refresh_token?: string | null;
  expires_at?: number | null;
};

export type ManagedAuthRefreshResponse = {
  access_token: string;
  refresh_token: string;
  expires_in?: number | null;
  expires_at?: number | null;
  token_type?: string | null;
  provider_token?: string | null;
  provider_refresh_token?: string | null;
  user?: unknown;
};

type ManagedAuthSessionStore = {
  setSession(session: { access_token: string; refresh_token: string }): Promise<{
    data: { session: Session | null };
    error: unknown;
  }>;
};

type ManagedAuthRefreshApplyOptions = {
  shouldApply?: () => boolean | Promise<boolean>;
};

export const AUTH_REFRESH_LEAD_MS = 60_000;
export const AUTH_REFRESH_RETRY_BASE_MS = 30_000;
export const AUTH_REFRESH_RETRY_MAX_MS = 300_000;
export const AUTH_REFRESH_STALE_RACE_CHECK_DELAYS_MS = [0, 250, 1_000] as const;

const RETRYABLE_REFRESH_STATUSES = new Set([0, 408, 429, 500, 502, 503, 504]);

const INVALID_REFRESH_TOKEN_PATTERNS = [
  /invalid refresh token/i,
  /refresh token not found/i,
  /refresh_token_not_found/i,
  /refresh token already used/i,
  /refresh_token_already_used/i,
  /session missing/i,
  /no session/i,
];

const RETRYABLE_REFRESH_MESSAGE_PATTERNS = [
  /network request failed/i,
  /failed to fetch/i,
  /fetch failed/i,
  /load failed/i,
  /networkerror/i,
  /internet connection appears to be offline/i,
  /connection appears to be offline/i,
  /not connected to the internet/i,
  /timed out/i,
  /timeout/i,
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function stringProp(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberProp(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key];
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function errorFingerprint(error: unknown): string {
  if (typeof error === 'string') return error;
  const record = asRecord(error);
  return [
    error instanceof Error ? error.name : stringProp(record, 'name'),
    stringProp(record, 'code'),
    stringProp(record, 'error_code'),
    error instanceof Error ? error.message : stringProp(record, 'message'),
    stringProp(record, 'error_description'),
    stringProp(record, 'msg'),
    stringProp(record, 'error'),
  ].filter(Boolean).join(' ');
}

export function classifyAuthRefreshError(error: unknown): AuthRefreshErrorKind {
  const fingerprint = errorFingerprint(error);
  if (INVALID_REFRESH_TOKEN_PATTERNS.some((pattern) => pattern.test(fingerprint))) {
    return 'invalid_session';
  }

  const status = authErrorStatus(error);
  if (status !== null && RETRYABLE_REFRESH_STATUSES.has(status)) {
    return 'retryable';
  }

  const record = asRecord(error);
  const name = error instanceof Error ? error.name : stringProp(record, 'name');
  if (name === 'AuthRetryableFetchError') {
    return 'retryable';
  }

  if (RETRYABLE_REFRESH_MESSAGE_PATTERNS.some((pattern) => pattern.test(fingerprint))) {
    return 'retryable';
  }

  return 'fatal';
}

export class ManagedAuthRefreshError extends Error {
  status: number | null;
  code: string | null;

  constructor(message: string, options: { status?: number | null; code?: string | null } = {}) {
    super(message);
    this.name = 'ManagedAuthRefreshError';
    this.status = options.status ?? null;
    this.code = options.code ?? null;
  }
}

function payloadFingerprint(payload: Record<string, unknown> | null): string {
  return [
    stringProp(payload, 'code'),
    stringProp(payload, 'error_code'),
    stringProp(payload, 'error'),
    stringProp(payload, 'message'),
    stringProp(payload, 'msg'),
    stringProp(payload, 'error_description'),
  ].filter(Boolean).join(' ');
}

function managedRefreshErrorFromResponse(status: number, payload: Record<string, unknown> | null) {
  const code =
    stringProp(payload, 'code') ??
    stringProp(payload, 'error_code') ??
    stringProp(payload, 'error');
  const payloadMessage =
    stringProp(payload, 'message') ??
    stringProp(payload, 'msg') ??
    stringProp(payload, 'error_description');
  const fingerprint = payloadFingerprint(payload);
  const isInvalidSession = INVALID_REFRESH_TOKEN_PATTERNS.some((pattern) => pattern.test(fingerprint));
  const message = isInvalidSession && payloadMessage
    ? payloadMessage.slice(0, 160)
    : `Auth refresh request failed with status ${status}`;

  return new ManagedAuthRefreshError(message, { status, code });
}

async function readJsonObject(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function parseManagedAuthRefreshResponse(
  payload: Record<string, unknown> | null,
  status: number,
): ManagedAuthRefreshResponse {
  const accessToken = stringProp(payload, 'access_token');
  const refreshToken = stringProp(payload, 'refresh_token');
  if (!accessToken || !refreshToken) {
    throw new ManagedAuthRefreshError(`Auth refresh response missing session fields with status ${status}`, {
      status,
      code: stringProp(payload, 'code') ?? stringProp(payload, 'error_code') ?? null,
    });
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: numberProp(payload, 'expires_in'),
    expires_at: numberProp(payload, 'expires_at'),
    token_type: stringProp(payload, 'token_type'),
    provider_token: stringProp(payload, 'provider_token'),
    provider_refresh_token: stringProp(payload, 'provider_refresh_token'),
    user: payload?.user,
  };
}

export async function requestManagedAuthRefresh({
  supabaseUrl,
  publishableKey,
  refreshToken,
  fetchImpl = fetch,
}: {
  supabaseUrl: string;
  publishableKey: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<ManagedAuthRefreshResponse> {
  if (!refreshToken) {
    throw new ManagedAuthRefreshError('Auth session missing refresh token');
  }

  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=refresh_token`;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${publishableKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const payload = await readJsonObject(response);

  if (!response.ok) {
    throw managedRefreshErrorFromResponse(response.status, payload);
  }

  return parseManagedAuthRefreshResponse(payload, response.status);
}

export function buildManagedAuthRefreshSession(
  currentSession: Session,
  refreshResponse: ManagedAuthRefreshResponse,
  nowMs = Date.now(),
): Session {
  const expiresIn = typeof refreshResponse.expires_in === 'number'
    ? refreshResponse.expires_in
    : currentSession.expires_in ?? 3600;
  const expiresAt = typeof refreshResponse.expires_at === 'number'
    ? refreshResponse.expires_at
    : Math.round(nowMs / 1000) + expiresIn;

  return {
    ...currentSession,
    access_token: refreshResponse.access_token,
    refresh_token: refreshResponse.refresh_token,
    expires_in: expiresIn,
    expires_at: expiresAt,
    token_type: (refreshResponse.token_type ?? currentSession.token_type ?? 'bearer') as Session['token_type'],
    provider_token: refreshResponse.provider_token ?? currentSession.provider_token,
    provider_refresh_token: refreshResponse.provider_refresh_token ?? currentSession.provider_refresh_token,
    user: (asRecord(refreshResponse.user) ? refreshResponse.user : currentSession.user) as Session['user'],
  };
}

export function isNewerAuthRefreshSession(
  latestSession: Session | null | undefined,
  attemptedSession: Session,
): latestSession is Session {
  return Boolean(
    latestSession?.refresh_token &&
      latestSession.user.id === attemptedSession.user.id &&
      (
        latestSession.refresh_token !== attemptedSession.refresh_token ||
        latestSession.access_token !== attemptedSession.access_token ||
        (typeof latestSession.expires_at === 'number' &&
          typeof attemptedSession.expires_at === 'number' &&
          latestSession.expires_at > attemptedSession.expires_at)
      ),
  );
}

export async function applyManagedAuthRefreshSession(
  auth: ManagedAuthSessionStore,
  currentSession: Session,
  refreshResponse: ManagedAuthRefreshResponse,
  options: ManagedAuthRefreshApplyOptions = {},
): Promise<Session | null> {
  const nextSession = buildManagedAuthRefreshSession(currentSession, refreshResponse);
  const authInternals = auth as ManagedAuthSessionStore & {
    _acquireLock?: <T>(acquireTimeout: number, fn: () => Promise<T>) => Promise<T>;
    _saveSession?: (session: Session) => Promise<void>;
    _notifyAllSubscribers?: (event: string, session: Session | null) => Promise<void>;
  };

  const applySession = async (): Promise<Session | null> => {
    if (options.shouldApply && !(await options.shouldApply())) {
      return null;
    }

    if (
      typeof authInternals._saveSession === 'function' &&
      typeof authInternals._notifyAllSubscribers === 'function'
    ) {
      await authInternals._saveSession.call(auth, nextSession);
      try {
        await authInternals._notifyAllSubscribers.call(auth, 'TOKEN_REFRESHED', nextSession);
      } catch {
        /* Subscriber errors must not turn a saved refresh into a retry storm. */
      }
      return nextSession;
    }

    const { data, error } = await auth.setSession({
      access_token: nextSession.access_token,
      refresh_token: nextSession.refresh_token,
    });
    if (error) throw error;
    return data.session ?? null;
  };

  if (typeof authInternals._acquireLock === 'function') {
    return authInternals._acquireLock<Session | null>(-1, applySession);
  }

  const appliedSession = await applySession();
  if (appliedSession) {
    return appliedSession;
  }
  if (options.shouldApply) {
    return null;
  }
  const { data, error } = await auth.setSession({
    access_token: nextSession.access_token,
    refresh_token: nextSession.refresh_token,
  });
  if (error) throw error;
  if (!data.session) {
    throw new ManagedAuthRefreshError('Auth session missing after managed refresh');
  }
  return data.session;
}

export function nextAuthRefreshDelayMs(failureCount: number): number {
  const normalizedFailureCount = Math.max(1, Math.floor(failureCount));
  const baseDelay = normalizedFailureCount >= 4
    ? AUTH_REFRESH_RETRY_MAX_MS
    : AUTH_REFRESH_RETRY_BASE_MS * 2 ** (normalizedFailureCount - 1);
  if (baseDelay >= AUTH_REFRESH_RETRY_MAX_MS) return AUTH_REFRESH_RETRY_MAX_MS;

  const jitterRatio = ((normalizedFailureCount * 17) % 21) / 100;
  return Math.min(
    baseDelay + Math.floor(baseDelay * jitterRatio),
    AUTH_REFRESH_RETRY_MAX_MS,
  );
}

export function shouldRefreshSessionSoon(
  session: RefreshableAuthSession | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!session?.refresh_token || typeof session.expires_at !== 'number') {
    return false;
  }
  return session.expires_at * 1000 - nowMs <= AUTH_REFRESH_LEAD_MS;
}

export function authRefreshDebugInfo(error: unknown): ReturnType<typeof authErrorDebugInfo> & {
  kind: AuthRefreshErrorKind;
} {
  return {
    ...authErrorDebugInfo(error),
    kind: classifyAuthRefreshError(error),
  };
}
