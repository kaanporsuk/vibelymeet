import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { useAuth, useUserProfile } from "@/contexts/AuthContext";
import { recordVideoDateHeartbeatV2 } from "@/lib/videoDateReadiness";

/** Values the client may write via `update_participant_status` (server-owned statuses are excluded). */
export type ClientWritableParticipantStatus =
  | "browsing"
  | "in_survey"
  | "offline"
  | "idle";

/** Includes server-written queue_status values surfaced in UI / reads. */
export type ParticipantStatus =
  | ClientWritableParticipantStatus
  | "in_ready_gate"
  | "in_handshake"
  | "in_date";

interface UseEventStatusOptions {
  eventId: string | undefined;
  enabled?: boolean;
}

export const useEventStatus = ({ eventId, enabled = true }: UseEventStatusOptions) => {
  const { user } = useUserProfile();
  const { session } = useAuth();
  const accessTokenRef = useRef<string | null>(null);
  const enabledRef = useRef(enabled);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [currentStatus, setCurrentStatus] = useState<ParticipantStatus>("idle");

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    accessTokenRef.current = session?.access_token ?? null;
  }, [session?.access_token]);

  const setStatus = useCallback(
    async (status: ClientWritableParticipantStatus) => {
      if (!enabledRef.current) return;
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

  const sendHeartbeatKeepalive = useCallback(
    (foreground: boolean, source: string) => {
      const token = accessTokenRef.current;
      if (!token || !eventId) return;
      const url = `${SUPABASE_URL}/rest/v1/rpc/record_heartbeat_v2`;
      void fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          apikey: SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          p_event_id: eventId,
          p_foreground: foreground,
          p_client_platform: "web",
        }),
        keepalive: true,
      }).catch(() => {
        if (import.meta.env.DEV) console.warn("[useEventStatus] heartbeat keepalive failed", source);
      });
    },
    [eventId],
  );

  const sendForegroundHeartbeat = useCallback(
    (foreground: boolean, source: string) => {
      if (!enabledRef.current || !eventId || !user?.id) return;
      if (source === "pagehide" || source === "freeze" || source === "beforeunload") {
        sendHeartbeatKeepalive(foreground, source);
        return;
      }
      void recordVideoDateHeartbeatV2(eventId, {
        foreground,
        clientPlatform: "web",
      }).catch(() => {});
    },
    [eventId, sendHeartbeatKeepalive, user?.id],
  );

  // Heartbeat: update activity only. Timestamp is server-stamped by RPC.
  useEffect(() => {
    if (!enabled || !eventId || !user?.id) return;

    heartbeatRef.current = setInterval(async () => {
      try {
        await recordVideoDateHeartbeatV2(eventId, {
          foreground: typeof document === "undefined" || document.visibilityState === "visible",
          clientPlatform: "web",
        });
      } catch {}
    }, 30000);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [enabled, eventId, user?.id]);

  useEffect(() => {
    if (!enabled || !eventId || !user?.id) return;
    if (typeof document === "undefined" || typeof window === "undefined") return;

    const markCurrentVisibility = (source: string) => {
      sendForegroundHeartbeat(document.visibilityState === "visible", source);
    };
    const markForeground = (source: string) => sendForegroundHeartbeat(true, source);
    const markBackground = (source: string) => sendForegroundHeartbeat(false, source);

    markCurrentVisibility("mount");
    const handleVisibilityChange = () => markCurrentVisibility("visibilitychange");
    const handleFocus = () => markForeground("focus");
    const handleOnline = () => markForeground("online");
    const handlePageHide = () => markBackground("pagehide");
    const handleFreeze = () => markBackground("freeze");

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("freeze", handleFreeze);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("freeze", handleFreeze);
    };
  }, [enabled, eventId, sendForegroundHeartbeat, user?.id]);

  // Set offline on page unload
  useEffect(() => {
    if (!enabled || !eventId || !user?.id) return;

    const handleBeforeUnload = () => {
      sendForegroundHeartbeat(false, "beforeunload");
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
  }, [enabled, eventId, sendForegroundHeartbeat, user?.id]);

  return { setStatus, currentStatus };
};
