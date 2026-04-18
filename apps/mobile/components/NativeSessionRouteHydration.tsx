import { useEffect, useRef } from 'react';
import { router, usePathname } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { readyGateHref } from '@/lib/activeSessionRoutes';
import { useActiveSession } from '@/lib/useActiveSession';
import { isDateEntryTransitionActive } from '@/lib/dateEntryTransitionLatch';
import { fetchVideoSessionDateEntryTruth, videoSessionIndicatesHandshakeOrDate } from '@/lib/videoDateApi';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';

/**
 * Stack-level owner for `/date/[id]` when `useActiveSession` is **ready_gate** for that id →
 * `readyGateHref` (see `activeSessionRoutes`). Date screen still applies server truth first.
 *
 * **Defense-in-depth:** `app/date/[id].tsx` checks `ended_at` and `in_ready_gate` via Supabase.
 * **Ended sessions:** date screen owns terminal redirect to lobby/tabs.
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

    if (activeSession?.sessionId !== sid || activeSession.kind !== 'ready_gate') return;

    if (isDateEntryTransitionActive(sid)) {
      rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'navigate_to_date_blocked', {
        session_id: sid,
        reason: 'date_entry_latch',
      });
      return;
    }

    let cancelled = false;
    void (async () => {
      const vs = await fetchVideoSessionDateEntryTruth(sid);
      if (cancelled) return;
      // Do not navigate on unknown server state — stale `ready_gate` ER is safer than bouncing when vs is missing.
      if (!vs) {
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'navigate_to_date_blocked', {
          session_id: sid,
          reason: 'video_sessions_row_unavailable',
        });
        return;
      }
      if (vs.ended_at) return;
      if (videoSessionIndicatesHandshakeOrDate(vs)) {
        rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'navigate_to_date_blocked', {
          session_id: sid,
          reason: 'video_sessions_handshake_or_date',
          handshake_started_at: Boolean(vs?.handshake_started_at),
          vs_state: vs?.state ?? null,
          vs_phase: vs?.phase ?? null,
        });
        return;
      }
      const key = `${sid}:ready_gate`;
      if (lastReadyKey.current === key) return;
      lastReadyKey.current = key;
      rcBreadcrumb(RC_CATEGORY.videoDateEntry, 'route_bounced_to_ready', {
        session_id: sid,
        source: 'native_session_route_hydration',
      });
      router.replace(readyGateHref(sid));
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, hydrated, pathname, activeSession]);

  return null;
}
