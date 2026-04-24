/**
 * Video date API: session state, Daily room token, and backend-owned transitions.
 * Uses same contracts as web: daily-room Edge Function, video_date_transition RPC.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import * as Sentry from '@sentry/react-native';
import { supabase } from '@/lib/supabase';
import { vdbg } from '@/lib/vdbg';
import { videoSessionRowIndicatesHandshakeOrDate } from '@clientShared/matching/activeSession';
import {
  DAILY_ROOM_ACTIONS,
  classifyDailyRoomInvokeFailure,
  type DailyRoomFailureKind,
} from '@clientShared/matching/dailyRoomFailure';
import {
  parseSpendVideoDateCreditExtensionPayload,
  remainingDatePhaseSeconds,
} from '@clientShared/matching/videoDateExtensionSpend';
import {
  VIDEO_DATE_HANDSHAKE_TRUTH_SELECT,
  handshakeTruthLogPayload,
  persistHandshakeDecisionWithVerification,
  type PersistHandshakeDecisionResult,
} from '@clientShared/matching/videoDateHandshakePersistence';

export type VideoDateSession = {
  id: string;
  participant_1_id: string;
  participant_2_id: string;
  event_id: string;
  state?: string;
  phase?: string;
  ended_at: string | null;
  ended_reason?: string | null;
  handshake_started_at: string | null;
  date_started_at: string | null;
  daily_room_name: string | null;
  daily_room_url: string | null;
  reconnect_grace_ends_at?: string | null;
  handshake_grace_expires_at?: string | null;
  participant_1_away_at?: string | null;
  participant_2_away_at?: string | null;
  /** First successful Daily join for each participant (server RPC after `call.join`). */
  participant_1_joined_at?: string | null;
  participant_2_joined_at?: string | null;
  /** Handshake Vibe decision slots. Null means the actor has not persisted a decision yet. */
  participant_1_liked?: boolean | null;
  participant_2_liked?: boolean | null;
  /** Seconds added onto the base date window (credit extensions); server-owned. */
  date_extra_seconds?: number | null;
};

export type SyncReconnectPayload = {
  reconnect_grace_ends_at: string | null;
  ended: boolean;
  ended_reason: string | null;
  partner_marked_away: boolean;
};

export type VideoDatePartner = {
  id: string;
  name: string;
  age: number | null;
  avatar_url: string | null;
};

export type RoomTokenResult = {
  room_name: string;
  room_url: string;
  token: string;
};

/** Classified create_date_room failure (no secrets). */
export type RoomTokenFailureCode = DailyRoomFailureKind;

export type GetDailyRoomTokenResult =
  | { ok: true; data: RoomTokenResult }
  | {
      ok: false;
      code: RoomTokenFailureCode;
      httpStatus?: number;
      serverCode?: string;
    };

export type EnterHandshakeResult =
  | { ok: true }
  | { ok: false; code?: string; message?: string };

export type CompleteHandshakeResult = {
  state: 'date' | 'ended' | 'handshake';
  waiting_for_partner?: boolean;
  grace_expires_at?: string;
  seconds_remaining?: number;
  already_ended?: boolean;
  reason?: string;
};

type VideoDateTransitionDiagnostics = {
  actorUserId?: string | null;
  phase?: string | null;
};

export class VideoDateRequestTimeoutError extends Error {
  constructor(public readonly operation: 'getDailyRoomToken' | 'enterHandshake') {
    super(`${operation} timed out`);
    this.name = 'VideoDateRequestTimeoutError';
  }
}

const HANDSHAKE_SECONDS = 60;
const DATE_SECONDS = 300;

function withTimeout<T>(
  operation: 'getDailyRoomToken' | 'enterHandshake',
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new VideoDateRequestTimeoutError(operation));
    }, timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

