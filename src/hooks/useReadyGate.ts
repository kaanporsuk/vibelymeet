import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { ReadyGateStatus } from "@/domain/enums";
import { trackEvent } from "@/lib/analytics";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  EventLobbyObservabilityEvents,
  sanitizeReasonCode,
} from "@clientShared/observability/eventLobbyObservability";

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
  eventId?: string | null;
  onBothReady: () => void;
  onForfeited: (reason: "timeout" | "skip", detail?: ReadyGateTerminalDetail) => void;
}

type ReadyGateTerminalDetail = {
  status?: ReadyGateStatus | string | null;
  reason?: string | null;
  inactiveReason?: string | null;
  errorCode?: string | null;
  code?: string | null;
  terminal?: boolean | null;
};

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

type ReadyGateSessionTruth = {
  participant_1_id?: string | null;
  participant_2_id?: string | null;
  ready_gate_status?: ReadyGateStatus | string | null;
  status?: ReadyGateStatus | string | null;
  ready_participant_1_at?: string | null;
  ready_participant_2_at?: string | null;
  ready_gate_expires_at?: string | null;
  snoozed_by?: string | null;
  snooze_expires_at?: string | null;
  reason?: string | null;
  inactive_reason?: string | null;
  error_code?: string | null;
  code?: string | null;
  terminal?: boolean | null;
};

type ReadyGateSyncResult =
  | {
      ok: true;
      status: ReadyGateStatus;
      isTerminal: boolean;
      expiresAt: string | null;
      reason?: string | null;
      inactiveReason?: string | null;
      errorCode?: string | null;
      code?: string | null;
      terminal?: boolean | null;
    }
  | {
      ok: false;
      error: string;
      status?: ReadyGateStatus | null;
      reason?: string | null;
      inactiveReason?: string | null;
      errorCode?: string | null;
      code?: string | null;
      isTerminal?: boolean;
      terminal?: boolean | null;
    };

type ReadyGateTransitionResult = ReadyGateSyncResult;

const READY_GATE_STATUS_VALUES = Object.values(ReadyGateStatus) as ReadyGateStatus[];
const TERMINAL_READY_GATE_STATUS_VALUES: readonly ReadyGateStatus[] = TERMINAL_READY_GATE_STATUSES;
type ReadyGateTransitionAction = "mark_ready" | "forfeit" | "snooze" | "sync";

function isTerminalReadyGateStatus(status: ReadyGateStatus): status is TerminalReadyGateStatus {
  return TERMINAL_READY_GATE_STATUS_VALUES.includes(status);
}

function normalizeReadyGateStatus(value: unknown): ReadyGateStatus {
  return READY_GATE_STATUS_VALUES.includes(value as ReadyGateStatus)
    ? (value as ReadyGateStatus)
    : ReadyGateStatus.Queued;
}

