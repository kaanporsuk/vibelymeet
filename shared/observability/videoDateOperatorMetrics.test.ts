import test from "node:test";
import assert from "node:assert/strict";
import { LobbyPostDateEvents } from "../analytics/lobbyToPostDateJourney";
import {
  VIDEO_DATE_OPERATOR_METRIC_IDS,
  VIDEO_DATE_TIMER_DRIFT_RECOVERY_EVENT_NAME,
  bucketVideoDateTimerDriftMs,
  buildVideoDateTimerDriftRecoveredPayload,
  classifyVideoDateOperatorMetric,
  shouldTrackVideoDateTimerDriftRecovery,
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
  assert.equal(bucketVideoDateTimerDriftMs(2_999), "under_3s");
  assert.equal(bucketVideoDateTimerDriftMs(3_000), "3s_to_10s");
  assert.equal(bucketVideoDateTimerDriftMs(10_000), "10s_to_30s");
  assert.equal(bucketVideoDateTimerDriftMs(30_000), "30s_plus");
});

test("timer drift payload emits only meaningful date-phase corrections", () => {
  assert.equal(
    shouldTrackVideoDateTimerDriftRecovery({
      previousTimeLeftSeconds: 120,
      correctedTimeLeftSeconds: 118,
    }),
    false,
  );
  assert.equal(
    buildVideoDateTimerDriftRecoveredPayload({
      platform: "web",
      sessionId: "session-1",
      previousTimeLeftSeconds: 60,
      correctedTimeLeftSeconds: 300,
      recoverySource: "timing_fetch",
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
      recoverySource: "session_truth_sync",
      phase: "date",
    }),
    {
      platform: "native",
      session_id: "session-1",
      event_id: "event-1",
      drift_ms: 12_000,
      drift_bucket: "10s_to_30s",
      drift_direction: "client_ahead",
      recovery_source: "session_truth_sync",
      phase: "date",
    },
  );
});
