import assert from "node:assert/strict";
import test from "node:test";

import { createVideoDateNavigationIntents } from "./navigationIntents";
import { createVideoDateSessionController } from "./sessionController";
import type {
  VideoDateControllerCommandKind,
  VideoDateControllerSessionSnapshot,
} from "./types";

const SESSION_ID = "session-1";
const PROFILE_ID = "user-a";

function makeController() {
  const intents = createVideoDateNavigationIntents();
  const controller = createVideoDateSessionController({
    sessionId: SESSION_ID,
    profileId: PROFILE_ID,
    intents,
  });
  return { controller, intents };
}

function snapshot(
  overrides: Partial<VideoDateControllerSessionSnapshot> = {},
): VideoDateControllerSessionSnapshot {
  return {
    id: SESSION_ID,
    event_id: "event-1",
    participant_1_id: PROFILE_ID,
    participant_2_id: "user-b",
    daily_room_name: null,
    daily_room_url: null,
    date_started_at: null,
    ended_at: null,
    ended_reason: null,
    entry_started_at: null,
    participant_1_joined_at: null,
    participant_2_joined_at: null,
    participant_1_remote_seen_at: null,
    participant_2_remote_seen_at: null,
    phase: null,
    ready_gate_expires_at: null,
    ready_gate_status: null,
    state: null,
    ...overrides,
  };
}

const READY_GATE_OPEN = snapshot({
  state: "ready_gate",
  ready_gate_status: "ready",
  ready_gate_expires_at: Date.now() + 60_000,
});

const BOTH_READY = snapshot({
  state: "ready_gate",
  ready_gate_status: "both_ready",
});

const ENTRY_TRUTH = snapshot({
  state: "entry",
  entry_started_at: new Date().toISOString(),
  daily_room_name: "date-session-1",
  daily_room_url: "https://vibelyapp.daily.co/date-session-1",
  ready_gate_status: "both_ready",
});

const DATE_TRUTH = snapshot({
  ...ENTRY_TRUTH,
  state: "date",
  date_started_at: new Date().toISOString(),
});

const TERMINAL_SURVEY_TRUTH = snapshot({
  ...DATE_TRUTH,
  state: "ended",
  ended_at: new Date().toISOString(),
  ended_reason: "ended_from_client",
  participant_1_joined_at: new Date().toISOString(),
  participant_2_joined_at: new Date().toISOString(),
  participant_1_remote_seen_at: new Date().toISOString(),
  participant_2_remote_seen_at: new Date().toISOString(),
});

const TERMINAL_NO_SURVEY_TRUTH = snapshot({
  state: "ended",
  ended_at: new Date().toISOString(),
  ended_reason: "ready_gate_expired",
});

const PRE_STABLE_MEDIA_FAILED_TRUTH = snapshot({
  ...TERMINAL_SURVEY_TRUTH,
  ended_reason: "pre_stable_media_failed",
});

function commandKinds(
  effects: ReturnType<
    ReturnType<typeof createVideoDateSessionController>["apply"]
  >,
): VideoDateControllerCommandKind[] {
  return effects.commands.map((command) => command.kind);
}

test("hydrate → ready_gate on active ready-gate truth; route says ready", () => {
  const { controller } = makeController();
  assert.equal(controller.getPhase(), "hydrate");
  const effects = controller.apply({
    kind: "session_snapshot",
    snapshot: READY_GATE_OPEN,
  });
  assert.equal(effects.state, "ready_gate");
  assert.equal(effects.route.target, "ready");
});

test("ready_gate → preparing_entry on both_ready, emits prepare_entry with idempotency key and arms the entry latch", () => {
  const { controller, intents } = makeController();
  controller.apply({ kind: "session_snapshot", snapshot: READY_GATE_OPEN });
  const effects = controller.apply({
    kind: "session_snapshot",
    snapshot: BOTH_READY,
  });
  assert.equal(effects.state, "preparing_entry");
  assert.deepEqual(commandKinds(effects), ["prepare_entry"]);
  assert.ok(effects.commands[0].idempotencyKey, "prepare_entry carries an idempotency key");
  assert.equal(intents.isDateEntryTransitionActive(SESSION_ID), true);

  // While in flight, repeated both_ready truth does not re-emit the command.
  const again = controller.apply({
    kind: "session_snapshot",
    snapshot: BOTH_READY,
  });
  assert.deepEqual(commandKinds(again), []);
});

