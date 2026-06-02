import * as Sentry from "@sentry/react";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { vdbg } from "@/lib/vdbg";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  buildReadyGateToDateLatencyPayload,
  bucketVideoDateLatencyMs,
  recordReadyGateToDateLatencyCheckpoint,
  type ReadyGateToDateLatencyCheckpoint,
} from "@clientShared/observability/videoDateOperatorMetrics";
import {
  DAILY_ROOM_ACTIONS,
  classifyDailyRoomInvokeFailure,
} from "@clientShared/matching/dailyRoomFailure";
import {
  PREPARE_VIDEO_DATE_ENTRY_ACTION,
  PREPARE_VIDEO_DATE_SOLO_ENTRY_ACTION,
  consumePreparedVideoDateEntryHandoff,
  createVideoDateEntryAttemptId,
  getBothReadyToFirstRemoteFrameMs,
  getCachedPreparedVideoDateEntry,
  getPrepareToJoinStartMs,
  hasPreparedVideoDateSoloEntryPayload,
  prepareVideoDateEntryWithClient,
  rejectCachedPreparedVideoDateEntry,
  type PrepareVideoDateEntryResult,
  type PrepareVideoDateSoloEntryResult,
  type PreparedVideoDateEntryCacheEntry,
  type PreparedVideoDateEntryHandoffValidation,
} from "@clientShared/matching/videoDatePrepareEntry";

