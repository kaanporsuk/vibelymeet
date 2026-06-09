import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const followupMigration = read(
  "supabase/migrations/20260610022531_review_comments_1262_1280_followups.sql",
);
const backendAudit = read("docs/supabase-live-backend-audit.md");
const matchCallsDelta = read("docs/branch-deltas/remove-match-calls.md");
const designAudit = read("scripts/audit-video-date-ultimate-design.mjs");
const packageJson = read("package.json");

function sqlFunctionBody(source: string, functionName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const end = source.indexOf("COMMENT ON FUNCTION", start);
  assert.ok(end > start, `missing function end after ${functionName}`);
  return source.slice(start, end);
}

test("match_queued fallback is promoted to Ready Gate instead of expiring reciprocal swipes", () => {
  const wrapper = sqlFunctionBody(
    followupMigration,
    "handle_swipe_20260601183000_deck_authority_base",
  );

  assert.match(wrapper, /v_outcome IS DISTINCT FROM 'match_queued'/);
  assert.match(wrapper, /ready_gate_status = 'ready'/);
  assert.match(wrapper, /queued_expires_at = NULL/);
  assert.match(wrapper, /queue_status = 'in_ready_gate'/);
  assert.match(wrapper, /'result', 'match'/);
  assert.match(wrapper, /'queue_removed_conversion', 'match_queued_promoted_to_ready_gate'/);
  assert.doesNotMatch(wrapper, /queued_auto_promotion_removed/);
  assert.doesNotMatch(wrapper, /ready_gate_status = 'expired'/);
});

test("stale Mystery Match suppression repair preserves unrelated active sessions", () => {
  assert.match(followupMigration, /JOIN public\.video_sessions vs\s+ON vs\.id = er\.current_room_id/);
  assert.match(followupMigration, /current_partner_id = candidate\.expected_partner_id/);
  assert.match(followupMigration, /queue_status = candidate\.expected_queue_status/);
  assert.match(followupMigration, /vs\.ended_at IS NULL/);
  assert.match(followupMigration, /vs\.ready_gate_status IN \('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'\)/);
});

test("current backend audit excludes removed RPCs from critical existence claims", () => {
  assert.doesNotMatch(backendAudit, /\| find_mystery_match \| Historical only/);
  assert.match(backendAudit, /\| drain_match_queue \| Historical only; removed 2026-06-10 \|/);
  assert.match(
    backendAudit,
    /Historical rows for removed surfaces such as `find_mystery_match` and `drain_match_queue` are intentionally excluded/,
  );
  assert.doesNotMatch(backendAudit, /\| drain_match_queue \| Yes \|/);
});

test("ultimate design audit follows EntryPhaseTimer rename and neutral timer aliases", () => {
  assert.match(designAudit, /webTimer: "src\/components\/video-date\/EntryPhaseTimer\.tsx"/);
  assert.match(designAudit, /nativeTimer: "apps\/mobile\/components\/video-date\/EntryPhaseTimer\.tsx"/);
  assert.doesNotMatch(designAudit, /HandshakeTimer\.tsx/);
  assert.match(designAudit, /includes\("webDate", "entryStartedAt"\)/);
  assert.match(designAudit, /includes\("nativeDate", "entryStartedAtIso"\)/);
});

test("Match Calls follow-up documents the post-drop provider-room cleanup limit", () => {
  assert.match(matchCallsDelta, /Review follow-up, 2026-06-10/);
  assert.match(matchCallsDelta, /forward migration cannot reconstruct the lost room-name inventory/);
  assert.match(matchCallsDelta, /golden Video Date room cleanup functions/);
});

test("latest review-comments follow-up is wired into Video Date suites", () => {
  assert.match(
    packageJson,
    /shared\/matching\/reviewComments1262_1280Followups\.test\.ts/,
  );
});
