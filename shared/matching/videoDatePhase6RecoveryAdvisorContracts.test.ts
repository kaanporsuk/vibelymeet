import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readWebVideoCallFlowSource, readWebVideoDatePageFlowSource } from "../testUtils/webVideoDateFlowSources";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const advisor = read("shared/matching/videoDateRecoveryAdvisor.ts");
const timeline = read("shared/matching/videoDateTimeline.ts");
const webReadyGate = read("src/components/lobby/ReadyGateOverlay.tsx");
const nativeReadyGate = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
const webReadyRedirect = read("src/pages/ReadyRedirect.tsx");
const nativeReadyRoute = read("apps/mobile/app/ready/[id].tsx");
const webVideoDate = readWebVideoDatePageFlowSource(root);
const webVideoCall = readWebVideoCallFlowSource(root);
const nativeVideoDate = read("apps/mobile/app/date/[id].tsx");
const nativeNotificationDeepLink = read("apps/mobile/components/NotificationDeepLinkHandler.tsx");
const packageJson = read("package.json");

test("Phase 6 advisor owns the shared recovery decision vocabulary", () => {
  for (const action of [
    "stay",
    "retry_snapshot",
    "refresh_token",
    "go_lobby",
    "go_survey",
    "show_terminal",
    "go_ready_gate",
    "go_date",
    "go_home",
    "invalid",
  ]) {
    assert.match(advisor, new RegExp(`action: "${action}"|'${action}'`));
  }
  assert.match(advisor, /adviseVideoDateSnapshotRecovery/);
  assert.match(advisor, /adviseVideoSessionTruthRecovery/);
  assert.match(advisor, /adviseVideoDateTokenRecovery/);
  assert.match(advisor, /adviseReadyGateTerminalRecovery/);
  assert.match(advisor, /resolveReadyGateTerminalRecoveryViaAdvisor/);
});

test("legacy snapshot helper delegates through advisor for compatibility", () => {
  assert.match(timeline, /adviseVideoDateSnapshotRecovery/);
  assert.match(timeline, /surface: "notification_deep_link"/);
  assert.doesNotMatch(timeline, /POST_DATE_SURVEY_INELIGIBLE_ENDED_REASONS/);
});

test("web and native Ready Gate terminal copy routes through advisor", () => {
  for (const source of [webReadyGate, nativeReadyGate, nativeReadyRoute]) {
    assert.match(source, /resolveReadyGateTerminalRecoveryViaAdvisor as resolveReadyGateTerminalRecovery/);
    assert.match(source, /adviseVideoSessionTruthRecovery|resolveReadyGateTerminalRecoveryViaAdvisor/);
  }
});

test("web and native date recovery use advisor for truth and token decisions", () => {
  assert.match(webVideoDate, /adviseVideoSessionTruthRecovery/);
  assert.match(nativeVideoDate, /adviseVideoSessionTruthRecovery/);
  assert.match(webVideoCall, /adviseVideoDateTokenRecovery/);
  assert.match(nativeVideoDate, /adviseVideoDateTokenRecovery/);
  assert.match(webVideoCall, /trigger: ["']before_join["']/);
  assert.match(nativeVideoDate, /trigger: ["']before_join["']/);
  assert.match(webVideoCall, /trigger: ["']active_refresh_timer["']/);
  assert.match(nativeVideoDate, /trigger: ["']active_refresh_timer["']/);
  for (const source of [webVideoDate, nativeVideoDate, webReadyGate, nativeReadyGate, webReadyRedirect, nativeReadyRoute]) {
    assert.doesNotMatch(source, /canAttemptDailyRoomFromVideoSessionTruth/);
    assert.doesNotMatch(source, /decideVideoSessionRouteFromTruth/);
  }
});

test("notification and standalone Ready Gate routing use snapshot advisors and canonical truth", () => {
  assert.match(nativeNotificationDeepLink, /adviseVideoDateSnapshotRecovery/);
  assert.match(nativeNotificationDeepLink, /adviseVideoSessionTruthRecovery/);
  assert.match(nativeNotificationDeepLink, /surface: 'notification_deep_link'/);
  assert.match(webReadyRedirect, /adviseVideoDateSnapshotRecovery/);
  assert.match(webReadyRedirect, /decideCanonicalVideoDateRoute/);
  assert.match(webReadyRedirect, /webPathForCanonicalVideoDateRoute/);
  assert.doesNotMatch(webReadyRedirect, /registrationReadyGateFallback/);
  assert.match(webReadyRedirect, /surface: "ready_redirect"/);
  assert.match(nativeReadyRoute, /adviseVideoDateSnapshotRecovery/);
  assert.match(nativeReadyRoute, /adviseVideoSessionTruthRecovery/);
  assert.match(nativeReadyRoute, /surface: 'ready_redirect'/);
  assert.doesNotMatch(nativeNotificationDeepLink, /resolveVideoDateSnapshotRecovery/);
  assert.doesNotMatch(webReadyRedirect, /resolveVideoDateSnapshotRecovery/);
  assert.doesNotMatch(nativeReadyRoute, /resolveVideoDateSnapshotRecovery/);
  assert.doesNotMatch(nativeNotificationDeepLink, /canAttemptDailyRoomFromVideoSessionTruth/);
  assert.doesNotMatch(nativeNotificationDeepLink, /decideVideoSessionRouteFromTruth/);
});

test("Phase 6 tests are included in the video-date contract suite", () => {
  assert.match(packageJson, /videoDateRecoveryAdvisor\.test\.ts/);
  assert.match(packageJson, /videoDatePhase6RecoveryAdvisorContracts\.test\.ts/);
});
