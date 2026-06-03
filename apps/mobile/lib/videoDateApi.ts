/**
 * Video date API: session state, Daily room token, and backend-owned transitions.
 * Uses same contracts as web: daily-room Edge Function, video_date_transition RPC.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as Sentry from '@sentry/react-native';
import { supabase } from '@/lib/supabase';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { avatarUrl } from '@/lib/imageUrl';
import { vdbg } from '@/lib/vdbg';
import { trackEvent } from '@/lib/analytics';
import { submitNativePostDateOutboxItem } from '@/lib/postDateOutbox/execute';
import { prepareVideoDateEntry } from '@/lib/videoDatePrepareEntry';
import { fetchVideoDateSnapshot } from '@/lib/videoDateSnapshot';
import { fetchVideoDateStartSnapshot } from '@/lib/videoDateStartSnapshot';
import {
  clearVideoDatePushPreload,
  readVideoDatePushPreloadTimeline,
} from '@/lib/videoDatePushPreload';
import { LobbyPostDateEvents } from '@clientShared/analytics/lobbyToPostDateJourney';
import { videoSessionRowIndicatesHandshakeOrDate } from '@clientShared/matching/activeSession';
import { videoDateStartSnapshotToDateEntryTruth } from '@clientShared/matching/videoDateStartSnapshot';
import type { DailyRoomFailureKind } from '@clientShared/matching/dailyRoomFailure';
import { sendVideoDateSignalWithRetry } from '@clientShared/matching/videoDateSignalRetry';
import {
  buildVideoDateExtensionIdempotencyKey,
  buildVideoDateMutualExtensionIdempotencyKey,
  buildVideoDateTransitionIdempotencyKey,
} from '@clientShared/matching/videoDateTransitionCommands';
import {
  parseSpendVideoDateCreditExtensionPayload,
} from '@clientShared/matching/videoDateExtensionSpend';
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
import {
  applyVideoDateTimelineSnapshot,
  resolveVideoDateTimelineCountdown,
  type VideoDateTimelineState,
} from '@clientShared/matching/videoDateTimeline';
import { resolveVideoDatePhaseCountdown } from '@clientShared/matching/videoDateCountdown';
import {
  VIDEO_DATE_HANDSHAKE_TRUTH_SELECT,
  handshakeTruthLogPayload,
  persistHandshakeDecisionWithVerification,
  type PersistHandshakeDecisionResult,
} from '@clientShared/matching/videoDateHandshakePersistence';
import {
  fallbackVideoDateIceBreakerState,
  normalizeVideoDateIceBreakerIndex,
  normalizeVideoDateIceBreakerQuestions,
  shuffleVideoDateIceBreakerQuestions,
  type VideoDateIceBreakerState,
} from '@clientShared/matching/videoDateIceBreakers';
import {
  normalizeServerPostDateNextSurface,
  type ServerPostDateNextSurface,
} from '@clientShared/matching/postDateContinuity';
import type { PostDateVerdictState } from '@clientShared/matching/postDateVerdictConfirmation';
import type { PostDateSafetyReportPayload } from '@clientShared/postDateOutbox/types';

export type VideoDateSession = {
  id: string;
  participant_1_id: string;
  participant_2_id: string;
  event_id: string;
  session_seq?: number | null;
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
  /** First server-stamped remote media evidence for each participant. */
  participant_1_remote_seen_at?: string | null;
  participant_2_remote_seen_at?: string | null;
  /** Handshake Vibe decision slots. Null means the actor has not persisted a decision yet. */
  participant_1_liked?: boolean | null;
  participant_2_liked?: boolean | null;
  participant_1_decided_at?: string | null;
  participant_2_decided_at?: string | null;
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
  token_expires_at?: string | null;
  entry_attempt_id?: string | null;
  video_date_trace_id?: string | null;
  cached_prepare_entry?: boolean;
  provider_verify_skipped?: boolean | null;
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
      entry_attempt_id?: string | null;
      video_date_trace_id?: string | null;
    };

export type EnterHandshakeResult =
  | { ok: true }
  | { ok: false; code?: string; message?: string };

export type CompleteHandshakeResult = {
  state: 'date' | 'ended' | 'handshake';
  waiting_for_partner?: boolean;
  waiting_for_self?: boolean;
  local_decision_persisted?: boolean;
  partner_decision_persisted?: boolean;
  grace_expires_at?: string;
  seconds_remaining?: number;
  already_ended?: boolean;
  reason?: string;
  survey_required?: boolean;
};

type VideoDateTransitionDiagnostics = {
  actorUserId?: string | null;
  phase?: string | null;
};

type RecordHandshakeDecisionOptions = {
  continueHandshakeV2?: boolean;
};

type EndVideoDateOptions = {
  dateTimeoutV2?: boolean;
};

type CompleteHandshakeOptions = {
  handshakeAutoPromoteV2?: boolean;
};

type SubmitVerdictOptions = {
  submitVerdictV3?: boolean;
};

