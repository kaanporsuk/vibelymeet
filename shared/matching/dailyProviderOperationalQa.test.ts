import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function readTreeFiles(
  dir: string,
  extensions: ReadonlySet<string>,
  ignored = new Set(["node_modules", ".expo", ".next", "dist", "build"]),
): string[] {
  const abs = join(root, dir);
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    if (ignored.has(entry)) continue;
    const absPath = join(abs, entry);
    const relPath = `${dir}/${entry}`;
    const st = statSync(absPath);
    if (st.isDirectory()) {
      out.push(...readTreeFiles(relPath, extensions, ignored));
    } else if (extensions.has(entry.slice(entry.lastIndexOf(".")))) {
      out.push(relPath);
    }
  }
  return out;
}

function assertOrder(source: string, labels: Array<[string, string]>): void {
  let last = -1;
  for (const [label, needle] of labels) {
    const index = source.indexOf(needle, last + 1);
    assert.ok(index >= 0, `${label} marker should exist`);
    assert.ok(index > last, `${label} should appear after the previous marker`);
    last = index;
  }
}

function vercelCspDirective(name: string): string[] {
  const parsed = JSON.parse(read("vercel.json")) as {
    headers?: Array<{ headers?: Array<{ key?: string; value?: string }> }>;
  };
  const csp = parsed.headers
    ?.flatMap((entry) => entry.headers ?? [])
    .find((entry) => entry.key === "Content-Security-Policy")?.value;
  assert.ok(csp, "production Content-Security-Policy header should exist");
  const directive = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
  assert.ok(directive, `${name} directive should exist in production CSP`);
  return directive.split(/\s+/).slice(1);
}

const dailyRoom = read("supabase/functions/daily-room/index.ts");
const dailyRoomContracts = read("supabase/functions/daily-room/dailyRoomContracts.ts");
const matchCallCleanup = read("supabase/functions/match-call-room-cleanup/index.ts");
const videoDateCleanup = read("supabase/functions/video-date-room-cleanup/index.ts");
const supabaseConfig = read("supabase/config.toml");
const webVideoCall = read("src/hooks/useVideoCall.ts");
const webMatchCall = read("src/hooks/useMatchCall.tsx");
const webDailyCallObjectConfig = read("src/lib/dailyCallObjectConfig.ts");
const webDailyPrewarm = read("src/lib/videoDateDailyPrewarm.ts");
const webReadyGateOverlay = read("src/components/lobby/ReadyGateOverlay.tsx");
const webVideoDatePage = read("src/pages/VideoDate.tsx");
const videoDateMediaContract = read("shared/matching/videoDateMediaContract.ts");
const webPrepareEntry = read("src/lib/videoDatePrepareEntry.ts");
const nativeDateRoute = read("apps/mobile/app/date/[id].tsx");
const nativeVideoDateDailyMediaConfig = read("apps/mobile/lib/videoDateDailyMediaConfig.ts");
const nativeVideoDateApi = read("apps/mobile/lib/videoDateApi.ts");
const nativePrepareEntry = read("apps/mobile/lib/videoDatePrepareEntry.ts");
const nativeEntryStartable = read("apps/mobile/lib/videoDateEntryStartable.ts");
const nativeMatchCall = read("apps/mobile/lib/useMatchCall.tsx");
const nativeMatchCallApi = read("apps/mobile/lib/matchCallApi.ts");
const rootPackageJson = read("package.json");
const nativePackageJson = read("apps/mobile/package.json");
const providerSheet = read("_cursor_context/vibely_daily_provider_sheet.md");
const branchDelta = read("docs/branch-deltas/fix-daily-provider-operational-qa.md");

