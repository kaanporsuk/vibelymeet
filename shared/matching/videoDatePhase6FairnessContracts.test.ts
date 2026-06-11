import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const purgeMigration = readFileSync(
  join(root, "supabase/migrations/20260611104830_purge_video_date_queued_residue.sql"),
  "utf8",
);
const operatorMetrics = readFileSync(
  join(root, "shared/observability/videoDateOperatorMetrics.ts"),
  "utf8",
);
const adminVideoDateOps = readFileSync(
  join(root, "supabase/functions/admin-video-date-ops/index.ts"),
  "utf8",
);
const adminLiveEventMetrics = readFileSync(
  join(root, "src/components/admin/AdminLiveEventMetrics.tsx"),
  "utf8",
);
const packageJson = readFileSync(join(root, "package.json"), "utf8");

test("queued residue purge drops Video Date queue-fairness catalog surfaces", () => {
  assert.match(purgeMigration, /DROP FUNCTION IF EXISTS public\.get_video_date_queue_fairness_health\(uuid\)/);
  assert.match(purgeMigration, /DROP VIEW IF EXISTS public\.v_video_date_queue_fairness_event_health/);
  assert.match(purgeMigration, /DROP VIEW IF EXISTS public\.v_video_date_queue_fairness_candidates/);
  assert.match(purgeMigration, /DROP FUNCTION IF EXISTS public\.video_date_queue_participant_reliability_penalty\(uuid, uuid, timestamptz\)/);
  assert.match(purgeMigration, /DROP INDEX IF EXISTS public\.idx_video_sessions_phase6_queue_event/);
  assert.match(purgeMigration, /DROP INDEX IF EXISTS public\.idx_video_sessions_phase6_queue_p1/);
  assert.match(purgeMigration, /DROP INDEX IF EXISTS public\.idx_video_sessions_phase6_queue_p2/);
  assert.match(purgeMigration, /DROP INDEX IF EXISTS public\.idx_event_loop_obs_phase6_queue_drain_event_recent/);
  assert.match(purgeMigration, /DROP INDEX IF EXISTS public\.idx_event_loop_obs_phase6_queue_drain_actor_recent/);
});

test("queued residue purge physically removes video_sessions queued_expires_at and old helper signature", () => {
  assert.match(purgeMigration, /ALTER TABLE public\.video_sessions[\s\S]+DROP COLUMN IF EXISTS queued_expires_at/);
  assert.match(purgeMigration, /CREATE OR REPLACE FUNCTION public\.video_session_blocks_global_active_conflict\(/);
  assert.doesNotMatch(
    purgeMigration.match(/CREATE OR REPLACE FUNCTION public\.video_session_blocks_global_active_conflict[\s\S]+?\$function\$;/)?.[0] ?? "",
    /p_queued_expires_at|queued_expires_at/,
  );
  assert.match(
    purgeMigration,
    /DROP FUNCTION IF EXISTS public\.video_session_blocks_global_active_conflict\([\s\S]+timestamptz,[\s\S]+timestamptz,[\s\S]+timestamptz[\s\S]+\)/,
  );
  assert.match(purgeMigration, /queued_expires_at%'\s+OR def ILIKE '%v_video_date_queue_fairness%'/);
});

test("active operator source no longer reads or renders queue fairness", () => {
  for (const [name, source] of [
    ["operatorMetrics", operatorMetrics],
    ["adminVideoDateOps", adminVideoDateOps],
    ["adminLiveEventMetrics", adminLiveEventMetrics],
  ] as const) {
    assert.doesNotMatch(source, /queue_fairness|Queue fairness|v_video_date_queue_fairness|get_video_date_queue_fairness|QueueFairnessHealthRow/, name);
  }
});

test("Phase 6 purge contract stays in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDatePhase6FairnessContracts\.test\.ts/);
});
