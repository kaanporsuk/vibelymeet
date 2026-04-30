import test from "node:test";
import assert from "node:assert/strict";
import {
  VIDEO_DATE_ENTRY_HANDOFF_RETRY_DELAYS_MS,
  VIDEO_DATE_ENTRY_HANDOFF_SLOW_WAIT_MS,
  getVideoDateEntryHandoffStatusCopy,
  getVideoDateEntryHandoffMaxAttempts,
  shouldRetryVideoDateEntryHandoffFailure,
} from "./videoDateEntryRetryPolicy";

test("video date entry handoff policy centralizes retry timing", () => {
  assert.equal(VIDEO_DATE_ENTRY_HANDOFF_SLOW_WAIT_MS, 3_000);
  assert.deepEqual([...VIDEO_DATE_ENTRY_HANDOFF_RETRY_DELAYS_MS], [1_000, 2_000, 4_000, 8_000]);
  assert.equal(getVideoDateEntryHandoffMaxAttempts(), 5);
});

test("video date entry handoff retries only transient prepare failures", () => {
  assert.equal(shouldRetryVideoDateEntryHandoffFailure({ code: "READY_GATE_NOT_READY" }), true);
  assert.equal(shouldRetryVideoDateEntryHandoffFailure({ code: "EVENT_NOT_ACTIVE" }), false);
  assert.equal(shouldRetryVideoDateEntryHandoffFailure({ code: "DAILY_PROVIDER_UNAVAILABLE" }), true);
  assert.equal(shouldRetryVideoDateEntryHandoffFailure({ code: "ACCESS_DENIED", retryable: false }), false);
  assert.equal(shouldRetryVideoDateEntryHandoffFailure({ httpStatus: 502 }), true);
  assert.equal(shouldRetryVideoDateEntryHandoffFailure({ httpStatus: 403 }), false);
});

test("video date entry handoff exposes calm shared status copy", () => {
  assert.equal(getVideoDateEntryHandoffStatusCopy("preparing").title, "Joining your date...");
  assert.equal(getVideoDateEntryHandoffStatusCopy("slow").title, "Holding your date...");
  assert.equal(getVideoDateEntryHandoffStatusCopy("retrying").title, "Retrying connection...");
  assert.deepEqual(getVideoDateEntryHandoffStatusCopy("failed", "Try again in a moment."), {
    title: "Connection needs a retry",
    body: "Try again in a moment.",
  });
});
