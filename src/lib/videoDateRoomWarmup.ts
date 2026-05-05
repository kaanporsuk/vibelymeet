import * as Sentry from "@sentry/react";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";
import { vdbg } from "@/lib/vdbg";
import { LobbyPostDateEvents } from "@clientShared/analytics/lobbyToPostDateJourney";
import {
  buildReadyGateToDateLatencyPayload,
  recordReadyGateToDateLatencyCheckpoint,
} from "@clientShared/observability/videoDateOperatorMetrics";
import {
  DAILY_ROOM_ACTIONS,
  classifyDailyRoomInvokeFailure,
} from "@clientShared/matching/dailyRoomFailure";
import {
  ENSURE_VIDEO_DATE_ROOM_ACTION,
  hasVideoDateRoomWarmupPayload,
  readVideoDateRoomWarmupFailureMessage,
  type VideoDateRoomWarmupResult,
} from "@clientShared/matching/videoDateRoomWarmup";
import { createVideoDateEntryAttemptId } from "@clientShared/matching/videoDatePrepareEntry";

type EnsureVideoDateRoomWarmupOptions = {
  eventId?: string | null;
  userId?: string | null;
  source?: string;
};

export function videoDateRoomWarmupAfterReadyEnabled(): boolean {
  return String(import.meta.env.VITE_VIDEO_DATE_ROOM_WARMUP_AFTER_READY ?? "false").toLowerCase() === "true";
}

export async function ensureVideoDateRoomWarmup(
  sessionId: string,
  options: EnsureVideoDateRoomWarmupOptions = {},
): Promise<VideoDateRoomWarmupResult> {
  if (!videoDateRoomWarmupAfterReadyEnabled()) {
    return { ok: false, code: "flag_disabled", retryable: false };
  }

  const startedAt = Date.now();
  const entryAttemptId = createVideoDateEntryAttemptId(startedAt);
  const sourceSurface = "ready_gate_overlay";
  const sourceAction = options.source ?? "room_warmup_after_ready";

  const startedContext = recordReadyGateToDateLatencyCheckpoint({
    sessionId,
    platform: "web",
    eventId: options.eventId ?? null,
    sourceSurface,
    checkpoint: "room_warmup_started",
    entryAttemptId,
    videoDateTraceId: entryAttemptId,
  });
  trackEvent(
    LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
    buildReadyGateToDateLatencyPayload({
      context: startedContext,
      checkpoint: "room_warmup_started",
      sourceAction,
      outcome: "success",
    }),
  );
  vdbg("video_date_room_warmup_started", {
    sessionId,
    eventId: options.eventId ?? null,
    userId: options.userId ?? null,
    source: sourceAction,
    entryAttemptId,
  });

  try {
    const { data, error, response } = await supabase.functions.invoke("daily-room", {
      body: {
        action: ENSURE_VIDEO_DATE_ROOM_ACTION,
        sessionId,
        entry_attempt_id: entryAttemptId,
        video_date_trace_id: entryAttemptId,
      },
    });
    const durationMs = Math.max(0, Date.now() - startedAt);

    if (!error && hasVideoDateRoomWarmupPayload(data)) {
      const successContext = recordReadyGateToDateLatencyCheckpoint({
        sessionId,
        platform: "web",
        eventId: options.eventId ?? null,
        sourceSurface,
        checkpoint: "room_warmup_success",
        entryAttemptId: data.entry_attempt_id ?? entryAttemptId,
        videoDateTraceId: data.video_date_trace_id ?? data.entry_attempt_id ?? entryAttemptId,
        providerVerifySkipped: data.provider_verify_skipped ?? null,
      });
      trackEvent(
        LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
        buildReadyGateToDateLatencyPayload({
          context: successContext,
          checkpoint: "room_warmup_success",
          sourceAction,
          outcome: "success",
          durationMs,
          extra: {
            provider_verify_reason: data.provider_verify_reason ?? null,
            daily_room_verified_at: data.daily_room_verified_at ?? null,
            daily_room_expires_at: data.daily_room_expires_at ?? null,
            room_create_or_verify_ms: data.timings?.room_create_or_verify_ms ?? null,
          },
        }),
      );
      vdbg("video_date_room_warmup_success", {
        sessionId,
        eventId: options.eventId ?? null,
        userId: options.userId ?? null,
        source: sourceAction,
        roomName: data.room_name,
        providerVerifySkipped: data.provider_verify_skipped ?? null,
        durationMs,
      });
      return { ok: true, data };
    }

    const failure = await classifyDailyRoomInvokeFailure({
      action: DAILY_ROOM_ACTIONS.ENSURE_ROOM,
      data,
      invokeError: error,
      response,
    });
    const code = failure.serverCode ?? failure.kind;
    const failureContext = recordReadyGateToDateLatencyCheckpoint({
      sessionId,
      platform: "web",
      eventId: options.eventId ?? null,
      sourceSurface,
      checkpoint: "room_warmup_failure",
      entryAttemptId,
      videoDateTraceId: entryAttemptId,
    });
    trackEvent(
      LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
      buildReadyGateToDateLatencyPayload({
        context: failureContext,
        checkpoint: "room_warmup_failure",
        sourceAction,
        outcome: "failure",
        reasonCode: code,
        durationMs,
      }),
    );
    vdbg("video_date_room_warmup_failure", {
      sessionId,
      eventId: options.eventId ?? null,
      userId: options.userId ?? null,
      source: sourceAction,
      code,
      httpStatus: failure.httpStatus ?? null,
      retryable: failure.retryable,
      durationMs,
    });
    return {
      ok: false,
      code,
      message: readVideoDateRoomWarmupFailureMessage(data, error instanceof Error ? error.message : undefined),
      httpStatus: failure.httpStatus,
      retryable: failure.retryable,
      entryAttemptId,
    };
  } catch (error) {
    const durationMs = Math.max(0, Date.now() - startedAt);
    const failureContext = recordReadyGateToDateLatencyCheckpoint({
      sessionId,
      platform: "web",
      eventId: options.eventId ?? null,
      sourceSurface,
      checkpoint: "room_warmup_failure",
      entryAttemptId,
      videoDateTraceId: entryAttemptId,
    });
    trackEvent(
      LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
      buildReadyGateToDateLatencyPayload({
        context: failureContext,
        checkpoint: "room_warmup_failure",
        sourceAction,
        outcome: "failure",
        reasonCode: "network",
        durationMs,
      }),
    );
    Sentry.addBreadcrumb({
      category: "video-date",
      message: "video_date_room_warmup_exception",
      level: "warning",
      data: {
        sessionId,
        eventId: options.eventId ?? null,
        source: sourceAction,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    vdbg("video_date_room_warmup_exception", {
      sessionId,
      eventId: options.eventId ?? null,
      userId: options.userId ?? null,
      source: sourceAction,
      durationMs,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    });
    return {
      ok: false,
      code: "network",
      message: error instanceof Error ? error.message : String(error),
      retryable: true,
      entryAttemptId,
    };
  }
}
