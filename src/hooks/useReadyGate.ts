import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { ReadyGateStatus } from "@/domain/enums";

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

const TERMINAL_READY_GATE_STATUSES = [
  ReadyGateStatus.BothReady,
  ReadyGateStatus.Forfeited,
  ReadyGateStatus.Expired,
] as const;

type TerminalReadyGateStatus = (typeof TERMINAL_READY_GATE_STATUSES)[number];

type ReadyGateRealtimeRow = {
  participant_1_id: string;
  participant_2_id: string;
  ready_gate_status: ReadyGateStatus;
  ready_participant_1_at: string | null;
  ready_participant_2_at: string | null;
  ready_gate_expires_at: string | null;
  snoozed_by: string | null;
  snooze_expires_at: string | null;
};

const TERMINAL_READY_GATE_STATUS_VALUES: readonly ReadyGateStatus[] = TERMINAL_READY_GATE_STATUSES;

function isTerminalReadyGateStatus(status: ReadyGateStatus): status is TerminalReadyGateStatus {
  return TERMINAL_READY_GATE_STATUS_VALUES.includes(status);
}

function readyGateDebug(message: string, data?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  console.log(`[useReadyGate] ${message}`, data ?? {});
}

export const useReadyGate = ({ sessionId, onBothReady, onForfeited }: UseReadyGateOptions) => {
  const { user } = useUserProfile();
  const [state, setState] = useState<ReadyGateState>({
    status: ReadyGateStatus.Queued,
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
  const terminalHandledRef = useRef<ReadyGateStatus | null>(null);

  useEffect(() => {
    onBothReadyRef.current = onBothReady;
    onForfeitedRef.current = onForfeited;
  }, [onBothReady, onForfeited]);

  useEffect(() => {
    terminalHandledRef.current = null;
  }, [sessionId]);

  const notifyTerminal = useCallback((status: TerminalReadyGateStatus) => {
    if (terminalHandledRef.current === status) return;
    terminalHandledRef.current = status;
    readyGateDebug("terminal status notification", { sessionId, status });
    if (status === ReadyGateStatus.BothReady) {
      onBothReadyRef.current();
      return;
    }
    if (status === ReadyGateStatus.Forfeited || status === ReadyGateStatus.Expired) {
      onForfeitedRef.current("timeout");
    }
  }, [sessionId]);

  const fetchSession = useCallback(async () => {
      if (!sessionId || !user?.id) return;

      const { data: session } = await supabase
        .from("video_sessions")
        .select("participant_1_id, participant_2_id, ready_gate_status, ready_participant_1_at, ready_participant_2_at, ready_gate_expires_at, snoozed_by, snooze_expires_at")
        .eq("id", sessionId)
        .maybeSingle();

      if (!session) return;

      const isP1 = session.participant_1_id === user.id;
      setIsParticipant1(isP1);

      const partnerId = isP1 ? session.participant_2_id : session.participant_1_id;

      // Fetch partner name through the privacy-aware profile RPC.
      const { data: profile } = await supabase.rpc("get_profile_for_viewer", {
        p_target_id: partnerId,
      });
      const partnerProfile = profile as { name?: string | null } | null;

      const myReadyAt = isP1 ? session.ready_participant_1_at : session.ready_participant_2_at;
      const partnerReadyAt = isP1 ? session.ready_participant_2_at : session.ready_participant_1_at;

      setState({
        status: session.ready_gate_status as ReadyGateStatus,
        iAmReady: !!myReadyAt,
        partnerReady: !!partnerReadyAt,
        partnerName: partnerProfile?.name || "Your match",
        snoozedByPartner: session.snoozed_by !== null && session.snoozed_by !== user.id,
        snoozeExpiresAt: session.snooze_expires_at,
        expiresAt: session.ready_gate_expires_at,
      });

      const nextStatus = session.ready_gate_status as ReadyGateStatus;
      if (isTerminalReadyGateStatus(nextStatus)) {
        notifyTerminal(nextStatus);
      } else {
        terminalHandledRef.current = null;
      }
  }, [sessionId, user?.id, notifyTerminal]);

  // Fetch initial state and determine participant position
  useEffect(() => {
    if (!sessionId || !user?.id) return;

    void fetchSession();
  }, [sessionId, user?.id, fetchSession]);

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
          const s = payload.new as ReadyGateRealtimeRow;
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

          const nextStatus = s.ready_gate_status as ReadyGateStatus;
          if (isTerminalReadyGateStatus(nextStatus)) {
            notifyTerminal(nextStatus);
          } else {
            terminalHandledRef.current = null;
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, user?.id, notifyTerminal]);

  // Periodic refresh is owned by ReadyGateOverlay.reconcileSession("poll") + refetchSession(),
  // so we avoid duplicate 2s timers alongside the overlay reconcile loop.

  // Mark self as ready (server-owned transition)
  const markReady = useCallback(async () => {
    if (!sessionId || !user?.id) return;

    await supabase.rpc("ready_gate_transition", {
      p_session_id: sessionId,
      p_action: "mark_ready",
    });
  }, [sessionId, user?.id]);

  // Skip — forfeit (server-owned transition)
  const skip = useCallback(async () => {
    if (!sessionId) return;

    await supabase.rpc("ready_gate_transition", {
      p_session_id: sessionId,
      p_action: "forfeit",
    });
  }, [sessionId]);

  // Snooze — request 2 more minutes (server-owned transition)
  const snooze = useCallback(async () => {
    if (!sessionId || !user?.id) return;

    await supabase.rpc("ready_gate_transition", {
      p_session_id: sessionId,
      p_action: "snooze",
    });
  }, [sessionId, user?.id]);

  return {
    ...state,
    isSnoozed: state.status === ReadyGateStatus.Snoozed,
    markReady,
    skip,
    snooze,
    /** Refresh gate UI from `video_sessions` (called by ReadyGateOverlay after reconcile poll). */
    refetchSession: fetchSession,
  };
};
