import test from "node:test";
import assert from "node:assert/strict";
import {
  canAttemptDailyRoomFromVideoSessionTruth,
  canPrepareDailyRoomFromReadyGateTruth,
  decideVideoSessionRouteFromTruth,
  pickRecoverablePendingPostDateSurveySession,
  videoSessionHasRecoverablePostDateSurveyTruth,
} from "./activeSession";

const NOW_MS = Date.parse("2026-04-24T00:33:00.000Z");
const PROVIDER_ROOM = {
  daily_room_name: "date-session",
  daily_room_url: "https://vibelyapp.daily.co/date-session",
};

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

test("ready_gate + both_ready + future expiry allows prepare but not date entry", () => {
  const row = {
    ended_at: null,
    state: "ready_gate",
    handshake_started_at: null,
    ready_gate_status: "both_ready",
    ready_gate_expires_at: "2026-04-24T00:33:10.000Z",
  };
  assert.equal(
    canAttemptDailyRoomFromVideoSessionTruth(row, NOW_MS),
    false,
  );
  assert.equal(canPrepareDailyRoomFromReadyGateTruth(row, NOW_MS), true);
});

test("handshake state without provider metadata does not allow Daily room attempts", () => {
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
    false,
  );
});

test("provider-prepared handshake state allows Daily room attempts", () => {
  assert.equal(
    canAttemptDailyRoomFromVideoSessionTruth(
      {
        ...PROVIDER_ROOM,
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

test("provider-prepared date state allows Daily room attempts", () => {
  assert.equal(
    canAttemptDailyRoomFromVideoSessionTruth(
      {
        ...PROVIDER_ROOM,
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

test("provider-prepared handshake_started_at allows Daily room attempts", () => {
  assert.equal(
    canAttemptDailyRoomFromVideoSessionTruth(
      {
        ...PROVIDER_ROOM,
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

test("date-entry owner keeps both_ready on Ready Gate until provider metadata is confirmed", () => {
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
      canAttemptDaily: false,
      routedTo: "ready",
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
      ...PROVIDER_ROOM,
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
      ...PROVIDER_ROOM,
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

test("pending survey recovery returns ended date session when current user has no feedback", () => {
  const row = {
    id: "session-1",
    event_id: "event-1",
    participant_1_id: "user-1",
    participant_2_id: "user-2",
    ended_at: "2026-04-24T00:40:00.000Z",
    ended_reason: "completed",
    date_started_at: "2026-04-24T00:35:00.000Z",
  };

  assert.equal(videoSessionHasRecoverablePostDateSurveyTruth(row), true);
  assert.equal(
    pickRecoverablePendingPostDateSurveySession([row], new Set<string>(), "user-1"),
    row,
  );
});

test("pending survey recovery skips ended date session once current user has feedback", () => {
  const row = {
    id: "session-1",
    event_id: "event-1",
    participant_1_id: "user-1",
    participant_2_id: "user-2",
    ended_at: "2026-04-24T00:40:00.000Z",
    ended_reason: "completed",
    date_started_at: "2026-04-24T00:35:00.000Z",
  };

  assert.equal(
    pickRecoverablePendingPostDateSurveySession([row], new Set(["session-1"]), "user-1"),
    null,
  );
});

test("pending survey recovery does not expose sessions to nonparticipants", () => {
  const row = {
    id: "session-1",
    event_id: "event-1",
    participant_1_id: "user-1",
    participant_2_id: "user-2",
    ended_at: "2026-04-24T00:40:00.000Z",
    ended_reason: "completed",
    date_started_at: "2026-04-24T00:35:00.000Z",
  };

  assert.equal(
    pickRecoverablePendingPostDateSurveySession([row], new Set<string>(), "user-3"),
    null,
  );
});

test("pending survey recovery preserves reconnect-grace survey behavior", () => {
  const row = {
    id: "session-1",
    event_id: "event-1",
    participant_1_id: "user-1",
    participant_2_id: "user-2",
    ended_at: "2026-04-24T00:40:00.000Z",
    ended_reason: "reconnect_grace_expired",
    date_started_at: "2026-04-24T00:35:00.000Z",
  };

  assert.equal(videoSessionHasRecoverablePostDateSurveyTruth(row), true);
  assert.equal(
    pickRecoverablePendingPostDateSurveySession([row], new Set<string>(), "user-2"),
    row,
  );
});

test("pending survey recovery ignores pre-date terminal sessions", () => {
  const row = {
    id: "session-1",
    event_id: "event-1",
    participant_1_id: "user-1",
    participant_2_id: "user-2",
    ended_at: "2026-04-24T00:40:00.000Z",
    ended_reason: "handshake_not_mutual",
    date_started_at: "2026-04-24T00:35:00.000Z",
  };

  assert.equal(videoSessionHasRecoverablePostDateSurveyTruth(row), false);
  assert.equal(
    pickRecoverablePendingPostDateSurveySession([row], new Set<string>(), "user-1"),
    null,
  );
});

test("pending survey recovery ignores partial Daily join peer timeout", () => {
  const row = {
    id: "session-1",
    event_id: "event-1",
    participant_1_id: "user-1",
    participant_2_id: "user-2",
    ended_at: "2026-04-24T00:40:00.000Z",
    ended_reason: "partial_join_peer_timeout",
    date_started_at: null,
  };

  assert.equal(videoSessionHasRecoverablePostDateSurveyTruth(row), false);
  assert.equal(
    pickRecoverablePendingPostDateSurveySession([row], new Set<string>(), "user-1"),
    null,
  );
});
