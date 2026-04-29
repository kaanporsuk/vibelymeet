import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVideoDateSignalIdempotencyKey,
  sendVideoDateSignalWithRetry,
} from "./videoDateSignalRetry";

test("video date signal retry derives stable action idempotency keys", () => {
  assert.equal(
    buildVideoDateSignalIdempotencyKey("session-1", "end"),
    "session-1:end",
  );
});

test("video date signal retry retries failed attempts then returns success", async () => {
  let calls = 0;
  const result = await sendVideoDateSignalWithRetry({
    sessionId: "session-1",
    action: "end",
    delaysMs: [0, 1, 1],
    sleep: async () => {},
    operation: async () => {
      calls += 1;
      if (calls < 2) throw new Error("temporary");
      return { success: true };
    },
    isSuccess: (value) => value.success === true,
  });

  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  if (result.ok) assert.equal(result.attempts, 2);
});

