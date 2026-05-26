/**
 * Thin dedup + short-TTL cache for supabase.auth.getSession() on the native hot path.
 *
 * Why: the Supabase GoTrue client uses a process-level mutex (processLock) when reading
 * the persisted token from AsyncStorage. Concurrent callers (AuthContext bootstrap, push
 * sync, lobby hydration, realtime setup) all arrive within the same ~100 ms window at
 * startup and during ready-gate, causing repeated 5 s lock-acquisition timeouts logged as
 * "@supabase/gotrue-js: Lock acquisition timed out".
 *
 * This module:
 *   1. Coalesces concurrent calls into one in-flight promise (dedup).
 *   2. Caches the resolved session for TTL_MS so the next burst read is synchronous.
 *   3. Lets AuthContext invalidate on auth state changes after bootstrap has cleaned
 *      stale refresh tokens, avoiding an early INITIAL_SESSION LogBox.
 *
 * Usage: replace bare `supabase.auth.getSession()` calls that only need the access_token
 * or user.id — e.g. in Edge Function fetch wrappers, push sync helpers, and video date
 * API helpers that don't need a fresh network verify.  Auth-critical paths (sign-in, token
 * refresh, MFA) should continue to call supabase.auth directly.
 */
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from '@/lib/supabase';
import {
  isRecoverableNativeAuthError,
  recoverNativeAuthSession,
} from '@/lib/nativeAuthRecovery';
import type { Session } from '@supabase/supabase-js';
import {
  AUTH_REFRESH_STALE_RACE_CHECK_DELAYS_MS,
  applyManagedAuthRefreshSession,
  authRefreshDebugInfo,
  classifyAuthRefreshError,
  isNewerAuthRefreshSession,
  requestManagedAuthRefresh,
} from '@clientShared/authRefreshPolicy';

const TTL_MS = 30_000; // 30 s — short enough that a refresh will have landed
const SWIPE_AUTH_REFRESH_WINDOW_MS = 60_000;
const SWIPE_AUTH_EXPIRED_SKEW_MS = 5_000;

let cached: { session: Session | null; expiresAt: number } | null = null;
let inFlight: Promise<Session | null> | null = null;
let refreshInFlight: Promise<Session | null> | null = null;
let cacheVersion = 0;

function nowMs(): number {
  return Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function invalidate(): void {
  cacheVersion += 1;
  cached = null;
  inFlight = null;
  refreshInFlight = null;
}

function sessionExpiresAtMs(session: Session | null | undefined): number | null {
  return typeof session?.expires_at === 'number' ? session.expires_at * 1000 : null;
}

function isSessionExpiredForSwipe(session: Session | null | undefined): boolean {
  const expiresAtMs = sessionExpiresAtMs(session);
  return expiresAtMs != null && expiresAtMs <= nowMs() + SWIPE_AUTH_EXPIRED_SKEW_MS;
}

function shouldRefreshSessionForSwipe(session: Session | null | undefined): boolean {
  const expiresAtMs = sessionExpiresAtMs(session);
  return expiresAtMs != null && expiresAtMs <= nowMs() + SWIPE_AUTH_REFRESH_WINDOW_MS;
}

async function recoverFromCachedRefreshRace(attemptedSession: Session): Promise<Session | null> {
  for (const delayMs of AUTH_REFRESH_STALE_RACE_CHECK_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs);
    const {
      data: { session: latestSession },
    } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    if (!isNewerAuthRefreshSession(latestSession, attemptedSession)) {
      continue;
    }
    primeCachedSession(latestSession);
    return latestSession;
  }
  return null;
}

async function resolveFreshSessionAfterCacheInvalidation(
  requestVersion: number,
  nextSession: Session,
): Promise<Session | null> {
  if (cacheVersion === requestVersion) {
    primeCachedSession(nextSession);
    return nextSession;
  }

  const {
    data: { session: latestSession },
  } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  if (
    latestSession?.refresh_token === nextSession.refresh_token &&
    latestSession.user.id === nextSession.user.id
  ) {
    primeCachedSession(latestSession);
    return latestSession;
  }
  return null;
}

