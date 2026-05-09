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

function extractSection(source: string, startHeading: string, endHeading: string): string {
  const start = source.indexOf(startHeading);
  const end = source.indexOf(endHeading, start + startHeading.length);
  assert.notEqual(start, -1, `${startHeading} should exist`);
  assert.notEqual(end, -1, `${endHeading} should exist after ${startHeading}`);
  return source.slice(start, end);
}

function functionDirs(): string[] {
  return readdirSync(join(root, "supabase/functions"))
    .filter((name) => name !== "_shared")
    .filter((name) => statSync(join(root, "supabase/functions", name)).isDirectory())
    .sort();
}

function configJwtEntries(): Map<string, boolean> {
  const entries = new Map<string, boolean>();
  const config = read("supabase/config.toml");
  for (const match of config.matchAll(/^\[functions\.([^\]]+)\]\s*\nverify_jwt = (true|false)$/gm)) {
    entries.set(match[1], match[2] === "true");
  }
  return entries;
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

const investigationPath = "docs/investigations/final-release-ops-readiness.md";
const branchDeltaPath = "docs/branch-deltas/fix-final-release-ops-readiness-closure.md";
const runbookPath = "_cursor_context/vibely_rebuild_runbook.md";
const investigation = read(investigationPath);
const runbook = read(runbookPath);
const section13 = extractSection(runbook, "## 13. Edge Function inventory to deploy", "## 14. Optional local function serving");

const jwtTrueFunctions = [
  "admin-data-export",
  "admin-media-lifecycle-controls",
  "admin-proof-selfie-sign",
  "admin-review-verification",
  "admin-video-date-ops",
  "cancel-deletion",
  "chat-thread-page",
  "create-checkout-session",
  "create-event-checkout",
  "create-portal-session",
  "create-video-upload",
  "daily-drop-actions",
  "daily-room",
  "date-suggestion-actions",
  "delete-account",
  "delete-vibe-video",
  "email-verification",
  "event-notifications",
  "forward-geocode",
  "geocode",
  "phone-verify",
  "post-date-verdict",
  "send-game-event",
  "send-message",
  "send-notification",
  "send-support-reply",
  "swipe-actions",
  "sync-revenuecat-subscriber",
  "sync-vibe-video-status",
  "upload-chat-video",
  "upload-event-cover",
  "upload-image",
  "upload-voice",
  "verify-admin",
].sort();

const jwtFalseFunctions = [
  "check-daily-drop-health",
  "create-credits-checkout",
  "credit-replenish",
  "date-reminder-cron",
  "date-suggestion-expiry",
  "event-reminders",
  "generate-daily-drops",
  "get-chat-media-url",
  "health",
  "match-call-room-cleanup",
  "post-date-verdict-reminders",
  "process-media-delete-jobs",
  "process-waitlist-promotion-notify-queue",
  "push-webhook",
  "record-growth-attribution",
  "request-account-deletion",
  "revenuecat-webhook",
  "send-email",
  "stripe-webhook",
  "video-date-room-cleanup",
  "video-webhook",
].sort();

