import * as Sentry from "@sentry/react";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { vdbg } from "@/lib/vdbg";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  buildReadyGateToDateLatencyPayload,
  bucketVideoDateLatencyMs,
  recordReadyGateToDateLatencyCheckpoint,
} from "@clientShared/observability/videoDateOperatorMetrics";
import {
  DAILY_ROOM_ACTIONS,
  classifyDailyRoomInvokeFailure,
} from "@clientShared/matching/dailyRoomFailure";
import {
  PREPARE_VIDEO_DATE_ENTRY_ACTION,
  ENSURE_VIDEO_DATE_ROOM_ACTION,
  consumePreparedVideoDateEntryHandoff,
  createVideoDateEntryAttemptId,
  getBothReadyToFirstRemoteFrameMs,
  getCachedPreparedVideoDateEntry,
  getPrepareToJoinStartMs,
  prepareVideoDateEntryWithClient,
  rejectCachedPreparedVideoDateEntry,
  type PrepareVideoDateEntryResult,
  type EnsureVideoDateRoomResult,
  type EnsureVideoDateRoomSuccess,
  type PreparedVideoDateEntryCacheEntry,
  type PreparedVideoDateEntryHandoffValidation,
} from "@clientShared/matching/videoDatePrepareEntry";

type PrepareVideoDateEntryOptions = {
  eventId?: string | null;
  source?: string;
  force?: boolean;
  bothReadyObservedAtMs?: number;
};

type EnsureVideoDateRoomOptions = {
  eventId?: string | null;
  source?: string;
};

async function getCurrentUserId(): Promise<string | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user?.id) return null;
  return user.id;
}

function hasEnsureRoomPayload(data: unknown): data is EnsureVideoDateRoomSuccess {
  if (!data || typeof data !== "object") return false;
  const row = data as Partial<EnsureVideoDateRoomSuccess>;
  return row.success === true && typeof row.room_name === "string" && typeof row.room_url === "string";
}

