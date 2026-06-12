import { router, type Href } from 'expo-router';
import {
  createVideoDateNavigationIntents,
  VIDEO_DATE_ENTRY_PIPELINE_TTL_MS,
  VIDEO_DATE_ROUTE_OWNERSHIP_REFRESH_MS,
  VIDEO_DATE_ROUTE_OWNERSHIP_TTL_MS,
  VIDEO_DATE_ANONYMOUS_ROUTE_OWNERSHIP_TTL_MS,
  type DateNavigationSuppressReason,
} from '@clientShared/videoDate/navigationIntents';
import { videoDateHref } from '@/lib/activeSessionRoutes';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';

/**
 * Native binding for the shared Video Date navigation-intents store.
 *
 * Replaces the deleted ad-hoc owners `apps/mobile/lib/dateEntryTransitionLatch.ts`
 * and `apps/mobile/lib/dateNavigationGuard.ts`: the semantics (TTLs, manual-exit
 * suppression, duplicate-navigation claims, force overrides) now live in
 * `shared/videoDate/navigationIntents.ts`; this module provides the app-wide
 * singleton (in-memory, like the deleted owners — no persisted storage on
 * native), keeps the native 30s duplicate-navigation burst window, preserves
 * the RC breadcrumb stream, and hosts the expo-router navigation side effect
 * (`navigateToDateSessionGuarded`).
 */

/**
 * Realtime delivers the same ready/date convergence from registration +
 * video_sessions within a burst. The native window covers the full Daily join
 * pipeline (~30s typical), wider than the shared 15s default.
 */
export const NATIVE_VIDEO_DATE_DUPLICATE_NAVIGATION_MS = 30_000;

export const videoDateNavigationIntents = createVideoDateNavigationIntents({
  duplicateNavigationMs: NATIVE_VIDEO_DATE_DUPLICATE_NAVIGATION_MS,
});

export {
  VIDEO_DATE_ENTRY_PIPELINE_TTL_MS,
  VIDEO_DATE_ROUTE_OWNERSHIP_REFRESH_MS,
  VIDEO_DATE_ROUTE_OWNERSHIP_TTL_MS,
};
export type { DateNavigationSuppressReason };

type DateNavMode = 'replace' | 'push';

/** Diagnostics-only mirror of the last successful guarded navigation (breadcrumb payload parity). */
let lastDateNavBreadcrumbState: {
  sessionId: string;
  ts: number;
  routerReplaceInvoked: boolean;
} | null = null;

function effectiveRouteOwnershipTtlMs(
  profileId: string | null | undefined,
  ttlMs: number,
): number {
  const ttl = Math.max(1_000, ttlMs);
  return profileId?.trim()
    ? ttl
    : Math.min(ttl, VIDEO_DATE_ANONYMOUS_ROUTE_OWNERSHIP_TTL_MS);
}

export function markDateEntryTransition(sessionId: string, ttlMs?: number) {
  if (!sessionId) return;
  videoDateNavigationIntents.markDateEntryTransition(sessionId, ttlMs);
  rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_entry_latch_marked', {
    session_id: sessionId,
    ttl_ms: Math.max(1_000, ttlMs ?? 25_000),
  });
}

export function isDateEntryTransitionActive(sessionId: string): boolean {
  return videoDateNavigationIntents.isDateEntryTransitionActive(sessionId);
}

export function clearDateEntryTransition(sessionId: string) {
  if (!sessionId) return;
  if (videoDateNavigationIntents.isDateEntryTransitionActive(sessionId)) {
    rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_entry_latch_cleared', {
      session_id: sessionId,
    });
  }
  videoDateNavigationIntents.clearDateEntryTransition(sessionId);
}

/** Call when `/date/[id]` mounts so the prejoin pipeline can survive slow native hydration. */
export function markVideoDateEntryPipelineStarted(sessionId: string) {
  if (!sessionId) return;
  videoDateNavigationIntents.markVideoDateEntryPipelineStarted(sessionId);
  rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_entry_latch_marked', {
    session_id: sessionId,
    ttl_ms: VIDEO_DATE_ENTRY_PIPELINE_TTL_MS,
  });
}

export function markVideoDateRouteOwned(
  sessionId: string,
  profileId?: string | null,
  ttlMs: number = VIDEO_DATE_ROUTE_OWNERSHIP_TTL_MS,
) {
  if (!sessionId) return;
  videoDateNavigationIntents.markVideoDateRouteOwned(sessionId, profileId, ttlMs);
  rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_route_ownership_marked', {
    session_id: sessionId,
    profile_id_present: Boolean(profileId),
    ttl_ms: effectiveRouteOwnershipTtlMs(profileId, ttlMs),
  });
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
  if (!sessionId) return;
  videoDateNavigationIntents.clearVideoDateRouteOwnership(sessionId, profileId);
  rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'date_route_ownership_cleared', {
    session_id: sessionId,
    profile_id_present: Boolean(profileId),
  });
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

export function navigateToDateSessionGuarded(params: {
  sessionId: string;
  pathname: string | null | undefined;
  mode?: DateNavMode;
  force?: boolean;
  onSuppressed?: (payload: {
    reason: DateNavigationSuppressReason;
    target: Href;
  }) => void;
  onNavigate?: (payload: { target: Href; mode: DateNavMode }) => void;
}): boolean {
  const { sessionId, pathname, mode = 'replace', force = false, onSuppressed, onNavigate } = params;
  const target = videoDateHref(sessionId);
  const onDateRouteForSession =
    (pathname?.match(/^\/date\/([^/]+)/)?.[1] ?? null) === sessionId;

  rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'date_nav_guard_called', {
    session_id: sessionId,
    pathname: pathname ?? null,
    target_href: String(target),
    mode,
    force,
    on_date_route_for_session: onDateRouteForSession,
    last_nav_session_id: lastDateNavBreadcrumbState?.sessionId ?? null,
    last_nav_replace_invoked:
      lastDateNavBreadcrumbState?.routerReplaceInvoked ?? null,
  });

  const claim = videoDateNavigationIntents.claimDateNavigation(
    sessionId,
    pathname,
    { force },
  );

  if (!claim.ok) {
    onSuppressed?.({ reason: claim.reason, target });
    rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'date_nav_suppressed', {
      session_id: sessionId,
      reason: claim.reason,
      pathname: pathname ?? null,
      target_href: String(target),
      force,
    });
    return false;
  }

  lastDateNavBreadcrumbState = {
    sessionId,
    ts: Date.now(),
    routerReplaceInvoked: true,
  };
  onNavigate?.({ target, mode });
  if (mode === 'push') {
    router.push(target);
    rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'date_nav_router_push_invoked', {
      session_id: sessionId,
      pathname: pathname ?? null,
      target_href: String(target),
    });
  } else {
    router.replace(target);
    // Same tick as navigation commit: blocks NativeSessionRouteHydration bounce
    // before `/date` layout runs (the claim marked the entry pipeline already).
    rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'date_nav_router_replace_invoked', {
      session_id: sessionId,
      pathname: pathname ?? null,
      target_href: String(target),
    });
  }
  return true;
}
