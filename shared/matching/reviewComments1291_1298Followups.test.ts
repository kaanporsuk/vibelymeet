import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const sessionRow = read("src/lib/videoDateSessionRow.ts");
const startSnapshot = read("shared/matching/videoDateStartSnapshot.ts");
const nativePartnerProfile = read("apps/mobile/lib/videoDatePartnerProfile.ts");
const repairMigration = read(
  "supabase/migrations/20260611141603_review_comments_1291_1298_followups.sql",
);
const prepareEntryValidation = read("supabase/validation/video_date_prepare_entry_lease.sql");
const eventEndedValidation = read("supabase/validation/ready_gate_event_ended_terminalization.sql");
const endToEndValidation = read("supabase/validation/video_date_end_to_end_hardening.sql");
const sprint7Docs = read("docs/observability/video-date-sprint7-safety-privacy-ops.md");
const operatorMetrics = read("docs/observability/video-date-operator-metrics.md");
const branchDelta = read("docs/branch-deltas/review-comments-1291-1298-followups.md");
const packageJson = read("package.json");

test("PR 1291 native partner-profile memoization is already viewer-scoped", () => {
  assert.match(nativePartnerProfile, /supabase\.auth\.getSession\(\)/);
  assert.match(
    nativePartnerProfile,
    /getVideoDatePartnerProfileCacheKey\(session\?\.user\?\.id \?\? null, partnerId\)/,
  );
  assert.match(nativePartnerProfile, /cache\.get\(cacheKey\)/);
  assert.match(nativePartnerProfile, /inFlight\.get\(cacheKey\)/);
  assert.match(nativePartnerProfile, /cache\.set\(cacheKey,/);
});

test("PR 1292 fresh session-row reads bypass non-fresh in-flight requests", () => {
  assert.match(sessionRow, /const freshKey = `\$\{sessionId\}:fresh`;/);
  assert.match(sessionRow, /const defaultKey = `\$\{sessionId\}:default`;/);
  assert.match(
    sessionRow,
    /if \(!options\?\.fresh\) \{[\s\S]*const existingFresh = rowInFlight\.get\(freshKey\);[\s\S]*if \(existingFresh\) return existingFresh;/,
  );
  assert.match(sessionRow, /const inFlightKey = options\?\.fresh \? freshKey : defaultKey;/);
  assert.doesNotMatch(sessionRow, /rowInFlight\.get\(sessionId\)/);
  assert.doesNotMatch(sessionRow, /rowInFlight\.set\(sessionId,/);
});

test("PR 1296 startup snapshot preserves legacy entry timestamps and phase normalization", () => {
  assert.match(
    startSnapshot,
    /entry_started_at:\s+nullableString\(raw\.entry_started_at\) \?\? nullableString\(raw\.handshake_started_at\)/,
  );
  assert.match(
    startSnapshot,
    /entry_grace_expires_at:[\s\S]*nullableString\(raw\.entry_grace_expires_at\) \?\?[\s\S]*nullableString\(raw\.handshake_grace_expires_at\)/,
  );
  assert.match(startSnapshot, /function normalizeVideoDateStartSnapshotPhase/);
  assert.match(startSnapshot, /phase === "handshake" \? "entry" : phase/);
});

test("PR 1295 Sprint 7 ops health restores real counts without queue-drain counters", () => {
  assert.match(
    repairMigration,
    /CREATE OR REPLACE FUNCTION public\.get_video_date_sprint7_ops_health\(/,
  );
  assert.match(repairMigration, /FROM public\.video_sessions/);
  assert.match(repairMigration, /FROM public\.event_loop_observability_events eo/);
  assert.match(repairMigration, /FROM public\.user_reports ur/);
  assert.match(repairMigration, /FROM public\.blocked_users bu/);
  assert.match(repairMigration, /FROM public\.video_date_webhook_dlq dlq/);
  assert.match(repairMigration, /FROM public\.video_date_orphan_room_cleanup_audit oa/);
  assert.match(repairMigration, /'stuck_entry_count'/);
  assert.match(repairMigration, /'pending_survey_recovery_count'/);
  assert.match(repairMigration, /'webhook_dlq_count'/);
  assert.match(repairMigration, /'orphan_room_cleanup_failed_count'/);
  assert.doesNotMatch(repairMigration, /queue_drain_miss_count|queue_drain_failure_count/);
  assert.doesNotMatch(repairMigration, /silently_queued_count|queued_expires_at|drain_match_queue/);
});

test("PR 1297 validation scripts inspect private transition helpers after public flattening", () => {
  assert.match(prepareEntryValidation, /private_video_date\.vdt_prepare_lease/);
  assert.match(eventEndedValidation, /private_video_date\.vdt_event_inactive/);
  assert.match(endToEndValidation, /private_video_date\.vdt_pre_date_end_cleanup/);
  assert.match(endToEndValidation, /private_video_date\.vdt_core_legacy_01/);

  for (const source of [prepareEntryValidation, eventEndedValidation, endToEndValidation]) {
    assert.doesNotMatch(source, /pg_get_functiondef\('public\.video_date_transition_[0-9]/);
    assert.doesNotMatch(source, /'public\.vd_transition_[0-9]/);
  }
});

test("Sprint 7 operator docs no longer route operators to deleted queue-drain health", () => {
  assert.match(sprint7Docs, /Stuck Entry/);
  assert.match(sprint7Docs, /Entry And Date Backlog/);
  assert.doesNotMatch(sprint7Docs, /Queue Drain Misses|Queue Backlog/);
  assert.doesNotMatch(sprint7Docs, /silently_queued_count|queue_drain_miss_count|queue_drain_failure_count/);
  assert.match(operatorMetrics, /stuck entry\/date counts/);
  assert.match(operatorMetrics, /queue_drain_failure_rate.*REMOVED 2026-06-10/);
});

test("review-comments 1291-1298 follow-up is documented and suite-wired", () => {
  assert.match(branchDelta, /Review Comments 1291-1298 Follow-ups/);
  assert.match(branchDelta, /No Copilot-authored review threads were present/);
  assert.match(
    packageJson,
    /shared\/matching\/reviewComments1291_1298Followups\.test\.ts/,
  );
});