export async function ensureVideoDateRoom(
  sessionId: string,
  options: EnsureVideoDateRoomOptions = {},
): Promise<EnsureVideoDateRoomResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, code: "UNAUTHORIZED", retryable: false };

  const startedAt = Date.now();
  const entryAttemptId = createVideoDateEntryAttemptId(startedAt);
  const latencyContext = recordReadyGateToDateLatencyCheckpoint({
    sessionId,
    platform: "web",
    eventId: options.eventId ?? null,
    sourceSurface: "ready_gate_overlay",
    checkpoint: "room_warmup_started",
    nowMs: startedAt,
  });
  trackEvent(
    LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
    buildReadyGateToDateLatencyPayload({
      context: latencyContext,
      checkpoint: "room_warmup_started",
      sourceAction: options.source ?? "ensure_date_room",
      outcome: "success",
    }),
  );
  trackEvent(LobbyPostDateEvents.VIDEO_DATE_ROOM_WARMUP_STARTED, {
    platform: "web",
    session_id: sessionId,
    event_id: options.eventId ?? null,
    source: options.source ?? null,
    source_surface: "ready_gate_overlay",
    source_action: "ensure_date_room_started",
    entry_attempt_id: entryAttemptId,
    video_date_trace_id: entryAttemptId,
  });

  const { data, error } = await supabase.functions.invoke("daily-room", {
    body: {
      action: ENSURE_VIDEO_DATE_ROOM_ACTION,
      sessionId,
      entry_attempt_id: entryAttemptId,
      video_date_trace_id: entryAttemptId,
    },
  });

  if (!error && hasEnsureRoomPayload(data)) {
    const durationMs = Date.now() - startedAt;
    const successContext = recordReadyGateToDateLatencyCheckpoint({
      sessionId,
      platform: "web",
      eventId: options.eventId ?? null,
      sourceSurface: "ready_gate_overlay",
      checkpoint: "room_warmup_success",
    });
    trackEvent(
      LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
      buildReadyGateToDateLatencyPayload({
        context: successContext,
        checkpoint: "room_warmup_success",
        sourceAction: options.source ?? "ensure_date_room",
        outcome: "success",
        durationMs,
      }),
    );
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_ROOM_WARMUP_SUCCESS, {
      platform: "web",
      session_id: sessionId,
      event_id: options.eventId ?? null,
      source: options.source ?? null,
      source_surface: "ready_gate_overlay",
      source_action: "ensure_date_room_success",
      duration_ms: durationMs,
      latency_bucket: bucketVideoDateLatencyMs(durationMs),
      reused_room: data.reused_room === true,
      provider_room_recreated: data.provider_room_recreated === true,
      provider_verify_skipped: data.provider_verify_skipped === true,
      provider_verify_reason: data.provider_verify_reason ?? null,
      entry_attempt_id: data.entry_attempt_id ?? entryAttemptId,
      video_date_trace_id: data.video_date_trace_id ?? entryAttemptId,
    });
    return { ok: true, data };
  }

  const failure = await classifyDailyRoomInvokeFailure({
    action: DAILY_ROOM_ACTIONS.ENSURE_ROOM,
    data,
    invokeError: error,
  });
  const code = failure.serverCode ?? failure.kind;
  const failureContext = recordReadyGateToDateLatencyCheckpoint({
    sessionId,
    platform: "web",
    eventId: options.eventId ?? null,
    sourceSurface: "ready_gate_overlay",
    checkpoint: "room_warmup_failure",
  });
  trackEvent(
    LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
    buildReadyGateToDateLatencyPayload({
      context: failureContext,
      checkpoint: "room_warmup_failure",
      sourceAction: options.source ?? "ensure_date_room",
      outcome: "failure",
      reasonCode: code,
      durationMs: Date.now() - startedAt,
    }),
  );
  trackEvent(LobbyPostDateEvents.VIDEO_DATE_ROOM_WARMUP_FAILURE, {
    platform: "web",
    session_id: sessionId,
    event_id: options.eventId ?? null,
    source: options.source ?? null,
    source_surface: "ready_gate_overlay",
    source_action: "ensure_date_room_failure",
    code,
    reason_code: code,
    httpStatus: failure.httpStatus ?? null,
    retryable: failure.retryable,
    duration_ms: Date.now() - startedAt,
    entry_attempt_id: entryAttemptId,
    video_date_trace_id: entryAttemptId,
  });
  return {
    ok: false,
    code,
    message: error instanceof Error ? error.message : undefined,
    httpStatus: failure.httpStatus,
    retryable: failure.retryable,
    entryAttemptId,
  };
}