export function useVideoDateSession(
  sessionId: string | null | undefined,
  userId: string | null | undefined
) {
  const [session, setSession] = useState<VideoDateSession | null>(null);
  const [partner, setPartner] = useState<VideoDatePartner | null>(null);
  const [phase, setPhase] = useState<'handshake' | 'date' | 'ended'>('handshake');
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  /** True during post-mount refetches; does not drive full-screen loading in date UI. */
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** After first completed fetch for `sessionId:userId`, further refetches use `isRefreshing` only. */
  const lastCompletedSessionKeyRef = useRef<string | null>(null);

  type PhaseResolution = {
    phase: 'handshake' | 'date' | 'ended';
    timeLeft: number;
  };

  const resolvePhaseAndTime = useCallback(
    (
      row: Pick<
        VideoDateSession,
        | 'ended_at'
        | 'state'
        | 'phase'
        | 'date_started_at'
        | 'handshake_started_at'
        | 'date_extra_seconds'
      >,
    ): PhaseResolution => {
      const state = row.state ?? null;
      const phaseValue = row.phase ?? null;

      if (row.ended_at || state === 'ended' || phaseValue === 'ended') {
        return { phase: 'ended', timeLeft: 0 };
      }

      // Authoritative date evidence always wins over handshake fields.
      if (state === 'date' || !!row.date_started_at) {
        const dateStarted =
          typeof row.date_started_at === 'string' ? row.date_started_at : null;
        return {
          phase: 'date',
          timeLeft: remainingDatePhaseSeconds({
            dateStartedAtIso: dateStarted,
            baseDateSeconds: DATE_SECONDS,
            dateExtraSeconds: row.date_extra_seconds,
          }),
        };
      }

      if (
        videoSessionRowIndicatesHandshakeOrDate({
          state,
          handshake_started_at: row.handshake_started_at,
        })
      ) {
        if (row.handshake_started_at) {
          const elapsed = (Date.now() - new Date(row.handshake_started_at).getTime()) / 1000;
          return { phase: 'handshake', timeLeft: Math.max(0, Math.ceil(HANDSHAKE_SECONDS - elapsed)) };
        }
        return { phase: 'handshake', timeLeft: HANDSHAKE_SECONDS };
      }

      // Ready/prejoin fallback.
      return { phase: 'handshake', timeLeft: HANDSHAKE_SECONDS };
    },
    []
  );

  const fetchSession = useCallback(async () => {
    if (!sessionId || !userId) return;
    const sessionKey = `${sessionId}:${userId}`;
    const isInitialLoad = lastCompletedSessionKeyRef.current !== sessionKey;

    setError(null);
    if (isInitialLoad) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
      Sentry.addBreadcrumb({
        category: 'video-date-session',
        message: 'session_refetch_start',
        level: 'info',
        data: {
          session_id: sessionId,
          /** Previously fetchSession set loading=true here, blanking the date screen — retained for diagnostics only. */
          would_have_toggled_full_screen_loading: true,
        },
      });
    }

    let outcome: 'ok' | 'not_found' | 'forbidden' | 'ended' = 'ok';
    try {
      const { data: row, error: e } = await supabase
        .from('video_sessions')
        .select(
          'id, participant_1_id, participant_2_id, event_id, state, phase, ended_at, ended_reason, handshake_started_at, handshake_grace_expires_at, date_started_at, date_extra_seconds, daily_room_name, daily_room_url, participant_1_joined_at, participant_2_joined_at, participant_1_liked, participant_2_liked'
        )
        .eq('id', sessionId)
        .maybeSingle();

      if (e || !row) {
        outcome = 'not_found';
        setError(e?.message ?? 'Session not found');
        setSession(null);
        setPartner(null);
        return;
      }

      const s = row as unknown as VideoDateSession;

      const isParticipant = userId === s.participant_1_id || userId === s.participant_2_id;
      if (!isParticipant) {
        outcome = 'forbidden';
        setError("You don't have access to this date.");
        setSession(null);
        setPartner(null);
        return;
      }

      setSession(s);

      if (s.ended_at || (s.state === 'ended' || s.phase === 'ended')) {
        outcome = 'ended';
        setPhase('ended');
        setTimeLeft(0);
        return;
      }

      const partnerId = s.participant_1_id === userId ? s.participant_2_id : s.participant_1_id;
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, name, age, avatar_url')
        .eq('id', partnerId)
        .maybeSingle();

      if (profile) {
        setPartner(profile as unknown as VideoDatePartner);
      }

      const resolved = resolvePhaseAndTime(s);
      setPhase(resolved.phase);
      setTimeLeft(resolved.timeLeft);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      lastCompletedSessionKeyRef.current = sessionKey;
      Sentry.addBreadcrumb({
        category: 'video-date-session',
        message: 'session_fetch_complete',
        level: 'info',
        data: {
          session_id: sessionId,
          mode: isInitialLoad ? 'initial' : 'refresh',
          outcome,
        },
      });
    }
  }, [sessionId, userId, resolvePhaseAndTime]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel(`video-date-session-${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'video_sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          setSession((prev) => {
            if (!prev) return prev;
            const next = { ...prev };
            if (row.participant_1_joined_at !== undefined) {
              next.participant_1_joined_at = row.participant_1_joined_at as string | null;
            }
            if (row.participant_2_joined_at !== undefined) {
              next.participant_2_joined_at = row.participant_2_joined_at as string | null;
            }
            if (row.participant_1_liked !== undefined) {
              next.participant_1_liked = row.participant_1_liked as boolean | null;
            }
            if (row.participant_2_liked !== undefined) {
              next.participant_2_liked = row.participant_2_liked as boolean | null;
            }
            if (row.ended_at !== undefined) next.ended_at = row.ended_at as string | null;
            if (row.ended_reason !== undefined) next.ended_reason = row.ended_reason as string | null;
            if (row.state !== undefined) next.state = row.state as string;
            if (row.phase !== undefined) next.phase = row.phase as string;
            if (row.date_started_at !== undefined) next.date_started_at = row.date_started_at as string | null;
            if (row.handshake_started_at !== undefined) next.handshake_started_at = row.handshake_started_at as string | null;
            if (row.handshake_grace_expires_at !== undefined) {
              next.handshake_grace_expires_at = row.handshake_grace_expires_at as string | null;
            }
            if (row.date_extra_seconds !== undefined) {
              next.date_extra_seconds =
                typeof row.date_extra_seconds === 'number' ? row.date_extra_seconds : null;
            }
            const resolved = resolvePhaseAndTime(next);
            setPhase(resolved.phase);
            setTimeLeft(resolved.timeLeft);
            return next;
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, resolvePhaseAndTime]);

  return { session, partner, phase, timeLeft, loading, isRefreshing, error, refetch: fetchSession };
}

type DailyRoomResponseBody = {
  room_name?: string;
  room_url?: string;
  token?: string;
  error?: string;
  code?: string;
};

/** Get Daily room token via daily-room Edge Function (create_date_room). Same contract as web; returns classified errors. */
export async function getDailyRoomToken(sessionId: string): Promise<GetDailyRoomTokenResult> {
  const args = { action: 'create_date_room', sessionId };
  vdbg('daily_room_before', { action: 'create_date_room', args });
  const { data, error, response } = await supabase.functions.invoke<DailyRoomResponseBody>('daily-room', {
    body: args,
  });

  if (!error && data?.token && data.room_name) {
    vdbg('daily_room_after', {
      action: 'create_date_room',
      ok: true,
      roomName: data.room_name,
      hasToken: true,
    });
    return {
      ok: true,
      data: {
        room_name: data.room_name,
        room_url: data.room_url ?? `https://vibelyapp.daily.co/${data.room_name}`,
        token: data.token,
      },
    };
  }

  if (!error && data && !data.token) {
    const failure = await classifyDailyRoomInvokeFailure({
      action: DAILY_ROOM_ACTIONS.CREATE,
      data: { ...data, code: data.code ?? 'MISSING_TOKEN' },
      response,
    });
    vdbg('daily_room_after', {
      action: 'create_date_room',
      ok: false,
      roomName: data.room_name ?? null,
      hasToken: false,
      httpStatus: failure.httpStatus ?? response?.status,
      serverCode: failure.serverCode ?? data.code ?? 'MISSING_TOKEN',
      classifiedCode: failure.kind,
      message: data.error ?? null,
    });
    return {
      ok: false,
      code: failure.kind,
      httpStatus: failure.httpStatus ?? response?.status,
      serverCode: failure.serverCode ?? data.code ?? 'MISSING_TOKEN',
    };
  }

  if (error) {
    const errName = error instanceof Error ? error.name : 'unknown';
    const failure = await classifyDailyRoomInvokeFailure({
      action: DAILY_ROOM_ACTIONS.CREATE,
      invokeError: error,
      response,
      data,
    });

    vdbg('daily_room_after', {
      action: 'create_date_room',
      ok: false,
      hasToken: false,
      httpStatus: failure.httpStatus ?? null,
      serverCode: failure.serverCode ?? null,
      classifiedCode: failure.kind,
      error: { name: errName, message: error.message },
    });
    return {
      ok: false,
      code: failure.kind,
      httpStatus: failure.httpStatus,
      serverCode: failure.serverCode ?? errName,
    };
  }

  vdbg('daily_room_after', {
    action: 'create_date_room',
    ok: false,
    hasToken: false,
    serverCode: 'NO_RESPONSE',
  });
  return { ok: false, code: 'unknown', serverCode: 'NO_RESPONSE' };
}

