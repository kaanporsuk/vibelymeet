import test from "node:test";
import assert from "node:assert/strict";
import {
  adviseReadyGateTerminalRecovery,
  adviseVideoDateSnapshotRecovery,
  adviseVideoDateTokenRecovery,
  adviseVideoSessionTruthRecovery,
  resolveReadyGateTerminalRecoveryViaAdvisor,
} from "./videoDateRecoveryAdvisor";
import { resolveVideoDateSnapshotRecovery } from "./videoDateTimeline";
import type { VideoDateSnapshotOk } from "./videoDateSnapshot";

const nowMs = Date.parse("2026-05-24T12:00:00.000Z");

const baseSnapshot: VideoDateSnapshotOk = {
  ok: true,
  sessionId: "11111111-1111-4111-8111-111111111111",
  eventId: "22222222-2222-4222-8222-222222222222",
  seq: 8,
  serverNow: nowMs,
  phase: "handshake",
  phaseStartedAt: nowMs - 30_000,
  phaseDeadlineAt: nowMs + 30_000,
  allowedActions: ["continue", "pass", "end_call"],
  participants: [],
  room: {
    name: "date-11111111111141118111111111111111",
    url: "https://example.daily.co/date-11111111111141118111111111111111",
    tokenRequired: true,
  },
  endedReason: null,
  endedAt: null,
};

test("advisor resolves snapshot recovery without leaking token state", () => {
  assert.deepEqual(adviseVideoDateSnapshotRecovery(baseSnapshot), {
    action: "go_date",
    sessionId: baseSnapshot.sessionId,
    eventId: baseSnapshot.eventId,
    reason: "handshake",
    platform: undefined,
    surface: undefined,
  });

  assert.deepEqual(
    adviseVideoDateSnapshotRecovery({
      ...baseSnapshot,
      phase: "ready_gate",
      eventId: null,
      room: null,
    }),
    {
      action: "go_home",
      sessionId: baseSnapshot.sessionId,
      reason: "missing_event",
      platform: undefined,
      surface: undefined,
    },
  );

  assert.deepEqual(adviseVideoDateSnapshotRecovery({ ok: false, error: "network", retryable: true }), {
    action: "retry_snapshot",
    sessionId: null,
    reason: "network",
    retryable: true,
    platform: undefined,
    surface: undefined,
  });
});

test("legacy snapshot recovery adapter delegates to advisor-compatible outcomes", () => {
  assert.deepEqual(resolveVideoDateSnapshotRecovery(baseSnapshot), {
    action: "date",
    sessionId: baseSnapshot.sessionId,
    eventId: baseSnapshot.eventId,
    reason: "handshake",
  });

  assert.deepEqual(
    resolveVideoDateSnapshotRecovery({
      ...baseSnapshot,
      phase: "ended",
      room: null,
      endedAt: nowMs,
      endedReason: "date_timeout",
    }),
    {
      action: "survey",
      sessionId: baseSnapshot.sessionId,
      eventId: baseSnapshot.eventId,
      reason: "terminal_encounter",
    },
  );
});

test("advisor classifies session truth recovery for date, ready gate, terminal, and lobby", () => {
  assert.equal(
    adviseVideoSessionTruthRecovery({
      sessionId: baseSnapshot.sessionId,
      eventId: baseSnapshot.eventId,
      nowMs,
      truth: {
        event_id: baseSnapshot.eventId,
        state: "handshake",
        daily_room_name: "date-room",
        daily_room_url: "https://example.daily.co/date-room",
      },
    }).action,
    "go_date",
  );

  assert.equal(
    adviseVideoSessionTruthRecovery({
      sessionId: baseSnapshot.sessionId,
      eventId: baseSnapshot.eventId,
      nowMs,
      truth: {
        event_id: baseSnapshot.eventId,
        ready_gate_status: "ready",
        ready_gate_expires_at: nowMs + 30_000,
      },
    }).action,
    "go_ready_gate",
  );

  assert.equal(
    adviseVideoSessionTruthRecovery({
      sessionId: baseSnapshot.sessionId,
      eventId: baseSnapshot.eventId,
      nowMs,
      truth: {
        event_id: baseSnapshot.eventId,
        ended_at: new Date(nowMs).toISOString(),
      },
    }).action,
    "show_terminal",
  );

  assert.equal(
    adviseVideoSessionTruthRecovery({
      sessionId: baseSnapshot.sessionId,
      eventId: null,
      nowMs,
      truth: null,
    }).action,
    "go_home",
  );
});

test("advisor wraps Ready Gate terminal recovery while preserving copy and retryability", () => {
  const decision = adviseReadyGateTerminalRecovery({ reason: "ready_gate_event_ended" });
  assert.equal(decision.action, "show_terminal");
  assert.equal(decision.terminalRecovery?.category, "event_ended");
  assert.equal(decision.retryable, false);

  const compatibility = resolveReadyGateTerminalRecoveryViaAdvisor({ reason: "READY_GATE_NOT_READY" });
  assert.equal(compatibility.category, "stale_handoff");
});

test("advisor classifies token refresh without changing timing semantics", () => {
  assert.equal(
    adviseVideoDateTokenRecovery({
      trigger: "before_join",
      tokenExpiresAtIso: new Date(nowMs + 60_000).toISOString(),
      nowMs,
    }).action,
    "refresh_token",
  );

  const scheduled = adviseVideoDateTokenRecovery({
    trigger: "active_refresh_timer",
    tokenExpiresAtIso: new Date(nowMs + 10 * 60_000).toISOString(),
    nowMs,
  });
  assert.equal(scheduled.action, "refresh_token");
  assert.equal(scheduled.retryAfterMs, 5 * 60_000);

  assert.equal(
    adviseVideoDateTokenRecovery({
      trigger: "auth_error",
      error: { errorMsg: "Daily ejected because meeting token expired" },
    }).action,
    "refresh_token",
  );
  assert.equal(
    adviseVideoDateTokenRecovery({
      trigger: "auth_error",
      error: { errorMsg: "Camera permission denied" },
    }).action,
    "stay",
  );
});