test("preparing_entry → joining on prepare_entry success, then entry on daily joined with evidence commands", () => {
  const { controller } = makeController();
  controller.apply({ kind: "session_snapshot", snapshot: BOTH_READY });
  const prepared = controller.apply({
    kind: "command_result",
    command: "prepare_entry",
    ok: true,
  });
  assert.equal(prepared.state, "joining");
  assert.deepEqual(commandKinds(prepared), ["daily_join"]);

  const joined = controller.apply({
    kind: "daily",
    event: { kind: "joined", callInstanceId: "ci-1", providerSessionId: "ps-1" },
  });
  assert.equal(joined.state, "entry");
  assert.deepEqual(commandKinds(joined), [
    "mark_daily_joined",
    "start_daily_alive_heartbeat",
  ]);
});

test("entry emits mark_remote_seen exactly once when remote media becomes playable", () => {
  const { controller } = makeController();
  controller.apply({ kind: "session_snapshot", snapshot: ENTRY_TRUTH });
  controller.apply({
    kind: "daily",
    event: { kind: "joined", callInstanceId: "ci-1", providerSessionId: "ps-1" },
  });
  const first = controller.apply({
    kind: "daily",
    event: { kind: "remote_media_playable" },
  });
  assert.deepEqual(commandKinds(first), ["mark_remote_seen"]);
  const second = controller.apply({
    kind: "daily",
    event: { kind: "remote_media_playable" },
  });
  assert.deepEqual(commandKinds(second), []);
});

test("server entry truth without local join → joining with daily_join command", () => {
  const { controller } = makeController();
  const effects = controller.apply({
    kind: "session_snapshot",
    snapshot: ENTRY_TRUTH,
  });
  assert.equal(effects.state, "joining");
  assert.deepEqual(commandKinds(effects), ["daily_join"]);
});

test("entry → date on server date truth (evidence-gated promotion is server-owned)", () => {
  const { controller } = makeController();
  controller.apply({ kind: "session_snapshot", snapshot: ENTRY_TRUTH });
  controller.apply({
    kind: "daily",
    event: { kind: "joined", callInstanceId: "ci-1", providerSessionId: "ps-1" },
  });
  const effects = controller.apply({
    kind: "session_snapshot",
    snapshot: DATE_TRUTH,
  });
  assert.equal(effects.state, "date");
  assert.equal(effects.route.target, "date");
});

test("entry deadline emits complete_entry once; date deadline emits end_date(date_timeout)", () => {
  const { controller } = makeController();
  controller.apply({ kind: "session_snapshot", snapshot: ENTRY_TRUTH });
  controller.apply({
    kind: "daily",
    event: { kind: "joined", callInstanceId: "ci-1", providerSessionId: "ps-1" },
  });
  const entryDeadline = controller.apply({
    kind: "timer",
    event: { kind: "entry_deadline_elapsed" },
  });
  assert.deepEqual(commandKinds(entryDeadline), ["complete_entry"]);
  assert.ok(entryDeadline.commands[0].idempotencyKey);
  const repeated = controller.apply({
    kind: "timer",
    event: { kind: "entry_deadline_elapsed" },
  });
  assert.deepEqual(commandKinds(repeated), [], "in-flight complete_entry deduped");

  controller.apply({
    kind: "command_result",
    command: "complete_entry",
    ok: true,
  });
  controller.apply({ kind: "session_snapshot", snapshot: DATE_TRUTH });
  const dateDeadline = controller.apply({
    kind: "timer",
    event: { kind: "date_deadline_elapsed" },
  });
  assert.equal(dateDeadline.state, "ending");
  assert.deepEqual(commandKinds(dateDeadline), ["end_date"]);
  assert.equal(dateDeadline.commands[0].reason, "date_timeout");
});