export async function getDailyRoomTokenWithTimeout(
  sessionId: string,
  timeoutMs: number
): Promise<GetDailyRoomTokenResult> {
  return withTimeout('getDailyRoomToken', getDailyRoomToken(sessionId), timeoutMs);
}

/** Server-owned: enter handshake (start timer). Idempotent; surfaces RPC JSON errors. */
export async function enterHandshake(sessionId: string): Promise<EnterHandshakeResult> {
  const args = {
    p_session_id: sessionId,
    p_action: 'enter_handshake',
  };
  vdbg('video_date_transition_before', { action: 'enter_handshake', args });
  const { data, error } = await supabase.rpc('video_date_transition', args);
  vdbg('video_date_transition_after', {
    action: 'enter_handshake',
    ok: !error && (data as { success?: boolean } | null)?.success !== false,
    payload: data ?? null,
    error: error ? { code: error.code, message: error.message } : null,
  });

  if (error) {
    return { ok: false, code: 'RPC_ERROR', message: error.message };
  }

  const payload = data as { success?: boolean; code?: string; error?: string } | null;
  if (payload && payload.success === false) {
    return {
      ok: false,
      code: payload.code,
      message: payload.error,
    };
  }

  return { ok: true };
}

export async function enterHandshakeWithTimeout(
  sessionId: string,
  timeoutMs: number
): Promise<EnterHandshakeResult> {
  return withTimeout('enterHandshake', enterHandshake(sessionId), timeoutMs);
}

