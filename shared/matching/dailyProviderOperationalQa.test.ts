import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { readWebVideoCallFlowSource, readWebVideoDatePageFlowSource } from "../testUtils/webVideoDateFlowSources";
import { readNativeVideoDateScreenFlowSource } from "../testUtils/nativeVideoDateFlowSources";

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
const videoDateCleanup = read("supabase/functions/video-date-room-cleanup/index.ts");
const supabaseConfig = read("supabase/config.toml");
const webVideoCall = readWebVideoCallFlowSource(root);
const webDailyCallObjectConfig = read("src/lib/dailyCallObjectConfig.ts");
const webDailyCallInstance = read("src/lib/dailyCallInstance.ts");
const webDailyPrewarm = read("src/lib/videoDateDailyPrewarm.ts");
const webVideoDateReadiness = read("src/hooks/useVideoDateReadiness.ts");
const webReadyGateOverlay = read("src/components/lobby/ReadyGateOverlay.tsx");
const webVideoDatePage = readWebVideoDatePageFlowSource(root);
const videoDateMediaContract = read("shared/matching/videoDateMediaContract.ts");
const webPrepareEntry = read("src/lib/videoDatePrepareEntry.ts");
const nativeDateRoute = readNativeVideoDateScreenFlowSource();
const nativeVideoDateDailyMediaConfig = read("apps/mobile/lib/videoDateDailyMediaConfig.ts");
const nativeDailyCallInstance = read("apps/mobile/lib/nativeDailyCallInstance.ts");
const nativeDailyPrewarm = read("apps/mobile/lib/videoDateDailyPrewarm.ts");
const nativeVideoDateReadiness = read("apps/mobile/lib/videoDateReadiness.ts");
const nativeReadyGateOverlay = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
const nativeReadyStandalone = read("apps/mobile/app/ready/[id].tsx");
const nativeVideoDateApi = read("apps/mobile/lib/videoDateApi.ts");
const nativePrepareEntry = read("apps/mobile/lib/videoDatePrepareEntry.ts");
const nativeEntryStartable = read("apps/mobile/lib/videoDateEntryStartable.ts");
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

test("daily-room no longer exposes chat Match Call room or token actions", () => {
  for (const action of ["create_match_call", "answer_match_call", "join_match_call"] as const) {
    assert.doesNotMatch(dailyRoom, new RegExp(`if \\(action === "${action}"\\)`));
    assert.doesNotMatch(dailyRoom, new RegExp(`["']${action}["']`));
  }
  assert.doesNotMatch(dailyRoom, /matchCallRoomProperties/);
  assert.doesNotMatch(dailyRoom, /ensureMatchCallProviderRoomForToken/);
  assert.doesNotMatch(dailyRoom, /`call-\$\{matchId/);
  assert.match(dailyRoom, /if \(action === "prepare_date_entry"\)/);
});

test("delete_room posture is authenticated, participant-gated, and intentionally supported", () => {
  assert.match(supabaseConfig, /\[functions\.daily-room\][\s\S]{0,80}verify_jwt = true/);
  assert.match(dailyRoom, /\/\/ All actions require auth/);
  assert.match(dailyRoom, /if \(!authHeader\)/);
  assert.match(dailyRoom, /if \(action === "delete_room"\)/);
  assert.match(dailyRoom, /Caller must be a verified participant of the Video Date room/);
  assert.match(dailyRoom, /authorized = vsRow\.participant_1_id === user\.id \|\| vsRow\.participant_2_id === user\.id/);
  assert.match(dailyRoomContracts, /VIDEO_DATE_CLEANUP_OWNED_BY_CRON/);
  assert.doesNotMatch(dailyRoomContracts, /MATCH_CALL/);
  assert.match(providerSheet, /delete_room` is intentionally supported for client cleanup, but it is not unauthenticated/);
});

