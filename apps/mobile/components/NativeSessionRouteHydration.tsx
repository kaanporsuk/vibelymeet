import { useEffect, useRef } from 'react';
import { router, usePathname } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useActiveSession } from '@/lib/useActiveSession';

/**
 * Backend-truth-first: if user lands on /date/[id] while still in Ready Gate, move to /ready/[id].
 */
export function NativeSessionRouteHydration() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { activeSession, hydrated } = useActiveSession(user?.id);
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id || !hydrated || !pathname) return;
    const m = pathname.match(/\/date\/([^/]+)/);
    if (!m) return;
    const sid = m[1];
    if (activeSession?.sessionId !== sid || activeSession.kind !== 'ready_gate') return;
    const key = `${sid}:ready_gate`;
    if (lastKey.current === key) return;
    lastKey.current = key;
    router.replace(`/ready/${sid}` as const);
  }, [user?.id, hydrated, pathname, activeSession]);

  return null;
}
