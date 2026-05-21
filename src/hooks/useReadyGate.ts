import { useState, useEffect, useCallback, useRef } from "react";
import * as Sentry from "@sentry/react";
import { supabase } from "@/integrations/supabase/client";
import { useUserProfile } from "@/contexts/AuthContext";
import { ReadyGateStatus } from "@/domain/enums";
import { trackEvent } from "@/lib/analytics";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { fetchVideoDateSnapshot } from "@/lib/videoDateSnapshot";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  EventLobbyObservabilityEvents,
  sanitizeReasonCode,
} from "@clientShared/observability/eventLobbyObservability";
import {
  buildReadyGateToDateLatencyPayload,
  recordReadyGateToDateLatencyCheckpoint,
} from "@clientShared/observability/videoDateOperatorMetrics";
import {
  deriveReadyGateReadinessState,
  getReadyGateParticipantPosition,
  initialReadyGateReadinessState,
  type ReadyGateParticipantPosition,
} from "@clientShared/matching/readyGateReadiness";
import { buildVideoDateTransitionIdempotencyKey } from "@clientShared/matching/videoDateTransitionCommands";
import {
  createVideoDateSessionChannel,
  resolveVideoDateSessionSeqDecision,
  type VideoDateSessionBroadcastEvent,
} from "@clientShared/matching/videoDateSessionChannel";

interface ReadyGateState {
  status: ReadyGateStatus;
  iAmReady: boolean;
  partnerReady: boolean;
  iAmReadyKnown: boolean;
  partnerReadyKnown: boolean;
  isBothReady: boolean;
  partnerName: string | null;
  snoozedByPartner: boolean;
  snoozeExpiresAt: string | null;
  expiresAt: string | null;
}

type ReadyGateBothReadySourceAction =
  | "both_ready_observed"
  | "both_ready_observed_via_rpc_short_circuit";

interface UseReadyGateOptions {
  sessionId: string;
  eventId?: string | null;
  onBothReady: (sourceAction?: ReadyGateBothReadySourceAction) => void;
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
  event_id?: string | null;
  participant_1_id?: string | null;
  participant_2_id?: string | null;
  session_seq?: number | null;
  ready_gate_status?: ReadyGateStatus | string | null;
  status?: ReadyGateStatus | string | null;
  result_status?: ReadyGateStatus | string | null;
  result_ready_gate_status?: ReadyGateStatus | string | null;
  ready_participant_1_at?: string | null;
  ready_participant_2_at?: string | null;
  ready_gate_expires_at?: string | null;
  snoozed_by?: string | null;
  snooze_expires_at?: string | null;
  reason?: string | null;
  inactive_reason?: string | null;
  error?: string | null;
  error_code?: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
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
      details?: string | null;
      hint?: string | null;
      isTerminal?: boolean;
      terminal?: boolean | null;
    };

type ReadyGateTransitionResult = ReadyGateSyncResult;

const READY_GATE_STATUS_VALUES = Object.values(ReadyGateStatus) as ReadyGateStatus[];
const TERMINAL_READY_GATE_STATUS_VALUES: readonly ReadyGateStatus[] = TERMINAL_READY_GATE_STATUSES;
type ReadyGateTransitionAction = "mark_ready" | "forfeit" | "snooze" | "sync";

type ReadyGateTransitionDiagnostic = {
  sessionId: string;
  eventId?: string | null;
  action: ReadyGateTransitionAction;
  outcome: "rpc_error" | "rejected";
  startedAt: number;
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  reason?: string | null;
  errorCode?: string | null;
  readyGateStatus?: ReadyGateStatus | string | null;
  terminal?: boolean | null;
};

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

