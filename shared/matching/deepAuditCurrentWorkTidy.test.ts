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
  ignored = new Set(["node_modules", ".expo", ".next", "dist", "build", "coverage", "Pods"]),
): string[] {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
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

const auditPath = "docs/audits/deep-audit-current-work-tidy-2026-05-01.md";
const branchDeltaPath = "docs/branch-deltas/chore-deep-audit-current-work-tidy.md";
const activeDocMap = read("docs/active-doc-map.md");
const auditReport = read(auditPath);
const branchDelta = read(branchDeltaPath);

test("current work audit and branch delta capture docs-test-only tidy scope", () => {
  assert.match(auditReport, /PASS with tidy/);
  assert.match(auditReport, /No runtime code was changed/);
  assert.match(auditReport, /No Supabase cloud mutation/);
  assert.match(auditReport, /No safe obsolete-file deletion candidate was found/);
  assert.match(branchDelta, /Kept cleanup docs\/test-only/);
  assert.match(branchDelta, /No broad historical-doc purge/);
  assert.match(branchDelta, /No deletion of mechanical orphan component candidates without product\/route-level proof/);
});

test("active doc map includes latest Event Lobby batch-1 audit closure trail", () => {
  assert.match(activeDocMap, /Event Lobby batch-1 backend contract investigation closure/);
  assert.match(activeDocMap, /event-lobby-investigation-batch-1-backend-contracts\.md/);
  assert.match(activeDocMap, /fix-event-lobby-investigation-batch-1-backend-contracts-closure\.md/);
  assert.match(activeDocMap, /eventLobbyInvestigationBatch1Closure\.test\.ts/);
  assert.match(activeDocMap, new RegExp(auditPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(activeDocMap, new RegExp(branchDeltaPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(activeDocMap, /deepAuditCurrentWorkTidy\.test\.ts/);
});

test("previously removed obsolete docs and backups stay removed", () => {
  for (const path of [
    "docs/notification-permission-audit.md",
    "docs/phase7-stage3-onesignal-daily-validation.md",
    "_cursor_context/vibely_rebuild_master_backup_chatgpt.md",
  ]) {
    assert.equal(exists(path), false, `${path} should remain removed`);
  }
});

test("surface inventory remains triage-only and does not justify broad deletion", () => {
  const surfaceInventory = read("docs/audits/surface-inventory-candidates-2026-04-14.md");
  assert.match(surfaceInventory, /Orphan pages \(0\)/);
  assert.match(surfaceInventory, /Orphan hooks \(0\)/);
  assert.match(surfaceInventory, /Orphan components \(41\)/);
  assert.match(surfaceInventory, /Treat this file as a triage queue, not a deletion manifest/);
  assert.match(auditReport, /No safe obsolete-file deletion candidate was found/);
});

test("recent investigation and closure artifacts remain present", () => {
  for (const path of [
    "docs/audits/event-lobby-investigation-batch-1-backend-contracts.md",
    "docs/branch-deltas/fix-event-lobby-investigation-batch-1-backend-contracts-closure.md",
    "shared/matching/eventLobbyInvestigationBatch1Closure.test.ts",
    "docs/investigations/final-release-ops-readiness.md",
    "docs/branch-deltas/fix-final-release-ops-readiness-closure.md",
    "shared/matching/finalReleaseOpsReadinessClosure.test.ts",
    "docs/audits/deep-audit-implemented-work-2026-05-01.md",
    "docs/branch-deltas/chore-deep-audit-implemented-work-tidy.md",
    "shared/matching/deepAuditImplementedWorkTidy.test.ts",
  ]) {
    assert.equal(exists(path), true, `${path} should exist`);
  }
});

test("tidy pass adds no backend cloud artifact, env var, native module, or expo-av usage", () => {
  assert.equal(
    readdirSync(join(root, "supabase/migrations")).some((name) => name.includes("deep_audit_current_work")),
    false,
  );
  assert.equal(exists("supabase/validation/deep_audit_current_work.sql"), false);
  assert.doesNotMatch(branchDelta, /Edge Function deploy requirement:\s*(?!none)/i);
  assert.match(branchDelta, /Supabase migration requirement: none/);
  assert.match(branchDelta, /Env vars added\/changed: none/);
  assert.match(branchDelta, /Native module changes: none/);
  assert.match(branchDelta, /`expo-av`: not used/);

  for (const path of ["package.json", "apps/mobile/package.json"]) {
    assert.doesNotMatch(read(path), /"expo-av"\s*:/, `${path} must not add expo-av`);
  }

  for (const path of [
    ...readTreeFiles("src", new Set([".ts", ".tsx", ".js", ".jsx"])),
    ...readTreeFiles("apps/mobile", new Set([".ts", ".tsx", ".js", ".jsx"])),
    ...readTreeFiles("shared", new Set([".ts", ".tsx", ".js", ".jsx"])),
    ...readTreeFiles("supabase/functions", new Set([".ts", ".tsx", ".js", ".jsx"])),
  ]) {
    assert.doesNotMatch(
      read(path),
      /from ['"]expo-av['"]|require\(['"]expo-av['"]\)|import\(['"]expo-av['"]\)/,
      `${path} must not import expo-av`,
    );
  }
});
