import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { fetchVideoDateSnapshot } from '@/lib/videoDateSnapshot';
import { fetchVideoDateStartSnapshot } from '@/lib/videoDateStartSnapshot';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';
import { trackEvent } from '@/lib/analytics';
import { LobbyPostDateEvents } from '@clientShared/analytics/lobbyToPostDateJourney';
import {
  EventLobbyObservabilityEvents,
  sanitizeReasonCode,
} from '@clientShared/observability/eventLobbyObservability';
import {
  buildReadyGateToDateLatencyPayload,
  recordReadyGateToDateLatencyCheckpoint,
} from '@clientShared/observability/videoDateOperatorMetrics';
import {
  deriveReadyGateReadinessState,
  getReadyGateParticipantPosition,
  initialReadyGateReadinessState,
  isReadyGateTerminalStatus,
  normalizeReadyGateServerNowMs,
  shouldCommitReadyGateTruth,
  type ReadyGateParticipantPosition,
} from '@clientShared/matching/readyGateReadiness';
import { parseReadyGateExpiryMs } from '@clientShared/matching/readyGateCountdown';
import {
  createReadyGateRealtimeSupervisor,
  isReadyGateResilientBroadcastEnabled,
  isReadyGateResilientClockEnabled,
  type ReadyGateRealtimeSupervisor,
  type ReadyGateRealtimeSupervisorContext,
} from '@clientShared/matching/readyGateRealtimeSupervisor';
import { buildVideoDateTransitionIdempotencyKey } from '@clientShared/matching/videoDateTransitionCommands';
import {
  createVideoDateSessionChannel,
  resolveVideoDateSessionSeqDecision,
  type VideoDateSessionBroadcastEvent,
} from '@clientShared/matching/videoDateSessionChannel';
import {
  mergeVideoDateBroadcastGapRecovery,
  recordVideoDateBroadcastGapRecoveryFailure,
  recordVideoDateBroadcastGapRecoverySuccess,
  shouldAttemptVideoDateBroadcastGapRecovery,
  shouldRetainVideoDateBroadcastGapRecoveryForEvent,
  videoDateBroadcastGapRetryDelayMs,
  type VideoDateBroadcastGapRecoveryState,
} from '@clientShared/matching/videoDateBroadcastGapRecovery';

const BOTH_READY = 'both_ready';
const FORFEITED = 'forfeited';
const SNOOZED = 'snoozed';
const EXPIRED = 'expired';
const POLL_MS = 1000;
type ReadyGateTransitionAction = 'mark_ready' | 'forfeit' | 'snooze' | 'sync';
type ReadyGateBothReadySourceAction =
  | 'both_ready_observed'
  | 'both_ready_observed_via_rpc_short_circuit';

export type ReadyGateState = {
  stateSessionId: string | null;
  status: string;
  iAmReady: boolean;
  partnerReady: boolean;
  iAmReadyKnown: boolean;
  partnerReadyKnown: boolean;
  isBothReady: boolean;
  partnerName: string | null;
  snoozedByPartner: boolean;
  snoozeExpiresAt: string | null;
  expiresAt: string | null;
  reason: string | null;
  inactiveReason: string | null;
  errorCode: string | null;
  terminal: boolean | null;
  serverNowMs: number | null;
  clientSyncedAtMs: number | null;
  clockSkewMs: number | null;
  phaseDeadlineAtMs: number | null;
  countdownDegraded: boolean;
  realtimeDegraded: boolean;
  sequenceGapUnresolved: boolean;
};

const createInitialReadyGateState = (): ReadyGateState => ({
  stateSessionId: null,
  status: 'queued',
  iAmReady: initialReadyGateReadinessState.iAmReady,
  partnerReady: initialReadyGateReadinessState.partnerReady,
  iAmReadyKnown: initialReadyGateReadinessState.iAmReadyKnown,
  partnerReadyKnown: initialReadyGateReadinessState.partnerReadyKnown,
  isBothReady: initialReadyGateReadinessState.isBothReady,
  partnerName: null,
  snoozedByPartner: false,
  snoozeExpiresAt: null,
  expiresAt: null,
  reason: null,
  inactiveReason: null,
  errorCode: null,
  terminal: null,
  serverNowMs: null,
  clientSyncedAtMs: null,
  clockSkewMs: null,
  phaseDeadlineAtMs: null,
  countdownDegraded: true,
  realtimeDegraded: false,
  sequenceGapUnresolved: false,
});

