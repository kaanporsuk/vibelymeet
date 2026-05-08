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

const rehearsalPath = "docs/release/final-hardening-release-rehearsal.md";
const branchDeltaPath = "docs/branch-deltas/docs-final-hardening-release-rehearsal.md";
const rehearsal = read(rehearsalPath);
const branchDelta = read(branchDeltaPath);
const supabaseConfig = read("supabase/config.toml");
const rootPackageJson = read("package.json");
const nativePackageJson = read("apps/mobile/package.json");

test("final hardening release rehearsal doc exists", () => {
  assert.equal(exists(rehearsalPath), true);
  assert.match(rehearsal, /Final Hardening Release Rehearsal/);
  assert.match(rehearsal, /Purpose And Scope/);
});

test("stream ledger includes Streams 1 through 19", () => {
  assert.match(rehearsal, /Merged Stream Ledger/);
  for (let stream = 1; stream <= 19; stream += 1) {
    assert.match(rehearsal, new RegExp(`Stream ${stream}\\b`), `Stream ${stream} should be recorded`);
  }
  for (const path of [
    "docs/branch-deltas/fix-event-lobby-active-event-contract.md",
    "docs/branch-deltas/fix-ready-gate-transition-expiry-rowcount.md",
    "docs/branch-deltas/fix-ready-gate-event-ended-terminalization.md",
    "docs/branch-deltas/fix-ready-gate-contract-consumer-compliance.md",
    "docs/branch-deltas/fix-ready-gate-terminal-ux-observability.md",
    "docs/branch-deltas/fix-native-ready-gate-parity-contract.md",
    "docs/branch-deltas/fix-realtime-subscription-tightening.md",
    "docs/branch-deltas/fix-swipe-retry-idempotency-notification-dedupe.md",
    "docs/branch-deltas/fix-premium-credits-observability.md",
    "docs/branch-deltas/fix-native-video-date-contract-recovery.md",
    "docs/branch-deltas/fix-onesignal-provider-operational-qa.md",
    "docs/branch-deltas/fix-bunny-provider-operational-qa.md",
    "docs/branch-deltas/fix-daily-provider-operational-qa.md",
    "docs/branch-deltas/fix-resend-email-provider-operational-qa.md",
    "docs/branch-deltas/fix-twilio-phone-verification-qa.md",
    "docs/branch-deltas/qa-native-physical-device-flow.md",
    "docs/branch-deltas/fix-revenuecat-native-entitlement-readiness.md",
    "docs/branch-deltas/fix-screenshot-led-native-visual-parity.md",
    "docs/branch-deltas/fix-supabase-function-config-gaps.md",
  ]) {
    assert.equal(exists(path), true, `${path} should remain present`);
  }
});

test("no-Docker and no-local-Supabase operating model is recorded", () => {
  assert.match(rehearsal, /No Docker command was run/);
  assert.match(rehearsal, /No local Supabase command was run/);
  assert.match(rehearsal, /No `supabase db push` was run/);
  assert.match(branchDelta, /Docker: not used/);
  assert.match(branchDelta, /Local Supabase: not used/);
});

test("Supabase project ref and current function inventory are recorded", () => {
  assert.match(supabaseConfig, /project_id = "schdyxcunwcvddlcshwd"/);
  assert.match(rehearsal, /schdyxcunwcvddlcshwd \/ MVP_Vibe/);
  assert.match(rehearsal, /53 deployable function directories/);
  assert.match(rehearsal, /53 `\[functions\.<slug>\]` entries|53 `\[functions\.<slug>\]` entries/);
  assert.equal(
    readdirSync(join(root, "supabase/functions"))
      .filter((name) => name !== "_shared")
      .filter((name) => statSync(join(root, "supabase/functions", name)).isDirectory())
      .length,
    53,
  );
});

test("provider manual checklist section exists for required providers", () => {
  assert.match(rehearsal, /Provider Manual Checklist/);
  for (const marker of [
    "Controlled OneSignal push QA",
    "Controlled Bunny media QA",
    "Controlled Daily room QA",
    "Resend controlled email QA",
    "Twilio controlled phone QA",
    "RevenueCat/App Store entitlement setup",
    "Physical-device native QA",
    "Screenshot-led native visual parity",
  ]) {
    assert.match(rehearsal, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(branchDelta, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("Stream 20 adds no migrations or Edge Function changes", () => {
  assert.equal(
    readdirSync(join(root, "supabase/migrations")).some((name) => /final.*hardening|release.*rehearsal/i.test(name)),
    false,
    "Stream 20 should not add a Supabase migration",
  );
  assert.equal(
    readdirSync(join(root, "supabase/functions")).some((name) => /final.*hardening|release.*rehearsal/i.test(name)),
    false,
    "Stream 20 should not add an Edge Function",
  );
  assert.match(branchDelta, /Edge Function files changed: none/);
  assert.match(branchDelta, /Edge Function deploy: not required/);
  assert.match(rehearsal, /No Supabase deploy was required or performed by Stream 20/);
});

test("Stream 20 adds no native modules or expo-av usage", () => {
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
  assert.match(branchDelta, /Native modules: none/);
  assert.match(branchDelta, /`expo-av`: not imported or required/);
});

test("release go/no-go and rollback sections exist", () => {
  assert.match(rehearsal, /Release Go\/No-Go Recommendation/);
  assert.match(rehearsal, /go for merging the hardening\/rehearsal documentation/);
  assert.match(rehearsal, /no-go for broad public release/);
  assert.match(rehearsal, /Rollback Notes/);
  assert.match(rehearsal, /Exact Next Operator Steps/);
});
