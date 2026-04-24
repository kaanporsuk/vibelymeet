import test from "node:test";
import assert from "node:assert/strict";
import { shouldPreservePrejoinAttemptOnCleanup, type PrejoinAttemptStep } from "./videoDatePrejoinAttempt";

test("prejoin cleanup preserves server-mutating and Daily acquisition steps", () => {
  const preservingSteps: PrejoinAttemptStep[] = [
    "enter_handshake",
    "refetch_video_session",
    "daily_room_truth_guard",
    "daily_room_guard",
    "daily_room",
    "daily_join",
  ];

  for (const step of preservingSteps) {
    assert.equal(shouldPreservePrejoinAttemptOnCleanup(step), true, step);
  }
});

test("prejoin cleanup can release the latch before server mutation starts", () => {
  const releasableSteps: PrejoinAttemptStep[] = [
    "effect_started",
    "initial_state",
    "permissions",
    "truth_fetch",
    "handshake_guard",
  ];

  for (const step of releasableSteps) {
    assert.equal(shouldPreservePrejoinAttemptOnCleanup(step), false, step);
  }
});