/** Minimal `video_sessions` row for native route guards (stale ER vs backend truth). */
export type VideoSessionDateEntryTruth = {
  id?: string | null;
  participant_1_id?: string | null;
  participant_2_id?: string | null;
  ended_at: string | null;
  ended_reason?: string | null;
  event_id: string | null;
  handshake_started_at: string | null;
  handshake_grace_expires_at?: string | null;
  date_started_at?: string | null;
  state: string | null;
  phase: string | null;
  ready_gate_status: string | null;
  ready_gate_expires_at: string | number | null;
  participant_1_joined_at?: string | null;
  participant_2_joined_at?: string | null;
  participant_1_liked?: boolean | null;
  participant_2_liked?: boolean | null;
};

export async function fetchVideoSessionDateEntryTruth(
  sessionId: string
): Promise<VideoSessionDateEntryTruth | null> {
  const { data, error } = await supabase
    .from('video_sessions')
    .select(`${VIDEO_DATE_HANDSHAKE_TRUTH_SELECT}, event_id, date_started_at, ready_gate_status, ready_gate_expires_at`)
    .eq('id', sessionId)
    .maybeSingle();
  if (error || !data) return null;
  return data as VideoSessionDateEntryTruth;
}

/** True when the session has entered handshake/date on the server (do not bounce to `/ready` from stale `in_ready_gate`). */
export function videoSessionIndicatesHandshakeOrDate(
  vs: Pick<VideoSessionDateEntryTruth, 'handshake_started_at' | 'state' | 'phase'> | null
): boolean {
  return videoSessionRowIndicatesHandshakeOrDate(
    vs
      ? {
          state: vs.state,
          handshake_started_at: vs.handshake_started_at,
        }
      : null
  );
}

/** Poll server reconnect state (`sync_reconnect` path); applies lazy grace expiry on the server. */
/** Idempotent: stamp first Daily join for the current user on this session (after `call.join` succeeds). */
export async function markVideoDateDailyJoined(sessionId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('mark_video_date_daily_joined', {
    p_session_id: sessionId,
  });
  if (error) {
    if (__DEV__) console.warn('[videoDate] markVideoDateDailyJoined:', error.message);
    return false;
  }
  const ok = (data as { ok?: boolean } | null)?.ok === true;
  return ok;
}

export async function syncVideoDateReconnect(sessionId: string): Promise<SyncReconnectPayload | null> {
  const args = {
    p_session_id: sessionId,
    p_action: 'sync_reconnect',
  };
  vdbg('video_date_transition_before', { action: 'sync_reconnect', args });
  const { data, error } = await supabase.rpc('video_date_transition', args);
  vdbg('video_date_transition_after', {
    action: 'sync_reconnect',
    ok: !error,
    payload: data ?? null,
    error: error ? { code: error.code, message: error.message } : null,
  });
  if (error) return null;
  const p = data as {
    reconnect_grace_ends_at?: string | null;
    ended?: boolean;
    ended_reason?: string | null;
    partner_marked_away?: boolean;
  } | null;
  return {
    reconnect_grace_ends_at: p?.reconnect_grace_ends_at ?? null,
    ended: p?.ended === true,
    ended_reason: p?.ended_reason ?? null,
    partner_marked_away: p?.partner_marked_away === true,
  };
}