type SpendVideoDateCreditExtensionOptions = {
  extensionV2?: boolean;
  extensionMutualV2?: boolean;
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
  userId: string | null | undefined,
  options?: { onBroadcastEvent?: (event: VideoDateSessionBroadcastEvent) => void }
) {
  const broadcastV2 = useFeatureFlag('video_date.broadcast_v2');
  const timelineV2 = useFeatureFlag('video_date.timeline_v2');
  const pushPayloadV2 = useFeatureFlag('video_date.push_payload_v2');
  const initialPushTimeline = useMemo(
    () => pushPayloadV2.enabled ? readVideoDatePushPreloadTimeline(sessionId) : null,
    [pushPayloadV2.enabled, sessionId],
  );
  const initialPushCountdown = useMemo(
    () => initialPushTimeline ? resolveVideoDateTimelineCountdown(initialPushTimeline) : null,
    [initialPushTimeline],
  );
  const [session, setSession] = useState<VideoDateSession | null>(null);
  const [partner, setPartner] = useState<VideoDatePartner | null>(null);
  const [phase, setPhase] = useState<'handshake' | 'date' | 'ended'>(
    initialPushTimeline?.phase === 'date' ? 'date' : 'handshake',
  );
  const [timeLeft, setTimeLeft] = useState<number | null>(initialPushCountdown?.remainingSeconds ?? null);
  const [timeline, setTimeline] = useState<VideoDateTimelineState | null>(initialPushTimeline);
  const [loading, setLoading] = useState(true);
  /** True during post-mount refetches; does not drive full-screen loading in date UI. */
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** After first completed fetch for `sessionId:userId`, further refetches use `isRefreshing` only. */
  const lastCompletedSessionKeyRef = useRef<string | null>(null);
  const currentSessionKeyRef = useRef<string | null>(null);
  const sessionSeqRef = useRef<number | null>(null);
  const broadcastRefetchInFlightRef = useRef(false);
  const broadcastGapRecoveryRef = useRef<VideoDateBroadcastGapRecoveryState | null>(null);
  const broadcastGapRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineRef = useRef<VideoDateTimelineState | null>(null);
  const onBroadcastEvent = options?.onBroadcastEvent;

  useEffect(() => {
    currentSessionKeyRef.current = sessionId && userId ? `${sessionId}:${userId}` : null;
    sessionSeqRef.current = null;
    broadcastRefetchInFlightRef.current = false;
    broadcastGapRecoveryRef.current = null;
    if (broadcastGapRetryTimerRef.current) {
      clearTimeout(broadcastGapRetryTimerRef.current);
      broadcastGapRetryTimerRef.current = null;
    }
    timelineRef.current = initialPushTimeline;
    setTimeline(initialPushTimeline);
    setPhase(initialPushTimeline?.phase === 'date' ? 'date' : 'handshake');
    setTimeLeft(initialPushCountdown?.remainingSeconds ?? null);
    return () => {
      currentSessionKeyRef.current = null;
    };
  }, [initialPushCountdown, initialPushTimeline, sessionId, userId]);

  useEffect(() => {
    if (initialPushTimeline) clearVideoDatePushPreload(sessionId);
  }, [initialPushTimeline, sessionId]);

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  type PhaseResolution = {
    phase: 'handshake' | 'date' | 'ended';
    timeLeft: number | null;
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
        const countdown = resolveVideoDatePhaseCountdown({
          phase: 'date',
          handshakeStartedAtIso: row.handshake_started_at,
          dateStartedAtIso: dateStarted,
          handshakeDurationSeconds: HANDSHAKE_SECONDS,
          dateDurationSeconds: DATE_SECONDS,
          dateExtraSeconds: row.date_extra_seconds,
        });
        return {
          phase: 'date',
          timeLeft: countdown.remainingSeconds,
        };
      }

      if (
        videoSessionRowIndicatesHandshakeOrDate({
          state,
          handshake_started_at: row.handshake_started_at,
        })
      ) {
        if (row.handshake_started_at) {
          const countdown = resolveVideoDatePhaseCountdown({
            phase: 'handshake',
            handshakeStartedAtIso: row.handshake_started_at,
            dateStartedAtIso: row.date_started_at,
            handshakeDurationSeconds: HANDSHAKE_SECONDS,
            dateDurationSeconds: DATE_SECONDS,
            dateExtraSeconds: row.date_extra_seconds,
          });
          return {
            phase: 'handshake',
            timeLeft: countdown.remainingSeconds ?? 0,
          };
        }
        return { phase: 'handshake', timeLeft: null };
      }

      // Ready/prejoin fallback.
      return { phase: 'handshake', timeLeft: null };
    },
    []
  );

  const fetchSession = useCallback(async () => {
    if (!sessionId || !userId) return;
    const sessionKey = `${sessionId}:${userId}`;
    currentSessionKeyRef.current = sessionKey;
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
          'id, participant_1_id, participant_2_id, event_id, session_seq, state, phase, ended_at, ended_reason, handshake_started_at, handshake_grace_expires_at, date_started_at, date_extra_seconds, daily_room_name, daily_room_url, participant_1_joined_at, participant_2_joined_at, participant_1_remote_seen_at, participant_2_remote_seen_at, participant_1_liked, participant_2_liked, participant_1_decided_at, participant_2_decided_at'
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
      const maybeSeq = (row as unknown as { session_seq?: unknown }).session_seq;
      if (typeof maybeSeq === 'number' && Number.isFinite(maybeSeq)) {
        sessionSeqRef.current = maybeSeq;
      }

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
      const { data: profile } = await supabase.rpc('get_profile_for_viewer', {
        p_target_id: partnerId,
      });

      if (profile) {
        const row = profile as { id?: string; name?: string | null; age?: number | null; avatar_url?: string | null };
        const rawAvatarUrl = typeof row.avatar_url === 'string' ? row.avatar_url : null;
        setPartner({
          id: row.id ?? partnerId,
          name: row.name ?? 'Your date',
          age: row.age ?? null,
          avatar_url: rawAvatarUrl ? avatarUrl(rawAvatarUrl, 'avatar') : null,
        });
      }

      const legacyResolved = resolvePhaseAndTime(s);
      setPhase(legacyResolved.phase);
      setTimeLeft(legacyResolved.timeLeft);

      if (timelineV2.enabled) {
        void (async () => {
          const snapshot = await fetchVideoDateSnapshot(sessionId, { includeToken: false });
          if (currentSessionKeyRef.current !== sessionKey) return;
          const decision = applyVideoDateTimelineSnapshot(snapshot, timelineRef.current, {
            clientNowMs: Date.now(),
            expectedSessionId: sessionId,
          });
          if (decision.action === 'accepted') {
            if (sessionSeqRef.current !== null && decision.timeline.seq < sessionSeqRef.current) return;
            timelineRef.current = decision.timeline;
            setTimeline(decision.timeline);
            sessionSeqRef.current = Math.max(sessionSeqRef.current ?? 0, decision.timeline.seq);
            if (decision.timeline.phase === 'handshake' || decision.timeline.phase === 'date') {
              const countdown = resolveVideoDateTimelineCountdown(decision.timeline);
              setPhase(decision.timeline.phase);
              setTimeLeft(countdown.remainingSeconds ?? 0);
            } else if (decision.timeline.phase === 'ended') {
              setPhase('ended');
              setTimeLeft(0);
            }
          }
        })();
      }
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
  }, [sessionId, userId, resolvePhaseAndTime, timelineV2.enabled]);

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
            if (row.participant_1_remote_seen_at !== undefined) {
              next.participant_1_remote_seen_at = row.participant_1_remote_seen_at as string | null;
            }
            if (row.participant_2_remote_seen_at !== undefined) {
              next.participant_2_remote_seen_at = row.participant_2_remote_seen_at as string | null;
            }
            if (row.participant_1_liked !== undefined) {
              next.participant_1_liked = row.participant_1_liked as boolean | null;
            }
            if (row.participant_2_liked !== undefined) {
              next.participant_2_liked = row.participant_2_liked as boolean | null;
            }
            if (row.participant_1_decided_at !== undefined) {
              next.participant_1_decided_at = row.participant_1_decided_at as string | null;
            }
            if (row.participant_2_decided_at !== undefined) {
              next.participant_2_decided_at = row.participant_2_decided_at as string | null;
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
        const latestState =
          broadcastGapRecoveryRef.current?.sessionId === state.sessionId
            ? broadcastGapRecoveryRef.current
            : state;
        if (snapshot.ok === true) {
          if (timelineV2.enabled) {
            const timelineDecision = applyVideoDateTimelineSnapshot(snapshot, timelineRef.current, {
              clientNowMs: Date.now(),
              expectedSessionId: sessionId,
            });
            if (
              timelineDecision.action === 'accepted' &&
              (sessionSeqRef.current === null || timelineDecision.timeline.seq >= sessionSeqRef.current)
            ) {
              timelineRef.current = timelineDecision.timeline;
              setTimeline(timelineDecision.timeline);
            }
          }
          sessionSeqRef.current = Math.max(sessionSeqRef.current ?? 0, snapshot.seq);
          broadcastGapRecoveryRef.current = recordVideoDateBroadcastGapRecoverySuccess(latestState, snapshot.seq);
        } else {
          broadcastGapRecoveryRef.current = recordVideoDateBroadcastGapRecoveryFailure(latestState, snapshot.error);
        }
        Sentry.addBreadcrumb({
          category: 'video-date-broadcast',
          message: 'snapshot_refetch_on_seq_gap_retry',
          level: snapshot.ok ? 'info' : 'warning',
          data: {
            session_id: sessionId,
            source,
            target_seq: state.targetSeq,
            expected_seq: state.expectedSeq,
            attempt: state.attempts + 1,
            snapshot_ok: snapshot.ok,
          },
        });
        await fetchSession();
      } catch (error) {
        broadcastGapRecoveryRef.current = recordVideoDateBroadcastGapRecoveryFailure(state, error);
      } finally {
        broadcastRefetchInFlightRef.current = false;
      }

      clearBroadcastGapRetryTimer();
      const delayMs = videoDateBroadcastGapRetryDelayMs(broadcastGapRecoveryRef.current);
      if (delayMs != null) {
        broadcastGapRetryTimerRef.current = setTimeout(() => {
          broadcastGapRetryTimerRef.current = null;
          void attemptBroadcastGapSnapshotRecovery('bounded_timer');
        }, delayMs);
      }
    },
    [clearBroadcastGapRetryTimer, fetchSession, sessionId, timelineV2.enabled, userId],
  );

  const reconcileBroadcastEvent = useCallback(
    async (event: VideoDateSessionBroadcastEvent) => {
      if (!sessionId || !userId) return;
      const decision = resolveVideoDateSessionSeqDecision(sessionSeqRef.current, event.sessionSeq);
      if (decision.action === 'invalid' || decision.action === 'duplicate') return;

      onBroadcastEvent?.(event);
      if (decision.action === 'gap') {
        broadcastGapRecoveryRef.current = mergeVideoDateBroadcastGapRecovery(broadcastGapRecoveryRef.current, {
          sessionId,
          targetSeq: event.sessionSeq,
          expectedSeq: decision.expectedSeq,
        });
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
    [attemptBroadcastGapSnapshotRecovery, clearBroadcastGapRetryTimer, fetchSession, onBroadcastEvent, sessionId, userId],
  );

  useEffect(() => {
    if (!sessionId || !userId || !broadcastV2.enabled) return;
    const subscription = createVideoDateSessionChannel(supabase, {
      sessionId,
      onEvent: (event) => {
        void reconcileBroadcastEvent(event);
      },
      onInvalidPayload: () => {
        Sentry.addBreadcrumb({
          category: 'video-date-broadcast',
          message: 'invalid_payload_ignored',
          level: 'warning',
          data: { session_id: sessionId },
        });
      },
      onStatusChange: (status, error) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          Sentry.addBreadcrumb({
            category: 'video-date-broadcast',
            message: 'session_channel_status',
            level: 'warning',
            data: {
              session_id: sessionId,
              status,
              error: error instanceof Error ? error.message : String(error ?? ''),
            },
          });
        }
      },
    });
    return () => {
      subscription.unsubscribe();
      clearBroadcastGapRetryTimer();
      broadcastGapRecoveryRef.current = null;
    };
  }, [broadcastV2.enabled, clearBroadcastGapRetryTimer, reconcileBroadcastEvent, sessionId, userId]);

  return { session, partner, phase, timeLeft, timeline, loading, isRefreshing, error, refetch: fetchSession, retryBroadcastGapRecovery: attemptBroadcastGapSnapshotRecovery };
}