test("transport interruption → reconnecting; recovery returns to the prior phase", () => {
  const { controller } = makeController();
  controller.apply({ kind: "session_snapshot", snapshot: DATE_TRUTH });
  const interrupted = controller.apply({
    kind: "daily",
    event: { kind: "transport_interrupted" },
  });
  assert.equal(interrupted.state, "reconnecting");
  assert.equal(interrupted.view.reconnecting, true);
  assert.equal(
    interrupted.route.target,
    "date",
    "reconnecting keeps the date route owned",
  );
  const recovered = controller.apply({
    kind: "daily",
    event: { kind: "transport_recovered" },
  });
  assert.equal(recovered.state, "date");
});

test("remote participant leaving during entry/date → reconnecting; rejoin restores phase; grace expiry ends the date", () => {
  const { controller } = makeController();
  controller.apply({ kind: "session_snapshot", snapshot: DATE_TRUTH });
  const left = controller.apply({
    kind: "daily",
    event: { kind: "remote_participant_left" },
  });
  assert.equal(left.state, "reconnecting");
  const back = controller.apply({
    kind: "daily",
    event: { kind: "remote_participant_joined" },
  });
  assert.equal(back.state, "date");

  controller.apply({
    kind: "daily",
    event: { kind: "remote_participant_left" },
  });
  const graceExpired = controller.apply({
    kind: "timer",
    event: { kind: "reconnect_grace_elapsed" },
  });
  assert.equal(graceExpired.state, "ending");
  assert.deepEqual(commandKinds(graceExpired), ["end_date"]);
});

test("remount parking: parked_for_remount preserves phase; park_consumed restores it (no call-start regression)", () => {
  const { controller } = makeController();
  controller.apply({ kind: "session_snapshot", snapshot: DATE_TRUTH });
  const parked = controller.apply({
    kind: "daily",
    event: { kind: "parked_for_remount" },
  });
  assert.equal(parked.state, "parked_remount");
  assert.deepEqual(
    commandKinds(parked),
    [],
    "parking must not leave or destroy the live call",
  );
  // Server truth during parking still updates the return phase.
  controller.apply({ kind: "session_snapshot", snapshot: DATE_TRUTH });
  const consumed = controller.apply({
    kind: "daily",
    event: { kind: "park_consumed" },
  });
  assert.equal(consumed.state, "date");
});

test("explicit end intent → ending with end_date command; end result reconciles against server truth", () => {
  const { controller } = makeController();
  controller.apply({ kind: "session_snapshot", snapshot: DATE_TRUTH });
  const ending = controller.apply({
    kind: "route_intent",
    intent: { kind: "end_date_requested" },
  });
  assert.equal(ending.state, "ending");
  assert.deepEqual(commandKinds(ending), ["end_date"]);
  const result = controller.apply({
    kind: "command_result",
    command: "end_date",
    ok: true,
  });
  assert.deepEqual(commandKinds(result), ["refetch_snapshot"]);

  const terminal = controller.apply({
    kind: "session_snapshot",
    snapshot: TERMINAL_SURVEY_TRUTH,
  });
  assert.equal(terminal.state, "survey_required");
  assert.equal(terminal.route.target, "survey");
  assert.equal(terminal.route.forceSurvey, true);
});

