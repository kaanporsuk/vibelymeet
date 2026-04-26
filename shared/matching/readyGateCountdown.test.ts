import test from "node:test";
import assert from "node:assert/strict";
import {
  getReadyGateCountdownProgress,
  getReadyGateRemainingSeconds,
  parseReadyGateExpiryMs,
  READY_GATE_DEFAULT_TIMEOUT_SECONDS,
} from "./readyGateCountdown";

const NOW_MS = Date.parse("2026-04-26T12:00:00.000Z");

test("future server expiry returns remaining seconds", () => {
  assert.equal(
    getReadyGateRemainingSeconds({
      expiresAt: "2026-04-26T12:00:10.000Z",
      fallbackDeadlineMs: NOW_MS + 30_000,
      nowMs: NOW_MS,
    }),
    10,
  );
});

test("past server expiry returns zero", () => {
  assert.equal(
    getReadyGateRemainingSeconds({
      expiresAt: "2026-04-26T11:59:59.000Z",
      fallbackDeadlineMs: NOW_MS + 30_000,
      nowMs: NOW_MS,
    }),
    0,
  );
});

test("missing expiry falls back to local deadline", () => {
  assert.equal(
    getReadyGateRemainingSeconds({
      expiresAt: null,
      fallbackDeadlineMs: NOW_MS + 23_500,
      nowMs: NOW_MS,
    }),
    24,
  );
});

test("invalid expiry falls back safely", () => {
  assert.equal(
    getReadyGateRemainingSeconds({
      expiresAt: "not-a-date",
      fallbackDeadlineMs: NOW_MS + 7_000,
      nowMs: NOW_MS,
    }),
    7,
  );
});

test("missing expiry and deadline fall back to the default contract", () => {
  assert.equal(
    getReadyGateRemainingSeconds({
      expiresAt: undefined,
      fallbackDeadlineMs: Number.NaN,
      nowMs: NOW_MS,
    }),
    READY_GATE_DEFAULT_TIMEOUT_SECONDS,
  );
});

test("expiry parser accepts valid epoch milliseconds and rejects invalid values", () => {
  assert.equal(parseReadyGateExpiryMs(NOW_MS), NOW_MS);
  assert.equal(parseReadyGateExpiryMs(""), null);
  assert.equal(parseReadyGateExpiryMs("nope"), null);
});

test("countdown progress is clamped", () => {
  assert.equal(getReadyGateCountdownProgress(15, 30), 0.5);
  assert.equal(getReadyGateCountdownProgress(60, 30), 1);
  assert.equal(getReadyGateCountdownProgress(-3, 30), 0);
  assert.equal(getReadyGateCountdownProgress(10, 0), 0);
});