export async function markReconnectPartnerAway(sessionId: string): Promise<void> {
  const args = {
    p_session_id: sessionId,
    p_action: 'mark_reconnect_partner_away',
  };
  vdbg('video_date_transition_before', { action: 'mark_reconnect_partner_away', args });
  const { data, error } = await supabase.rpc('video_date_transition', args);
  vdbg('video_date_transition_after', {
    action: 'mark_reconnect_partner_away',
    ok: !error,
    payload: data ?? null,
    error: error ? { code: error.code, message: error.message } : null,
  });
}

export async function markReconnectReturn(sessionId: string): Promise<void> {
  const args = {
    p_session_id: sessionId,
    p_action: 'mark_reconnect_return',
  };
  vdbg('video_date_transition_before', { action: 'mark_reconnect_return', args });
  const { data, error } = await supabase.rpc('video_date_transition', args);
  vdbg('video_date_transition_after', {
    action: 'mark_reconnect_return',
    ok: !error,
    payload: data ?? null,
    error: error ? { code: error.code, message: error.message } : null,
  });
}

/** Server-owned: end the date. Idempotent. */
export async function endVideoDate(sessionId: string, reason?: string): Promise<boolean> {
  const args = {
    p_session_id: sessionId,
    p_action: 'end',
    p_reason: reason ?? 'ended_from_client',
  };
  vdbg('video_date_transition_before', { action: 'end', args });
  const { data, error } = await supabase.rpc('video_date_transition', args);
  vdbg('video_date_transition_after', {
    action: 'end',
    ok: !error,
    payload: data ?? null,
    error: error ? { code: error.code, message: error.message } : null,
  });
  return !error;
}

/** Tell backend to delete the Daily room (best-effort). Same as web. */
export async function deleteDailyRoom(roomName: string): Promise<void> {
  try {
    const args = { action: 'delete_room', roomName };
    vdbg('daily_room_before', { action: 'delete_room', args });
    const { error } = await supabase.functions.invoke('daily-room', {
      body: args,
    });
    vdbg('daily_room_after', {
      action: 'delete_room',
      ok: !error,
      roomName,
      error: error ? { name: error.name, message: error.message } : null,
    });
  } catch {
    vdbg('daily_room_after', {
      action: 'delete_room',
      ok: false,
      roomName,
      error: 'exception',
    });
    // best-effort
  }
}

/** Record that current user "vibed" during handshake (participant_1_liked or participant_2_liked). Partner is never notified. */
export async function recordVibe(
  sessionId: string,
  diagnostics?: VideoDateTransitionDiagnostics
): Promise<PersistHandshakeDecisionResult> {
  const actorUserId = diagnostics?.actorUserId ?? null;
  if (!actorUserId) {
    return {
      ok: false,
      action: 'vibe',
      attempts: 0,
      reason: 'actor_not_participant',
      retryable: false,
      actorDecisionPersisted: false,
      actorDecisionSlot: null,
      expectedDecision: true,
      persistedDecision: null,
      rpcPayload: null,
      truth: null,
      userMessage: 'This date is no longer available.',
    };
  }

  const result = await persistHandshakeDecisionWithVerification({
    sessionId,
    actorUserId,
    action: 'vibe',
    rpc: async (args) => {
      vdbg('video_date_transition_before', {
        action: 'vibe',
        sessionId,
        actorUserId,
        currentPhase: diagnostics?.phase ?? null,
        args,
      });
      const { data, error } = await supabase.rpc('video_date_transition', args);
      return {
        data: data ?? null,
        error: error ? { code: error.code, message: error.message, name: error.name } : null,
      };
    },
    fetchTruth: async () => {
      const truth = await fetchVideoSessionDateEntryTruth(sessionId);
      return { truth };
    },
    log: (event, payload) => {
      vdbg(event, {
        ...payload,
        currentPhase: diagnostics?.phase ?? null,
      });
      if (event === 'handshake_decision_rpc_after') {
        vdbg('video_date_transition_after', {
          action: 'vibe',
          sessionId,
          actorUserId,
          currentPhase: diagnostics?.phase ?? null,
          ok: payload.ok,
          payload: payload.rpcPayload ?? null,
          error: payload.error ?? null,
          participant_1_liked: payload.participant_1_liked ?? null,
          participant_2_liked: payload.participant_2_liked ?? null,
          actorDecisionPersisted: payload.actorDecisionPersisted,
        });
      }
    },
  });

  vdbg('handshake_decision_persistence_result', {
    action: 'vibe',
    sessionId,
    actorUserId,
    ok: result.ok,
    attempts: result.attempts,
    reason: result.ok ? null : result.reason,
    rpcPayload: result.rpcPayload,
    actorDecisionSlot: result.actorDecisionSlot,
    expectedDecision: result.expectedDecision,
    persistedDecision: result.persistedDecision,
    actorDecisionPersisted: result.actorDecisionPersisted,
    ...handshakeTruthLogPayload(result.truth),
  });
  return result;
}

