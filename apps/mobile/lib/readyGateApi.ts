import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

const BOTH_READY = 'both_ready';
const FORFEITED = 'forfeited';
const SNOOZED = 'snoozed';
const EXPIRED = 'expired';
const POLL_MS = 2000;

export type ReadyGateState = {
  status: string;
  iAmReady: boolean;
  partnerReady: boolean;
  partnerName: string | null;
  snoozedByPartner: boolean;
  snoozeExpiresAt: string | null;
  expiresAt: string | null;
};

export type UseReadyGateOptions = {
  onBothReady?: () => void;
  onForfeited?: (reason: 'timeout' | 'skip') => void;
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
  });

  const onBothReadyRef = useRef(options?.onBothReady);
  const onForfeitedRef = useRef(options?.onForfeited);
  useEffect(() => {
    onBothReadyRef.current = options?.onBothReady;
    onForfeitedRef.current = options?.onForfeited;
  }, [options?.onBothReady, options?.onForfeited]);

  const fetchSession = useCallback(async () => {
    if (!sessionId || !userId) return;
    const { data: session, error } = await supabase
      .from('video_sessions')
      .select(
        'participant_1_id, participant_2_id, ready_gate_status, ready_participant_1_at, ready_participant_2_at, ready_gate_expires_at, snoozed_by, snooze_expires_at',
      )
      .eq('id', sessionId)
      .maybeSingle();

    if (error || !session) return;

    const isP1 = session.participant_1_id === userId;
    const partnerId = isP1 ? session.participant_2_id : session.participant_1_id;
    const myReadyAt = isP1 ? session.ready_participant_1_at : session.ready_participant_2_at;
    const partnerReadyAt = isP1 ? session.ready_participant_2_at : session.ready_participant_1_at;

    let partnerName: string | null = null;
    const { data: profile } = await supabase.from('profiles').select('name').eq('id', partnerId).maybeSingle();
    if (profile) partnerName = profile.name ?? 'Your match';

    const status = session.ready_gate_status ?? 'queued';

    setState({
      status,
      iAmReady: !!myReadyAt,
      partnerReady: !!partnerReadyAt,
      partnerName,
      snoozedByPartner: session.snoozed_by != null && session.snoozed_by !== userId,
      snoozeExpiresAt: session.snooze_expires_at ?? null,
      expiresAt: session.ready_gate_expires_at ?? null,
    });

    if (status === BOTH_READY) {
      onBothReadyRef.current?.();
    } else if (status === FORFEITED || status === EXPIRED) {
      onForfeitedRef.current?.('timeout');
    }
  }, [sessionId, userId]);

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
          const s = payload.new as Record<string, unknown>;
          const isP1 = s.participant_1_id === userId;
          const myReadyAt = isP1 ? s.ready_participant_1_at : s.ready_participant_2_at;
          const partnerReadyAt = isP1 ? s.ready_participant_2_at : s.ready_participant_1_at;
          const nextStatus = (s.ready_gate_status as string) ?? 'queued';

          setState((prev) => ({
            ...prev,
            status: nextStatus,
            iAmReady: !!myReadyAt,
            partnerReady: !!partnerReadyAt,
            snoozedByPartner: s.snoozed_by != null && s.snoozed_by !== userId,
            snoozeExpiresAt: (s.snooze_expires_at as string) ?? null,
            expiresAt: (s.ready_gate_expires_at as string) ?? null,
          }));

          if (nextStatus === BOTH_READY) {
            onBothReadyRef.current?.();
          } else if (nextStatus === FORFEITED || nextStatus === EXPIRED) {
            onForfeitedRef.current?.('timeout');
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, userId]);

  // Fallback sync while ready gate is active in case realtime misses transitions.
  useEffect(() => {
    if (!sessionId || !userId) return;
    if ([BOTH_READY, FORFEITED, EXPIRED].includes(state.status)) return;

    const intervalId = setInterval(() => {
      void fetchSession();
    }, POLL_MS);

    return () => clearInterval(intervalId);
  }, [sessionId, userId, state.status, fetchSession]);

  const markReady = useCallback(async () => {
    if (!sessionId || !userId) return;
    await supabase.rpc('ready_gate_transition', { p_session_id: sessionId, p_action: 'mark_ready' });
    await fetchSession();
  }, [sessionId, userId, fetchSession]);

  const forfeit = useCallback(async () => {
    if (!sessionId) return;
    await supabase.rpc('ready_gate_transition', { p_session_id: sessionId, p_action: 'forfeit' });
    await fetchSession();
  }, [sessionId, fetchSession]);

  const snooze = useCallback(async () => {
    if (!sessionId || !userId) return;
    await supabase.rpc('ready_gate_transition', { p_session_id: sessionId, p_action: 'snooze' });
    await fetchSession();
  }, [sessionId, userId, fetchSession]);

  const isBothReady = state.status === BOTH_READY;
  const isForfeited = state.status === FORFEITED || state.status === EXPIRED;
  const isSnoozed = state.status === SNOOZED;

  return {
    ...state,
    markReady,
    forfeit,
    snooze,
    isBothReady,
    isForfeited,
    isSnoozed,
    refetch: fetchSession,
  };
}
