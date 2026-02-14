import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type ParticipantStatus =
  | "browsing"
  | "in_ready_gate"
  | "in_handshake"
  | "in_date"
  | "in_survey"
  | "offline"
  | "idle";

interface UseEventStatusOptions {
  eventId: string | undefined;
  enabled?: boolean;
}

export const useEventStatus = ({ eventId, enabled = true }: UseEventStatusOptions) => {
  const { user } = useAuth();
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [currentStatus, setCurrentStatus] = useState<ParticipantStatus>("idle");

  const setStatus = useCallback(
    async (status: ParticipantStatus) => {
      if (!eventId || !user?.id) return;
      setCurrentStatus(status);

      try {
        await supabase.rpc("update_participant_status", {
          p_event_id: eventId,
          p_user_id: user.id,
          p_status: status,
        });
      } catch (err) {
        console.error("Error updating status:", err);
      }
    },
    [eventId, user?.id]
  );

  // Heartbeat: update last_active_at every 60s
  useEffect(() => {
    if (!enabled || !eventId || !user?.id) return;

    heartbeatRef.current = setInterval(async () => {
      try {
        await supabase
          .from("event_registrations")
          .update({ last_active_at: new Date().toISOString() })
          .eq("event_id", eventId)
          .eq("profile_id", user.id);
      } catch {}
    }, 60000);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [enabled, eventId, user?.id]);

  // Set offline on page unload
  useEffect(() => {
    if (!enabled || !eventId || !user?.id) return;

    const handleBeforeUnload = () => {
      // Use sendBeacon for reliability on page close
      // Include apikey as query param since sendBeacon can't set custom headers
      // update_participant_status is SECURITY DEFINER so anon key is sufficient
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/update_participant_status?apikey=${anonKey}`;
      const body = JSON.stringify({
        p_event_id: eventId,
        p_user_id: user.id,
        p_status: "offline",
      });
      navigator.sendBeacon(
        url,
        new Blob([body], { type: "application/json" })
      );
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [enabled, eventId, user?.id]);

  return { setStatus, currentStatus };
};
