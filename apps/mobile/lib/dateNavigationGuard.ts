import { router, type Href } from 'expo-router';
import { videoDateHref } from '@/lib/activeSessionRoutes';
import { markVideoDateEntryPipelineStarted } from '@/lib/dateEntryTransitionLatch';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';

type DateNavMode = 'replace' | 'push';
type DateNavReason = 'already_on_same_date_route' | 'recent_duplicate_navigation';

let lastDateNav: { sessionId: string; ts: number; routerReplaceInvoked: boolean } | null = null;
// Realtime delivers the same ready/date convergence from registration + video_sessions
// within a burst. Extend the window to cover the full Daily join pipeline (~30 s typical).
const DUPLICATE_BURST_MS = 30_000;

function activeDateSessionIdFromPath(pathname: string | null | undefined): string | null {
  const m = pathname?.match(/^\/date\/([^/]+)/);
  return m?.[1] ?? null;
}

export function navigateToDateSessionGuarded(params: {
  sessionId: string;
  pathname: string | null | undefined;
  mode?: DateNavMode;
  /** When pathname is still not `/date/:id` after a prior replace (e.g. rescue timer), allow retry despite burst dedupe. */
  bypassDuplicateBurstForRescue?: boolean;
  onSuppressed?: (payload: { reason: DateNavReason; target: Href }) => void;
  onNavigate?: (payload: { target: Href; mode: DateNavMode }) => void;
}): boolean {
  const { sessionId, pathname, mode = 'replace', bypassDuplicateBurstForRescue, onSuppressed, onNavigate } = params;
  const target = videoDateHref(sessionId);
  const onDateRouteForSession = activeDateSessionIdFromPath(pathname) === sessionId;

  rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'date_nav_guard_called', {
    session_id: sessionId,
    pathname: pathname ?? null,
    target_href: String(target),
    mode,
    on_date_route_for_session: onDateRouteForSession,
    last_nav_session_id: lastDateNav?.sessionId ?? null,
    last_nav_replace_invoked: lastDateNav?.routerReplaceInvoked ?? null,
  });

  // Already on the date route for this session — no-op.
  if (onDateRouteForSession) {
    onSuppressed?.({ reason: 'already_on_same_date_route', target });
    rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'date_nav_suppressed', {
      session_id: sessionId,
      reason: 'already_on_same_date_route',
      pathname: pathname ?? null,
      target_href: String(target),
    });
    return false;
  }

  // Deduplicate burst navigations (multiple realtime events firing within DUPLICATE_BURST_MS).
  const now = Date.now();
  if (
    !bypassDuplicateBurstForRescue &&
    lastDateNav?.sessionId === sessionId &&
    now - lastDateNav.ts < DUPLICATE_BURST_MS
  ) {
    onSuppressed?.({ reason: 'recent_duplicate_navigation', target });
    rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'date_nav_suppressed', {
      session_id: sessionId,
      reason: 'recent_duplicate_navigation',
      pathname: pathname ?? null,
      target_href: String(target),
      ms_since_last_nav: now - lastDateNav.ts,
    });
    return false;
  }

  lastDateNav = { sessionId, ts: now, routerReplaceInvoked: true };
  onNavigate?.({ target, mode });
  if (mode === 'push') {
    router.push(target);
    markVideoDateEntryPipelineStarted(sessionId);
    rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'date_nav_router_push_invoked', {
      session_id: sessionId,
      pathname: pathname ?? null,
      target_href: String(target),
    });
  } else {
    router.replace(target);
    // Same tick as navigation commit: blocks NativeSessionRouteHydration bounce before `/date` layout runs.
    markVideoDateEntryPipelineStarted(sessionId);
    rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'date_nav_router_replace_invoked', {
      session_id: sessionId,
      pathname: pathname ?? null,
      target_href: String(target),
    });
  }
  return true;
}
