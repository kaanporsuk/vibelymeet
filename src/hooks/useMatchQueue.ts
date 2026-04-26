import { useEffect, useCallback, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import {
  type DrainMatchQueueResult,
  isVideoSessionQueuedTtlExpiryTransition,
  videoSessionIdFromDrainPayload,
} from "@shared/matching/videoSessionFlow";
import { isMatchQueueDrainEligible } from "@clientShared/matching/matchQueueDrainEligibility";
import { trackEvent } from "@/lib/analytics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";

interface UseMatchQueueOptions {
  eventId: string | undefined;
  currentStatus: string;
  /**
   * When true, post-date survey (`/date/:id`) may poll `drain_match_queue` while local status is `in_survey`
   * (fallback if `video_sessions` realtime lags). Lobby callers should omit this.
   */
  enableSurveyPhaseDrain?: boolean;
  /** Canonical: `video_sessions.id` when queue drain or realtime activates ready gate. */
  onVideoSessionReady?: (videoSessionId: string, partnerId: string) => void;
  /** Fired at most once per session id (deduped) when a queued session expires (TTL) for this user. */
  onQueuedSessionExpired?: (videoSessionId: string) => void;
}

export const useMatchQueue = ({
  eventId,
  currentStatus,
  enableSurveyPhaseDrain,
  onVideoSessionReady,
  onQueuedSessionExpired,
}: UseMatchQueueOptions) => {
  const { user } = useUserProfile();
  const [queuedCount, setQueuedCount] = useState(0);
  const [isDraining, setIsDraining] = useState(false);
  const onReadyRef = useRef(onVideoSessionReady);
  const onQueuedExpiredRef = useRef(onQueuedSessionExpired);
  /** Dedupe TTL-expiry toasts per `video_sessions.id` for this hook instance. */
  const queuedExpiryNotifiedIdsRef = useRef(new Set<string>());

  useEffect(() => {
    onReadyRef.current = onVideoSessionReady;
  }, [onVideoSessionReady]);

  useEffect(() => {
    onQueuedExpiredRef.current = onQueuedSessionExpired;
  }, [onQueuedSessionExpired]);

  useEffect(() => {
    queuedExpiryNotifiedIdsRef.current.clear();
  }, [eventId, user?.id]);

  const refreshQueueCount = useCallback(async () => {
    if (!eventId || !user?.id) return;

    const { count } = await supabase
      .from("video_sessions")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("ready_gate_status", "queued")
      .is("ended_at", null)
      .or(`participant_1_id.eq.${user.id},participant_2_id.eq.${user.id}`);

    setQueuedCount(count || 0);
  }, [eventId, user?.id]);

  useEffect(() => {
    if (!eventId || !user?.id || !isMatchQueueDrainEligible(currentStatus, { enableSurveyPhaseDrain })) return;

    const drainQueue = async () => {
      setIsDraining(true);
      try {
        const { data } = await supabase.rpc("drain_match_queue", {
          p_event_id: eventId,
        });

        const result = data as DrainMatchQueueResult;
        const reason =
          data && typeof data === "object" && "reason" in data
            ? String((data as { reason?: unknown }).reason ?? "")
            : null;
        const sessionId = videoSessionIdFromDrainPayload(result);
        if (result?.found && sessionId && result.partner_id) {
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_QUEUE_DRAIN_FOUND, {
            platform: "web",
            event_id: eventId,
            session_id: sessionId,
          });
          onReadyRef.current?.(sessionId, result.partner_id);
        } else if (result?.queued || reason) {
          trackEvent(
            result?.queued
              ? LobbyPostDateEvents.VIDEO_DATE_QUEUE_DRAIN_BLOCKED
              : LobbyPostDateEvents.VIDEO_DATE_QUEUE_DRAIN_NOT_FOUND,
            {
              platform: "web",
              event_id: eventId,
              reason,
            },
          );
        } else {
          trackEvent(LobbyPostDateEvents.VIDEO_DATE_QUEUE_DRAIN_NOT_FOUND, {
            platform: "web",
            event_id: eventId,
          });
        }
      } catch (err) {
        console.error("Error draining queue:", err);
      } finally {
        setIsDraining(false);
      }
    };

    drainQueue();
    refreshQueueCount();
  }, [eventId, user?.id, currentStatus, enableSurveyPhaseDrain, refreshQueueCount]);

  useEffect(() => {
    if (!eventId || !user?.id) return;

    const channel = supabase
      .channel(`match-queue-${eventId}-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "video_sessions",
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          const session = payload.new as {
            id: string;
            participant_1_id: string;
            participant_2_id: string;
            ready_gate_status: string;
          };
          const isParticipant =
            session.participant_1_id === user.id || session.participant_2_id === user.id;

          if (!isParticipant) return;

          const oldRow = payload.old as Record<string, unknown> | null | undefined;
          const newRow = payload.new as Record<string, unknown>;
          if (
            isVideoSessionQueuedTtlExpiryTransition(oldRow, newRow, user.id) &&
            !queuedExpiryNotifiedIdsRef.current.has(session.id)
          ) {
            queuedExpiryNotifiedIdsRef.current.add(session.id);
            onQueuedExpiredRef.current?.(session.id);
          }

          if (session.ready_gate_status === "ready" && payload.old?.ready_gate_status === "queued") {
            const partnerId =
              session.participant_1_id === user.id
                ? session.participant_2_id
                : session.participant_1_id;
            onReadyRef.current?.(session.id, partnerId);
          }

          refreshQueueCount();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "video_sessions",
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          const session = payload.new as {
            id: string;
            participant_1_id: string;
            participant_2_id: string;
            ready_gate_status: string;
          };
          const isParticipant =
            session.participant_1_id === user.id || session.participant_2_id === user.id;

          if (!isParticipant) return;

          if (session.ready_gate_status === "ready") {
            const partnerId =
              session.participant_1_id === user.id
                ? session.participant_2_id
                : session.participant_1_id;
            onReadyRef.current?.(session.id, partnerId);
          }

          refreshQueueCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, user?.id, refreshQueueCount]);

  return { queuedCount, refreshQueueCount, isDraining };
};
