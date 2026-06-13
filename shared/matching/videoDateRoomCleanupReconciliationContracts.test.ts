import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Cron-merge stage 1 contracts (docs/investigations/video-date-room-cleanup-consolidation-plan.md):
// video-date-room-cleanup owns both passes — the session pass every minute tick and the
// provider-reconciliation pass (orphan-lane semantics, transplanted) at the marker-gated
// 10-minute cadence. The orphan lane keeps running unchanged during the 24h observation window;
// dropping its cron + function is the explicitly separate stage 2.

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const cleanupIndex = read("supabase/functions/video-date-room-cleanup/index.ts");
const reconciliation = read("supabase/functions/video-date-room-cleanup/reconciliation.ts");
const orphanLane = read("supabase/functions/video-date-orphan-room-cleanup/index.ts");
const markerMigration = read(
  "supabase/migrations/20260613000240_vd_room_cleanup_reconciliation_marker_action.sql",
);
const markerTableConstraintMigration = read(
  "supabase/migrations/20260613001450_vd_room_cleanup_reconciliation_marker_table_constraint.sql",
);
const packageJson = read("package.json");

test("merged cleanup wires the reconciliation pass into the minute cron entrypoint", () => {
  assert.match(cleanupIndex, /import \{ maybeRunReconciliationPass \} from "\.\/reconciliation\.ts"/);
  assert.match(cleanupIndex, /const reconciliation = await maybeRunReconciliationPass\(supabase, \{/);
  assert.match(cleanupIndex, /force: reconcileForced,/);
  assert.match(cleanupIndex, /dryRun: reconcileDryRun,/);
  assert.match(cleanupIndex, /source: reconcileSource,/);
  // Operator/manual probe contract: reconcile_now forces a pass; dry_run never deletes.
  assert.match(cleanupIndex, /requestBody\.reconcile_now === true/);
  assert.match(cleanupIndex, /requestBody\.dry_run === true/);
  // The outcome is observable in both the summary log and the HTTP response.
  const reconciliationMentions = cleanupIndex.match(/reconciliation,/g) ?? [];
  assert.ok(reconciliationMentions.length >= 2, "summary log and response both report the pass");
});

test("reconciliation pass keeps the orphan lane's safety semantics verbatim", () => {
  // Same room scope and grace windows as the orphan lane.
  assert.match(reconciliation, /\/\^date-\[0-9a-f\]\{32\}\$\//);
  assert.match(reconciliation, /RECENT_ORPHAN_GRACE_MS = 15 \* 60 \* 1000/);
  assert.match(reconciliation, /TERMINAL_DB_GRACE_MS = 2 \* 60 \* 1000/);
  // Same interlock, same audit RPC, same double presence check before any delete.
  assert.match(reconciliation, /video_date_orphan_safety_interlock_v1/);
  assert.match(reconciliation, /record_video_date_orphan_room_cleanup_audit_v2/);
  assert.match(reconciliation, /provider_presence_active_second_check/);
  assert.match(reconciliation, /provider_presence_second_check_failed/);
  assert.match(reconciliation, /action: "delete_candidate"/);
  // Same skip taxonomy.
  for (const action of [
    "skipped_active",
    "skipped_recent",
    "skipped_unknown",
    "skipped_safety_review",
    "dry_run_delete",
    "delete_failed",
  ]) {
    assert.match(reconciliation, new RegExp(`action: "${action}"`));
  }
  // Same bounded-delete interlock parameters the orphan lane runs with in production.
  assert.match(reconciliation, /RECONCILIATION_BATCH_SIZE = 100/);
  assert.match(reconciliation, /ROOM_LIST_MAX_PAGES = 10/);
  assert.match(reconciliation, /counters\.deleteAttempts >= RECONCILIATION_BATCH_SIZE/);
  // Attribution-only deviations: distinct source prefix and stamp prefix.
  assert.match(reconciliation, /`room_cleanup:\$\{params\.source\}`/);
  assert.match(reconciliation, /`room_cleanup_reconciliation:\$\{reason\}`/);
});

test("reconciliation cadence is marker-gated and failure-safe", () => {
  assert.match(reconciliation, /MARKER_ACTION = "reconciliation_run"/);
  assert.match(reconciliation, /MARKER_ROOM_NAME = "reconciliation-cycle"/);
  assert.match(
    reconciliation,
    /VIDEO_DATE_ROOM_CLEANUP_RECONCILIATION_INTERVAL_SECONDS", 600, 60, 3600/,
  );
  assert.match(reconciliation, /nowMs - marker\.lastMs < RECONCILIATION_INTERVAL_MS/);
  // Dry runs must not advance the marker; failed scans must not advance the marker.
  assert.match(reconciliation, /params\.dryRun\s*\?\s*false\s*:\s*await recordReconciliationMarker/);
  assert.match(reconciliation, /reason: "scan_complete"/);
  // The migration allowlists the marker action without touching any other action.
  assert.match(markerMigration, /'reconciliation_run'/);
  assert.match(markerMigration, /record_video_date_orphan_room_cleanup_audit_v2/);
  for (const action of [
    "'delete_candidate'",
    "'dry_run_delete'",
    "'deleted'",
    "'skipped_active'",
    "'skipped_recent'",
    "'skipped_unknown'",
    "'skipped_safety_review'",
    "'delete_failed'",
  ]) {
    assert.ok(markerMigration.includes(action), `${action} stays allowlisted`);
    assert.ok(
      markerTableConstraintMigration.includes(`${action}::text`),
      `${action} stays in the table CHECK constraint`,
    );
  }
  // The table-level action CHECK is a second gate the live gate caught (23514); both must list
  // the marker action.
  assert.match(markerTableConstraintMigration, /'reconciliation_run'::text/);
  assert.match(
    markerTableConstraintMigration,
    /video_date_orphan_room_cleanup_audit_action_check/,
  );
});

test("stage 1 leaves the orphan lane running for the observation window", () => {
  // Stage 2 (cron + function drop) happens only after 24h of reconciliation audit rows in
  // production — see the consolidation plan. Flip these pins in that PR.
  assert.equal(
    existsSync(join(root, "supabase/functions/video-date-orphan-room-cleanup/index.ts")),
    true,
  );
  assert.match(orphanLane, /video_date_orphan_safety_interlock_v1/);
  const cronSnapshot = read("supabase/contract-fixtures/2026-06/snapshots/cron_jobs.json");
  assert.match(cronSnapshot, /video-date-orphan-room-cleanup/);
});

test("session pass stays the untouched production lane", () => {
  // The session lane's own safety posture is pinned elsewhere; here we only assert the merge
  // did not reorder it: the reconciliation pass runs after the session loop completes.
  const sessionLoopIndex = cleanupIndex.indexOf("for (const row of (rows ?? [])");
  const reconciliationCallIndex = cleanupIndex.indexOf("await maybeRunReconciliationPass");
  assert.ok(sessionLoopIndex > 0 && reconciliationCallIndex > sessionLoopIndex);
  // Raw fetch stays out of the minute-tick session lane (dailyProviderOperationalQa pin).
  assert.doesNotMatch(cleanupIndex, /(?<!WithTimeout)fetch\(/);
});

test("reconciliation contract suite is wired into the curated battery", () => {
  assert.match(packageJson, /videoDateRoomCleanupReconciliationContracts\.test\.ts/);
});
