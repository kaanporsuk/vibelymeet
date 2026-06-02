import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260522011000_video_date_phase6_queue_fairness.sql"),
  "utf8",
);
const permissionHardeningMigration = readFileSync(
  join(root, "supabase/migrations/20260602020000_permission_flow_definitive_hardening.sql"),
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

function functionBody(name: string): string {
  const match = migration.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]+?COMMENT ON FUNCTION public\\.${name}`),
  );
  assert.ok(match, `missing ${name} function block`);
  return match[0];
}

test("PR 6.1 exposes service-role queue fairness health without token-bearing payloads", () => {
  assert.match(migration, /CREATE OR REPLACE VIEW public\.v_video_date_queue_fairness_candidates/);
  assert.match(migration, /CREATE OR REPLACE VIEW public\.v_video_date_queue_fairness_event_health/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_video_date_queue_fairness_health/);
  assert.match(migration, /starved_slots_120s/);
  assert.match(migration, /starved_slots_300s/);
  assert.match(migration, /no_match_attempts_15m/);
  assert.match(migration, /runtime_blocked_attempts_15m/);
  assert.match(migration, /actor_platform_slots/);
  assert.match(migration, /actor_gender_slots/);
  assert.match(migration, /reliability_penalized_slots/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.v_video_date_queue_fairness_candidates FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.v_video_date_queue_fairness_event_health FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.v_video_date_queue_fairness_candidates TO service_role/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.v_video_date_queue_fairness_event_health TO service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_video_date_queue_fairness_health\(uuid\)\s+TO service_role/);
  assert.doesNotMatch(migration, /meeting[_-]?token|daily_token|DAILY_API_KEY|createMeetingToken/i);
});

test("queue fairness read paths have narrow additive indexes for live-event load", () => {
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_video_sessions_phase6_queue_event/);
  assert.match(migration, /ON public\.video_sessions\(event_id, started_at, queued_expires_at, id\)/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_video_sessions_phase6_queue_p1/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_video_sessions_phase6_queue_p2/);
  assert.match(migration, /WHERE ended_at IS NULL\s+AND ready_gate_status = 'queued'/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_video_sessions_phase6_recent_terminal_p1/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_video_sessions_phase6_recent_terminal_p2/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_event_loop_obs_phase6_queue_drain_event_recent/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_event_loop_obs_phase6_queue_drain_actor_recent/);
  assert.match(migration, /WHERE operation IN \('drain_match_queue', 'drain_match_queue_v2'\)/);
});

test("queue fairness candidate picker is explicit about hot-path privileges", () => {
  const candidateView = migration.match(
    /CREATE OR REPLACE VIEW public\.v_video_date_queue_fairness_candidates[\s\S]+?COMMENT ON VIEW public\.v_video_date_queue_fairness_candidates/,
  )?.[0];

  assert.ok(candidateView, "missing candidate fairness view block");
  assert.doesNotMatch(
    candidateView,
    /WITH \(security_invoker = true\)/,
    "the hot queue-drain candidate view must be definer-owned so participant grants cannot break drain_match_queue_v2",
  );
  assert.match(
    migration,
    /COMMENT ON VIEW public\.v_video_date_queue_fairness_candidates IS\s+'[^']*definer-owned[^']*drain_match_queue_v2[^']*service-role only[^']*'/,
  );
  assert.match(migration, /REVOKE ALL ON TABLE public\.v_video_date_queue_fairness_candidates FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.v_video_date_queue_fairness_candidates TO service_role/);
});

test("PR 6.2 drain_match_queue_v2 uses anti-starvation scoring before transactional rechecks", () => {
  const drain = functionBody("drain_match_queue_v2");

  assert.match(drain, /pg_try_advisory_xact_lock\(\s+hashtextextended\('video_session_command:' \|\| v_actor::text \|\| ':' \|\| v_key/);
  assert.match(drain, /pg_try_advisory_xact_lock\(\s+hashtextextended\(\s+'event_lobby_participant_session:' \|\| p_event_id::text/);
  assert.match(drain, /'lock_busy'/);
  assert.match(drain, /'lock_scope', 'command'/);
  assert.match(drain, /'lock_scope', 'participant_session_low'/);
  assert.match(drain, /'lock_scope', 'participant_session_high'/);
  assert.doesNotMatch(drain, /pg_advisory_xact_lock\(\s+hashtextextended\('video_session_command:' \|\| v_actor::text \|\| ':' \|\| v_key/);
  assert.match(drain, /JOIN public\.v_video_date_queue_fairness_candidates fair/);
  assert.match(drain, /'queue_scoring_version', 'phase6_v1'/);
  assert.match(drain, /ORDER BY[\s\S]*fair\.candidate_score DESC[\s\S]*fair\.both_hot_ready DESC[\s\S]*fair\.queued_age_seconds DESC[\s\S]*fair\.ttl_remaining_seconds ASC/s);
  assert.match(drain, /FOR UPDATE OF vs SKIP LOCKED/);
  assert.match(drain, /video_session_command_begin_v2/);
  assert.match(drain, /public\.video_date_pair_has_terminal_encounter/);
  assert.match(drain, /last_heartbeat_at >= now\(\) - interval '45 seconds'/);
  assert.match(drain, /readiness_status IN \('ready', 'warning'\)/);
  assert.match(drain, /public\.is_blocked\(v_actor, v_partner_id\)/);
  assert.match(drain, /public\.user_reports ur/);
  assert.match(drain, /public\.event_lobby_video_session_blocks_new_match/);
  assert.match(drain, /'fairness', v_fairness/);
  assert.match(drain, /ready_gate_status = 'ready'/);
  assert.match(drain, /'queue_promoted_to_ready_gate'[\s\S]+'participants'/);
  assert.doesNotMatch(drain, /meeting[_-]?token|daily_token|DAILY_API_KEY|createMeetingToken/i);
});

test("queue fairness scoring balances wait age, readiness, no-match history, and capped penalties", () => {
  assert.match(migration, /LEAST\(c\.queued_age_seconds, 3600\)/);
  assert.match(migration, /LEAST\(c\.actor_recent_no_match_attempts \* 18, 180\)/);
  assert.match(migration, /CASE WHEN c\.actor_hot_ready AND c\.partner_hot_ready THEN 600 ELSE 0 END/);
  assert.match(migration, /CASE WHEN c\.ttl_remaining_seconds <= 90 THEN 90 ELSE 0 END/);
  assert.match(migration, /- c\.actor_recent_reliability_penalty/);
  assert.match(migration, /- c\.partner_recent_reliability_penalty/);
  assert.match(migration, /LEAST\(\s*120[\s\S]*ready_gate_forfeit[\s\S]*reconnect_grace_expired/s);
});

test("queue fairness picker keeps heartbeat freshness authoritative at drain time", () => {
  const candidateView = migration.match(
    /CREATE OR REPLACE VIEW public\.v_video_date_queue_fairness_candidates[\s\S]+?COMMENT ON VIEW public\.v_video_date_queue_fairness_candidates/,
  )?.[0];
  const drain = functionBody("drain_match_queue_v2");

  assert.ok(candidateView, "missing fairness candidate view block");
  assert.match(candidateView, /actor_runtime\.last_heartbeat_at >= now\(\) - interval '45 seconds'/);
  assert.match(candidateView, /partner_runtime\.last_heartbeat_at >= now\(\) - interval '45 seconds'/);
  assert.match(candidateView, /actor_hot_ready/);
  assert.match(candidateView, /partner_hot_ready/);
  assert.match(drain, /v_self_runtime\.last_heartbeat_at >= now\(\) - interval '45 seconds'/);
  assert.match(drain, /v_partner_runtime\.last_heartbeat_at >= now\(\) - interval '45 seconds'/);
  assert.match(drain, /'heartbeat_age_seconds', EXTRACT\(EPOCH FROM \(now\(\) - v_self_runtime\.last_heartbeat_at\)\)::int/);
  assert.match(drain, /'heartbeat_age_seconds', EXTRACT\(EPOCH FROM \(now\(\) - v_partner_runtime\.last_heartbeat_at\)\)::int/);
  assert.match(permissionHardeningMigration, /normalize_event_runtime_readiness_for_pairing/);
  assert.match(permissionHardeningMigration, /NEW\.readiness_status = 'warning'/);
  assert.match(permissionHardeningMigration, /NEW\.readiness_status := 'unchecked'/);
  assert.match(permissionHardeningMigration, /WHERE readiness_status = 'warning'/);
  assert.ok(
    drain.indexOf("FOR UPDATE OF vs SKIP LOCKED") < drain.indexOf("v_self_runtime.last_heartbeat_at"),
    "heartbeat freshness must be rechecked after the queue row is locked",
  );
});

test("operator surfaces include the new queue fairness metric", () => {
  assert.match(operatorMetrics, /"queue_fairness_starvation_rate"/);
  assert.match(operatorMetrics, /v_video_date_queue_fairness_candidates/);
  assert.match(operatorMetrics, /v_video_date_queue_fairness_event_health/);
  assert.match(adminVideoDateOps, /type QueueFairnessHealthRow/);
  assert.match(adminVideoDateOps, /from\("v_video_date_queue_fairness_event_health"\)/);
  assert.match(adminVideoDateOps, /queue_fairness: queueFairness/);
  assert.match(adminLiveEventMetrics, /queue_fairness:/);
  assert.match(adminLiveEventMetrics, /label="Queue fairness"/);
});

test("Phase 6 fairness contracts are included in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDatePhase6FairnessContracts\.test\.ts/);
});