/** At handshake end: check mutual vibe. Returns { state: 'date' } if both liked, else terminal/waiting state. */
export async function completeHandshake(sessionId: string): Promise<CompleteHandshakeResult | null> {
  const args = {
    p_session_id: sessionId,
    p_action: 'complete_handshake',
  };
  const truthBefore = await fetchVideoSessionDateEntryTruth(sessionId);
  vdbg('complete_handshake_truth_before', {
    action: 'complete_handshake',
    sessionId,
    ...handshakeTruthLogPayload(truthBefore),
  });
  vdbg('video_date_transition_before', { action: 'complete_handshake', args });
  const { data, error } = await supabase.rpc('video_date_transition', args);
  const truthAfter = await fetchVideoSessionDateEntryTruth(sessionId);
  vdbg('video_date_transition_after', {
    action: 'complete_handshake',
    ok: !error,
    payload: data ?? null,
    error: error ? { code: error.code, message: error.message } : null,
  });
  vdbg('complete_handshake_truth_after', {
    action: 'complete_handshake',
    sessionId,
    ok: !error,
    rpcPayload: data ?? null,
    ...handshakeTruthLogPayload(truthAfter),
  });
  if (error) return null;
  const payload = data as Partial<CompleteHandshakeResult> | null;
  const state = payload?.state;
  return {
    state: state === 'date' || state === 'handshake' || state === 'ended' ? state : 'ended',
    waiting_for_partner: payload?.waiting_for_partner,
    grace_expires_at: payload?.grace_expires_at,
    seconds_remaining: payload?.seconds_remaining,
    already_ended: payload?.already_ended,
    reason: payload?.reason,
  };
}

/** Update event registration queue_status (in_handshake, in_date, in_survey, browsing, offline). */
export async function updateParticipantStatus(eventId: string, status: string): Promise<boolean> {
  const { error } = await supabase.rpc('update_participant_status', {
    p_event_id: eventId,
    p_status: status,
  });
  return !error;
}

export type PartnerProfileData = {
  name: string;
  age: number;
  avatarUrl: string | null;
  photos: string[];
  about_me: string | null;
  job: string | null;
  location: string | null;
  heightCm: number | null;
  tags: string[];
  prompts: { question: string; answer: string }[];
};

export type FetchPartnerProfileResult =
  | {
      ok: true;
      partnerId: string;
      eventId: string;
      isParticipant1: boolean;
      partner: PartnerProfileData;
    }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'access_denied'; eventId: string | null };