test("closure addresses the final release-ops investigation finding", () => {
  assert.equal(exists(investigationPath), true);
  assert.match(investigation, /WARN/);
  assert.match(investigation, /stale historical Edge Function inventory text/);
  assert.equal(exists(branchDeltaPath), true);
  const branchDelta = read(branchDeltaPath);
  assert.match(branchDelta, new RegExp(investigationPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(branchDelta, /stale operator runbook Edge Function inventory/);
});

test("runbook section 13 uses the current function inventory and JWT counts", () => {
  assert.match(section13, /55 deployable function directories/);
  assert.match(section13, /55 matching `\[functions\.<slug>\]` entries/);
  assert.match(section13, /34 functions\*\* have `verify_jwt = true`/);
  assert.match(section13, /21 functions\*\* have `verify_jwt = false`/);
  assert.match(section13, /schdyxcunwcvddlcshwd \/ MVP_Vibe/);
  for (const slug of [...jwtTrueFunctions, ...jwtFalseFunctions]) {
    assert.match(section13, new RegExp(`\\\`${slug}\\\``), `${slug} should be listed in Section 13`);
  }
});

test("runbook section 13 no longer carries stale historical function guidance", () => {
  for (const stalePattern of [/all 30/i, /30 baseline/i, /23 functions/i, /7 functions/i]) {
    assert.doesNotMatch(section13, stalePattern);
  }
  for (const removedSlug of ["account-pause", "account-resume", "email-drip", "unsubscribe", "vibe-notification"]) {
    assert.doesNotMatch(section13, new RegExp(`\\\`${removedSlug}\\\``), `${removedSlug} should not remain in Section 13`);
  }
});

test("runbook Section 13 inventory matches config and function directories", () => {
  const dirs = functionDirs();
  const config = configJwtEntries();
  assert.equal(dirs.length, 55);
  assert.equal(config.size, 55);
  assert.deepEqual([...config.keys()].sort(), dirs);
  assert.deepEqual(
    [...config.entries()]
      .filter(([, verifyJwt]) => verifyJwt)
      .map(([slug]) => slug)
      .sort(),
    jwtTrueFunctions,
  );
  assert.deepEqual(
    [...config.entries()]
      .filter(([, verifyJwt]) => !verifyJwt)
      .map(([slug]) => slug)
      .sort(),
    jwtFalseFunctions,
  );
});

test("closure is docs/test only with no Supabase or native drift", () => {
  assert.equal(
    readdirSync(join(root, "supabase/migrations")).some((name) => /final.*release.*ops.*closure/i.test(name)),
    false,
    "closure should not add a Supabase migration",
  );
  assert.equal(
    readdirSync(join(root, "supabase/validation")).some((name) => /final.*release.*ops.*closure/i.test(name)),
    false,
    "closure should not add validation SQL without a migration",
  );
  assert.equal(
    readdirSync(join(root, "supabase/functions")).some((name) => /final.*release.*ops.*closure/i.test(name)),
    false,
    "closure should not add an Edge Function",
  );
  const branchDelta = read(branchDeltaPath);
  assert.match(branchDelta, /Supabase migration requirement: none/);
  assert.match(branchDelta, /Edge Function deploy requirement: none/);
  assert.match(branchDelta, /Env vars added\/changed: none/);
  assert.match(branchDelta, /Native module changes: none/);
  assert.match(branchDelta, /`expo-av`: not used/);
});

test("manual release gates remain explicit and no real provider smoke is claimed", () => {
  const branchDelta = read(branchDeltaPath);
  for (const marker of [
    "RevenueCat dashboard",
    "controlled OneSignal",
    "controlled Bunny",
    "controlled Daily",
    "Resend controlled email",
    "Twilio controlled phone",
    "physical-device",
    "screenshot-led",
  ]) {
    assert.match(`${investigation}\n${branchDelta}`, new RegExp(marker, "i"));
  }
  assert.match(branchDelta, /Production Smoke Limitations/);
  assert.match(branchDelta, /No real provider smoke was run/);
});

test("closure keeps native module and expo-av guardrails intact", () => {
  const rootPackageJson = read("package.json");
  const nativePackageJson = read("apps/mobile/package.json");
  assert.doesNotMatch(rootPackageJson, /"expo-av"\s*:/);
  assert.doesNotMatch(nativePackageJson, /"expo-av"\s*:/);
  for (const path of readTreeFiles("apps/mobile", new Set([".ts", ".tsx", ".js", ".jsx"]))) {
    assert.doesNotMatch(
      read(path),
      /from ['"]expo-av['"]|require\(['"]expo-av['"]\)|import\(['"]expo-av['"]\)/,
      `${path} must not import expo-av`,
    );
  }
});