type PrepareVideoDateEntryOptions = {
  eventId?: string | null;
  userId?: string | null;
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

export function videoDateDailySoloPrejoinEnabled(): boolean {
  return (
    String(
      import.meta.env.VITE_VIDEO_DATE_DAILY_SOLO_PREJOIN ?? "false",
    ).toLowerCase() === "true"
  );
}

export async function prepareVideoDateEntry(
  sessionId: string,
  options: PrepareVideoDateEntryOptions = {},
): Promise<PrepareVideoDateEntryResult> {
  const userId = options.userId ?? (await getCurrentUserId());
  if (!userId) {
    return { ok: false, code: "UNAUTHORIZED", retryable: false };
  }

  const startedAt = Date.now();
  const entryAttemptId = createVideoDateEntryAttemptId(startedAt);
  const videoDateTraceId = entryAttemptId;
  const sourceSurface = "video_date_entry";
  const attemptCount = options.force ? 2 : 1;
  const trackLatencyCheckpoint = (
    checkpoint: ReadyGateToDateLatencyCheckpoint,
    sourceAction: string,
    outcome: "success" | "failure",
    reasonCode?: string | null,
    durationMs?: number | null,
    extra?: Record<string, string | number | boolean | null | undefined>,
  ) => {
    const context = recordReadyGateToDateLatencyCheckpoint({
      sessionId,
      platform: "web",
      eventId: options.eventId ?? null,
      sourceSurface,
      checkpoint,
      nowMs: Date.now(),
      attemptCount,
      entryAttemptId,
      videoDateTraceId,
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
        extra,
      }),
    );
  };

  const trackPrepareOwnerStarted = () => {
    trackLatencyCheckpoint(
      "prepare_entry_started",
      "prepare_date_entry_started",
      "success",
    );
    trackLatencyCheckpoint(
      "provider_verify_started",
      "prepare_date_entry_started",
      "success",
    );
    trackLatencyCheckpoint(
      "enter_handshake_started",
      "prepare_date_entry_started",
      "success",
    );
    trackLatencyCheckpoint(
      "daily_token_started",
      "daily_token_request_started",
      "success",
    );
    trackLatencyCheckpoint(
      "daily_room_create_started",
      "daily_room_create_started",
      "success",
      null,
      null,
      {
        daily_performance_segment: "room_create_or_verify",
      },
    );
    trackLatencyCheckpoint(
      "daily_token_mint_started",
      "daily_token_mint_started",
      "success",
      null,
      null,
      {
        daily_performance_segment: "token_mint",
      },
    );
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_PREPARE_ENTRY_STARTED, {
      platform: "web",
      session_id: sessionId,
      event_id: options.eventId ?? null,
      source: options.source ?? null,
      source_surface: sourceSurface,
      source_action: "prepare_date_entry_started",
      force: options.force === true,
      attempt_count: attemptCount,
      entry_attempt_id: entryAttemptId,
      video_date_trace_id: videoDateTraceId,
      coalesced: false,
    });
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_PROVIDER_VERIFY_STARTED, {
      platform: "web",
      session_id: sessionId,
      event_id: options.eventId ?? null,
      source: options.source ?? null,
      source_surface: sourceSurface,
      source_action: "provider_verify_started",
      force: options.force === true,
      attempt_count: attemptCount,
      entry_attempt_id: entryAttemptId,
      video_date_trace_id: videoDateTraceId,
      coalesced: false,
    });
    Sentry.addBreadcrumb({
      category: "video-date",
      message: "prepare_date_entry_started",
      level: "info",
      data: {
        sessionId,
        eventId: options.eventId ?? null,
        source: options.source ?? null,
        force: options.force === true,
        entryAttemptId,
        videoDateTraceId,
      },
    });
    vdbg("video_date_prepare_entry_started", {
      sessionId,
      eventId: options.eventId ?? null,
      source: options.source ?? null,
      force: options.force === true,
      entryAttemptId,
      videoDateTraceId,
    });
  };

  const result = await prepareVideoDateEntryWithClient({
    sessionId,
    userId,
    force: options.force,
    entryAttemptId,
    bothReadyObservedAtMs: options.bothReadyObservedAtMs,
    invoke: ({ entryAttemptId: attemptId }) =>
      supabase.functions.invoke("daily-room", {
        body: {
          action: PREPARE_VIDEO_DATE_ENTRY_ACTION,
          sessionId,
          entry_attempt_id: attemptId,
          video_date_trace_id: attemptId,
        },
      }),
    classifyFailure: ({ data, error, response, timedOut }) =>
      classifyDailyRoomInvokeFailure({
        action: DAILY_ROOM_ACTIONS.PREPARE_ENTRY,
        data,
        invokeError: error,
        response,
        timedOut,
      }),
    onOwnerStart: trackPrepareOwnerStarted,
  });

  if (result.coalesced === true) {
    const coalescedEntryAttemptId =
      result.ok === true
        ? (result.data.entry_attempt_id ?? entryAttemptId)
        : (result.entryAttemptId ?? entryAttemptId);
    const coalescedTraceId =
      result.ok === true
        ? (result.data.video_date_trace_id ??
          result.ownerEntryAttemptId ??
          videoDateTraceId)
        : (result.ownerEntryAttemptId ?? videoDateTraceId);
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_PREPARE_ENTRY_STARTED, {
      platform: "web",
      session_id: sessionId,
      event_id: options.eventId ?? null,
      source: options.source ?? null,
      source_surface: sourceSurface,
      source_action: "prepare_date_entry_coalesced",
      force: options.force === true,
      attempt_count: attemptCount,
      entry_attempt_id: coalescedEntryAttemptId,
      owner_entry_attempt_id: result.ownerEntryAttemptId ?? null,
      video_date_trace_id: coalescedTraceId,
      coalesced: true,
    });
  }

  if (result.ok === true) {
    const durationMs = Date.now() - startedAt;
    const tokenDurationMs =
      result.data.timings?.prepareDurationMs ?? durationMs;
    const providerVerifyDurationMs =
      result.data.timings?.room_create_or_verify_ms ?? null;
    const dailyRoomCreateDurationMs =
      result.data.timings?.room_create_or_verify_ms ?? null;
    const dailyTokenMintDurationMs = result.data.timings?.token_ms ?? null;
    const providerVerifySkipped = result.data.provider_verify_skipped === true;
    const providerVerifyCheckpoint = providerVerifySkipped
      ? "provider_verify_skipped"
      : "provider_verify_success";
    const traceId =
      result.data.video_date_trace_id ??
      result.data.entry_attempt_id ??
      videoDateTraceId;
    const providerVerifyExtra = {
      provider_verify_reason: result.data.provider_verify_reason ?? null,
      provider_verify_skipped: providerVerifySkipped,
    };
    const prepareBackendTimingExtra = {
      ...providerVerifyExtra,
      auth_ms: result.data.timings?.auth_ms ?? null,
      prepare_rpc_ms: result.data.timings?.prepare_rpc_ms ?? null,
      room_create_or_verify_ms:
        result.data.timings?.room_create_or_verify_ms ?? null,
      token_ms: result.data.timings?.token_ms ?? null,
      confirm_prepare_ms: result.data.timings?.confirm_prepare_ms ?? null,
      edge_cold_start_ms: result.data.timings?.edge_cold_start_ms ?? null,
      edge_process_uptime_ms:
        result.data.timings?.edge_process_uptime_ms ?? null,
      edge_total_ms: result.data.timings?.total_ms ?? null,
    };
    const prepareEntrySuccessExtra = result.cached
      ? providerVerifyExtra
      : prepareBackendTimingExtra;
    trackLatencyCheckpoint(
      "prepare_entry_success",
      "prepare_date_entry_success",
      "success",
      null,
      tokenDurationMs,
      prepareEntrySuccessExtra,
    );
    trackLatencyCheckpoint(
      providerVerifyCheckpoint,
      providerVerifySkipped
        ? "provider_verify_skipped"
        : "provider_verify_success",
      "success",
      result.data.provider_verify_reason ?? null,
      providerVerifyDurationMs,
      providerVerifyExtra,
    );
    trackLatencyCheckpoint(
      "enter_handshake_success",
      "prepare_date_entry_success",
      "success",
      null,
      tokenDurationMs,
    );
    trackLatencyCheckpoint(
      "daily_token_success",
      "daily_token_success",
      "success",
      null,
      tokenDurationMs,
    );
    if (!result.cached) {
      trackLatencyCheckpoint(
        "daily_room_create_success",
        "daily_room_create_success",
        "success",
        result.data.provider_verify_reason ?? null,
        dailyRoomCreateDurationMs,
        {
          daily_performance_segment: "room_create_or_verify",
          daily_room_create_ms: dailyRoomCreateDurationMs,
          room_create_or_verify_ms: dailyRoomCreateDurationMs,
          provider_verify_reason: result.data.provider_verify_reason ?? null,
          provider_verify_skipped: providerVerifySkipped,
        },
      );
      trackLatencyCheckpoint(
        "daily_token_mint_success",
        "daily_token_mint_success",
        "success",
        null,
        dailyTokenMintDurationMs,
        {
          daily_performance_segment: "token_mint",
          daily_token_mint_ms: dailyTokenMintDurationMs,
          token_ms: dailyTokenMintDurationMs,
        },
      );
    }
    const tokenCreatedContext = recordReadyGateToDateLatencyCheckpoint({
      sessionId,
      platform: "web",
      eventId: options.eventId ?? null,
      sourceSurface,
      checkpoint: "token_created",
      attemptCount,
      entryAttemptId: result.data.entry_attempt_id ?? entryAttemptId,
      videoDateTraceId: traceId,
      cachedPrepareEntry: result.cached,
      providerVerifySkipped,
    });
    trackEvent(
      LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
      buildReadyGateToDateLatencyPayload({
        context: tokenCreatedContext,
        checkpoint: "token_created",
        sourceAction: result.cached
          ? "prepared_token_cache_used"
          : "prepare_date_entry_token_created",
        outcome: "success",
        durationMs: tokenDurationMs,
        attemptCount,
        extra: providerVerifyExtra,
      }),
    );
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_TOKEN_CREATED, {
      platform: "web",
      session_id: sessionId,
      event_id: options.eventId ?? null,
      source_surface: sourceSurface,
      source_action: result.cached
        ? "prepared_token_cache_used"
        : "prepare_date_entry_token_created",
      cached: result.cached,
      duration_ms: tokenDurationMs,
      latency_bucket: bucketVideoDateLatencyMs(tokenDurationMs),
      attempt_count: attemptCount,
      entry_attempt_id: result.data.entry_attempt_id ?? entryAttemptId,
      video_date_trace_id: traceId,
    });
    trackEvent(
      providerVerifySkipped
        ? LobbyPostDateEvents.VIDEO_DATE_PROVIDER_VERIFY_SKIPPED
        : LobbyPostDateEvents.VIDEO_DATE_PROVIDER_VERIFY_SUCCESS,
      {
        platform: "web",
        session_id: sessionId,
        event_id: options.eventId ?? null,
        source_surface: sourceSurface,
        source_action: providerVerifySkipped
          ? "provider_verify_skipped"
          : "provider_verify_success",
        duration_ms: providerVerifyDurationMs,
        latency_bucket: bucketVideoDateLatencyMs(providerVerifyDurationMs),
        provider_verify_reason: result.data.provider_verify_reason ?? null,
        daily_room_verified_at: result.data.daily_room_verified_at ?? null,
        daily_room_expires_at: result.data.daily_room_expires_at ?? null,
        cached: result.cached,
        entry_attempt_id: result.data.entry_attempt_id ?? entryAttemptId,
        video_date_trace_id: traceId,
      },
    );
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_PREPARE_ENTRY_SUCCESS, {
      platform: "web",
      session_id: sessionId,
      event_id: options.eventId ?? null,
      source: options.source ?? null,
      source_surface: sourceSurface,
      source_action: "prepare_date_entry_success",
      cached: result.cached,
      prepareDurationMs: result.data.timings?.prepareDurationMs ?? durationMs,
      duration_ms: tokenDurationMs,
      latency_bucket: bucketVideoDateLatencyMs(tokenDurationMs),
      attempt_count: attemptCount,
      bothReadyToPrepareStartMs:
        result.data.timings?.bothReadyToPrepareStartMs ?? null,
      coalesced: result.coalesced === true,
      owner_entry_attempt_id: result.ownerEntryAttemptId ?? null,
      reused_room: result.data.reused_room === true,
      provider_room_recreated: result.data.provider_room_recreated === true,
      provider_verify_skipped: providerVerifySkipped,
      provider_verify_reason: result.data.provider_verify_reason ?? null,
      daily_room_verified_at: result.data.daily_room_verified_at ?? null,
      daily_room_expires_at: result.data.daily_room_expires_at ?? null,
      auth_ms: result.data.timings?.auth_ms ?? null,
      prepare_rpc_ms: result.data.timings?.prepare_rpc_ms ?? null,
      room_create_or_verify_ms:
        result.data.timings?.room_create_or_verify_ms ?? null,
      token_ms: result.data.timings?.token_ms ?? null,
      confirm_prepare_ms: result.data.timings?.confirm_prepare_ms ?? null,
      edge_cold_start_ms: result.data.timings?.edge_cold_start_ms ?? null,
      edge_process_uptime_ms:
        result.data.timings?.edge_process_uptime_ms ?? null,
      edge_total_ms: result.data.timings?.total_ms ?? null,
      entry_attempt_id: result.data.entry_attempt_id ?? entryAttemptId,
      video_date_trace_id: traceId,
    });
    if (result.cached) {
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_PREWARMED_TOKEN_USED, {
        platform: "web",
        session_id: sessionId,
        event_id: options.eventId ?? null,
        source: options.source ?? null,
        entry_attempt_id: result.data.entry_attempt_id ?? traceId,
        video_date_trace_id: traceId,
      });
    } else {
      trackEvent(LobbyPostDateEvents.VIDEO_DATE_PREWARMED_TOKEN_CACHED, {
        platform: "web",
        session_id: sessionId,
        event_id: options.eventId ?? null,
        source: options.source ?? null,
        entry_attempt_id: result.data.entry_attempt_id ?? traceId,
        video_date_trace_id: traceId,
      });
    }
    Sentry.addBreadcrumb({
      category: "video-date",
      message: result.cached
        ? "prepare_date_entry_cache_used"
        : "prepare_date_entry_success",
      level: "info",
      data: {
        sessionId,
        eventId: options.eventId ?? null,
        roomName: result.data.room_name,
        cached: result.cached,
        entryAttemptId: result.data.entry_attempt_id ?? entryAttemptId,
        videoDateTraceId: traceId,
      },
    });
    vdbg("video_date_prepare_entry_success", {
      sessionId,
      eventId: options.eventId ?? null,
      source: options.source ?? null,
      roomName: result.data.room_name,
      cached: result.cached,
      timings: result.data.timings ?? null,
      entryAttemptId: result.data.entry_attempt_id ?? entryAttemptId,
      videoDateTraceId: traceId,
    });
    return result;
  }

  const traceId = result.entryAttemptId ?? videoDateTraceId;
  trackEvent(LobbyPostDateEvents.VIDEO_DATE_PREPARE_ENTRY_FAILURE, {
    platform: "web",
    session_id: sessionId,
    event_id: options.eventId ?? null,
    source: options.source ?? null,
    source_surface: sourceSurface,
    source_action: "prepare_date_entry_failure",
    code: result.code,
    reason_code: result.code,
    retryable: result.retryable,
    httpStatus: result.httpStatus ?? null,
    retry_after_ms: result.retryAfterMs ?? null,
    retry_after_seconds: result.retryAfterSeconds ?? null,
    coalesced: result.coalesced === true,
    owner_entry_attempt_id: result.ownerEntryAttemptId ?? null,
    duration_ms: Date.now() - startedAt,
    latency_bucket: bucketVideoDateLatencyMs(Date.now() - startedAt),
    attempt_count: attemptCount,
    entry_attempt_id: result.entryAttemptId ?? entryAttemptId,
    video_date_trace_id: traceId,
  });
  trackLatencyCheckpoint(
    "prepare_entry_failure",
    "prepare_date_entry_failure",
    "failure",
    result.code,
  );
  trackLatencyCheckpoint(
    "enter_handshake_failure",
    "prepare_date_entry_failure",
    "failure",
    result.code,
  );
  trackLatencyCheckpoint(
    "daily_token_failure",
    "daily_token_failure",
    "failure",
    result.code,
  );
  const failureDurationMs = Math.max(0, Date.now() - startedAt);
  const providerOperation = result.providerOperation ?? null;
  if (providerOperation === "create_token") {
    trackLatencyCheckpoint(
      "daily_token_mint_failure",
      "daily_token_mint_failure",
      "failure",
      result.code,
      failureDurationMs,
      {
        daily_performance_segment: "token_mint",
        daily_token_mint_ms: failureDurationMs,
      },
    );
  } else if (
    providerOperation === "create_room" ||
    providerOperation === "lookup_room" ||
    providerOperation === "delete_room"
  ) {
    trackLatencyCheckpoint(
      "daily_room_create_failure",
      "daily_room_create_failure",
      "failure",
      result.code,
      failureDurationMs,
      {
        daily_performance_segment: "room_create_or_verify",
        daily_room_create_ms: failureDurationMs,
      },
    );
  }
  Sentry.addBreadcrumb({
    category: "video-date",
    message: "prepare_date_entry_failure",
    level: result.retryable ? "warning" : "info",
    data: {
      sessionId,
      eventId: options.eventId ?? null,
      code: result.code,
      retryable: result.retryable,
      httpStatus: result.httpStatus ?? null,
      retryAfterMs: result.retryAfterMs ?? null,
      coalesced: result.coalesced === true,
      entryAttemptId: result.entryAttemptId ?? entryAttemptId,
      videoDateTraceId: traceId,
    },
  });
  vdbg("video_date_prepare_entry_failure", {
    sessionId,
    eventId: options.eventId ?? null,
    source: options.source ?? null,
    code: result.code,
    retryable: result.retryable,
    httpStatus: result.httpStatus ?? null,
    message: result.message ?? null,
    retryAfterMs: result.retryAfterMs ?? null,
    coalesced: result.coalesced === true,
    entryAttemptId: result.entryAttemptId ?? entryAttemptId,
    videoDateTraceId: traceId,
  });
  return result;
}

