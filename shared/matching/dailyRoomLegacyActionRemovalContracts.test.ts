import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function exists(path: string): boolean {
  return existsSync(join(root, path));
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
const nativeChat = read("apps/mobile/app/chat/[id].tsx");
const generatedTypes = read("src/integrations/supabase/types.ts");
const standaloneEnterHandshakeMigration = read("supabase/migrations/20260609202707_remove_standalone_enter_handshake.sql");

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

test("standalone enter_handshake is removed while prepare-entry owns room/token acquisition", () => {
  for (const [path, source] of activeClientSources) {
    assert.doesNotMatch(source, /p_action:\s*["']enter_handshake["']/, `${path} must not send standalone enter_handshake`);
    assert.doesNotMatch(source, /action:\s*["']enter_handshake["']/, `${path} must not send standalone enter_handshake`);
  }

  assert.doesNotMatch(nativeVideoDateApi, /export async function enterHandshake/);
  assert.doesNotMatch(nativeVideoDateApi, /enterHandshakeWithTimeout/);
  assert.doesNotMatch(nativeDateRoute, /enterHandshakeWithTimeout/);
  assert.doesNotMatch(webPrepareEntry, /enter_handshake_(started|success|failure)/);
  assert.doesNotMatch(nativePrepareEntry, /enter_handshake_(started|success|failure)/);
  assert.match(dailyRoomFunction, /p_action:\s*"prepare_entry"/);
  assert.match(webPrepareEntry, /prepare_entry_started/);
  assert.match(nativePrepareEntry, /prepare_entry_started/);
});

test("video_date_transition rejects public enter_handshake and preserves prepare_entry delegation", () => {
  assert.match(standaloneEnterHandshakeMigration, /v_action = 'enter_handshake'/);
  assert.match(standaloneEnterHandshakeMigration, /'code', 'ENTER_HANDSHAKE_REMOVED'/);
  assert.match(standaloneEnterHandshakeMigration, /'retryable', false/);
  assert.match(standaloneEnterHandshakeMigration, /'supported_action', 'prepare_entry'/);
  assert.match(standaloneEnterHandshakeMigration, /'entry_command', 'prepare_date_entry'/);
  assert.match(standaloneEnterHandshakeMigration, /vd_transition_20260609202707_enter_hs_base/);
  assert.match(standaloneEnterHandshakeMigration, /p_action/);
  assert.match(standaloneEnterHandshakeMigration, /COMMENT ON FUNCTION public\.video_date_transition/);
  assert.match(dailyRoomFunction, /p_action:\s*"prepare_entry"/);
  assert.match(nativeVideoDateApi, /p_action:\s*'end'/);
  assert.match(nativeVideoDateApi, /p_action:\s*'complete_handshake'/);
});

test("shared provider-room lifecycle internals remain available to prepare_date_entry", () => {
  const prepareIndex = dailyRoomFunction.indexOf('if (action === "prepare_date_entry")');
  assert.ok(prepareIndex > 0, "prepare_date_entry dispatch must remain active");
  assert.match(dailyRoomFunction.slice(prepareIndex), /ensureVideoDateProviderRoomForToken/);
  assert.match(dailyRoomFunction, /"create_date_room_token_issued"/);
});

test("chat match-call product surface is removed while messages remain active", () => {
  const removedFiles = [
    "src/hooks/useMatchCall.tsx",
    "src/components/chat/IncomingCallOverlay.tsx",
    "src/components/chat/ActiveCallOverlay.tsx",
    "apps/mobile/lib/useMatchCall.tsx",
    "apps/mobile/lib/matchCallApi.ts",
    "apps/mobile/components/chat/IncomingCallOverlay.tsx",
    "apps/mobile/components/chat/ActiveCallOverlay.tsx",
    "shared/chat/matchCallDiag.ts",
    "shared/chat/matchCallEdgeCodes.ts",
    "supabase/functions/match-call-room-cleanup/index.ts",
  ] as const;

  for (const path of removedFiles) {
    assert.equal(exists(path), false, `${path} should be removed`);
  }

  for (const action of ["create_match_call", "answer_match_call", "join_match_call"] as const) {
    assert.doesNotMatch(
      dailyRoomFunction,
      new RegExp(`if \\(action === "${action}"\\)`),
      `${action} must not have an Edge Function dispatch branch`,
    );
    assert.doesNotMatch(
      dailyRoomFunction,
      new RegExp(`["']${action}["']`),
      `${action} must not be accepted by daily-room`,
    );
  }

  for (const [path, source] of [
    ["src/pages/Chat.tsx", webChat],
    ["apps/mobile/app/chat/[id].tsx", nativeChat],
  ] as const) {
    assert.doesNotMatch(source, /useMatchCall/, `${path} should not import or call useMatchCall`);
    assert.doesNotMatch(source, /startCall|startMatchCall/, `${path} should not expose call launch handlers`);
    assert.doesNotMatch(source, />\s*(Voice Call|Video Call)\s*</, `${path} should not render call buttons`);
    assert.match(source, /useMessages|handleSend/, `${path} should preserve chat message sending`);
  }

  assert.doesNotMatch(generatedTypes, /\bmatch_calls\b/);
  assert.doesNotMatch(generatedTypes, /\bmatch_call_transition\b/);
  assert.doesNotMatch(generatedTypes, /\bexpire_stale_match_calls\b/);
  assert.doesNotMatch(generatedTypes, /\bnotify_match_calls\b/);
  assert.match(dailyRoomFunction, /if \(action === "prepare_date_entry"\)/);
  assert.match(dailyRoomFunction, /if \(action === "delete_room"\)/);
});
