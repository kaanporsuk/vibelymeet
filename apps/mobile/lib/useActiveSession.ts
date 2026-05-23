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
import { trackEvent } from '@/lib/analytics';
import {
  activeSessionDirectFallbackStaleReason,
  canAttemptDailyRoomFromVideoSessionTruth,
  decideVideoSessionRouteFromTruth,
  getVideoSessionPartnerIdForUser,
  inferVideoQueueStatusFromSessionTruth,
  isActiveSessionDirectFallbackFresh,
  normalizeReadyGateTransitionActiveSessionTruth,
  pickRecoverablePendingPostDateSurveySession,
  pickRegistrationForActiveSession,
  readyGateTransitionResultHasDateCapableTruth,
  readyGateTransitionResultReadyGateEligible,
  videoSessionHasPostDateSurveyTruth,
  videoSessionHasRecoverablePostDateSurveyTruth,
} from '@clientShared/matching/activeSession';
import { LobbyPostDateEvents } from '@clientShared/analytics/lobbyToPostDateJourney';
import type { VideoSessionDateEntryTruth } from '@/lib/videoDateApi';
import { RC_CATEGORY, rcBreadcrumb } from '@/lib/nativeRcDiagnostics';
import { fetchVideoDateQueueHint } from '@/lib/videoDateQueueHint';

export type ActiveSession =
  | { kind: 'video'; sessionId: string; eventId: string; partnerName?: string | null; queueStatus: 'in_handshake' | 'in_date' | 'in_survey' }
  | { kind: 'ready_gate'; sessionId: string; eventId: string; partnerName?: string | null; queueStatus: 'in_ready_gate' }
  | { kind: 'syncing'; sessionId: string; eventId: string };

type Options = { eventId?: string | null };

type StaleActiveSessionPayload = {
  reason: string;
  eventId?: string | null;
  sessionId?: string | null;
  queueStatus?: string | null;
  currentPartnerPresent?: boolean | null;
};

type EmitStaleActiveSessionDetected = (payload: StaleActiveSessionPayload) => void;

type ActiveSessionVideoTruth = Parameters<typeof decideVideoSessionRouteFromTruth>[0] & {
  id?: string | null;
  event_id?: string | null;
  participant_1_id?: string | null;
  participant_2_id?: string | null;
};

function isReadyGateSuppressionActive(
  suppressedUntil: unknown,
  suppressedSessionId: unknown,
  sessionId: string,
  nowMs = Date.now(),
): boolean {
  if (suppressedSessionId !== sessionId) return false;
  const value = suppressedUntil;
  if (typeof value !== 'string' || !value) return false;
  const suppressedUntilMs = Date.parse(value);
  return Number.isFinite(suppressedUntilMs) && suppressedUntilMs > nowMs;
}

async function isReadyGateSuppressedForSession(
  userId: string,
  eventId: string,
  sessionId: string,
  nowMs: number,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('event_registrations')
    .select('current_room_id, ready_gate_suppressed_until, ready_gate_suppressed_session_id')
    .eq('profile_id', userId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) return false;
  if (!data) return false;
  if (data.current_room_id && data.current_room_id !== sessionId) return false;
  return isReadyGateSuppressionActive(
    data.ready_gate_suppressed_until,
    (data as Record<string, unknown>).ready_gate_suppressed_session_id,
    sessionId,
    nowMs,
  );
}

async function fetchPartnerNameForViewer(partnerId: string): Promise<string | null> {
  const { data: profile, error } = await supabase.rpc('get_profile_for_viewer', { p_target_id: partnerId });
  if (error) {
    if (__DEV__) console.warn('[useActiveSession] partner query failed:', error.message);
    return null;
  }
  const partnerProfile = profile as { name?: string | null } | null;
  return partnerProfile?.name ?? null;
}

