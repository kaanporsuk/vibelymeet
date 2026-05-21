import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { fetchVideoDateSnapshot } from '@/lib/videoDateSnapshot';
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
  type ReadyGateParticipantPosition,
} from '@clientShared/matching/readyGateReadiness';
import { buildVideoDateTransitionIdempotencyKey } from '@clientShared/matching/videoDateTransitionCommands';
import {
  createVideoDateSessionChannel,
  resolveVideoDateSessionSeqDecision,
  type VideoDateSessionBroadcastEvent,
} from '@clientShared/matching/videoDateSessionChannel';

const BOTH_READY = 'both_ready';
const FORFEITED = 'forfeited';
const SNOOZED = 'snoozed';
const EXPIRED = 'expired';
const POLL_MS = 2000;
type ReadyGateTransitionAction = 'mark_ready' | 'forfeit' | 'snooze' | 'sync';
type ReadyGateBothReadySourceAction =
  | 'both_ready_observed'
  | 'both_ready_observed_via_rpc_short_circuit';

export type ReadyGateState = {
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
};

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
  const markReadyV2 = useFeatureFlag('video_date.outbox_v2.mark_ready');
  const forfeitV2 = useFeatureFlag('video_date.outbox_v2.forfeit');
  const [state, setState] = useState<ReadyGateState>({
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
  });

  const onBothReadyRef = useRef(options?.onBothReady);
  const onForfeitedRef = useRef(options?.onForfeited);
  const terminalHandledRef = useRef<string | null>(null);
  const participantPositionRef = useRef<ReadyGateParticipantPosition | null>(null);
  const syncSessionInFlightRef = useRef<Promise<ReadyGateSyncResult> | null>(null);
  const sessionSeqRef = useRef<number | null>(null);
  const broadcastRefetchInFlightRef = useRef(false);
  useEffect(() => {
    onBothReadyRef.current = options?.onBothReady;
    onForfeitedRef.current = options?.onForfeited;
  }, [options?.onBothReady, options?.onForfeited]);

  useEffect(() => {
    terminalHandledRef.current = null;
    participantPositionRef.current = null;
    syncSessionInFlightRef.current = null;
    sessionSeqRef.current = null;
    broadcastRefetchInFlightRef.current = false;
  }, [sessionId]);

  const notifyTerminal = useCallback((
    status: string,
    detail?: ReadyGateTerminalDetail,
    bothReadySourceAction: ReadyGateBothReadySourceAction = 'both_ready_observed',
  ) => {
    const terminalKey = `${status}:${detail?.reason ?? detail?.inactiveReason ?? detail?.errorCode ?? detail?.code ?? ''}`;
    if (terminalHandledRef.current === terminalKey) return;
    terminalHandledRef.current = terminalKey;
    if (status === BOTH_READY) {
      onBothReadyRef.current?.(bothReadySourceAction);
    } else if (status === FORFEITED || status === EXPIRED) {
      onForfeitedRef.current?.(status === EXPIRED ? 'timeout' : 'skip', {
        status,
        ...detail,
      });
    }
  }, []);

  const applyReadyGateTruth = useCallback((
    truth: ReadyGateSessionTruth,
    options?: {
      partnerName?: string | null;
      bothReadySourceAction?: ReadyGateBothReadySourceAction;
    },
  ): ReadyGateSyncSuccess => {
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
    if (typeof truth.session_seq === 'number' && Number.isFinite(truth.session_seq)) {
      sessionSeqRef.current = truth.session_seq;
    }

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
        expiresAt: hasReadyGateExpiresAt ? expiresAt : prev.expiresAt,
        reason: truth.reason ?? truth.ended_reason ?? null,
        inactiveReason: truth.inactive_reason ?? null,
        errorCode: truth.error_code ?? truth.code ?? null,
        terminal: truth.terminal ?? null,
      };
    });

    if (status === BOTH_READY || status === FORFEITED || status === EXPIRED) {
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
      isTerminal: status === BOTH_READY || status === FORFEITED || status === EXPIRED,
      expiresAt,
      reason: truth.reason ?? truth.ended_reason ?? null,
      inactiveReason: truth.inactive_reason ?? null,
      errorCode: truth.error_code ?? truth.code ?? null,
      code: truth.code ?? null,
      terminal: truth.terminal ?? null,
    };
  }, [notifyTerminal, userId]);

  const fetchSession = useCallback(async (): Promise<ReadyGateSyncResult | null> => {
    if (!sessionId || !userId) return null;
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
    const partnerId = isP1 ? session.participant_2_id : session.participant_1_id;

    let partnerName: string | null = null;
    const { data: profile } = await supabase.rpc('get_profile_for_viewer', { p_target_id: partnerId });
    const partnerProfile = profile as { name?: string | null } | null;
    if (partnerProfile) partnerName = partnerProfile.name ?? 'Your match';

    return applyReadyGateTruth(session, { partnerName });
  }, [sessionId, userId, applyReadyGateTruth]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

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
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, userId, applyReadyGateTruth]);

  const reconcileBroadcastEvent = useCallback(
    async (event: VideoDateSessionBroadcastEvent) => {
      if (!sessionId || !userId) return;
      const decision = resolveVideoDateSessionSeqDecision(sessionSeqRef.current, event.sessionSeq);
      if (decision.action === 'invalid' || decision.action === 'duplicate') return;

      sessionSeqRef.current = event.sessionSeq;
      if (broadcastRefetchInFlightRef.current) return;
      broadcastRefetchInFlightRef.current = true;
      try {
        if (decision.action === 'gap') {
          const snapshot = await fetchVideoDateSnapshot(sessionId, { includeToken: false });
          if (snapshot.ok) sessionSeqRef.current = snapshot.seq;
          rcBreadcrumb(RC_CATEGORY.readyGate, 'broadcast_seq_gap_snapshot_refetch', {
            sessionId,
            eventId: options?.eventId ?? null,
            eventKind: event.kind,
            incomingSeq: event.sessionSeq,
            expectedSeq: decision.expectedSeq,
            snapshotOk: snapshot.ok,
          });
        }
        await fetchSession();
      } finally {
        broadcastRefetchInFlightRef.current = false;
      }
    },
    [fetchSession, options?.eventId, sessionId, userId],
  );

  useEffect(() => {
    if (!sessionId || !userId || !broadcastV2.enabled) return;
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
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
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
    };
  }, [broadcastV2.enabled, options?.eventId, reconcileBroadcastEvent, sessionId, userId]);

  // Fallback sync while ready gate is active in case realtime misses transitions.
  useEffect(() => {
    if (!sessionId || !userId) return;
    if ([BOTH_READY, FORFEITED, EXPIRED].includes(state.status)) return;

    const intervalId = setInterval(() => {
      void fetchSession();
    }, POLL_MS);

    return () => clearInterval(intervalId);
  }, [sessionId, userId, state.status, fetchSession]);

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
        if (terminal && !result.isTerminal) {
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
      isTerminal: state.status === BOTH_READY || state.status === FORFEITED || state.status === EXPIRED,
      expiresAt: state.expiresAt,
      reason: action,
      terminal: state.status === BOTH_READY || state.status === FORFEITED || state.status === EXPIRED,
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
          const terminalStatus =
            normalizedStatus === BOTH_READY || normalizedStatus === FORFEITED || normalizedStatus === EXPIRED
              ? normalizedStatus
              : EXPIRED;
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
  }, [sessionId, userId, applyReadyGateTruth, notifyTerminal]);

  const markReady = useCallback(async (): Promise<ReadyGateTransitionResult> => {
    return runReadyGateTransition('mark_ready');
  }, [runReadyGateTransition]);

  const forfeit = useCallback(async (): Promise<ReadyGateTransitionResult> => {
    return runReadyGateTransition('forfeit');
  }, [runReadyGateTransition]);

  const snooze = useCallback(async (): Promise<ReadyGateTransitionResult> => {
    return runReadyGateTransition('snooze');
  }, [runReadyGateTransition]);

  const isBothReady = state.isBothReady || state.status === BOTH_READY;
  const isForfeited = state.status === FORFEITED || state.status === EXPIRED;
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
  };
}
