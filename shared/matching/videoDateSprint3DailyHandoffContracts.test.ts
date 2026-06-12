import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readWebVideoCallFlowSource } from "../testUtils/webVideoDateFlowSources";
import { readNativeVideoDateScreenFlowSource } from "../testUtils/nativeVideoDateFlowSources";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function readDailyRoomActionBlock(action: string): string {
  const marker = `// ── ACTION: ${action} ──`;
  const markerIndex = dailyRoom.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${action} marker missing`);
  const rest = dailyRoom.slice(markerIndex);
  const nextMarkerIndex = rest.indexOf("\n    // ── ACTION:", marker.length);
  return nextMarkerIndex === -1 ? rest : rest.slice(0, nextMarkerIndex);
}

const dailyRoom = read("supabase/functions/daily-room/index.ts");
const tokenRefresh = read("supabase/functions/video-date-token-refresh/index.ts");
const outboxDrainer = read("supabase/functions/video-date-outbox-drainer/index.ts");
const roomCleanup = read("supabase/functions/video-date-room-cleanup/index.ts");
const webPrewarm = read("src/lib/videoDateDailyPrewarm.ts");
const nativePrewarm = read("apps/mobile/lib/videoDateDailyPrewarm.ts");
const webReadyGate = read("src/components/lobby/ReadyGateOverlay.tsx");
const webVideoCall = readWebVideoCallFlowSource(root);
const nativeReadyGate = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
// PR 8.5: ready screen body split across lib/videoDate sub-hooks; read the family.
const nativeStandaloneReady = [
  "apps/mobile/lib/videoDate/useNativeReadyGateMediaPermissions.ts",
  "apps/mobile/lib/videoDate/useNativeReadyGateTruthReconcile.ts",
  "apps/mobile/lib/videoDate/useNativeReadyGateForfeitExpiry.ts",
  "apps/mobile/app/ready/[id].tsx",
]
  .map(read)
  .join("\n");
const nativeDate = readNativeVideoDateScreenFlowSource();
const prepareEntry = read("shared/matching/videoDatePrepareEntry.ts");

test("Sprint 3 server entry path route-confirms before provider work and verifies provider room before token minting", () => {
  const prepareBlock = readDailyRoomActionBlock("prepare_date_entry");
  assert.match(prepareBlock, /const roomProof = await ensureVideoDateProviderRoomForToken/);
  assert.match(prepareBlock, /const token = await createMeetingToken/);
  assert.match(prepareBlock, /confirmVideoDateEntryPrepared/);
  assert.ok(
    prepareBlock.indexOf("confirmVideoDateEntryPrepared") < prepareBlock.indexOf("ensureVideoDateProviderRoomForToken"),
    "route confirmation must precede outbound Daily provider work",
  );
  assert.ok(
    prepareBlock.indexOf("ensureVideoDateProviderRoomForToken") < prepareBlock.indexOf("createMeetingToken"),
    "provider room proof must precede token minting",
  );
  assert.match(prepareBlock, /provider_verify_skipped/);
  assert.match(prepareBlock, /daily_room_verified_at/);
  assert.match(prepareBlock, /daily_room_expires_at/);
  assert.match(dailyRoom, /if \(!DAILY_API_KEY\) \{[\s\S]*providerCode: "daily_api_key_missing"/);
});

test("Sprint 3 token refresh rejects room drift instead of minting against stale session metadata", () => {
  assert.match(tokenRefresh, /videoDateRoomNameForSession/);
  assert.match(tokenRefresh, /videoDateRoomUrlForName/);
  assert.match(tokenRefresh, /isDailyRoomUrlForName/);
  assert.match(tokenRefresh, /const roomUrlMatchesExpectedRoom = isDailyRoomUrlForName\(roomUrl, expectedRoomName, DAILY_DOMAIN\)/);
  assert.doesNotMatch(tokenRefresh, /roomUrl !== expectedRoomUrl/);
  assert.match(tokenRefresh, /event: "video_date_token_refresh_room_mismatch"/);
  assert.match(tokenRefresh, /return jsonResponse\(corsHeaders, \{ ok: false, error: "room_mismatch", phase, retryable: true \}, 409\)/);
  assert.ok(
    tokenRefresh.indexOf("room_mismatch") < tokenRefresh.indexOf("const tokenResult = await createMeetingToken"),
    "refresh must reject mismatched room metadata before minting a replacement token",
  );
});

test("Sprint 3 Daily runtime config fails closed consistently across provider entrypoints", () => {
  for (const source of [dailyRoom, tokenRefresh, outboxDrainer]) {
    assert.match(source, /resolveDailyRuntimeConfig/);
    assert.match(source, /const DAILY_RUNTIME_CONFIG = resolveDailyRuntimeConfig/);
    assert.match(source, /code: "DAILY_CONFIG_BLOCKED"/);
    assert.match(source, /blockers: DAILY_RUNTIME_CONFIG\.blockers/);
    assert.doesNotMatch(source, /SENTRY_ENVIRONMENT/);
  }

  assert.match(dailyRoom, /dailyConfigRequiredForAction\(action\)/);
  assert.match(tokenRefresh, /video_date_token_refresh_config_blocked_request/);
  assert.match(outboxDrainer, /video_date_outbox_drainer_daily_config_blocked/);
  assert.match(roomCleanup, /video_date_room_cleanup_daily_config_blocked/);
  assert.match(roomCleanup, /blockers: \["daily_api_key_missing"\]/);
});

test("Sprint 3 token refresh verifies provider room state before minting a replacement token", () => {
  assert.match(tokenRefresh, /ensureDailyRoomProviderReadyForTokenRefresh/);
  assert.match(tokenRefresh, /getDailyRoomProviderState/);
  assert.match(tokenRefresh, /video_date_token_refresh_provider_room_not_ready/);
  assert.match(tokenRefresh, /error: "room_not_ready"/);
  assert.doesNotMatch(tokenRefresh, /SUPABASE_SERVICE_ROLE_KEY|service_role/i);
  assert.doesNotMatch(tokenRefresh, /\.from\("video_sessions"\)/);
  assert.doesNotMatch(tokenRefresh, /createDailyRoomForTokenRefresh|deleteDailyRoomForTokenRefresh/);
  assert.match(tokenRefresh, /DAILY_VIDEO_DATE_PROVIDER_ROOM_MIN_REMAINING_SECONDS/);
  assert.match(tokenRefresh, /token_expiry_reason: tokenWindow\.reason/);
  assert.match(tokenRefresh, /daily_room_expires_at: providerProof\.expiresAt/);
  assert.ok(
    tokenRefresh.indexOf("const providerProof = await ensureDailyRoomProviderReadyForTokenRefresh") <
      tokenRefresh.indexOf("const tokenResult = await createMeetingToken"),
    "refresh must verify the provider room before minting a replacement token",
  );
});

test("Sprint 3 web and native recover token-refresh room_not_ready through prepare_date_entry", () => {
  assert.match(webVideoCall, /refresh\.ok === false[\s\S]*refresh\.error === "room_not_ready"[\s\S]*prepareVideoDateEntry\(sessionId/);
  assert.match(webVideoCall, /source: `\$\{sourceAction\}_date_route_room_recovery`/);
  assert.match(webVideoCall, /prepared\.data\.room_name === roomData\.room_name/);
  assert.match(webVideoCall, /prepared\.data\.room_url === roomData\.room_url/);
  assert.match(webVideoCall, /recovered_via_prepare_entry: true/);

  assert.match(nativeDate, /refreshed\.ok === false[\s\S]*refreshed\.error === ['"]room_not_ready['"][\s\S]*prepareVideoDateEntry\(sessionId/);
  assert.match(nativeDate, /source: `\$\{sourceAction\}_native_date_route_room_recovery`/);
  assert.match(nativeDate, /prepared\.data\.room_name === tokenResult\.room_name/);
  assert.match(nativeDate, /prepared\.data\.room_url === tokenResult\.room_url/);
  assert.match(nativeDate, /recovered_via_prepare_entry: true/);
});

test("Sprint 3 prepared-entry cache only accepts startable verified room/token payloads", () => {
  assert.match(prepareEntry, /function preparedEntryInvalidStartabilityCode/);
  assert.match(prepareEntry, /PREPARE_ENTRY_ROOM_MISMATCH/);
  assert.match(prepareEntry, /PREPARE_ENTRY_INVALID_STATE/);
  assert.match(prepareEntry, /PREPARE_ENTRY_INVALID_PHASE/);
  assert.match(prepareEntry, /PREPARE_ENTRY_INVALID_READY_GATE/);
  assert.match(prepareEntry, /preparedEntryRoomUrlMatchesRoomName/);
  assert.match(prepareEntry, /envelope\.roomName !== cacheEntry\.value\.room_name/);
  assert.match(prepareEntry, /envelope\.roomUrl !== cacheEntry\.value\.room_url/);
});

test("Sprint 3 web and native prewarm reuse is bound to both canonical room name and URL", () => {
  for (const source of [webPrewarm, nativePrewarm]) {
    assert.match(source, /existing\.roomName === params\.roomName\s*&&\s*existing\.roomUrl === params\.roomUrl/);
    assert.match(source, /entry\.roomName !== params\.roomName/);
    assert.match(source, /entry\.roomUrl !== params\.roomUrl/);
    assert.match(source, /daily_prewarm_room_mismatch/);
  }

  for (const source of [webReadyGate, nativeReadyGate, nativeStandaloneReady]) {
    // ReadyGate warms (camera + preauth) bound to the canonical room name/url,
    // but never joins Daily — the real join is owned by /date (useVideoCall).
    assert.match(source, /preAuth(?:Web|Native)VideoDateDailyPrewarm\(\{[\s\S]*roomName: .*?\.data\.room_name/);
    assert.doesNotMatch(source, /join(?:Web|Native)VideoDateDailyPrewarm/);
  }
});

test("Sprint 3 native date route keeps prepare_date_entry as the route-confirming handoff owner", () => {
  assert.match(nativeDate, /setPrejoinStep\("prepare_entry_routeable"\)/);
  assert.match(nativeDate, /const preparedEntryRouteable = truthRecovery0\.action === "go_date"/);
  assert.match(nativeDate, /recoverFromNotStartableDateTruth\("prepare_date_entry"\)/);
  assert.match(nativeDate, /prejoinMark\("prepare_entry_routeable"\)/);
  assert.match(nativeDate, /rcBreadcrumb\(RC_CATEGORY\.videoDateEntry, "prepare_date_entry_start"/);
  assert.match(nativeDate, /const handoff = consumePreparedVideoDateEntry\(sessionId, user\.id\)/);
  assert.match(
    nativeDate,
    /getDailyRoomTokenWithTimeout\(\s*sessionId,\s*PREJOIN_STEP_TIMEOUT_MS,\s*user\.id,\s*\)/,
  );
  assert.doesNotMatch(nativeDate, /enterHandshakeWithTimeout|enterHandshake\(/);
});
