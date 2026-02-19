import { useEffect, useCallback, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface UseMatchQueueOptions {
  eventId: string | undefined;
  currentStatus: string;
  onMatchReady?: (matchId: string, partnerId: string) => void;
}

export const useMatchQueue = ({ eventId, currentStatus, onMatchReady }: UseMatchQueueOptions) => {
  const { user } = useAuth();
  const [queuedCount, setQueuedCount] = useState(0);
  const onMatchReadyRef = useRef(onMatchReady);

  useEffect(() => {
    onMatchReadyRef.current = onMatchReady;
  }, [onMatchReady]);

  // Count queued matches
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

  // Drain queue when status returns to browsing
  useEffect(() => {
    if (!eventId || !user?.id || !["browsing", "idle"].includes(currentStatus)) return;

    const drainQueue = async () => {
      try {
        const { data } = await supabase.rpc("drain_match_queue", {
          p_event_id: eventId,
          p_user_id: user.id,
        });

        const result = data as any;
        if (result?.found && result.match_id) {
          onMatchReadyRef.current?.(result.match_id, result.partner_id);
        }
      } catch (err) {
        console.error("Error draining queue:", err);
      }
    };

    drainQueue();
    refreshQueueCount();
  }, [eventId, user?.id, currentStatus, refreshQueueCount]);

  // Listen for realtime match activations (queued → ready)
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
          const session = payload.new as any;
          const isParticipant =
            session.participant_1_id === user.id || session.participant_2_id === user.id;

          if (!isParticipant) return;

          if (session.ready_gate_status === "ready" && payload.old?.ready_gate_status === "queued") {
            const partnerId =
              session.participant_1_id === user.id
                ? session.participant_2_id
                : session.participant_1_id;
            onMatchReadyRef.current?.(session.id, partnerId);
          }

          refreshQueueCount();
        }
      )
      // Also listen for INSERT — immediate matches are CREATED with 'ready' status
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "video_sessions",
          filter: `event_id=eq.${eventId}`,
        },
        (payload) => {
          const session = payload.new as any;
          const isParticipant =
            session.participant_1_id === user.id || session.participant_2_id === user.id;

          if (!isParticipant) return;

          if (session.ready_gate_status === "ready") {
            const partnerId =
              session.participant_1_id === user.id
                ? session.participant_2_id
                : session.participant_1_id;
            onMatchReadyRef.current?.(session.id, partnerId);
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