async function findPendingPostDateSurveySession(
  userId: string,
  eventFilter: string | null,
  emitStaleActiveSessionDetected?: EmitStaleActiveSessionDetected,
): Promise<{ sessionId: string; eventId: string; partnerName: string | null; endedReason: string | null } | null> {
  const nowMs = Date.now();
  const endedQuery = supabase
    .from('video_sessions')
    .select('id, event_id, participant_1_id, participant_2_id, ended_at, ended_reason, date_started_at, participant_1_joined_at, participant_2_joined_at, state, phase')
    .not('ended_at', 'is', null)
    .or(`participant_1_id.eq.${userId},participant_2_id.eq.${userId}`)
    .order('ended_at', { ascending: false, nullsFirst: false })
    .limit(10);
  if (eventFilter) endedQuery.eq('event_id', eventFilter);
  const { data: endedRows, error: endedError } = await endedQuery;
  if (endedError || !endedRows?.length) return null;

  const candidateRows = endedRows.filter((row) => videoSessionHasPostDateSurveyTruth(row));
  const candidateSessionIds = candidateRows
    .map((row) => row.id)
    .filter((sessionId): sessionId is string => Boolean(sessionId));
  if (!candidateSessionIds.length) return null;

  const { data: verdictRows, error: verdictError } = await supabase
    .from('date_feedback')
    .select('session_id')
    .eq('user_id', userId)
    .in('session_id', candidateSessionIds);
  if (verdictError) return null;

  const feedbackSessionIdsForUser = new Set(
    (verdictRows ?? [])
      .map((row) => row.session_id)
      .filter((sessionId): sessionId is string => Boolean(sessionId)),
  );
  const staleSurvey = candidateRows.find(
    (row) =>
      row.id &&
      getVideoSessionPartnerIdForUser(row, userId) &&
      !feedbackSessionIdsForUser.has(row.id) &&
      !videoSessionHasRecoverablePostDateSurveyTruth(row, nowMs),
  );
  if (staleSurvey) {
    emitStaleActiveSessionDetected?.({
      reason: 'pending_survey_recovery_stale',
      eventId: staleSurvey.event_id ?? null,
      sessionId: staleSurvey.id ?? null,
      queueStatus: 'in_survey',
      currentPartnerPresent: Boolean(getVideoSessionPartnerIdForUser(staleSurvey, userId)),
    });
  }

  const pendingSurvey = pickRecoverablePendingPostDateSurveySession(
    candidateRows,
    feedbackSessionIdsForUser,
    userId,
    nowMs,
  );
  if (!pendingSurvey?.id || !pendingSurvey.event_id) return null;

  const partnerId = getVideoSessionPartnerIdForUser(pendingSurvey, userId);
  let partnerName: string | null = null;
  if (partnerId) {
    partnerName = await fetchPartnerNameForViewer(partnerId);
  }

  return {
    sessionId: pendingSurvey.id,
    eventId: pendingSurvey.event_id,
    partnerName,
    endedReason: pendingSurvey.ended_reason ?? null,
  };
}

async function syncReadyGateActiveSession(
  truth: ActiveSessionVideoTruth,
  userId: string,
  base: {
    sessionId: string;
    eventId: string;
    partnerName: string | null;
  },
  emitStaleActiveSessionDetected?: EmitStaleActiveSessionDetected,
): Promise<{ activeSession: Exclude<ActiveSession, { kind: 'syncing' }> | null; reason: string }> {
  const { data, error } = await supabase.rpc('ready_gate_transition', {
    p_session_id: base.sessionId,
    p_action: 'sync',
    p_reason: 'active_session_hydration',
  });

  if (error) {
    emitStaleActiveSessionDetected?.({
      reason: 'ready_gate_sync_failed',
      eventId: base.eventId,
      sessionId: base.sessionId,
      queueStatus: 'in_ready_gate',
      currentPartnerPresent: Boolean(getVideoSessionPartnerIdForUser(truth, userId)),
    });
    return { activeSession: null, reason: 'ready_gate_sync_failed' };
  }

  const syncTruth = normalizeReadyGateTransitionActiveSessionTruth(data);
  const nowMs = Date.now();
  const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(truth, nowMs);
  const freshDateRoute =
    (canAttemptDaily || readyGateTransitionResultHasDateCapableTruth(syncTruth)) &&
    isActiveSessionDirectFallbackFresh(truth, nowMs);

  if (freshDateRoute) {
    return {
      activeSession: {
        kind: 'video',
        ...base,
        queueStatus: inferVideoQueueStatusFromSessionTruth(truth),
      },
      reason: 'ready_gate_sync_date_capable',
    };
  }

  const mergedTruth = {
    ...truth,
    ready_gate_status: syncTruth?.ready_gate_status ?? syncTruth?.status ?? truth?.ready_gate_status,
    ready_gate_expires_at: syncTruth?.ready_gate_expires_at ?? truth?.ready_gate_expires_at,
  };

  if (
    readyGateTransitionResultReadyGateEligible(syncTruth, nowMs) &&
    decideVideoSessionRouteFromTruth(mergedTruth, nowMs) === 'navigate_ready'
  ) {
    return {
      activeSession: { kind: 'ready_gate', ...base, queueStatus: 'in_ready_gate' },
      reason: 'ready_gate_sync_valid',
    };
  }

  emitStaleActiveSessionDetected?.({
    reason:
      syncTruth?.reason ??
      syncTruth?.error_code ??
      syncTruth?.code ??
      syncTruth?.error ??
      'ready_gate_sync_not_startable',
    eventId: base.eventId,
    sessionId: base.sessionId,
    queueStatus: 'in_ready_gate',
    currentPartnerPresent: Boolean(getVideoSessionPartnerIdForUser(truth, userId)),
  });
  return { activeSession: null, reason: 'ready_gate_sync_not_startable' };
}

