import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const hardeningMigration = read("supabase/migrations/20260507213000_media_lifecycle_admin_hardening.sql");
const adminFunction = read("supabase/functions/admin-media-lifecycle-controls/index.ts");
const workerFunction = read("supabase/functions/process-media-delete-jobs/index.ts");
const panel = read("src/components/admin/AdminMediaLifecyclePanel.tsx");
const packageJson = read("package.json");

test("media lifecycle snapshot uses aggregate SQL instead of Edge full-table scans", () => {
  assert.match(hardeningMigration, /CREATE OR REPLACE FUNCTION public\.summarize_media_lifecycle_snapshot\(\)/);
  assert.match(hardeningMigration, /asset_status_counts/);
  assert.match(hardeningMigration, /orphan_like_counts/);
  assert.match(hardeningMigration, /would_process_now/);
  assert.match(adminFunction, /admin\.rpc\("summarize_media_lifecycle_snapshot"\)/);
  assert.doesNotMatch(adminFunction, /\.from\("media_assets"\)[\s\S]{0,160}\.select\("id, media_family, status/);
});

test("abandoned retries are explicit and claimable", () => {
  assert.match(hardeningMigration, /DROP FUNCTION IF EXISTS public\.retry_failed_media_delete_jobs\(text, integer, boolean\)/);
  assert.match(hardeningMigration, /p_status\s+text\s+DEFAULT NULL/);
  assert.match(hardeningMigration, /WHEN p_reset_attempts OR target_job\.status = 'abandoned' THEN 0/);
  assert.match(hardeningMigration, /target_job\.attempts >= target_job\.max_attempts/);
  assert.match(hardeningMigration, /GREATEST\(target_job\.max_attempts - 1, 0\)/);
  assert.match(adminFunction, /p_status: status/);
  assert.match(panel, /Retry abandoned/);
  assert.match(panel, /status === "abandoned"/);
  assert.match(panel, /reset_attempts: resetAttempts/);
  assert.match(panel, /mutateAsync\(\{ status \}\)/);
  assert.match(panel, /mutateAsync\(\{ family, status \}\)/);
});

test("media lifecycle audit logs do not write string keys into UUID target_id", () => {
  assert.match(adminFunction, /target_id: null/);
  assert.match(adminFunction, /details: \{ \.\.\.details, target_key: targetKey \}/);
  assert.match(adminFunction, /audit_logged: false/);
  assert.match(panel, /warnIfAuditMissing/);
});

test("cron status exposes structured states and stable run ids", () => {
  assert.match(hardeningMigration, /'status', 'missing_job'/);
  assert.match(hardeningMigration, /'recent_runs_unavailable'/);
  assert.match(hardeningMigration, /'runid',\s+v_runid/);
  assert.match(hardeningMigration, /SET search_path = public, pg_catalog/);
  assert.match(adminFunction, /status: "rpc_error" as CronStatusCode/);
  assert.match(adminFunction, /buildActivationRecommendation/);
  assert.match(adminFunction, /cron job missing/);
  assert.match(adminFunction, /cron status RPC unavailable/);
  assert.match(panel, /cron_status/);
  assert.match(panel, /const cronHealthy = cronStatus\?\.status === "found"/);
  assert.match(panel, /opsHealth\?\.healthy === true/);
  assert.match(panel, /Cron status RPC failed/);
});

test("media lifecycle validation failures are surfaced as operator-safe 400s", () => {
  assert.match(adminFunction, /function validationResponse/);
  assert.match(adminFunction, /Invalid media lifecycle input/);
  assert.match(adminFunction, /return validationResponse\(error\)/);
});

test("worker promotion accepts family filter before claiming jobs", () => {
  assert.match(hardeningMigration, /DROP FUNCTION IF EXISTS public\.promote_purgeable_assets\(integer\)/);
  assert.match(hardeningMigration, /p_family_filter text DEFAULT NULL/);
  assert.match(hardeningMigration, /a\.media_family = p_family_filter/);
  assert.match(workerFunction, /p_family_filter: familyFilter/);
});

test("service-role media lifecycle RPC grants are not inherited through PUBLIC", () => {
  for (const signature of [
    "summarize_media_lifecycle_snapshot\\(\\)",
    "promote_purgeable_assets\\(integer, text\\)",
    "retry_failed_media_delete_jobs\\(text, integer, boolean, text\\)",
    "get_media_worker_cron_status\\(text, integer\\)",
  ]) {
    assert.match(
      hardeningMigration,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature} FROM PUBLIC, anon, authenticated;`),
    );
    assert.match(
      hardeningMigration,
      new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature} TO service_role;`),
    );
  }
});

test("media lifecycle contract test is exposed in package scripts", () => {
  assert.match(packageJson, /test:admin-media-lifecycle/);
});
