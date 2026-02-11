import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type ReadyGateStatus =
  | "waiting"
  | "ready_a"
  | "ready_b"
  | "both_ready"
  | "forfeited"
  | "snoozed";

interface ReadyGateState {
  status: ReadyGateStatus;
  iAmReady: boolean;
  partnerReady: boolean;
  partnerName: string | null;
  snoozedByPartner: boolean;
  snoozeExpiresAt: string | null;
  expiresAt: string | null;
}

interface UseReadyGateOptions {
  sessionId: string;
  onBothReady: () => void;
  onForfeited: (reason: "timeout" | "skip") => void;
}

export const useReadyGate = ({ sessionId, onBothReady, onForfeited }: UseReadyGateOptions) => {
  const { user } = useAuth();
  const [state, setState] = useState<ReadyGateState>({
    status: "waiting",
    iAmReady: false,
    partnerReady: false,
    partnerName: null,
    snoozedByPartner: false,
    snoozeExpiresAt: null,
    expiresAt: null,
  });
  const [isParticipant1, setIsParticipant1] = useState(false);
  const onBothReadyRef = useRef(onBothReady);
  const onForfeitedRef = useRef(onForfeited);

  useEffect(() => {
    onBothReadyRef.current = onBothReady;
    onForfeitedRef.current = onForfeited;
  }, [onBothReady, onForfeited]);

  // Fetch initial state and determine participant position
  useEffect(() => {
    if (!sessionId || !user?.id) return;

    const fetchSession = async () => {
      const { data: session } = await supabase
        .from("video_sessions")
        .select("participant_1_id, participant_2_id, ready_gate_status, ready_participant_1_at, ready_participant_2_at, ready_gate_expires_at, snoozed_by, snooze_expires_at")
        .eq("id", sessionId)
        .maybeSingle();

      if (!session) return;

      const isP1 = session.participant_1_id === user.id;
      setIsParticipant1(isP1);

      const partnerId = isP1 ? session.participant_2_id : session.participant_1_id;

      // Fetch partner name
      const { data: profile } = await supabase
        .from("profiles")
        .select("name")
        .eq("id", partnerId)
        .maybeSingle();

      const myReadyAt = isP1 ? session.ready_participant_1_at : session.ready_participant_2_at;
      const partnerReadyAt = isP1 ? session.ready_participant_2_at : session.ready_participant_1_at;

      setState({
        status: session.ready_gate_status as ReadyGateStatus,
        iAmReady: !!myReadyAt,
        partnerReady: !!partnerReadyAt,
        partnerName: profile?.name || "Your match",
        snoozedByPartner: session.snoozed_by !== null && session.snoozed_by !== user.id,
        snoozeExpiresAt: session.snooze_expires_at,
        expiresAt: session.ready_gate_expires_at,
      });

      if (session.ready_gate_status === "both_ready") {
        onBothReadyRef.current();
      } else if (session.ready_gate_status === "forfeited") {
        onForfeitedRef.current("timeout");
      }
    };

    fetchSession();
  }, [sessionId, user?.id]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!sessionId || !user?.id) return;

    const channel = supabase
      .channel(`ready-gate-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "video_sessions",
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          const s = payload.new as any;
          const isP1 = s.participant_1_id === user.id;
          const myReadyAt = isP1 ? s.ready_participant_1_at : s.ready_participant_2_at;
          const partnerReadyAt = isP1 ? s.ready_participant_2_at : s.ready_participant_1_at;

          setState((prev) => ({
            ...prev,
            status: s.ready_gate_status as ReadyGateStatus,
            iAmReady: !!myReadyAt,
            partnerReady: !!partnerReadyAt,
            snoozedByPartner: s.snoozed_by !== null && s.snoozed_by !== user.id,
            snoozeExpiresAt: s.snooze_expires_at,
            expiresAt: s.ready_gate_expires_at,
          }));

          if (s.ready_gate_status === "both_ready") {
            onBothReadyRef.current();
          } else if (s.ready_gate_status === "forfeited") {
            onForfeitedRef.current("timeout");
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, user?.id]);

  // Mark self as ready
  const markReady = useCallback(async () => {
    if (!sessionId || !user?.id) return;

    const readyField = isParticipant1 ? "ready_participant_1_at" : "ready_participant_2_at";

    // First update my ready timestamp
    await supabase
      .from("video_sessions")
      .update({ [readyField]: new Date().toISOString() })
      .eq("id", sessionId);

    // Now check if both are ready
    const { data: session } = await supabase
      .from("video_sessions")
      .select("ready_participant_1_at, ready_participant_2_at")
      .eq("id", sessionId)
      .maybeSingle();

    if (session?.ready_participant_1_at && session?.ready_participant_2_at) {
      await supabase
        .from("video_sessions")
        .update({ ready_gate_status: "both_ready" })
        .eq("id", sessionId);
    } else {
      // Update status to show one is ready
      const newStatus = isParticipant1 ? "ready_a" : "ready_b";
      await supabase
        .from("video_sessions")
        .update({ ready_gate_status: newStatus })
        .eq("id", sessionId);
    }

    setState((prev) => ({ ...prev, iAmReady: true }));
  }, [sessionId, user?.id, isParticipant1]);

  // Skip — forfeit
  const skip = useCallback(async () => {
    if (!sessionId) return;

    await supabase
      .from("video_sessions")
      .update({ ready_gate_status: "forfeited" })
      .eq("id", sessionId);
  }, [sessionId]);

  // Snooze — request 2 more minutes
  const snooze = useCallback(async () => {
    if (!sessionId || !user?.id) return;

    const snoozeExpires = new Date(Date.now() + 2 * 60 * 1000).toISOString();

    await supabase
      .from("video_sessions")
      .update({
        ready_gate_status: "snoozed",
        snoozed_by: user.id,
        snooze_expires_at: snoozeExpires,
      })
      .eq("id", sessionId);
  }, [sessionId, user?.id]);

  return {
    ...state,
    markReady,
    skip,
    snooze,
  };
};
