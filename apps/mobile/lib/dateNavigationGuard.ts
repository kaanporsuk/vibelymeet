import { router, type Href } from 'expo-router';
import { videoDateHref } from '@/lib/activeSessionRoutes';
import { isDateEntryTransitionActive } from '@/lib/dateEntryTransitionLatch';

type DateNavMode = 'replace' | 'push';
type DateNavReason =
  | 'already_on_same_date_route'
  | 'recent_duplicate_navigation'
  | 'date_entry_pipeline_active';

let lastDateNav: { sessionId: string; ts: number } | null = null;
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
  onSuppressed?: (payload: { reason: DateNavReason; target: Href }) => void;
  onNavigate?: (payload: { target: Href; mode: DateNavMode }) => void;
}): boolean {
  const { sessionId, pathname, mode = 'replace', onSuppressed, onNavigate } = params;
  const target = videoDateHref(sessionId);

  // Already on the date route for this session — no-op.
  if (activeDateSessionIdFromPath(pathname) === sessionId) {
    onSuppressed?.({ reason: 'already_on_same_date_route', target });
    return false;
  }

  // The date entry pipeline latch is active for this session, meaning /date/:id has
  // already been navigated to and the prejoin pipeline is running. Suppress until the
  // latch expires so lobby/overlay realtime bursts don't re-navigate mid-prejoin.
  if (isDateEntryTransitionActive(sessionId)) {
    onSuppressed?.({ reason: 'date_entry_pipeline_active', target });
    return false;
  }

  // Deduplicate burst navigations (multiple realtime events firing within DUPLICATE_BURST_MS).
  const now = Date.now();
  if (lastDateNav?.sessionId === sessionId && now - lastDateNav.ts < DUPLICATE_BURST_MS) {
    onSuppressed?.({ reason: 'recent_duplicate_navigation', target });
    return false;
  }

  lastDateNav = { sessionId, ts: now };
  onNavigate?.({ target, mode });
  if (mode === 'push') router.push(target);
  else router.replace(target);
  return true;
}
