/**
 * Active session detection — parity with web `useActiveSession` (Stage 1 / Stream 1).
 * - Video rejoin: in_handshake / in_date with a live video_sessions row → /date/[id]
 * - Ready Gate: in_ready_gate → /ready/[id] (native) or lobby overlay (event screen)
 * - Queued mutual: browsing + live queued session row → `syncing` (lobby convergence; drain promotes)
 *
 * In-app routes for `ActiveSession` kinds: `activeSessionRoutes.ts` (`hrefForActiveSession`, path builders).
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { supabase } from '@/lib/supabase';
import {
  canAttemptDailyRoomFromVideoSessionTruth,
  decideVideoSessionRouteFromTruth,
  inferVideoQueueStatusFromSessionTruth,
  pickRegistrationForActiveSession,
} from '@clientShared/matching/activeSession';
import type { VideoSessionDateEntryTruth } from '@/lib/videoDateApi';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';

export type ActiveSession =
  | { kind: 'video'; sessionId: string; eventId: string; partnerName?: string | null; queueStatus: 'in_handshake' | 'in_date' | 'in_survey' }
  | { kind: 'ready_gate'; sessionId: string; eventId: string; partnerName?: string | null; queueStatus: 'in_ready_gate' }
  | { kind: 'syncing'; sessionId: string; eventId: string };

type Options = { eventId?: string | null };

async function findPendingReconnectGraceSurveySession(
  userId: string,
  eventFilter: string | null
): Promise<{ sessionId: string; eventId: string; partnerName: string | null } | null> {
  const endedQuery = supabase
    .from('video_sessions')
    .select('id, event_id, participant_1_id, participant_2_id, ended_at, ended_reason, date_started_at')
    .eq('ended_reason', 'reconnect_grace_expired')
    .not('date_started_at', 'is', null)
    .or(`participant_1_id.eq.${userId},participant_2_id.eq.${userId}`)
    .order('ended_at', { ascending: false, nullsFirst: false })
    .limit(5);
  if (eventFilter) endedQuery.eq('event_id', eventFilter);
  const { data: endedRows, error: endedError } = await endedQuery;
  if (endedError || !endedRows?.length) return null;

  for (const row of endedRows) {
    const sessionId = row.id as string;
    const eventId = row.event_id as string | null;
    if (!eventId) continue;
    const { data: verdict } = await supabase
      .from('date_feedback')
      .select('id')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .maybeSingle();
    if (verdict) continue;

    const partnerId =
      row.participant_1_id === userId
        ? (row.participant_2_id as string | null)
        : (row.participant_1_id as string | null);
    let partnerName: string | null = null;
    if (partnerId) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', partnerId)
        .maybeSingle();
      partnerName = profile?.name ?? null;
    }

    return { sessionId, eventId, partnerName };
  }

  return null;
}

async function findDirectVideoSessionFallback(
  userId: string,
  eventFilter: string | null
): Promise<Exclude<ActiveSession, { kind: 'syncing' }> | null> {
  const query = supabase
    .from('video_sessions')
    .select(
      'id, event_id, participant_1_id, participant_2_id, ended_at, state, phase, handshake_started_at, date_started_at, ready_gate_status, ready_gate_expires_at'
    )
    .or(`participant_1_id.eq.${userId},participant_2_id.eq.${userId}`)
    .is('ended_at', null)
    .order('handshake_started_at', { ascending: false, nullsFirst: false })
    .order('ready_gate_expires_at', { ascending: false, nullsFirst: false })
    .limit(10);
  if (eventFilter) query.eq('event_id', eventFilter);

  const { data: rows, error } = await query;
  if (error || !rows?.length) return null;

  const candidate =
    rows.find(
      (row) =>
        canAttemptDailyRoomFromVideoSessionTruth(row) ||
        decideVideoSessionRouteFromTruth(row) === 'navigate_date'
    ) ??
    rows.find((row) => decideVideoSessionRouteFromTruth(row) === 'navigate_ready') ??
    null;

  if (!candidate?.id || !candidate.event_id) return null;

  const decision = decideVideoSessionRouteFromTruth(candidate);
  const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(candidate);
  if (!canAttemptDaily && decision !== 'navigate_date' && decision !== 'navigate_ready') return null;

  const partnerId =
    candidate.participant_1_id === userId
      ? (candidate.participant_2_id as string | null)
      : (candidate.participant_1_id as string | null);
  let partnerName: string | null = null;
  if (partnerId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', partnerId)
      .maybeSingle();
    partnerName = profile?.name ?? null;
  }

  return canAttemptDaily || decision === 'navigate_date'
    ? {
        kind: 'video',
        sessionId: candidate.id as string,
        eventId: candidate.event_id as string,
        partnerName,
        queueStatus: inferVideoQueueStatusFromSessionTruth(candidate),
      }
    : {
        kind: 'ready_gate',
        sessionId: candidate.id as string,
        eventId: candidate.event_id as string,
        partnerName,
        queueStatus: 'in_ready_gate',
      };
}

export function useActiveSession(
  userId: string | null | undefined,
  options?: Options
): {
  activeSession: ActiveSession | null;
  hydrated: boolean;
  refetch: () => Promise<void>;
} {
  const eventFilter = options?.eventId ?? null;
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const check = useCallback(async () => {
    if (!userId) {
      if (mounted.current) {
        setActiveSession(null);
        setHydrated(true);
      }
      return;
    }

    const { data: regs, error: regError } = await supabase
      .from('event_registrations')
      .select('event_id, current_room_id, queue_status, current_partner_id')
      .eq('profile_id', userId)
      .in('queue_status', ['in_handshake', 'in_date', 'in_survey', 'in_ready_gate'])
      .not('current_room_id', 'is', null);

    if (regError) {
      if (__DEV__) console.warn('[useActiveSession] reg query failed:', regError.message);
      if (mounted.current) {
        setActiveSession(null);
        setHydrated(true);
      }
      return;
    }

    const reg = pickRegistrationForActiveSession(regs ?? []);

    if (reg?.current_room_id) {
      if (eventFilter && reg.event_id !== eventFilter) {
        if (mounted.current) {
          setActiveSession(null);
          setHydrated(true);
        }
        return;
      }

      const { data: session, error: sessionError } = await supabase
        .from('video_sessions')
        .select('id, ended_at, handshake_started_at, state, phase, ready_gate_status, ready_gate_expires_at')
        .eq('id', reg.current_room_id)
        .maybeSingle();

      if (sessionError && __DEV__) {
        console.warn('[useActiveSession] session query failed:', sessionError.message);
      }

      if (session?.id) {
        const qs = reg.queue_status;
        if (qs === 'in_ready_gate' || qs === 'in_handshake' || qs === 'in_date' || qs === 'in_survey') {
          const truth = session as unknown as VideoSessionDateEntryTruth;
          const truthDecision = decideVideoSessionRouteFromTruth(truth);
          const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(truth);

          let partnerName: string | null = null;
          if (reg.current_partner_id) {
            const { data: profile, error: profileError } = await supabase
              .from('profiles')
              .select('name')
              .eq('id', reg.current_partner_id)
              .maybeSingle();
            if (profileError && __DEV__) {
              console.warn('[useActiveSession] partner query failed:', profileError.message);
            } else {
              partnerName = profile?.name ?? null;
            }
          }

          const base = {
            sessionId: session.id,
            eventId: reg.event_id as string,
            partnerName,
          };

          if (mounted.current) {
            if (canAttemptDaily || truthDecision === 'navigate_date') {
              setActiveSession({
                kind: 'video',
                ...base,
                queueStatus: qs === 'in_ready_gate' ? inferVideoQueueStatusFromSessionTruth(truth) : qs,
              });
              setHydrated(true);
              return;
            }
            if (truthDecision === 'navigate_ready') {
              if (qs !== 'in_ready_gate') {
                rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'active_session_video_blocked', {
                  reason: 'video_truth_not_startable',
                  queue_status: qs,
                  session_id: session.id,
                  vs_state: truth.state ?? null,
                  vs_phase: truth.phase ?? null,
                  handshake_started_at: Boolean(truth.handshake_started_at),
                  ready_gate_status: truth.ready_gate_status ?? null,
                  can_attempt_daily: canAttemptDaily,
                });
              }
              setActiveSession({ kind: 'ready_gate', ...base, queueStatus: 'in_ready_gate' });
              setHydrated(true);
              return;
            }
            if (qs === 'in_survey') {
              setActiveSession({ kind: 'video', ...base, queueStatus: qs });
              setHydrated(true);
              return;
            }

            if (truthDecision !== 'ended') {
              rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'active_session_video_blocked', {
                reason: 'video_truth_not_startable',
                queue_status: qs,
                session_id: session.id,
                vs_state: truth.state ?? null,
                vs_phase: truth.phase ?? null,
                handshake_started_at: Boolean(truth.handshake_started_at),
                ready_gate_status: truth.ready_gate_status ?? null,
                can_attempt_daily: canAttemptDaily,
              });
            } else {
              rcBreadcrumb(RC_CATEGORY.lobbyDateEntry, 'active_session_video_blocked', {
                reason: 'video_truth_ended',
                queue_status: qs,
                session_id: session.id,
                vs_state: truth.state ?? null,
                vs_phase: truth.phase ?? null,
                handshake_started_at: Boolean(truth.handshake_started_at),
                ready_gate_status: truth.ready_gate_status ?? null,
                can_attempt_daily: canAttemptDaily,
              });
            }
          }
        }
      }
      // Stale current_room_id or registration not in an active gate/date phase: try queued `syncing` below.
      const directSession = await findDirectVideoSessionFallback(userId, eventFilter);
      if (directSession) {
        if (mounted.current) {
          setActiveSession(directSession);
          setHydrated(true);
        }
        return;
      }
    }

    const directSession = await findDirectVideoSessionFallback(userId, eventFilter);
    if (directSession) {
      if (mounted.current) {
        setActiveSession(directSession);
        setHydrated(true);
      }
      return;
    }

    const reconnectSurvey = await findPendingReconnectGraceSurveySession(userId, eventFilter);
    if (reconnectSurvey) {
      if (mounted.current) {
        setActiveSession({
          kind: 'video',
          sessionId: reconnectSurvey.sessionId,
          eventId: reconnectSurvey.eventId,
          partnerName: reconnectSurvey.partnerName,
          queueStatus: 'in_survey',
        });
        setHydrated(true);
      }
      return;
    }

    // Secondary: queued mutual match while still browsing — registration row may not qualify for primary filter.
    if (eventFilter) {
      const { data: queued, error: qErr } = await supabase
        .from('video_sessions')
        .select('id, event_id')
        .eq('event_id', eventFilter)
        .or(`participant_1_id.eq.${userId},participant_2_id.eq.${userId}`)
        .is('ended_at', null)
        .eq('ready_gate_status', 'queued')
        // Newest-first + id tie-break: deterministic if multiple queued rows exist; server promote remains FIFO on oldest.
        .order('started_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (qErr) {
        if (__DEV__) console.warn('[useActiveSession] queued session lookup failed:', qErr.message);
      } else if (queued?.id && queued.event_id) {
        if (mounted.current) {
          setActiveSession({
            kind: 'syncing',
            sessionId: queued.id as string,
            eventId: queued.event_id as string,
          });
          setHydrated(true);
        }
        return;
      }
    }

    if (mounted.current) {
      setActiveSession(null);
      setHydrated(true);
    }
  }, [userId, eventFilter]);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    const sub = (state: AppStateStatus) => {
      if (state === 'active') void check();
    };
    sub(AppState.currentState);
    const subId = AppState.addEventListener('change', sub);
    return () => subId.remove();
  }, [check]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`active-session-reg-native-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'event_registrations',
          filter: `profile_id=eq.${userId}`,
        },
        () => {
          void check();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, check]);

  useEffect(() => {
    if (!userId || !eventFilter) return;

    const channel = supabase
      .channel(`active-session-vs-native-${userId}-${eventFilter}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'video_sessions',
          filter: `event_id=eq.${eventFilter}`,
        },
        () => {
          void check();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, eventFilter, check]);

  // Fallback reconciliation: if a realtime event is missed while the app stays foregrounded,
  // periodically re-check server truth so lobby/deck UI cannot mask an active session indefinitely.
  useEffect(() => {
    if (!userId) return;
    const intervalId = setInterval(() => {
      void check();
    }, 8000);
    return () => clearInterval(intervalId);
  }, [userId, check]);

  return useMemo(
    () => ({ activeSession, hydrated, refetch: check }),
    [activeSession, hydrated, check]
  );
}