/** Get Daily room token via daily-room Edge Function (prepare_date_entry). Same contract as web; returns classified errors. */
export async function getDailyRoomToken(sessionId: string, userId?: string | null): Promise<GetDailyRoomTokenResult> {
  const args = { action: 'prepare_date_entry', sessionId, userId: userId ?? null };
  vdbg('daily_room_before', { action: 'prepare_date_entry', args });
  const invokeStarted = Date.now();
  const result = await prepareVideoDateEntry(sessionId, { userId, source: 'native_video_date_token' });
  Sentry.addBreadcrumb({
    category: 'video-date-launch',
    message: 'daily_room_edge_invoke',
    level: 'info',
    data: {
      session_id: sessionId,
      duration_ms: Date.now() - invokeStarted,
      ok: result.ok,
      cached: result.ok === true ? result.cached : false,
      entry_attempt_id: result.ok === true ? result.data.entry_attempt_id ?? null : result.entryAttemptId ?? null,
      video_date_trace_id:
        result.ok === true
          ? result.data.video_date_trace_id ?? result.data.entry_attempt_id ?? null
          : result.entryAttemptId ?? null,
    },
  });

  if (result.ok === true) {
    vdbg('daily_room_after', {
      action: 'prepare_date_entry',
      ok: true,
      roomName: result.data.room_name,
      hasToken: true,
      cached: result.cached,
      entryAttemptId: result.data.entry_attempt_id ?? null,
      videoDateTraceId: result.data.video_date_trace_id ?? result.data.entry_attempt_id ?? null,
    });
    return {
      ok: true,
      data: {
        room_name: result.data.room_name,
        room_url: result.data.room_url,
        token: result.data.token,
        token_expires_at: result.data.token_expires_at ?? null,
        entry_attempt_id: result.data.entry_attempt_id ?? null,
        video_date_trace_id: result.data.video_date_trace_id ?? result.data.entry_attempt_id ?? null,
        cached_prepare_entry: result.cached,
        provider_verify_skipped: result.data.provider_verify_skipped ?? null,
      },
    };
  }

  vdbg('daily_room_after', {
    action: 'prepare_date_entry',
    ok: false,
    hasToken: false,
    httpStatus: result.httpStatus ?? null,
    serverCode: result.code,
    classifiedCode: result.code,
    message: result.message ?? null,
  });
  return {
    ok: false,
    code: result.code as RoomTokenFailureCode,
    httpStatus: result.httpStatus,
    serverCode: result.code,
    entry_attempt_id: result.entryAttemptId ?? null,
    video_date_trace_id: result.entryAttemptId ?? null,
  };
}

