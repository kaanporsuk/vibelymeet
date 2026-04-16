import { useEffect, useRef } from 'react';
import { router, usePathname } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useActiveSession } from '@/lib/useActiveSession';
import { isDateEntryTransitionActive } from '@/lib/dateEntryTransitionLatch';

/**
 * Primary URL-level owner for `/date/[id]` when hydrated active session is **ready_gate**
 * for that session → `/ready/[id]`.
 *
 * **Defense-in-depth:** `app/date/[id].tsx` still checks `ended_at` and `in_ready_gate` via
 * Supabase in an effect (before/without relying on hydration), covering cold-start races.
 *
 * **Ended sessions:** handled in the date screen effect (same queries as this file used to
 * duplicate) — single owner for ended redirect there.
 */
export function NativeSessionRouteHydration() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { activeSession, hydrated } = useActiveSession(user?.id);
  const lastReadyKey = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id || !hydrated || !pathname) return;
    const m = pathname.match(/\/date\/([^/]+)/);
    if (!m) {
      lastReadyKey.current = null;
      return;
    }
    const sid = m[1];

    if (activeSession?.sessionId === sid && activeSession.kind === 'ready_gate') {
      // If we intentionally started date entry for this session, do not bounce back to Ready Gate
      // during the narrow `both_ready` → `in_handshake` window.
      if (isDateEntryTransitionActive(sid)) return;
      const key = `${sid}:ready_gate`;
      if (lastReadyKey.current === key) return;
      lastReadyKey.current = key;
      router.replace(`/ready/${sid}` as const);
    }
  }, [user?.id, hydrated, pathname, activeSession]);

  return null;
}
