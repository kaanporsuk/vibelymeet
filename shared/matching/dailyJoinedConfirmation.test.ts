import test from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_JOINED_CONFIRMATION_RETRY_DELAYS_MS,
  isRetryableDailyJoinedConfirmationFailure,
  markDailyJoinedWithBackoff,
} from "./dailyJoinedConfirmation";

test("daily joined confirmation succeeds without retry when RPC succeeds", async () => {
  let attempts = 0;
  const result = await markDailyJoinedWithBackoff({
    confirm: async () => {
      attempts += 1;
      return { ok: true };
    },
    sleep: async () => {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 1);
  assert.equal(attempts, 1);
});

test("daily joined confirmation retries bounded transient false responses", async () => {
  const delays: number[] = [];
  const reports: { attempt: number; willRetry: boolean }[] = [];
  const result = await markDailyJoinedWithBackoff({
    retryDelaysMs: [5, 10],
    confirm: async (attempt) => (attempt < 3 ? { ok: false, code: "rpc_error" } : { ok: true }),
    sleep: async (ms) => {
      delays.push(ms);
    },
    onAttemptResult: ({ attempt, willRetry }) => {
      reports.push({ attempt, willRetry });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.deepEqual(delays, [5, 10]);
  assert.deepEqual(reports, [
    { attempt: 1, willRetry: true },
    { attempt: 2, willRetry: true },
    { attempt: 3, willRetry: false },
  ]);
});

test("daily joined confirmation does not retry terminal server responses", async () => {
  let attempts = 0;
  const result = await markDailyJoinedWithBackoff({
    confirm: async () => {
      attempts += 1;
      return { ok: false, code: "session_ended" };
    },
    sleep: async () => {
      throw new Error("should not sleep");
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.retryable, false);
  assert.equal(result.attempts, 1);
  assert.equal(attempts, 1);
});

test("daily joined confirmation default retry budget is finite", async () => {
  let attempts = 0;
  const result = await markDailyJoinedWithBackoff({
    confirm: async () => {
      attempts += 1;
      return { ok: false, code: "rpc_error" };
    },
    sleep: async () => {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.exhausted, true);
  assert.equal(attempts, DAILY_JOINED_CONFIRMATION_RETRY_DELAYS_MS.length + 1);
});

test("daily joined confirmation classifies only unknown or transient failures as retryable", () => {
  assert.equal(isRetryableDailyJoinedConfirmationFailure({ ok: false, code: "not_found" }), false);
  assert.equal(isRetryableDailyJoinedConfirmationFailure({ ok: false, code: "rpc_error" }), true);
  assert.equal(isRetryableDailyJoinedConfirmationFailure({ ok: false, retryable: false }), false);
});
