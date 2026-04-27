import * as Sentry from '@sentry/react-native';
import { supabase } from '@/lib/supabase';
import { trackEvent } from '@/lib/analytics';
import { vdbg } from '@/lib/vdbg';
import { LobbyPostDateEvents } from '@clientShared/analytics/lobbyToPostDateJourney';
import {
  buildReadyGateToDateLatencyPayload,
  bucketVideoDateLatencyMs,
  recordReadyGateToDateLatencyCheckpoint,
} from '@clientShared/observability/videoDateOperatorMetrics';
import {
  DAILY_ROOM_ACTIONS,
  classifyDailyRoomInvokeFailure,
} from '@clientShared/matching/dailyRoomFailure';
import {
  PREPARE_VIDEO_DATE_ENTRY_ACTION,
  getBothReadyToFirstRemoteFrameMs,
  getCachedPreparedVideoDateEntry,
  getPrepareToJoinStartMs,
  prepareVideoDateEntryWithClient,
  rejectCachedPreparedVideoDateEntry,
  type PrepareVideoDateEntryResult,
  type PreparedVideoDateEntryCacheEntry,
} from '@clientShared/matching/videoDatePrepareEntry';

type PrepareVideoDateEntryOptions = {
  eventId?: string | null;
  source?: string;
  force?: boolean;
  bothReadyObservedAtMs?: number;
};

async function getCurrentUserId(): Promise<string | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.id) return null;
  return user.id;
}

