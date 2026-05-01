import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function exists(path: string): boolean {
  return existsSync(join(root, path));
}

const reportPath = "docs/investigations/streams-4-6-ready-gate-client-parity.md";
const branchDeltaPath = "docs/branch-deltas/fix-streams-4-6-ready-gate-client-parity-closure.md";
const report = read(reportPath);
const branchDelta = read(branchDeltaPath);

const stream46Artifacts = [
  "docs/ready-gate-backend-contract.md",
  "docs/branch-deltas/fix-ready-gate-contract-consumer-compliance.md",
  "docs/branch-deltas/fix-ready-gate-terminal-ux-observability.md",
  "docs/branch-deltas/fix-native-ready-gate-parity-contract.md",
  "shared/matching/readyGateContractConsumerCompliance.test.ts",
  "shared/matching/readyGateTerminalUxObservability.test.ts",
  "shared/matching/nativeReadyGateParityContract.test.ts",
  "shared/matching/readyGateTerminalRecovery.ts",
  "shared/analytics/lobbyToPostDateJourney.ts",
  "src/components/lobby/ReadyGateOverlay.tsx",
  "src/hooks/useReadyGate.ts",
  "apps/mobile/lib/readyGateApi.ts",
  "apps/mobile/components/lobby/ReadyGateOverlay.tsx",
  "apps/mobile/app/ready/[id].tsx",
  "apps/mobile/lib/videoDateEntryStartable.ts",
];

const forbiddenNativeDependencyPatterns = [
  /"expo-av"\s*:/,
  /"react-native-[^"]*ready-gate[^"]*"\s*:/i,
];

const sourceRootsForNativeGuard = [
  "src",
  "shared",
  "apps/mobile",
];

function listFiles(dir: string): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".expo") return [];
      return listFiles(rel);
    }
    return [rel];
  });
}

test("investigation report records PASS verdict and no repair recommendation", () => {
  assert.match(report, /## Executive Verdict: PASS/);
  assert.match(report, /no material client\/backend contract defect/i);
  assert.match(report, /no forbidden Ready Gate-owned client writes/i);
  assert.match(report, /no optimistic `both_ready` date navigation/i);
  assert.match(report, /No direct Daily creation path was found/i);
  assert.match(report, /None for Streams 4-6 from this investigation batch/);
});

test("closure branch delta documents docs-test-only scope and no deploy", () => {
  assert.match(branchDelta, new RegExp(reportPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(branchDelta, /Mode C/);
  assert.match(branchDelta, /docs\/test-only/);
  assert.match(branchDelta, /Supabase migration requirement:\s*not required/i);
  assert.match(branchDelta, /Edge Function deploy requirement:\s*not required/i);
  assert.match(branchDelta, /web\/static deploy requirement:\s*not required/i);
  assert.match(branchDelta, /env vars added\/changed:\s*none/i);
  assert.match(branchDelta, /native module changes:\s*none/i);
  assert.match(branchDelta, /`expo-av`:\s*not used/i);
  assert.match(branchDelta, /production data-mutating smoke:\s*not run/i);
});

test("Stream 4-6 artifacts remain present", () => {
  for (const path of stream46Artifacts) {
    assert.equal(exists(path), true, `${path} should exist`);
  }
  assert.match(read("docs/ready-gate-backend-contract.md"), /Ready Gate Backend Contract/);
  assert.match(read("shared/matching/readyGateTerminalRecovery.ts"), /partner_forfeited/);
  assert.match(read("apps/mobile/lib/readyGateApi.ts"), /ready_gate_transition/);
});

test("closure adds no migration, validation SQL, Edge Function, or config artifact", () => {
  const suspiciousNames = [
    ...listFiles("supabase/migrations"),
    ...listFiles("supabase/validation"),
    ...listFiles("supabase/functions"),
  ].filter((path) => /streams?[-_]?4[-_]?6|client[-_]?parity|ready[-_]?gate[-_]?client[-_]?parity/i.test(path));

  assert.deepEqual(suspiciousNames, [], "docs/test-only closure must not add Supabase artifacts");
});

test("closure introduces no env vars, native modules, or expo-av usage", () => {
  for (const path of ["package.json", "apps/mobile/package.json"]) {
    const packageJson = read(path);
    for (const pattern of forbiddenNativeDependencyPatterns) {
      assert.doesNotMatch(packageJson, pattern, `${path} must not add forbidden native dependencies`);
    }
  }

  for (const path of sourceRootsForNativeGuard.flatMap(listFiles)) {
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) continue;
    assert.doesNotMatch(
      read(path),
      /(?:from|require\(|import\()\s*['"]expo-av['"]/,
      `${path} must not import expo-av`,
    );
  }

  assert.doesNotMatch(branchDelta, /new env var|added env var|service role key/i);
});