export async function prepareVideoDateSoloEntry(
  sessionId: string,
  options: PrepareVideoDateEntryOptions = {},
): Promise<PrepareVideoDateSoloEntryResult> {
  if (!videoDateDailySoloPrejoinEnabled()) {
    return { ok: false, code: "SOLO_PREJOIN_DISABLED", retryable: false };
  }
  const userId = options.userId ?? (await getCurrentUserId());
  if (!userId) {
    return { ok: false, code: "UNAUTHORIZED", retryable: false };
  }

  const startedAt = Date.now();
  const entryAttemptId = createVideoDateEntryAttemptId(startedAt);
  try {
    const { data, error, response } = await supabase.functions.invoke(
      "daily-room",
      {
        body: {
          action: PREPARE_VIDEO_DATE_SOLO_ENTRY_ACTION,
          sessionId,
          entry_attempt_id: entryAttemptId,
          video_date_trace_id: entryAttemptId,
        },
      },
    );

    if (!error && hasPreparedVideoDateSoloEntryPayload(data)) {
      vdbg("video_date_prepare_solo_entry_success", {
        sessionId,
        eventId: options.eventId ?? null,
        userId,
        source: options.source ?? null,
        roomName: data.room_name,
        readyGateStatus: data.ready_gate_status ?? null,
        durationMs: Math.max(0, Date.now() - startedAt),
        entryAttemptId: data.entry_attempt_id ?? entryAttemptId,
      });
      return {
        ok: true,
        data: {
          ...data,
          entry_attempt_id: data.entry_attempt_id ?? entryAttemptId,
          video_date_trace_id:
            data.video_date_trace_id ?? data.entry_attempt_id ?? entryAttemptId,
        },
      };
    }

    const failure = await classifyDailyRoomInvokeFailure({
      action: DAILY_ROOM_ACTIONS.PREPARE_SOLO_ENTRY,
      data,
      invokeError: error,
      response,
    });
    vdbg("video_date_prepare_solo_entry_failure", {
      sessionId,
      eventId: options.eventId ?? null,
      userId,
      source: options.source ?? null,
      code: failure.serverCode ?? failure.kind,
      httpStatus: failure.httpStatus ?? null,
      retryable: failure.retryable,
      durationMs: Math.max(0, Date.now() - startedAt),
      entryAttemptId,
    });
    return {
      ok: false,
      code: failure.serverCode ?? failure.kind,
      httpStatus: failure.httpStatus,
      retryable: failure.retryable,
      entryAttemptId,
    };
  } catch (error) {
    const failure = await classifyDailyRoomInvokeFailure({
      action: DAILY_ROOM_ACTIONS.PREPARE_SOLO_ENTRY,
      invokeError: error,
    });
    return {
      ok: false,
      code: failure.serverCode ?? failure.kind,
      message: error instanceof Error ? error.message : String(error),
      httpStatus: failure.httpStatus,
      retryable: failure.retryable,
      entryAttemptId,
    };
  }
}

