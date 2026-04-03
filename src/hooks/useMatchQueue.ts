import { useEffect, useCallback, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import {
  type DrainMatchQueueResult,
  videoSessionIdFromDrainPayload,
} from "@shared/matching/videoSessionFlow";

interface UseMatchQueueOptions {
  eventId: string | undefined;
  currentStatus: string;
  /** Canonical: `video_sessions.id` when queue drain or realtime activates ready gate. */
  onVideoSessionReady?: (videoSessionId: string, partnerId: string) => void;
  /** @deprecated Use `onVideoSessionReady` */
  onMatchReady?: (videoSessionId: string, partnerId: string) => void;
}

export const useMatchQueue = ({
  eventId,
  currentStatus,
  onVideoSessionReady,
  onMatchReady,
}: UseMatchQueueOptions) => {
  const { user } = useUserProfile();
  const [queuedCount, setQueuedCount] = useState(0);
  const onReadyRef = useRef(onVideoSessionReady ?? onMatchReady);

  useEffect(() => {
    onReadyRef.current = onVideoSessionReady ?? onMatchReady;
  }, [onVideoSessionReady, onMatchReady]);

  const refreshQueueCount = useCallback(async () => {
    if (!eventId || !user?.id) return;

    const { count } = await supabase
      .from("video_sessions")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("ready_gate_status", "queued")
      .or(`participant_1_id.eq.${user.id},participant_2_id.eq.${user.id}`);

    setQueuedCount(count || 0);
  }, [eventId, user?.id]);

  useEffect(() => {
    if (!eventId || !user?.id || !["browsing", "idle"].includes(currentStatus)) return;

    const drainQueue = async () => {
      try {
        const { data } = await supabase.rpc("drain_match_queue", {
          p_event_id: eventId,
        });

        const result = data as DrainMatchQueueResult;
        const sessionId = videoSessionIdFromDrainPayload(result);
        if (result?.found && sessionId && result.partner_id) {
          onReadyRef.current?.(sessionId, result.partner_id);
        }
      } catch (err) {
        console.error("Error draining queue:", err);
      }
    };

    drainQueue();
    refreshQueueCount();
  }, [eventId, user?.id, currentStatus, refreshQueueCount]);

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

  return { queuedCount, refreshQueueCount };
};
