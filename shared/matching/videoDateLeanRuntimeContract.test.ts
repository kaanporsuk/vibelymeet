import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  VIDEO_DATE_LEAN_COMMAND_OWNERS,
  resolveVideoDateLeanRuntime,
} from "./videoDateLeanRuntimeContract";
import type { VideoDateRouteSessionTruth } from "./videoDateRouteDecision";

const root = process.cwd();
const NOW_MS = Date.parse("2026-06-09T12:00:00.000Z");
const SESSION_ID = "session-1";
const EVENT_ID = "event-1";
const PROVIDER_ROOM = {
  daily_room_name: "vibely-session-1",
  daily_room_url: "https://vibely.daily.co/vibely-session-1",
};

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function session(
  overrides: Partial<VideoDateRouteSessionTruth> = {},
): VideoDateRouteSessionTruth {
  return {
    id: SESSION_ID,
    event_id: EVENT_ID,
    participant_1_id: "user-a",
    participant_2_id: "user-b",
    ended_at: null,
    state: "ready_gate",
    phase: "ready_gate",
    ready_gate_status: "ready",
    ready_gate_expires_at: "2026-06-09T12:00:30.000Z",
    ...overrides,
  };
}

test("lean runtime exposes one screen model across the golden path", () => {
  const lobby = resolveVideoDateLeanRuntime({
    eventId: EVENT_ID,
    nowMs: NOW_MS,
  });
  assert.equal(lobby.screen, "lobby");
  assert.deepEqual(lobby.allowedCommands, ["enter_lobby", "get_deck", "swipe"]);
  assert.equal(lobby.webPath, `/event/${EVENT_ID}/lobby`);

  const readyGate = resolveVideoDateLeanRuntime({
    sessionId: SESSION_ID,
    eventId: EVENT_ID,
    truth: session({ ready_gate_status: "ready_a" }),
    nowMs: NOW_MS,
  });
  assert.equal(readyGate.screen, "ready_gate");
  assert.deepEqual(readyGate.allowedCommands, ["mark_ready", "forfeit_ready_gate"]);
  assert.equal(readyGate.nativePath, `/ready/${SESSION_ID}`);

  const bothReadyPrepare = resolveVideoDateLeanRuntime({
    sessionId: SESSION_ID,
    eventId: EVENT_ID,
    truth: session({
      state: "ready_gate",
      phase: "ready_gate",
      ready_gate_status: "both_ready",
    }),
    registration: {
      event_id: EVENT_ID,
      current_room_id: SESSION_ID,
      queue_status: "in_handshake",
    },
    nowMs: NOW_MS,
  });
  assert.equal(bothReadyPrepare.screen, "date");
  assert.equal(bothReadyPrepare.reason, "both_ready_provider_prepare_pending");
  assert.deepEqual(bothReadyPrepare.allowedCommands, ["prepare_date", "join_date", "end_date"]);
  assert.equal(bothReadyPrepare.webPath, `/date/${SESSION_ID}`);

  const activeDate = resolveVideoDateLeanRuntime({
    sessionId: SESSION_ID,
    eventId: EVENT_ID,
    truth: session({
      ...PROVIDER_ROOM,
      state: "handshake",
      phase: "handshake",
      handshake_started_at: "2026-06-09T11:59:50.000Z",
      ready_gate_status: "both_ready",
    }),
    nowMs: NOW_MS,
  });
  assert.equal(activeDate.screen, "date");
  assert.deepEqual(activeDate.allowedCommands, ["join_date", "end_date"]);

  const survey = resolveVideoDateLeanRuntime({
    sessionId: SESSION_ID,
    eventId: EVENT_ID,
    truth: session({
      ...PROVIDER_ROOM,
      ended_at: "2026-06-09T12:00:01.000Z",
      ended_reason: "date_timeout",
      state: "ended",
      phase: "ended",
      date_started_at: "2026-06-09T11:55:00.000Z",
      participant_1_joined_at: "2026-06-09T11:55:05.000Z",
      participant_2_joined_at: "2026-06-09T11:55:06.000Z",
      participant_1_remote_seen_at: "2026-06-09T11:55:07.000Z",
      participant_2_remote_seen_at: "2026-06-09T11:55:08.000Z",
    }),
    nowMs: NOW_MS,
  });
  assert.equal(survey.screen, "survey");
  assert.deepEqual(survey.allowedCommands, ["submit_survey"]);
  assert.equal(survey.webPath, `/date/${SESSION_ID}`);

  const done = resolveVideoDateLeanRuntime({
    sessionId: SESSION_ID,
    eventId: EVENT_ID,
    truth: session({
      ended_at: "2026-06-09T12:00:01.000Z",
      ended_reason: "ready_gate_expired",
      state: "ended",
      phase: "ended",
      ready_gate_status: "expired",
    }),
    nowMs: NOW_MS,
  });
  assert.equal(done.screen, "done");
  assert.deepEqual(done.allowedCommands, ["return_to_lobby"]);
});

test("lean command ownership makes mixed provider work explicit", () => {
  assert.equal(VIDEO_DATE_LEAN_COMMAND_OWNERS.swipe, "server");
  assert.equal(VIDEO_DATE_LEAN_COMMAND_OWNERS.mark_ready, "server");
  assert.equal(VIDEO_DATE_LEAN_COMMAND_OWNERS.prepare_date, "mixed");
  assert.equal(VIDEO_DATE_LEAN_COMMAND_OWNERS.join_date, "mixed");
  assert.equal(VIDEO_DATE_LEAN_COMMAND_OWNERS.submit_survey, "server");
  assert.equal(VIDEO_DATE_LEAN_COMMAND_OWNERS.return_to_lobby, "client");
});

test("lean contract wraps existing snapshot surfaces instead of adding a second source of truth", () => {
  const contract = read("docs/contracts/video-date-lean-runtime-contract.md");
  const leanRuntime = read("shared/matching/videoDateLeanRuntimeContract.ts");
  const webSnapshot = read("src/lib/videoDateSnapshot.ts");
  const nativeSnapshot = read("apps/mobile/lib/videoDateSnapshot.ts");

  assert.match(contract, /`video-date-snapshot` -> `public\.get_video_date_snapshot_core\(uuid\)`/);
  assert.match(contract, /`public\.get_video_date_start_snapshot_v1\(uuid\)`/);
  assert.match(leanRuntime, /decideCanonicalVideoDateRoute/);
  assert.match(webSnapshot, /VIDEO_DATE_SNAPSHOT_FUNCTION_NAME/);
  assert.match(nativeSnapshot, /VIDEO_DATE_SNAPSHOT_FUNCTION_NAME/);
});
