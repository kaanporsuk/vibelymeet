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

const currentFunctionDirs = functionDirs();
const currentConfigEntries = configJwtEntries();
const jwtTrueFunctions = [...currentConfigEntries.entries()]
  .filter(([, verifyJwt]) => verifyJwt)
  .map(([slug]) => slug)
  .sort();
const jwtFalseFunctions = [...currentConfigEntries.entries()]
  .filter(([, verifyJwt]) => !verifyJwt)
  .map(([slug]) => slug)
  .sort();

test("closure addresses the final release-ops investigation finding", () => {
  assert.equal(exists(investigationPath), true);
  assert.match(investigation, /WARN/);
  assert.match(investigation, /stale .*Edge Function inventory text|older historical Edge Function deploy section/);
  assert.equal(exists(branchDeltaPath), true);
  const branchDelta = read(branchDeltaPath);
  assert.match(branchDelta, new RegExp(investigationPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(branchDelta, /stale operator runbook Edge Function inventory/);
});

test("runbook section 13 uses the current function inventory and JWT counts", () => {
  assert.match(section13, new RegExp(`${currentFunctionDirs.length} deployable function directories`));
  assert.match(section13, new RegExp(`${currentConfigEntries.size} matching ` + "`\\[functions\\.<slug>\\]` entries"));
  assert.match(section13, new RegExp(`${jwtTrueFunctions.length} functions have gateway JWT verification on`));
  assert.match(section13, new RegExp(`${jwtFalseFunctions.length} functions have gateway JWT verification off`));
  assert.match(section13, /schdyxcunwcvddlcshwd \/ MVP_Vibe/);
  assert.match(section13, /_cursor_context\/vibely_edge_function_manifest\.md/);
  assert.match(section13, /supabase\/config\.toml/);
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
  const dirs = currentFunctionDirs;
  const config = currentConfigEntries;
  assert.equal(config.size, dirs.length);
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
