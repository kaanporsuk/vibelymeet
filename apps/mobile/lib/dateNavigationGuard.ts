import { router, type Href } from 'expo-router';
import { videoDateHref } from '@/lib/activeSessionRoutes';

type DateNavMode = 'replace' | 'push';
type DateNavReason = 'already_on_same_date_route' | 'recent_duplicate_navigation';

let lastDateNav: { sessionId: string; ts: number } | null = null;
// Realtime can deliver the same ready/date convergence from registration + video_sessions.
// Keep this route-only latch long enough to cover duplicate render/update bursts.
const DUPLICATE_BURST_MS = 15_000;

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
  if (activeDateSessionIdFromPath(pathname) === sessionId) {
    onSuppressed?.({ reason: 'already_on_same_date_route', target });
    return false;
  }
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
