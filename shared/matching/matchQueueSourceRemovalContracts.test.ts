import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260610120000_remove_match_queue_source_always_ready.sql",
);
const purgeMigration = read(
  "supabase/migrations/20260611104830_purge_video_date_queued_residue.sql",
);
const adminOps = read("supabase/functions/_shared/admin-video-date-ops.ts");
const packageJson = read("package.json");

function sqlFunctionBody(source: string, functionName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing function ${functionName}`);
  const end = source.indexOf("COMMENT ON FUNCTION", start);
  assert.ok(end > start, `missing function end after ${functionName}`);
  return source.slice(start, end);
}

test("swipe source always opens a ready Ready Gate session and never creates a queued row", () => {
  const base = sqlFunctionBody(
    migration,
    "handle_swipe_20260506090000_stale_room_base",
  );

  // Mutual match inserts a ready session with the standard 30s window, never a queued status.
  assert.match(base, /ready_gate_status,\s+ready_gate_expires_at,\s+queued_expires_at\s+\)\s+VALUES \(/);
  assert.match(base, /'ready',\s+v_now \+ interval '30 seconds',\s+NULL/);
  assert.match(base, /'result', 'match'/);
  assert.match(base, /'immediate', true/);

  // The queued branch and match_queued outcome are gone from the executable body.
  assert.doesNotMatch(base, /v_create_queued/);
  assert.doesNotMatch(base, /v_has_queued_session/);
  assert.doesNotMatch(base, /v_actor_present/);
  assert.doesNotMatch(base, /v_target_present/);
  assert.doesNotMatch(base, /'result', 'match_queued'/);
  assert.doesNotMatch(base, /ready_gate_status', 'queued'/);
  assert.doesNotMatch(base, /interval '10 minutes'/);
});

test("physical queued residue purge removes the inert queued_expires_at column after source removal", () => {
  assert.match(purgeMigration, /ALTER TABLE public\.video_sessions[\s\S]+DROP COLUMN IF EXISTS queued_expires_at/);
  assert.match(purgeMigration, /handle_swipe_20260506090000_stale_room_base still contains queued_expires_at/);
  assert.match(purgeMigration, /DROP VIEW IF EXISTS public\.v_video_date_queue_fairness_candidates/);
  assert.match(purgeMigration, /DROP FUNCTION IF EXISTS public\.get_video_date_queue_fairness_health\(uuid\)/);
});

test("deck-authority wrapper is a pass-through after queued-session removal", () => {
  const wrapper = sqlFunctionBody(
    migration,
    "handle_swipe_20260601183000_deck_authority_base",
  );

  assert.match(wrapper, /RETURN public\.handle_swipe_20260610000100_auto_next_base\(/);
  // No leftover queued->ready promotion machinery in the wrapper.
  assert.doesNotMatch(wrapper, /match_queued/);
  assert.doesNotMatch(wrapper, /queue_removed_conversion/);
  assert.doesNotMatch(wrapper, /ready_gate_status = 'ready'/);
});

test("dead queue-drain admin metrics are removed", () => {
  assert.doesNotMatch(adminOps, /summarizeQueueDrain/);
  assert.doesNotMatch(adminOps, /QueueDrainSummary/);
  assert.doesNotMatch(adminOps, /EXPECTED_QUEUE_DRAIN_NO_OP_REASON_CODES/);
  // Unrelated operator metrics stay intact.
  assert.match(adminOps, /summarizeSwipeRecovery/);
});

test("match-queue source removal contract is wired into Video Date suites", () => {
  assert.match(
    packageJson,
    /shared\/matching\/matchQueueSourceRemovalContracts\.test\.ts/,
  );
});
