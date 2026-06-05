/**
 * Web session-scoped latch to prevent `/date/:id` -> lobby bounce during the
 * narrow window after Ready Gate succeeds while registration rows still read
 * `in_ready_gate`.
 *
 * This is intentionally small routing state, not business-state ownership.
 */
const DEFAULT_TTL_MS = 25_000;
export const VIDEO_DATE_ENTRY_PIPELINE_TTL_MS = 180_000;
export const VIDEO_DATE_ROUTE_OWNERSHIP_TTL_MS = 90_000;
export const VIDEO_DATE_ROUTE_OWNERSHIP_REFRESH_MS = 30_000;
export const VIDEO_DATE_ANONYMOUS_ROUTE_OWNERSHIP_TTL_MS = 30_000;

const latch = new Map<string, number>();
const routeOwnership = new Map<string, number>();

function nowMs(): number {
  return Date.now();
}

function pruneExpired(t: number) {
  for (const [sessionId, expiresAt] of latch) {
    if (expiresAt <= t) latch.delete(sessionId);
  }
  for (const [key, expiresAt] of routeOwnership) {
    if (expiresAt <= t) routeOwnership.delete(key);
  }
}

function routeOwnershipKey(sessionId: string, profileId?: string | null): string {
  return `${profileId?.trim() || "anonymous"}:${sessionId}`;
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
  latch.set(sessionId, t + Math.max(1_000, ttlMs));
}

export function isDateEntryTransitionActive(sessionId: string): boolean {
  if (!sessionId) return false;
  const t = nowMs();
  pruneExpired(t);
  const expiresAt = latch.get(sessionId);
  if (!expiresAt) return false;
  if (expiresAt <= t) {
    latch.delete(sessionId);
    return false;
  }
  return true;
}

export function clearDateEntryTransition(sessionId: string) {
  if (!sessionId) return;
  latch.delete(sessionId);
}

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
  routeOwnership.set(routeOwnershipKey(sessionId, profileId), t + routeOwnershipTtlMs(profileId, ttlMs));
}

export function isVideoDateRouteOwned(sessionId: string, profileId?: string | null): boolean {
  if (!sessionId) return false;
  const t = nowMs();
  pruneExpired(t);
  const key = routeOwnershipKey(sessionId, profileId);
  const anonymousKey = routeOwnershipKey(sessionId, null);
  const expiresAt = routeOwnership.get(key) ?? routeOwnership.get(anonymousKey);
  if (!expiresAt) return false;
  if (expiresAt <= t) {
    routeOwnership.delete(key);
    routeOwnership.delete(anonymousKey);
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
}
