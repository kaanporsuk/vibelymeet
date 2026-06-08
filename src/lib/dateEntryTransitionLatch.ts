/**
 * Web session-scoped latch to prevent `/date/:id` -> lobby bounce during the
 * narrow window after Ready Gate succeeds while registration rows still read
 * `in_ready_gate`.
 *
 * This is intentionally small routing state, not business-state ownership.
 */
const DEFAULT_TTL_MS = 25_000;
export const VIDEO_DATE_ENTRY_PIPELINE_TTL_MS = 180_000;
export const VIDEO_DATE_ROUTE_OWNERSHIP_TTL_MS = 10 * 60_000;
export const VIDEO_DATE_ROUTE_OWNERSHIP_REFRESH_MS = 30_000;
export const VIDEO_DATE_ANONYMOUS_ROUTE_OWNERSHIP_TTL_MS = 2 * 60_000;
const ROUTE_OWNERSHIP_STORAGE_PREFIX = "vibely_video_date_route_owner_v1:";

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

function routeOwnershipStorageKey(key: string): string {
  return `${ROUTE_OWNERSHIP_STORAGE_PREFIX}${key}`;
}

function routeOwnershipStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage ?? null;
  } catch (_error) {
    return null;
  }
}

function persistRouteOwnership(key: string, expiresAt: number) {
  const storage = routeOwnershipStorage();
  if (!storage) return;
  try {
    storage.setItem(routeOwnershipStorageKey(key), String(expiresAt));
  } catch (_error) {
    // Storage is a convenience cache; in-memory ownership remains authoritative.
  }
}

function readStoredRouteOwnership(key: string, t: number): number | null {
  const storage = routeOwnershipStorage();
  if (!storage) return null;
  const storageKey = routeOwnershipStorageKey(key);
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    const expiresAt = Number(raw);
    if (!Number.isFinite(expiresAt) || expiresAt <= t) {
      storage.removeItem(storageKey);
      return null;
    }
    return expiresAt;
  } catch (_error) {
    return null;
  }
}

function clearStoredRouteOwnershipForSession(sessionId: string, keysToClear: string[]) {
  const storage = routeOwnershipStorage();
  if (!storage) return;
  try {
    for (const key of keysToClear) {
      storage.removeItem(routeOwnershipStorageKey(key));
    }
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const storageKey = storage.key(index);
      if (!storageKey?.startsWith(ROUTE_OWNERSHIP_STORAGE_PREFIX)) continue;
      const ownershipKey = storageKey.slice(ROUTE_OWNERSHIP_STORAGE_PREFIX.length);
      if (ownershipKey.endsWith(`:${sessionId}`)) storage.removeItem(storageKey);
    }
  } catch (_error) {
    // Best effort cleanup only.
  }
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
  const key = routeOwnershipKey(sessionId, profileId);
  const expiresAt = t + routeOwnershipTtlMs(profileId, ttlMs);
  routeOwnership.set(key, expiresAt);
  persistRouteOwnership(key, expiresAt);
}

export function isVideoDateRouteOwned(sessionId: string, profileId?: string | null): boolean {
  if (!sessionId) return false;
  const t = nowMs();
  pruneExpired(t);
  const key = routeOwnershipKey(sessionId, profileId);
  const anonymousKey = routeOwnershipKey(sessionId, null);
  const expiresAt =
    routeOwnership.get(key) ??
    routeOwnership.get(anonymousKey) ??
    readStoredRouteOwnership(key, t) ??
    readStoredRouteOwnership(anonymousKey, t);
  if (!expiresAt) return false;
  routeOwnership.set(key, expiresAt);
  if (expiresAt <= t) {
    routeOwnership.delete(key);
    routeOwnership.delete(anonymousKey);
    return false;
  }
  return true;
}

export function clearVideoDateRouteOwnership(sessionId: string, profileId?: string | null) {
  if (!sessionId) return;
  const keysToClear = [routeOwnershipKey(sessionId, null)];
  if (profileId) {
    keysToClear.push(routeOwnershipKey(sessionId, profileId));
  }
  for (const key of keysToClear) routeOwnership.delete(key);
  for (const key of routeOwnership.keys()) {
    if (key.endsWith(`:${sessionId}`)) routeOwnership.delete(key);
  }
  clearStoredRouteOwnershipForSession(sessionId, keysToClear);
}