export function getPreparedVideoDateEntry(
  sessionId: string,
  userId: string,
): PreparedVideoDateEntryCacheEntry | null {
  return getCachedPreparedVideoDateEntry(sessionId, userId);
}

export function consumePreparedVideoDateEntry(
  sessionId: string,
  userId: string,
): PreparedVideoDateEntryHandoffValidation {
  return consumePreparedVideoDateEntryHandoff(sessionId, userId);
}

export function rejectPreparedVideoDateEntry(
  sessionId: string,
  userId: string,
  reason: string,
  eventId?: string | null,
): boolean {
  const cached = getCachedPreparedVideoDateEntry(sessionId, userId);
  const rejected = rejectCachedPreparedVideoDateEntry(sessionId, userId);
  if (rejected) {
    const traceId =
      cached?.value.video_date_trace_id ?? cached?.entryAttemptId ?? null;
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_PREWARMED_TOKEN_REJECTED, {
      platform: "web",
      session_id: sessionId,
      event_id: eventId ?? null,
      reason,
      entry_attempt_id: cached?.entryAttemptId ?? null,
      video_date_trace_id: traceId,
    });
    vdbg("video_date_prewarmed_token_rejected", {
      sessionId,
      userId,
      eventId: eventId ?? null,
      reason,
      entryAttemptId: cached?.entryAttemptId ?? null,
      videoDateTraceId: traceId,
    });
  }
  return rejected;
}

export function buildPreparedEntryJoinTimings(
  entry: PreparedVideoDateEntryCacheEntry | null,
  joinStartedAtMs: number = Date.now(),
) {
  return {
    prepareToJoinStartMs: entry
      ? getPrepareToJoinStartMs(entry, joinStartedAtMs)
      : null,
    bothReadyToFirstRemoteFrameMs: getBothReadyToFirstRemoteFrameMs(
      entry,
      Date.now(),
    ),
  };
}
