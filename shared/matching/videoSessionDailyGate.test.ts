import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_SESSION_DATE_BASE_SECONDS,
  ACTIVE_SESSION_DATE_STALE_BUFFER_SECONDS,
  ACTIVE_SESSION_HANDSHAKE_FRESH_MS,
  activeSessionDirectFallbackStaleReason,
  canAttemptDailyRoomFromVideoSessionTruth,
  canPrepareDailyRoomFromReadyGateTruth,
  decideVideoSessionRouteFromTruth,
  isActiveSessionDirectFallbackFresh,
  pickRecoverablePendingPostDateSurveySession,
  videoSessionHasPostDateSurveyTruth,
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

test("ready_gate + both_ready + future expiry allows prepare but not Daily join", () => {
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

for (const status of ["ready", "ready_a", "ready_b", "snoozed"] as const) {
  test(`ready gate status ${status} without expiry is not routeable`, () => {
    assert.equal(
      decideVideoSessionRouteFromTruth(
        {
          ended_at: null,
          state: "ready_gate",
          handshake_started_at: null,
          ready_gate_status: status,
          ready_gate_expires_at: null,
        },
        NOW_MS,
      ),
      "stay_lobby",
    );
  });

  test(`ready gate status ${status} with elapsed expiry is not routeable`, () => {
    assert.equal(
      decideVideoSessionRouteFromTruth(
        {
          ended_at: null,
          state: "ready_gate",
          handshake_started_at: null,
          ready_gate_status: status,
          ready_gate_expires_at: "2026-04-24T00:32:59.000Z",
        },
        NOW_MS,
      ),
      "stay_lobby",
    );
  });
}

test("both_ready without provider metadata is date-owned even without Ready Gate expiry", () => {
  assert.equal(
    decideVideoSessionRouteFromTruth(
      {
        ended_at: null,
        state: "ready_gate",
        handshake_started_at: null,
        ready_gate_status: "both_ready",
        ready_gate_expires_at: null,
      },
      NOW_MS,
    ),
    "navigate_date",
  );
  assert.equal(
    canAttemptDailyRoomFromVideoSessionTruth(
      {
        ended_at: null,
        state: "ready_gate",
        handshake_started_at: null,
        ready_gate_status: "both_ready",
        ready_gate_expires_at: null,
      },
      NOW_MS,
    ),
    false,
  );
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

test("terminal state or phase blocks Daily room attempts even if ended_at is missing", () => {
  assert.equal(
    canAttemptDailyRoomFromVideoSessionTruth(
      {
        ended_at: null,
        ...PROVIDER_ROOM,
        state: "date",
        phase: "ended",
        handshake_started_at: "2026-04-24T00:32:50.000Z",
        ready_gate_status: "both_ready",
        ready_gate_expires_at: "2026-04-24T00:33:10.000Z",
      },
      NOW_MS,
    ),
    false,
  );
  assert.equal(
    canPrepareDailyRoomFromReadyGateTruth(
      {
        ended_at: null,
        state: "ended",
        phase: "ended",
        handshake_started_at: null,
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

test("date-entry owner keeps both_ready on date while provider metadata is prepared", () => {
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
      decision: "navigate_date",
      canAttemptDaily: false,
      routedTo: "date",
    },
  );
});

test("date-entry owner keeps expired both_ready on date recovery until server terminal truth arrives", () => {
  assert.deepEqual(
    dateEntryOwnerRoute({
      ended_at: null,
      state: "ready_gate",
      handshake_started_at: null,
      ready_gate_status: "both_ready",
      ready_gate_expires_at: "2026-04-24T00:32:59.000Z",
    }),
    {
      decision: "navigate_date",
      canAttemptDaily: false,
      routedTo: "date",
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

test("date-entry owner keeps partial Daily join recoverable on date route", () => {
  assert.deepEqual(
    dateEntryOwnerRoute({
      ended_at: null,
      ...PROVIDER_ROOM,
      state: "handshake",
      phase: "handshake",
      handshake_started_at: "2026-04-24T00:32:10.000Z",
      ready_gate_status: "both_ready",
      ready_gate_expires_at: "2026-04-24T00:32:20.000Z",
      participant_1_joined_at: "2026-04-24T00:32:15.000Z",
      participant_2_joined_at: null,
    }),
    {
      decision: "navigate_date",
      canAttemptDaily: true,
      routedTo: "date",
    },
  );
});

test("date-entry owner treats peer late join as same recoverable date route", () => {
  assert.deepEqual(
    dateEntryOwnerRoute({
      ended_at: null,
      ...PROVIDER_ROOM,
      state: "handshake",
      phase: "handshake",
      handshake_started_at: "2026-04-24T00:32:10.000Z",
      ready_gate_status: "both_ready",
      ready_gate_expires_at: "2026-04-24T00:32:20.000Z",
      participant_1_joined_at: "2026-04-24T00:32:15.000Z",
      participant_2_joined_at: "2026-04-24T00:32:45.000Z",
    }),
    {
      decision: "navigate_date",
      canAttemptDaily: true,
      routedTo: "date",
    },
  );
});

test("date-entry owner reports partial-join terminal as ended, not ready gate", () => {
  assert.deepEqual(
    dateEntryOwnerRoute({
      ended_at: "2026-04-24T00:34:00.000Z",
      ended_reason: "partial_join_peer_timeout",
      ...PROVIDER_ROOM,
      state: "ended",
      phase: "ended",
      handshake_started_at: "2026-04-24T00:32:10.000Z",
      date_started_at: null,
      ready_gate_status: "both_ready",
      ready_gate_expires_at: "2026-04-24T00:32:20.000Z",
      participant_1_joined_at: "2026-04-24T00:32:15.000Z",
      participant_2_joined_at: null,
    }),
    {
      decision: "ended",
      canAttemptDaily: false,
      routedTo: "ended",
    },
  );
});

test("pending survey recovery returns ended date session when current user has no feedback", () => {
  const row = {
    id: "session-1",
    event_id: "event-1",
    participant_1_id: "user-1",
    participant_2_id: "user-2",
    ended_at: "2026-04-24T00:32:00.000Z",
    ended_reason: "completed",
    date_started_at: "2026-04-24T00:27:00.000Z",
    participant_1_remote_seen_at: "2026-04-24T00:26:55.000Z",
    participant_2_remote_seen_at: "2026-04-24T00:26:56.000Z",
  };

  assert.equal(videoSessionHasRecoverablePostDateSurveyTruth(row, NOW_MS), true);
  assert.equal(
    pickRecoverablePendingPostDateSurveySession([row], new Set<string>(), "user-1", NOW_MS),
    row,
  );
});

test("pending survey recovery includes post-encounter partner absence endings", () => {
  const row = {
    id: "session-1",
    event_id: "event-1",
    participant_1_id: "user-1",
    participant_2_id: "user-2",
    ended_at: "2026-04-24T00:32:00.000Z",
    ended_reason: "partner_absent_after_confirmed_encounter",
    date_started_at: "2026-04-24T00:27:00.000Z",
    participant_1_remote_seen_at: "2026-04-24T00:26:55.000Z",
    participant_2_remote_seen_at: "2026-04-24T00:26:56.000Z",
  };

  assert.equal(videoSessionHasPostDateSurveyTruth(row), true);
  assert.equal(videoSessionHasRecoverablePostDateSurveyTruth(row, NOW_MS), true);
  assert.equal(
    pickRecoverablePendingPostDateSurveySession([row], new Set<string>(), "user-2", NOW_MS),
    row,
  );
});

test("pending survey recovery hides ended date sessions after 24 hours", () => {
  const row = {
    id: "session-1",
    event_id: "event-1",
    participant_1_id: "user-1",
    participant_2_id: "user-2",
    ended_at: "2026-04-22T23:32:59.000Z",
    ended_reason: "completed",
    date_started_at: "2026-04-22T23:27:00.000Z",
    participant_1_remote_seen_at: "2026-04-22T23:26:55.000Z",
    participant_2_remote_seen_at: "2026-04-22T23:26:56.000Z",
  };

  assert.equal(videoSessionHasPostDateSurveyTruth(row), true);
  assert.equal(videoSessionHasRecoverablePostDateSurveyTruth(row, NOW_MS), false);
  assert.equal(
    pickRecoverablePendingPostDateSurveySession([row], new Set<string>(), "user-1", NOW_MS),
    null,
  );
});

test("pending survey recovery skips ended date session once current user has feedback", () => {
  const row = {
    id: "session-1",
    event_id: "event-1",
    participant_1_id: "user-1",
    participant_2_id: "user-2",
    ended_at: "2026-04-24T00:32:00.000Z",
    ended_reason: "completed",
    date_started_at: "2026-04-24T00:27:00.000Z",
    participant_1_remote_seen_at: "2026-04-24T00:26:55.000Z",
    participant_2_remote_seen_at: "2026-04-24T00:26:56.000Z",
  };

  assert.equal(
    pickRecoverablePendingPostDateSurveySession([row], new Set(["session-1"]), "user-1", NOW_MS),
    null,
  );
});

test("pending survey recovery does not expose sessions to nonparticipants", () => {
  const row = {
    id: "session-1",
    event_id: "event-1",
    participant_1_id: "user-1",
    participant_2_id: "user-2",
    ended_at: "2026-04-24T00:32:00.000Z",
    ended_reason: "completed",
    date_started_at: "2026-04-24T00:27:00.000Z",
    participant_1_remote_seen_at: "2026-04-24T00:26:55.000Z",
    participant_2_remote_seen_at: "2026-04-24T00:26:56.000Z",
  };

  assert.equal(
    pickRecoverablePendingPostDateSurveySession([row], new Set<string>(), "user-3", NOW_MS),
    null,
  );
});

test("pending survey recovery preserves reconnect-grace survey behavior", () => {
  const row = {
    id: "session-1",
    event_id: "event-1",
    participant_1_id: "user-1",
    participant_2_id: "user-2",
    ended_at: "2026-04-24T00:32:00.000Z",
    ended_reason: "reconnect_grace_expired",
    date_started_at: "2026-04-24T00:27:00.000Z",
    participant_1_remote_seen_at: "2026-04-24T00:26:55.000Z",
    participant_2_remote_seen_at: "2026-04-24T00:26:56.000Z",
  };

  assert.equal(videoSessionHasRecoverablePostDateSurveyTruth(row, NOW_MS), true);
  assert.equal(
    pickRecoverablePendingPostDateSurveySession([row], new Set<string>(), "user-2", NOW_MS),
    row,
  );
});

test("pending survey recovery ignores date_started_at without bilateral remote video evidence", () => {
  const row = {
    id: "session-1",
    event_id: "event-1",
    participant_1_id: "user-1",
    participant_2_id: "user-2",
    ended_at: "2026-04-24T00:32:00.000Z",
    ended_reason: "completed",
    date_started_at: "2026-04-24T00:27:00.000Z",
    participant_1_remote_seen_at: "2026-04-24T00:26:55.000Z",
    participant_2_remote_seen_at: null,
  };

  assert.equal(videoSessionHasRecoverablePostDateSurveyTruth(row, NOW_MS), false);
  assert.equal(
    pickRecoverablePendingPostDateSurveySession([row], new Set<string>(), "user-1", NOW_MS),
    null,
  );
});

test("pending survey recovery ignores both-joined handshake timeout without bilateral remote video", () => {
  const row = {
    id: "session-1",
    event_id: "event-1",
    participant_1_id: "user-1",
    participant_2_id: "user-2",
    ended_at: "2026-04-24T00:32:00.000Z",
    ended_reason: "handshake_timeout",
    date_started_at: null,
    participant_1_joined_at: "2026-04-24T00:30:01.000Z",
    participant_2_joined_at: "2026-04-24T00:30:02.000Z",
    participant_1_remote_seen_at: null,
    participant_2_remote_seen_at: null,
    state: "ended",
    phase: "ended",
  };

  assert.equal(videoSessionHasRecoverablePostDateSurveyTruth(row, NOW_MS), false);
  assert.equal(
    pickRecoverablePendingPostDateSurveySession([row], new Set<string>(), "user-1", NOW_MS),
    null,
  );
});

test("pending survey recovery returns bilateral remote-seen handshake timeout as established encounter", () => {
  const row = {
    id: "session-1",
    event_id: "event-1",
    participant_1_id: "user-1",
    participant_2_id: "user-2",
    ended_at: "2026-04-24T00:32:00.000Z",
    ended_reason: "handshake_timeout",
    date_started_at: null,
    participant_1_joined_at: "2026-04-24T00:30:01.000Z",
    participant_2_joined_at: "2026-04-24T00:30:02.000Z",
    participant_1_remote_seen_at: "2026-04-24T00:30:03.000Z",
    participant_2_remote_seen_at: "2026-04-24T00:30:04.000Z",
    state: "ended",
    phase: "ended",
  };

  assert.equal(videoSessionHasRecoverablePostDateSurveyTruth(row, NOW_MS), true);
  assert.equal(
    pickRecoverablePendingPostDateSurveySession([row], new Set<string>(), "user-1", NOW_MS),
    row,
  );
});

test("pending survey recovery ignores both-joined non-mutual warm-up without bilateral remote video", () => {
  const row = {
    id: "session-1",
    event_id: "event-1",
    participant_1_id: "user-1",
    participant_2_id: "user-2",
    ended_at: "2026-04-24T00:32:00.000Z",
    ended_reason: "handshake_not_mutual",
    date_started_at: null,
    participant_1_joined_at: "2026-04-24T00:30:01.000Z",
    participant_2_joined_at: "2026-04-24T00:30:02.000Z",
    participant_1_remote_seen_at: "2026-04-24T00:30:03.000Z",
    participant_2_remote_seen_at: null,
    state: "ended",
    phase: "ended",
  };

  assert.equal(videoSessionHasRecoverablePostDateSurveyTruth(row, NOW_MS), false);
  assert.equal(
    pickRecoverablePendingPostDateSurveySession([row], new Set<string>(), "user-2", NOW_MS),
    null,
  );
});

test("pending survey recovery ignores ready-gate terminal sessions", () => {
  const row = {
    id: "session-1",
    event_id: "event-1",
    participant_1_id: "user-1",
    participant_2_id: "user-2",
    ended_at: "2026-04-24T00:32:00.000Z",
    ended_reason: "ready_gate_expired",
    date_started_at: null,
    participant_1_joined_at: null,
    participant_2_joined_at: null,
  };

  assert.equal(videoSessionHasRecoverablePostDateSurveyTruth(row, NOW_MS), false);
  assert.equal(
    pickRecoverablePendingPostDateSurveySession([row], new Set<string>(), "user-1", NOW_MS),
    null,
  );
});

test("pending survey recovery ignores partial Daily join peer timeout", () => {
  const row = {
    id: "session-1",
    event_id: "event-1",
    participant_1_id: "user-1",
    participant_2_id: "user-2",
    ended_at: "2026-04-24T00:32:00.000Z",
    ended_reason: "partial_join_peer_timeout",
    date_started_at: null,
  };

  assert.equal(videoSessionHasRecoverablePostDateSurveyTruth(row, NOW_MS), false);
  assert.equal(
    pickRecoverablePendingPostDateSurveySession([row], new Set<string>(), "user-1", NOW_MS),
    null,
  );
});

test("active-session direct fallback keeps fresh live date rows visible", () => {
  const row = {
    ended_at: null,
    state: "date",
    phase: "date",
    handshake_started_at: "2026-04-24T00:29:00.000Z",
    date_started_at: "2026-04-24T00:30:00.000Z",
    date_extra_seconds: 0,
    ...PROVIDER_ROOM,
  };

  assert.equal(canAttemptDailyRoomFromVideoSessionTruth(row, NOW_MS), true);
  assert.equal(isActiveSessionDirectFallbackFresh(row, NOW_MS), true);
  assert.equal(activeSessionDirectFallbackStaleReason(row, NOW_MS), null);
});

test("active-session direct fallback honors exact server date timeout budget", () => {
  const maxAgeSeconds = ACTIVE_SESSION_DATE_BASE_SECONDS + ACTIVE_SESSION_DATE_STALE_BUFFER_SECONDS;
  const row = {
    ended_at: null,
    state: "date",
    phase: "date",
    handshake_started_at: "2026-04-24T00:27:00.000Z",
    date_started_at: new Date(NOW_MS - (maxAgeSeconds - 1) * 1000).toISOString(),
    date_extra_seconds: 0,
    ...PROVIDER_ROOM,
  };

  assert.equal(isActiveSessionDirectFallbackFresh(row, NOW_MS), true);

  const expiredAtBoundary = {
    ...row,
    date_started_at: new Date(NOW_MS - maxAgeSeconds * 1000).toISOString(),
  };
  assert.equal(isActiveSessionDirectFallbackFresh(expiredAtBoundary, NOW_MS), false);
  assert.equal(activeSessionDirectFallbackStaleReason(expiredAtBoundary, NOW_MS), "direct_video_session_fallback_stale");
});

test("active-session direct fallback includes extra credit seconds in date timeout budget", () => {
  const maxAgeSeconds =
    ACTIVE_SESSION_DATE_BASE_SECONDS + 120 + ACTIVE_SESSION_DATE_STALE_BUFFER_SECONDS;
  const row = {
    ended_at: null,
    state: "date",
    phase: "date",
    handshake_started_at: "2026-04-24T00:25:00.000Z",
    date_started_at: new Date(NOW_MS - (maxAgeSeconds - 1) * 1000).toISOString(),
    date_extra_seconds: 120,
    ...PROVIDER_ROOM,
  };

  assert.equal(isActiveSessionDirectFallbackFresh(row, NOW_MS), true);

  const expiredAtBoundary = {
    ...row,
    date_started_at: new Date(NOW_MS - maxAgeSeconds * 1000).toISOString(),
  };
  assert.equal(isActiveSessionDirectFallbackFresh(expiredAtBoundary, NOW_MS), false);
});

test("active-session direct fallback suppresses stale non-ended date rows", () => {
  const row = {
    ended_at: null,
    state: "date",
    phase: "date",
    handshake_started_at: "2026-04-24T00:10:00.000Z",
    date_started_at: "2026-04-24T00:20:00.000Z",
    date_extra_seconds: 0,
    ...PROVIDER_ROOM,
  };

  assert.equal(canAttemptDailyRoomFromVideoSessionTruth(row, NOW_MS), true);
  assert.equal(isActiveSessionDirectFallbackFresh(row, NOW_MS), false);
  assert.equal(activeSessionDirectFallbackStaleReason(row, NOW_MS), "direct_video_session_fallback_stale");
});

test("active-session direct fallback suppresses handshake at the 90 second warmup boundary", () => {
  const row = {
    ended_at: null,
    state: "handshake",
    phase: "handshake",
    handshake_started_at: new Date(NOW_MS - ACTIVE_SESSION_HANDSHAKE_FRESH_MS + 1000).toISOString(),
    ...PROVIDER_ROOM,
  };

  assert.equal(isActiveSessionDirectFallbackFresh(row, NOW_MS), true);

  const expiredAtBoundary = {
    ...row,
    handshake_started_at: new Date(NOW_MS - ACTIVE_SESSION_HANDSHAKE_FRESH_MS).toISOString(),
  };
  assert.equal(isActiveSessionDirectFallbackFresh(expiredAtBoundary, NOW_MS), false);
  assert.equal(activeSessionDirectFallbackStaleReason(expiredAtBoundary, NOW_MS), "direct_video_session_fallback_stale");
});

test("active-session direct fallback allows active reconnect grace", () => {
  const row = {
    ended_at: null,
    state: "date",
    phase: "date",
    handshake_started_at: "2026-04-24T00:10:00.000Z",
    date_started_at: "2026-04-24T00:20:00.000Z",
    reconnect_grace_ends_at: "2026-04-24T00:33:30.000Z",
    ...PROVIDER_ROOM,
  };

  assert.equal(isActiveSessionDirectFallbackFresh(row, NOW_MS), true);
  assert.equal(activeSessionDirectFallbackStaleReason(row, NOW_MS), null);
});

test("active-session direct fallback suppresses stale handshake rows", () => {
  const row = {
    ended_at: null,
    state: "handshake",
    phase: "handshake",
    handshake_started_at: "2026-04-24T00:30:30.000Z",
    ...PROVIDER_ROOM,
  };

  assert.equal(canAttemptDailyRoomFromVideoSessionTruth(row, NOW_MS), true);
  assert.equal(isActiveSessionDirectFallbackFresh(row, NOW_MS), false);
  assert.equal(activeSessionDirectFallbackStaleReason(row, NOW_MS), "direct_video_session_fallback_stale");
});