async function findDirectVideoSessionFallback(
  userId: string,
  eventFilter: string | null,
  emitStaleActiveSessionDetected?: EmitStaleActiveSessionDetected,
): Promise<Exclude<ActiveSession, { kind: 'syncing' }> | null> {
  const nowMs = Date.now();
  const query = supabase
    .from('video_sessions')
    .select(
      'id, event_id, participant_1_id, participant_2_id, ended_at, state, phase, handshake_started_at, date_started_at, date_extra_seconds, ready_gate_status, ready_gate_expires_at, reconnect_grace_ends_at, started_at, state_updated_at, participant_1_joined_at, participant_2_joined_at, daily_room_name, daily_room_url'
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
        (canAttemptDailyRoomFromVideoSessionTruth(row, nowMs) ||
          decideVideoSessionRouteFromTruth(row, nowMs) === 'navigate_date') &&
        isActiveSessionDirectFallbackFresh(row, nowMs)
    ) ??
    rows.find(
      (row) =>
        decideVideoSessionRouteFromTruth(row, nowMs) === 'navigate_ready' &&
        isActiveSessionDirectFallbackFresh(row, nowMs)
    ) ??
    null;

  if (!candidate?.id || !candidate.event_id) {
    const staleCandidate = rows.find((row) => activeSessionDirectFallbackStaleReason(row, nowMs));
    if (staleCandidate) {
      emitStaleActiveSessionDetected?.({
        reason: 'direct_video_session_fallback_stale',
        eventId: staleCandidate.event_id ?? null,
        sessionId: staleCandidate.id ?? null,
        queueStatus: null,
        currentPartnerPresent: Boolean(getVideoSessionPartnerIdForUser(staleCandidate, userId)),
      });
    }
    return null;
  }

  const decision = decideVideoSessionRouteFromTruth(candidate, nowMs);
  const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(candidate, nowMs);
  if (!canAttemptDaily && decision !== 'navigate_date' && decision !== 'navigate_ready') return null;
  if (
    decision === 'navigate_ready' &&
    !canAttemptDaily &&
    await isReadyGateSuppressedForSession(userId, candidate.event_id as string, candidate.id as string, nowMs)
  ) {
    return null;
  }

  const partnerId =
    candidate.participant_1_id === userId
      ? (candidate.participant_2_id as string | null)
      : (candidate.participant_1_id as string | null);
  let partnerName: string | null = null;
  if (partnerId) {
    const { data: profile } = await supabase.rpc('get_profile_for_viewer', { p_target_id: partnerId });
    const partnerProfile = profile as { name?: string | null } | null;
    partnerName = partnerProfile?.name ?? null;
  }

  const base = {
    sessionId: candidate.id as string,
    eventId: candidate.event_id as string,
    partnerName,
  };

  if (canAttemptDaily || decision === 'navigate_date') {
    return {
      kind: 'video',
      ...base,
      queueStatus: inferVideoQueueStatusFromSessionTruth(candidate),
    };
  }

  const synced = await syncReadyGateActiveSession(candidate, userId, base, emitStaleActiveSessionDetected);
  return synced.activeSession;
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
  const staleActiveSessionEventKeyRef = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const emitStaleActiveSessionDetected = useCallback(
    (payload: {
      reason: string;
      eventId?: string | null;
      sessionId?: string | null;
      queueStatus?: string | null;
      currentPartnerPresent?: boolean | null;
    }) => {
      const key = `${payload.reason}:${payload.eventId ?? 'none'}:${payload.sessionId ?? 'none'}:${payload.queueStatus ?? 'none'}`;
      if (staleActiveSessionEventKeyRef.current === key) return;
      staleActiveSessionEventKeyRef.current = key;
      trackEvent(LobbyPostDateEvents.STALE_ACTIVE_SESSION_DETECTED, {
        platform: 'native',
        source_surface: 'use_active_session',
        scoped_event_id: eventFilter,
        event_id: payload.eventId ?? null,
        session_id: payload.sessionId ?? null,
        queue_status: payload.queueStatus ?? null,
        current_partner_present: payload.currentPartnerPresent ?? null,
        reason: payload.reason,
        reason_code: payload.reason,
      });
    },
    [eventFilter]
  );

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
        emitStaleActiveSessionDetected({
          reason: 'different_event_registration_room',
          eventId: reg.event_id as string | null,
          sessionId: reg.current_room_id as string | null,
          queueStatus: reg.queue_status as string | null,
          currentPartnerPresent: Boolean(reg.current_partner_id),
        });
        if (mounted.current) {
          setActiveSession(null);
          setHydrated(true);
        }
        return;
      }

      if (reg.queue_status === 'in_ready_gate') {
        const pendingSurvey = await findPendingPostDateSurveySession(userId, eventFilter, emitStaleActiveSessionDetected);
        if (pendingSurvey) {
          if (mounted.current) {
            setActiveSession({
              kind: 'video',
              sessionId: pendingSurvey.sessionId,
              eventId: pendingSurvey.eventId,
              partnerName: pendingSurvey.partnerName,
              queueStatus: 'in_survey',
            });
            setHydrated(true);
          }
          return;
        }
        if (
          await isReadyGateSuppressedForSession(
            userId,
            reg.event_id as string,
            reg.current_room_id as string,
            Date.now(),
          )
        ) {
          if (mounted.current) {
            setActiveSession(null);
            setHydrated(true);
          }
          return;
        }
      }

      const { data: session, error: sessionError } = await supabase
        .from('video_sessions')
        .select('id, event_id, participant_1_id, participant_2_id, ended_at, ended_reason, handshake_started_at, date_started_at, date_extra_seconds, state, phase, ready_gate_status, ready_gate_expires_at, reconnect_grace_ends_at, started_at, state_updated_at, participant_1_joined_at, participant_2_joined_at, daily_room_name, daily_room_url')
        .eq('id', reg.current_room_id)
        .maybeSingle();

      if (sessionError && __DEV__) {
        console.warn('[useActiveSession] session query failed:', sessionError.message);
      }

      if (session?.id) {
        const qs = reg.queue_status;
        if (qs === 'in_ready_gate' || qs === 'in_handshake' || qs === 'in_date' || qs === 'in_survey') {
          const truth = session as unknown as VideoSessionDateEntryTruth;
          const nowMs = Date.now();
          const truthDecision = decideVideoSessionRouteFromTruth(truth, nowMs);
          const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(truth, nowMs);
          const freshDateRoute =
            (canAttemptDaily || truthDecision === 'navigate_date') &&
            isActiveSessionDirectFallbackFresh(truth, nowMs);
          const staleFallbackReason = activeSessionDirectFallbackStaleReason(truth, nowMs);

          const partnerName = reg.current_partner_id
            ? await fetchPartnerNameForViewer(reg.current_partner_id)
            : null;

          const base = {
            sessionId: session.id,
            eventId: reg.event_id as string,
            partnerName,
          };

          if (mounted.current) {
            if (qs === 'in_survey') {
              const surveyBaseEligible =
                videoSessionHasPostDateSurveyTruth(truth) &&
                Boolean(getVideoSessionPartnerIdForUser(truth, userId));
              const hasRecoverableSurvey =
                surveyBaseEligible && videoSessionHasRecoverablePostDateSurveyTruth(truth, nowMs);
              const { data: feedback, error: feedbackError } = surveyBaseEligible
                ? await supabase
                    .from('date_feedback')
                    .select('id')
                    .eq('session_id', session.id)
                    .eq('user_id', userId)
                    .maybeSingle()
                : { data: null, error: null };
              if (!mounted.current) return;

              if (feedbackError) {
                if (__DEV__) console.warn('[useActiveSession] survey feedback query failed:', feedbackError.message);
                setActiveSession(null);
                setHydrated(true);
                return;
              }

              if (hasRecoverableSurvey && !feedback) {
                setActiveSession({ kind: 'video', ...base, queueStatus: qs });
                setHydrated(true);
                return;
              }

              emitStaleActiveSessionDetected({
                reason: surveyBaseEligible && !hasRecoverableSurvey
                  ? 'pending_survey_recovery_stale'
                  : 'registration_survey_not_recoverable',
                eventId: reg.event_id as string | null,
                sessionId: session.id as string,
                queueStatus: qs as string | null,
                currentPartnerPresent: Boolean(reg.current_partner_id),
              });
              setActiveSession(null);
              setHydrated(true);
              return;
            }

            if (freshDateRoute) {
              setActiveSession({
                kind: 'video',
                ...base,
                queueStatus: qs === 'in_ready_gate' ? inferVideoQueueStatusFromSessionTruth(truth) : qs,
              });
              setHydrated(true);
              return;
            }
            if (staleFallbackReason) {
              emitStaleActiveSessionDetected({
                reason: staleFallbackReason,
                eventId: reg.event_id as string | null,
                sessionId: session.id as string,
                queueStatus: qs as string | null,
                currentPartnerPresent: Boolean(reg.current_partner_id),
              });
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
              const synced = await syncReadyGateActiveSession(
                truth,
                userId,
                base,
                emitStaleActiveSessionDetected,
              );
              if (!mounted.current) return;
              setActiveSession(synced.activeSession);
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
              emitStaleActiveSessionDetected({
                reason: 'registration_points_to_ended_session',
                eventId: reg.event_id as string | null,
                sessionId: session.id as string,
                queueStatus: qs as string | null,
                currentPartnerPresent: Boolean(reg.current_partner_id),
              });
            }
          }
        } else {
          emitStaleActiveSessionDetected({
            reason: 'unsupported_registration_status',
            eventId: reg.event_id as string | null,
            sessionId: session.id as string,
            queueStatus: reg.queue_status as string | null,
            currentPartnerPresent: Boolean(reg.current_partner_id),
          });
        }
      } else {
        emitStaleActiveSessionDetected({
          reason: sessionError ? 'registration_session_query_failed' : 'registration_points_to_missing_session',
          eventId: reg.event_id as string | null,
          sessionId: reg.current_room_id as string | null,
          queueStatus: reg.queue_status as string | null,
          currentPartnerPresent: Boolean(reg.current_partner_id),
        });
      }
      // Stale current_room_id or registration not in an active gate/date phase: recover survey before new gates.
      const pendingSurvey = await findPendingPostDateSurveySession(userId, eventFilter, emitStaleActiveSessionDetected);
      if (pendingSurvey) {
        if (mounted.current) {
          setActiveSession({
            kind: 'video',
            sessionId: pendingSurvey.sessionId,
            eventId: pendingSurvey.eventId,
            partnerName: pendingSurvey.partnerName,
            queueStatus: 'in_survey',
          });
          setHydrated(true);
        }
        return;
      }
    }

    const pendingSurvey = await findPendingPostDateSurveySession(userId, eventFilter, emitStaleActiveSessionDetected);
    if (pendingSurvey) {
      if (mounted.current) {
        setActiveSession({
          kind: 'video',
          sessionId: pendingSurvey.sessionId,
          eventId: pendingSurvey.eventId,
          partnerName: pendingSurvey.partnerName,
          queueStatus: 'in_survey',
        });
        setHydrated(true);
      }
      return;
    }

    const directSession = await findDirectVideoSessionFallback(userId, eventFilter, emitStaleActiveSessionDetected);
    if (directSession) {
      if (mounted.current) {
        setActiveSession(directSession);
        setHydrated(true);
      }
      return;
    }

    // Secondary: queued mutual match while still browsing — registration row may not qualify for primary filter.
    if (eventFilter) {
      const queueHint = await fetchVideoDateQueueHint(eventFilter, userId);
      if (!queueHint.ok) {
        if (__DEV__) console.warn('[useActiveSession] queued session lookup failed:', queueHint.reason ?? 'unknown');
      } else if (queueHint.queued && queueHint.sessionId) {
        if (mounted.current) {
          setActiveSession({
            kind: 'syncing',
            sessionId: queueHint.sessionId,
            eventId: eventFilter,
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
  }, [userId, eventFilter, emitStaleActiveSessionDetected]);

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

    const maybeCheckForScopedEvent = (payload: {
      new?: Record<string, unknown> | null;
      old?: Record<string, unknown> | null;
    }) => {
      const row = payload.new ?? payload.old ?? null;
      if (row?.event_id !== eventFilter) return;
      void check();
    };

    const channel = supabase.channel(`active-session-vs-native-${userId}-${eventFilter}`);
    // Realtime cannot OR participant columns in one filter. Use participant-
    // scoped bindings and keep AppState/interval reconciliation as fallback.
    for (const filter of [`participant_1_id=eq.${userId}`, `participant_2_id=eq.${userId}`]) {
      channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'video_sessions',
          filter,
        },
        maybeCheckForScopedEvent
      );
    }
    channel.subscribe();

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