export async function prepareVideoDateEntry(
  sessionId: string,
  options: PrepareVideoDateEntryOptions = {},
): Promise<PrepareVideoDateEntryResult> {
  const userId = await getCurrentUserId();
  if (!userId) {
    return { ok: false, code: "UNAUTHORIZED", retryable: false };
  }

  const startedAt = Date.now();
  const entryAttemptId = createVideoDateEntryAttemptId(startedAt);
  const videoDateTraceId = entryAttemptId;
  const sourceSurface = "video_date_entry";
  const attemptCount = options.force ? 2 : 1;
  const trackLatencyCheckpoint = (
    checkpoint:
      | "prepare_entry_started"
      | "prepare_entry_success"
      | "prepare_entry_failure"
      | "provider_verify_started"
      | "provider_verify_success"
      | "provider_verify_skipped"
      | "enter_handshake_started"
      | "enter_handshake_success"
      | "enter_handshake_failure"
      | "daily_token_started"
      | "daily_token_success"
      | "daily_token_failure",
    sourceAction: string,
    outcome: "success" | "failure",
    reasonCode?: string | null,
    durationMs?: number | null,
  ) => {
    const context = recordReadyGateToDateLatencyCheckpoint({
      sessionId,
      platform: "web",
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

  trackLatencyCheckpoint("prepare_entry_started", "prepare_date_entry_started", "success");
  trackLatencyCheckpoint("provider_verify_started", "prepare_date_entry_started", "success");
  trackLatencyCheckpoint("enter_handshake_started", "prepare_date_entry_started", "success");
  trackLatencyCheckpoint("daily_token_started", "daily_token_request_started", "success");

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
  });

  if (result.ok === true) {
    const durationMs = Date.now() - startedAt;
    const tokenDurationMs = result.data.timings?.prepareDurationMs ?? durationMs;
    const providerVerifyDurationMs = result.data.timings?.room_create_or_verify_ms ?? null;
    const providerVerifySkipped = result.data.provider_verify_skipped === true;
    const providerVerifyCheckpoint = providerVerifySkipped ? "provider_verify_skipped" : "provider_verify_success";
    const traceId = result.data.video_date_trace_id ?? result.data.entry_attempt_id ?? videoDateTraceId;
    trackLatencyCheckpoint("prepare_entry_success", "prepare_date_entry_success", "success", null, tokenDurationMs);
    trackLatencyCheckpoint(
      providerVerifyCheckpoint,
      providerVerifySkipped ? "provider_verify_skipped" : "provider_verify_success",
      "success",
      result.data.provider_verify_reason ?? null,
      providerVerifyDurationMs,
    );
    trackLatencyCheckpoint("enter_handshake_success", "prepare_date_entry_success", "success", null, tokenDurationMs);
    trackLatencyCheckpoint("daily_token_success", "daily_token_success", "success", null, tokenDurationMs);
    const tokenCreatedContext = recordReadyGateToDateLatencyCheckpoint({
      sessionId,
      platform: "web",
      eventId: options.eventId ?? null,
      sourceSurface,
      checkpoint: "token_created",
      attemptCount,
    });
    trackEvent(
      LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
      buildReadyGateToDateLatencyPayload({
        context: tokenCreatedContext,
        checkpoint: "token_created",
        sourceAction: result.cached ? "prepared_token_cache_used" : "prepare_date_entry_token_created",
        outcome: "success",
        durationMs: tokenDurationMs,
        attemptCount,
      }),
    );
    trackEvent(LobbyPostDateEvents.VIDEO_DATE_TOKEN_CREATED, {
      platform: "web",
      session_id: sessionId,
      event_id: options.eventId ?? null,
      source_surface: sourceSurface,
      source_action: result.cached ? "prepared_token_cache_used" : "prepare_date_entry_token_created",
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
        source_action: providerVerifySkipped ? "provider_verify_skipped" : "provider_verify_success",
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
      bothReadyToPrepareStartMs: result.data.timings?.bothReadyToPrepareStartMs ?? null,
      reused_room: result.data.reused_room === true,
      provider_room_recreated: result.data.provider_room_recreated === true,
      provider_verify_skipped: providerVerifySkipped,
      provider_verify_reason: result.data.provider_verify_reason ?? null,
      daily_room_verified_at: result.data.daily_room_verified_at ?? null,
      daily_room_expires_at: result.data.daily_room_expires_at ?? null,
      auth_ms: result.data.timings?.auth_ms ?? null,
      prepare_rpc_ms: result.data.timings?.prepare_rpc_ms ?? null,
      room_create_or_verify_ms: result.data.timings?.room_create_or_verify_ms ?? null,
      token_ms: result.data.timings?.token_ms ?? null,
      confirm_prepare_ms: result.data.timings?.confirm_prepare_ms ?? null,
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
      message: result.cached ? "prepare_date_entry_cache_used" : "prepare_date_entry_success",
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
    duration_ms: Date.now() - startedAt,
    latency_bucket: bucketVideoDateLatencyMs(Date.now() - startedAt),
    attempt_count: attemptCount,
    entry_attempt_id: result.entryAttemptId ?? entryAttemptId,
    video_date_trace_id: traceId,
  });
  trackLatencyCheckpoint("prepare_entry_failure", "prepare_date_entry_failure", "failure", result.code);
  trackLatencyCheckpoint("enter_handshake_failure", "prepare_date_entry_failure", "failure", result.code);
  trackLatencyCheckpoint("daily_token_failure", "daily_token_failure", "failure", result.code);
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
    entryAttemptId: result.entryAttemptId ?? entryAttemptId,
    videoDateTraceId: traceId,
  });
  return result;
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
    const traceId = cached?.value.video_date_trace_id ?? cached?.entryAttemptId ?? null;
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
    prepareToJoinStartMs: entry ? getPrepareToJoinStartMs(entry, joinStartedAtMs) : null,
    bothReadyToFirstRemoteFrameMs: getBothReadyToFirstRemoteFrameMs(entry, Date.now()),
  };
}
