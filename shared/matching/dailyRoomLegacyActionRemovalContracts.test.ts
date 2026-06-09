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
const webVideoCall = read("src/hooks/useVideoCall.ts");
const nativeVideoDateApi = read("apps/mobile/lib/videoDateApi.ts");
const nativeDateRoute = read("apps/mobile/app/date/[id].tsx");

const activeClientSources = [
  ["src/lib/videoDatePrepareEntry.ts", webPrepareEntry],
  ["apps/mobile/lib/videoDatePrepareEntry.ts", nativePrepareEntry],
  ["src/hooks/useVideoCall.ts", webVideoCall],
  ["apps/mobile/lib/videoDateApi.ts", nativeVideoDateApi],
  ["apps/mobile/app/date/[id].tsx", nativeDateRoute],
] as const;

test("legacy create/join Daily-room actions are not active action contract members", () => {
  for (const source of [dailyRoomContracts, dailyRoomFailure]) {
    assert.doesNotMatch(source, /["']create_date_room["']/);
    assert.doesNotMatch(source, /["']join_date_room["']/);
  }

  const configRequiredBlock =
    dailyRoomFunction.match(/const DAILY_CONFIG_REQUIRED_ACTIONS = new Set\(\[[\s\S]*?\]\);/)?.[0] ?? "";
  assert.ok(configRequiredBlock.length > 0, "daily-room should define config-required actions");
  assert.doesNotMatch(configRequiredBlock, /["']create_date_room["']/);
  assert.doesNotMatch(configRequiredBlock, /["']join_date_room["']/);
  assert.doesNotMatch(dailyRoomFunction, /if \(action === ["']create_date_room["']\)/);
  assert.doesNotMatch(dailyRoomFunction, /if \(action === ["']join_date_room["']\)/);
});

test("current web and native date entry calls daily-room prepare_date_entry only", () => {
  assert.match(webPrepareEntry, /action: PREPARE_VIDEO_DATE_ENTRY_ACTION/);
  assert.match(nativePrepareEntry, /action: PREPARE_VIDEO_DATE_ENTRY_ACTION/);
  assert.match(webVideoCall, /action:\s*"prepare_date_entry"/);
  assert.match(nativeVideoDateApi, /prepareVideoDateEntry\(sessionId, \{ userId, source: 'native_video_date_token' \}\)/);

  for (const [path, source] of activeClientSources) {
    assert.doesNotMatch(
      source,
      /action:\s*["'](?:create_date_room|join_date_room)["']/,
      `${path} must not send a legacy Daily-room action`,
    );
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