test("daily-room reads required Daily env names", () => {
  assert.match(dailyRoom, /Deno\.env\.get\(["']DAILY_API_KEY["']\)/);
  assert.match(dailyRoom, /Deno\.env\.get\(["']DAILY_DOMAIN["']\)/);
  assert.match(dailyRoom, /const DAILY_API_URL = "https:\/\/api\.daily\.co\/v1"/);
});

test("daily-room handles DAILY_DOMAIN and documents the fallback domain risk", () => {
  assert.match(dailyRoom, /const DAILY_DOMAIN_FALLBACK = "vibelyapp\.daily\.co"/);
  assert.match(dailyRoom, /const DAILY_DOMAIN = DAILY_DOMAIN_ENV \|\| DAILY_DOMAIN_FALLBACK/);
  assert.match(dailyRoom, /daily_domain_env_missing/);
  assert.match(dailyRoomContracts, /videoDateRoomUrlForName\(roomName: string, dailyDomain: string\)/);
  assert.match(providerSheet, /fallback is still code-supported for resilience/);
  assert.match(branchDelta, /Fallback Domain Posture/);
});

test("room creation calls the Daily REST API with bearer auth", () => {
  assert.match(dailyRoom, /fetch\(`\$\{DAILY_API_URL\}\/rooms`, \{/);
  assert.match(dailyRoom, /method:\s*"POST"/);
  assert.match(dailyRoom, /Authorization:\s*`Bearer \$\{DAILY_API_KEY\}`/);
  assert.match(dailyRoom, /body:\s*JSON\.stringify\(\{ name: roomName, privacy: "private", properties: props \}\)/);
});

test("meeting token creation remains present and token values stay response-only", () => {
  assert.match(dailyRoom, /fetch\(`\$\{DAILY_API_URL\}\/meeting-tokens`, \{/);
  assert.match(dailyRoom, /buildMeetingTokenProperties/);
  assert.match(dailyRoom, /return data\.token/);
  assert.match(dailyRoom, /token,\s*[\r\n]+\s*token_expires_at/);
  const consoleLines = dailyRoom.split("\n").filter((line) => /console\.(?:log|warn|error)/.test(line));
  for (const line of consoleLines) {
    assert.doesNotMatch(
      line,
      /data\.token|callerToken|roomData\.token|tokenResult\.token|token:\s*[^,}]+/,
      "daily-room console lines must not print token values",
    );
  }
});

test("video-date room names derive deterministically from session id", () => {
  assert.match(dailyRoomContracts, /export function videoDateRoomNameForSession\(sessionId: string\): string/);
  assert.match(dailyRoomContracts, /return `date-\$\{sessionId\.replace\(\/-\/g, ""\)\}`/);
  assert.match(dailyRoom, /resolveCanonicalVideoDateRoom/);
  assert.match(dailyRoom, /roomName:\s*videoDateRoomNameForSession\(sessionId\)/);
});

test("match-call room creation and answer token flow remain present", () => {
  assert.match(dailyRoom, /if \(action === "create_match_call"\)/);
  assert.match(dailyRoom, /const roomName = `call-\$\{matchId/);
  assert.match(dailyRoom, /await createDailyRoom\(roomName, matchCallRoomProperties\(callTypeValue\)\)/);
  assertOrder(dailyRoom, [
    ["answer action", "if (action === \"answer_match_call\")"],
    ["backend answer transition", "p_action: \"answer\""],
    ["provider room proof", "ensureMatchCallProviderRoomForToken"],
    ["callee token", "token = await createMeetingToken"],
  ]);
});

test("delete_room posture is authenticated, participant-gated, and intentionally supported", () => {
  assert.match(supabaseConfig, /\[functions\.daily-room\][\s\S]{0,80}verify_jwt = true/);
  assert.match(dailyRoom, /\/\/ All actions require auth/);
  assert.match(dailyRoom, /if \(!authHeader\)/);
  assert.match(dailyRoom, /if \(action === "delete_room"\)/);
  assert.match(dailyRoom, /Caller must be a verified participant of the room/);
  assert.match(dailyRoom, /authorized = vsRow\.participant_1_id === user\.id \|\| vsRow\.participant_2_id === user\.id/);
  assert.match(dailyRoom, /authorized = callRow\.caller_id === user\.id \|\| callRow\.callee_id === user\.id/);
  assert.match(dailyRoomContracts, /VIDEO_DATE_CLEANUP_OWNED_BY_CRON/);
  assert.match(dailyRoomContracts, /MATCH_CALL_ACTIVE_ROOM_DELETE_SKIPPED/);
  assert.match(providerSheet, /delete_room` is intentionally supported for client cleanup, but it is not unauthenticated/);
});

test("cleanup workers preserve provider delete posture for terminal rows", () => {
  assert.match(videoDateCleanup, /DAILY_API_KEY/);
  assert.match(videoDateCleanup, /DELETE/);
  assert.match(videoDateCleanup, /daily_room_name/);
  assert.match(matchCallCleanup, /DAILY_API_KEY/);
  assert.match(matchCallCleanup, /provider_deleted_at/);
  assert.match(matchCallCleanup, /DELETE/);
});

test("web and native date paths remain backend prepare-entry gated", () => {
  assert.match(webPrepareEntry, /PREPARE_VIDEO_DATE_ENTRY_ACTION/);
  assert.match(webPrepareEntry, /supabase\.functions\.invoke\("daily-room"/);
  assert.match(webVideoCall, /prepareVideoDateEntry\(sessionId/);
  assert.match(webVideoCall, /action:\s*"prepare_date_entry"/);
  assert.match(nativePrepareEntry, /PREPARE_VIDEO_DATE_ENTRY_ACTION/);
  assert.match(nativePrepareEntry, /supabase\.functions\.invoke\('daily-room'/);
  assert.match(nativeVideoDateApi, /prepareVideoDateEntry\(sessionId, \{ userId, source: 'native_video_date_token' \}\)/);
  assert.match(nativeEntryStartable, /ensureVideoDateStartableBeforeNavigation/);
  assert.match(nativeEntryStartable, /prepareVideoDateEntry\(sessionId/);
});

test("web and native Daily runtime paths preserve join, reconnect, leave, and terminal contracts", () => {
  for (const source of [webVideoCall, nativeDateRoute]) {
    assert.match(source, /participant-joined/);
    assert.match(source, /participant-updated/);
    assert.match(source, /participant-left/);
    assert.match(source, /network-quality-change/);
    assert.match(source, /join\(\{\s*url:\s*[^,]+,\s*token:\s*[^}]+/s);
    assert.match(source, /daily_room_delete_skipped/);
  }
  assert.match(webVideoDatePage, /fetch\(`\$\{SUPABASE_URL\}\/functions\/v1\/daily-room`/);
  assert.match(webVideoDatePage, /keepalive:\s*true/);
  assert.match(webVideoDatePage, /Authorization:\s*`Bearer \$\{token\}`/);
  assert.match(webVideoDatePage, /action:\s*"video_date_leave"/);
  assert.match(nativeDateRoute, /markReconnectPartnerAway/);
  assert.match(nativeDateRoute, /syncVideoDateReconnect/);
});

test("web Daily call objects use the CSP-friendly avoidEval path", () => {
  assert.match(webDailyCallObjectConfig, /const dailyConfig: DailyAdvancedConfigWithVideoDateKnobs = \{\s*avoidEval:\s*true/s);
  assert.match(webDailyCallObjectConfig, /dailyConfig,/);
  assert.match(webVideoCall, /dailyVideoDateCallObjectOptions/);
  assert.match(webMatchCall, /dailyCallObjectOptions/);
  for (const [label, source] of [
    ["web video date", webVideoCall],
    ["web match call", webMatchCall],
  ] as const) {
    const rawCreateCallObjectCalls = source.match(/createCallObject\(\s*\{/g) ?? [];
    assert.deepEqual(rawCreateCallObjectCalls, [], `${label} must use a shared Daily helper for createCallObject`);
  }
});

test("Video Date media contract preserves full remote frame on web and native", () => {
  assert.match(videoDateMediaContract, /VIDEO_DATE_REMOTE_OBJECT_FIT = "contain"/);
  assert.match(videoDateMediaContract, /VIDEO_DATE_SELF_VIEW_OBJECT_FIT = "contain"/);
  assert.match(videoDateMediaContract, /VIDEO_DATE_CAPTURE_ASPECT_RATIO = 9 \/ 16/);
  assert.match(videoDateMediaContract, /VIDEO_DATE_WEB_IDEAL_VIDEO_CONSTRAINTS/);
  assert.match(videoDateMediaContract, /VIDEO_DATE_WEB_PORTRAIT_MEDIUM_VIDEO_CONSTRAINTS/);
  assert.match(videoDateMediaContract, /VIDEO_DATE_WEB_PORTRAIT_COMPATIBLE_VIDEO_CONSTRAINTS/);
  assert.match(videoDateMediaContract, /VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER/);
  assert.match(videoDateMediaContract, /VIDEO_DATE_NATIVE_IDEAL_VIDEO_CONSTRAINTS/);
  assert.match(webDailyCallObjectConfig, /dailyVideoDateCallObjectOptions/);
  assert.match(webDailyCallObjectConfig, /dailyVideoDateCallObjectOptionsWithAppAcquiredMedia/);
  assert.match(webDailyCallObjectConfig, /appAcquiredMedia\?\.videoTrack/);
  assert.match(webDailyCallObjectConfig, /inputSettings:[\s\S]*video:[\s\S]*settings:\s*videoConstraints/);
  assert.match(webDailyCallObjectConfig, /experimentalChromeVideoMuteLightOff:\s*true/);
  assert.doesNotMatch(webDailyCallObjectConfig, /userMediaVideoConstraints/);
  assert.match(webVideoCall, /dailyVideoDateCallObjectOptions\(captureProfileForCall\)/);
  assert.match(webVideoCall, /dailyVideoDateCallObjectOptionsWithAppAcquiredMedia/);
  assert.match(webVideoCall, /for \(const profile of VIDEO_DATE_WEB_CAPTURE_PROFILE_ORDER\)/);
  assert.match(webVideoCall, /getUserMedia\(videoDateWebMediaStreamConstraints\(profile\)\)/);
  assert.match(webVideoCall, /permission_handoff_media_acquired/);
  assert.match(webVideoCall, /daily_media_permission_handoff_fallback_to_preflight/);
  assert.match(webVideoCall, /prewarmAppAcquiredMedia/);
  assert.match(webDailyPrewarm, /dailyVideoDateCallObjectOptionsWithAppAcquiredMedia/);
  assert.match(webDailyPrewarm, /appAcquiredMedia: WebDailyPrewarmAppAcquiredMedia \| null/);
  assert.match(webReadyGateOverlay, /permissionPrewarmMediaRef/);
  assert.match(webReadyGateOverlay, /WEB_READY_GATE_PERMISSION_PREWARM_MEDIA_TTL_MS = 12_000/);
  assert.match(webReadyGateOverlay, /permission_prewarm_media_ttl_expired/);
  assert.match(webReadyGateOverlay, /ready_gate_session_changed/);
  assert.match(webReadyGateOverlay, /appAcquiredMedia: prewarmMedia/);
  assert.match(webReadyGateOverlay, /captureProfile: permissionPrewarmMediaRef\.current\?\.captureProfile/);
  assert.match(webVideoCall, /permissionHandoff\.captureProfile \?\? "ideal"/);
  assert.match(webVideoCall, /VIDEO_DATE_SENDER_CAPTURE_DIAGNOSTIC/);
  assert.doesNotMatch(webVideoCall, /getUserMedia\(\{\s*audio:\s*true,\s*video:\s*true\s*\}\)/);
  const nativeIdealConstraints =
    videoDateMediaContract.match(/VIDEO_DATE_NATIVE_IDEAL_VIDEO_CONSTRAINTS[\s\S]*?\};/)?.[0] ?? "";
  const nativeFallbackConstraints =
    videoDateMediaContract.match(/VIDEO_DATE_NATIVE_FALLBACK_VIDEO_CONSTRAINTS[\s\S]*?\};/)?.[0] ?? "";
  assert.doesNotMatch(nativeIdealConstraints, /\bwidth\s*:/);
  assert.doesNotMatch(nativeIdealConstraints, /\bheight\s*:/);
  assert.doesNotMatch(nativeFallbackConstraints, /\bwidth\s*:/);
  assert.doesNotMatch(nativeFallbackConstraints, /\bheight\s*:/);
  assert.match(webVideoDatePage, /objectFit:\s*VIDEO_DATE_REMOTE_OBJECT_FIT/);
  assert.match(webVideoDatePage, /objectPosition:\s*VIDEO_DATE_REMOTE_OBJECT_POSITION/);
  assert.match(nativeVideoDateDailyMediaConfig, /createVideoDateDailyCallObject/);
  assert.match(nativeVideoDateDailyMediaConfig, /videoDateNativeDailyCallOptions/);
  assert.match(nativeVideoDateDailyMediaConfig, /videoSource:\s*true/);
  assert.match(nativeVideoDateDailyMediaConfig, /audioSource:\s*true/);
  assert.match(nativeVideoDateDailyMediaConfig, /sendSettings:[\s\S]*video:\s*'quality-optimized'/);
  assert.doesNotMatch(nativeVideoDateDailyMediaConfig, /videoDateNativeVideoConstraintsForProfile/);
  assert.doesNotMatch(nativeVideoDateDailyMediaConfig, /userMediaVideoConstraints/);
  assert.doesNotMatch(nativeVideoDateDailyMediaConfig, /dailyConfig/);
  assert.doesNotMatch(nativeVideoDateDailyMediaConfig, /experimentalChromeVideoMuteLightOff/);
  assert.match(nativeDateRoute, /createVideoDateDailyCallObject\(profile\)/);
  assert.match(nativeDateRoute, /daily_call_join_constraint_fallback/);
  assert.doesNotMatch(nativeDateRoute, /Daily\.createCallObject\(/);
  assert.match(nativeDateRoute, /objectFit="contain"/);
});

test("web Daily CSP supports CSP-safe script loading and websocket signaling", () => {
  assert.match(webDailyCallObjectConfig, /avoidEval:\s*true/);
  assert.ok(vercelCspDirective("script-src").includes("https://*.daily.co"));
  assert.ok(!vercelCspDirective("script-src").includes("'unsafe-eval'"));
  assert.ok(vercelCspDirective("connect-src").includes("https://*.daily.co"));
  assert.ok(vercelCspDirective("connect-src").includes("wss://*.daily.co"));
  assert.ok(vercelCspDirective("frame-src").includes("https://*.daily.co"));
});

test("existing match-call paths remain present on web and native", () => {
  for (const source of [webMatchCall, nativeMatchCall]) {
    assert.match(source, /create_match_call|createMatchCall/);
    assert.match(source, /answer_match_call|answerMatchCall/);
    assert.match(source, /join_match_call|joinMatchCall/);
    assert.match(source, /delete_room|deleteMatchCallRoom/);
    assert.match(source, /participant-joined/);
    assert.match(source, /participant-left/);
  }
  assert.match(nativeMatchCallApi, /body:\s*\{ action: 'create_match_call', matchId, callType \}/);
  assert.match(nativeMatchCallApi, /body:\s*\{ action: 'answer_match_call', callId \}/);
  assert.match(nativeMatchCallApi, /body:\s*\{ action: 'join_match_call', callId \}/);
  assert.match(nativeMatchCallApi, /body:\s*\{ action: 'delete_room', roomName \}/);
});

test("Daily operational QA adds no env vars, migrations, native modules, expo-av, or unrelated provider changes", () => {
  const dailyEnvSource = [
    dailyRoom,
    matchCallCleanup,
    videoDateCleanup,
    webVideoCall,
    webMatchCall,
    webPrepareEntry,
    nativeDateRoute,
    nativeVideoDateApi,
    nativePrepareEntry,
    nativeMatchCall,
    nativeMatchCallApi,
  ].join("\n");
  const dailyEnvNames = Array.from(
    new Set([...dailyEnvSource.matchAll(/(?:Deno\.env\.get\(["']|import\.meta\.env\??\.|process\.env\.)([A-Z0-9_]+)/g)]
      .map((match) => match[1])
      .filter((name) => name.includes("DAILY"))),
  ).sort();
  assert.deepEqual(dailyEnvNames, [
    "DAILY_API_KEY",
    "DAILY_DOMAIN",
    "EXPO_PUBLIC_VIDEO_DATE_DAILY_SOLO_PREJOIN",
    "VITE_VIDEO_DATE_DAILY_SOLO_PREJOIN",
  ]);
  assert.equal(
    readdirSync(join(root, "supabase/migrations")).some((name) => name.includes("daily_provider_operational_qa")),
    false,
    "Stream 13 should not add a Supabase migration",
  );
  assert.match(rootPackageJson, /"@daily-co\/daily-js"/);
  assert.match(nativePackageJson, /"@daily-co\/react-native-daily-js"/);
  assert.match(nativePackageJson, /"@daily-co\/react-native-webrtc"/);
  assert.doesNotMatch(nativePackageJson, /"expo-av"\s*:/);
  const nativeFiles = readTreeFiles("apps/mobile", new Set([".ts", ".tsx", ".js", ".jsx"]));
  for (const path of nativeFiles) {
    assert.doesNotMatch(
      read(path),
      /from ['"]expo-av['"]|require\(['"]expo-av['"]\)|import\(['"]expo-av['"]\)/,
      `${path} must not import expo-av`,
    );
  }
  assert.match(branchDelta, /Env var changes: none/);
  assert.match(branchDelta, /Native module changes: none/);
  assert.match(branchDelta, /Supabase migration requirement: none/);
  assert.match(branchDelta, /No Ready Gate, swipe, payment, Bunny, OneSignal, RevenueCat, Resend, or Twilio changes were made/);
});

test("Daily operational QA docs capture read-only checks and manual dashboard follow-up", () => {
  assert.match(branchDelta, /Supabase linked project: `schdyxcunwcvddlcshwd \/ MVP_Vibe`/);
  assert.match(branchDelta, /`daily-room` is deployed and active/);
  assert.match(branchDelta, /`DAILY_API_KEY` and `DAILY_DOMAIN` secret names are present/);
  assert.match(branchDelta, /No real production Daily rooms were created or deleted/);
  assert.match(branchDelta, /Manual Daily Dashboard Checklist/);
  assert.match(branchDelta, /controlled internal Daily QA/);
});
