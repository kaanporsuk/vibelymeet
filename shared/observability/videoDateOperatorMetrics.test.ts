import test from "node:test";
import assert from "node:assert/strict";
import { LobbyPostDateEvents } from "../analytics/lobbyToPostDateJourney";
import {
  VIDEO_DATE_OPERATOR_METRIC_IDS,
  VIDEO_DATE_TIMER_DRIFT_RECOVERY_EVENT_NAME,
  buildReadyGateToDateLatencyPayload,
  bucketVideoDateTimerDriftMs,
  bucketVideoDateLatencyMs,
  buildVideoDateTimerDriftRecoveredPayload,
  classifyVideoDateOperatorMetric,
  getReadyGateToDateLatencyDurations,
  recordReadyGateToDateLatencyCheckpoint,
  shouldTrackVideoDateTimerDriftRecovery,
  startReadyGateToDateLatencyContext,
} from "./videoDateOperatorMetrics";
import {
  emitVideoDateLaunchLatencyCheckpointObservability,
  sanitizeVideoDateLaunchLatencyPayload,
} from "./videoDateLaunchLatencyCheckpointObservability";

test("video date operator metric ids stay stable", () => {
  assert.deepEqual(VIDEO_DATE_OPERATOR_METRIC_IDS, [
    "ready_tap_to_first_remote_frame_latency",
    "ready_gate_open_to_date_join_latency",
    "simultaneous_swipe_collision_rate",
    "survey_to_next_ready_gate_conversion",
    "queue_drain_failure_rate",
    "timer_drift_recovered_by_server_truth",
  ]);
});

test("operator thresholds classify lower and higher is better metrics", () => {
  assert.equal(
    classifyVideoDateOperatorMetric(4_000, {
      warning: 10_000,
      critical: 20_000,
      direction: "lower_is_better",
    }),
    "healthy",
  );
  assert.equal(
    classifyVideoDateOperatorMetric(12_000, {
      warning: 10_000,
      critical: 20_000,
      direction: "lower_is_better",
    }),
    "warning",
  );
  assert.equal(
    classifyVideoDateOperatorMetric(0.18, {
      warning: 0.35,
      critical: 0.2,
      direction: "higher_is_better",
    }),
    "critical",
  );
  assert.equal(
    classifyVideoDateOperatorMetric(null, {
      warning: 0.35,
      critical: 0.2,
      direction: "higher_is_better",
    }),
    "unknown",
  );
});

test("timer drift buckets and event name are stable", () => {
  assert.equal(
    VIDEO_DATE_TIMER_DRIFT_RECOVERY_EVENT_NAME,
    LobbyPostDateEvents.VIDEO_DATE_TIMER_DRIFT_RECOVERED_BY_SERVER_TRUTH,
  );
  assert.equal(
    LobbyPostDateEvents.VIDEO_DATE_TIMER_DRIFT_RECOVERED,
    LobbyPostDateEvents.VIDEO_DATE_TIMER_DRIFT_RECOVERED_BY_SERVER_TRUTH,
  );
  assert.equal(bucketVideoDateTimerDriftMs(999), "lt_1s");
  assert.equal(bucketVideoDateTimerDriftMs(1_000), "1_5s");
  assert.equal(bucketVideoDateTimerDriftMs(5_000), "5_15s");
  assert.equal(bucketVideoDateTimerDriftMs(15_000), "15_60s");
  assert.equal(bucketVideoDateTimerDriftMs(60_000), "gt_60s");
});

test("timer drift payload emits only meaningful date-phase corrections", () => {
  assert.equal(
    shouldTrackVideoDateTimerDriftRecovery({
      previousTimeLeftSeconds: 120,
      correctedTimeLeftSeconds: 119.5,
    }),
    false,
  );
  assert.equal(
    buildVideoDateTimerDriftRecoveredPayload({
      platform: "web",
      sessionId: "session-1",
      previousTimeLeftSeconds: 60,
      correctedTimeLeftSeconds: 300,
      recoverySource: "session_reload",
      phase: "handshake",
    }),
    null,
  );
  assert.deepEqual(
    buildVideoDateTimerDriftRecoveredPayload({
      platform: "native",
      sessionId: "session-1",
      eventId: "event-1",
      previousTimeLeftSeconds: 82,
      correctedTimeLeftSeconds: 70,
      recoverySource: "sync_reconnect",
      phase: "date",
    }),
    {
      platform: "native",
      session_id: "session-1",
      event_id: "event-1",
      source_surface: "video_date",
      source_action: "sync_reconnect",
      outcome: "recovered",
      drift_ms: 12_000,
      drift_bucket: "5_15s",
      drift_direction: "client_ahead",
      recovery_source: "sync_reconnect",
      local_phase: "date",
      server_phase: "date",
      phase: "date",
      survey_recovered: false,
      date_phase_restored: true,
      ended_state_corrected: false,
    },
  );
});