test("terminal-survey recovery is reachable from every non-terminal state and hard-stops Daily", () => {
  const phases: Array<{
    arrange: (c: ReturnType<typeof makeController>["controller"]) => void;
    from: string;
  }> = [
    { arrange: () => undefined, from: "hydrate" },
    {
      arrange: (c) =>
        void c.apply({ kind: "session_snapshot", snapshot: READY_GATE_OPEN }),
      from: "ready_gate",
    },
    {
      arrange: (c) =>
        void c.apply({ kind: "session_snapshot", snapshot: BOTH_READY }),
      from: "preparing_entry",
    },
    {
      arrange: (c) =>
        void c.apply({ kind: "session_snapshot", snapshot: ENTRY_TRUTH }),
      from: "joining",
    },
    {
      arrange: (c) => {
        c.apply({ kind: "session_snapshot", snapshot: ENTRY_TRUTH });
        c.apply({
          kind: "daily",
          event: {
            kind: "joined",
            callInstanceId: "ci-1",
            providerSessionId: "ps-1",
          },
        });
      },
      from: "entry",
    },
    {
      arrange: (c) =>
        void c.apply({ kind: "session_snapshot", snapshot: DATE_TRUTH }),
      from: "date",
    },
    {
      arrange: (c) => {
        c.apply({ kind: "session_snapshot", snapshot: DATE_TRUTH });
        c.apply({ kind: "daily", event: { kind: "transport_interrupted" } });
      },
      from: "reconnecting",
    },
    {
      arrange: (c) => {
        c.apply({ kind: "session_snapshot", snapshot: DATE_TRUTH });
        c.apply({ kind: "daily", event: { kind: "parked_for_remount" } });
      },
      from: "parked_remount",
    },
    {
      arrange: (c) => {
        c.apply({ kind: "session_snapshot", snapshot: DATE_TRUTH });
        c.apply({
          kind: "route_intent",
          intent: { kind: "end_date_requested" },
        });
      },
      from: "ending",
    },
  ];

  for (const { arrange, from } of phases) {
    const { controller } = makeController();
    arrange(controller);
    const effects = controller.apply({
      kind: "session_snapshot",
      snapshot: TERMINAL_SURVEY_TRUTH,
    });
    assert.equal(
      effects.state,
      "survey_required",
      `terminal survey recovery must be reachable from ${from}`,
    );
    assert.equal(effects.route.target, "survey");
    assert.equal(effects.route.forceSurvey, true);
    assert.ok(
      commandKinds(effects).includes("stop_daily_alive_heartbeat"),
      `terminal survey from ${from} stops the heartbeat`,
    );
  }
});

test("survey_required: verdict submit requires own-row confirmation before done", () => {
  const { controller } = makeController();
  controller.apply({
    kind: "session_snapshot",
    snapshot: TERMINAL_SURVEY_TRUTH,
  });
  const submitted = controller.apply({
    kind: "route_intent",
    intent: { kind: "survey_submitted" },
  });
  assert.deepEqual(commandKinds(submitted), ["confirm_survey_own_row"]);
  assert.equal(
    submitted.state,
    "survey_required",
    "a verdict RPC response alone is not completion proof",
  );
  const confirmed = controller.apply({
    kind: "route_intent",
    intent: { kind: "survey_own_row_confirmed" },
  });
  assert.equal(confirmed.state, "done");
  assert.equal(confirmed.route.target, "lobby");
});

test("terminal without survey truth → done; pre_stable_media_failed is survey-ineligible", () => {
  for (const terminal of [
    TERMINAL_NO_SURVEY_TRUTH,
    PRE_STABLE_MEDIA_FAILED_TRUTH,
    snapshot({ ...TERMINAL_SURVEY_TRUTH, survey_required: false }),
  ]) {
    const { controller } = makeController();
    controller.apply({ kind: "session_snapshot", snapshot: DATE_TRUTH });
    const effects = controller.apply({
      kind: "session_snapshot",
      snapshot: terminal,
    });
    assert.equal(effects.state, "done");
    assert.equal(effects.route.target, "ended");
    assert.equal(effects.route.forceSurvey, false);
  }
});

test("registration in_survey continuity pins terminal-survey recovery", () => {
  const { controller } = makeController();
  controller.apply({ kind: "session_snapshot", snapshot: DATE_TRUTH });
  const effects = controller.apply({
    kind: "registration_snapshot",
    registration: {
      queue_status: "in_survey",
      current_room_id: SESSION_ID,
      event_id: "event-1",
    },
  });
  assert.equal(effects.state, "survey_required");

  // A different room's in_survey registration does not hijack this session.
  const other = makeController().controller;
  other.apply({ kind: "session_snapshot", snapshot: DATE_TRUTH });
  const otherEffects = other.apply({
    kind: "registration_snapshot",
    registration: {
      queue_status: "in_survey",
      current_room_id: "other-session",
      event_id: "event-1",
    },
  });
  assert.equal(otherEffects.state, "date");
});

