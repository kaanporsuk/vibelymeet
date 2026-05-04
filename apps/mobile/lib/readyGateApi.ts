import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
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

const BOTH_READY = 'both_ready';
const FORFEITED = 'forfeited';
const SNOOZED = 'snoozed';
const EXPIRED = 'expired';
const POLL_MS = 2000;
type ReadyGateTransitionAction = 'mark_ready' | 'forfeit' | 'snooze' | 'sync';

export type ReadyGateState = {
  status: string;
  iAmReady: boolean;
  partnerReady: boolean;
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
  ready_gate_status?: string | null;
  status?: string | null;
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
  onBothReady?: () => void;
  onForfeited?: (reason: 'timeout' | 'skip', detail?: ReadyGateTerminalDetail) => void;
};

export function useReadyGate(
  sessionId: string | null | undefined,
  userId: string | null | undefined,
  options?: UseReadyGateOptions,
) {
  const [state, setState] = useState<ReadyGateState>({
    status: 'queued',
    iAmReady: false,
    partnerReady: false,
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
  const participantPositionRef = useRef<'p1' | 'p2' | null>(null);
  const syncSessionInFlightRef = useRef<Promise<ReadyGateSyncResult> | null>(null);
  useEffect(() => {
    onBothReadyRef.current = options?.onBothReady;
    onForfeitedRef.current = options?.onForfeited;
  }, [options?.onBothReady, options?.onForfeited]);

  useEffect(() => {
    terminalHandledRef.current = null;
    participantPositionRef.current = null;
    syncSessionInFlightRef.current = null;
  }, [sessionId]);

  const notifyTerminal = useCallback((status: string, detail?: ReadyGateTerminalDetail) => {
    const terminalKey = `${status}:${detail?.reason ?? detail?.inactiveReason ?? detail?.errorCode ?? detail?.code ?? ''}`;
    if (terminalHandledRef.current === terminalKey) return;
    terminalHandledRef.current = terminalKey;
    if (status === BOTH_READY) {
      onBothReadyRef.current?.();
    } else if (status === FORFEITED || status === EXPIRED) {
      onForfeitedRef.current?.(status === EXPIRED ? 'timeout' : 'skip', {
        status,
        ...detail,
      });
    }
  }, []);

  const applyReadyGateTruth = useCallback((
    truth: ReadyGateSessionTruth,
    options?: { partnerName?: string | null },
  ): ReadyGateSyncSuccess => {
    const p1 = typeof truth.participant_1_id === 'string' ? truth.participant_1_id : null;
    const p2 = typeof truth.participant_2_id === 'string' ? truth.participant_2_id : null;
    if (userId && p1 && p2) {
      if (p1 === userId) {
        participantPositionRef.current = 'p1';
      } else if (p2 === userId) {
        participantPositionRef.current = 'p2';
      }
    }

    const position = participantPositionRef.current;
    const hasParticipantPosition = position === 'p1' || position === 'p2';
    const myReadyAt = position === 'p1' ? truth.ready_participant_1_at : truth.ready_participant_2_at;
    const partnerReadyAt = position === 'p1' ? truth.ready_participant_2_at : truth.ready_participant_1_at;
    const status = truth.ready_gate_status ?? truth.status ?? 'queued';
    const hasSnoozedBy = Object.prototype.hasOwnProperty.call(truth, 'snoozed_by');
    const hasSnoozeExpiresAt = Object.prototype.hasOwnProperty.call(truth, 'snooze_expires_at');
    const hasReadyGateExpiresAt = Object.prototype.hasOwnProperty.call(truth, 'ready_gate_expires_at');
    const expiresAt = typeof truth.ready_gate_expires_at === 'string' ? truth.ready_gate_expires_at : null;

    setState((prev) => ({
      status,
      iAmReady: hasParticipantPosition ? !!myReadyAt : prev.iAmReady,
      partnerReady: hasParticipantPosition ? !!partnerReadyAt : prev.partnerReady,
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
    }));

    if (status === BOTH_READY || status === FORFEITED || status === EXPIRED) {
      notifyTerminal(status, {
        status,
        reason: truth.reason ?? truth.ended_reason ?? null,
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

  const fetchSession = useCallback(async () => {
    if (!sessionId || !userId) return;
    const { data: session, error } = await supabase
      .from('video_sessions')
      .select(
        'participant_1_id, participant_2_id, ready_gate_status, ready_participant_1_at, ready_participant_2_at, ready_gate_expires_at, snoozed_by, snooze_expires_at, ended_reason',
      )
      .eq('id', sessionId)
      .maybeSingle();

    if (error || !session) return;

    const isP1 = session.participant_1_id === userId;
    const partnerId = isP1 ? session.participant_2_id : session.participant_1_id;

    let partnerName: string | null = null;
    const { data: profile } = await supabase.rpc('get_profile_for_viewer', { p_target_id: partnerId });
    const partnerProfile = profile as { name?: string | null } | null;
    if (partnerProfile) partnerName = partnerProfile.name ?? 'Your match';

    applyReadyGateTruth(session, { partnerName });
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
    const transitionResult = await supabase.rpc('ready_gate_transition', { p_session_id: sessionId, p_action: action });
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
      const result = applyReadyGateTruth({
        ...payload,
        ready_gate_status: payload.status ?? payload.ready_gate_status,
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
            status: payload.status ?? payload.ready_gate_status ?? EXPIRED,
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
    await fetchSession();
    return {
      ok: true,
      status: state.status,
      isTerminal: state.status === BOTH_READY || state.status === FORFEITED || state.status === EXPIRED,
      expiresAt: state.expiresAt,
      reason: action,
      terminal: state.status === BOTH_READY || state.status === FORFEITED || state.status === EXPIRED,
    };
  }, [sessionId, userId, options?.eventId, applyReadyGateTruth, fetchSession, notifyTerminal, state.expiresAt, state.status]);

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
        const normalizedStatus = payload.status ?? payload.ready_gate_status;
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

  const isBothReady = state.status === BOTH_READY;
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