function normalizeReadyGateTimestamp(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readyGateDebug(message: string, data?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  console.log(`[useReadyGate] ${message}`, data ?? {});
}

export const useReadyGate = ({ sessionId, eventId, onBothReady, onForfeited }: UseReadyGateOptions) => {
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
  const onBothReadyRef = useRef(onBothReady);
  const onForfeitedRef = useRef(onForfeited);
  const terminalHandledRef = useRef<ReadyGateStatus | null>(null);
  const participantPositionRef = useRef<"p1" | "p2" | null>(null);
  const syncSessionInFlightRef = useRef<Promise<ReadyGateSyncResult> | null>(null);

  useEffect(() => {
    onBothReadyRef.current = onBothReady;
    onForfeitedRef.current = onForfeited;
  }, [onBothReady, onForfeited]);

  useEffect(() => {
    terminalHandledRef.current = null;
    participantPositionRef.current = null;
    syncSessionInFlightRef.current = null;
  }, [sessionId]);

  const notifyTerminal = useCallback((status: TerminalReadyGateStatus, detail?: ReadyGateTerminalDetail) => {
    if (terminalHandledRef.current === status) return;
    terminalHandledRef.current = status;
    readyGateDebug("terminal status notification", { sessionId, status });
    if (status === ReadyGateStatus.BothReady) {
      onBothReadyRef.current();
      return;
    }
    if (status === ReadyGateStatus.Forfeited || status === ReadyGateStatus.Expired) {
      onForfeitedRef.current(status === ReadyGateStatus.Expired ? "timeout" : "skip", {
        status,
        ...detail,
      });
    }
  }, [sessionId]);

  const applyReadyGateTruth = useCallback((
    truth: ReadyGateSessionTruth,
    options?: { partnerName?: string | null },
  ): ReadyGateSyncResult => {
    const nextStatus = normalizeReadyGateStatus(truth.ready_gate_status ?? truth.status);
    const p1 = typeof truth.participant_1_id === "string" ? truth.participant_1_id : null;
    const p2 = typeof truth.participant_2_id === "string" ? truth.participant_2_id : null;

    if (user?.id && p1 && p2) {
      if (p1 === user.id) {
        participantPositionRef.current = "p1";
      } else if (p2 === user.id) {
        participantPositionRef.current = "p2";
      }
    }

    const position = participantPositionRef.current;
    const hasParticipantPosition = position === "p1" || position === "p2";
    const myReadyAt = position === "p1" ? truth.ready_participant_1_at : truth.ready_participant_2_at;
    const partnerReadyAt = position === "p1" ? truth.ready_participant_2_at : truth.ready_participant_1_at;
    const hasSnoozedBy = Object.prototype.hasOwnProperty.call(truth, "snoozed_by");
    const hasSnoozeExpiresAt = Object.prototype.hasOwnProperty.call(truth, "snooze_expires_at");
    const hasReadyGateExpiresAt = Object.prototype.hasOwnProperty.call(truth, "ready_gate_expires_at");
    const expiresAt = normalizeReadyGateTimestamp(truth.ready_gate_expires_at);

    setState((prev) => ({
      status: nextStatus,
      iAmReady: hasParticipantPosition ? !!myReadyAt : prev.iAmReady,
      partnerReady: hasParticipantPosition ? !!partnerReadyAt : prev.partnerReady,
      partnerName: options?.partnerName ?? prev.partnerName,
      snoozedByPartner: hasSnoozedBy
        ? typeof truth.snoozed_by === "string" && truth.snoozed_by !== user?.id
        : prev.snoozedByPartner,
      snoozeExpiresAt: hasSnoozeExpiresAt
        ? normalizeReadyGateTimestamp(truth.snooze_expires_at)
        : prev.snoozeExpiresAt,
      expiresAt: hasReadyGateExpiresAt ? expiresAt : prev.expiresAt,
    }));

    if (isTerminalReadyGateStatus(nextStatus)) {
      notifyTerminal(nextStatus, {
        status: nextStatus,
        reason: truth.reason ?? null,
        inactiveReason: truth.inactive_reason ?? null,
        errorCode: truth.error_code ?? truth.code ?? null,
        code: truth.code ?? null,
        terminal: truth.terminal ?? null,
      });
    } else {
      terminalHandledRef.current = null;
    }

    return {
      ok: true,
      status: nextStatus,
      isTerminal: isTerminalReadyGateStatus(nextStatus),
      expiresAt,
      reason: truth.reason ?? null,
      inactiveReason: truth.inactive_reason ?? null,
      errorCode: truth.error_code ?? truth.code ?? null,
      code: truth.code ?? null,
      terminal: truth.terminal ?? null,
    };
  }, [notifyTerminal, user?.id]);

  const fetchSession = useCallback(async () => {
      if (!sessionId || !user?.id) return;

      const { data: session } = await supabase
        .from("video_sessions")
        .select("participant_1_id, participant_2_id, ready_gate_status, ready_participant_1_at, ready_participant_2_at, ready_gate_expires_at, snoozed_by, snooze_expires_at")
        .eq("id", sessionId)
        .maybeSingle();

      if (!session) return;

      const isP1 = session.participant_1_id === user.id;
      const partnerId = isP1 ? session.participant_2_id : session.participant_1_id;

      // Fetch partner name through the privacy-aware profile RPC.
      const { data: profile } = await supabase.rpc("get_profile_for_viewer", {
        p_target_id: partnerId,
      });
      const partnerProfile = profile as { name?: string | null } | null;

      applyReadyGateTruth(session as ReadyGateSessionTruth, {
        partnerName: partnerProfile?.name || "Your match",
      });
  }, [sessionId, user?.id, applyReadyGateTruth]);

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
          applyReadyGateTruth(s);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, user?.id, applyReadyGateTruth]);

  // Periodic refresh is owned by ReadyGateOverlay.reconcileSession("poll") + refetchSession(),
  // so we avoid duplicate 2s timers alongside the overlay reconcile loop.

  const runReadyGateTransition = useCallback(async (
    action: ReadyGateTransitionAction,
  ): Promise<ReadyGateTransitionResult> => {
    if (!sessionId || !user?.id) {
      return {
        ok: false,
        error: "missing_session_or_user",
        terminal: false,
      };
    }

    const startedAt = Date.now();
    // Static smoke contract: terminal actions still await
    // const { error } = await supabase.rpc("ready_gate_transition" before closing.
    const transitionResult = await supabase.rpc("ready_gate_transition", {
      p_session_id: sessionId,
      p_action: action,
    });
    const { error } = transitionResult;
    const data = transitionResult.data;
    if (error) {
      const reason = sanitizeReasonCode(error.code ?? "rpc_error", "rpc_error");
      readyGateDebug(`${action} transition failed`, {
        sessionId,
        code: error.code ?? null,
        message: error.message,
      });
      trackEvent(EventLobbyObservabilityEvents.READY_GATE_TRANSITION, {
        platform: "web",
        event_id: eventId ?? null,
        session_id: sessionId,
        action,
        outcome: "rpc_error",
        reason,
        ready_gate_status: null,
        terminal: false,
        latency_ms: Date.now() - startedAt,
        source_surface: "use_ready_gate",
      });
      trackEvent(LobbyPostDateEvents.READY_GATE_CLIENT_TRANSITION_FAILURE, {
        platform: "web",
        session_id: sessionId,
        action,
        source_surface: "use_ready_gate",
        error_code: error.code ?? null,
        reason: "rpc_error",
        latency_ms: Date.now() - startedAt,
      });
      return {
        ok: false,
        error: error.message,
        errorCode: error.code ?? null,
        terminal: false,
      };
    }
    const payload = data && typeof data === "object" && !Array.isArray(data)
      ? (data as ReadyGateSessionTruth & { success?: boolean; error?: string | null })
      : null;
    if (payload) {
      const result = applyReadyGateTruth({
        ...payload,
        ready_gate_status: payload.status ?? payload.ready_gate_status,
      });
      const errorCode = payload.error_code ?? payload.code ?? null;
      const transitionStatus = result.ok === true ? result.status : normalizeReadyGateStatus(payload.status ?? payload.ready_gate_status);
      const transitionTerminal = result.ok === true ? result.isTerminal : isTerminalReadyGateStatus(transitionStatus);
      const reason = sanitizeReasonCode(
        payload.reason ?? payload.error ?? errorCode ?? transitionStatus ?? action,
        action,
      );
      if (payload.success === false) {
        if (errorCode === "EVENT_NOT_ACTIVE" || payload.reason === "event_not_active") {
          notifyTerminal(ReadyGateStatus.Expired, {
            status: payload.status ?? payload.ready_gate_status ?? ReadyGateStatus.Expired,
            reason: payload.reason ?? payload.error ?? "event_not_active",
            inactiveReason: payload.inactive_reason ?? null,
            errorCode,
            terminal: true,
          });
        }
        trackEvent(EventLobbyObservabilityEvents.READY_GATE_TRANSITION, {
          platform: "web",
          event_id: eventId ?? null,
          session_id: sessionId,
          action,
          outcome: "rejected",
          reason,
          ready_gate_status: transitionStatus,
          terminal: payload.terminal === true || transitionTerminal || errorCode === "EVENT_NOT_ACTIVE",
          latency_ms: Date.now() - startedAt,
          source_surface: "use_ready_gate",
        });
        trackEvent(LobbyPostDateEvents.READY_GATE_CLIENT_TRANSITION_FAILURE, {
          platform: "web",
          session_id: sessionId,
          action,
          source_surface: "use_ready_gate",
          ready_gate_status: transitionStatus,
          reason: payload.reason ?? payload.error ?? null,
          error_code: payload.error_code ?? payload.code ?? null,
          inactive_reason: payload.inactive_reason ?? null,
          terminal: payload.terminal === true || transitionTerminal || errorCode === "EVENT_NOT_ACTIVE",
          latency_ms: Date.now() - startedAt,
        });
        const terminal = payload.terminal === true || transitionTerminal || errorCode === "EVENT_NOT_ACTIVE";
        if (terminal) {
          return {
            ok: true,
            status: transitionStatus,
            isTerminal: true,
            expiresAt: result.ok === true ? result.expiresAt : null,
            reason: payload.reason ?? payload.error ?? null,
            inactiveReason: payload.inactive_reason ?? null,
            errorCode,
            code: payload.code ?? null,
            terminal: true,
          };
        }
        return {
          ok: false,
          error: payload.error ?? "ready_gate_transition_rejected",
          status: transitionStatus,
          reason: payload.reason ?? null,
          inactiveReason: payload.inactive_reason ?? null,
          errorCode,
          code: payload.code ?? null,
          isTerminal: false,
          terminal: false,
        };
      }
      trackEvent(EventLobbyObservabilityEvents.READY_GATE_TRANSITION, {
        platform: "web",
        event_id: eventId ?? null,
        session_id: sessionId,
        action,
        outcome: transitionTerminal ? "terminal" : "success",
        reason,
        ready_gate_status: transitionStatus,
        terminal: payload.terminal === true || transitionTerminal,
        latency_ms: Date.now() - startedAt,
        source_surface: "use_ready_gate",
      });
      return result;
    }

    trackEvent(EventLobbyObservabilityEvents.READY_GATE_TRANSITION, {
      platform: "web",
      event_id: eventId ?? null,
      session_id: sessionId,
      action,
      outcome: "success",
      reason: action,
      ready_gate_status: null,
      terminal: false,
      latency_ms: Date.now() - startedAt,
      source_surface: "use_ready_gate",
    });

    return {
      ok: true,
      status: state.status,
      isTerminal: isTerminalReadyGateStatus(state.status),
      expiresAt: state.expiresAt,
      reason: action,
      terminal: isTerminalReadyGateStatus(state.status),
    };
  }, [sessionId, eventId, user?.id, applyReadyGateTruth, notifyTerminal, state.expiresAt, state.status]);

  const syncSession = useCallback(async (): Promise<ReadyGateSyncResult> => {
    if (!sessionId || !user?.id) {
      return { ok: false, error: "missing_session_or_user" };
    }

    if (syncSessionInFlightRef.current) {
      return syncSessionInFlightRef.current;
    }

    const syncPromise = (async (): Promise<ReadyGateSyncResult> => {
      const { data, error } = await supabase.rpc("ready_gate_transition", {
        p_session_id: sessionId,
        p_action: "sync" satisfies ReadyGateTransitionAction,
      });

      if (error) {
        readyGateDebug("sync transition failed", {
          sessionId,
          code: error.code ?? null,
          message: error.message,
        });
        return { ok: false, error: error.message };
      }

      const payload = data && typeof data === "object" && !Array.isArray(data)
        ? (data as ReadyGateSessionTruth & { success?: boolean; error?: string | null })
        : null;
      if (!payload) {
        readyGateDebug("sync transition returned invalid payload", { sessionId });
        return { ok: false, error: "invalid_ready_gate_sync_response" };
      }

      if (payload?.success === false) {
        readyGateDebug("sync transition returned unsuccessful payload", {
          sessionId,
          error: payload.error ?? null,
        });
        return {
          ok: false,
          error: payload.error ?? "ready_gate_sync_failed",
          reason: payload.reason ?? null,
          inactiveReason: payload.inactive_reason ?? null,
          errorCode: payload.error_code ?? payload.code ?? null,
          terminal: payload.terminal ?? null,
        };
      }

      return applyReadyGateTruth({
        ...payload,
        ready_gate_status: payload.status ?? payload.ready_gate_status,
      });
    })();

    syncSessionInFlightRef.current = syncPromise;
    try {
      return await syncPromise;
    } finally {
      if (syncSessionInFlightRef.current === syncPromise) {
        syncSessionInFlightRef.current = null;
      }
    }
  }, [sessionId, user?.id, applyReadyGateTruth]);

  // Mark self as ready (server-owned transition)
  const markReady = useCallback(async (): Promise<ReadyGateTransitionResult> => (
    runReadyGateTransition("mark_ready")
  ), [runReadyGateTransition]);

  // Skip — forfeit (server-owned transition)
  const skip = useCallback(async (): Promise<ReadyGateTransitionResult> => {
    return runReadyGateTransition("forfeit");
  }, [runReadyGateTransition]);

  // Snooze — request 2 more minutes (server-owned transition)
  const snooze = useCallback(async (): Promise<ReadyGateTransitionResult> => (
    runReadyGateTransition("snooze")
  ), [runReadyGateTransition]);

  return {
    ...state,
    isSnoozed: state.status === ReadyGateStatus.Snoozed,
    markReady,
    skip,
    snooze,
    syncSession,
    /** Refresh gate UI from `video_sessions` (called by ReadyGateOverlay after reconcile poll). */
    refetchSession: fetchSession,
  };
};
