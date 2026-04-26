import test from "node:test";
import assert from "node:assert/strict";
import {
  VIDEO_DATE_OPS_WINDOWS,
  classifyHigherIsBetter,
  classifyLowerIsBetter,
  percentile,
  safeRate,
  summarizeLatencyMs,
  summarizeQueueDrain,
  summarizeSwipeRecovery,
} from "./admin-video-date-ops";

test("video date ops windows stay stable", () => {
  assert.deepEqual(
    VIDEO_DATE_OPS_WINDOWS.map((window) => [window.id, window.hours]),
    [
      ["24h", 24],
      ["7d", 168],
    ],
  );
});

test("percentile and latency summaries ignore unusable values", () => {
  assert.equal(percentile([100, 200, 300, 400], 0.5), 250);
  assert.equal(percentile([100, Number.NaN, 300], 0.95), 290);
  assert.deepEqual(summarizeLatencyMs([1000, -50, 2000, Number.POSITIVE_INFINITY, 4000]), {
    sample_count: 3,
    p50_ms: 2000,
    p95_ms: 3800,
    max_ms: 4000,
  });
});

test("safeRate returns null for empty denominators", () => {
  assert.equal(safeRate(1, 0), null);
  assert.equal(safeRate(2, 4), 0.5);
});

test("swipe recovery treats already_matched with session id as recovered", () => {
  const summary = summarizeSwipeRecovery([
    { reason_code: "match_immediate", session_id: "session-a" },
    { reason_code: "already_matched", session_id: "session-a" },
    { reason_code: "already_matched", session_id: null },
    { reason_code: "participant_has_active_session_conflict", session_id: "session-b" },
  ]);

  assert.equal(summary.total_swipe_rows, 4);
  assert.equal(summary.collision_rows, 3);
  assert.equal(summary.recovered_rows, 1);
  assert.equal(summary.unrecovered_rows, 2);
  assert.equal(summary.collision_rate, 0.75);
  assert.equal(summary.recovery_rate, 1 / 3);
});

test("queue drain summaries aggregate non-success reason counts", () => {
  const summary = summarizeQueueDrain([
    { outcome: "success", reason_code: "promoted" },
    { outcome: "blocked", reason_code: "partner_not_present" },
    { outcome: "error", reason_code: "rpc_error" },
    { outcome: "error", reason_code: "rpc_error" },
  ]);

  assert.equal(summary.attempts, 4);
  assert.equal(summary.failures, 3);
  assert.equal(summary.failure_rate, 0.75);
  assert.deepEqual(summary.top_failure_reasons, [
    { reason: "rpc_error", count: 2 },
    { reason: "partner_not_present", count: 1 },
  ]);
});

test("status classifiers keep threshold semantics explicit", () => {
  assert.equal(classifyLowerIsBetter(0.01, 0.03, 0.08), "healthy");
  assert.equal(classifyLowerIsBetter(0.04, 0.03, 0.08), "warning");
  assert.equal(classifyLowerIsBetter(0.1, 0.03, 0.08), "critical");
  assert.equal(classifyHigherIsBetter(0.7, 0.35, 0.2), "healthy");
  assert.equal(classifyHigherIsBetter(0.3, 0.35, 0.2), "warning");
  assert.equal(classifyHigherIsBetter(0.1, 0.35, 0.2), "critical");
});
