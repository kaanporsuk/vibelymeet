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

test("video date operator metric ids stay stable", () => {
  assert.deepEqual(VIDEO_DATE_OPERATOR_METRIC_IDS, [
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
    bothReadyToDateRouteMs: null,
    bothReadyToDailyTokenMs: null,
    bothReadyToDailyJoinMs: 1_450,
    bothReadyToRemoteSeenMs: null,
    bothReadyToFirstRemoteFrameMs: null,
    dailyTokenDurationMs: null,
    dailyJoinDurationMs: null,
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
