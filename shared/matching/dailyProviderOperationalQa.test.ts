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

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
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
const webDailyCallInstance = read("src/lib/dailyCallInstance.ts");
const webDailyPrewarm = read("src/lib/videoDateDailyPrewarm.ts");
const webVideoDateReadiness = read("src/hooks/useVideoDateReadiness.ts");
const webReadyGateOverlay = read("src/components/lobby/ReadyGateOverlay.tsx");
const webVideoDatePage = read("src/pages/VideoDate.tsx");
const videoDateMediaContract = read("shared/matching/videoDateMediaContract.ts");
const webPrepareEntry = read("src/lib/videoDatePrepareEntry.ts");
const nativeDateRoute = read("apps/mobile/app/date/[id].tsx");
const nativeVideoDateDailyMediaConfig = read("apps/mobile/lib/videoDateDailyMediaConfig.ts");
const nativeDailyCallInstance = read("apps/mobile/lib/nativeDailyCallInstance.ts");
const nativeDailyPrewarm = read("apps/mobile/lib/videoDateDailyPrewarm.ts");
const nativeVideoDateReadiness = read("apps/mobile/lib/videoDateReadiness.ts");
const nativeReadyGateOverlay = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
const nativeReadyStandalone = read("apps/mobile/app/ready/[id].tsx");
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

test("daily-room fail-closes missing DAILY_DOMAIN outside explicit local fallback", () => {
  assert.match(dailyRoomContracts, /resolveDailyRuntimeConfig/);
  assert.match(dailyRoom, /const DAILY_RUNTIME_CONFIG = resolveDailyRuntimeConfig/);
  assert.match(dailyRoom, /code: "DAILY_CONFIG_BLOCKED"/);
  assert.match(dailyRoom, /dailyConfigRequiredForAction\(action\)/);
  assert.match(dailyRoomContracts, /videoDateRoomUrlForName\(roomName: string, dailyDomain: string\)/);
  assert.match(providerSheet, /fallback is still code-supported for local resilience|DAILY_CONFIG_BLOCKED/i);
  assert.match(branchDelta, /Fallback Domain Posture/);
});