type ReadyGateSessionTruth = {
  participant_1_id?: string | null;
  participant_2_id?: string | null;
  session_seq?: number | null;
  ready_gate_status?: string | null;
  status?: string | null;
  result_status?: string | null;
  result_ready_gate_status?: string | null;
  ended_reason?: string | null;
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
  server_now_ms?: string | number | null;
  serverNowMs?: string | number | null;
  server_now?: string | number | null;
  serverNow?: string | number | null;
};

export type ReadyGateSyncResult =
  | {
      ok: true;
      status: string;
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
      status?: string | null;
      reason?: string | null;
      inactiveReason?: string | null;
      errorCode?: string | null;
      code?: string | null;
      isTerminal?: boolean;
      terminal?: boolean | null;
    };

type ReadyGateSyncSuccess = Extract<ReadyGateSyncResult, { ok: true }>;
export type ReadyGateTransitionResult = ReadyGateSyncResult;

export type ReadyGateTerminalDetail = {
  status?: string | null;
  reason?: string | null;
  inactiveReason?: string | null;
  errorCode?: string | null;
  code?: string | null;
  terminal?: boolean | null;
};

export type UseReadyGateOptions = {
  eventId?: string | null;
  onBothReady?: (sourceAction?: ReadyGateBothReadySourceAction) => void;
  onForfeited?: (reason: 'timeout' | 'skip', detail?: ReadyGateTerminalDetail) => void;
};