export async function getDailyRoomTokenWithTimeout(
  sessionId: string,
  timeoutMs: number,
  userId?: string | null,
): Promise<GetDailyRoomTokenResult> {
  return withTimeout('getDailyRoomToken', getDailyRoomToken(sessionId, userId), timeoutMs);
}

/** Server-owned: enter handshake (start timer). Idempotent; surfaces RPC JSON errors. */
export async function enterHandshake(sessionId: string): Promise<EnterHandshakeResult> {
  const args = {
    p_session_id: sessionId,
    p_action: 'enter_handshake',
  };
  vdbg('video_date_transition_before', { action: 'enter_handshake', args });
  const rpcStarted = Date.now();
  const { data, error } = await supabase.rpc('video_date_transition', args);
  Sentry.addBreadcrumb({
    category: 'video-date-launch',
    message: 'enter_handshake_rpc',
    level: 'info',
    data: {
      session_id: sessionId,
      duration_ms: Date.now() - rpcStarted,
      ok: !error && (data as { success?: boolean } | null)?.success !== false,
    },
  });
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
  daily_room_name?: string | null;
  daily_room_url?: string | null;
  handshake_started_at: string | null;
  handshake_grace_expires_at?: string | null;
  date_started_at?: string | null;
  state: string | null;
  phase: string | null;
  ready_gate_status: string | null;
  ready_gate_expires_at: string | number | null;
  participant_1_joined_at?: string | null;
  participant_2_joined_at?: string | null;
  participant_1_remote_seen_at?: string | null;
  participant_2_remote_seen_at?: string | null;
  participant_1_liked?: boolean | null;
  participant_2_liked?: boolean | null;
  participant_1_decided_at?: string | null;
  participant_2_decided_at?: string | null;
};

