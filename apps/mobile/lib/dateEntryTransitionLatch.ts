/**
 * Mobile-only, session-scoped latch to prevent `/date/:id` → `/ready/:id` bounce
 * during the narrow window after `both_ready` while registrations still show `in_ready_gate`.
 *
 * This is intentionally tiny (module-level Map + TTL), not a global state system.
 */
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';

const DEFAULT_TTL_MS = 25_000;

/** Covers full native prejoin: enter_handshake → token → Daily join (lobby closure pack used 25s; too short). */
export const VIDEO_DATE_ENTRY_PIPELINE_TTL_MS = 180_000;
export const VIDEO_DATE_ROUTE_OWNERSHIP_TTL_MS = 90_000;
export const VIDEO_DATE_ROUTE_OWNERSHIP_REFRESH_MS = 30_000;
export const VIDEO_DATE_ANONYMOUS_ROUTE_OWNERSHIP_TTL_MS = 30_000;

const latch = new Map<string, number>(); // sessionId -> expiresAtMs
const routeOwnership = new Map<string, number>(); // profileId:sessionId -> expiresAtMs

function nowMs(): number {
  return Date.now();
}

function pruneExpired(t: number) {
  for (const [sid, expiresAt] of latch) {
    if (expiresAt <= t) latch.delete(sid);
  }
  for (const [key, expiresAt] of routeOwnership) {
    if (expiresAt <= t) routeOwnership.delete(key);
  }
}

function routeOwnershipKey(sessionId: string, profileId?: string | null): string {
  return `${profileId?.trim() || 'anonymous'}:${sessionId}`;
}

function routeOwnershipTtlMs(profileId: string | null | undefined, ttlMs: number): number {
  const ttl = Math.max(1_000, ttlMs);
  return profileId?.trim()
    ? ttl
    : Math.min(ttl, VIDEO_DATE_ANONYMOUS_ROUTE_OWNERSHIP_TTL_MS);
}

export function markDateEntryTransition(sessionId: string, ttlMs: number = DEFAULT_TTL_MS) {
  if (!sessionId) return;
  const t = nowMs();
  pruneExpired(t);
  const ttl = Math.max(1_000, ttlMs);
  latch.set(sessionId, t + ttl);
  rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_entry_latch_marked', {
    session_id: sessionId,
    ttl_ms: ttl,
  });
}

export function isDateEntryTransitionActive(sessionId: string): boolean {
  if (!sessionId) return false;
  const t = nowMs();
  pruneExpired(t);
  const exp = latch.get(sessionId);
  if (!exp) return false;
  if (exp <= t) {
    latch.delete(sessionId);
    rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_entry_latch_expired', { session_id: sessionId });
    return false;
  }
  return true;
}

export function clearDateEntryTransition(sessionId: string) {
  if (!sessionId) return;
  if (latch.has(sessionId)) {
    rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_entry_latch_cleared', { session_id: sessionId });
  }
  latch.delete(sessionId);
}

/** Call when `/date/[id]` mounts so the prejoin pipeline can survive slow native hydration. */
export function markVideoDateEntryPipelineStarted(sessionId: string) {
  markDateEntryTransition(sessionId, VIDEO_DATE_ENTRY_PIPELINE_TTL_MS);
}

export function markVideoDateRouteOwned(
  sessionId: string,
  profileId?: string | null,
  ttlMs: number = VIDEO_DATE_ROUTE_OWNERSHIP_TTL_MS,
) {
  if (!sessionId) return;
  const t = nowMs();
  pruneExpired(t);
  const ttl = routeOwnershipTtlMs(profileId, ttlMs);
  routeOwnership.set(routeOwnershipKey(sessionId, profileId), t + ttl);
  rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_route_ownership_marked', {
    session_id: sessionId,
    profile_id_present: Boolean(profileId),
    ttl_ms: ttl,
  });
}

export function isVideoDateRouteOwned(sessionId: string, profileId?: string | null): boolean {
  if (!sessionId) return false;
  const t = nowMs();
  pruneExpired(t);
  const key = routeOwnershipKey(sessionId, profileId);
  const anonymousKey = routeOwnershipKey(sessionId, null);
  const exp = routeOwnership.get(key) ?? routeOwnership.get(anonymousKey);
  if (!exp) return false;
  if (exp <= t) {
    routeOwnership.delete(key);
    routeOwnership.delete(anonymousKey);
    rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_route_ownership_expired', { session_id: sessionId });
    return false;
  }
  return true;
}

export function clearVideoDateRouteOwnership(sessionId: string, profileId?: string | null) {
  if (!sessionId) return;
  if (profileId) {
    routeOwnership.delete(routeOwnershipKey(sessionId, profileId));
  }
  routeOwnership.delete(routeOwnershipKey(sessionId, null));
  for (const key of routeOwnership.keys()) {
    if (key.endsWith(`:${sessionId}`)) routeOwnership.delete(key);
  }
  rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_route_ownership_cleared', {
    session_id: sessionId,
    profile_id_present: Boolean(profileId),
  });
}
