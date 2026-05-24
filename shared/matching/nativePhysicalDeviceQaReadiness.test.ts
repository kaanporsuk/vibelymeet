import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function exists(path: string): boolean {
  return existsSync(join(root, path));
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

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const runbookPath = "docs/qa/native-physical-device-qa-runbook.md";
const branchDeltaPath = "docs/branch-deltas/qa-native-physical-device-flow.md";
const runbook = read(runbookPath);
const branchDelta = read(branchDeltaPath);
const nativeReadyGateTest = read("shared/matching/nativeReadyGateParityContract.test.ts");
const nativeVideoDateTest = read("shared/matching/nativeVideoDateContractRecovery.test.ts");
const nativeReadyOverlay = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
const nativeReadyRoute = read("apps/mobile/app/ready/[id].tsx");
const nativeDateRoute = read("apps/mobile/app/date/[id].tsx");
const nativeEntryStartable = read("apps/mobile/lib/videoDateEntryStartable.ts");
const nativeNotificationDeepLink = read("apps/mobile/components/NotificationDeepLinkHandler.tsx");
const nativeVibeVideoApi = read("apps/mobile/lib/vibeVideoApi.ts");
const nativePackageJson = read("apps/mobile/package.json");
const rootPackageJson = read("package.json");

test("manual native physical-device QA runbook exists and covers setup, truth, failure capture, and rollback", () => {
  assert.equal(exists(runbookPath), true);
  assert.match(runbook, /Device Setup/);
  assert.match(runbook, /Test Users And Fixtures/);
  assert.match(runbook, /Expected Backend Truth Checklist/);
  assert.match(runbook, /Failure Capture/);
  assert.match(runbook, /Rollback Notes/);
  assert.match(runbook, /Completion Criteria/);
  assert.match(runbook, /xcrun devicectl list devices/);
  assert.match(runbook, /npm run ios -- --device/);
});

test("manual QA matrix covers the Stream 16 native runtime targets", () => {
  for (const marker of [
    "Native Sign In And Session Restore",
    "Native `/ready/[id]` Stale/Terminal Recovery",
    "Web-To-Native Ready Gate",
    "Native-To-Native Ready Gate",
    "Web-To-Native Video Date Handoff",
    "Native-To-Native Video Date Handoff",
    "Direct Stale `/date/[id]` Before Prepare-Entry",
    "Event-Ended Ready Gate Recovery",
    "Event-Ended Stale Date Handoff",
    "App Foreground/Focus During Ready Gate And Date",
    "Reconnect And Partner Disconnect",
    "Post-Date Survey Recovery",
    "Duplicate Daily Join/Token Suppression",
    "OneSignal Click Deep Link To Ready/Date/Chat",
    "Vibe Video Playback/Upload Smoke",
  ]) {
    assert.match(runbook, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("prior native Ready Gate and video-date contract tests remain present", () => {
  assert.match(nativeReadyGateTest, /native Ready Gate API uses canonical ready_gate_transition actions/);
  assert.match(nativeReadyGateTest, /native overlay gates date navigation behind prepareVideoDateEntry success/);
  assert.match(nativeReadyGateTest, /native code does not import or require expo-av/);
  assert.match(nativeVideoDateTest, /native date route exists and gates bootstrap on backend video-date truth/);
  assert.match(nativeVideoDateTest, /native date route has session-scoped duplicate join and terminal recovery guards/);
  assert.match(nativeVideoDateTest, /native video-date surfaces do not import expo-av or add native modules/);
});

test("native latches and prepare-entry gates remain present", () => {
  assert.match(nativeReadyOverlay, /dateNavigationStartedRef/);
  assert.match(nativeReadyOverlay, /duplicateNavSuppressionKeysRef/);
  assert.match(nativeReadyOverlay, /duplicateTerminalSuppressionKeysRef/);
  assert.match(nativeReadyOverlay, /prepareVideoDateEntry\(sessionId/);
  assert.match(nativeReadyRoute, /ensureVideoDateStartableBeforeNavigation/);
  assert.match(nativeReadyRoute, /dateNavigationStartedRef/);
  assert.match(nativeReadyRoute, /terminalRecoveryKeyRef/);
  assert.match(nativeEntryStartable, /prepareVideoDateEntry\(sessionId/);
  for (const marker of [
    "hasStartedJoinRef",
    "prejoinAttemptRef",
    "joinAttemptNonce",
    "reconnectEndedHandledRef",
    "handshakeCompletionInFlightRef",
    "handshakeCompletionDeadlineKeyRef",
  ]) {
    assert.match(nativeDateRoute, new RegExp(marker));
  }
});

test("push and media device QA targets remain backend/provider gated", () => {
  assert.match(nativeNotificationDeepLink, /fetchVideoSessionDateEntryTruth/);
  assert.match(nativeNotificationDeepLink, /adviseVideoSessionTruthRecovery/);
  assert.doesNotMatch(nativeNotificationDeepLink, /decideVideoSessionRouteFromTruth/);
  assert.doesNotMatch(nativeNotificationDeepLink, /canAttemptDailyRoomFromVideoSessionTruth/);
  assert.match(nativeNotificationDeepLink, /readyGateHref\(sid\)/);
  assert.match(nativeNotificationDeepLink, /videoDateHref\(sid\)/);
  assert.match(nativeVibeVideoApi, /tus-js-client/);
  assert.match(nativeVibeVideoApi, /getCreateVideoUploadCredentials/);
  assert.match(nativeVibeVideoApi, /FileSystem\.copyAsync/);
  assert.doesNotMatch(stripComments(nativeVibeVideoApi), /readAsStringAsync\([^)]*Base64|fetch\(["']data:/);
});

test("Stream 16 adds no expo-av, native module, Supabase migration, or Edge Function changes", () => {
  assert.doesNotMatch(rootPackageJson, /"expo-av"\s*:/);
  assert.doesNotMatch(nativePackageJson, /"expo-av"\s*:/);
  const nativeFiles = readTreeFiles("apps/mobile", new Set([".ts", ".tsx", ".js", ".jsx"]));
  for (const path of nativeFiles) {
    assert.doesNotMatch(
      read(path),
      /from ['"]expo-av['"]|require\(['"]expo-av['"]\)|import\(['"]expo-av['"]\)/,
      `${path} must not import expo-av`,
    );
  }
  assert.equal(
    readdirSync(join(root, "supabase/migrations")).some((name) => name.includes("native_physical_device")),
    false,
    "Stream 16 should not add a Supabase migration",
  );
  assert.match(branchDelta, /No Edge Function changed/);
  assert.match(branchDelta, /No native modules added/);
  assert.match(branchDelta, /No `expo-av` import or package added/);
});

test("Stream 16 branch delta records execution/defer status and no cloud deploy requirement", () => {
  assert.equal(exists(branchDeltaPath), true);
  assert.match(branchDelta, /Physical-device runtime QA was not executed/);
  assert.match(branchDelta, /unavailable\/offline/);
  assert.match(branchDelta, /No scoped native code defect was found/);
  assert.match(branchDelta, /Edge Function deploy: not required/);
  assert.match(branchDelta, /No Supabase DB push/);
});

test("Streams 1-15 artifacts remain present", () => {
  for (const path of [
    "shared/matching/eventLobbyActiveEventContract.test.ts",
    "shared/matching/readyGateTransitionExpiryRowcount.test.ts",
    "shared/matching/readyGateEventEndedTerminalization.test.ts",
    "shared/matching/readyGateContractConsumerCompliance.test.ts",
    "shared/matching/readyGateTerminalUxObservability.test.ts",
    "shared/matching/nativeReadyGateParityContract.test.ts",
    "shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts",
    "shared/matching/realtimeSubscriptionTightening.test.ts",
    "shared/matching/premiumCreditsObservability.test.ts",
    "shared/matching/nativeVideoDateContractRecovery.test.ts",
    "shared/matching/onesignalProviderOperationalQa.test.ts",
    "shared/matching/bunnyProviderOperationalQa.test.ts",
    "shared/matching/dailyProviderOperationalQa.test.ts",
    "shared/matching/resendEmailProviderOperationalQa.test.ts",
    "shared/matching/twilioPhoneVerificationQa.test.ts",
    "docs/branch-deltas/fix-native-ready-gate-parity-contract.md",
    "docs/branch-deltas/fix-native-video-date-contract-recovery.md",
    "docs/branch-deltas/fix-onesignal-provider-operational-qa.md",
    "docs/branch-deltas/fix-bunny-provider-operational-qa.md",
    "docs/branch-deltas/fix-daily-provider-operational-qa.md",
    "docs/branch-deltas/fix-resend-email-provider-operational-qa.md",
    "docs/branch-deltas/fix-twilio-phone-verification-qa.md",
  ]) {
    assert.equal(exists(path), true, `${path} should remain present`);
  }
});