export async function fetchVideoSessionDateEntryTruth(
  sessionId: string
): Promise<VideoSessionDateEntryTruth | null> {
  const snapshot = await fetchVideoDateStartSnapshot(sessionId);
  const snapshotTruth = videoDateStartSnapshotToDateEntryTruth(snapshot);
  if (snapshotTruth) return snapshotTruth as VideoSessionDateEntryTruth;

  const { data, error } = await supabase
    .from('video_sessions')
    .select(`${VIDEO_DATE_HANDSHAKE_TRUTH_SELECT}, event_id, date_started_at, ready_gate_status, ready_gate_expires_at`)
    .eq('id', sessionId)
    .maybeSingle();
  if (error || !data) return null;
  return data as VideoSessionDateEntryTruth;
}

/** Single-flight for concurrent reads of the same session (route guard + hydration + prejoin truth0). */
const dateEntryTruthInflight = new Map<string, Promise<VideoSessionDateEntryTruth | null>>();

export function fetchVideoSessionDateEntryTruthCoalesced(
  sessionId: string
): Promise<VideoSessionDateEntryTruth | null> {
  const existing = dateEntryTruthInflight.get(sessionId);
  if (existing) return existing;
  const p = fetchVideoSessionDateEntryTruth(sessionId).finally(() => {
    dateEntryTruthInflight.delete(sessionId);
  });
  dateEntryTruthInflight.set(sessionId, p);
  return p;
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

export async function markReconnectSelfAway(sessionId: string, reason = 'app_background'): Promise<void> {
  const args = {
    p_session_id: sessionId,
    p_action: 'mark_reconnect_self_away',
    p_reason: reason,
  };
  vdbg('video_date_transition_before', { action: 'mark_reconnect_self_away', args });
  const { data, error } = await supabase.rpc('video_date_transition', args);
  vdbg('video_date_transition_after', {
    action: 'mark_reconnect_self_away',
    ok: !error,
    payload: data ?? null,
    error: error ? { code: error.code, message: error.message } : null,
  });
}

export async function signalVideoDateLeave(sessionId: string, reason = 'app_background'): Promise<boolean> {
  const args = {
    action: 'video_date_leave',
    sessionId,
    reason,
  };
  vdbg('daily_room_before', { action: 'video_date_leave', args });
  const result = await sendVideoDateSignalWithRetry({
    sessionId,
    action: 'video_date_leave',
    operation: async (attempt, idempotencyKey) => {
      const { data, error } = await supabase.functions.invoke('daily-room', {
        body: {
          ...args,
          idempotency_key: idempotencyKey,
        },
      });
      vdbg('daily_room_after', {
        action: 'video_date_leave',
        ok: !error && (data as { success?: boolean } | null)?.success !== false,
        sessionId,
        reason,
        attempt,
        idempotencyKey,
        error: error ? { name: error.name, message: error.message } : null,
        code: (data as { code?: string } | null)?.code ?? null,
      });
      if (error) throw error;
      return data;
    },
    isSuccess: (data) => (data as { success?: boolean } | null)?.success !== false,
  });
  if (result.ok) return true;
  vdbg('daily_room_after', {
    action: 'video_date_leave',
    ok: false,
    sessionId,
    reason,
    attempts: result.attempts,
    error:
      result.error instanceof Error
        ? { name: result.error.name, message: result.error.message }
        : result.error == null
          ? null
          : String(result.error),
  });
  return false;
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
export async function endVideoDate(
  sessionId: string,
  reason?: string,
  options?: EndVideoDateOptions
): Promise<boolean> {
  const useDateTimeoutV2 = reason === 'date_timeout' && options?.dateTimeoutV2 === true;
  const args = {
    p_session_id: sessionId,
    p_action: 'end',
    p_reason: reason ?? 'ended_from_client',
  };
  vdbg('video_date_transition_before', { action: 'end', args });
  const result = await sendVideoDateSignalWithRetry({
    sessionId,
    action: useDateTimeoutV2 ? 'phase3:date_timeout' : 'end',
    operation: async (attempt, idempotencyKey) => {
      const { data, error } =
        useDateTimeoutV2
          ? await supabase.rpc('video_session_date_timeout_v2' as never, {
              p_session_id: sessionId,
              p_idempotency_key: idempotencyKey,
            } as never)
          : await supabase.rpc('video_date_transition', args);
      vdbg('video_date_transition_after', {
        action: 'end',
        ok: !error,
        payload: data ?? null,
        error: error ? { code: error.code, message: error.message } : null,
        attempt,
        idempotencyKey,
      });
      if (error) throw error;
      return data;
    },
    isSuccess: (data) => {
      const payload = data as { success?: boolean; state?: string; phase?: string; already_ended?: boolean } | null;
      if (payload?.success === false) return false;
      if (!useDateTimeoutV2) return true;
      return payload?.already_ended === true || payload?.state === 'ended' || payload?.phase === 'ended';
    },
  });
  return result.ok;
}

/** Tell backend to delete the Daily room (best-effort). Same as web. */
export async function deleteDailyRoom(roomName: string): Promise<void> {
  const args = { action: 'delete_room', roomName };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
    vdbg('daily_room_before', { action: 'delete_room', args });
    const { error } = await supabase.functions.invoke('daily-room', {
      body: args,
    });
    vdbg('daily_room_after', {
      action: 'delete_room',
      ok: !error,
      roomName,
      attempt,
      error: error ? { name: error.name, message: error.message } : null,
    });
    if (!error) return;
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
  } catch {
    vdbg('daily_room_after', {
      action: 'delete_room',
      ok: false,
      roomName,
      attempt,
      error: 'exception',
    });
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
  }
  }
  trackEvent(LobbyPostDateEvents.DELETE_DAILY_ROOM_FAILED_NATIVE, {
    platform: 'native',
    room_name: roomName,
  });
}

