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

          // Only update if this is for our event
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
            navigate(`/video-date?roomId=${newData.current_room_id}&partnerId=${newData.current_partner_id}&eventId=${eventId}`);
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
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) throw new Error("Not authenticated");

      const response = await fetch(
        `https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/video-matching`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.session.access_token}`,
          },
          body: JSON.stringify({ action: "get_status", eventId }),
        }
      );

      const data = await response.json();

      if (data.success) {
        setState((prev) => ({
          ...prev,
          status: data.queue_status || "idle",
          roomId: data.room_id,
          partnerId: data.partner_id,
          datesCompleted: data.dates_completed || 0,
          isLoading: false,
          error: null,
        }));

        // If already matched, auto-navigate
        if (data.queue_status === "matched" && data.room_id && autoNavigate) {
          navigate(`/video-date?roomId=${data.room_id}&partnerId=${data.partner_id}&eventId=${eventId}`);
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
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) throw new Error("Not authenticated");

      const response = await fetch(
        `https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/video-matching`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.session.access_token}`,
          },
          body: JSON.stringify({ action: "join_queue", eventId }),
        }
      );

      const data = await response.json();

      if (data.success && data.matched) {
        // Immediate match found
        toast.success("Match found! Starting video date...");
        setState((prev) => ({
          ...prev,
          status: "matched",
          roomId: data.room_id,
          partnerId: data.partner_id,
          isLoading: false,
        }));

        if (autoNavigate) {
          navigate(`/video-date?roomId=${data.room_id}&partnerId=${data.partner_id}&eventId=${eventId}`);
        }
      } else if (data.waiting) {
        // In queue, waiting for match
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

  // Leave the queue or end the date
  const leaveQueue = useCallback(async () => {
    if (!user?.id || !eventId) return;

    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) throw new Error("Not authenticated");

      const response = await fetch(
        `https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/video-matching`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.session.access_token}`,
          },
          body: JSON.stringify({ action: "leave_queue", eventId }),
        }
      );

      const data = await response.json();

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
        const { data: session } = await supabase.auth.getSession();
        if (!session.session) return;

        const response = await fetch(
          `https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/video-matching`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.session.access_token}`,
            },
            body: JSON.stringify({ action: "find_match", eventId }),
          }
        );

        const data = await response.json();

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
            navigate(`/video-date?roomId=${data.room_id}&partnerId=${data.partner_id}&eventId=${eventId}`);
          }
        }
      } catch (error) {
        console.error("Error polling for match:", error);
      }
    }, 3000); // Poll every 3 seconds

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