async function handleCachedRefreshFailure(session: Session, error: unknown): Promise<Session | null> {
  const kind = classifyAuthRefreshError(error);
  if (kind === 'invalid_session') {
    const raceRecoveredSession = await recoverFromCachedRefreshRace(session);
    if (raceRecoveredSession) return raceRecoveredSession;
    await recoverNativeAuthSession('cached-session', error);
    invalidate();
    return null;
  }

  if (__DEV__ && kind === 'fatal') {
    console.warn('[nativeAuthSession] refreshSession failed:', authRefreshDebugInfo(error));
  }

  return isSessionExpiredForSwipe(session) ? null : session;
}

/**
 * Returns the current Supabase session, coalescing concurrent callers into one
 * getSession() call and caching the result for TTL_MS.
 *
 * Returns null if the user is not signed in or getSession() fails.
 */
export async function getCachedSession(): Promise<Session | null> {
  const now = nowMs();

  // Return cache hit if still fresh.
  if (cached && cached.expiresAt > now) {
    return cached.session;
  }

  // Coalesce concurrent callers.
  if (inFlight) return inFlight;

  const requestVersion = cacheVersion;
  inFlight = (async (): Promise<Session | null> => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        if (isRecoverableNativeAuthError(error)) {
          await recoverNativeAuthSession('cached-session', error);
        } else if (__DEV__) {
          console.warn('[nativeAuthSession] getSession error:', error.message);
        }
        invalidate();
        return null;
      }
      if (cacheVersion !== requestVersion) return null;
      cached = { session: data.session, expiresAt: nowMs() + TTL_MS };
      return data.session;
    } catch (e) {
      if (isRecoverableNativeAuthError(e)) {
        await recoverNativeAuthSession('cached-session', e);
      } else if (__DEV__) {
        console.warn('[nativeAuthSession] getSession threw:', e);
      }
      invalidate();
      return null;
    } finally {
      if (cacheVersion === requestVersion) {
        inFlight = null;
      }
    }
  })();

  return inFlight;
}

/**
 * Convenience: returns the access_token string, or null if not signed in.
 * Use this instead of `(await supabase.auth.getSession()).data.session?.access_token`
 * in Edge Function fetch wrappers.
 */
export async function getCachedAccessToken(): Promise<string | null> {
  const session = await getCachedSession();
  return session?.access_token ?? null;
}

/**
 * Returns a cached session that is safe for strict Edge Function JWT checks.
 * It reuses the normal cached session, but refreshes when the access token is
 * close to expiry so callers never fall back to Supabase's public-key auth.
 */
export async function getFreshCachedSession(): Promise<Session | null> {
  const session = await getCachedSession();
  if (!session?.access_token) return null;
  if (!shouldRefreshSessionForSwipe(session)) return session;

  if (refreshInFlight) return refreshInFlight;

  const requestVersion = cacheVersion;
  refreshInFlight = (async (): Promise<Session | null> => {
    try {
      const refreshResponse = await requestManagedAuthRefresh({
        supabaseUrl: SUPABASE_URL,
        publishableKey: SUPABASE_PUBLISHABLE_KEY,
        refreshToken: session.refresh_token,
      });
      const nextSession = await applyManagedAuthRefreshSession(supabase.auth, session, refreshResponse, {
        shouldApply: () => cacheVersion === requestVersion,
      });
      if (!nextSession) return null;

      return resolveFreshSessionAfterCacheInvalidation(requestVersion, nextSession);
    } catch (e) {
      return handleCachedRefreshFailure(session, e);
    } finally {
      if (cacheVersion === requestVersion) {
        refreshInFlight = null;
      }
    }
  })();

  return refreshInFlight;
}

/**
 * Convenience for strict Edge Function calls that must send a real user JWT.
 */
export async function getFreshCachedAccessToken(): Promise<string | null> {
  const session = await getFreshCachedSession();
  return session?.access_token ?? null;
}

/**
 * Convenience: returns the authenticated user ID, or null if not signed in.
 * Use this instead of `(await supabase.auth.getUser()).data.user?.id` in helpers
 * that only need the ID and don't require a network verify.
 */
export async function getCachedUserId(): Promise<string | null> {
  const session = await getCachedSession();
  return session?.user?.id ?? null;
}

/**
 * Explicit invalidation — call after a successful token refresh or sign-out
 * if you need the cache cleared immediately.
 */
export function invalidateCachedSession(): void {
  invalidate();
}

export function primeCachedSession(session: Session | null): void {
  if (!session) {
    invalidate();
    return;
  }
  cacheVersion += 1;
  cached = { session, expiresAt: nowMs() + TTL_MS };
  inFlight = null;
  refreshInFlight = null;
}
