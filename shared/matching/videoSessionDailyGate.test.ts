import test from "node:test";
import assert from "node:assert/strict";
import { canAttemptDailyRoomFromVideoSessionTruth } from "./activeSession";

const NOW_MS = Date.parse("2026-04-24T00:33:00.000Z");

test("ready_gate + ready does not allow Daily room attempts", () => {
  assert.equal(
    canAttemptDailyRoomFromVideoSessionTruth(
      {
        ended_at: null,
        state: "ready_gate",
        handshake_started_at: null,
        ready_gate_status: "ready",
        ready_gate_expires_at: "2026-04-24T00:33:10.000Z",
      },
      NOW_MS,
    ),
    false,
  );
});

test("ready_gate + both_ready + future expiry allows Daily room attempts", () => {
  assert.equal(
    canAttemptDailyRoomFromVideoSessionTruth(
      {
        ended_at: null,
        state: "ready_gate",
        handshake_started_at: null,
        ready_gate_status: "both_ready",
        ready_gate_expires_at: "2026-04-24T00:33:10.000Z",
      },
      NOW_MS,
    ),
    true,
  );
});

test("handshake state allows Daily room attempts", () => {
  assert.equal(
    canAttemptDailyRoomFromVideoSessionTruth(
      {
        ended_at: null,
        state: "handshake",
        handshake_started_at: null,
        ready_gate_status: "ready",
        ready_gate_expires_at: null,
      },
      NOW_MS,
    ),
    true,
  );
});

test("date state allows Daily room attempts", () => {
  assert.equal(
    canAttemptDailyRoomFromVideoSessionTruth(
      {
        ended_at: null,
        state: "date",
        handshake_started_at: null,
        ready_gate_status: "ready",
        ready_gate_expires_at: null,
      },
      NOW_MS,
    ),
    true,
  );
});

test("handshake_started_at allows Daily room attempts", () => {
  assert.equal(
    canAttemptDailyRoomFromVideoSessionTruth(
      {
        ended_at: null,
        state: "ready_gate",
        handshake_started_at: "2026-04-24T00:32:50.000Z",
        ready_gate_status: "ready",
        ready_gate_expires_at: null,
      },
      NOW_MS,
    ),
    true,
  );
});

test("ended_at blocks Daily room attempts", () => {
  assert.equal(
    canAttemptDailyRoomFromVideoSessionTruth(
      {
        ended_at: "2026-04-24T00:33:05.000Z",
        state: "handshake",
        handshake_started_at: "2026-04-24T00:32:50.000Z",
        ready_gate_status: "both_ready",
        ready_gate_expires_at: "2026-04-24T00:33:10.000Z",
      },
      NOW_MS,
    ),
    false,
  );
});

test("expired both_ready gate does not allow Daily room attempts", () => {
  assert.equal(
    canAttemptDailyRoomFromVideoSessionTruth(
      {
        ended_at: null,
        state: "ready_gate",
        handshake_started_at: null,
        ready_gate_status: "both_ready",
        ready_gate_expires_at: "2026-04-24T00:32:59.000Z",
      },
      NOW_MS,
    ),
    false,
  );
});
