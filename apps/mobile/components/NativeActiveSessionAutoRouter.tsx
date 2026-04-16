import { useEffect, useRef } from 'react';
import { router, usePathname } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useActiveSession } from '@/lib/useActiveSession';

/**
 * Cold-start / relaunch recovery: if the app boots into a home/tabs-like route
 * but the backend still reports an active video or ready-gate session for the
 * user, send them back into that flow so they don't land on home mid-date.
 *
 * One-shot per session id: fires only once after initial hydration to avoid
 * fighting other navigation (NativeSessionRouteHydration, NotificationDeepLinkHandler).
 */
const ACTIVE_SESSION_ROUTE_PREFIXES: ReadonlyArray<string> = [
  '/date/',
  '/ready/',
  '/chat/',
  '/event/',
  '/(auth)',
  '/(onboarding)',
  '/entry-recovery',
];

function isHomeLike(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (pathname === '/' || pathname === '') return true;
  for (const prefix of ACTIVE_SESSION_ROUTE_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix)) return false;
  }
  return true;
}

export function NativeActiveSessionAutoRouter() {
  const pathname = usePathname();
  const { user, session, loading, entryState, entryStateLoading } = useAuth();
  const { activeSession, hydrated } = useActiveSession(user?.id);
  const routedForSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (loading || entryStateLoading) return;
    if (!session || !user?.id) return;
    if (!entryState || entryState.state !== 'complete') return;
    if (!hydrated) return;
    if (!activeSession) return;
    if (!isHomeLike(pathname)) return;

    const sid = activeSession.sessionId;
    if (!sid) return;
    const routeKey = `${activeSession.kind}:${sid}`;
    if (routedForSessionRef.current === routeKey) return;
    routedForSessionRef.current = routeKey;

    if (activeSession.kind === 'video') {
      router.replace(`/date/${sid}` as const);
    } else if (activeSession.kind === 'ready_gate') {
      router.replace(`/ready/${sid}` as const);
    }
  }, [
    loading,
    entryStateLoading,
    session,
    user?.id,
    entryState,
    hydrated,
    activeSession,
    pathname,
  ]);

  return null;
}
