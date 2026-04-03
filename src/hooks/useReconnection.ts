import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { trackEvent } from "@/lib/analytics";

export type VideoDatePhase = "handshake" | "date" | "ended";

interface UseReconnectionOptions {
  sessionId: string | undefined;
  isConnected: boolean;
  phase: VideoDatePhase;
  onReconnected?: () => void;
  /** Fired when server ends session due to reconnect grace expiry only */
  onGraceExpired?: () => void;
}

type SyncPayload = {
  reconnect_grace_ends_at: string | null;
  ended: boolean;
  ended_reason: string | null;
  partner_marked_away: boolean;
};

export const useReconnection = ({
  sessionId,
  isConnected,
  phase,
  onReconnected,
  onGraceExpired,
}: UseReconnectionOptions) => {
  const { user } = useUserProfile();
  const [graceTimeLeft, setGraceTimeLeft] = useState(0);
  /** True when Daily reports partner left or server marks partner away */
  const [inReconnectGraceUi, setInReconnectGraceUi] = useState(false);
  /** After we've had at least one Daily connected state (used for partner-away RPC + reconnect return). */
  const hadConnectedOnceRef = useRef(false);
  const prevIsConnectedRef = useRef(false);
  const onGraceExpiredRef = useRef(onGraceExpired);
  const onReconnectedRef = useRef(onReconnected);
  const graceExpiredFiredRef = useRef(false);
  const graceWindowStartedRef = useRef(false);

  useEffect(() => {
    onGraceExpiredRef.current = onGraceExpired;
    onReconnectedRef.current = onReconnected;
  }, [onGraceExpired, onReconnected]);

  const fetchSync = useCallback(async (): Promise<SyncPayload | null> => {
    if (!sessionId) return null;
    const { data, error } = await supabase.rpc("video_date_transition", {
      p_session_id: sessionId,
      p_action: "sync_reconnect",
    });
    if (error) return null;
    const p = data as {
      success?: boolean;
      reconnect_grace_ends_at?: string | null;
      ended?: boolean;
      ended_reason?: string | null;
      partner_marked_away?: boolean;
    } | null;
    return {
      reconnect_grace_ends_at: p?.reconnect_grace_ends_at ?? null,
      ended: p?.ended === true,
      ended_reason: p?.ended_reason ?? null,
      partner_marked_away: p?.partner_marked_away === true,
    };
  }, [sessionId]);

  // Server-owned grace: poll sync_reconnect (applies lazy expiry on server)
  useEffect(() => {
    if (!sessionId || phase === "ended") return;

    let cancelled = false;

    const tick = async () => {
      const r = await fetchSync();
      if (cancelled || !r) return;

      if (r.ended) {
        if (r.ended_reason === "reconnect_grace_expired" && !graceExpiredFiredRef.current) {
          graceExpiredFiredRef.current = true;
          if (graceWindowStartedRef.current) {
            trackEvent("video_date_reconnect_grace_expired", {
              session_id: sessionId,
              phase,
            });
            graceWindowStartedRef.current = false;
          }
          onGraceExpiredRef.current?.();
        }
        setInReconnectGraceUi(false);
        setGraceTimeLeft(0);
        return;
      }

      graceExpiredFiredRef.current = false;

      const hasGrace = !!r.reconnect_grace_ends_at;
      const show = hasGrace && r.partner_marked_away;
      setInReconnectGraceUi(show);

      if (hasGrace && r.reconnect_grace_ends_at) {
        const sec = Math.max(
          0,
          Math.ceil((new Date(r.reconnect_grace_ends_at).getTime() - Date.now()) / 1000),
        );
        setGraceTimeLeft(sec);
      } else {
        setGraceTimeLeft(0);
      }
    };

    void tick();
    const iv = setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [sessionId, phase, fetchSync]);

  useEffect(() => {
    const prev = prevIsConnectedRef.current;
    prevIsConnectedRef.current = isConnected;

    if (!isConnected) {
      return;
    }

    if (!hadConnectedOnceRef.current) {
      hadConnectedOnceRef.current = true;
      return;
    }

    // Disconnected → connected again: clear our away slot (partner may have reported us while we were gone).
    if (!prev && sessionId && phase !== "ended") {
      if (graceWindowStartedRef.current) {
        trackEvent("video_date_reconnect_returned", {
          session_id: sessionId,
          phase,
        });
        graceWindowStartedRef.current = false;
      }
      void supabase.rpc("video_date_transition", {
        p_session_id: sessionId,
        p_action: "mark_reconnect_return",
      });
      setInReconnectGraceUi(false);
      onReconnectedRef.current?.();
    }
  }, [isConnected, sessionId, phase]);

  const startGraceWindow = useCallback(() => {
    if (!hadConnectedOnceRef.current || !sessionId || phase === "ended") return;
    if (graceWindowStartedRef.current) return;

    graceWindowStartedRef.current = true;
    setInReconnectGraceUi(true);
    trackEvent("video_date_reconnect_grace_started", {
      session_id: sessionId,
      phase,
    });

    void supabase.rpc("video_date_transition", {
      p_session_id: sessionId,
      p_action: "mark_reconnect_partner_away",
    });
  }, [sessionId, phase]);

  const checkActiveSession = useCallback(async (): Promise<{
    hasActiveSession: boolean;
    sessionId?: string;
    eventId?: string;
  }> => {
    if (!user?.id) return { hasActiveSession: false };

    const { data: reg } = await supabase
      .from("event_registrations")
      .select("event_id, current_room_id, queue_status")
      .eq("profile_id", user.id)
      .in("queue_status", ["in_handshake", "in_date"])
      .maybeSingle();

    if (reg?.current_room_id) {
      const { data: session } = await supabase
        .from("video_sessions")
        .select("id, ended_at")
        .eq("id", reg.current_room_id)
        .is("ended_at", null)
        .maybeSingle();

      if (session) {
        return {
          hasActiveSession: true,
          sessionId: session.id,
          eventId: reg.event_id,
        };
      }
    }

    return { hasActiveSession: false };
  }, [user?.id]);

  const isPartnerDisconnected = inReconnectGraceUi;
  const isTimerPaused = inReconnectGraceUi;

  return {
    isPartnerDisconnected,
    graceTimeLeft,
    isTimerPaused,
    startGraceWindow,
    checkActiveSession,
  };
};
