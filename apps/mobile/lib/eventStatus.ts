/**
 * Event status tracking: browsing on mount, offline on unmount, 60s server-stamped heartbeat.
 * Mirrors web useEventStatus (src/hooks/useEventStatus.ts).
 * Ready Gate and video-date route statuses are server-owned.
 */

import { useCallback, useEffect, useRef } from 'react';
import { markEventParticipantHeartbeat, updateParticipantStatus } from '@/lib/videoDateApi';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { recordVideoDateHeartbeatV2 } from '@/lib/videoDateReadiness';

export type ClientWritableParticipantStatus =
  | 'browsing'
  | 'in_survey'
  | 'offline'
  | 'idle';

export type ParticipantStatus =
  | ClientWritableParticipantStatus
  | 'in_ready_gate'
  | 'in_handshake'
  | 'in_date';

const HEARTBEAT_MS = 30000;

export function useEventStatus(eventId: string | undefined, userId: string | undefined, enabled = true) {
  const enabledRef = useRef(enabled);
  const readinessV2 = useFeatureFlag('video_date.readiness_v2');

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const setStatus = useCallback(
    async (status: ClientWritableParticipantStatus) => {
      if (!enabledRef.current) return;
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
      const ok = readinessV2.enabled
        ? await recordVideoDateHeartbeatV2(eventId)
        : await markEventParticipantHeartbeat(eventId);
      if (!ok && __DEV__) console.warn('[eventStatus] heartbeat update failed');
    }, HEARTBEAT_MS);
    return () => {
      clearInterval(heartbeat);
      updateParticipantStatus(eventId, 'offline').catch(() => {});
    };
  }, [enabled, eventId, readinessV2.enabled, userId]);

  return { setStatus };
}