export function useReadyGate(
  sessionId: string | null | undefined,
  userId: string | null | undefined,
  options?: UseReadyGateOptions,
) {
  const broadcastV2 = useFeatureFlag('video_date.broadcast_v2');
  const timelineV2 = useFeatureFlag('video_date.timeline_v2');
  const readyGateResilientClockAlias = useFeatureFlag('video_date.ready_gate_resilient_clock_v1');
  const markReadyV2 = useFeatureFlag('video_date.outbox_v2.mark_ready');
  const forfeitV2 = useFeatureFlag('video_date.outbox_v2.forfeit');
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
    stateSessionId: sessionId ?? null,
  }));

  const onBothReadyRef = useRef(options?.onBothReady);
  const onForfeitedRef = useRef(options?.onForfeited);
  const activeReadyGateSessionIdRef = useRef<string | null | undefined>(sessionId);
  const terminalHandledRef = useRef<string | null>(null);
  const participantPositionRef = useRef<ReadyGateParticipantPosition | null>(null);
  const syncSessionInFlightRef = useRef<Promise<ReadyGateSyncResult> | null>(null);
  const sessionSeqRef = useRef<number | null>(null);
  const broadcastRefetchInFlightRef = useRef(false);
  const broadcastGapRecoveryRef = useRef<VideoDateBroadcastGapRecoveryState | null>(null);
  const broadcastGapRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyGateTruthRef = useRef<{
    status: string;
    sessionSeq: number | null;
    expiresAt: string | null;
    serverNowMs: number | null;
    clientSyncedAtMs: number | null;
    clockSkewMs: number | null;
    phaseDeadlineAtMs: number | null;
  }>({
    status: 'queued',
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
    onBothReadyRef.current = options?.onBothReady;
    onForfeitedRef.current = options?.onForfeited;
  }, [options?.onBothReady, options?.onForfeited]);

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
      status: 'queued',
      sessionSeq: null,
      expiresAt: null,
      serverNowMs: null,
      clientSyncedAtMs: null,
      clockSkewMs: null,
      phaseDeadlineAtMs: null,
    };
    if (broadcastGapRetryTimerRef.current) {
      clearTimeout(broadcastGapRetryTimerRef.current);
      broadcastGapRetryTimerRef.current = null;
    }
    readyGateRealtimeSupervisorRef.current?.dispose();
    readyGateRealtimeSupervisorRef.current = null;
    setState({
      ...createInitialReadyGateState(),
      stateSessionId: sessionId ?? null,
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
  }, [sessionId]);

  const notifyTerminal = useCallback((
    status: string,
    detail?: ReadyGateTerminalDetail,
    bothReadySourceAction: ReadyGateBothReadySourceAction = 'both_ready_observed',
  ) => {
    if (activeReadyGateSessionIdRef.current !== sessionId) return;
    const terminalKey = `${status}:${detail?.reason ?? detail?.inactiveReason ?? detail?.errorCode ?? detail?.code ?? ''}`;
    if (terminalHandledRef.current === terminalKey) return;
    terminalHandledRef.current = terminalKey;
    if (status === BOTH_READY) {
      onBothReadyRef.current?.(bothReadySourceAction);
    } else if (isReadyGateTerminalStatus(status)) {
      onForfeitedRef.current?.(status === EXPIRED ? 'timeout' : 'skip', {
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
  ): ReadyGateSyncSuccess => {
    if (activeReadyGateSessionIdRef.current !== sessionId) {
      const currentTruth = readyGateTruthRef.current;
      return {
        ok: true,
        status: currentTruth.status,
        isTerminal: isReadyGateTerminalStatus(currentTruth.status),
        expiresAt: currentTruth.expiresAt,
        reason: truth.reason ?? truth.ended_reason ?? null,
        inactiveReason: truth.inactive_reason ?? null,
        errorCode: truth.error_code ?? truth.code ?? null,
        code: truth.code ?? null,
        terminal: truth.terminal ?? null,
      };
    }

    const participantPosition = getReadyGateParticipantPosition(
      truth,
      userId,
      participantPositionRef.current,
    );
    participantPositionRef.current = participantPosition;

    const status =
      truth.ready_gate_status ??
      truth.status ??
      truth.result_ready_gate_status ??
      truth.result_status ??
      'queued';
    const hasSnoozedBy = Object.prototype.hasOwnProperty.call(truth, 'snoozed_by');
    const hasSnoozeExpiresAt = Object.prototype.hasOwnProperty.call(truth, 'snooze_expires_at');
    const hasReadyGateExpiresAt = Object.prototype.hasOwnProperty.call(truth, 'ready_gate_expires_at');
    const expiresAt = typeof truth.ready_gate_expires_at === 'string' ? truth.ready_gate_expires_at : null;
    const incomingSeq = typeof truth.session_seq === 'number' && Number.isFinite(truth.session_seq)
      ? Math.max(0, Math.floor(truth.session_seq))
      : null;
    const currentTruth = readyGateTruthRef.current;
    if (!shouldCommitReadyGateTruth({
      currentStatus: currentTruth.status,
      incomingStatus: status,
      currentSeq: currentTruth.sessionSeq,
      incomingSeq,
    })) {
      rcBreadcrumb(RC_CATEGORY.readyGate, 'stale_ready_gate_truth_ignored', {
        current_status: currentTruth.status,
        incoming_status: status,
        current_seq: currentTruth.sessionSeq,
        incoming_seq: incomingSeq,
      });
      return {
        ok: true,
        status: currentTruth.status,
        isTerminal: isReadyGateTerminalStatus(currentTruth.status),
        expiresAt: currentTruth.expiresAt,
        reason: truth.reason ?? truth.ended_reason ?? null,
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
      parseReadyGateExpiryMs(committedExpiresAt) ?? currentTruth.phaseDeadlineAtMs;
    const committedClockSkewMs =
      committedServerNowMs != null && committedClientSyncedAtMs != null
        ? committedServerNowMs - committedClientSyncedAtMs
        : currentTruth.clockSkewMs;
    readyGateTruthRef.current = {
      status,
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
          ready_gate_status: status,
        },
        userId,
        previous: {
          ...prev,
          participantPosition,
        },
      });

      return {
        stateSessionId: sessionId ?? null,
        status,
        iAmReady: readiness.iAmReady,
        partnerReady: readiness.partnerReady,
        iAmReadyKnown: readiness.iAmReadyKnown,
        partnerReadyKnown: readiness.partnerReadyKnown,
        isBothReady: readiness.isBothReady,
        partnerName: options?.partnerName ?? prev.partnerName,
        snoozedByPartner: hasSnoozedBy
          ? typeof truth.snoozed_by === 'string' && truth.snoozed_by !== userId
          : prev.snoozedByPartner,
        snoozeExpiresAt: hasSnoozeExpiresAt
          ? typeof truth.snooze_expires_at === 'string'
            ? truth.snooze_expires_at
            : null
          : prev.snoozeExpiresAt,
        expiresAt: committedExpiresAt,
        reason: truth.reason ?? truth.ended_reason ?? null,
        inactiveReason: truth.inactive_reason ?? null,
        errorCode: truth.error_code ?? truth.code ?? null,
        terminal: truth.terminal ?? null,
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

    if (isReadyGateTerminalStatus(status)) {
      notifyTerminal(status, {
        status,
        reason: truth.reason ?? truth.ended_reason ?? null,
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
      status,
      isTerminal: isReadyGateTerminalStatus(status),
      expiresAt: committedExpiresAt,
      reason: truth.reason ?? truth.ended_reason ?? null,
      inactiveReason: truth.inactive_reason ?? null,
      errorCode: truth.error_code ?? truth.code ?? null,
      code: truth.code ?? null,
      terminal: truth.terminal ?? null,
    };
  }, [notifyTerminal, readyGateClockEnabled, sessionId, userId]);

  const fetchPartnerName = useCallback(async (partnerId: string | null): Promise<string | null> => {
    if (!partnerId) return null;
    try {
      const { data: profile, error } = await supabase.rpc('get_profile_for_viewer', { p_target_id: partnerId });
      if (error) {
        if (__DEV__) console.warn('[readyGateApi] partner profile display lookup degraded:', error.message);
        return null;
      }
      const partnerProfile = profile as { name?: string | null } | null;
      return partnerProfile?.name ?? null;
    } catch (error) {
      if (__DEV__) {
        console.warn(
          '[readyGateApi] partner profile display lookup threw:',
          error instanceof Error ? error.message : String(error),
        );
      }
      return null;
    }
  }, []);

  const applyStartSnapshot = useCallback(async (
    snapshot: Awaited<ReturnType<typeof fetchVideoDateStartSnapshot>>,
  ): Promise<ReadyGateSyncResult | null> => {
    if (!snapshot.ok) return null;
    const partnerName = await fetchPartnerName(snapshot.partnerId);
    return applyReadyGateTruth(snapshot.raw as ReadyGateSessionTruth, {
      partnerName: partnerName ?? 'Your match',
    });
  }, [applyReadyGateTruth, fetchPartnerName]);

  const fetchSession = useCallback(async (): Promise<ReadyGateSyncResult | null> => {
    if (!sessionId || !userId) return null;
    const snapshot = await fetchVideoDateStartSnapshot(sessionId);
    const snapshotResult = await applyStartSnapshot(snapshot);
    if (snapshotResult) return snapshotResult;
    if (snapshot.terminal === true || snapshot.retryable === false) {
      return {
        ok: false,
        error: snapshot.error ?? 'ready_gate_start_snapshot_failed',
        status: snapshot.readyGateStatus,
        terminal: snapshot.terminal,
      };
    }

    const { data: session, error } = await supabase
      .from('video_sessions')
      .select(
        'participant_1_id, participant_2_id, session_seq, ready_gate_status, ready_participant_1_at, ready_participant_2_at, ready_gate_expires_at, snoozed_by, snooze_expires_at, ended_reason',
      )
      .eq('id', sessionId)
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        error: error.message,
        errorCode: error.code ?? null,
        terminal: false,
      };
    }

    if (!session) {
      return {
        ok: false,
        error: 'session_not_found',
        terminal: false,
      };
    }

    const isP1 = session.participant_1_id === userId;
    const isParticipant = isP1 || session.participant_2_id === userId;
    if (!isParticipant) {
      return {
        ok: false,
        error: 'not_session_participant',
        errorCode: 'not_session_participant',
        terminal: true,
      };
    }
    const partnerId = isP1 ? session.participant_2_id : session.participant_1_id;

    const partnerName = await fetchPartnerName(partnerId);

    return applyReadyGateTruth(session, { partnerName: partnerName ?? 'Your match' });
  }, [sessionId, userId, applyReadyGateTruth, applyStartSnapshot, fetchPartnerName]);

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
      platform: 'native',
      session_id: sessionId,
      event_id: options?.eventId ?? null,
      source_surface: 'use_ready_gate',
      ...payload,
    });
  }, [options?.eventId, sessionId]);

  const fetchCanonicalReadyGateSnapshot = useCallback(async (
    context: ReadyGateRealtimeSupervisorContext,
  ) => {
    if (!sessionId || !userId) return null;
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
  }, [fetchSession, readyGateClockEnabled, sessionId, setSequenceGapUnresolved, userId]);

  useEffect(() => {
    readyGateRealtimeSupervisorRef.current?.dispose();
    if (!sessionId || !userId) {
      readyGateRealtimeSupervisorRef.current = null;
      return undefined;
    }

    readyGateRealtimeSupervisorRef.current = createReadyGateRealtimeSupervisor({
      sessionId,
      eventId: options?.eventId ?? null,
      platform: 'native',
      sourceSurface: 'use_ready_gate',
      emitTelemetry: emitReadyGateRealtimeTelemetry,
      fetchCanonicalSnapshot: fetchCanonicalReadyGateSnapshot,
      onDegradedChange: (degraded, context) => {
        setState((prev) => (prev.realtimeDegraded === degraded ? prev : { ...prev, realtimeDegraded: degraded }));
        rcBreadcrumb(RC_CATEGORY.readyGate, degraded ? 'ready_gate_realtime_degraded' : 'ready_gate_realtime_recovered', {
          session_id: sessionId,
          event_id: options?.eventId ?? null,
          source: context.source,
          status: context.status ?? null,
          reason: context.reason ?? null,
          attempt: context.attempt ?? null,
          delay_ms: context.delayMs ?? null,
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
    fetchCanonicalReadyGateSnapshot,
    options?.eventId,
    sessionId,
    userId,
  ]);

  useEffect(() => {
    if (!sessionId || !userId) return;
    const channel = supabase
      .channel(`ready-gate-${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'video_sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          applyReadyGateTruth(payload.new as ReadyGateSessionTruth);
        },
      )
      .subscribe((status, error) => {
        readyGateRealtimeSupervisorRef.current?.handleStatus('postgres_video_sessions', status, error ?? null);
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    sessionId,
    userId,
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
      if (!sessionId || !userId) return;
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
        rcBreadcrumb(RC_CATEGORY.readyGate, 'broadcast_seq_gap_snapshot_retry', {
          sessionId,
          eventId: options?.eventId ?? null,
          source,
          targetSeq: state.targetSeq,
          expectedSeq: state.expectedSeq,
          attempt: state.attempts + 1,
          snapshotOk: snapshot.ok,
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
          void attemptBroadcastGapSnapshotRecovery('bounded_timer');
        }, delayMs);
      }
    },
    [clearBroadcastGapRetryTimer, fetchSession, options?.eventId, sessionId, setSequenceGapUnresolved, userId],
  );

  const reconcileBroadcastEvent = useCallback(
    async (event: VideoDateSessionBroadcastEvent) => {
      if (!sessionId || !userId) return;
      const decision = resolveVideoDateSessionSeqDecision(sessionSeqRef.current, event.sessionSeq);
      if (decision.action === 'invalid' || decision.action === 'duplicate') return;

      if (decision.action === 'gap') {
        broadcastGapRecoveryRef.current = mergeVideoDateBroadcastGapRecovery(broadcastGapRecoveryRef.current, {
          sessionId,
          targetSeq: event.sessionSeq,
          expectedSeq: decision.expectedSeq,
        });
        setSequenceGapUnresolved(true);
        void attemptBroadcastGapSnapshotRecovery('broadcast_seq_gap');
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
        void attemptBroadcastGapSnapshotRecovery('broadcast_event_progress');
      } else if (broadcastGapRecoveryRef.current) {
        void attemptBroadcastGapSnapshotRecovery('broadcast_refetch_complete');
      }
    },
    [
      attemptBroadcastGapSnapshotRecovery,
      clearBroadcastGapRetryTimer,
      fetchSession,
      sessionId,
      setSequenceGapUnresolved,
      userId,
    ],
  );

  useEffect(() => {
    if (!sessionId || !userId || !readyGateBroadcastEnabled) return;
    const subscription = createVideoDateSessionChannel(supabase, {
      sessionId,
      onEvent: (event) => {
        void reconcileBroadcastEvent(event);
      },
      onInvalidPayload: () => {
        rcBreadcrumb(RC_CATEGORY.readyGate, 'broadcast_invalid_payload_ignored', {
          sessionId,
          eventId: options?.eventId ?? null,
        });
      },
      onStatusChange: (status, error) => {
        readyGateRealtimeSupervisorRef.current?.handleStatus(
          'private_broadcast',
          status,
          error instanceof Error ? error : error ?? null,
        );
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          rcBreadcrumb(RC_CATEGORY.readyGate, 'broadcast_channel_degraded', {
            sessionId,
            eventId: options?.eventId ?? null,
            status,
            error: error instanceof Error ? error.message : String(error ?? ''),
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
    options?.eventId,
    reconcileBroadcastEvent,
    setSequenceGapUnresolved,
    sessionId,
    userId,
  ]);

  useEffect(() => {
    if (readyGateBroadcastEnabled) return;
    clearBroadcastGapRetryTimer();
    broadcastGapRecoveryRef.current = null;
    setSequenceGapUnresolved(false);
    readyGateRealtimeSupervisorRef.current?.clearSource('private_broadcast', 'broadcast_disabled');
  }, [clearBroadcastGapRetryTimer, readyGateBroadcastEnabled, setSequenceGapUnresolved]);

  const runReadyGateTransition = useCallback(async (
    action: ReadyGateTransitionAction,
  ): Promise<ReadyGateTransitionResult> => {
    if (!sessionId || !userId) {
      return { ok: false, error: 'missing_session_or_user', terminal: false };
    }
    const startedAt = Date.now();
    const startedContext = recordReadyGateToDateLatencyCheckpoint({
      sessionId,
      platform: 'native',
      eventId: options?.eventId ?? null,
      sourceSurface: 'use_ready_gate',
      checkpoint: 'ready_gate_transition_started',
      nowMs: startedAt,
    });
    trackEvent(
      LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
      buildReadyGateToDateLatencyPayload({
        context: startedContext,
        checkpoint: 'ready_gate_transition_started',
        sourceAction: action,
        outcome: 'success',
      }),
    );
    // Static smoke contract: terminal actions still await
    // const { error } = await supabase.rpc('ready_gate_transition' before closing.
    const transitionResult =
      action === 'mark_ready' && markReadyV2.enabled
        ? await supabase.rpc('video_session_mark_ready_v2' as never, {
            p_session_id: sessionId,
            p_idempotency_key: buildVideoDateTransitionIdempotencyKey(sessionId, 'mark_ready'),
          } as never)
        : action === 'forfeit' && forfeitV2.enabled
          ? await supabase.rpc('video_session_forfeit_v2' as never, {
              p_session_id: sessionId,
              p_reason: 'ready_gate_forfeit',
              p_idempotency_key: buildVideoDateTransitionIdempotencyKey(sessionId, 'forfeit'),
            } as never)
          : await supabase.rpc('ready_gate_transition', { p_session_id: sessionId, p_action: action });
    const { error } = transitionResult;
    const data = transitionResult.data;
    if (error) {
      const reason = sanitizeReasonCode(error.code ?? 'rpc_error', 'rpc_error');
      rcBreadcrumb(RC_CATEGORY.readyGate, `${action}_rpc_error`, {
        code: error.code ?? null,
        message_snippet: String(error.message ?? '').slice(0, 120),
      });
      trackEvent(EventLobbyObservabilityEvents.READY_GATE_TRANSITION, {
        platform: 'native',
        event_id: options?.eventId ?? null,
        session_id: sessionId,
        action,
        outcome: 'rpc_error',
        reason,
        ready_gate_status: null,
        terminal: false,
        latency_ms: Date.now() - startedAt,
        source_surface: 'use_ready_gate',
      });
      return {
        ok: false,
        error: error.message,
        errorCode: error.code ?? null,
        terminal: false,
      };
    }
    const payload = data && typeof data === 'object' && !Array.isArray(data)
      ? (data as ReadyGateSessionTruth & { success?: boolean; error?: string | null })
      : null;
    if (payload) {
      const payloadStatus =
        payload.ready_gate_status ??
        payload.status ??
        payload.result_ready_gate_status ??
        payload.result_status ??
        'queued';
      const result = applyReadyGateTruth({
        ...payload,
        ready_gate_status:
          payload.ready_gate_status ??
          payload.status ??
          payload.result_ready_gate_status ??
          payload.result_status,
      }, {
        bothReadySourceAction:
          action === 'mark_ready' && payloadStatus === BOTH_READY
            ? 'both_ready_observed_via_rpc_short_circuit'
            : undefined,
      });
      const errorCode = payload.error_code ?? payload.code ?? null;
      const reason = sanitizeReasonCode(
        payload.reason ?? payload.error ?? errorCode ?? result.status ?? action,
        action,
      );
      if (payload.success === false) {
        const terminal =
          payload.terminal === true ||
          result.isTerminal ||
          errorCode === 'EVENT_NOT_ACTIVE' ||
          payload.reason === 'event_not_active';
        if (terminal && !result.isTerminal && result.status !== BOTH_READY) {
          notifyTerminal(EXPIRED, {
            status:
              payload.ready_gate_status ??
              payload.status ??
              payload.result_ready_gate_status ??
              payload.result_status ??
              EXPIRED,
            reason: payload.reason ?? payload.error ?? null,
            inactiveReason: payload.inactive_reason ?? null,
            errorCode,
            code: payload.code ?? null,
            terminal: true,
          });
        }
        rcBreadcrumb(RC_CATEGORY.readyGate, `${action}_rpc_unsuccessful_payload`, {
          ready_gate_status: result.status,
          reason: payload.reason ?? payload.error ?? null,
          error_code: errorCode,
          inactive_reason: payload.inactive_reason ?? null,
          terminal,
        });
        trackEvent(EventLobbyObservabilityEvents.READY_GATE_TRANSITION, {
          platform: 'native',
          event_id: options?.eventId ?? null,
          session_id: sessionId,
          action,
          outcome: 'rejected',
          reason,
          ready_gate_status: result.status,
          terminal,
          latency_ms: Date.now() - startedAt,
          source_surface: 'use_ready_gate',
        });
        if (terminal) {
          return {
            ok: true,
            status: result.status,
            isTerminal: true,
            expiresAt: result.expiresAt,
            reason: payload.reason ?? payload.error ?? null,
            inactiveReason: payload.inactive_reason ?? null,
            errorCode,
            code: payload.code ?? null,
            terminal: true,
          };
        }
        return {
          ok: false,
          error: payload.error ?? 'ready_gate_transition_rejected',
          status: result.status,
          reason: payload.reason ?? null,
          inactiveReason: payload.inactive_reason ?? null,
          errorCode,
          code: payload.code ?? null,
          isTerminal: false,
          terminal: false,
        };
      }
      trackEvent(EventLobbyObservabilityEvents.READY_GATE_TRANSITION, {
        platform: 'native',
        event_id: options?.eventId ?? null,
        session_id: sessionId,
        action,
        outcome: result.isTerminal ? 'terminal' : 'success',
        reason,
        ready_gate_status: result.status,
        terminal: payload.terminal === true || result.isTerminal,
        latency_ms: Date.now() - startedAt,
        source_surface: 'use_ready_gate',
      });
      const successContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: 'native',
        eventId: options?.eventId ?? null,
        sourceSurface: 'use_ready_gate',
        checkpoint: 'ready_gate_transition_success',
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: successContext,
          checkpoint: 'ready_gate_transition_success',
          sourceAction: action,
          outcome: 'success',
        }),
      );
      const hasReadyTimestamps =
        Object.prototype.hasOwnProperty.call(payload, 'ready_participant_1_at') &&
        Object.prototype.hasOwnProperty.call(payload, 'ready_participant_2_at');
      if (action === 'mark_ready' && !result.isTerminal && !hasReadyTimestamps) {
        const refreshed = await fetchSession();
        if (refreshed?.ok === true) return refreshed;
      }
      return result;
    }

    trackEvent(EventLobbyObservabilityEvents.READY_GATE_TRANSITION, {
      platform: 'native',
      event_id: options?.eventId ?? null,
      session_id: sessionId,
      action,
      outcome: 'success',
      reason: action,
      ready_gate_status: null,
      terminal: false,
      latency_ms: Date.now() - startedAt,
      source_surface: 'use_ready_gate',
    });

    const successContext = recordReadyGateToDateLatencyCheckpoint({
      sessionId,
      platform: 'native',
      eventId: options?.eventId ?? null,
      sourceSurface: 'use_ready_gate',
      checkpoint: 'ready_gate_transition_success',
    });
    trackEvent(
      LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
      buildReadyGateToDateLatencyPayload({
        context: successContext,
        checkpoint: 'ready_gate_transition_success',
        sourceAction: action,
        outcome: 'success',
      }),
    );
    const refreshed = await fetchSession();
    if (refreshed?.ok === true) return refreshed;

    return {
      ok: true,
      status: state.status,
      isTerminal: isReadyGateTerminalStatus(state.status),
      expiresAt: state.expiresAt,
      reason: action,
      terminal: isReadyGateTerminalStatus(state.status),
    };
  }, [
    sessionId,
    userId,
    options?.eventId,
    markReadyV2.enabled,
    forfeitV2.enabled,
    applyReadyGateTruth,
    fetchSession,
    notifyTerminal,
    state.expiresAt,
    state.status,
  ]);

  const syncSession = useCallback(async (): Promise<ReadyGateSyncResult> => {
    if (!sessionId || !userId) return { ok: false, error: 'missing_session_or_user' };
    if (syncSessionInFlightRef.current) return syncSessionInFlightRef.current;

    const syncPromise = (async (): Promise<ReadyGateSyncResult> => {
      const snapshot = await fetchVideoDateStartSnapshot(sessionId);
      const snapshotResult = await applyStartSnapshot(snapshot);
      if (snapshotResult) return snapshotResult;
      if (snapshot.terminal === true || snapshot.retryable === false) {
        return {
          ok: false,
          error: snapshot.error ?? 'ready_gate_start_snapshot_failed',
          status: snapshot.readyGateStatus,
          terminal: snapshot.terminal,
        };
      }

      const { data, error } = await supabase.rpc('ready_gate_transition', {
        p_session_id: sessionId,
        p_action: 'sync' satisfies ReadyGateTransitionAction,
      });
      if (error) {
        rcBreadcrumb(RC_CATEGORY.readyGate, 'sync_rpc_error', {
          code: error.code ?? null,
          message_snippet: String(error.message ?? '').slice(0, 120),
        });
        return { ok: false, error: error.message };
      }

      const payload = data && typeof data === 'object' && !Array.isArray(data)
        ? (data as ReadyGateSessionTruth & { success?: boolean; error?: string | null })
        : null;
      if (!payload) {
        return { ok: false, error: 'invalid_ready_gate_sync_response' };
      }
      if (payload.success === false) {
        const normalizedStatus =
          payload.ready_gate_status ??
          payload.status ??
          payload.result_ready_gate_status ??
          payload.result_status;
        if (normalizedStatus) {
          applyReadyGateTruth({
            ...payload,
            ready_gate_status: normalizedStatus,
          });
        }
        const errorCode = payload.error_code ?? payload.code ?? null;
        if (
          payload.terminal === true ||
          errorCode === 'EVENT_NOT_ACTIVE' ||
          payload.reason === 'event_not_active'
        ) {
          if (readyGateTruthRef.current.status === BOTH_READY) {
            return {
              ok: false,
              error: payload.error ?? 'ready_gate_sync_failed',
              reason: payload.reason ?? payload.ended_reason ?? null,
              inactiveReason: payload.inactive_reason ?? null,
              errorCode,
              terminal: payload.terminal ?? null,
            };
          }
          const terminalStatus =
            isReadyGateTerminalStatus(normalizedStatus) && normalizedStatus ? normalizedStatus : EXPIRED;
          notifyTerminal(terminalStatus, {
            status: normalizedStatus ?? terminalStatus,
            reason: payload.reason ?? payload.error ?? payload.ended_reason ?? null,
            inactiveReason: payload.inactive_reason ?? null,
            errorCode,
            code: payload.code ?? null,
            terminal: true,
          });
        }
        return {
          ok: false,
          error: payload.error ?? 'ready_gate_sync_failed',
          reason: payload.reason ?? payload.ended_reason ?? null,
          inactiveReason: payload.inactive_reason ?? null,
          errorCode,
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
  }, [sessionId, userId, applyReadyGateTruth, applyStartSnapshot, notifyTerminal]);

  const markReady = useCallback(async (): Promise<ReadyGateTransitionResult> => {
    return runReadyGateTransition('mark_ready');
  }, [runReadyGateTransition]);

  const forfeit = useCallback(async (): Promise<ReadyGateTransitionResult> => {
    return runReadyGateTransition('forfeit');
  }, [runReadyGateTransition]);

  const snooze = useCallback(async (): Promise<ReadyGateTransitionResult> => {
    return runReadyGateTransition('snooze');
  }, [runReadyGateTransition]);

  useEffect(() => {
    if (!sessionId || !userId) return;
    let cancelled = false;

    void (async () => {
      const syncResult = await syncSession();
      if (cancelled) return;
      const hydrated = await fetchSession();
      if (cancelled || hydrated?.ok === true || syncResult.ok === true) return;
      rcBreadcrumb(RC_CATEGORY.readyGate, 'initial_server_clock_hydration_deferred', {
        session_id: sessionId,
        event_id: options?.eventId ?? null,
        sync_error: syncResult.error,
        fetch_error: hydrated?.ok === false ? hydrated.error : null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchSession, options?.eventId, sessionId, syncSession, userId]);

  // Fallback sync while ready gate is active in case realtime misses transitions.
  useEffect(() => {
    if (!sessionId || !userId) return;
    if ([BOTH_READY, FORFEITED, EXPIRED].includes(state.status)) return;
    if (!state.realtimeDegraded && !state.sequenceGapUnresolved) return;

    const intervalId = setInterval(() => {
      void syncSession();
    }, POLL_MS);

    return () => clearInterval(intervalId);
  }, [sessionId, state.realtimeDegraded, state.sequenceGapUnresolved, state.status, syncSession, userId]);

  const isCurrentSessionState = state.stateSessionId === (sessionId ?? null);
  const isBothReady = isCurrentSessionState && (state.isBothReady || state.status === BOTH_READY);
  const isForfeited = isReadyGateTerminalStatus(state.status) && state.status !== BOTH_READY;
  const isSnoozed = state.status === SNOOZED;

  return {
    ...state,
    markReady,
    forfeit,
    snooze,
    syncSession,
    isBothReady,
    isForfeited,
    isSnoozed,
    refetch: fetchSession,
    retryBroadcastGapRecovery: attemptBroadcastGapSnapshotRecovery,
    readyGateClockEnabled,
    readyGateBroadcastEnabled,
  };
}