export async function prepareVideoDateEntry(
  sessionId: string,
  options: PrepareVideoDateEntryOptions = {},
): Promise<PrepareVideoDateEntryResult> {
  const userId = await getCurrentUserId();
  if (!userId) {
    return { ok: false, code: 'UNAUTHORIZED', retryable: false };
  }

  const startedAt = Date.now();
  const sourceSurface = 'video_date_entry';
  const attemptCount = options.force ? 2 : 1;
  const trackLatencyCheckpoint = (
    checkpoint:
      | 'enter_handshake_started'
      | 'enter_handshake_success'
      | 'enter_handshake_failure'
      | 'daily_token_started'
      | 'daily_token_success'
      | 'daily_token_failure',
    sourceAction: string,
    outcome: 'success' | 'failure',
    reasonCode?: string | null,
    durationMs?: number | null,
  ) => {
    const context = recordReadyGateToDateLatencyCheckpoint({
      sessionId,
      platform: 'native',
      eventId: options.eventId ?? null,
      sourceSurface,
      checkpoint,
      nowMs: Date.now(),
      attemptCount,
    });
    trackEvent(
      LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
      buildReadyGateToDateLatencyPayload({
        context,
        checkpoint,
        sourceAction,
        outcome,
        reasonCode,
        durationMs,
        attemptCount,
      }),
    );
  };

  trackLatencyCheckpoint('enter_handshake_started', 'prepare_date_entry_started', 'success');
  trackLatencyCheckpoint('daily_token_started', 'daily_token_request_started', 'success');

  trackEvent(LobbyPostDateEvents.VIDEO_DATE_PREPARE_ENTRY_STARTED, {
    platform: 'native',
    session_id: sessionId,
    event_id: options.eventId ?? null,
    source: options.source ?? null,
    source_surface: sourceSurface,
    source_action: 'prepare_date_entry_started',
    force: options.force === true,
    attempt_count: attemptCount,
  });
  Sentry.addBreadcrumb({
    category: 'video-date',
    message: 'prepare_date_entry_started',
    level: 'info',
    data: {
      sessionId,
      eventId: options.eventId ?? null,
      source: options.source ?? null,
      force: options.force === true,
    },
  });
  vdbg('video_date_prepare_entry_started', {
    sessionId,
    eventId: options.eventId ?? null,
    source: options.source ?? null,
    force: options.force === true,
  });

  const result = await prepareVideoDateEntryWithClient({
    sessionId,
    userId,
    force: options.force,
    bothReadyObservedAtMs: options.bothReadyObservedAtMs,
    invoke: () =>
      supabase.functions.invoke('daily-room', {
        body: { action: PREPARE_VIDEO_DATE_ENTRY_ACTION, sessionId },
      }),
    classifyFailure: ({ data, error, response, timedOut }) =>
      classifyDailyRoomInvokeFailure({
        action: DAILY_ROOM_ACTIONS.PREPARE_ENTRY,
        data,
        invokeError: error,
        response,
        timedOut,
      }),
  });

  if (result.ok === true) {
    const durationMs = Date.now() - startedAt;
    const tokenDurationMs = result.data.timings?.prepareDurationMs ?? durationMs;
    trackLatencyCheckpoint('enter_handshake_success', 'prepare_date_entry_success', 'success', null, tokenDurationMs);
    trackLatencyCheckpoint('daily_token_success', 'daily_token_success', 'success', null, tokenDurationMs);
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_PREPARE_ENTRY_SUCCESS, {
      platform: 'native',
      session_id: sessionId,
      event_id: options.eventId ?? null,
      source: options.source ?? null,
      source_surface: sourceSurface,
      source_action: 'prepare_date_entry_success',
      cached: result.cached,
      prepareDurationMs: result.data.timings?.prepareDurationMs ?? durationMs,
      duration_ms: tokenDurationMs,
      latency_bucket: bucketVideoDateLatencyMs(tokenDurationMs),
      attempt_count: attemptCount,
      bothReadyToPrepareStartMs: result.data.timings?.bothReadyToPrepareStartMs ?? null,
      reused_room: result.data.reused_room === true,
      provider_room_recreated: result.data.provider_room_recreated === true,
      provider_verify_skipped: result.data.provider_verify_skipped === true,
    });
    trackEvent(
      result.cached
        ? LobbyPostDateEvents.VIDEO_DATE_PREWARMED_TOKEN_USED
        : LobbyPostDateEvents.VIDEO_DATE_PREWARMED_TOKEN_CACHED,
      {
        platform: 'native',
        session_id: sessionId,
        event_id: options.eventId ?? null,
        source: options.source ?? null,
      },
    );
    Sentry.addBreadcrumb({
      category: 'video-date',
      message: result.cached ? 'prepare_date_entry_cache_used' : 'prepare_date_entry_success',
      level: 'info',
      data: {
        sessionId,
        eventId: options.eventId ?? null,
        roomName: result.data.room_name,
        cached: result.cached,
      },
    });
    vdbg('video_date_prepare_entry_success', {
      sessionId,
      eventId: options.eventId ?? null,
      source: options.source ?? null,
      roomName: result.data.room_name,
      cached: result.cached,
      timings: result.data.timings ?? null,
    });
    return result;
  }

  trackEvent(LobbyPostDateEvents.VIDEO_DATE_PREPARE_ENTRY_FAILURE, {
    platform: 'native',
    session_id: sessionId,
    event_id: options.eventId ?? null,
    source: options.source ?? null,
    source_surface: sourceSurface,
    source_action: 'prepare_date_entry_failure',
    code: result.code,
    reason_code: result.code,
    retryable: result.retryable,
    httpStatus: result.httpStatus ?? null,
    duration_ms: Date.now() - startedAt,
    latency_bucket: bucketVideoDateLatencyMs(Date.now() - startedAt),
    attempt_count: attemptCount,
  });
  trackLatencyCheckpoint('enter_handshake_failure', 'prepare_date_entry_failure', 'failure', result.code);
  trackLatencyCheckpoint('daily_token_failure', 'daily_token_failure', 'failure', result.code);
  Sentry.addBreadcrumb({
    category: 'video-date',
    message: 'prepare_date_entry_failure',
    level: result.retryable ? 'warning' : 'info',
    data: {
      sessionId,
      eventId: options.eventId ?? null,
      code: result.code,
      retryable: result.retryable,
      httpStatus: result.httpStatus ?? null,
    },
  });
  vdbg('video_date_prepare_entry_failure', {
    sessionId,
    eventId: options.eventId ?? null,
    source: options.source ?? null,
    code: result.code,
    retryable: result.retryable,
    httpStatus: result.httpStatus ?? null,
    message: result.message ?? null,
  });
  return result;
}

export function getPreparedVideoDateEntry(
  sessionId: string,
  userId: string,
): PreparedVideoDateEntryCacheEntry | null {
  return getCachedPreparedVideoDateEntry(sessionId, userId);
}

export function rejectPreparedVideoDateEntry(
  sessionId: string,
  userId: string,
  reason: string,
  eventId?: string | null,
): boolean {
  const rejected = rejectCachedPreparedVideoDateEntry(sessionId, userId);
  if (rejected) {
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_PREWARMED_TOKEN_REJECTED, {
      platform: 'native',
      session_id: sessionId,
      event_id: eventId ?? null,
      reason,
    });
    vdbg('video_date_prewarmed_token_rejected', {
      sessionId,
      userId,
      eventId: eventId ?? null,
      reason,
    });
  }
  return rejected;
}

export function preparedEntryPrepareToJoinStartMs(
  entry: PreparedVideoDateEntryCacheEntry | null,
  joinStartedAtMs: number = Date.now(),
): number | null {
  return entry ? getPrepareToJoinStartMs(entry, joinStartedAtMs) : null;
}

export function preparedEntryBothReadyToFirstRemoteFrameMs(
  entry: PreparedVideoDateEntryCacheEntry | null,
  nowMs: number = Date.now(),
): number | null {
  return getBothReadyToFirstRemoteFrameMs(entry, nowMs);
}