function captureReadyGateTransitionDiagnostic(diagnostic: ReadyGateTransitionDiagnostic) {
  const data = {
    sessionId: diagnostic.sessionId,
    eventId: diagnostic.eventId ?? null,
    action: diagnostic.action,
    outcome: diagnostic.outcome,
    code: diagnostic.code ?? null,
    message: diagnostic.message ?? null,
    details: diagnostic.details ?? null,
    hint: diagnostic.hint ?? null,
    reason: diagnostic.reason ?? null,
    error_code: diagnostic.errorCode ?? null,
    ready_gate_status: diagnostic.readyGateStatus ?? null,
    terminal: diagnostic.terminal ?? null,
    latency_ms: Math.max(0, Date.now() - diagnostic.startedAt),
  };

  readyGateDebug(`ready_gate_transition ${diagnostic.outcome}`, data);
  Sentry.addBreadcrumb({
    category: "ready_gate",
    level: "warning",
    message: "ready_gate_transition_failed",
    data,
  });
  if (diagnostic.outcome === "rpc_error") {
    Sentry.captureMessage("ready_gate_transition_failed", {
      level: "warning",
      tags: {
        feature: "ready_gate",
        action: diagnostic.action,
        outcome: diagnostic.outcome,
      },
      extra: data,
    });
  }
}

