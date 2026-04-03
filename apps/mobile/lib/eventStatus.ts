/**
 * Event status tracking: browsing on mount (direct update), offline on unmount, 60s heartbeat.
 * Mirrors web useEventStatus (src/hooks/useEventStatus.ts).
 * Other flows (ready gate, video date) call updateParticipantStatus RPC for in_ready_gate, in_handshake, etc.
 */

import { useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { updateParticipantStatus } from '@/lib/videoDateApi';

export type ParticipantStatus =
  | 'browsing'
  | 'in_ready_gate'
  | 'in_handshake'
  | 'in_date'
  | 'in_survey'
  | 'offline'
  | 'idle';

const HEARTBEAT_MS = 30000;

export function useEventStatus(eventId: string | undefined, userId: string | undefined, enabled = true) {
  const setStatus = useCallback(
    async (status: ParticipantStatus) => {
      if (!eventId || !userId) return;
      try {
        await updateParticipantStatus(eventId, status);
      } catch (err) {
        if (__DEV__) console.warn('eventStatus setStatus', err);
      }
    },
    [eventId, userId]
  );

  useEffect(() => {
    if (!enabled || !eventId || !userId) return;
    (async () => {
      const ok = await updateParticipantStatus(eventId, 'browsing');
      if (!ok && __DEV__) console.warn('[eventStatus] initial status update failed');
    })();
    const heartbeat = setInterval(async () => {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from('event_registrations')
        .update({
          last_active_at: nowIso,
        })
        .eq('event_id', eventId)
        .eq('profile_id', userId);
      if (error && __DEV__) console.warn('[eventStatus] heartbeat update failed:', error.message);
    }, HEARTBEAT_MS);
    return () => {
      clearInterval(heartbeat);
      updateParticipantStatus(eventId, 'offline').catch(() => {});
    };
  }, [enabled, eventId, userId]);

  return { setStatus };
}
