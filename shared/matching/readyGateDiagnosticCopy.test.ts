import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveReadyGateDiagnosticCopy,
  resolveReadyGatePrepareEntryFailureCopy,
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
  assert.equal(
    resolveReadyGatePrepareEntryFailureCopy({ code: "DAILY_AUTH_FAILED", platform: "web" }).message,
    "Video provider authentication failed. Please try again later.",
  );
  assert.equal(
    resolveReadyGatePrepareEntryFailureCopy({ code: "DAILY_AUTH_FAILED", platform: "native" }).message,
    "Video setup is unavailable right now. Please try again later.",
  );
  assert.equal(resolveReadyGatePrepareEntryFailureCopy({ code: "EVENT_NOT_ACTIVE" }).retryable, false);
  assert.equal(
    resolveReadyGatePrepareEntryFailureCopy({ code: "DAILY_PROVIDER_UNAVAILABLE" }).message,
    "The video service is still setting up. Please try again in a moment.",
  );
});

test("web and native Ready Gate surfaces consume shared failure copy", () => {
  const webReadyGate = read("src/components/lobby/ReadyGateOverlay.tsx");
  const nativeOverlay = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
  const nativeReadyRoute = read("apps/mobile/app/ready/[id].tsx");

  for (const source of [webReadyGate, nativeOverlay, nativeReadyRoute]) {
    assert.match(source, /resolveReadyGatePrepareEntryFailureCopy/);
  }
});
