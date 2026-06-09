import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const dailyRoomFunction = read("supabase/functions/daily-room/index.ts");
const dailyRoomContracts = read("supabase/functions/daily-room/dailyRoomContracts.ts");
const dailyRoomFailure = read("shared/matching/dailyRoomFailure.ts");
const webPrepareEntry = read("src/lib/videoDatePrepareEntry.ts");
const nativePrepareEntry = read("apps/mobile/lib/videoDatePrepareEntry.ts");
const sharedPrepareEntry = read("shared/matching/videoDatePrepareEntry.ts");
const webVideoCall = read("src/hooks/useVideoCall.ts");
const nativeVideoDateApi = read("apps/mobile/lib/videoDateApi.ts");
const nativeDateRoute = read("apps/mobile/app/date/[id].tsx");
const webReadiness = read("src/lib/videoDateReadiness.ts");
const nativeReadiness = read("apps/mobile/lib/videoDateReadiness.ts");
const webReadyGateOverlay = read("src/components/lobby/ReadyGateOverlay.tsx");
const nativeReadyGateOverlay = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
const nativeReadyRoute = read("apps/mobile/app/ready/[id].tsx");
const webChat = read("src/pages/Chat.tsx");
const webMatchCall = read("src/hooks/useMatchCall.tsx");
const nativeChat = read("apps/mobile/app/chat/[id].tsx");
const nativeMatchCallApi = read("apps/mobile/lib/matchCallApi.ts");

const removedVideoDateEntryActions = [
  "create_date_room",
  "join_date_room",
  "ensure_date_room",
  "prepare_diagnostic_entry",
  "prepare_solo_entry",
] as const;

const activeClientSources = [
  ["src/lib/videoDatePrepareEntry.ts", webPrepareEntry],
  ["apps/mobile/lib/videoDatePrepareEntry.ts", nativePrepareEntry],
  ["shared/matching/videoDatePrepareEntry.ts", sharedPrepareEntry],
  ["src/hooks/useVideoCall.ts", webVideoCall],
  ["apps/mobile/lib/videoDateApi.ts", nativeVideoDateApi],
  ["apps/mobile/app/date/[id].tsx", nativeDateRoute],
  ["src/lib/videoDateReadiness.ts", webReadiness],
  ["apps/mobile/lib/videoDateReadiness.ts", nativeReadiness],
  ["src/components/lobby/ReadyGateOverlay.tsx", webReadyGateOverlay],
  ["apps/mobile/components/lobby/ReadyGateOverlay.tsx", nativeReadyGateOverlay],
  ["apps/mobile/app/ready/[id].tsx", nativeReadyRoute],
] as const;

test("non-golden Video Date Daily-room entry actions are not active action contract members", () => {
  for (const source of [dailyRoomContracts, dailyRoomFailure]) {
    for (const action of removedVideoDateEntryActions) {
      assert.doesNotMatch(source, new RegExp(`["']${action}["']`), `${action} must not be a public date action`);
    }
  }

  const configRequiredBlock =
    dailyRoomFunction.match(/const DAILY_CONFIG_REQUIRED_ACTIONS = new Set\(\[[\s\S]*?\]\);/)?.[0] ?? "";
  assert.ok(configRequiredBlock.length > 0, "daily-room should define config-required actions");
  for (const action of removedVideoDateEntryActions) {
    assert.doesNotMatch(configRequiredBlock, new RegExp(`["']${action}["']`), `${action} must not require Daily config`);
    assert.doesNotMatch(
      dailyRoomFunction,
      new RegExp(`if \\(action === ["']${action}["']\\)`),
      `${action} must not have an Edge Function dispatch branch`,
    );
  }
  assert.match(dailyRoomContracts, /"prepare_date_entry"/);
  assert.match(dailyRoomContracts, /"video_date_leave"/);
  assert.match(dailyRoomFailure, /PREPARE_ENTRY:\s*"prepare_date_entry"/);
});

test("current web and native date entry calls daily-room prepare_date_entry only", () => {
  assert.match(webPrepareEntry, /action: PREPARE_VIDEO_DATE_ENTRY_ACTION/);
  assert.match(nativePrepareEntry, /action: PREPARE_VIDEO_DATE_ENTRY_ACTION/);
  assert.match(webVideoCall, /action:\s*"prepare_date_entry"/);
  assert.match(nativeVideoDateApi, /prepareVideoDateEntry\(sessionId, \{ userId, source: 'native_video_date_token' \}\)/);

  for (const [path, source] of activeClientSources) {
    for (const action of removedVideoDateEntryActions) {
      assert.doesNotMatch(source, new RegExp(`action:\\s*["']${action}["']`), `${path} must not send ${action}`);
      assert.doesNotMatch(source, new RegExp(action), `${path} must not preserve ${action} as an active fallback`);
    }
  }
});

test("enter_handshake remains intentionally preserved while prepare-entry owns room/token acquisition", () => {
  assert.match(nativeVideoDateApi, /action:\s*'enter_handshake'/);
  assert.match(nativeDateRoute, /prepare_date_entry_owns_handshake/);
  assert.match(webPrepareEntry, /enter_handshake_started/);
  assert.match(nativePrepareEntry, /enter_handshake_started/);
});

test("shared provider-room lifecycle internals remain available to prepare_date_entry", () => {
  const prepareIndex = dailyRoomFunction.indexOf('if (action === "prepare_date_entry")');
  assert.ok(prepareIndex > 0, "prepare_date_entry dispatch must remain active");
  assert.match(dailyRoomFunction.slice(prepareIndex), /ensureVideoDateProviderRoomForToken/);
  assert.match(dailyRoomFunction, /"create_date_room_token_issued"/);
});

test("match-call actions remain documented as a separate active Chat product surface", () => {
  for (const action of ["create_match_call", "answer_match_call", "join_match_call"] as const) {
    assert.match(dailyRoomFunction, new RegExp(`if \\(action === "${action}"\\)`));
  }
  assert.match(webChat, /useMatchCall/);
  assert.match(webMatchCall, /action:\s*"create_match_call"/);
  assert.match(webMatchCall, /action:\s*"answer_match_call"/);
  assert.match(webMatchCall, /action:\s*"join_match_call"/);
  assert.match(nativeChat, /useMatchCall/);
  assert.match(nativeMatchCallApi, /action:\s*'create_match_call'/);
  assert.match(nativeMatchCallApi, /action:\s*'answer_match_call'/);
  assert.match(nativeMatchCallApi, /action:\s*'join_match_call'/);
});
