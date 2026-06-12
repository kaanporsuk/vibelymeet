/**
 * Video Date navigation-intent store: route ownership, the date-entry
 * transition latch, manual-exit suppression, and duplicate-navigation claims.
 *
 * This absorbs the former web ad-hoc owners `src/lib/dateEntryTransitionLatch.ts`
 * and `src/lib/dateNavigationGuard.ts` into the shared controller, preserving
 * their exact TTL semantics and persisted storage keys. Pure TS: the clock and
 * the persistence ports are injected, so the store runs identically on web
 * (sessionStorage) and native (in-memory or MMKV adapter).
 *
 * This is intentionally small routing state, not business-state ownership.
 */

export const VIDEO_DATE_ENTRY_LATCH_DEFAULT_TTL_MS = 25_000;
export const VIDEO_DATE_ENTRY_PIPELINE_TTL_MS = 180_000;
export const VIDEO_DATE_ROUTE_OWNERSHIP_TTL_MS = 10 * 60_000;
export const VIDEO_DATE_ROUTE_OWNERSHIP_REFRESH_MS = 30_000;
export const VIDEO_DATE_ANONYMOUS_ROUTE_OWNERSHIP_TTL_MS = 2 * 60_000;
export const VIDEO_DATE_DUPLICATE_NAVIGATION_MS = 15_000;
export const VIDEO_DATE_MANUAL_EXIT_SUPPRESSION_MS = 5 * 60_000;

export const VIDEO_DATE_ROUTE_OWNERSHIP_STORAGE_PREFIX =
  "vibely_video_date_route_owner_v1:";
export const VIDEO_DATE_MANUAL_EXIT_STORAGE_KEY =
  "vibely:manual-video-date-exits:v1";

export type DateNavigationSuppressReason =
  | "already_on_same_date_route"
  | "recent_duplicate_navigation"
  | "recent_manual_exit";

export type DateNavigationClaimOptions = {
  force?: boolean;
};

export type DateNavigationClaimResult =
  | { ok: true }
  | { ok: false; reason: DateNavigationSuppressReason };

/** Structural subset of the web Storage interface; native adapters implement the same shape. */
export type VideoDateIntentsStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
};

export type CreateVideoDateNavigationIntentsOptions = {
  now?: () => number;
  /** Persistence for route ownership entries (web: sessionStorage). */
  ownershipStorage?: () => VideoDateIntentsStorage | null;
  /** Persistence for the manual-exit suppression map (web: sessionStorage). */
  manualExitStorage?: () => VideoDateIntentsStorage | null;
  /**
   * Duplicate-navigation burst window. Web keeps the 15s default; native uses
   * 30s because realtime delivers the same ready/date convergence from
   * registration + video_sessions within a burst that must cover the full
   * native Daily join pipeline (~30s typical).
   */
  duplicateNavigationMs?: number;
};

export type VideoDateNavigationIntents = ReturnType<
  typeof createVideoDateNavigationIntents
>;

function activeDateSessionIdFromPath(
  pathname: string | null | undefined,
): string | null {
  const match = pathname?.match(/^\/date\/([^/]+)/);
  return match?.[1] ?? null;
}