test("room creation calls the Daily REST API with bearer auth", () => {
  assert.match(dailyRoom, /dailyProviderFetch\("create_room", "room_create", `\$\{DAILY_API_URL\}\/rooms`, \{/);
  assert.match(dailyRoom, /fetchWithTimeout\(input, init/);
  assert.match(dailyRoom, /method:\s*"POST"/);
  assert.match(dailyRoom, /Authorization:\s*`Bearer \$\{DAILY_API_KEY\}`/);
  assert.match(dailyRoom, /body:\s*JSON\.stringify\(\{ name: roomName, privacy: "private", properties: props \}\)/);
});

test("meeting token creation remains present and token values stay response-only", () => {
  assert.match(dailyRoom, /dailyProviderFetch\("create_token", "meeting_token", `\$\{DAILY_API_URL\}\/meeting-tokens`, \{/);
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
  assert.match(videoDateCleanup, /fetchWithTimeout/);
  assert.match(videoDateCleanup, /providerRateLimitConfig\("daily", params\.bucket\)/);
  assert.match(videoDateCleanup, /bucket: "room_lookup"/);
  assert.match(videoDateCleanup, /bucket: "room_delete"/);
  assert.match(videoDateCleanup, /Retry-After/);
  assert.doesNotMatch(videoDateCleanup, /(?<!WithTimeout)fetch\(/);
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

test("web Video Date Daily create paths use guarded singleton recovery", () => {
  assert.match(webDailyCallInstance, /getCallInstance\(\)/);
  assert.match(webDailyCallInstance, /isDuplicateDailyCallObjectError/);
  assert.match(webDailyCallInstance, /isBusyDailyMeetingState/);
  assert.match(webDailyCallInstance, /registerWebVideoDateDailyCleanup/);
  assert.match(webDailyCallInstance, /new Set<Promise<void>>/);
  assert.match(webDailyCallInstance, /while \(webVideoDateDailyCleanupPromises\.size > 0\)/);
  assert.match(webDailyCallInstance, /serializeWebVideoDateDailyCreate/);
  assert.match(webDailyCallInstance, /hasWebVideoDateDailyCreatePending/);
  assert.match(webDailyCallInstance, /FRESH_DAILY_CREATE_PROTECTION_MS/);
  assert.match(webDailyCallInstance, /daily_guard_external_call_protected_recent_create/);
  assert.match(webDailyCallInstance, /createDailyCallObjectGuarded/);
  assert.match(webDailyCallInstance, /Duplicate DailyIframe instances\|multiple call instances/);
  assert.match(webDailyCallInstance, /isIdleDailyMeetingState/);
  assert.match(webDailyCallInstance, /state === "new" \|\| state === "loaded"/);

  assert.match(webVideoCall, /createDailyCallObjectGuarded/);
  assert.match(webVideoCall, /registerWebVideoDateDailyCleanup/);
  assert.match(webVideoCall, /daily_call_busy/);
  assert.match(webVideoCall, /waitForCleanup:\s*true/);
  assert.doesNotMatch(webVideoCall, /DailyIframe\.createCallObject\(/);
  assert.doesNotMatch(webVideoCall, /allowMultipleCallInstances/);

  assert.match(webDailyPrewarm, /createDailyCallObjectGuarded/);
  assert.match(webDailyPrewarm, /skipIfCleanupPending:\s*true/);
  assert.match(webDailyPrewarm, /failOnExternalCall:\s*true/);
  assert.match(webDailyPrewarm, /registerWebVideoDateDailyCleanup/);
  assert.doesNotMatch(webDailyPrewarm, /DailyIframe\.createCallObject\(/);
  assert.doesNotMatch(webDailyPrewarm, /allowMultipleCallInstances/);

  assert.match(webVideoDateReadiness, /createDailyCallObjectGuarded/);
  assert.match(webVideoDateReadiness, /failOnExternalCall:\s*true/);
  assert.match(webVideoDateReadiness, /registerWebVideoDateDailyCleanup/);
  assert.doesNotMatch(webVideoDateReadiness, /DailyIframe\.createCallObject\(/);
});

test("native Video Date Daily create paths use guarded singleton recovery", () => {
  assert.match(nativeDailyCallInstance, /Daily\.getCallInstance\(\)/);
  assert.match(nativeDailyCallInstance, /isDuplicateNativeDailyCallObjectError/);
  assert.match(nativeDailyCallInstance, /isBusyNativeDailyMeetingState/);
  assert.match(nativeDailyCallInstance, /registerNativeVideoDateDailyCleanup/);
  assert.match(nativeDailyCallInstance, /new Set<Promise<void>>/);
  assert.match(nativeDailyCallInstance, /while \(nativeVideoDateDailyCleanupPromises\.size > 0\)/);
  assert.match(nativeDailyCallInstance, /serializeNativeVideoDateDailyCreate/);
  assert.match(nativeDailyCallInstance, /hasNativeVideoDateDailyCreatePending/);
  assert.match(nativeDailyCallInstance, /FRESH_NATIVE_DAILY_CREATE_PROTECTION_MS/);
  assert.match(nativeDailyCallInstance, /native_daily_guard_external_call_protected_recent_create/);
  assert.match(nativeDailyCallInstance, /createNativeDailyCallObjectGuarded/);
  assert.match(nativeDailyCallInstance, /Duplicate DailyIframe instances\|multiple call instances/);
  assert.match(nativeDailyCallInstance, /state === 'new' \|\| state === 'loaded'/);

  assert.match(nativeVideoDateDailyMediaConfig, /createVideoDateDailyCallObjectGuarded/);
  assert.match(nativeVideoDateDailyMediaConfig, /createVideoDateDailyDiagnosticCallObjectGuarded/);
  assert.doesNotMatch(nativeVideoDateDailyMediaConfig, /return Daily\.createCallObject/);

  assert.match(nativeDateRoute, /createVideoDateDailyCallObjectGuarded/);
  assert.match(nativeDateRoute, /waitForCleanup:\s*true/);
  assert.match(nativeDateRoute, /native_daily_guard_create_blocked/);
  assert.match(nativeDateRoute, /registerNativeVideoDateDailyCleanup/);
  assert.match(nativeDateRoute, /destroyNativeVideoDateDailyCall/);
  assert.equal(
    countOccurrences(nativeDateRoute, ".destroy()"),
    1,
    "native date route should only destroy Daily through its registered lifecycle helper",
  );
  assert.doesNotMatch(nativeDateRoute, /Daily\.createCallObject\(/);

  assert.match(nativeDailyPrewarm, /createVideoDateDailyCallObjectGuarded/);
  assert.match(nativeDailyPrewarm, /skipIfCleanupPending:\s*true/);
  assert.match(nativeDailyPrewarm, /failOnExternalCall:\s*true/);
  assert.match(nativeDailyPrewarm, /registerNativeVideoDateDailyCleanup/);

  assert.match(nativeVideoDateReadiness, /createVideoDateDailyDiagnosticCallObjectGuarded/);
  assert.match(nativeVideoDateReadiness, /failOnExternalCall:\s*true/);
  assert.match(nativeVideoDateReadiness, /registerNativeVideoDateDailyCleanup/);
});

test("web Ready Gate prepare handoff can recover after prepare failure or exception", () => {
  assert.match(webReadyGateOverlay, /prepareEntryHandoffStartedRef\.current = true/);
  assert.match(webReadyGateOverlay, /suppressDuplicateNav\(prepareEntryHandoffStartedRef\.current \? "prepare_entry_inflight" : "date_navigation_inflight"\)/);
  assert.match(webReadyGateOverlay, /if \(exhausted\) \{[\s\S]*prepareEntryHandoffStartedRef\.current = false[\s\S]*setPrepareEntryStatus\("failed"\)/);
  assert.match(webReadyGateOverlay, /catch \(error\) \{[\s\S]*prepareEntryHandoffStartedRef\.current = false[\s\S]*PREPARE_ENTRY_CLIENT_EXCEPTION/);
  assert.match(webReadyGateOverlay, /const retryPrepareEntry = useCallback/);
});

test("native Ready Gate prepare handoff can recover after prepare failure or exception", () => {
  assert.match(nativeReadyGateOverlay, /prepareEntryHandoffStartedRef\.current = true/);
  assert.match(nativeReadyGateOverlay, /const prewarm = await startNativeVideoDateDailyPrewarm/);
  assert.match(nativeReadyStandalone, /const prewarm = await startNativeVideoDateDailyPrewarm/);
  assert.match(nativeReadyGateOverlay, /if \(exhausted\) \{[\s\S]*prepareEntryHandoffStartedRef\.current = false/);
  assert.match(nativeReadyGateOverlay, /if \(exhausted\) \{[\s\S]*setPrepareEntryStatus\('failed'\)/);
  assert.match(nativeReadyGateOverlay, /catch \(error\) \{[\s\S]*prepareEntryHandoffStartedRef\.current = false[\s\S]*PREPARE_ENTRY_CLIENT_EXCEPTION/);
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
  assert.match(webReadyGateOverlay, /getReadyGatePermissionPrewarmReleaseDelayMs/);
  assert.match(webReadyGateOverlay, /settings_deep_link/);
  assert.match(webReadyGateOverlay, /permission_prewarm_media_ttl_expired/);
  assert.match(webReadyGateOverlay, /ready_gate_session_changed/);
  assert.match(webReadyGateOverlay, /appAcquiredMedia: prewarmMedia/);
  assert.match(webReadyGateOverlay, /captureProfile: prewarmMedia\?\.captureProfile/);
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
  assert.match(nativeVideoDateDailyMediaConfig, /createVideoDateDailyCallObjectGuarded/);
  assert.match(nativeVideoDateDailyMediaConfig, /videoDateNativeDailyCallOptions/);
  assert.match(nativeVideoDateDailyMediaConfig, /videoSource:\s*true/);
  assert.match(nativeVideoDateDailyMediaConfig, /audioSource:\s*true/);
  assert.match(nativeVideoDateDailyMediaConfig, /sendSettings:[\s\S]*video:\s*'quality-optimized'/);
  assert.doesNotMatch(nativeVideoDateDailyMediaConfig, /videoDateNativeVideoConstraintsForProfile/);
  assert.doesNotMatch(nativeVideoDateDailyMediaConfig, /userMediaVideoConstraints/);
  assert.doesNotMatch(nativeVideoDateDailyMediaConfig, /dailyConfig/);
  assert.doesNotMatch(nativeVideoDateDailyMediaConfig, /experimentalChromeVideoMuteLightOff/);
  assert.match(nativeDateRoute, /createVideoDateDailyCallObjectGuarded\(profile/);
  assert.match(nativeDateRoute, /daily_call_join_constraint_fallback/);
  assert.doesNotMatch(nativeDateRoute, /Daily\.createCallObject\(/);
  assert.match(nativeDateRoute, /objectFit="contain"/);
});

test("web Daily CSP supports CSP-safe script loading and websocket signaling", () => {
  assert.match(webDailyCallObjectConfig, /avoidEval:\s*true/);
  assert.ok(vercelCspDirective("script-src").includes("https://vibelyapp.daily.co"));
  assert.ok(vercelCspDirective("script-src").includes("https://c.daily.co"));
  assert.deepEqual(
    [...vercelCspDirective("script-src-elem")].sort(),
    [...vercelCspDirective("script-src")].sort(),
  );
  assert.ok(vercelCspDirective("script-src-elem").includes("https://vibelyapp.daily.co"));
  assert.ok(vercelCspDirective("script-src-elem").includes("https://c.daily.co"));
  assert.ok(!vercelCspDirective("script-src").includes("https://*.daily.co"));
  assert.ok(!vercelCspDirective("script-src-elem").includes("https://*.daily.co"));
  assert.ok(!vercelCspDirective("script-src").includes("'unsafe-eval'"));
  assert.ok(!vercelCspDirective("script-src-elem").includes("'unsafe-eval'"));
  assert.ok(!vercelCspDirective("connect-src").includes("https://*.daily.co"));
  assert.ok(!vercelCspDirective("connect-src").includes("wss://*.daily.co"));
  assert.ok(vercelCspDirective("connect-src").includes("https://api.daily.co"));
  assert.ok(vercelCspDirective("connect-src").includes("https://vibelyapp.daily.co"));
  assert.ok(vercelCspDirective("connect-src").includes("wss://vibelyapp.daily.co"));
  assert.ok(vercelCspDirective("frame-src").includes("https://vibelyapp.daily.co"));
  assert.ok(!vercelCspDirective("frame-src").includes("https://*.daily.co"));
});

test("existing match-call paths remain present on web and native", () => {
  for (const source of [webMatchCall, nativeMatchCall]) {
    assert.match(source, /create_match_call|createMatchCall/);
    assert.match(source, /answer_match_call|answerMatchCall/);
    assert.match(source, /join_match_call|joinMatchCall/);
    assert.match(source, /delete_room|deleteMatchCallRoom/);
    assert.match(source, /startCallAttemptRef/);
    assert.match(source, /startCallLockRef/);
    assert.match(source, /runSingleJoinFlow/);
    assert.match(source, /joiningCallIdRef/);
    assert.match(source, /joinPromiseRef/);
    assert.match(source, /queueReconcileCallRow/);
    assert.match(source, /start_call_watchdog_fired/);
    assert.match(source, /start_call_stale_success_ignored/);
    assert.doesNotMatch(
      source,
      /if \(!isCurrentStartCallAttempt\(\)\) \{\s*await (transitionCall|transitionMatchCall)\(callId, ["']join_failed["']\)/,
    );
    assert.match(source, /participant-joined/);
    assert.match(source, /participant-left/);
  }
  assert.match(nativeMatchCallApi, /body:\s*\{ action: 'create_match_call', matchId, callType \}/);
  assert.match(nativeMatchCallApi, /body:\s*\{ action: 'answer_match_call', callId \}/);
  assert.match(nativeMatchCallApi, /body:\s*\{ action: 'join_match_call', callId \}/);
  assert.match(nativeMatchCallApi, /body:\s*\{ action: 'delete_room', roomName \}/);
});

test("chat MatchCall Daily errors use one-shot provider teardown", () => {
  for (const source of [webMatchCall, nativeMatchCall]) {
    assert.match(source, /providerTeardownPromiseRef/);
    assert.match(source, /const teardownForProviderError = useCallback/);
    assert.match(source, /const waitForProviderTeardown = useCallback/);
    assert.match(source, /provider_teardown_deduped/);
    assert.match(source, /provider_teardown_awaited_by_flow/);
    assert.match(source, /Promise\.resolve\(\)\s*\.\s*then\(\(\) => endCall\(["']provider_error["']\)\)/);
    assert.match(source, /endCall\(["']provider_error["']\)/);
    assert.match(source, /if \(await waitForProviderTeardown\(["']answer_call_catch["']\)\) return/);
    assert.match(source, /if \(await waitForProviderTeardown\(["']start_call_catch["']\)\)[\s\S]*return/);
    assert.match(source, /if \(await waitForProviderTeardown\(["']active_rejoin_catch["']\)\) return/);
    assert.match(
      source,
      /callObject\.on\(["']error["'],\s*\([^)]*event[^)]*\)\s*=>[\s\S]*teardownForProviderError\(["']daily_error["'],\s*event\)/,
    );
    assert.match(
      source,
      /callObject\.on\(["']left-meeting["'],\s*\([^)]*event[^)]*\)\s*=>[\s\S]*dailyEventHasError\(event\)[\s\S]*teardownForProviderError\(["']left_meeting_error["'],\s*event\)/,
    );
  }
  assert.match(webMatchCall, /toast\.error\(["']Call connection error["']\)/);
  assert.match(nativeMatchCall, /Alert\.alert\(["']Call connection error["'],\s*["']Please try again\.["']\)/);
});

test("chat MatchCall cleanup owns Daily ref clearing and destroy", () => {
  for (const source of [webMatchCall, nativeMatchCall]) {
    const cleanupStart = source.indexOf("const cleanupLocalCall = useCallback");
    const cleanupEnd = source.indexOf("const runSingleJoinFlow", cleanupStart);
    const eventsStart = source.indexOf("const setupCallEvents = useCallback");
    const eventsEnd = source.indexOf("const markIncomingCallMissed", eventsStart);
    assert.ok(cleanupStart > 0 && cleanupEnd > cleanupStart, "cleanupLocalCall block should exist");
    assert.ok(eventsStart > 0 && eventsEnd > eventsStart, "setupCallEvents block should exist");

    const cleanupBlock = source.slice(cleanupStart, cleanupEnd);
    const eventBlock = source.slice(eventsStart, eventsEnd);
    assert.match(cleanupBlock, /localCallCleanupPromiseRef/);
    assert.match(cleanupBlock, /const cleanupPromise = Promise\.resolve\(\)\.then\(async \(\) =>/);
    assert.match(cleanupBlock, /preserveCallStateCleanupRef\.current = true/);
    assert.match(cleanupBlock, /callObjectRef\.current = null/);
    assert.match(cleanupBlock, /await callObject\.destroy\(\)/);
    assert.match(eventBlock, /if \(preserveCallStateCleanupRef\.current\) return/);
    assert.doesNotMatch(eventBlock, /callObjectRef\.current = null/);
  }
});

test("chat MatchCall fresh creates recover stale or duplicate Daily objects", () => {
  for (const source of [webMatchCall, nativeMatchCall]) {
    assert.match(source, /isReusableDailyCallObject/);
    assert.match(source, /readDailyMeetingState\(callObject\)\s*={2,3}\s*["']joined-meeting["']/);
    assert.match(source, /isBusyDailyMeetingState/);
    assert.match(source, /return !isTerminalDailyMeetingState\(state\)/);
    assert.match(source, /fresh_create_duplicate_daily_instance_busy/);
    assert.match(source, /cleanupStaleCallObjectForFreshCreate/);
    assert.match(source, /fresh_create_cleaned_stale_call_object/);
    assert.match(source, /fresh_create_recovered_duplicate_daily_instance/);
    assert.match(source, /getCallInstance\(\)/);
    assert.match(source, /const callObject = await createFreshMatchCallObject/);
    assert.match(source, /preserveCallState:\s*true/);
    assert.doesNotMatch(source, /allowMultipleCallInstances/);
    assert.doesNotMatch(source, /skipped_duplicate_join/);
  }
});

test("chat MatchCall refuses to steal non-terminal Daily singletons from other surfaces", () => {
  for (const source of [webMatchCall, nativeMatchCall]) {
    const joinStart = source.indexOf("const joinActiveCall = useCallback");
    const joinEnd = source.indexOf("const reconcileCallRow", joinStart);
    assert.ok(joinStart > 0 && joinEnd > joinStart, "joinActiveCall block should exist");
    const joinBlock = source.slice(joinStart, joinEnd);

    assert.match(source, /const hasBusyExternalDailyCall = useCallback/);
    assert.match(source, /external_daily_call_busy/);
    assert.match(source, /answer_call_preflight/);
    assert.match(source, /start_call_preflight/);
    assert.match(source, /active_rejoin_preflight/);
    assert.match(source, /if \(await hasBusyExternalDailyCall\(["']answer_call_preflight["']\)\)/);
    assert.match(source, /if \(await hasBusyExternalDailyCall\(["']start_call_preflight["']\)\)/);
    assert.match(source, /if \(!callObjectRef\.current && await hasBusyExternalDailyCall\(["']active_rejoin_preflight["']\)\)/);
    assert.match(source, /if \(!isBusyDailyMeetingState\(meetingState\)\) return false/);
    assert.match(source, /fresh_create_duplicate_daily_instance_busy/);
    assert.ok(
      joinBlock.indexOf("active_rejoin_preflight") < joinBlock.indexOf("trackedCallIdRef.current = row.id"),
      "active rejoin should check external Daily ownership before mutating local chat-call refs",
    );
  }
});

test("match_call_transition keeps duplicate answer and decline idempotent", () => {
  const amendment = read(
    "supabase/migrations/20260510150000_match_call_transition_idempotent_duplicate_events.sql",
  );
  assert.match(
    amendment,
    /p_action IN \('end', 'mark_missed', 'join_failed'\)\s+OR \(p_action = 'decline' AND v_call.status = 'declined'\)/,
  );
  assert.match(amendment, /IF v_call.status = 'active' THEN[\s\S]*'idempotent', true/s);
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