/** Record the current user's explicit handshake decision. Partner is never notified. */
export async function recordHandshakeDecision(
  sessionId: string,
  action: 'vibe' | 'pass',
  diagnostics?: VideoDateTransitionDiagnostics,
  options?: RecordHandshakeDecisionOptions
): Promise<PersistHandshakeDecisionResult> {
  const actorUserId = diagnostics?.actorUserId ?? null;
  const expectedDecision = action === 'vibe';
  if (!actorUserId) {
    return {
      ok: false,
      action,
      attempts: 0,
      reason: 'actor_not_participant',
      retryable: false,
      actorDecisionPersisted: false,
      actorDecisionSlot: null,
      actorDecisionTimestampSlot: null,
      expectedDecision,
      persistedDecision: null,
      persistedDecisionAt: null,
      rpcPayload: null,
      truth: null,
      userMessage: 'This date is no longer available.',
    };
  }

  const result = await persistHandshakeDecisionWithVerification({
    sessionId,
    actorUserId,
    action,
    rpc: async (args) => {
      vdbg('video_date_transition_before', {
        action,
        sessionId,
        actorUserId,
        currentPhase: diagnostics?.phase ?? null,
        args,
      });
      const { data, error } =
        action === 'vibe' && options?.continueHandshakeV2 === true
          ? await supabase.rpc('video_session_continue_handshake_v2' as never, {
              p_session_id: args.p_session_id,
              p_idempotency_key: buildVideoDateTransitionIdempotencyKey(
                args.p_session_id,
                'continue_handshake',
              ),
            } as never)
          : await supabase.rpc('video_date_transition', args);
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
          action,
          sessionId,
          actorUserId,
          currentPhase: diagnostics?.phase ?? null,
          ok: payload.ok,
          payload: payload.rpcPayload ?? null,
          error: payload.error ?? null,
          participant_1_liked: payload.participant_1_liked ?? null,
          participant_2_liked: payload.participant_2_liked ?? null,
          participant_1_decided_at: payload.participant_1_decided_at ?? null,
          participant_2_decided_at: payload.participant_2_decided_at ?? null,
          actorDecisionPersisted: payload.actorDecisionPersisted,
        });
      }
    },
  });

  vdbg('handshake_decision_persistence_result', {
    action,
    sessionId,
    actorUserId,
    ok: result.ok,
    attempts: result.attempts,
    reason: result.ok ? null : result.reason,
    rpcPayload: result.rpcPayload,
    actorDecisionSlot: result.actorDecisionSlot,
    actorDecisionTimestampSlot: result.actorDecisionTimestampSlot,
    expectedDecision: result.expectedDecision,
    persistedDecision: result.persistedDecision,
    persistedDecisionAt: result.persistedDecisionAt,
    actorDecisionPersisted: result.actorDecisionPersisted,
    ...handshakeTruthLogPayload(result.truth),
  });
  return result;
}

/** Record that current user "vibed" during handshake. */
export async function recordVibe(
  sessionId: string,
  diagnostics?: VideoDateTransitionDiagnostics,
  options?: RecordHandshakeDecisionOptions
): Promise<PersistHandshakeDecisionResult> {
  return recordHandshakeDecision(sessionId, 'vibe', diagnostics, options);
}

/** At handshake end: check mutual vibe. Returns { state: 'date' } if both liked, else terminal/waiting state. */
export async function completeHandshake(
  sessionId: string,
  options?: CompleteHandshakeOptions
): Promise<CompleteHandshakeResult | null> {
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
  const { data, error } = options?.handshakeAutoPromoteV2 === true
    ? await supabase.rpc('video_session_handshake_auto_promote_v2' as never, {
        p_session_id: args.p_session_id,
        p_idempotency_key: buildVideoDateTransitionIdempotencyKey(
          args.p_session_id,
          'handshake_auto_promote',
        ),
      } as never)
    : await supabase.rpc('video_date_transition', args);
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
    waiting_for_self: payload?.waiting_for_self,
    local_decision_persisted: payload?.local_decision_persisted,
    partner_decision_persisted: payload?.partner_decision_persisted,
    grace_expires_at: payload?.grace_expires_at,
    seconds_remaining: payload?.seconds_remaining,
    already_ended: payload?.already_ended,
    reason: payload?.reason,
    survey_required: payload?.survey_required,
  };
}