export function createVideoDateNavigationIntents(
  init: CreateVideoDateNavigationIntentsOptions = {},
) {
  const nowMs = init.now ?? (() => Date.now());
  const resolveOwnershipStorage = init.ownershipStorage ?? (() => null);
  const resolveManualExitStorage = init.manualExitStorage ?? (() => null);
  const duplicateNavigationMs =
    init.duplicateNavigationMs ?? VIDEO_DATE_DUPLICATE_NAVIGATION_MS;

  const latch = new Map<string, number>();
  const routeOwnership = new Map<string, number>();
  let lastDateNavigation: { sessionId: string; ts: number } | null = null;
  let manualExitSuppressions = new Map<string, number>();

  function ownershipStorage(): VideoDateIntentsStorage | null {
    try {
      return resolveOwnershipStorage();
    } catch (_error) {
      return null;
    }
  }

  function manualExitStorage(): VideoDateIntentsStorage | null {
    try {
      return resolveManualExitStorage();
    } catch (_error) {
      return null;
    }
  }

  function pruneExpired(t: number) {
    for (const [sessionId, expiresAt] of latch) {
      if (expiresAt <= t) latch.delete(sessionId);
    }
    for (const [key, expiresAt] of routeOwnership) {
      if (expiresAt <= t) routeOwnership.delete(key);
    }
  }

  function routeOwnershipKey(
    sessionId: string,
    profileId?: string | null,
  ): string {
    return `${profileId?.trim() || "anonymous"}:${sessionId}`;
  }

  function routeOwnershipStorageKey(key: string): string {
    return `${VIDEO_DATE_ROUTE_OWNERSHIP_STORAGE_PREFIX}${key}`;
  }

  function persistRouteOwnership(key: string, expiresAt: number) {
    const storage = ownershipStorage();
    if (!storage) return;
    try {
      storage.setItem(routeOwnershipStorageKey(key), String(expiresAt));
    } catch (_error) {
      // Storage is a convenience cache; in-memory ownership remains authoritative.
    }
  }

  function readStoredRouteOwnership(key: string, t: number): number | null {
    const storage = ownershipStorage();
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

  function clearStoredRouteOwnershipForSession(
    sessionId: string,
    keysToClear: string[],
  ) {
    const storage = ownershipStorage();
    if (!storage) return;
    try {
      for (const key of keysToClear) {
        storage.removeItem(routeOwnershipStorageKey(key));
      }
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const storageKey = storage.key(index);
        if (!storageKey?.startsWith(VIDEO_DATE_ROUTE_OWNERSHIP_STORAGE_PREFIX))
          continue;
        const ownershipKey = storageKey.slice(
          VIDEO_DATE_ROUTE_OWNERSHIP_STORAGE_PREFIX.length,
        );
        if (ownershipKey.endsWith(`:${sessionId}`))
          storage.removeItem(storageKey);
      }
    } catch (_error) {
      // Best effort cleanup only.
    }
  }

  function routeOwnershipTtlMs(
    profileId: string | null | undefined,
    ttlMs: number,
  ): number {
    const ttl = Math.max(1_000, ttlMs);
    return profileId?.trim()
      ? ttl
      : Math.min(ttl, VIDEO_DATE_ANONYMOUS_ROUTE_OWNERSHIP_TTL_MS);
  }

  function markDateEntryTransition(
    sessionId: string,
    ttlMs: number = VIDEO_DATE_ENTRY_LATCH_DEFAULT_TTL_MS,
  ) {
    if (!sessionId) return;
    const t = nowMs();
    pruneExpired(t);
    latch.set(sessionId, t + Math.max(1_000, ttlMs));
  }

  function isDateEntryTransitionActive(sessionId: string): boolean {
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

  function clearDateEntryTransition(sessionId: string) {
    if (!sessionId) return;
    latch.delete(sessionId);
  }

  function markVideoDateEntryPipelineStarted(sessionId: string) {
    markDateEntryTransition(sessionId, VIDEO_DATE_ENTRY_PIPELINE_TTL_MS);
  }

  function markVideoDateRouteOwned(
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

  function isVideoDateRouteOwned(
    sessionId: string,
    profileId?: string | null,
  ): boolean {
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

  function clearVideoDateRouteOwnership(
    sessionId: string,
    profileId?: string | null,
  ) {
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

  function readStoredManualExitSuppressions(): Map<string, number> {
    const storage = manualExitStorage();
    if (!storage) return manualExitSuppressions;
    try {
      const raw = storage.getItem(VIDEO_DATE_MANUAL_EXIT_STORAGE_KEY);
      if (!raw) return manualExitSuppressions;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const next = new Map<string, number>();
      const now = nowMs();
      for (const [sessionId, expiresAt] of Object.entries(parsed)) {
        if (typeof expiresAt === "number" && expiresAt > now)
          next.set(sessionId, expiresAt);
      }
      manualExitSuppressions = next;
    } catch {
      // A corrupt storage value should not break navigation.
    }
    return manualExitSuppressions;
  }

  function writeStoredManualExitSuppressions() {
    const storage = manualExitStorage();
    if (!storage) return;
    try {
      storage.setItem(
        VIDEO_DATE_MANUAL_EXIT_STORAGE_KEY,
        JSON.stringify(Object.fromEntries(manualExitSuppressions)),
      );
    } catch {
      // Storage is best-effort; the in-memory map still protects this runtime.
    }
  }

  function pruneManualExitSuppressions() {
    const now = nowMs();
    let changed = false;
    for (const [sessionId, expiresAt] of readStoredManualExitSuppressions()) {
      if (expiresAt <= now) {
        manualExitSuppressions.delete(sessionId);
        changed = true;
      }
    }
    if (changed) writeStoredManualExitSuppressions();
  }

  function suppressDateNavigationAfterManualExit(
    sessionId: string,
    ttlMs: number = VIDEO_DATE_MANUAL_EXIT_SUPPRESSION_MS,
  ) {
    if (!sessionId) return;
    pruneManualExitSuppressions();
    manualExitSuppressions.set(sessionId, nowMs() + Math.max(5_000, ttlMs));
    writeStoredManualExitSuppressions();
  }

  function isDateNavigationSuppressedAfterManualExit(
    sessionId: string,
  ): boolean {
    if (!sessionId) return false;
    pruneManualExitSuppressions();
    const expiresAt = manualExitSuppressions.get(sessionId);
    if (!expiresAt) return false;
    if (expiresAt <= nowMs()) {
      manualExitSuppressions.delete(sessionId);
      writeStoredManualExitSuppressions();
      return false;
    }
    return true;
  }

  function claimDateNavigation(
    sessionId: string,
    pathname: string | null | undefined,
    options: DateNavigationClaimOptions = {},
  ): DateNavigationClaimResult {
    if (!sessionId)
      return { ok: false, reason: "recent_duplicate_navigation" };
    const force = options.force === true;

    if (activeDateSessionIdFromPath(pathname) === sessionId) {
      return { ok: false, reason: "already_on_same_date_route" };
    }

    if (!force && isDateNavigationSuppressedAfterManualExit(sessionId)) {
      return { ok: false, reason: "recent_manual_exit" };
    }

    const now = nowMs();
    if (
      !force &&
      lastDateNavigation?.sessionId === sessionId &&
      now - lastDateNavigation.ts < duplicateNavigationMs
    ) {
      return { ok: false, reason: "recent_duplicate_navigation" };
    }

    lastDateNavigation = { sessionId, ts: now };
    markVideoDateEntryPipelineStarted(sessionId);
    return { ok: true };
  }

  return {
    markDateEntryTransition,
    isDateEntryTransitionActive,
    clearDateEntryTransition,
    markVideoDateEntryPipelineStarted,
    markVideoDateRouteOwned,
    isVideoDateRouteOwned,
    clearVideoDateRouteOwnership,
    suppressDateNavigationAfterManualExit,
    isDateNavigationSuppressedAfterManualExit,
    claimDateNavigation,
  };
}
