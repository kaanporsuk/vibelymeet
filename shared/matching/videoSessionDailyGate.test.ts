import test from "node:test";
import assert from "node:assert/strict";
import {
  canAttemptDailyRoomFromVideoSessionTruth,
  decideVideoSessionRouteFromTruth,
} from "./activeSession";

const NOW_MS = Date.parse("2026-04-24T00:33:00.000Z");

function dateEntryOwnerRoute(
  row: Parameters<typeof decideVideoSessionRouteFromTruth>[0],
) {
  const decision = decideVideoSessionRouteFromTruth(row, NOW_MS);
  const canAttemptDaily = canAttemptDailyRoomFromVideoSessionTruth(row, NOW_MS);
  const routedTo =
    canAttemptDaily || decision === "navigate_date"
      ? "date"
      : decision === "navigate_ready"
        ? "ready"
        : decision === "ended"
          ? "ended"
          : "lobby";
  return { decision, canAttemptDaily, routedTo };
}

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

test("ready_gate + ready_b does not allow Daily room attempts", () => {
  assert.equal(
    canAttemptDailyRoomFromVideoSessionTruth(
      {
        ended_at: null,
        state: "ready_gate",
        handshake_started_at: null,
        ready_gate_status: "ready_b",
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

test("date-entry owner holds ready_gate + ready on Ready Gate", () => {
  assert.deepEqual(
    dateEntryOwnerRoute({
      ended_at: null,
      state: "ready_gate",
      handshake_started_at: null,
      ready_gate_status: "ready",
      ready_gate_expires_at: "2026-04-24T00:33:10.000Z",
    }),
    {
      decision: "navigate_ready",
      canAttemptDaily: false,
      routedTo: "ready",
    },
  );
});

test("date-entry owner holds ready_gate + ready_b on Ready Gate", () => {
  assert.deepEqual(
    dateEntryOwnerRoute({
      ended_at: null,
      state: "ready_gate",
      handshake_started_at: null,
      ready_gate_status: "ready_b",
      ready_gate_expires_at: "2026-04-24T00:33:10.000Z",
    }),
    {
      decision: "navigate_ready",
      canAttemptDaily: false,
      routedTo: "ready",
    },
  );
});

test("date-entry owner sends both_ready with future expiry to date despite general ready decision", () => {
  assert.deepEqual(
    dateEntryOwnerRoute({
      ended_at: null,
      state: "ready_gate",
      phase: "ready_gate",
      handshake_started_at: null,
      ready_gate_status: "both_ready",
      ready_gate_expires_at: "2026-04-24T00:33:10.000Z",
    }),
    {
      decision: "navigate_ready",
      canAttemptDaily: true,
      routedTo: "date",
    },
  );
});

test("date-entry owner does not send expired both_ready to date", () => {
  assert.deepEqual(
    dateEntryOwnerRoute({
      ended_at: null,
      state: "ready_gate",
      handshake_started_at: null,
      ready_gate_status: "both_ready",
      ready_gate_expires_at: "2026-04-24T00:32:59.000Z",
    }),
    {
      decision: "stay_lobby",
      canAttemptDaily: false,
      routedTo: "lobby",
    },
  );
});

test("date-entry owner sends handshake state to date", () => {
  assert.deepEqual(
    dateEntryOwnerRoute({
      ended_at: null,
      state: "handshake",
      handshake_started_at: null,
      ready_gate_status: "ready",
      ready_gate_expires_at: null,
    }),
    {
      decision: "navigate_date",
      canAttemptDaily: true,
      routedTo: "date",
    },
  );
});

test("date-entry owner sends date state to date", () => {
  assert.deepEqual(
    dateEntryOwnerRoute({
      ended_at: null,
      state: "date",
      handshake_started_at: null,
      ready_gate_status: "ready",
      ready_gate_expires_at: null,
    }),
    {
      decision: "navigate_date",
      canAttemptDaily: true,
      routedTo: "date",
    },
  );
});
