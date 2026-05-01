import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

const read = (path: string): string => readFileSync(join(root, path), "utf8");

const reportPath = "docs/investigations/streams-1-3-backend-ready-gate-authority.md";
const branchDeltaPath = "docs/branch-deltas/fix-streams-1-3-backend-ready-gate-closure.md";

const report = read(reportPath);
const branchDelta = read(branchDeltaPath);
const rootPackageJson = read("package.json");
const nativePackageJson = read("apps/mobile/package.json");

const streamArtifacts = [
  "supabase/migrations/20260501180000_event_lobby_active_event_contract.sql",
  "supabase/validation/event_lobby_active_event_contract.sql",
  "shared/matching/eventLobbyActiveEventContract.test.ts",
  "docs/branch-deltas/fix-event-lobby-active-event-contract.md",
  "supabase/migrations/20260501190000_ready_gate_transition_expiry_rowcount.sql",
  "supabase/validation/ready_gate_transition_expiry_rowcount.sql",
  "shared/matching/readyGateTransitionExpiryRowcount.test.ts",
  "docs/branch-deltas/fix-ready-gate-transition-expiry-rowcount.md",
  "supabase/migrations/20260501200000_ready_gate_event_ended_terminalization.sql",
  "supabase/validation/ready_gate_event_ended_terminalization.sql",
  "shared/matching/readyGateEventEndedTerminalization.test.ts",
  "docs/branch-deltas/fix-ready-gate-event-ended-terminalization.md",
];

const walkSourceFiles = (dir: string): string[] => {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];

  return readdirSync(abs).flatMap((entry) => {
    const path = join(dir, entry);
    const fullPath = join(root, path);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (["node_modules", ".expo", "dist", "build", "coverage"].includes(entry)) return [];
      return walkSourceFiles(path);
    }
    if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(entry)) return [];
    return [path];
  });
};

test("closure report records PASS verdict and no repair stream", () => {
  assert.match(report, /## Executive verdict: PASS/);
  assert.match(report, /No material code defect was found/);
  assert.match(report, /## Repair streams recommended\s+None for Streams 1-3 based on this audit\./);
  assert.match(report, /No Docker used/);
  assert.match(report, /No local Supabase used/);
  assert.match(report, /No Supabase cloud mutation performed/);
  assert.match(report, /No deployment performed/);
});

test("closure branch delta documents docs-test-only scope and no cloud deploy", () => {
  assert.match(branchDelta, new RegExp(reportPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(branchDelta, /Mode C - docs\/test-only closure/);
  assert.match(branchDelta, /Supabase migration requirement: none/);
  assert.match(branchDelta, /Edge Function deploy requirement: none/);
  assert.match(branchDelta, /Web\/static deploy requirement: none/);
  assert.match(branchDelta, /Env vars added\/changed: none/);
  assert.match(branchDelta, /No native modules added/);
  assert.match(branchDelta, /`expo-av`: not used/);
  assert.match(branchDelta, /No production data-mutating smoke run/);
});

test("previous Stream 1-3 artifacts remain present", () => {
  for (const path of streamArtifacts) {
    assert.ok(existsSync(join(root, path)), `${path} should exist`);
  }

  assert.match(read("supabase/migrations/20260501180000_event_lobby_active_event_contract.sql"), /get_event_lobby_inactive_reason/);
  assert.match(read("supabase/migrations/20260501190000_ready_gate_transition_expiry_rowcount.sql"), /GET DIAGNOSTICS v_row_count = ROW_COUNT/);
  assert.match(read("supabase/migrations/20260501200000_ready_gate_event_ended_terminalization.sql"), /terminalize_event_ready_gates/);
});

test("closure adds no migration or validation SQL because no backend defect was found", () => {
  const migrationNames = readdirSync(join(root, "supabase/migrations"));
  const validationNames = readdirSync(join(root, "supabase/validation"));

  assert.ok(
    !migrationNames.some((name) => name.includes("streams_1_3") || name.includes("streams-1-3")),
    "docs/test-only closure should not add a Streams 1-3 migration",
  );
  assert.ok(
    !validationNames.some((name) => name.includes("streams_1_3") || name.includes("streams-1-3")),
    "docs/test-only closure should not add production validation SQL",
  );
});

test("closure introduces no native module or expo-av dependency/import", () => {
  assert.doesNotMatch(rootPackageJson, /"expo-av"\s*:/);
  assert.doesNotMatch(nativePackageJson, /"expo-av"\s*:/);

  for (const path of [
    ...walkSourceFiles("src"),
    ...walkSourceFiles("apps/mobile"),
    ...walkSourceFiles("shared"),
    ...walkSourceFiles("supabase/functions"),
  ]) {
    assert.doesNotMatch(
      read(path),
      /(?:from|require\(|import\()\s*['"]expo-av['"]/,
      `${path} must not import expo-av`,
    );
  }
});