test("latency buckets and context durations are stable", () => {
  assert.equal(bucketVideoDateLatencyMs(499), "lt_500ms");
  assert.equal(bucketVideoDateLatencyMs(500), "500ms_1s");
  assert.equal(bucketVideoDateLatencyMs(1_500), "1_2s");
  assert.equal(bucketVideoDateLatencyMs(65_000), "gt_60s");

  const ctx = startReadyGateToDateLatencyContext({
    platform: "web",
    sessionId: "session-1",
    eventId: "event-1",
    sourceSurface: "ready_gate_overlay",
    nowMs: 1_000,
  });
  recordReadyGateToDateLatencyCheckpoint({
    sessionId: "session-1",
    checkpoint: "ready_tap",
    nowMs: 1_800,
  });
  recordReadyGateToDateLatencyCheckpoint({
    sessionId: "session-1",
    checkpoint: "both_ready_observed",
    nowMs: 2_000,
  });
  recordReadyGateToDateLatencyCheckpoint({
    sessionId: "session-1",
    checkpoint: "daily_join_success",
    nowMs: 3_450,
  });

  assert.deepEqual(getReadyGateToDateLatencyDurations(ctx), {
    readyGateOpenToReadyTapMs: 800,
    readyTapToBothReadyMs: 200,
    readyTapToPrepareEntryMs: null,
    readyTapToDateRouteMs: null,
    readyTapToDailyJoinMs: 1_650,
    readyTapToRemoteSeenMs: null,
    readyTapToFirstRemoteFrameMs: null,
    bothReadyToDateRouteMs: null,
    bothReadyToDailyTokenMs: null,
    bothReadyToDailyJoinMs: 1_450,
    bothReadyToRemoteSeenMs: null,
    bothReadyToFirstRemoteFrameMs: null,
    bothReadyToVideoStageShellMs: null,
    bothReadyToLocalVideoReadyMs: null,
    dateRouteBootstrapMs: null,
    dateRouteToDailyJoinMs: null,
    dailyJoinToRemoteSeenMs: null,
    dailyJoinToFirstRemoteFrameMs: null,
    remoteSeenToFirstRemoteFrameMs: null,
    firstRemoteFrameToReadableMs: null,
    dailyTokenDurationMs: null,
    dailyJoinDurationMs: null,
    roomWarmupDurationMs: null,
    prepareEntryDurationMs: null,
    providerVerifyDurationMs: null,
    permissionCheckDurationMs: null,
  });

  assert.equal(
    buildReadyGateToDateLatencyPayload({
      context: ctx,
      checkpoint: "daily_join_success",
      sourceAction: "daily_join_success",
      outcome: "success",
    }).latency_bucket,
    "1_2s",
  );
});

test("launch latency checkpoint observability preserves safe first-frame dimensions", async () => {
  const rawProperties = {
    session_id: "8b1e4e8c-2141-4c33-b978-a751d37e4c9b",
    checkpoint: "first_remote_frame",
    platform: "web",
    source_surface: "video_date_daily",
    source_action: "remote_video_frame_callback",
    outcome: "success",
    entry_attempt_id: "vde_mabc123_z9y8x7",
    video_date_trace_id: "vde_mabc123_z9y8x7",
    ready_tap_to_first_remote_frame_ms: 1900,
    both_ready_to_first_remote_frame_ms: 700,
    cached_prepare_entry: true,
    provider_verify_skipped: true,
    token: "must_not_survive",
  };

  assert.deepEqual(sanitizeVideoDateLaunchLatencyPayload(rawProperties), {
    platform: "web",
    source_surface: "video_date_daily",
    source_action: "remote_video_frame_callback",
    outcome: "success",
    entry_attempt_id: "vde_mabc123_z9y8x7",
    video_date_trace_id: "vde_mabc123_z9y8x7",
    ready_tap_to_first_remote_frame_ms: 1900,
    both_ready_to_first_remote_frame_ms: 700,
    cached_prepare_entry: true,
    provider_verify_skipped: true,
  });

  let capturedArgs: Record<string, unknown> | null = null;
  const result = await emitVideoDateLaunchLatencyCheckpointObservability({
    client: {
      rpc: async (_fn, args) => {
        capturedArgs = args;
        return { data: { inserted: true }, error: null };
      },
    },
    eventName: LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
    properties: rawProperties,
  });

  assert.deepEqual(result, { ok: true, inserted: true });
  assert.equal(capturedArgs?.p_checkpoint, "first_remote_frame");
  assert.equal(capturedArgs?.p_latency_ms, 1900);
});

test("permission prewarm skip checkpoint is safe and allowlisted", async () => {
  const rawProperties = {
    session_id: "3a54f630-2dec-4529-8dfa-349741bc593c",
    checkpoint: "permission_check_skipped",
    platform: "web",
    source_surface: "ready_gate_overlay",
    source_action: "permission_prewarm_silent_no_permissions_api",
    outcome: "no_op",
    reason_code: "skipped_no_permissions_api",
    token: "must_not_survive",
  };

  assert.deepEqual(sanitizeVideoDateLaunchLatencyPayload(rawProperties), {
    platform: "web",
    source_surface: "ready_gate_overlay",
    source_action: "permission_prewarm_silent_no_permissions_api",
    outcome: "no_op",
    reason_code: "skipped_no_permissions_api",
  });

  let capturedArgs: Record<string, unknown> | null = null;
  const result = await emitVideoDateLaunchLatencyCheckpointObservability({
    client: {
      rpc: async (_fn, args) => {
        capturedArgs = args;
        return { data: { inserted: true }, error: null };
      },
    },
    eventName: LobbyPostDateEvents.READY_GATE_TO_DATE_LATENCY_CHECKPOINT,
    properties: rawProperties,
  });

  assert.deepEqual(result, { ok: true, inserted: true });
  assert.equal(capturedArgs?.p_checkpoint, "permission_check_skipped");
  assert.equal(capturedArgs?.p_latency_ms, null);
});
