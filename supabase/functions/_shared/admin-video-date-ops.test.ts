import test from "node:test";
import assert from "node:assert/strict";
import {
  VIDEO_DATE_OPS_WINDOWS,
  classifyHigherIsBetter,
  classifyLowerIsBetter,
  extractVideoDateTimelineTraceIds,
  hasVideoDateTimelineRole,
  isValidUuid,
  percentile,
  redactVideoDateTimelineDetail,
  safeVideoDateTimelineRows,
  safeRate,
  summarizeLatencyMs,
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


test("status classifiers keep threshold semantics explicit", () => {
  assert.equal(classifyLowerIsBetter(0.01, 0.03, 0.08), "healthy");
  assert.equal(classifyLowerIsBetter(0.04, 0.03, 0.08), "warning");
  assert.equal(classifyLowerIsBetter(0.1, 0.03, 0.08), "critical");
  assert.equal(classifyHigherIsBetter(0.7, 0.35, 0.2), "healthy");
  assert.equal(classifyHigherIsBetter(0.3, 0.35, 0.2), "warning");
  assert.equal(classifyHigherIsBetter(0.1, 0.35, 0.2), "critical");
});

test("video date timeline role helper allows admins only", () => {
  assert.equal(hasVideoDateTimelineRole([{ role: "admin" }]), true);
  assert.equal(hasVideoDateTimelineRole([{ role: "moderator" }]), false);
  assert.equal(hasVideoDateTimelineRole([{ role: "user" }]), false);
  assert.equal(hasVideoDateTimelineRole([]), false);
});

test("video date timeline session ids must be UUIDs", () => {
  assert.equal(isValidUuid("8b1e4e8c-2141-4c33-b978-a751d37e4c9b"), true);
  assert.equal(isValidUuid("date-8b1e4e8c21414c33b978a751d37e4c9b"), false);
  assert.equal(isValidUuid("not-a-session"), false);
  assert.equal(isValidUuid(null), false);
});

test("video date timeline payload redaction removes sensitive keys and token-like strings", () => {
  assert.deepEqual(
    redactVideoDateTimelineDetail({
      action: "prepare_date_entry",
      token: "should-not-render",
      accessToken: "should-not-render",
      apiKey: "should-not-render",
      nested: {
        Authorization: "Bearer abc",
        request_headers: {
          "x-provider-secret": "should-not-render",
        },
        daily_api_key: "secret",
        video_date_trace_id: "trace-1",
        harmless: ["eyJabc.def.ghi", "ok"],
      },
    }),
    {
      action: "prepare_date_entry",
      token: "[REDACTED]",
      accessToken: "[REDACTED]",
      apiKey: "[REDACTED]",
      nested: {
        Authorization: "[REDACTED]",
        request_headers: "[REDACTED]",
        daily_api_key: "[REDACTED]",
        video_date_trace_id: "trace-1",
        harmless: ["[REDACTED]", "ok"],
      },
    },
  );
});

test("video date timeline rows are ordered and trace ids are extractable", () => {
  const rows = safeVideoDateTimelineRows([
    {
      timeline_seq: 2,
      occurred_at: "2026-04-28T22:24:11Z",
      source: "event_loop_observability_events",
      operation: "create_date_room_token_issued",
      outcome: "success",
      reason_code: "token_issued",
      event_id: "event-1",
      actor_id: "actor-1",
      session_id: "session-1",
      detail: { token: "secret", entry_attempt_id: "attempt-1", video_date_trace_id: "attempt-1" },
    },
    {
      timeline_seq: 3,
      occurred_at: "2026-04-28T22:24:12Z",
      source: "event_loop_observability_events",
      operation: "video_date_client_stuck_state",
      outcome: "timeout",
      reason_code: "peer_missing_terminal",
      event_id: "event-1",
      actor_id: "actor-1",
      session_id: "session-1",
      detail: {
        client_event_name: "peer_missing_terminal",
        source_surface: "video_date_daily",
        access_token: "secret",
      },
    },
    {
      timeline_seq: 3,
      occurred_at: "not-a-timestamp",
      source: "event_loop_observability_events",
      operation: "invalid_timestamp_row",
      outcome: "success",
      reason_code: null,
      event_id: "event-1",
      actor_id: "actor-1",
      session_id: "session-1",
      detail: {},
    },
    {
      timeline_seq: 1,
      occurred_at: "2026-04-28T22:24:10Z",
      source: "event_loop_observability_events",
      operation: "ready_gate_transition",
      outcome: "success",
      reason_code: "mark_ready",
      event_id: "event-1",
      actor_id: "actor-1",
      session_id: "session-1",
      detail: { action: "mark_ready" },
    },
  ]);

  assert.equal(rows[0].operation, "ready_gate_transition");
  assert.equal(rows[1].operation, "create_date_room_token_issued");
  assert.equal(rows[2].operation, "video_date_client_stuck_state");
  assert.equal(rows[3].operation, "invalid_timestamp_row");
  assert.deepEqual(extractVideoDateTimelineTraceIds(rows[1].detail), {
    entryAttemptId: "attempt-1",
    videoDateTraceId: "attempt-1",
  });
  assert.equal((rows[1].detail as Record<string, unknown>).token, "[REDACTED]");
  assert.equal((rows[2].detail as Record<string, unknown>).access_token, "[REDACTED]");
});
