import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type QueueStatus = "idle" | "searching" | "matched" | "in_date" | "completed";

interface MatchingState {
  status: QueueStatus;
  roomId: string | null;
  partnerId: string | null;
  datesCompleted: number;
  isLoading: boolean;
  error: string | null;
}

interface UseVideoMatchingOptions {
  eventId: string;
  autoNavigate?: boolean;
}

async function callVideoMatching(action: string, eventId: string) {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) throw new Error("Not authenticated");

  const { data, error } = await supabase.functions.invoke("video-matching", {
    body: { action, eventId },
  });

  if (error) throw error;
  return data;
}

export const useVideoMatching = ({ eventId, autoNavigate = true }: UseVideoMatchingOptions) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<MatchingState>({
    status: "idle",
    roomId: null,
    partnerId: null,
    datesCompleted: 0,
    isLoading: false,
    error: null,
  });

  // Subscribe to realtime changes on own registration
  useEffect(() => {
    if (!user?.id || !eventId) return;

    const channel = supabase
      .channel(`matching-${eventId}-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "event_registrations",
          filter: `profile_id=eq.${user.id}`,
        },
        (payload) => {
          const newData = payload.new as {
            event_id: string;
            queue_status: QueueStatus;
            current_room_id: string | null;
            current_partner_id: string | null;
            dates_completed: number;
          };

          if (newData.event_id !== eventId) return;

          setState((prev) => ({
            ...prev,
            status: newData.queue_status,
            roomId: newData.current_room_id,
            partnerId: newData.current_partner_id,
            datesCompleted: newData.dates_completed,
          }));

          // Auto-navigate when matched
          if (newData.queue_status === "matched" && newData.current_room_id && autoNavigate) {
            toast.success("Match found! Starting video date...");
            navigate(`/date/${newData.current_room_id}`);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, eventId, navigate, autoNavigate]);

  // Fetch initial status
  const fetchStatus = useCallback(async () => {
    if (!user?.id || !eventId) return;

    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const data = await callVideoMatching("get_status", eventId);

      if (data.success) {
        // If status is "matched" but no active video session, reset to idle
        // This prevents stale matched state from auto-navigating to dead rooms
        let effectiveStatus = data.queue_status || "idle";
        let effectiveRoomId = data.room_id;
        let effectivePartnerId = data.partner_id;

        if (effectiveStatus === "matched" && effectiveRoomId) {
          // Verify the video session is still active (not ended)
          const { data: session } = await supabase
            .from("video_sessions")
            .select("ended_at")
            .eq("id", effectiveRoomId)
            .maybeSingle();

          if (!session || session.ended_at) {
            // Session already ended, reset to idle
            console.log("[Matching] Stale matched status detected, resetting to idle");
            effectiveStatus = "idle";
            effectiveRoomId = null;
            effectivePartnerId = null;
            // Also reset in the database
            await callVideoMatching("leave_queue", eventId).catch(() => {});
          }
        }

        setState((prev) => ({
          ...prev,
          status: effectiveStatus as QueueStatus,
          roomId: effectiveRoomId,
          partnerId: effectivePartnerId,
          datesCompleted: data.dates_completed || 0,
          isLoading: false,
          error: null,
        }));

        if (effectiveStatus === "matched" && effectiveRoomId && autoNavigate) {
          navigate(`/date/${effectiveRoomId}`);
        }
      } else {
        setState((prev) => ({ ...prev, isLoading: false, error: data.error }));
      }
    } catch (error) {
      console.error("Error fetching status:", error);
      setState((prev) => ({ ...prev, isLoading: false, error: "Failed to fetch status" }));
    }
  }, [user?.id, eventId, navigate, autoNavigate]);

  // Join the matching queue
  const joinQueue = useCallback(async () => {
    if (!user?.id || !eventId) return;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const data = await callVideoMatching("join_queue", eventId);

      if (data.success && data.matched) {
        toast.success("Match found! Starting video date...");
        setState((prev) => ({
          ...prev,
          status: "matched",
          roomId: data.room_id,
          partnerId: data.partner_id,
          isLoading: false,
        }));

        if (autoNavigate) {
          navigate(`/date/${data.room_id}`);
        }
      } else if (data.waiting) {
        toast.info("Looking for a match...");
        setState((prev) => ({
          ...prev,
          status: "searching",
          isLoading: false,
        }));
      } else if (!data.success) {
        toast.error(data.error || "Failed to join queue");
        setState((prev) => ({ ...prev, isLoading: false, error: data.error }));
      }
    } catch (error) {
      console.error("Error joining queue:", error);
      toast.error("Failed to join queue");
      setState((prev) => ({ ...prev, isLoading: false, error: "Failed to join queue" }));
    }
  }, [user?.id, eventId, navigate, autoNavigate]);

  // Leave the queue
  const leaveQueue = useCallback(async () => {
    if (!user?.id || !eventId) return;

    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const data = await callVideoMatching("leave_queue", eventId);

      if (data.success) {
        setState((prev) => ({
          ...prev,
          status: "idle",
          roomId: null,
          partnerId: null,
          isLoading: false,
        }));
      } else {
        setState((prev) => ({ ...prev, isLoading: false, error: data.error }));
      }
    } catch (error) {
      console.error("Error leaving queue:", error);
      setState((prev) => ({ ...prev, isLoading: false, error: "Failed to leave queue" }));
    }
  }, [user?.id, eventId]);

  // Poll for matches while searching
  useEffect(() => {
    if (state.status !== "searching" || !user?.id || !eventId) return;

    const pollInterval = setInterval(async () => {
      try {
        const data = await callVideoMatching("find_match", eventId);

        if (data.success && data.matched) {
          clearInterval(pollInterval);
          toast.success("Match found! Starting video date...");
          setState((prev) => ({
            ...prev,
            status: "matched",
            roomId: data.room_id,
            partnerId: data.partner_id,
          }));

          if (autoNavigate) {
            navigate(`/date/${data.room_id}`);
          }
        }
      } catch (error) {
        console.error("Error polling for match:", error);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [state.status, user?.id, eventId, navigate, autoNavigate]);

  // Fetch initial status on mount
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return {
    ...state,
    joinQueue,
    leaveQueue,
    refetchStatus: fetchStatus,
  };
};
