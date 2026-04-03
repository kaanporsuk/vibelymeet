import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { useAuth, useUserProfile } from "@/contexts/AuthContext";

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
  const { user } = useUserProfile();
  const { session } = useAuth();
  const accessTokenRef = useRef<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [currentStatus, setCurrentStatus] = useState<ParticipantStatus>("idle");

  useEffect(() => {
    accessTokenRef.current = session?.access_token ?? null;
  }, [session?.access_token]);

  const setStatus = useCallback(
    async (status: ParticipantStatus) => {
      if (!eventId || !user?.id) return;
      setCurrentStatus(status);

      try {
        await supabase.rpc("update_participant_status", {
          p_event_id: eventId,
          p_status: status,
        });
      } catch (err) {
        console.error("Error updating status:", err);
      }
    },
    [eventId, user?.id]
  );

  // Heartbeat: update activity only. Lobby foreground proof is stamped by lobby-only lifecycle signals.
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
    }, 30000);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [enabled, eventId, user?.id]);

  // Set offline on page unload
  useEffect(() => {
    if (!enabled || !eventId || !user?.id) return;

    const handleBeforeUnload = () => {
      const token = accessTokenRef.current;
      if (!token) return;
      const url = `${SUPABASE_URL}/rest/v1/rpc/update_participant_status`;
      void fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          apikey: SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          p_event_id: eventId,
          p_status: "offline",
        }),
        keepalive: true,
      }).catch(() => {});
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [enabled, eventId, user?.id]);

  return { setStatus, currentStatus };
};
