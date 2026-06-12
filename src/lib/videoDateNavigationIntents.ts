import {
  createVideoDateNavigationIntents,
  VIDEO_DATE_ENTRY_PIPELINE_TTL_MS,
  VIDEO_DATE_ROUTE_OWNERSHIP_REFRESH_MS,
  VIDEO_DATE_ROUTE_OWNERSHIP_TTL_MS,
  type DateNavigationClaimOptions,
  type DateNavigationClaimResult,
  type DateNavigationSuppressReason,
  type VideoDateIntentsStorage,
} from "@clientShared/videoDate/navigationIntents";

/**
 * Web binding for the shared Video Date navigation-intents store.
 *
 * Replaces the deleted ad-hoc owners `src/lib/dateEntryTransitionLatch.ts`
 * and `src/lib/dateNavigationGuard.ts`: the semantics (TTLs, persisted
 * sessionStorage keys, force overrides) now live in
 * `shared/videoDate/navigationIntents.ts`; this module only provides the
 * browser sessionStorage port and the app-wide singleton.
 */

function webSessionStorage(): VideoDateIntentsStorage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage ?? null;
  } catch (_error) {
    return null;
  }
}

export const videoDateNavigationIntents = createVideoDateNavigationIntents({
  ownershipStorage: webSessionStorage,
  manualExitStorage: webSessionStorage,
});

export {
  VIDEO_DATE_ENTRY_PIPELINE_TTL_MS,
  VIDEO_DATE_ROUTE_OWNERSHIP_REFRESH_MS,
  VIDEO_DATE_ROUTE_OWNERSHIP_TTL_MS,
};
export type {
  DateNavigationClaimOptions,
  DateNavigationClaimResult,
  DateNavigationSuppressReason,
};

export function markDateEntryTransition(sessionId: string, ttlMs?: number) {
  videoDateNavigationIntents.markDateEntryTransition(sessionId, ttlMs);
}

export function isDateEntryTransitionActive(sessionId: string): boolean {
  return videoDateNavigationIntents.isDateEntryTransitionActive(sessionId);
}

export function clearDateEntryTransition(sessionId: string) {
  videoDateNavigationIntents.clearDateEntryTransition(sessionId);
}

export function markVideoDateEntryPipelineStarted(sessionId: string) {
  videoDateNavigationIntents.markVideoDateEntryPipelineStarted(sessionId);
}

export function markVideoDateRouteOwned(
  sessionId: string,
  profileId?: string | null,
  ttlMs?: number,
) {
  videoDateNavigationIntents.markVideoDateRouteOwned(
    sessionId,
    profileId,
    ttlMs,
  );
}

export function isVideoDateRouteOwned(
  sessionId: string,
  profileId?: string | null,
): boolean {
  return videoDateNavigationIntents.isVideoDateRouteOwned(sessionId, profileId);
}

export function clearVideoDateRouteOwnership(
  sessionId: string,
  profileId?: string | null,
) {
  videoDateNavigationIntents.clearVideoDateRouteOwnership(sessionId, profileId);
}

export function suppressDateNavigationAfterManualExit(
  sessionId: string,
  ttlMs?: number,
) {
  videoDateNavigationIntents.suppressDateNavigationAfterManualExit(
    sessionId,
    ttlMs,
  );
}

export function isDateNavigationSuppressedAfterManualExit(
  sessionId: string,
): boolean {
  return videoDateNavigationIntents.isDateNavigationSuppressedAfterManualExit(
    sessionId,
  );
}

export function claimDateNavigation(
  sessionId: string,
  pathname: string | null | undefined,
  options: DateNavigationClaimOptions = {},
): DateNavigationClaimResult {
  return videoDateNavigationIntents.claimDateNavigation(
    sessionId,
    pathname,
    options,
  );
}