export type ClientWritableParticipantStatus = 'browsing' | 'idle' | 'in_survey' | 'offline';

/** Update client-writable presence/status only; Ready Gate and date route statuses are server-owned. */
export async function updateParticipantStatus(eventId: string, status: ClientWritableParticipantStatus): Promise<boolean> {
  const { error } = await supabase.rpc('update_participant_status', {
    p_event_id: eventId,
    p_status: status,
  });
  return !error;
}

/** Server-stamped event registration heartbeat; does not alter queue_status. */
export async function markEventParticipantHeartbeat(eventId: string): Promise<boolean> {
  const { error } = await supabase.rpc('mark_event_participant_heartbeat', {
    p_event_id: eventId,
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

  const { data: profile } = await supabase.rpc('get_profile_for_viewer', {
    p_target_id: partnerId,
  });
  if (!profile) return { ok: false, reason: 'not_found' };
  const row = profile as Record<string, unknown>;
  const tags = Array.isArray(row.vibes)
    ? row.vibes.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : [];

  const photoArr = Array.isArray(row.photos) ? row.photos.filter((p): p is string => typeof p === 'string') : [];
  const avatarUrl = typeof row.avatar_url === 'string' ? row.avatar_url : null;
  const primaryPath = photoArr[0] ?? avatarUrl;
  const photos = photoArr.slice(0, 6).map((p) => avatarUrlResolver(p));
  const avatarUrlResolved = primaryPath ? avatarUrlResolver(primaryPath) : null;

  let prompts: { question: string; answer: string }[] = [];
  if (Array.isArray(row.prompts)) {
    prompts = (row.prompts as { question?: string; answer?: string }[]).map((p) => ({
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
      name: typeof row.name === 'string' ? row.name : 'Your date',
      age: typeof row.age === 'number' ? row.age : 0,
      avatarUrl: avatarUrlResolved,
      photos,
      about_me: typeof row.about_me === 'string' ? row.about_me : null,
      job: typeof row.job === 'string' ? row.job : null,
      location: typeof row.location === 'string' ? row.location : null,
      heightCm: typeof row.height_cm === 'number' ? row.height_cm : null,
      tags,
      prompts,
    },
  };
}

export type VibeQuestionState = VideoDateIceBreakerState;

function parseVibeQuestionState(raw: unknown): VibeQuestionState | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as {
    questions?: unknown;
    question_index?: unknown;
    question_anchor_at?: unknown;
    vibe_questions?: unknown;
    vibe_question_index?: unknown;
    vibe_question_anchor_at?: unknown;
  };
  const questions = normalizeVideoDateIceBreakerQuestions(row.questions ?? row.vibe_questions);
  if (!questions.length) return null;
  const questionIndex = normalizeVideoDateIceBreakerIndex(row.question_index ?? row.vibe_question_index, questions.length);
  const anchor = row.question_anchor_at ?? row.vibe_question_anchor_at;
  return {
    questions,
    questionIndex,
    questionAnchorAt: typeof anchor === 'string' && anchor.trim() ? anchor : null,
  };
}

/** Get or seed synchronized vibe question state for a Video Date session. */
export async function getOrSeedVibeQuestionState(sessionId: string): Promise<VibeQuestionState> {
  const { data, error: fetchError } = await supabase
    .from('video_sessions')
    .select('vibe_questions, vibe_question_index, vibe_question_anchor_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (fetchError) {
    if (__DEV__) console.warn('[videoDateApi] failed to fetch vibe_questions:', fetchError.message);
    return fallbackVideoDateIceBreakerState();
  }
  const stored = parseVibeQuestionState(data);
  if (stored) return stored;

  const shuffled = shuffleVideoDateIceBreakerQuestions();
  const { data: seeded, error: seedError } = await supabase.rpc('get_or_seed_video_session_vibe_questions', {
    p_session_id: sessionId,
    p_questions: shuffled,
  });
  if (seedError) {
    if (__DEV__) console.warn('[videoDateApi] failed to seed vibe_questions:', seedError.message);
    return { questions: shuffled, questionIndex: 0, questionAnchorAt: new Date().toISOString() };
  }

  return parseVibeQuestionState(seeded) ?? { questions: shuffled, questionIndex: 0, questionAnchorAt: new Date().toISOString() };
}

/** Backwards-compatible helper for callers that only need the seeded question list. */
export async function getOrSeedVibeQuestions(sessionId: string): Promise<string[]> {
  return (await getOrSeedVibeQuestionState(sessionId)).questions;
}

/** Advance the synchronized session question for both participants. */
export async function advanceVibeQuestion(sessionId: string): Promise<VibeQuestionState | null> {
  const { data, error } = await supabase.rpc('advance_video_session_vibe_question', {
    p_session_id: sessionId,
  });
  if (error) {
    if (__DEV__) console.warn('[videoDateApi] failed to advance vibe question:', error.message);
    return null;
  }
  return parseVibeQuestionState(data);
}

/** Discriminated outcome for `post-date-verdict` (explicit backend failure vs network vs success paths). */
export type SubmitVerdictAndCheckMutualResult =
  | {
      ok: true;
      mutual: boolean;
      match_id?: string;
      persistent_match_created?: boolean | null;
      already_matched?: boolean;
      awaiting_partner_verdict?: boolean;
      partner_verdict_recorded?: boolean;
      committed?: boolean;
      session_seq?: number;
      verdict_state?: PostDateVerdictState;
      next_surface?: ServerPostDateNextSurface | null;
    }
  | { ok: false; reason: 'backend'; code: string; message?: string }
  | { ok: false; reason: 'network' }
  | { ok: false; reason: 'unknown' };

type PostDateVerdictResponseBody = {
  success?: boolean;
  error?: string;
  code?: string;
  message?: string;
  mutual?: boolean;
  match_id?: string;
  persistent_match_created?: boolean | null;
  already_matched?: boolean;
  verdict_recorded?: boolean;
  awaiting_partner_verdict?: boolean;
  partner_verdict_recorded?: boolean;
  committed?: boolean;
  session_seq?: number;
  verdict_state?: PostDateVerdictState;
  next_surface?: unknown;
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
  userId: string,
  _partnerId: string,
  liked: boolean,
  options?: SubmitVerdictOptions
): Promise<SubmitVerdictAndCheckMutualResult> {
  const row = await submitNativePostDateOutboxItem({
    userId,
    sessionId,
    payload: {
      kind: 'verdict',
      liked,
      backendVersion: options?.submitVerdictV3 === true ? 'v3' : 'v2',
    },
  }) as PostDateVerdictResponseBody | null;
  if (!row || typeof row !== 'object') {
    verdictBreadcrumb('verdict_invoke_failed', { detail: 'missing_body' });
    return { ok: false, reason: 'unknown' };
  }

  if (row.success === false) {
    const code = row.code ?? row.error ?? 'unknown';
    verdictBreadcrumb('verdict_backend_rejected', { code });
    return {
      ok: false,
      reason: 'backend',
      code,
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
    awaiting_partner_verdict: row.awaiting_partner_verdict === true,
    partner_verdict_recorded: row.partner_verdict_recorded === true,
    committed: row.committed === true,
    session_seq: typeof row.session_seq === 'number' && Number.isFinite(row.session_seq) ? row.session_seq : undefined,
    verdict_state: row.verdict_state,
    next_surface: normalizeServerPostDateNextSurface(row.next_surface),
  };
}

export async function submitPostDateReportWithOutbox(
  sessionId: string,
  userId: string,
  report: PostDateSafetyReportPayload,
): Promise<{ ok: true; reportId?: string } | { ok: false; error: string }> {
  const row = await submitNativePostDateOutboxItem({
    userId,
    sessionId,
    payload: { kind: 'report', report },
  });
  if (row.success === false) {
    return { ok: false, error: row.code ?? row.error ?? 'unknown' };
  }
  return { ok: true, reportId: row.report_id };
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

export type SpendVideoDateCreditExtensionResult =
  | {
      ok: true;
      addedSeconds: number;
      dateExtraSeconds: number | null;
      idempotent?: boolean;
      awaitingPartner?: boolean;
      mutual?: boolean;
      requestExpiresAt?: string | null;
    }
  | { ok: false; error: string };

/** Atomic credit spend + server budget for date phase (parity with web VideoDate). */
export async function spendVideoDateCreditExtension(
  sessionId: string,
  creditType: 'extra_time' | 'extended_vibe',
  idempotencyKey?: string,
  options?: SpendVideoDateCreditExtensionOptions
): Promise<SpendVideoDateCreditExtensionResult> {
  const key =
    idempotencyKey ??
    (options?.extensionMutualV2 === true
      ? buildVideoDateMutualExtensionIdempotencyKey(
          sessionId,
          creditType,
          `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        )
      : options?.extensionV2 === true
        ? buildVideoDateExtensionIdempotencyKey(
          sessionId,
          creditType,
          `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        )
        : undefined);
  const { data, error } = options?.extensionMutualV2 === true
    ? await supabase.rpc('video_session_request_extension_v2' as never, {
        p_session_id: sessionId,
        p_credit_type: creditType,
        ...(key ? { p_idempotency_key: key } : {}),
      } as never)
    : options?.extensionV2 === true
      ? await supabase.rpc('video_session_extend_date_v2' as never, {
        p_session_id: sessionId,
        p_credit_type: creditType,
        ...(key ? { p_idempotency_key: key } : {}),
      } as never)
      : await supabase.rpc('spend_video_date_credit_extension', {
          p_session_id: sessionId,
          p_credit_type: creditType,
          ...(key ? { p_idempotency_key: key } : {}),
        });
  if (error) {
    return { ok: false, error: 'rpc_transport' };
  }
  const parsed = parseSpendVideoDateCreditExtensionPayload(data);
  if (parsed.success) {
    return {
      ok: true,
      addedSeconds: parsed.awaitingPartner ? 0 : parsed.addedSeconds ?? (creditType === 'extra_time' ? 120 : 300),
      dateExtraSeconds: parsed.dateExtraSeconds ?? null,
      idempotent: parsed.idempotent,
      awaitingPartner: parsed.awaitingPartner,
      mutual: parsed.mutual,
      requestExpiresAt: parsed.requestExpiresAt,
    };
  }
  return { ok: false, error: parsed.error };
}

export { HANDSHAKE_SECONDS, DATE_SECONDS };
