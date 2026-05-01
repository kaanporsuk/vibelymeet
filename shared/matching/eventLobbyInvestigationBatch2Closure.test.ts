import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const reportPath = "docs/audits/event-lobby-investigation-batch-2-gating-queue-lifecycle.md";
const branchDeltaPath =
  "docs/branch-deltas/fix-event-lobby-investigation-batch-2-gating-queue-lifecycle-closure.md";

const report = read(reportPath);
const branchDelta = read(branchDeltaPath);

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

function gitGrep(pattern: string, paths: string[]): string {
  try {
    return execFileSync("git", ["grep", "-nE", pattern, "--", ...paths], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const maybeStatus = (error as { status?: number }).status;
    if (maybeStatus === 1) return "";
    throw error;
  }
}

test("batch 2 investigation report remains a PASS with no implementation bugfix prompt", () => {
  assert.match(report, /^PASS\.$/m);
  assert.match(report, /No material contract drift was found/);
  assert.match(report, /No follow-up bugfix prompt is required from this batch/);
  assert.match(report, /Finding B2-001 - PASS/);
  assert.match(report, /Finding B2-002 - PASS/);
  assert.match(report, /Finding B2-003 - PASS/);
  assert.match(report, /Finding B2-004 - WARN/);
  assert.match(report, /Finding B2-005 - WARN/);
  assert.match(report, /Follow-up bugfix prompt: none/g);
});

test("closure mode is documented as docs/test-only with no deployable artifact changes", () => {
  assert.match(branchDelta, /Closure mode: Mode C - docs\/test-only closure/);
  assert.match(branchDelta, new RegExp(reportPath));
  assert.match(branchDelta, /Supabase migration requirement: none/);
  assert.match(branchDelta, /Edge Function deploy requirement: none/);
  assert.match(branchDelta, /Web\/static deploy requirement: none/);
  assert.match(branchDelta, /Schema\/storage changes: none/);
  assert.match(branchDelta, /Env vars added\/changed: none/);
  assert.match(branchDelta, /Provider\/dashboard changes required: none/);
  assert.match(branchDelta, /Native module changes: none/);
  assert.match(branchDelta, /`expo-av`: not used/);
  assert.match(branchDelta, /Production smoke limitations: no production data-mutating smoke was run/);
});

test("closure branch changes are intentionally limited to report proof docs and tests", () => {
  assert.match(branchDelta, /shared\/matching\/eventLobbyInvestigationBatch2Closure\.test\.ts/);
  assert.match(
    branchDelta,
    /docs\/branch-deltas\/fix-event-lobby-investigation-batch-2-gating-queue-lifecycle-closure\.md/,
  );
  assert.match(branchDelta, /Product code changes: none/);
  assert.match(branchDelta, /Backend SQL changes: none/);
  assert.match(branchDelta, /Edge Function source changes: none/);
  assert.match(branchDelta, /Route\/page drift: none/);
});

test("prior stream artifacts used by the investigation remain present", () => {
  for (const path of [
    "docs/audits/event-lobby-web-gating-verification.md",
    "docs/audits/recent-hardening-deep-audit-2026-05-01.md",
    "docs/audits/event-lobby-ready-queue-contract-verification.md",
    "docs/contracts/event-lobby-ready-queue-contract.md",
    "supabase/migrations/20260501225000_event_lobby_ready_queue_contract.sql",
    "shared/matching/webEventLobbyGating.test.ts",
    "shared/matching/eventLobbyReadyQueueContract.test.ts",
    reportPath,
  ]) {
    assert.ok(trackedFiles().includes(path), `${path} should remain tracked`);
  }
});

test("closure does not introduce forbidden expo-av posture drift", () => {
  const mobilePackage = read("apps/mobile/package.json");
  assert.doesNotMatch(mobilePackage, /"expo-av"/);
  assert.equal(
    gitGrep("from ['\\\"]expo-av['\\\"]|require\\(['\\\"]expo-av['\\\"]\\)", ["apps/mobile", "src", "supabase/functions"]),
    "",
  );
});
