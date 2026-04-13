import { useEffect, useRef } from 'react';
import { router, usePathname } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { useActiveSession } from '@/lib/useActiveSession';
import { supabase } from '@/lib/supabase';

/**
 * Backend-truth-first: reconcile /date/[id] with active session and video_sessions
 * (Ready Gate vs ended session deep links).
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
      const key = `${sid}:ready_gate`;
      if (lastReadyKey.current === key) return;
      lastReadyKey.current = key;
      router.replace(`/ready/${sid}` as const);
      return;
    }

    let cancelled = false;
    void (async () => {
      const { data: vs } = await supabase
        .from('video_sessions')
        .select('ended_at, event_id')
        .eq('id', sid)
        .maybeSingle();

      if (cancelled || !vs?.ended_at) return;

      if (vs.event_id) {
        router.replace(`/event/${vs.event_id}/lobby` as const);
      } else {
        router.replace('/(tabs)' as const);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, hydrated, pathname, activeSession]);

  return null;
}
