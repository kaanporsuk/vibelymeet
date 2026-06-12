import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveReadyGateDiagnosticChecklist,
  resolveReadyGateDiagnosticCopy,
  resolveReadyGatePrepareEntryFailureCopy,
  resolveReadyGateTransitionFailureCopy,
} from "./readyGateDiagnosticCopy";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("Ready Gate diagnostics expose actionable platform copy", () => {
  assert.deepEqual(resolveReadyGateDiagnosticCopy({
    key: "camera_permission",
    status: "blocked",
    platform: "web",
  }), {
    key: "camera_permission",
    status: "blocked",
    severity: "error",
    label: "Camera permission",
    title: "Camera access is needed",
    message: "Allow camera access in your browser, then try again.",
    actionLabel: "Enable camera",
    actionKind: "request_permission",
  });

  assert.equal(resolveReadyGateDiagnosticCopy({
    key: "partner_readiness",
    status: "warning",
    partnerName: "Sam",
  }).message, "Sam is not ready yet. We will connect you when both of you are ready.");
  assert.equal(resolveReadyGateDiagnosticCopy({ key: "realtime_sync", status: "checking" }).actionKind, "wait");
  assert.equal(resolveReadyGateDiagnosticCopy({ key: "video_provider", status: "failed" }).actionLabel, "Retry video setup");
});

test("Ready Gate video_provider waiting copy is neutral, actionless, and non-blocking", () => {
  assert.deepEqual(resolveReadyGateDiagnosticCopy({
    key: "video_provider",
    status: "waiting",
    platform: "web",
  }), {
    key: "video_provider",
    status: "waiting",
    severity: "info",
    label: "Video setup",
    title: "Video setup waiting",
    message: "We'll verify the video room when both people are ready.",
    actionLabel: null,
    actionKind: "wait",
  });

  // A waiting video_provider row must not falsely claim a check is running and
  // must keep the gate from proceeding.
  const checklist = resolveReadyGateDiagnosticChecklist({
    cameraPermissionStatus: "ok",
    microphonePermissionStatus: "ok",
    cameraDeviceStatus: "ok",
    microphoneDeviceStatus: "ok",
    videoProviderStatus: "waiting",
    realtimeSyncStatus: "ok",
    partnerReadinessStatus: "ok",
  });
  assert.equal(checklist.canProceed, false);
  assert.equal(checklist.primaryIssue, null);
  const videoRow = checklist.rows.find((row) => row.key === "video_provider");
  assert.equal(videoRow?.severity, "info");
  assert.equal(videoRow?.title, "Video setup waiting");
});

test("Ready Gate diagnostic checklist keeps every focused readiness row privacy-safe", () => {
  const checklist = resolveReadyGateDiagnosticChecklist({
    platform: "native",
    partnerName: "Sam",
    cameraPermissionStatus: "ok",
    microphonePermissionStatus: "blocked",
    cameraDeviceStatus: "unknown",
    microphoneDeviceStatus: "unknown",
    videoProviderStatus: "checking",
    realtimeSyncStatus: "warning",
    partnerReadinessStatus: "warning",
  });

  assert.deepEqual(checklist.rows.map((row) => row.key), [
    "camera_permission",
    "microphone_permission",
    "camera_device",
    "microphone_device",
    "video_provider",
    "realtime_sync",
    "partner_readiness",
  ]);
  assert.equal(checklist.canProceed, false);
  assert.equal(checklist.primaryIssue?.key, "microphone_permission");
  assert.equal(checklist.primaryIssue?.actionKind, "open_settings");
  assert.equal(
    checklist.rows.find((row) => row.key === "partner_readiness")?.message,
    "Sam is not ready yet. We will connect you when both of you are ready.",
  );
  assert.equal(
    resolveReadyGateDiagnosticChecklist({
      cameraPermissionStatus: "ok",
      microphonePermissionStatus: "ok",
      cameraDeviceStatus: "ok",
      microphoneDeviceStatus: "ok",
      videoProviderStatus: "checking",
      realtimeSyncStatus: "ok",
      partnerReadinessStatus: "ok",
    }).canProceed,
    false,
  );

  const optimisticChecklist = resolveReadyGateDiagnosticChecklist({
    cameraPermissionStatus: "ok",
    microphonePermissionStatus: "ok",
    cameraDeviceStatus: "ok",
    microphoneDeviceStatus: "ok",
    videoProviderStatus: "ok",
    realtimeSyncStatus: "ok",
    partnerReadinessStatus: "ok",
  });
  assert.equal(optimisticChecklist.primaryIssue, null);
  assert.equal(optimisticChecklist.canProceed, true);
});

test("Ready Gate prepare-entry failure copy preserves web and native provider wording", () => {
  assert.deepEqual(resolveReadyGatePrepareEntryFailureCopy({ code: "UNAUTHORIZED", platform: "web" }), {
    code: "UNAUTHORIZED",
    title: "Sign in again",
    message: "Please sign in again, then try once more.",
    retryable: false,
    terminal: true,
  });
  assert.equal(
    resolveReadyGatePrepareEntryFailureCopy({ code: "ACCESS_DENIED", platform: "web" }).message,
    "You do not have access to this date.",
  );
  assert.equal(
    resolveReadyGatePrepareEntryFailureCopy({ code: "ACCESS_DENIED", platform: "native" }).message,
    "This date is no longer available.",
  );
  // PR #1260 classified provider auth failures as terminal prepare blockers:
  // the terminal-recovery advisor owns the copy before per-code wording.
  for (const platform of ["web", "native"] as const) {
    const dailyAuthCopy = resolveReadyGatePrepareEntryFailureCopy({
      code: "DAILY_AUTH_FAILED",
      platform,
    });
    assert.equal(
      dailyAuthCopy.message,
      "The Ready Gate changed before video could start. Return to the lobby to continue.",
    );
    assert.equal(dailyAuthCopy.retryable, false);
  }
  assert.equal(resolveReadyGatePrepareEntryFailureCopy({ code: "EVENT_NOT_ACTIVE" }).retryable, false);
  assert.equal(
    resolveReadyGatePrepareEntryFailureCopy({ code: "DAILY_PROVIDER_UNAVAILABLE" }).message,
    "The video service is still setting up. Please try again in a moment.",
  );
});

