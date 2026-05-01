import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const reportPath = "docs/audits/event-lobby-investigation-batch-4-native-closure.md";
const branchDeltaPath = "docs/branch-deltas/fix-event-lobby-investigation-batch-4-native-closure.md";

test("batch 4 closure keeps the investigation as docs/test-only proof", () => {
  const report = read(reportPath);
  const branchDelta = read(branchDeltaPath);

  assert.match(report, /PASS with runtime-proof warnings/);
  assert.match(report, /No implementation defect was found/);
  assert.match(report, /No bugfix prompt is required/);
  assert.match(branchDelta, /Closure mode: Mode C - docs\/test-only closure/);
  assert.match(branchDelta, new RegExp(reportPath));
  assert.match(branchDelta, /B4-001/);
  assert.match(branchDelta, /B4-002/);
  assert.match(branchDelta, /No product code changed/);
});

test("historical Edge Function source proof warning is intentionally documented", () => {
  const report = read(reportPath);
  const branchDelta = read(branchDeltaPath);

  assert.match(report, /swipe-actions` active at version `498`/);
  assert.match(report, /records an earlier version `471`/);
  assert.match(report, /correctly historical/);
  assert.match(branchDelta, /historical Edge Function source proof/);
  assert.match(branchDelta, /not a repo defect/);
});

test("closure introduces no Supabase, env, native-module, or expo-av requirement", () => {
  const branchDelta = read(branchDeltaPath);
  const rootPackageJson = read("package.json");
  const nativePackageJson = read("apps/mobile/package.json");

  assert.match(branchDelta, /Supabase migration requirement: none/);
  assert.match(branchDelta, /Edge Function deploy requirement: none/);
  assert.match(branchDelta, /Env vars added\/changed: none/);
  assert.match(branchDelta, /Native module changes: none/);
  assert.match(branchDelta, /`expo-av`: not used/);
  assert.match(branchDelta, /No production data-mutating smoke/);
  assert.doesNotMatch(branchDelta, /supabase functions deploy/);
  assert.doesNotMatch(branchDelta, /supabase db push --linked(?! --dry-run)/);
  assert.doesNotMatch(rootPackageJson, /"expo-av"\s*:/);
  assert.doesNotMatch(nativePackageJson, /"expo-av"\s*:/);
});

test("audited native Event Lobby paths still avoid direct server-owned writes", () => {
  for (const path of [
    "apps/mobile/app/event/[eventId]/lobby.tsx",
    "apps/mobile/lib/eventsApi.ts",
    "apps/mobile/lib/readyGateApi.ts",
    "apps/mobile/lib/useActiveSession.ts",
    "apps/mobile/components/lobby/ReadyGateOverlay.tsx",
    "apps/mobile/lib/useMysteryMatch.ts",
  ]) {
    const source = read(path);

    assert.doesNotMatch(
      source,
      /\.from\(['"]event_swipes['"]\)[\s\S]{0,240}\.(?:insert|update|upsert|delete)\(/,
      `${path} must not directly mutate event_swipes`,
    );
    assert.doesNotMatch(
      source,
      /\.from\(['"]video_sessions['"]\)[\s\S]{0,240}\.(?:insert|update|upsert|delete)\(/,
      `${path} must not directly mutate video_sessions`,
    );
    assert.doesNotMatch(
      source,
      /from ['"]expo-av['"]|require\(['"]expo-av['"]\)|import\(['"]expo-av['"]\)/,
      `${path} must not import expo-av`,
    );
  }
});
