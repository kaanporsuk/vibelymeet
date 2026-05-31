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
  normalizeReadyGateServerNowMs,
  shouldCommitReadyGateTruth,
  type ReadyGateParticipantPosition,
} from "@clientShared/matching/readyGateReadiness";
import { parseReadyGateExpiryMs } from "@clientShared/matching/readyGateCountdown";
import {
  createReadyGateRealtimeSupervisor,
  isReadyGateResilientBroadcastEnabled,
  isReadyGateResilientClockEnabled,
  type ReadyGateRealtimeSupervisor,
  type ReadyGateRealtimeSupervisorContext,
} from "@clientShared/matching/readyGateRealtimeSupervisor";
import { buildVideoDateTransitionIdempotencyKey } from "@clientShared/matching/videoDateTransitionCommands";
import {
  createVideoDateSessionChannel,
  resolveVideoDateSessionSeqDecision,
  type VideoDateSessionBroadcastEvent,
} from "@clientShared/matching/videoDateSessionChannel";
import {
  mergeVideoDateBroadcastGapRecovery,
  recordVideoDateBroadcastGapRecoveryFailure,
  recordVideoDateBroadcastGapRecoverySuccess,
  shouldAttemptVideoDateBroadcastGapRecovery,
  shouldRetainVideoDateBroadcastGapRecoveryForEvent,
  videoDateBroadcastGapRetryDelayMs,
  type VideoDateBroadcastGapRecoveryState,
} from "@clientShared/matching/videoDateBroadcastGapRecovery";

interface ReadyGateState {
  stateSessionId: string | null;
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
  serverNowMs: number | null;
  clientSyncedAtMs: number | null;
  clockSkewMs: number | null;
  phaseDeadlineAtMs: number | null;
  countdownDegraded: boolean;
  realtimeDegraded: boolean;
  sequenceGapUnresolved: boolean;
}