test("Ready Gate transition failure copy distinguishes multi-device conflicts from generic retries", () => {
  assert.deepEqual(resolveReadyGateTransitionFailureCopy({
    action: "mark_ready",
    code: "SURFACE_CLAIM_CONFLICT",
    platform: "web",
  }), {
    action: "mark_ready",
    code: "SURFACE_CLAIM_CONFLICT",
    reasonCode: "ready_gate_transition_conflict",
    title: "Ready Gate changed",
    message: "Another device or tab already changed this Ready Gate. We are syncing the latest state.",
    retryable: true,
    staleOrConflict: true,
  });

  assert.equal(
    resolveReadyGateTransitionFailureCopy({
      action: "snooze",
      reason: "guarded_update_zero_rows",
      platform: "native",
    }).message,
    "Another device already changed this Ready Gate. We are syncing the latest state.",
  );

  assert.equal(
    resolveReadyGateTransitionFailureCopy({ action: "forfeit", error: "network_error" }).reasonCode,
    "ready_gate_forfeit_failed",
  );
});

test("web and native Ready Gate surfaces consume shared failure copy", () => {
  const webReadyGate = read("src/components/lobby/ReadyGateOverlay.tsx");
  const nativeOverlay = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
  // PR 8.5: ready screen split; read the family.
  const nativeReadyRoute = [
  "apps/mobile/lib/videoDate/useNativeReadyGateMediaPermissions.ts",
  "apps/mobile/lib/videoDate/useNativeReadyGateTruthReconcile.ts",
  "apps/mobile/lib/videoDate/useNativeReadyGateForfeitExpiry.ts",
  "apps/mobile/app/ready/[id].tsx",
]
    .map(read)
    .join("\n");

  for (const source of [webReadyGate, nativeOverlay, nativeReadyRoute]) {
    assert.match(source, /resolveReadyGatePrepareEntryFailureCopy/);
    assert.match(source, /resolveReadyGateTransitionFailureCopy/);
  }
});

test("web and native Ready Gate surfaces consume shared diagnostic checklist copy", () => {
  const webReadyGate = read("src/components/lobby/ReadyGateOverlay.tsx");
  const nativeOverlay = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
  // PR 8.5: ready screen split; read the family.
  const nativeReadyRoute = [
  "apps/mobile/lib/videoDate/useNativeReadyGateMediaPermissions.ts",
  "apps/mobile/lib/videoDate/useNativeReadyGateTruthReconcile.ts",
  "apps/mobile/lib/videoDate/useNativeReadyGateForfeitExpiry.ts",
  "apps/mobile/app/ready/[id].tsx",
]
    .map(read)
    .join("\n");

  for (const source of [webReadyGate, nativeOverlay, nativeReadyRoute]) {
    assert.match(source, /resolveReadyGateDiagnosticChecklist/);
  }
  assert.match(nativeOverlay, /ReadyGateDiagnosticChecklist/);
  assert.match(nativeReadyRoute, /ReadyGateDiagnosticChecklist/);
  assert.match(nativeOverlay, /inspectNativeReadyGateMediaDevices/);
  assert.match(nativeReadyRoute, /inspectNativeReadyGateMediaDevices/);
  assert.match(nativeOverlay, /nativePermissionDiagnostics\.cameraPermissionStatus/);
  assert.match(nativeOverlay, /nativePermissionDiagnostics\.microphonePermissionStatus/);
  assert.match(nativeReadyRoute, /nativePermissionDiagnostics\.cameraPermissionStatus/);
  assert.match(nativeReadyRoute, /nativePermissionDiagnostics\.microphonePermissionStatus/);
  assert.doesNotMatch(nativeOverlay, /hasMediaPermission \? 'ok' : 'blocked'/);
  assert.doesNotMatch(nativeReadyRoute, /hasMediaPermission \? 'ok' : 'blocked'/);
});

test("Ready Gate device diagnostics avoid false hardware failures behind permission gates", () => {
  const webReadyGate = read("src/components/lobby/ReadyGateOverlay.tsx");
  const nativeMediaDiagnostics = read("apps/mobile/lib/readyGateNativeMediaDiagnostics.ts");

  assert.match(webReadyGate, /resolveMediaDiagnosticsAfterPrewarmError/);
  assert.match(webReadyGate, /mergeRefreshedDiagnosticStatus/);
  assert.match(nativeMediaDiagnostics, /cameraAvailable === false[\s\S]*hasMediaPermission \? 'failed' : 'unknown'/);
  assert.match(nativeMediaDiagnostics, /hasMediaPermission\s*\?\s*'failed'\s*:\s*next\.cameraDeviceStatus/);
  assert.match(nativeMediaDiagnostics, /hasMediaPermission\s*\?\s*'failed'\s*:\s*next\.microphoneDeviceStatus/);
});