/** Fetch full partner profile for video date (session + profiles + profile_vibes). */
export async function fetchPartnerProfile(
  sessionId: string,
  userId: string,
  avatarUrlResolver: (path: string | null) => string
): Promise<FetchPartnerProfileResult> {
  const { data: session } = await supabase
    .from('video_sessions')
    .select('participant_1_id, participant_2_id, event_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return { ok: false, reason: 'not_found' };

  const isP1 = session.participant_1_id === userId;
  const isParticipant = isP1 || session.participant_2_id === userId;
  if (!isParticipant) {
    return { ok: false, reason: 'access_denied', eventId: session.event_id ?? null };
  }

  const partnerId = isP1 ? session.participant_2_id : session.participant_1_id;

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, age, avatar_url, photos, about_me, job, location, height_cm, prompts')
    .eq('id', partnerId)
    .maybeSingle();
  if (!profile) return { ok: false, reason: 'not_found' };

  const { data: vibes } = await supabase
    .from('profile_vibes')
    .select('vibe_tags(label)')
    .eq('profile_id', partnerId);
  const tags = (vibes ?? [])
    .map((v: unknown) => {
      const vt = (v as { vibe_tags?: { label?: string } | { label?: string }[] | null })?.vibe_tags;
      if (Array.isArray(vt)) return vt.map((t) => t?.label).filter(Boolean);
      return vt?.label ? [vt.label] : [];
    })
    .flat()
    .filter(Boolean) as string[];

  const photoArr = (profile.photos as string[] | null) ?? [];
  const primaryPath = photoArr[0] ?? profile.avatar_url ?? null;
  const photos = photoArr.slice(0, 6).map((p) => avatarUrlResolver(p));
  const avatarUrlResolved = primaryPath ? avatarUrlResolver(primaryPath) : null;

  let prompts: { question: string; answer: string }[] = [];
  if (profile.prompts && Array.isArray(profile.prompts)) {
    prompts = (profile.prompts as { question?: string; answer?: string }[]).map((p) => ({
      question: p.question ?? '',
      answer: p.answer ?? '',
    }));
  }

  return {
    ok: true,
    partnerId,
    eventId: session.event_id ?? '',
    isParticipant1: isP1,
    partner: {
      name: profile.name ?? 'Your date',
      age: profile.age ?? 0,
      avatarUrl: avatarUrlResolved,
      photos,
      about_me: profile.about_me ?? null,
      job: profile.job ?? null,
      location: profile.location ?? null,
      heightCm: profile.height_cm ?? null,
      tags,
      prompts,
    },
  };
}

const VIBE_PROMPTS = [
  "What's a weird talent you have? 🎭",
  "Dream travel destination? ✈️",
  "What's your go-to karaoke song? 🎤",
  "Best date you've ever been on? 💫",
  "What's something that instantly makes you smile? 😊",
  "If you could have dinner with anyone, who? 🍽️",
  "What's your love language? 💕",
  "Describe your perfect lazy Sunday ☀️",
  "What's on your bucket list? ✨",
  "What makes you feel most alive? 🔥",
  "Early bird or night owl? 🦉",
  "What's your comfort movie? 🎬",
  "Beach vacation or mountain adventure? 🏔️",
  "What are you passionate about? 💜",
  "What's your hidden gem restaurant? 🍜",
];

function fisherYatesShuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Get or seed vibe_questions for session; returns array of question strings. */
export async function getOrSeedVibeQuestions(sessionId: string): Promise<string[]> {
  const { data, error: fetchError } = await supabase
    .from('video_sessions')
    .select('vibe_questions')
    .eq('id', sessionId)
    .maybeSingle();
  if (fetchError) {
    if (__DEV__) console.warn('[videoDateApi] failed to fetch vibe_questions:', fetchError.message);
    return fisherYatesShuffle(VIBE_PROMPTS);
  }
  const stored = data?.vibe_questions as string[] | null;
  if (stored && Array.isArray(stored) && stored.length > 0) return stored;

  const shuffled = fisherYatesShuffle(VIBE_PROMPTS);

  // Only update if vibe_questions is currently null (prevents race between two clients)
  const { data: updated, error: updateError } = await supabase
    .from('video_sessions')
    .update({ vibe_questions: shuffled })
    .eq('id', sessionId)
    .is('vibe_questions', null)
    .select('vibe_questions')
    .maybeSingle();

  if (updateError) {
    if (__DEV__) console.warn('[videoDateApi] failed to seed vibe_questions:', updateError.message);
  }

  // If another client seeded first, fetch what they wrote
  if (!updated?.vibe_questions) {
    const { data: refetched } = await supabase
      .from('video_sessions')
      .select('vibe_questions')
      .eq('id', sessionId)
      .maybeSingle();
    const refetchedQuestions = refetched?.vibe_questions as string[] | null;
    if (refetchedQuestions && Array.isArray(refetchedQuestions) && refetchedQuestions.length > 0) {
      return refetchedQuestions;
    }
  }

  return (updated?.vibe_questions as string[]) ?? shuffled;
}

/** Discriminated outcome for `post-date-verdict` (explicit backend failure vs network vs success paths). */
export type SubmitVerdictAndCheckMutualResult =
  | {
      ok: true;
      mutual: boolean;
      match_id?: string;
      persistent_match_created?: boolean | null;
      already_matched?: boolean;
    }
  | { ok: false; reason: 'backend'; code: string; message?: string }
  | { ok: false; reason: 'network' }
  | { ok: false; reason: 'unknown' };

type PostDateVerdictResponseBody = {
  success?: boolean;
  error?: string;
  message?: string;
  mutual?: boolean;
  match_id?: string;
  persistent_match_created?: boolean | null;
  already_matched?: boolean;
  verdict_recorded?: boolean;
};

function verdictBreadcrumb(
  message: 'verdict_backend_rejected' | 'verdict_invoke_failed',
  data: Record<string, string | number | boolean | undefined>
) {
  Sentry.addBreadcrumb({
    category: 'post-date-verdict',
    message,
    level: message === 'verdict_backend_rejected' ? 'warning' : 'error',
    data,
  });
}

/**
 * Post-date survey screen 1: single backend path (`post-date-verdict` Edge → `submit_post_date_verdict` RPC).
 * Do not write video_sessions / date_feedback for the mandatory verdict from the client.
 */
export async function submitVerdictAndCheckMutual(
  sessionId: string,
  _userId: string,
  _partnerId: string,
  liked: boolean
): Promise<SubmitVerdictAndCheckMutualResult> {
  const { data, error, response } = await supabase.functions.invoke<PostDateVerdictResponseBody>('post-date-verdict', {
    body: { session_id: sessionId, liked },
  });

  if (error) {
    const errName = error instanceof Error ? error.name : 'unknown';

    if (errName === 'FunctionsFetchError' || errName === 'FunctionsRelayError') {
      verdictBreadcrumb('verdict_invoke_failed', { errName });
      return { ok: false, reason: 'network' };
    }

    if (response && typeof (response as Response).clone === 'function') {
      const res = response as Response;
      const status = res.status;
      let body: PostDateVerdictResponseBody | null = null;
      try {
        body = await res.clone().json();
      } catch {
        /* non-JSON */
      }
      if (body?.success === false && body.error) {
        verdictBreadcrumb('verdict_backend_rejected', { code: body.error });
        return { ok: false, reason: 'backend', code: body.error, message: body.message };
      }
      if (status === 401 || body?.error === 'Unauthorized') {
        verdictBreadcrumb('verdict_backend_rejected', { code: 'unauthorized' });
        return { ok: false, reason: 'backend', code: 'unauthorized' };
      }
      verdictBreadcrumb('verdict_invoke_failed', { errName, httpStatus: status });
      return { ok: false, reason: 'unknown' };
    }

    verdictBreadcrumb('verdict_invoke_failed', { errName });
    return { ok: false, reason: 'unknown' };
  }

  const row = data as PostDateVerdictResponseBody | null;
  if (!row || typeof row !== 'object') {
    verdictBreadcrumb('verdict_invoke_failed', { detail: 'missing_body' });
    return { ok: false, reason: 'unknown' };
  }

  if (row.success === false) {
    verdictBreadcrumb('verdict_backend_rejected', { code: row.error ?? 'unknown' });
    return {
      ok: false,
      reason: 'backend',
      code: row.error ?? 'unknown',
      message: row.message,
    };
  }

  if (row.error === 'Unauthorized') {
    verdictBreadcrumb('verdict_backend_rejected', { code: 'unauthorized' });
    return { ok: false, reason: 'backend', code: 'unauthorized' };
  }

  const mutual = row.mutual === true;
  return {
    ok: true,
    mutual,
    match_id: typeof row.match_id === 'string' ? row.match_id : undefined,
    persistent_match_created: row.persistent_match_created,
    already_matched: typeof row.already_matched === 'boolean' ? row.already_matched : undefined,
  };
}

/** Fetch user credits for +Time (extra_time_credits, extended_vibe_credits). */
export async function fetchUserCredits(userId: string): Promise<{ extraTime: number; extendedVibe: number }> {
  const { data } = await supabase
    .from('user_credits')
    .select('extra_time_credits, extended_vibe_credits')
    .eq('user_id', userId)
    .maybeSingle();
  return {
    extraTime: data?.extra_time_credits ?? 0,
    extendedVibe: data?.extended_vibe_credits ?? 0,
  };
}

/** Deduct one credit (extra_time or extended_vibe). Returns true if successful. */
export async function deductCredit(userId: string, creditType: 'extra_time' | 'extended_vibe'): Promise<boolean> {
  const { data, error } = await supabase.rpc('deduct_credit', {
    p_user_id: userId,
    p_credit_type: creditType,
  });
  return !error && data === true;
}

export type SpendVideoDateCreditExtensionResult =
  | { ok: true }
  | { ok: false; error: string };

/** Atomic credit spend + server budget for date phase (parity with web VideoDate). */
export async function spendVideoDateCreditExtension(
  sessionId: string,
  creditType: 'extra_time' | 'extended_vibe'
): Promise<SpendVideoDateCreditExtensionResult> {
  const { data, error } = await supabase.rpc('spend_video_date_credit_extension', {
    p_session_id: sessionId,
    p_credit_type: creditType,
  });
  if (error) {
    return { ok: false, error: 'rpc_transport' };
  }
  const parsed = parseSpendVideoDateCreditExtensionPayload(data);
  if (parsed.success) {
    return { ok: true };
  }
  return { ok: false, error: parsed.error };
}

export { HANDSHAKE_SECONDS, DATE_SECONDS };
