import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  isReadyGatePrepareEntryNonRetryable,
  resolveReadyGateTerminalRecovery,
} from "./readyGateTerminalRecovery";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const nativeReadyGateApi = read("apps/mobile/lib/readyGateApi.ts");
const nativeReadyGateOverlay = read(
  "apps/mobile/components/lobby/ReadyGateOverlay.tsx",
);
const nativeReadyRoute = read("apps/mobile/app/ready/[id].tsx");
const nativeEventLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const nativeDateRoute = read("apps/mobile/app/date/[id].tsx");
const nativeMediaPermissions = read(
  "apps/mobile/lib/nativeMediaPermissions.ts",
);
const nativePrepareEntry = read("apps/mobile/lib/videoDatePrepareEntry.ts");
const nativeEntryStartable = read("apps/mobile/lib/videoDateEntryStartable.ts");
const nativeActiveSession = read("apps/mobile/lib/useActiveSession.ts");
const contractDoc = read("docs/ready-gate-backend-contract.md");

const nativeConsumerFiles = [
  "apps/mobile/lib/readyGateApi.ts",
  "apps/mobile/components/lobby/ReadyGateOverlay.tsx",
  "apps/mobile/app/ready/[id].tsx",
  "apps/mobile/app/event/[eventId]/lobby.tsx",
  "apps/mobile/app/date/[id].tsx",
  "apps/mobile/lib/videoDateApi.ts",
  "apps/mobile/lib/videoDatePrepareEntry.ts",
  "apps/mobile/lib/videoDateEntryStartable.ts",
  "apps/mobile/lib/useActiveSession.ts",
];

const forbiddenVideoSessionFields = [
  "ready_gate_status",
  "ready_participant_1_at",
  "ready_participant_2_at",
  "ready_gate_expires_at",
  "snoozed_by",
  "snooze_expires_at",
  "state",
  "phase",
  "ended_at",
  "ended_reason",
];

const forbiddenRegistrationFields = [
  "queue_status",
  "current_room_id",
  "current_partner_id",
];

function assertNoForbiddenSupabaseWrites(
  paths: string[],
  table: string,
  fields: readonly string[],
) {
  const fieldPattern = fields.join("|");
  const mutationPattern = new RegExp(
    String.raw`\.from\(\s*['"]${table}['"]\s*\)[\s\S]{0,1400}\.(?:update|insert|upsert)\(\s*(?:\{[\s\S]{0,900})?(?:${fieldPattern})`,
    "m",
  );

  for (const path of paths) {
    assert.doesNotMatch(
      read(path),
      mutationPattern,
      `${path} must not directly mutate ${table} lifecycle fields`,
    );
  }
}

test("native Ready Gate API uses canonical ready_gate_transition actions", () => {
  assert.match(nativeReadyGateApi, /ready_gate_transition/);
  for (const action of ["sync", "mark_ready", "forfeit", "snooze"]) {
    assert.match(nativeReadyGateApi, new RegExp(`['"]${action}['"]`));
  }
});

test("native Ready Gate API preserves additive terminal fields and event-ended reasons", () => {
  for (const field of [
    "reason",
    "inactive_reason",
    "error_code",
    "code",
    "terminal",
    "ready_gate_status",
    "ended_reason",
  ]) {
    assert.match(nativeReadyGateApi, new RegExp(`${field}\\??:`));
  }
  assert.match(
    nativeReadyGateApi,
    /onForfeited\?: \(reason: 'timeout' \| 'skip', detail\?: ReadyGateTerminalDetail\)/,
  );
  assert.match(nativeReadyGateApi, /truth\.reason \?\? truth\.ended_reason/);
  assert.match(nativeReadyGateApi, /payload\.success === false/);
});

test("native terminal recovery preserves skip vs timeout and event-inactive truth", () => {
  assert.equal(
    resolveReadyGateTerminalRecovery({
      status: "forfeited",
      reason: "ready_gate_forfeit",
    }).category,
    "partner_forfeited",
  );
  assert.equal(
    resolveReadyGateTerminalRecovery({
      status: "expired",
      reason: "ready_gate_expired",
    }).category,
    "expired",
  );
  assert.equal(
    resolveReadyGateTerminalRecovery({
      status: "expired",
      reason: "ready_gate_event_ended",
    }).category,
    "event_ended",
  );
  assert.equal(
    resolveReadyGateTerminalRecovery({ inactiveReason: "event_cancelled" })
      .category,
    "event_cancelled",
  );
  assert.equal(
    resolveReadyGateTerminalRecovery({ inactiveReason: "event_archived" })
      .category,
    "event_archived",
  );
  assert.equal(
    isReadyGatePrepareEntryNonRetryable({ errorCode: "EVENT_NOT_ACTIVE" }),
    true,
  );
});

