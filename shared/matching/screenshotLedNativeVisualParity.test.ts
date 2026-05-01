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

const capturePlanPath = "docs/qa/screenshot-led-native-visual-parity-capture-plan.md";
const branchDeltaPath = "docs/branch-deltas/fix-screenshot-led-native-visual-parity.md";
const capturePlan = read(capturePlanPath);
const branchDelta = read(branchDeltaPath);
const rootPackageJson = read("package.json");
const nativePackageJson = read("apps/mobile/package.json");

const targetScreens = [
  "Auth / sign in / sign up",
  "Onboarding",
  "Dashboard/home",
  "Events list",
  "Event details",
  "Event lobby",
  "Ready Gate overlay and route",
  "Video date route",
  "Matches list",
  "Chat thread",
  "Profile Studio",
  "Settings",
  "Push permission / notification surfaces",
  "Vibe Video surfaces",
] as const;

test("screenshot capture plan exists and documents web as source of truth", () => {
  assert.equal(exists(capturePlanPath), true);
  assert.match(capturePlan, /Web is the visual and product source of truth/);
  assert.match(capturePlan, /Do not infer visual differences from memory/);
  assert.match(capturePlan, /No comparable web\/native screen captures were present/);
});

test("target screen matrix covers the Stream 18 scope", () => {
  assert.match(capturePlan, /Target Screen Matrix/);
  for (const screen of targetScreens) {
    assert.match(capturePlan, new RegExp(screen.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("capture plan includes exact web and native capture instructions", () => {
  assert.match(capturePlan, /1440 x 900/);
  assert.match(capturePlan, /390 x 844/);
  assert.match(capturePlan, /iPhone 15 Pro Max/);
  assert.match(capturePlan, /iPhone SE/);
  assert.match(capturePlan, /Pixel 7/);
  assert.match(capturePlan, /npm run dev -- --host 127\.0\.0\.1/);
  assert.match(capturePlan, /xcrun devicectl list devices/);
  assert.match(capturePlan, /npm run ios -- --device/);
  assert.match(capturePlan, /Do not run local Supabase/);
});

test("comparison rubric prevents fabricated visual differences", () => {
  for (const marker of [
    "page structure and section order",
    "primary/secondary action labels",
    "recovery, empty, terminal, and error copy",
    "spacing rhythm and card density",
    "keyboard/safe-area behavior on native",
    "Only implement differences that are concrete, scoped, and high-confidence",
  ]) {
    assert.match(capturePlan, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("key native screens remain present", () => {
  for (const path of [
    "apps/mobile/app/(auth)/sign-in.tsx",
    "apps/mobile/app/(onboarding)/index.tsx",
    "apps/mobile/app/(tabs)/index.tsx",
    "apps/mobile/app/(tabs)/events/index.tsx",
    "apps/mobile/app/(tabs)/events/[id].tsx",
    "apps/mobile/app/event/[eventId]/lobby.tsx",
    "apps/mobile/components/lobby/ReadyGateOverlay.tsx",
    "apps/mobile/app/ready/[id].tsx",
    "apps/mobile/app/date/[id].tsx",
    "apps/mobile/app/(tabs)/matches/index.tsx",
    "apps/mobile/app/chat/[id].tsx",
    "apps/mobile/app/(tabs)/profile/ProfileStudio.tsx",
    "apps/mobile/app/settings/index.tsx",
    "apps/mobile/components/notifications/PushPermissionPrompt.tsx",
    "apps/mobile/app/vibe-video-record.tsx",
    "apps/mobile/components/video/VibeVideoPlayer.tsx",
  ]) {
    assert.equal(exists(path), true, `${path} should exist for screenshot-led parity capture`);
  }
});

test("web source-of-truth screens remain present", () => {
  for (const path of [
    "src/pages/Auth.tsx",
    "src/pages/onboarding/index.tsx",
    "src/pages/Dashboard.tsx",
    "src/pages/Events.tsx",
    "src/pages/EventDetails.tsx",
    "src/pages/EventLobby.tsx",
    "src/components/lobby/ReadyGateOverlay.tsx",
    "src/pages/VideoDate.tsx",
    "src/pages/Matches.tsx",
    "src/pages/Chat.tsx",
    "src/pages/ProfileStudio.tsx",
    "src/pages/Settings.tsx",
    "src/components/PushPermissionPrompt.tsx",
    "src/components/vibe-video/VibeStudioModal.tsx",
  ]) {
    assert.equal(exists(path), true, `${path} should exist as web source-of-truth surface`);
  }
});

test("branch delta records screenshot availability, no fixes, and no cloud deploy requirement", () => {
  assert.equal(exists(branchDeltaPath), true);
  assert.match(branchDelta, /No comparable web\/native screen captures were present/);
  assert.match(branchDelta, /No native UI fixes were made/);
  assert.match(branchDelta, /Manual screenshot capture remains required/);
  assert.match(branchDelta, /Edge Function deploy: not required/);
  assert.match(branchDelta, /Supabase deploy: not required/);
});

test("Stream 18 adds no backend migrations or Edge Functions", () => {
  assert.equal(
    readdirSync(join(root, "supabase/migrations")).some((name) => /screenshot|visual|parity/i.test(name)),
    false,
    "Stream 18 should not add a Supabase migration",
  );
  assert.equal(
    readdirSync(join(root, "supabase/functions")).some((name) => /screenshot|visual|parity/i.test(name)),
    false,
    "Stream 18 should not add an Edge Function",
  );
  assert.match(branchDelta, /No Supabase migration added/);
  assert.match(branchDelta, /No Edge Function changed/);
});

test("Stream 18 adds no native modules or expo-av usage", () => {
  assert.doesNotMatch(rootPackageJson, /"expo-av"\s*:/);
  assert.doesNotMatch(nativePackageJson, /"expo-av"\s*:/);
  const nativeFiles = readTreeFiles("apps/mobile", new Set([".ts", ".tsx", ".js", ".jsx"]));
  for (const path of nativeFiles) {
    assert.doesNotMatch(
      read(path),
      /from ['"]expo-av['"]|require\(['"]expo-av['"]\)|import\(['"]expo-av['"]\)/,
      `${path} must not import expo-av`,
    );
  }
  assert.match(branchDelta, /No native modules added/);
  assert.match(branchDelta, /No `expo-av` import or package added/);
});

test("prior native parity and QA artifacts remain present", () => {
  for (const path of [
    "docs/phase8-stage1-parity-and-functionality-audit.md",
    "docs/branch-deltas/fix-native-ready-gate-parity-contract.md",
    "docs/branch-deltas/fix-native-video-date-contract-recovery.md",
    "docs/branch-deltas/qa-native-physical-device-flow.md",
    "docs/qa/native-physical-device-qa-runbook.md",
    "shared/matching/nativeReadyGateParityContract.test.ts",
    "shared/matching/nativeVideoDateContractRecovery.test.ts",
    "shared/matching/nativePhysicalDeviceQaReadiness.test.ts",
    "shared/matching/revenueCatNativeEntitlementReadiness.test.ts",
  ]) {
    assert.equal(exists(path), true, `${path} should remain present`);
  }
});