test("video-date cleanup worker preserves provider delete posture for terminal rows", () => {
  assert.match(videoDateCleanup, /DAILY_API_KEY/);
  assert.match(videoDateCleanup, /DELETE/);
  assert.match(videoDateCleanup, /daily_room_name/);
  assert.match(videoDateCleanup, /fetchWithTimeout/);
  assert.match(videoDateCleanup, /providerRateLimitConfig\("daily", params\.bucket\)/);
  assert.match(videoDateCleanup, /bucket: "room_lookup"/);
  assert.match(videoDateCleanup, /bucket: "room_delete"/);
  assert.match(videoDateCleanup, /Retry-After/);
  assert.doesNotMatch(videoDateCleanup, /(?<!WithTimeout)fetch\(/);
  assert.equal(existsSync(join(root, "supabase/functions/match-call-room-cleanup/index.ts")), false);
});

test("web and native date paths remain backend prepare-entry gated", () => {
  assert.match(webPrepareEntry, /PREPARE_VIDEO_DATE_ENTRY_ACTION/);
  assert.match(webPrepareEntry, /supabase\.functions\.invoke\("daily-room"/);
  assert.match(webVideoCall, /prepareVideoDateEntry\(sessionId/);
  assert.match(webVideoCall, /action:\s*"prepare_date_entry"/);
  assert.match(nativePrepareEntry, /PREPARE_VIDEO_DATE_ENTRY_ACTION/);
  assert.match(nativePrepareEntry, /supabase\.functions\.invoke\('daily-room'/);
  assert.match(nativeVideoDateApi, /recoverMissingPreparedEntryForNativeDateRoute/);
  assert.match(nativeVideoDateApi, /source: 'native_date_route_recover_missing_prepared_entry'/);
  assert.match(nativeEntryStartable, /ensureVideoDateStartableBeforeNavigation/);
  assert.doesNotMatch(nativeEntryStartable, /prepareVideoDateEntry/);
  assert.match(nativeEntryStartable, /ready_gate_pre_nav_deferred_to_prepare_owner/);
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
  assert.match(webVideoDatePage, /fetch\(\s*`\$\{SUPABASE_URL\}\/functions\/v1\/daily-room`/);
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
  const rawCreateCallObjectCalls = webVideoCall.match(/createCallObject\(\s*\{/g) ?? [];
  assert.deepEqual(rawCreateCallObjectCalls, [], "web video date must use a shared Daily helper for createCallObject");
  assert.equal(existsSync(join(root, "src/hooks/useMatchCall.tsx")), false);
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
  assert.match(webDailyCallInstance, /Duplicate\\s\+DailyIframe\\s\+instances/);
  assert.match(webDailyCallInstance, /multiple\\s\+call\\s\+instances/);
  assert.match(webDailyCallInstance, /call\\s\+object\.\*already/);
  assert.match(webDailyCallInstance, /existing\\s\+call\\s\+instance/);
  assert.match(webDailyCallInstance, /WEB_VIDEO_DATE_DAILY_CLEANUP_WAIT_TIMEOUT_MS/);
  assert.match(webDailyCallInstance, /WEB_VIDEO_DATE_DAILY_DESTROY_TIMEOUT_MS/);
  assert.match(webDailyCallInstance, /web_video_date_daily_cleanup_wait_timed_out/);
  assert.match(webDailyCallInstance, /daily_guard_destroy_external_call_timed_out/);
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

  assert.doesNotMatch(webVideoDateReadiness, /createDailyCallObjectGuarded/);
  assert.doesNotMatch(webVideoDateReadiness, /failOnExternalCall:\s*true/);
  assert.doesNotMatch(webVideoDateReadiness, /registerWebVideoDateDailyCleanup/);
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
  assert.match(nativeDailyCallInstance, /Duplicate\\s\+DailyIframe\\s\+instances/);
  assert.match(nativeDailyCallInstance, /multiple\\s\+call\\s\+instances/);
  assert.match(nativeDailyCallInstance, /call\\s\+object\.\*already/);
  assert.match(nativeDailyCallInstance, /existing\\s\+call\\s\+instance/);
  assert.match(nativeDailyCallInstance, /NATIVE_VIDEO_DATE_DAILY_CLEANUP_WAIT_TIMEOUT_MS/);
  assert.match(nativeDailyCallInstance, /NATIVE_VIDEO_DATE_DAILY_DESTROY_TIMEOUT_MS/);
  assert.match(nativeDailyCallInstance, /native_video_date_daily_cleanup_wait_timed_out/);
  assert.match(nativeDailyCallInstance, /native_daily_guard_destroy_external_call_timed_out/);
  assert.match(nativeDailyCallInstance, /state === ["']new["'] \|\|\s*state === ["']loaded["']/);

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

  assert.doesNotMatch(nativeVideoDateReadiness, /createVideoDateDailyDiagnosticCallObjectGuarded/);
  assert.doesNotMatch(nativeVideoDateReadiness, /failOnExternalCall:\s*true/);
  assert.doesNotMatch(nativeVideoDateReadiness, /registerNativeVideoDateDailyCleanup/);
});

test("web Ready Gate prepare handoff can recover after prepare failure or exception", () => {
  assert.match(webReadyGateOverlay, /prepareEntryHandoffStartedRef\.current = true/);
  assert.match(
    webReadyGateOverlay,
    /suppressDuplicateNav\(\s*prepareEntryHandoffStartedRef\.current\s*\?\s*"prepare_entry_inflight"\s*:\s*"date_navigation_inflight",?\s*\)/,
  );
  assert.match(webReadyGateOverlay, /void startWebVideoDateDailyPrewarm\(\{[^}]*source: "ready_gate_prepare_success"/);
  assert.match(webReadyGateOverlay, /ready_gate_daily_prewarm_prepare_success_failed/);
  assert.doesNotMatch(webReadyGateOverlay, /const prewarm = await startWebVideoDateDailyPrewarm\(\{[^}]*source: "ready_gate_prepare_success"/);
  assert.match(webVideoCall, /daily_prewarm_reconsumed_after_guard_blocked/);
  assert.match(webVideoCall, /prewarmRecoveryReason: recoveredPrewarm\.reason/);
  assert.match(webVideoCall, /const refreshPrewarmJoinState = \(\) =>/);
  assert.match(webReadyGateOverlay, /if \(exhausted\)/);
  assert.match(webReadyGateOverlay, /prepareEntryHandoffStartedRef\.current = false/);
  assert.match(webReadyGateOverlay, /setPrepareEntryStatus\("failed"\)/);
  assert.match(webReadyGateOverlay, /catch \(error\) \{[\s\S]*prepareEntryHandoffStartedRef\.current = false[\s\S]*PREPARE_ENTRY_CLIENT_EXCEPTION/);
  assert.match(webReadyGateOverlay, /const retryPrepareEntry = useCallback/);
});

test("native Ready Gate prepare handoff can recover after prepare failure or exception", () => {
  assert.match(nativeReadyGateOverlay, /prepareEntryHandoffStartedRef\.current = true/);
  assert.match(nativeReadyGateOverlay, /void startNativeVideoDateDailyPrewarm\(\{[^}]*source: 'ready_gate_prepare_success'/);
  assert.match(nativeReadyGateOverlay, /ready_gate_daily_prewarm_prepare_success_failed/);
  assert.match(nativeReadyStandalone, /void startNativeVideoDateDailyPrewarm\(\{[^}]*source: `ready_standalone_\$\{source\}`/);
  assert.match(nativeReadyStandalone, /standalone_daily_prewarm_failed_before_date_nav/);
  assert.doesNotMatch(nativeReadyGateOverlay, /const prewarm = await startNativeVideoDateDailyPrewarm\(\{[^}]*source: 'ready_gate_prepare_success'/);
  assert.doesNotMatch(nativeReadyStandalone, /const prewarm = await startNativeVideoDateDailyPrewarm/);
  assert.match(nativeReadyGateOverlay, /if \(exhausted\) \{[\s\S]*prepareEntryHandoffStartedRef\.current = false/);
  assert.match(nativeReadyGateOverlay, /if \(exhausted\)/);
  assert.match(nativeReadyGateOverlay, /setPrepareEntryStatus\('failed'\)/);
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
  assert.match(webVideoCall, /getUserMedia\(\s*videoDateWebMediaStreamConstraints\(profile\)/);
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
  assert.match(nativeDateRoute, /createVideoDateDailyCallObjectGuarded\(\s*profile/);
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
  assert.ok(vercelCspDirective("connect-src").includes("https://*.daily.co"));
  assert.ok(vercelCspDirective("connect-src").includes("wss://*.daily.co"));
  assert.ok(vercelCspDirective("connect-src").includes("https://api.daily.co"));
  assert.ok(vercelCspDirective("connect-src").includes("https://vibelyapp.daily.co"));
  assert.ok(vercelCspDirective("connect-src").includes("wss://vibelyapp.daily.co"));
  assert.ok(vercelCspDirective("frame-src").includes("https://vibelyapp.daily.co"));
  assert.ok(!vercelCspDirective("frame-src").includes("https://*.daily.co"));
});

test("chat MatchCall Daily paths are removed from source and schema contract", () => {
  const removalMigration = read("supabase/migrations/20260609224646_remove_match_calls.sql");
  const webChat = read("src/pages/Chat.tsx");
  const nativeChat = read("apps/mobile/app/chat/[id].tsx");
  const generatedTypes = read("src/integrations/supabase/types.ts");

  for (const path of [
    "src/hooks/useMatchCall.tsx",
    "src/components/chat/IncomingCallOverlay.tsx",
    "src/components/chat/ActiveCallOverlay.tsx",
    "apps/mobile/lib/useMatchCall.tsx",
    "apps/mobile/lib/matchCallApi.ts",
    "apps/mobile/components/chat/IncomingCallOverlay.tsx",
    "apps/mobile/components/chat/ActiveCallOverlay.tsx",
    "supabase/functions/match-call-room-cleanup/index.ts",
  ]) {
    assert.equal(existsSync(join(root, path)), false, `${path} should be removed`);
  }

  for (const source of [dailyRoom, webChat, nativeChat, generatedTypes]) {
    assert.doesNotMatch(source, /create_match_call|answer_match_call|join_match_call/);
    assert.doesNotMatch(source, /match_call_transition|expire_stale_match_calls|notify_match_calls/);
  }
  assert.doesNotMatch(dailyRoom, /match_calls|MatchCall|matchCall/);
  assert.doesNotMatch(generatedTypes, /\bmatch_calls\b/);
  assert.match(removalMigration, /DROP TABLE IF EXISTS public\.match_calls CASCADE/);
  assert.match(removalMigration, /DROP FUNCTION IF EXISTS public\.match_call_transition\(uuid, text, text\)/);
  assert.match(removalMigration, /DROP FUNCTION IF EXISTS public\.expire_stale_match_calls\(\)/);
});

test("Daily operational QA adds no env vars, migrations, native modules, expo-av, or unrelated provider changes", () => {
  const dailyEnvSource = [
    dailyRoom,
    videoDateCleanup,
    webVideoCall,
    webPrepareEntry,
    nativeDateRoute,
    nativeVideoDateApi,
    nativePrepareEntry,
  ].join("\n");
  const dailyEnvNames = Array.from(
    new Set([...dailyEnvSource.matchAll(/(?:Deno\.env\.get\(["']|import\.meta\.env\??\.|process\.env\.)([A-Z0-9_]+)/g)]
      .map((match) => match[1])
      .filter((name) => name.includes("DAILY"))),
  ).sort();
  assert.deepEqual(dailyEnvNames, [
    "DAILY_API_KEY",
    "DAILY_DOMAIN",
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