test("native overlay maps terminal recovery and observes duplicate side effects", () => {
  assert.match(nativeReadyGateOverlay, /resolveReadyGateTerminalRecovery/);
  assert.match(nativeReadyGateOverlay, /isReadyGatePrepareEntryNonRetryable/);
  assert.match(nativeReadyGateOverlay, /NativeReadyGateEvents/);
  assert.match(
    nativeReadyGateOverlay,
    /native_ready_gate_duplicate_nav_suppressed/,
  );
  assert.match(
    nativeReadyGateOverlay,
    /native_ready_gate_duplicate_terminal_suppressed/,
  );
  assert.match(nativeReadyGateOverlay, /duplicateNavSuppressionKeysRef/);
  assert.match(nativeReadyGateOverlay, /duplicateTerminalSuppressionKeysRef/);
  assert.match(nativeReadyGateOverlay, /nonRetryablePrepareFailureRef/);
});

test("native Ready Gate auto permission checks do not trigger OS prompts before user intent", () => {
  assert.match(
    nativeReadyRoute,
    /if \(!sessionId \|\| !user\?\.id \|\| !permissionRequestEligible\) return;\s*if \(permissionsResolved\) return;[\s\S]+const ok = await checkMediaPermissions\(\);/,
  );
  assert.match(
    nativeReadyGateOverlay,
    /useEffect\(\(\) => \{\s*if \(permissionsResolved\) return;[\s\S]+const ok = await checkMediaPermissions\(\);/,
  );
  const standaloneAutoCheck =
    /void \(async \(\) => \{[\s\S]*?const ok = await checkMediaPermissions\(\);[\s\S]*?\}\)\(\);/.exec(
      nativeReadyRoute,
    )?.[0] ?? "";
  const overlayAutoCheck =
    /void \(async \(\) => \{[\s\S]*?const ok = await checkMediaPermissions\(\);[\s\S]*?\}\)\(\);/.exec(
      nativeReadyGateOverlay,
    )?.[0] ?? "";
  assert.ok(standaloneAutoCheck);
  assert.ok(overlayAutoCheck);
  assert.doesNotMatch(standaloneAutoCheck, /requestMediaPermissions\(\)/);
  assert.doesNotMatch(overlayAutoCheck, /requestMediaPermissions\(\)/);
});

test("native ready and date surfaces share one camera and microphone permission helper", () => {
  assert.match(
    nativeMediaPermissions,
    /PermissionsAndroid\.check\(PermissionsAndroid\.PERMISSIONS\.CAMERA\)/,
  );
  assert.match(nativeMediaPermissions, /PermissionsAndroid\.requestMultiple\(/);
  assert.match(nativeMediaPermissions, /Camera\.getCameraPermissionsAsync\(\)/);
  assert.match(
    nativeMediaPermissions,
    /Camera\.getMicrophonePermissionsAsync\(\)/,
  );
  assert.match(
    nativeMediaPermissions,
    /Camera\.requestCameraPermissionsAsync\(\)/,
  );
  assert.match(
    nativeMediaPermissions,
    /Camera\.requestMicrophonePermissionsAsync\(\)/,
  );
  assert.match(nativeMediaPermissions, /setVideoDatePermissionHandoff\(/);
  assert.match(nativeMediaPermissions, /mediaPermissionResultForStatus/);
  assert.match(
    nativeMediaPermissions,
    /permissionUxMediaKindForRequiredGrants/,
  );
  assert.match(nativeMediaPermissions, /catch \(error\)/);
  assert.match(nativeMediaPermissions, /status: 'in_use_or_abort'/);
  assert.match(nativeMediaPermissions, /rawErrorName/);
  assert.match(
    nativeMediaPermissions,
    /function diagnostics\(\s*cameraStatus: string,\s*microphoneStatus: string,\s*cameraCanAskAgain: boolean \| null,\s*microphoneCanAskAgain: boolean \| null,/,
  );
  assert.match(
    nativeMediaPermissions,
    /cameraPermissionStatus: diagnosticStatusFor\(cameraStatus, cameraCanAskAgain\)/,
  );
  assert.match(
    nativeMediaPermissions,
    /microphonePermissionStatus: diagnosticStatusFor\(microphoneStatus, microphoneCanAskAgain\)/,
  );

  for (const [path, source] of [
    [
      "apps/mobile/components/lobby/ReadyGateOverlay.tsx",
      nativeReadyGateOverlay,
    ],
    ["apps/mobile/app/ready/[id].tsx", nativeReadyRoute],
    ["apps/mobile/app/date/[id].tsx", nativeDateRoute],
  ] as const) {
    assert.match(
      source,
      /requestNativeCameraMicrophonePermissions/,
      `${path} should delegate native camera and microphone grants to the shared helper`,
    );
    assert.doesNotMatch(
      source,
      /PermissionsAndroid\.requestMultiple\(/,
      `${path} should not own Android prompts`,
    );
    assert.doesNotMatch(
      source,
      /Camera\.requestCameraPermissionsAsync\(/,
      `${path} should not own Expo prompts`,
    );
  }
});

test("native overlay gates date navigation behind prepareVideoDateEntry success", () => {
  const prepareIndex = nativeReadyGateOverlay.indexOf(
    "const result = await prepareVideoDateEntry(sessionId",
  );
  const successIndex = nativeReadyGateOverlay.indexOf(
    "if (result.ok === true)",
    prepareIndex,
  );
  const startPrewarmIndex = nativeReadyGateOverlay.indexOf(
    "startNativeVideoDateDailyPrewarm",
    successIndex,
  );
  const preAuthIndex = nativeReadyGateOverlay.indexOf(
    "void preAuthNativeVideoDateDailyPrewarm",
    startPrewarmIndex,
  );
  const navigateIndex = nativeReadyGateOverlay.indexOf(
    "navigateWithLatency(`${source}_prepare_success`)",
    preAuthIndex,
  );
  assert.ok(
    prepareIndex >= 0,
    "native overlay should call prepareVideoDateEntry before date navigation",
  );
  assert.ok(
    successIndex > prepareIndex,
    "native overlay should branch on prepare-entry success",
  );
  assert.ok(
    startPrewarmIndex > successIndex,
    "native overlay should ensure Daily prewarm exists before navigation",
  );
  assert.ok(
    preAuthIndex > startPrewarmIndex,
    "native overlay should start preauth before navigation",
  );
  assert.ok(
    navigateIndex > preAuthIndex,
    "native overlay should navigate only after prepare-entry success and prewarm/preauth start",
  );
  // ReadyGate must NEVER join Daily — the real join is owned solely by /date.
  assert.doesNotMatch(
    nativeReadyGateOverlay,
    /joinNativeVideoDateDailyPrewarm/,
  );
  assert.doesNotMatch(
    nativeReadyGateOverlay,
    /isBothReady[\s\S]{0,120}onNavigateToDate\(sessionId\)/,
  );
});

test("standalone native ready route syncs backend truth and has session-scoped recovery latches", () => {
  assert.match(
    nativeReadyRoute,
    /useReadyGate\(sessionId \?\? null, user\?\.id \?\? null\)/,
  );
  assert.match(nativeReadyRoute, /const result = await syncSession\(\)/);
  assert.match(nativeReadyRoute, /isReadyGateTransitionTimeoutSignal/);
  assert.match(nativeReadyRoute, /readyActionInFlightRef\.current/);
  assert.match(nativeReadyRoute, /ensureVideoDateStartableBeforeNavigation/);
  assert.match(nativeReadyRoute, /resolveReadyGateTerminalRecovery/);
  assert.match(nativeReadyRoute, /dateNavigationStartedRef/);
  assert.match(nativeReadyRoute, /terminalRecoveryKeyRef/);
  assert.match(nativeReadyRoute, /nonRetryablePrepareBlockerRef/);
  assert.match(nativeReadyRoute, /AppState\.addEventListener/);
});

test("standalone native ready route records entry proof and keeps post-ready warmup non-authoritative", () => {
  assert.match(nativeReadyRoute, /recordReadyGateEntered/);
  assert.match(nativeReadyRoute, /readyGateEntryProofKeyRef/);
  assert.match(nativeReadyRoute, /standalone_ready_gate_entry_proof_recorded/);
  assert.match(nativeReadyRoute, /isReadyGateEntryProofStatus\(status\)/);

  const warmupBlock =
    /const startRoomWarmupAfterReady = useCallback\([\s\S]*?\n\s*\);\n\n {2}useSettingsReturnRefresh/.exec(
      nativeReadyRoute,
    )?.[0] ?? "";
  assert.ok(warmupBlock, "standalone ready route should own a post-ready warmup block");
  assert.match(warmupBlock, /videoDateRoomWarmupAfterReadyEnabled\(\)/);
  assert.match(warmupBlock, /ensureVideoDateRoomWarmup\(sid/);
  assert.match(warmupBlock, /readyGateStatus === ['"]both_ready['"][\s\S]{0,40}return/);
  assert.match(warmupBlock, /permissionProven === true \|\| hasMediaPermission === true/);
  assert.match(warmupBlock, /startDailyPrewarmFromWarmRoom\(source, warmedRoom\)/);
  assert.doesNotMatch(warmupBlock, /prepareVideoDateEntry\(/);
  assert.doesNotMatch(warmupBlock, /preAuthNativeVideoDateDailyPrewarm\(/);
  assert.doesNotMatch(warmupBlock, /joinNativeVideoDateDailyPrewarm/);

  const canonicalDateEntryBlock =
    /const reconcileFromCanonicalTruth = useCallback\([\s\S]*?\n {6}\/\/ Not startable/.exec(
      nativeReadyRoute,
    )?.[0] ?? "";
  assert.ok(canonicalDateEntryBlock, "standalone ready route should keep authoritative date entry in canonical reconciliation");
  assert.match(canonicalDateEntryBlock, /prepareVideoDateEntry\(sid/);
  assert.match(canonicalDateEntryBlock, /preAuthNativeVideoDateDailyPrewarm/);
  assert.match(canonicalDateEntryBlock, /standalone_prepare_entry_failed_date_owned/);
  assert.match(canonicalDateEntryBlock, /ready_standalone_prepare_failed_date_owned/);
  assert.match(canonicalDateEntryBlock, /markVideoDateRouteOwned\(sid, user\.id\)/);
});

test("native Ready Gate overlay reconciles mark-ready timeouts before surfacing failure", () => {
  assert.match(nativeReadyGateOverlay, /isReadyGateTransitionTimeoutSignal/);
  assert.match(nativeReadyGateOverlay, /guardedSyncSession/);
  assert.match(nativeReadyGateOverlay, /const result = await syncSession\(\)/);
  assert.match(
    nativeReadyGateOverlay,
    /const syncResult = await guardedSyncSession\(/,
  );
  assert.match(
    nativeReadyGateOverlay,
    /isReadyGateReadyProgressStatus\(\s*syncResult\.status,?\s*\)/,
  );
  assert.match(
    nativeReadyGateOverlay,
    /startRoomWarmupAfterReady\(\s*["']ready_tap_mark_ready_timeout_sync_success["']/,
  );
});

test("native pre-navigation helper treats event-inactive prepare-entry as terminal, not retry lag", () => {
  assert.match(nativeEntryStartable, /isReadyGatePrepareEntryNonRetryable/);
  assert.match(nativeEntryStartable, /prepare_entry_event_inactive/);
  assert.match(nativeEntryStartable, /recommend: 'ended'/);
  assert.match(nativeEntryStartable, /READY_GATE_RACE_RETRY_BACKOFFS_MS/);
});

test("native lobby and date surfaces remain backend prepare-entry gated", () => {
  assert.match(nativeEventLobby, /ensureVideoDateStartableBeforeNavigation/);
  assert.match(nativeEventLobby, /prepareVideoDateEntry\(sessionIdToOpen/);
  assert.match(nativeEventLobby, /date_navigation_prepare_entry_failed/);
  assert.match(nativeEventLobby, /navigateToDateSessionGuarded/);
  assert.match(nativeDateRoute, /READY_GATE_NOT_READY/);
  assert.match(nativeDateRoute, /EVENT_NOT_ACTIVE/);
  assert.match(nativePrepareEntry, /PREPARE_VIDEO_DATE_ENTRY_ACTION/);
  assert.match(nativeActiveSession, /decideVideoSessionRouteFromTruth/);
});

test("native Ready Gate consumers do not directly write backend-owned lifecycle fields", () => {
  assertNoForbiddenSupabaseWrites(
    nativeConsumerFiles,
    "video_sessions",
    forbiddenVideoSessionFields,
  );
  assertNoForbiddenSupabaseWrites(
    nativeConsumerFiles,
    "event_registrations",
    forbiddenRegistrationFields,
  );
});

test("native code does not import or require expo-av", () => {
  for (const path of nativeConsumerFiles) {
    assert.doesNotMatch(
      read(path),
      /from ['"]expo-av['"]|require\(['"]expo-av['"]\)/,
      `${path} must not use expo-av`,
    );
  }
});

test("Streams 1-5 artifacts remain present", () => {
  assert.match(
    read(
      "supabase/migrations/20260501180000_event_lobby_active_event_contract.sql",
    ),
    /CREATE OR REPLACE FUNCTION public\.get_event_lobby_inactive_reason/,
  );
  assert.match(
    read(
      "supabase/migrations/20260501190000_ready_gate_transition_expiry_rowcount.sql",
    ),
    /GET DIAGNOSTICS v_row_count = ROW_COUNT/,
  );
  assert.match(
    read(
      "supabase/migrations/20260501200000_ready_gate_event_ended_terminalization.sql",
    ),
    /CREATE OR REPLACE FUNCTION public\.terminalize_event_ready_gates/,
  );
  assert.match(contractDoc, /Ready Gate Backend Contract/);
  assert.match(
    read("shared/matching/readyGateTerminalRecovery.ts"),
    /resolveReadyGateTerminalRecovery/,
  );
});
