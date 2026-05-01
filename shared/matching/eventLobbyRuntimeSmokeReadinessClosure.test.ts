import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function walkFiles(dir: string, predicate: (path: string) => boolean, files: string[] = []): string[] {
  for (const entry of readdirSync(join(root, dir))) {
    const relative = join(dir, entry);
    const absolute = join(root, relative);
    const stat = statSync(absolute);

    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".expo") continue;
      walkFiles(relative, predicate, files);
      continue;
    }

    if (predicate(relative)) files.push(relative);
  }

  return files;
}

const reportPath = "docs/audits/event-lobby-runtime-smoke-fixture-readiness.md";
const report = read(reportPath);
const runbook = read("docs/golden-path-event-lobby-regression-runbook.md");
const runner = read("scripts/run_event_lobby_regression.sh");
const branchDeltaPath = "docs/branch-deltas/fix-event-lobby-runtime-smoke-fixture-readiness-closure.md";
const branchDelta = read(branchDeltaPath);
const mobilePackageJson = JSON.parse(read("apps/mobile/package.json")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

test("runtime smoke readiness report preserves the blocked fixture finding without pass claims", () => {
  assert.match(report, /Status: \*\*blocked\*\*/);
  assert.match(report, /approved safe fixture metadata is missing/);
  assert.match(report, /Runtime web smoke and native device\/simulator smoke were \*\*not executed\*\*/);
  assert.match(report, /This report makes no runtime pass claim/);
  assert.match(report, /No web runtime pass or failure was recorded/);
  assert.match(report, /No simulator\/device smoke was run/);
  assert.match(report, /No production data was mutated/);
  assert.match(report, /No provider action was invoked/);
  assert.match(report, /did not mutate production data/);
});

test("required safe fixture metadata and cleanup boundaries are documented", () => {
  for (const phrase of [
    "EVENT_LOBBY_REGRESSION_ENV",
    "EVENT_LOBBY_REGRESSION_SUPABASE_REF",
    "EVENT_LOBBY_REGRESSION_SAFE_FIXTURES",
    "EVENT_LOBBY_REGRESSION_EVENT_ID",
    "User A",
    "User B",
    "User C",
    "one live smoke event",
    "one scheduled/not-started event",
    "one ended event",
    "cleanup/reset plan",
    "event_swipes",
    "video_sessions",
    "event_registrations",
    "Daily room/token side effects",
  ]) {
    assert.match(report, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `report should document ${phrase}`);
  }
});

test("runner and runbook keep live smoke behind explicit safe fixture approval", () => {
  assert.match(runbook, /Do not run these manual flows against production/);
  assert.match(runbook, /explicitly approved safe fixture/);
  assert.match(runbook, /EVENT_LOBBY_REGRESSION_SAFE_FIXTURES=1/);
  assert.match(runbook, /--allow-production/);
  assert.match(runner, /validate_staging_smoke_metadata/);
  assert.match(runner, /EVENT_LOBBY_REGRESSION_PRODUCTION_FIXTURE_ID/);
  assert.match(runner, /Refusing production smoke metadata/);
  assert.match(runner, /No live RPC smoke flow was executed/);
  assert.doesNotMatch(runner, /supabase functions deploy/);
  assert.doesNotMatch(runner, /supabase db reset/);
  assert.doesNotMatch(runner, /supabase db push(?! --linked --dry-run)/);
});

test("closure branch delta records docs-only posture and no cloud deploy requirement", () => {
  assert.ok(existsSync(join(root, branchDeltaPath)), "closure branch delta should exist");
  assert.match(branchDelta, new RegExp(reportPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(branchDelta, /Mode C/);
  assert.match(branchDelta, /docs\/test-only closure/);
  assert.match(branchDelta, /Supabase migration requirement: none/);
  assert.match(branchDelta, /Edge Function deploy requirement: none/);
  assert.match(branchDelta, /web\/static deploy requirement: none/);
  assert.match(branchDelta, /env vars added\/changed: none/);
  assert.match(branchDelta, /provider\/dashboard changes required: manual fixture approval only/);
  assert.match(branchDelta, /Production Smoke Limitations/);
  assert.match(branchDelta, /no production data-mutating smoke run/);
});

test("closure does not add unsupported native media modules or expo-av imports", () => {
  assert.equal(mobilePackageJson.dependencies?.["expo-av"], undefined);
  assert.equal(mobilePackageJson.devDependencies?.["expo-av"], undefined);

  const nativeSourceFiles = walkFiles("apps/mobile", (path) => /\.(?:ts|tsx|js|jsx)$/.test(path));
  for (const path of nativeSourceFiles) {
    const source = read(path);
    assert.doesNotMatch(source, /from\s+['"]expo-av['"]/);
    assert.doesNotMatch(source, /require\(\s*['"]expo-av['"]\s*\)/);
  }
});

test("prior Event Lobby runtime readiness artifacts remain present", () => {
  for (const path of [
    "docs/audits/event-lobby-closure-report.md",
    "docs/audits/event-lobby-runtime-smoke-fixture-readiness.md",
    "docs/golden-path-event-lobby-regression-runbook.md",
    "scripts/run_event_lobby_regression.sh",
    "shared/matching/eventLobbyRegressionHarness.test.ts",
    "shared/matching/nativeEventLobbyContractParity.test.ts",
  ]) {
    assert.ok(existsSync(join(root, path)), `${path} should remain present`);
  }
});
