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
  ignored = new Set(["node_modules", ".expo", ".next", "dist", "build", "Pods"]),
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

const investigationPath = "docs/investigations/native-runtime-visual-readiness.md";
const branchDeltaPath = "docs/branch-deltas/fix-native-runtime-visual-readiness-closure.md";
const investigation = read(investigationPath);
const branchDelta = read(branchDeltaPath);
const eventLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const chatThread = read("apps/mobile/app/chat/[id].tsx");
const connectivityService = read("apps/mobile/lib/connectivityService.ts");
const rootPackageJson = read("package.json");
const nativePackageJson = read("apps/mobile/package.json");

test("closure is linked to the native runtime visual readiness investigation", () => {
  assert.match(investigation, /Executive Verdict[\s\S]{0,80}WARN/);
  assert.match(investigation, /legacy `useNetworkStatus` hook still uses `expo-network`/);
  assert.match(branchDelta, new RegExp(investigationPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(branchDelta, /F5/);
  assert.match(branchDelta, /legacy `useNetworkStatus`/);
});

test("event lobby and chat send guards use the shared NetInfo-backed connectivity service", () => {
  for (const [path, source] of [
    ["apps/mobile/app/event/[eventId]/lobby.tsx", eventLobby],
    ["apps/mobile/app/chat/[id].tsx", chatThread],
  ] as const) {
    assert.match(source, /import \{ useConnectivity \} from ['"]@\/lib\/useConnectivity['"]/);
    assert.match(source, /const isOffline = useConnectivity\(\) === ['"]offline['"]/);
    assert.doesNotMatch(source, /useIsOffline|useNetworkStatus/);
    assert.doesNotMatch(source, /expo-network/, `${path} must not reference expo-network`);
  }

  assert.match(connectivityService, /@react-native-community\/netinfo/);
  assert.match(connectivityService, /reachabilityShouldRun:\s*\(\)\s*=>\s*false/);
});

test("obsolete expo-network hook file is removed and no native code imports expo-network", () => {
  assert.equal(exists("apps/mobile/lib/useNetworkStatus.ts"), false);

  const nativeCodeFiles = readTreeFiles("apps/mobile", new Set([".ts", ".tsx", ".js", ".jsx"]));
  for (const path of nativeCodeFiles) {
    assert.doesNotMatch(
      stripComments(read(path)),
      /from ['"]expo-network['"]|require\(['"]expo-network['"]\)|import\(['"]expo-network['"]\)/,
      `${path} must not import expo-network`,
    );
  }
});

test("manual proof gaps remain explicit instead of being converted into fake code proof", () => {
  assert.match(branchDelta, /Physical-device QA remains manual/);
  assert.match(branchDelta, /Screenshot-led visual parity remains manual/);
  assert.match(branchDelta, /not executed/);
  assert.match(branchDelta, /No real physical-device QA was run/);
  assert.match(branchDelta, /No screenshot capture or visual provider mutation was run/);
});

test("closure adds no Supabase cloud artifacts or deployment requirement", () => {
  const supabaseArtifacts = [
    ...readTreeFiles("supabase/migrations", new Set([".sql"])),
    ...readTreeFiles("supabase/validation", new Set([".sql"])),
    ...readTreeFiles("supabase/functions", new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".toml"])),
  ].filter((path) => /native[-_]?runtime[-_]?visual[-_]?readiness[-_]?closure/i.test(path));

  assert.deepEqual(supabaseArtifacts, [], "closure must not add Supabase artifacts");
  assert.match(branchDelta, /Supabase migration requirement:\s*none/i);
  assert.match(branchDelta, /Edge Function deploy requirement:\s*none/i);
  assert.match(branchDelta, /web\/static deploy requirement:\s*none/i);
  assert.match(branchDelta, /Env vars added\/changed:\s*none/i);
});

test("native module and expo-av posture remains unchanged", () => {
  assert.doesNotMatch(rootPackageJson, /"expo-av"\s*:/);
  assert.doesNotMatch(nativePackageJson, /"expo-av"\s*:/);
  assert.match(nativePackageJson, /"@react-native-community\/netinfo"\s*:/);
  assert.match(branchDelta, /Native module changes:\s*none/i);
  assert.match(branchDelta, /`expo-av`:\s*not used/i);

  const nativeCodeFiles = readTreeFiles("apps/mobile", new Set([".ts", ".tsx", ".js", ".jsx"]));
  for (const path of nativeCodeFiles) {
    assert.doesNotMatch(
      stripComments(read(path)),
      /from ['"]expo-av['"]|require\(['"]expo-av['"]\)|import\(['"]expo-av['"]\)/,
      `${path} must not import expo-av`,
    );
  }
});

test("Stream 10, 16, and 18 source artifacts remain present", () => {
  for (const path of [
    "docs/branch-deltas/fix-native-video-date-contract-recovery.md",
    "shared/matching/nativeVideoDateContractRecovery.test.ts",
    "apps/mobile/app/date/[id].tsx",
    "apps/mobile/lib/videoDateApi.ts",
    "apps/mobile/lib/videoDatePrepareEntry.ts",
    "apps/mobile/lib/videoDateEntryStartable.ts",
    "docs/qa/native-physical-device-qa-runbook.md",
    "docs/branch-deltas/qa-native-physical-device-flow.md",
    "shared/matching/nativePhysicalDeviceQaReadiness.test.ts",
    "docs/qa/screenshot-led-native-visual-parity-capture-plan.md",
    "docs/branch-deltas/fix-screenshot-led-native-visual-parity.md",
    "shared/matching/screenshotLedNativeVisualParity.test.ts",
    "shared/matching/nativeReadyGateParityContract.test.ts",
    "shared/matching/readyGateTerminalUxObservability.test.ts",
  ]) {
    assert.equal(exists(path), true, `${path} should remain present`);
  }
});