export const useReadyGate = ({ sessionId, eventId, onBothReady, onForfeited }: UseReadyGateOptions) => {
  const { user } = useUserProfile();
  const broadcastV2 = useFeatureFlag("video_date.broadcast_v2");
  const markReadyV2 = useFeatureFlag("video_date.outbox_v2.mark_ready");
  const forfeitV2 = useFeatureFlag("video_date.outbox_v2.forfeit");
  const [state, setState] = useState<ReadyGateState>({
    status: ReadyGateStatus.Queued,
    iAmReady: initialReadyGateReadinessState.iAmReady,
    partnerReady: initialReadyGateReadinessState.partnerReady,
    iAmReadyKnown: initialReadyGateReadinessState.iAmReadyKnown,
    partnerReadyKnown: initialReadyGateReadinessState.partnerReadyKnown,
    isBothReady: initialReadyGateReadinessState.isBothReady,
    partnerName: null,
    snoozedByPartner: false,
    snoozeExpiresAt: null,
    expiresAt: null,
  });
  const onBothReadyRef = useRef(onBothReady);
  const onForfeitedRef = useRef(onForfeited);
  const terminalHandledRef = useRef<ReadyGateStatus | null>(null);
  const participantPositionRef = useRef<ReadyGateParticipantPosition | null>(null);
  const syncSessionInFlightRef = useRef<Promise<ReadyGateSyncResult> | null>(null);
  const sessionSeqRef = useRef<number | null>(null);
  const broadcastRefetchInFlightRef = useRef(false);

  useEffect(() => {
    onBothReadyRef.current = onBothReady;
    onForfeitedRef.current = onForfeited;
  }, [onBothReady, onForfeited]);

  useEffect(() => {
    terminalHandledRef.current = null;
    participantPositionRef.current = null;
    syncSessionInFlightRef.current = null;
    sessionSeqRef.current = null;
    broadcastRefetchInFlightRef.current = false;
  }, [sessionId]);

  const notifyTerminal = useCallback((
    status: TerminalReadyGateStatus,
    detail?: ReadyGateTerminalDetail,
    bothReadySourceAction: ReadyGateBothReadySourceAction = "both_ready_observed",
  ) => {
    if (terminalHandledRef.current === status) return;
    terminalHandledRef.current = status;
    readyGateDebug("terminal status notification", { sessionId, status });
    if (status === ReadyGateStatus.BothReady) {
      onBothReadyRef.current(bothReadySourceAction);
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
    options?: {
      partnerName?: string | null;
      bothReadySourceAction?: ReadyGateBothReadySourceAction;
    },
  ): ReadyGateSyncResult => {
    const nextStatus = normalizeReadyGateStatus(
      truth.ready_gate_status ??
      truth.status ??
      truth.result_ready_gate_status ??
      truth.result_status,
    );
    const participantPosition = getReadyGateParticipantPosition(
      truth,
      user?.id ?? null,
      participantPositionRef.current,
    );
    participantPositionRef.current = participantPosition;

    const hasSnoozedBy = Object.prototype.hasOwnProperty.call(truth, "snoozed_by");
    const hasSnoozeExpiresAt = Object.prototype.hasOwnProperty.call(truth, "snooze_expires_at");
    const hasReadyGateExpiresAt = Object.prototype.hasOwnProperty.call(truth, "ready_gate_expires_at");
    const expiresAt = normalizeReadyGateTimestamp(truth.ready_gate_expires_at);
    if (typeof truth.session_seq === "number" && Number.isFinite(truth.session_seq)) {
      sessionSeqRef.current = truth.session_seq;
    }

    setState((prev) => {
      const readiness = deriveReadyGateReadinessState({
        truth: {
          ...truth,
          ready_gate_status: nextStatus,
        },
        userId: user?.id ?? null,
        previous: {
          ...prev,
          participantPosition,
        },
      });

      return {
        status: nextStatus,
        iAmReady: readiness.iAmReady,
        partnerReady: readiness.partnerReady,
        iAmReadyKnown: readiness.iAmReadyKnown,
        partnerReadyKnown: readiness.partnerReadyKnown,
        isBothReady: readiness.isBothReady,
        partnerName: options?.partnerName ?? prev.partnerName,
        snoozedByPartner: hasSnoozedBy
          ? typeof truth.snoozed_by === "string" && truth.snoozed_by !== user?.id
          : prev.snoozedByPartner,
        snoozeExpiresAt: hasSnoozeExpiresAt
          ? normalizeReadyGateTimestamp(truth.snooze_expires_at)
          : prev.snoozeExpiresAt,
        expiresAt: hasReadyGateExpiresAt ? expiresAt : prev.expiresAt,
      };
    });

    if (isTerminalReadyGateStatus(nextStatus)) {
      notifyTerminal(nextStatus, {
        status: nextStatus,
        reason: truth.reason ?? null,
        inactiveReason: truth.inactive_reason ?? null,
        errorCode: truth.error_code ?? truth.code ?? null,
        code: truth.code ?? null,
        terminal: truth.terminal ?? null,
      }, options?.bothReadySourceAction);
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

  const fetchSession = useCallback(async (): Promise<ReadyGateSyncResult | null> => {
    if (!sessionId || !user?.id) return null;

    const { data: session, error } = await supabase
      .from("video_sessions")
      .select("participant_1_id, participant_2_id, session_seq, ready_gate_status, ready_participant_1_at, ready_participant_2_at, ready_gate_expires_at, snoozed_by, snooze_expires_at")
      .eq("id", sessionId)
      .maybeSingle();

    if (error) {
      readyGateDebug("session refetch failed", {
        sessionId,
        eventId: eventId ?? null,
        code: error.code ?? null,
        message: error.message,
        details: error.details ?? null,
        hint: error.hint ?? null,
      });
      return {
        ok: false,
        error: error.message,
        errorCode: error.code ?? null,
        details: error.details ?? null,
        hint: error.hint ?? null,
        terminal: false,
      };
    }

    if (!session) {
      return {
        ok: false,
        error: "session_not_found",
        terminal: false,
      };
    }

    const isP1 = session.participant_1_id === user.id;
    const partnerId = isP1 ? session.participant_2_id : session.participant_1_id;

    // Fetch partner name through the privacy-aware profile RPC.
    const { data: profile } = await supabase.rpc("get_profile_for_viewer", {
      p_target_id: partnerId,
    });
    const partnerProfile = profile as { name?: string | null } | null;

    return applyReadyGateTruth(session as ReadyGateSessionTruth, {
      partnerName: partnerProfile?.name || "Your match",
    });
  }, [sessionId, eventId, user?.id, applyReadyGateTruth]);

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
          const s = payload.new as ReadyGateRealtimeRow & { session_seq?: number | null };
          if (typeof s.session_seq === "number" && Number.isFinite(s.session_seq)) {
            sessionSeqRef.current = s.session_seq;
          }
          applyReadyGateTruth(s);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, user?.id, applyReadyGateTruth]);

  const reconcileBroadcastEvent = useCallback(
    async (event: VideoDateSessionBroadcastEvent) => {
      if (!sessionId || !user?.id) return;
      const decision = resolveVideoDateSessionSeqDecision(sessionSeqRef.current, event.sessionSeq);
      if (decision.action === "invalid" || decision.action === "duplicate") return;

      sessionSeqRef.current = event.sessionSeq;
      if (broadcastRefetchInFlightRef.current) return;
      broadcastRefetchInFlightRef.current = true;
      try {
        if (decision.action === "gap") {
          const snapshot = await fetchVideoDateSnapshot(sessionId, { includeToken: false });
          if (snapshot.ok) sessionSeqRef.current = snapshot.seq;
          Sentry.addBreadcrumb({
            category: "ready_gate",
            level: snapshot.ok ? "info" : "warning",
            message: "broadcast_seq_gap_snapshot_refetch",
            data: {
              session_id: sessionId,
              event_id: eventId ?? null,
              event_kind: event.kind,
              incoming_seq: event.sessionSeq,
              expected_seq: decision.expectedSeq,
              snapshot_ok: snapshot.ok,
            },
          });
        }
        await fetchSession();
      } finally {
        broadcastRefetchInFlightRef.current = false;
      }
    },
    [eventId, fetchSession, sessionId, user?.id],
  );

  useEffect(() => {
    if (!sessionId || !user?.id || !broadcastV2.enabled) return;
    const subscription = createVideoDateSessionChannel(supabase, {
      sessionId,
      onEvent: (event) => {
        void reconcileBroadcastEvent(event);
      },
      onInvalidPayload: () => {
        readyGateDebug("broadcast invalid payload ignored", {
          sessionId,
          eventId: eventId ?? null,
        });
      },
      onStatusChange: (status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          readyGateDebug("broadcast channel degraded", {
            sessionId,
            eventId: eventId ?? null,
            status,
            error: error instanceof Error ? error.message : String(error ?? ""),
          });
        }
      },
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [broadcastV2.enabled, eventId, reconcileBroadcastEvent, sessionId, user?.id]);

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
    const startedContext = recordReadyGateToDateLatencyCheckpoint({
      sessionId,
      platform: "web",
      eventId: eventId ?? null,
      sourceSurface: "use_ready_gate",
      checkpoint: "ready_gate_transition_started",
      nowMs: startedAt,
    });
    trackEvent(
      LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
      buildReadyGateToDateLatencyPayload({
        context: startedContext,
        checkpoint: "ready_gate_transition_started",
        sourceAction: action,
        outcome: "success",
      }),
    );
    // Static smoke contract: terminal actions still await
    // const { error } = await supabase.rpc("ready_gate_transition" before closing.
    const transitionResult =
      action === "mark_ready" && markReadyV2.enabled
        ? await supabase.rpc("video_session_mark_ready_v2" as never, {
            p_session_id: sessionId,
            p_idempotency_key: buildVideoDateTransitionIdempotencyKey(sessionId, "mark_ready"),
          } as never)
        : action === "forfeit" && forfeitV2.enabled
          ? await supabase.rpc("video_session_forfeit_v2" as never, {
              p_session_id: sessionId,
              p_reason: "ready_gate_forfeit",
              p_idempotency_key: buildVideoDateTransitionIdempotencyKey(sessionId, "forfeit"),
            } as never)
          : await supabase.rpc("ready_gate_transition", {
              p_session_id: sessionId,
              p_action: action,
            });
    const { error } = transitionResult;
    const data = transitionResult.data;
    if (error) {
      const reason = sanitizeReasonCode(error.code ?? "rpc_error", "rpc_error");
      captureReadyGateTransitionDiagnostic({
        sessionId,
        eventId: eventId ?? null,
        action,
        outcome: "rpc_error",
        startedAt,
        code: error.code ?? null,
        message: error.message,
        details: error.details ?? null,
        hint: error.hint ?? null,
        reason,
        errorCode: error.code ?? null,
        readyGateStatus: null,
        terminal: false,
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
        code: error.code ?? null,
        details: error.details ?? null,
        hint: error.hint ?? null,
        terminal: false,
      };
    }
    const payload = data && typeof data === "object" && !Array.isArray(data)
      ? (data as ReadyGateSessionTruth & { success?: boolean; error?: string | null })
      : null;
    if (payload) {
      const payloadStatus = normalizeReadyGateStatus(
        payload.ready_gate_status ??
        payload.status ??
        payload.result_ready_gate_status ??
        payload.result_status,
      );
      const result = applyReadyGateTruth({
        ...payload,
        ready_gate_status:
          payload.ready_gate_status ??
          payload.status ??
          payload.result_ready_gate_status ??
          payload.result_status,
      }, {
        bothReadySourceAction:
          action === "mark_ready" && payloadStatus === ReadyGateStatus.BothReady
            ? "both_ready_observed_via_rpc_short_circuit"
            : undefined,
      });
      const errorCode = payload.error_code ?? payload.code ?? null;
      const transitionStatus = result.ok === true ? result.status : payloadStatus;
      const transitionTerminal = result.ok === true ? result.isTerminal : isTerminalReadyGateStatus(transitionStatus);
      const reason = sanitizeReasonCode(
        payload.reason ?? payload.error ?? errorCode ?? transitionStatus ?? action,
        action,
      );
      if (payload.success === false) {
        const terminal =
          payload.terminal === true ||
          transitionTerminal ||
          errorCode === "EVENT_NOT_ACTIVE" ||
          payload.reason === "event_not_active";
        captureReadyGateTransitionDiagnostic({
          sessionId,
          eventId: payload.event_id ?? eventId ?? null,
          action,
          outcome: "rejected",
          startedAt,
          code: payload.code ?? null,
          message: payload.error ?? null,
          details: payload.details ?? null,
          hint: payload.hint ?? null,
          reason: payload.reason ?? payload.error ?? null,
          errorCode,
          readyGateStatus: transitionStatus,
          terminal,
        });
        if (errorCode === "EVENT_NOT_ACTIVE" || payload.reason === "event_not_active") {
          notifyTerminal(ReadyGateStatus.Expired, {
            status:
              payload.ready_gate_status ??
              payload.status ??
              payload.result_ready_gate_status ??
              payload.result_status ??
              ReadyGateStatus.Expired,
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
          terminal,
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
          terminal,
          latency_ms: Date.now() - startedAt,
        });
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
          details: payload.details ?? null,
          hint: payload.hint ?? null,
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
      const successContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: "web",
        eventId: eventId ?? null,
        sourceSurface: "use_ready_gate",
        checkpoint: "ready_gate_transition_success",
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: successContext,
          checkpoint: "ready_gate_transition_success",
          sourceAction: action,
          outcome: "success",
        }),
      );
      const hasReadyTimestamps =
        Object.prototype.hasOwnProperty.call(payload, "ready_participant_1_at") &&
        Object.prototype.hasOwnProperty.call(payload, "ready_participant_2_at");
      if (action === "mark_ready" && result.ok === true && !result.isTerminal && !hasReadyTimestamps) {
        const refreshed = await fetchSession();
        if (refreshed?.ok === true) return refreshed;
      }
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

    const successContext = recordReadyGateToDateLatencyCheckpoint({
      sessionId,
      platform: "web",
      eventId: eventId ?? null,
      sourceSurface: "use_ready_gate",
      checkpoint: "ready_gate_transition_success",
    });
    trackEvent(
      LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
      buildReadyGateToDateLatencyPayload({
        context: successContext,
        checkpoint: "ready_gate_transition_success",
        sourceAction: action,
        outcome: "success",
      }),
    );
    const refreshed = await fetchSession();
    if (refreshed?.ok === true) return refreshed;

    return {
      ok: true,
      status: state.status,
      isTerminal: isTerminalReadyGateStatus(state.status),
      expiresAt: state.expiresAt,
      reason: action,
      terminal: isTerminalReadyGateStatus(state.status),
    };
  }, [
    sessionId,
    eventId,
    user?.id,
    markReadyV2.enabled,
    forfeitV2.enabled,
    applyReadyGateTruth,
    fetchSession,
    notifyTerminal,
    state.expiresAt,
    state.status,
  ]);

  const syncSession = useCallback(async (): Promise<ReadyGateSyncResult> => {
    if (!sessionId || !user?.id) {
      return { ok: false, error: "missing_session_or_user" };
    }

    if (syncSessionInFlightRef.current) {
      return syncSessionInFlightRef.current;
    }

    const syncPromise = (async (): Promise<ReadyGateSyncResult> => {
      const startedAt = Date.now();
      const { data, error } = await supabase.rpc("ready_gate_transition", {
        p_session_id: sessionId,
        p_action: "sync" satisfies ReadyGateTransitionAction,
      });

      if (error) {
        captureReadyGateTransitionDiagnostic({
          sessionId,
          eventId: eventId ?? null,
          action: "sync",
          outcome: "rpc_error",
          startedAt,
          code: error.code ?? null,
          message: error.message,
          details: error.details ?? null,
          hint: error.hint ?? null,
          reason: sanitizeReasonCode(error.code ?? "rpc_error", "rpc_error"),
          errorCode: error.code ?? null,
          readyGateStatus: null,
          terminal: false,
        });
        return {
          ok: false,
          error: error.message,
          errorCode: error.code ?? null,
          code: error.code ?? null,
          details: error.details ?? null,
          hint: error.hint ?? null,
          terminal: false,
        };
      }

      const payload = data && typeof data === "object" && !Array.isArray(data)
        ? (data as ReadyGateSessionTruth & { success?: boolean; error?: string | null })
        : null;
      if (!payload) {
        readyGateDebug("sync transition returned invalid payload", { sessionId });
        return { ok: false, error: "invalid_ready_gate_sync_response" };
      }

      if (payload?.success === false) {
        captureReadyGateTransitionDiagnostic({
          sessionId,
          eventId: payload.event_id ?? eventId ?? null,
          action: "sync",
          outcome: "rejected",
          startedAt,
          code: payload.code ?? null,
          message: payload.error ?? null,
          details: payload.details ?? null,
          hint: payload.hint ?? null,
          reason: payload.reason ?? payload.error ?? null,
          errorCode: payload.error_code ?? payload.code ?? null,
          readyGateStatus:
            payload.ready_gate_status ??
            payload.status ??
            payload.result_ready_gate_status ??
            payload.result_status ??
            null,
          terminal: payload.terminal ?? null,
        });
        return {
          ok: false,
          error: payload.error ?? "ready_gate_sync_failed",
          reason: payload.reason ?? null,
          inactiveReason: payload.inactive_reason ?? null,
          errorCode: payload.error_code ?? payload.code ?? null,
          code: payload.code ?? null,
          details: payload.details ?? null,
          hint: payload.hint ?? null,
          terminal: payload.terminal ?? null,
        };
      }

      return applyReadyGateTruth({
        ...payload,
        ready_gate_status:
          payload.ready_gate_status ??
          payload.status ??
          payload.result_ready_gate_status ??
          payload.result_status,
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
  }, [sessionId, eventId, user?.id, applyReadyGateTruth]);

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
