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

const synthesisPath = "docs/audits/event-lobby-investigation-synthesis.md";
const fixtureReadinessPath = "docs/audits/event-lobby-runtime-smoke-fixture-readiness.md";
const branchDeltaPath = "docs/branch-deltas/fix-event-lobby-investigation-synthesis-closure.md";
const synthesis = read(synthesisPath);
const fixtureReadiness = read(fixtureReadinessPath);
const branchDelta = read(branchDeltaPath);

test("synthesis closure preserves the engineering-green but runtime-blocked verdict", () => {
  assert.match(synthesis, /engineering\/source closure is green; runtime smoke remains blocked/);
  assert.match(synthesis, /No new implementation bugfix prompt is required/);
  assert.match(synthesis, /Runtime smoke is \*\*blocked, not proven\*\*/);
  assert.match(synthesis, /No `docs\/audits\/event-lobby-runtime-smoke-proof\.md`/);
  assert.match(synthesis, /or `docs\/audits\/native-event-lobby-device-smoke\.md` exists/);
  assert.match(synthesis, /Fixture availability \| BLOCKER/);
});

test("closure branch delta documents Mode C scope and exact findings", () => {
  assert.match(branchDelta, /Mode C - docs\/test-only closure/);
  assert.match(branchDelta, new RegExp(synthesisPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(branchDelta, /SYN-001/);
  assert.match(branchDelta, /SYN-002/);
  assert.match(branchDelta, /SYN-003/);
  assert.match(branchDelta, /SYN-004/);
  assert.match(branchDelta, /No product code changed/);
  assert.match(branchDelta, /No runtime smoke was run/);
});

test("runtime proof remains honestly blocked until approved fixtures exist", () => {
  assert.equal(existsSync(join(root, "docs/audits/event-lobby-runtime-smoke-proof.md")), false);
  assert.equal(existsSync(join(root, "docs/audits/native-event-lobby-device-smoke.md")), false);
  assert.match(fixtureReadiness, /Status: \*\*blocked\*\*/);
  assert.match(fixtureReadiness, /No approved safe fixture set was found/);
  assert.match(fixtureReadiness, /No production data was mutated/);

  for (const phrase of [
    "EVENT_LOBBY_REGRESSION_ENV",
    "EVENT_LOBBY_REGRESSION_SUPABASE_REF",
    "EVENT_LOBBY_REGRESSION_SAFE_FIXTURES",
    "User A",
    "User B",
    "User C",
    "cleanup/reset plan",
    "native runtime device/simulator target",
  ]) {
    assert.match(fixtureReadiness, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("closure introduces no Supabase, env, native-module, or expo-av requirement", () => {
  const rootPackageJson = read("package.json");
  const nativePackageJson = read("apps/mobile/package.json");

  assert.match(branchDelta, /Supabase migration requirement: none/);
  assert.match(branchDelta, /Edge Function deploy requirement: none/);
  assert.match(branchDelta, /Web\/static deploy requirement: none/);
  assert.match(branchDelta, /Env vars added\/changed: none/);
  assert.match(branchDelta, /Native module changes: none/);
  assert.match(branchDelta, /`expo-av`: not used/);
  assert.match(branchDelta, /No production data-mutating smoke run/);
  assert.doesNotMatch(branchDelta, /supabase functions deploy [a-z0-9-]+/);
  assert.doesNotMatch(branchDelta, /supabase db push --linked\s*$/m);
  assert.doesNotMatch(rootPackageJson, /"expo-av"\s*:/);
  assert.doesNotMatch(nativePackageJson, /"expo-av"\s*:/);

  const nativeSourceFiles = walkFiles("apps/mobile", (path) => /\.(?:ts|tsx|js|jsx)$/.test(path));
  for (const path of nativeSourceFiles) {
    const source = read(path);
    assert.doesNotMatch(source, /from\s+['"]expo-av['"]/);
    assert.doesNotMatch(source, /require\(\s*['"]expo-av['"]\s*\)/);
  }
});

test("prior Event Lobby investigation artifacts remain present", () => {
  for (const path of [
    "docs/audits/event-lobby-closure-report.md",
    "docs/audits/event-lobby-investigation-batch-1-backend-contracts.md",
    "docs/audits/event-lobby-investigation-batch-2-gating-queue-lifecycle.md",
    "docs/audits/event-lobby-investigation-batch-3-payload-observability-tests.md",
    "docs/audits/event-lobby-investigation-batch-4-native-closure.md",
    "docs/audits/event-lobby-runtime-smoke-fixture-readiness.md",
    "docs/audits/event-lobby-investigation-synthesis.md",
    "shared/matching/eventLobbyRuntimeSmokeReadinessClosure.test.ts",
  ]) {
    assert.ok(existsSync(join(root, path)), `${path} should remain present`);
  }
});
