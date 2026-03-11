import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";

interface UseReconnectionOptions {
  sessionId: string | undefined;
  eventId: string | undefined;
  isConnected: boolean;
  onReconnected?: () => void;
  onGraceExpired?: () => void;
}

export const useReconnection = ({
  sessionId,
  eventId,
  isConnected,
  onReconnected,
  onGraceExpired,
}: UseReconnectionOptions) => {
  const { user } = useUserProfile();
  const [isPartnerDisconnected, setIsPartnerDisconnected] = useState(false);
  const [graceTimeLeft, setGraceTimeLeft] = useState(60);
  const [isTimerPaused, setIsTimerPaused] = useState(false);
  const graceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasConnectedRef = useRef(false);

  // Track connection state changes for partner disconnect detection
  useEffect(() => {
    if (isConnected) {
      if (wasConnectedRef.current && isPartnerDisconnected) {
        // Partner reconnected!
        setIsPartnerDisconnected(false);
        setIsTimerPaused(false);
        setGraceTimeLeft(60);
        if (graceTimerRef.current) {
          clearInterval(graceTimerRef.current);
          graceTimerRef.current = null;
        }
        onReconnected?.();
      }
      wasConnectedRef.current = true;
    }
  }, [isConnected, isPartnerDisconnected, onReconnected]);

  // Start grace window when partner disconnects
  const startGraceWindow = useCallback(() => {
    if (!wasConnectedRef.current) return; // Never was connected

    setIsPartnerDisconnected(true);
    setIsTimerPaused(true);
    setGraceTimeLeft(60);

    if (graceTimerRef.current) clearInterval(graceTimerRef.current);

    graceTimerRef.current = setInterval(() => {
      setGraceTimeLeft((prev) => {
        if (prev <= 1) {
          if (graceTimerRef.current) clearInterval(graceTimerRef.current);
          graceTimerRef.current = null;
          onGraceExpired?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [onGraceExpired]);

  // Check for active session on mount (for reconnection after browser close)
  const checkActiveSession = useCallback(async (): Promise<{
    hasActiveSession: boolean;
    sessionId?: string;
    eventId?: string;
  }> => {
    if (!user?.id) return { hasActiveSession: false };

    // Check if user has an active registration with in_handshake or in_date status
    const { data: reg } = await supabase
      .from("event_registrations")
      .select("event_id, current_room_id, queue_status")
      .eq("profile_id", user.id)
      .in("queue_status", ["in_handshake", "in_date"])
      .maybeSingle();

    if (reg?.current_room_id) {
      // Verify the video session is still active (not ended)
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (graceTimerRef.current) clearInterval(graceTimerRef.current);
    };
  }, []);

  return {
    isPartnerDisconnected,
    graceTimeLeft,
    isTimerPaused,
    startGraceWindow,
    checkActiveSession,
  };
};