test("broadcast seq handling: stale dropped, gap triggers snapshot refetch, terminal phases reconcile via refetch", () => {
  const { controller } = makeController();
  controller.apply({
    kind: "session_snapshot",
    snapshot: { ...ENTRY_TRUTH, seq: 5 },
  });
  const stale = controller.apply({
    kind: "broadcast",
    seq: 4,
    eventKind: "session_updated",
  });
  assert.deepEqual(commandKinds(stale), [], "stale seq is dropped");

  const gap = controller.apply({
    kind: "broadcast",
    seq: 8,
    eventKind: "session_updated",
  });
  assert.deepEqual(commandKinds(gap), ["refetch_snapshot"]);

  const next = controller.apply({
    kind: "broadcast",
    seq: 6,
    eventKind: "session_updated",
    phase: "ended",
  });
  assert.deepEqual(
    commandKinds(next),
    [],
    "refetch_snapshot stays deduped while one is in flight",
  );
  controller.apply({
    kind: "command_result",
    command: "refetch_snapshot",
    ok: true,
  });
  const terminalBroadcast = controller.apply({
    kind: "broadcast",
    seq: 7,
    eventKind: "session_updated",
    phase: "ended",
  });
  assert.deepEqual(
    commandKinds(terminalBroadcast),
    ["refetch_snapshot"],
    "broadcast never terminalizes directly; it reconciles via snapshot",
  );
  assert.notEqual(controller.getPhase(), "survey_required");
});

test("manual exit suppresses re-navigation and releases ownership", () => {
  const { controller, intents } = makeController();
  controller.apply({ kind: "session_snapshot", snapshot: DATE_TRUTH });
  intents.markVideoDateRouteOwned(SESSION_ID, PROFILE_ID);
  const effects = controller.apply({
    kind: "route_intent",
    intent: { kind: "manual_exit_requested" },
  });
  assert.equal(effects.state, "done");
  assert.ok(commandKinds(effects).includes("daily_leave"));
  assert.equal(
    intents.isDateNavigationSuppressedAfterManualExit(SESSION_ID),
    true,
  );
  assert.equal(intents.isVideoDateRouteOwned(SESSION_ID, PROFILE_ID), false);
  assert.equal(intents.isDateEntryTransitionActive(SESSION_ID), false);
});

test("fatal Daily error leaves the call, reconciles truth, and degrades to reconnecting", () => {
  const { controller } = makeController();
  controller.apply({ kind: "session_snapshot", snapshot: ENTRY_TRUTH });
  controller.apply({
    kind: "daily",
    event: { kind: "joined", callInstanceId: "ci-1", providerSessionId: "ps-1" },
  });
  const effects = controller.apply({
    kind: "daily",
    event: { kind: "fatal_error", code: "ejected" },
  });
  assert.equal(effects.state, "reconnecting");
  assert.deepEqual(commandKinds(effects), ["daily_leave", "refetch_snapshot"]);
});

test("terminal command_result payloads route into terminal-survey recovery", () => {
  const { controller } = makeController();
  controller.apply({ kind: "session_snapshot", snapshot: ENTRY_TRUTH });
  const effects = controller.apply({
    kind: "command_result",
    command: "complete_entry",
    ok: false,
    terminalSurvey: true,
  });
  assert.equal(effects.state, "survey_required");
});

test("mount with forceSurvey reconciles truth before opening the survey", () => {
  const { controller } = makeController();
  const effects = controller.apply({
    kind: "route_intent",
    intent: { kind: "mount", forceSurvey: true },
  });
  assert.deepEqual(commandKinds(effects), ["refetch_snapshot"]);
  assert.equal(effects.state, "hydrate");
});
