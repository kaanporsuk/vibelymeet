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
 *   3. Invalidates on every auth state-change event so stale tokens are never returned
 *      across sign-in / sign-out boundaries.
 *
 * Usage: replace bare `supabase.auth.getSession()` calls that only need the access_token
 * or user.id — e.g. in Edge Function fetch wrappers, push sync helpers, and video date
 * API helpers that don't need a fresh network verify.  Auth-critical paths (sign-in, token
 * refresh, MFA) should continue to call supabase.auth directly.
 */
import { supabase } from '@/lib/supabase';
import type { Session } from '@supabase/supabase-js';

const TTL_MS = 30_000; // 30 s — short enough that a refresh will have landed

let cached: { session: Session | null; expiresAt: number } | null = null;
let inFlight: Promise<Session | null> | null = null;

function nowMs(): number {
  return Date.now();
}

function invalidate(): void {
  cached = null;
  inFlight = null;
}

// Keep the cache coherent across sign-in / sign-out / token refresh events.
supabase.auth.onAuthStateChange(() => {
  invalidate();
});

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

  inFlight = (async (): Promise<Session | null> => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        if (__DEV__) console.warn('[nativeAuthSession] getSession error:', error.message);
        invalidate();
        return null;
      }
      cached = { session: data.session, expiresAt: nowMs() + TTL_MS };
      return data.session;
    } catch (e) {
      if (__DEV__) console.warn('[nativeAuthSession] getSession threw:', e);
      invalidate();
      return null;
    } finally {
      inFlight = null;
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