const createInitialReadyGateState = (): ReadyGateState => ({
  stateSessionId: null,
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
  serverNowMs: null,
  clientSyncedAtMs: null,
  clockSkewMs: null,
  phaseDeadlineAtMs: null,
  countdownDegraded: true,
  realtimeDegraded: false,
  sequenceGapUnresolved: false,
});

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
  server_now_ms?: string | number | null;
  serverNowMs?: string | number | null;
  server_now?: string | number | null;
  serverNow?: string | number | null;
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
  const timelineV2 = useFeatureFlag("video_date.timeline_v2");
  const readyGateResilientClockAlias = useFeatureFlag("video_date.ready_gate_resilient_clock_v1");
  const markReadyV2 = useFeatureFlag("video_date.outbox_v2.mark_ready");
  const forfeitV2 = useFeatureFlag("video_date.outbox_v2.forfeit");
  const readyGateClockEnabled = isReadyGateResilientClockEnabled({
    timelineV2Enabled: timelineV2.enabled,
    aliasEnabled: readyGateResilientClockAlias.enabled,
  });
  const readyGateBroadcastEnabled = isReadyGateResilientBroadcastEnabled({
    broadcastV2Enabled: broadcastV2.enabled,
    aliasEnabled: readyGateResilientClockAlias.enabled,
  });
  const [state, setState] = useState<ReadyGateState>(() => ({
    ...createInitialReadyGateState(),
    stateSessionId: sessionId,
  }));
  const onBothReadyRef = useRef(onBothReady);
  const onForfeitedRef = useRef(onForfeited);
  const activeReadyGateSessionIdRef = useRef<string | null>(sessionId);
  const terminalHandledRef = useRef<ReadyGateStatus | null>(null);
  const participantPositionRef = useRef<ReadyGateParticipantPosition | null>(null);
  const syncSessionInFlightRef = useRef<Promise<ReadyGateSyncResult> | null>(null);
  const sessionSeqRef = useRef<number | null>(null);
  const broadcastRefetchInFlightRef = useRef(false);
  const broadcastGapRecoveryRef = useRef<VideoDateBroadcastGapRecoveryState | null>(null);
  const broadcastGapRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyGateTruthRef = useRef<{
    status: ReadyGateStatus;
    sessionSeq: number | null;
    expiresAt: string | null;
    serverNowMs: number | null;
    clientSyncedAtMs: number | null;
    clockSkewMs: number | null;
    phaseDeadlineAtMs: number | null;
  }>({
    status: ReadyGateStatus.Queued,
    sessionSeq: null,
    expiresAt: null,
    serverNowMs: null,
    clientSyncedAtMs: null,
    clockSkewMs: null,
    phaseDeadlineAtMs: null,
  });
  const [realtimeSubscriptionEpoch, setRealtimeSubscriptionEpoch] = useState(0);
  const readyGateRealtimeSupervisorRef = useRef<ReadyGateRealtimeSupervisor | null>(null);
  const broadcastSubscriptionEpoch = realtimeSubscriptionEpoch;

  useEffect(() => {
    onBothReadyRef.current = onBothReady;
    onForfeitedRef.current = onForfeited;
  }, [onBothReady, onForfeited]);

  useEffect(() => {
    setState((prev) => {
      const countdownDegraded =
        !readyGateClockEnabled ||
        prev.serverNowMs == null ||
        prev.clientSyncedAtMs == null ||
        prev.phaseDeadlineAtMs == null;
      return prev.countdownDegraded === countdownDegraded ? prev : { ...prev, countdownDegraded };
    });
  }, [readyGateClockEnabled]);

  useEffect(() => {
    activeReadyGateSessionIdRef.current = sessionId;
    terminalHandledRef.current = null;
    participantPositionRef.current = null;
    syncSessionInFlightRef.current = null;
    sessionSeqRef.current = null;
    broadcastRefetchInFlightRef.current = false;
    broadcastGapRecoveryRef.current = null;
    readyGateTruthRef.current = {
      status: ReadyGateStatus.Queued,
      sessionSeq: null,
      expiresAt: null,
      serverNowMs: null,
      clientSyncedAtMs: null,
      clockSkewMs: null,
      phaseDeadlineAtMs: null,
    };
    readyGateRealtimeSupervisorRef.current?.dispose();
    readyGateRealtimeSupervisorRef.current = null;
    setState({
      ...createInitialReadyGateState(),
      stateSessionId: sessionId,
    });
  }, [sessionId]);

  useEffect(() => () => {
    activeReadyGateSessionIdRef.current = null;
    readyGateRealtimeSupervisorRef.current?.dispose();
    readyGateRealtimeSupervisorRef.current = null;
    if (broadcastGapRetryTimerRef.current) {
      clearTimeout(broadcastGapRetryTimerRef.current);
      broadcastGapRetryTimerRef.current = null;
    }
  }, []);

  const notifyTerminal = useCallback((
    status: TerminalReadyGateStatus,
    detail?: ReadyGateTerminalDetail,
    bothReadySourceAction: ReadyGateBothReadySourceAction = "both_ready_observed",
  ) => {
    if (activeReadyGateSessionIdRef.current !== sessionId) return;
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
    if (activeReadyGateSessionIdRef.current !== sessionId) {
      const currentTruth = readyGateTruthRef.current;
      return {
        ok: true,
        status: currentTruth.status,
        isTerminal: isTerminalReadyGateStatus(currentTruth.status),
        expiresAt: currentTruth.expiresAt,
        reason: truth.reason ?? null,
        inactiveReason: truth.inactive_reason ?? null,
        errorCode: truth.error_code ?? truth.code ?? null,
        code: truth.code ?? null,
        terminal: truth.terminal ?? null,
      };
    }

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
    const incomingSeq = typeof truth.session_seq === "number" && Number.isFinite(truth.session_seq)
      ? Math.max(0, Math.floor(truth.session_seq))
      : null;
    const currentTruth = readyGateTruthRef.current;
    if (!shouldCommitReadyGateTruth({
      currentStatus: currentTruth.status,
      incomingStatus: nextStatus,
      currentSeq: currentTruth.sessionSeq,
      incomingSeq,
    })) {
      readyGateDebug("stale ready gate truth ignored", {
        sessionId,
        eventId: eventId ?? null,
        currentStatus: currentTruth.status,
        incomingStatus: nextStatus,
        currentSeq: currentTruth.sessionSeq,
        incomingSeq,
      });
      return {
        ok: true,
        status: currentTruth.status,
        isTerminal: isTerminalReadyGateStatus(currentTruth.status),
        expiresAt: currentTruth.expiresAt,
        reason: truth.reason ?? null,
        inactiveReason: truth.inactive_reason ?? null,
        errorCode: truth.error_code ?? truth.code ?? null,
        code: truth.code ?? null,
        terminal: truth.terminal ?? null,
      };
    }
    if (incomingSeq != null) sessionSeqRef.current = incomingSeq;

    const serverClock = normalizeReadyGateServerNowMs(truth);
    const committedServerNowMs = serverClock.serverNowMs ?? currentTruth.serverNowMs;
    const committedClientSyncedAtMs = serverClock.clientSyncedAtMs ?? currentTruth.clientSyncedAtMs;
    const committedExpiresAt = hasReadyGateExpiresAt ? expiresAt : currentTruth.expiresAt;
    const committedPhaseDeadlineAtMs =
      hasReadyGateExpiresAt ? parseReadyGateExpiryMs(committedExpiresAt) : currentTruth.phaseDeadlineAtMs;
    const committedClockSkewMs =
      committedServerNowMs != null && committedClientSyncedAtMs != null
        ? committedServerNowMs - committedClientSyncedAtMs
        : currentTruth.clockSkewMs;
    readyGateTruthRef.current = {
      status: nextStatus,
      sessionSeq: incomingSeq ?? currentTruth.sessionSeq,
      expiresAt: committedExpiresAt,
      serverNowMs: committedServerNowMs,
      clientSyncedAtMs: committedClientSyncedAtMs,
      clockSkewMs: committedClockSkewMs,
      phaseDeadlineAtMs: committedPhaseDeadlineAtMs,
    };

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
        stateSessionId: sessionId,
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
        expiresAt: committedExpiresAt,
        serverNowMs: committedServerNowMs,
        clientSyncedAtMs: committedClientSyncedAtMs,
        clockSkewMs: committedClockSkewMs,
        phaseDeadlineAtMs: committedPhaseDeadlineAtMs,
        countdownDegraded:
          !readyGateClockEnabled ||
          committedServerNowMs == null ||
          committedClientSyncedAtMs == null ||
          committedPhaseDeadlineAtMs == null,
        realtimeDegraded: prev.realtimeDegraded,
        sequenceGapUnresolved: prev.sequenceGapUnresolved,
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
      expiresAt: committedExpiresAt,
      reason: truth.reason ?? null,
      inactiveReason: truth.inactive_reason ?? null,
      errorCode: truth.error_code ?? truth.code ?? null,
      code: truth.code ?? null,
      terminal: truth.terminal ?? null,
    };
  }, [eventId, notifyTerminal, readyGateClockEnabled, sessionId, user?.id]);

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

  const setSequenceGapUnresolved = useCallback((unresolved: boolean) => {
    setState((prev) => (
      prev.sequenceGapUnresolved === unresolved ? prev : { ...prev, sequenceGapUnresolved: unresolved }
    ));
  }, []);

  const emitReadyGateRealtimeTelemetry = useCallback((
    eventName: string,
    payload: Record<string, unknown>,
  ) => {
    trackEvent(eventName, {
      platform: "web",
      session_id: sessionId,
      event_id: eventId ?? null,
      source_surface: "use_ready_gate",
      ...payload,
    });
  }, [eventId, sessionId]);

  const fetchCanonicalReadyGateSnapshot = useCallback(async (
    context: ReadyGateRealtimeSupervisorContext,
  ) => {
    if (!sessionId || !user?.id) return null;
    const snapshot = await fetchVideoDateSnapshot(sessionId, { includeToken: false });
    if (activeReadyGateSessionIdRef.current !== sessionId) return null;
    if (snapshot.ok === true) {
      const nextSeq = Math.max(sessionSeqRef.current ?? 0, snapshot.seq);
      const clientSyncedAtMs = Date.now();
      const clockSkewMs = snapshot.serverNow - clientSyncedAtMs;
      sessionSeqRef.current = nextSeq;
      readyGateTruthRef.current = {
        ...readyGateTruthRef.current,
        sessionSeq: Math.max(readyGateTruthRef.current.sessionSeq ?? 0, snapshot.seq),
        serverNowMs: snapshot.serverNow,
        clientSyncedAtMs,
        clockSkewMs,
        phaseDeadlineAtMs: snapshot.phaseDeadlineAt ?? readyGateTruthRef.current.phaseDeadlineAtMs,
      };
      setState((prev) => ({
        ...prev,
        serverNowMs: snapshot.serverNow,
        clientSyncedAtMs,
        clockSkewMs,
        phaseDeadlineAtMs: snapshot.phaseDeadlineAt ?? prev.phaseDeadlineAtMs,
        countdownDegraded: !readyGateClockEnabled || snapshot.phaseDeadlineAt == null,
      }));
      const gapState = broadcastGapRecoveryRef.current;
      if (gapState && snapshot.seq >= gapState.targetSeq) {
        broadcastGapRecoveryRef.current = null;
        setSequenceGapUnresolved(false);
        readyGateRealtimeSupervisorRef.current?.recordSnapshotGapRecovered({
          source: context.source,
          targetSeq: gapState.targetSeq,
          expectedSeq: gapState.expectedSeq,
          snapshotSeq: snapshot.seq,
        });
      }
      await fetchSession();
      return { ok: true, seq: snapshot.seq };
    }
    await fetchSession();
    return { ok: false, seq: null, error: snapshot.error };
  }, [fetchSession, readyGateClockEnabled, sessionId, setSequenceGapUnresolved, user?.id]);

  useEffect(() => {
    readyGateRealtimeSupervisorRef.current?.dispose();
    if (!sessionId || !user?.id) {
      readyGateRealtimeSupervisorRef.current = null;
      return undefined;
    }

    readyGateRealtimeSupervisorRef.current = createReadyGateRealtimeSupervisor({
      sessionId,
      eventId: eventId ?? null,
      platform: "web",
      sourceSurface: "use_ready_gate",
      emitTelemetry: emitReadyGateRealtimeTelemetry,
      fetchCanonicalSnapshot: fetchCanonicalReadyGateSnapshot,
      onDegradedChange: (degraded, context) => {
        setState((prev) => (prev.realtimeDegraded === degraded ? prev : { ...prev, realtimeDegraded: degraded }));
        readyGateDebug(degraded ? "ready gate realtime degraded" : "ready gate realtime recovered", {
          sessionId,
          eventId: eventId ?? null,
          source: context.source,
          status: context.status ?? null,
          reason: context.reason ?? null,
          attempt: context.attempt ?? null,
          delayMs: context.delayMs ?? null,
          error: context.error ?? null,
        });
      },
      onResubscribe: () => {
        setRealtimeSubscriptionEpoch((epoch) => epoch + 1);
      },
    });

    return () => {
      readyGateRealtimeSupervisorRef.current?.dispose();
      readyGateRealtimeSupervisorRef.current = null;
    };
  }, [
    emitReadyGateRealtimeTelemetry,
    eventId,
    fetchCanonicalReadyGateSnapshot,
    sessionId,
    user?.id,
  ]);

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
          applyReadyGateTruth(s);
        }
      )
      .subscribe((status, error) => {
        readyGateRealtimeSupervisorRef.current?.handleStatus("postgres_video_sessions", status, error ?? null);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    sessionId,
    user?.id,
    applyReadyGateTruth,
    realtimeSubscriptionEpoch,
  ]);

  const clearBroadcastGapRetryTimer = useCallback(() => {
    if (!broadcastGapRetryTimerRef.current) return;
    clearTimeout(broadcastGapRetryTimerRef.current);
    broadcastGapRetryTimerRef.current = null;
  }, []);

  const attemptBroadcastGapSnapshotRecovery = useCallback(
    async (source: string) => {
      if (!sessionId || !user?.id) return;
      const state = broadcastGapRecoveryRef.current;
      if (!shouldAttemptVideoDateBroadcastGapRecovery(state)) return;
      if (broadcastRefetchInFlightRef.current) return;

      broadcastRefetchInFlightRef.current = true;
      try {
        const snapshot = await fetchVideoDateSnapshot(sessionId, { includeToken: false });
        if (activeReadyGateSessionIdRef.current !== sessionId) return;
        const latestState =
          broadcastGapRecoveryRef.current?.sessionId === state.sessionId
            ? broadcastGapRecoveryRef.current
            : state;
        if (snapshot.ok === true) {
          sessionSeqRef.current = Math.max(sessionSeqRef.current ?? 0, snapshot.seq);
          broadcastGapRecoveryRef.current = recordVideoDateBroadcastGapRecoverySuccess(latestState, snapshot.seq);
          if (broadcastGapRecoveryRef.current === null) {
            setSequenceGapUnresolved(false);
            readyGateRealtimeSupervisorRef.current?.recordSnapshotGapRecovered({
              source,
              targetSeq: state.targetSeq,
              expectedSeq: state.expectedSeq,
              snapshotSeq: snapshot.seq,
            });
          } else {
            setSequenceGapUnresolved(true);
          }
        } else {
          broadcastGapRecoveryRef.current = recordVideoDateBroadcastGapRecoveryFailure(latestState, snapshot.error);
          setSequenceGapUnresolved(true);
        }
        Sentry.addBreadcrumb({
          category: "ready_gate",
          level: snapshot.ok ? "info" : "warning",
          message: "broadcast_seq_gap_snapshot_retry",
          data: {
            session_id: sessionId,
            event_id: eventId ?? null,
            source,
            target_seq: state.targetSeq,
            expected_seq: state.expectedSeq,
            attempt: state.attempts + 1,
            snapshot_ok: snapshot.ok,
          },
        });
        await fetchSession();
      } catch (error) {
        if (activeReadyGateSessionIdRef.current !== sessionId) return;
        broadcastGapRecoveryRef.current = recordVideoDateBroadcastGapRecoveryFailure(state, error);
        setSequenceGapUnresolved(true);
      } finally {
        broadcastRefetchInFlightRef.current = false;
      }

      if (activeReadyGateSessionIdRef.current !== sessionId) return;
      clearBroadcastGapRetryTimer();
      const delayMs = videoDateBroadcastGapRetryDelayMs(broadcastGapRecoveryRef.current);
      if (delayMs != null) {
        broadcastGapRetryTimerRef.current = setTimeout(() => {
          broadcastGapRetryTimerRef.current = null;
          void attemptBroadcastGapSnapshotRecovery("bounded_timer");
        }, delayMs);
      }
    },
    [clearBroadcastGapRetryTimer, eventId, fetchSession, sessionId, setSequenceGapUnresolved, user?.id],
  );

  const reconcileBroadcastEvent = useCallback(
    async (event: VideoDateSessionBroadcastEvent) => {
      if (!sessionId || !user?.id) return;
      const decision = resolveVideoDateSessionSeqDecision(sessionSeqRef.current, event.sessionSeq);
      if (decision.action === "invalid" || decision.action === "duplicate") return;

      if (decision.action === "gap") {
        broadcastGapRecoveryRef.current = mergeVideoDateBroadcastGapRecovery(broadcastGapRecoveryRef.current, {
          sessionId,
          targetSeq: event.sessionSeq,
          expectedSeq: decision.expectedSeq,
        });
        setSequenceGapUnresolved(true);
        void attemptBroadcastGapSnapshotRecovery("broadcast_event_gap");
        return;
      }

      const shouldRetainGapRecovery = shouldRetainVideoDateBroadcastGapRecoveryForEvent(
        broadcastGapRecoveryRef.current,
        event.sessionSeq,
      );
      if (!shouldRetainGapRecovery) {
        clearBroadcastGapRetryTimer();
        broadcastGapRecoveryRef.current = null;
        setSequenceGapUnresolved(false);
      }
      sessionSeqRef.current = event.sessionSeq;
      if (broadcastRefetchInFlightRef.current) return;
      broadcastRefetchInFlightRef.current = true;
      try {
        await fetchSession();
      } finally {
        broadcastRefetchInFlightRef.current = false;
      }
      if (shouldRetainGapRecovery) {
        void attemptBroadcastGapSnapshotRecovery("broadcast_event_progress");
      } else if (broadcastGapRecoveryRef.current) {
        void attemptBroadcastGapSnapshotRecovery("broadcast_refetch_complete");
      }
    },
    [
      attemptBroadcastGapSnapshotRecovery,
      clearBroadcastGapRetryTimer,
      fetchSession,
      sessionId,
      setSequenceGapUnresolved,
      user?.id,
    ],
  );

  useEffect(() => {
    if (!sessionId || !user?.id || !readyGateBroadcastEnabled) return;
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
        readyGateRealtimeSupervisorRef.current?.handleStatus(
          "private_broadcast",
          status,
          error instanceof Error ? error : error ?? null,
        );
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
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
      clearBroadcastGapRetryTimer();
      broadcastGapRecoveryRef.current = null;
      setSequenceGapUnresolved(false);
    };
  }, [
    readyGateBroadcastEnabled,
    broadcastSubscriptionEpoch,
    clearBroadcastGapRetryTimer,
    eventId,
    reconcileBroadcastEvent,
    setSequenceGapUnresolved,
    sessionId,
    user?.id,
  ]);

  useEffect(() => {
    if (readyGateBroadcastEnabled) return;
    clearBroadcastGapRetryTimer();
    broadcastGapRecoveryRef.current = null;
    setSequenceGapUnresolved(false);
    readyGateRealtimeSupervisorRef.current?.clearSource("private_broadcast", "broadcast_disabled");
  }, [clearBroadcastGapRetryTimer, readyGateBroadcastEnabled, setSequenceGapUnresolved]);

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
        if (
          result.status !== ReadyGateStatus.BothReady &&
          (errorCode === "EVENT_NOT_ACTIVE" || payload.reason === "event_not_active")
        ) {
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

  useEffect(() => {
    if (!sessionId || !user?.id) return;
    let cancelled = false;

    void (async () => {
      const syncResult = await syncSession();
      if (cancelled) return;
      const hydrated = await fetchSession();
      if (cancelled || hydrated?.ok === true || syncResult.ok === true) return;
      readyGateDebug("initial server-clock hydration deferred after sync and fetch failure", {
        sessionId,
        eventId: eventId ?? null,
        syncError: syncResult.error,
        fetchError: hydrated?.ok === false ? hydrated.error : null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId, fetchSession, sessionId, syncSession, user?.id]);

  const isCurrentSessionState = state.stateSessionId === sessionId;
  const isBothReady = isCurrentSessionState && state.isBothReady;

  return {
    ...state,
    isBothReady,
    isSnoozed: state.status === ReadyGateStatus.Snoozed,
    markReady,
    skip,
    snooze,
    syncSession,
    /** Refresh gate UI from `video_sessions` (called by ReadyGateOverlay after reconcile poll). */
    refetchSession: fetchSession,
    retryBroadcastGapRecovery: attemptBroadcastGapSnapshotRecovery,
    readyGateClockEnabled,
    readyGateBroadcastEnabled,
  };
};
