-- Phase 3: operator read model over event_loop_observability_events (read-only).
-- Raw table remains source of truth; no write-path changes.
-- Query with service_role (or postgres in SQL editor). Same RLS posture as base table.

-- ---------------------------------------------------------------------------
-- Row-level filter views (operators add WHERE created_at > ... as needed)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_event_loop_promotion_events
WITH (security_invoker = true) AS
SELECT
  id,
  created_at,
  outcome,
  reason_code,
  latency_ms,
  event_id,
  actor_id,
  session_id,
  detail,
  detail->>'step' AS detail_step
FROM public.event_loop_observability_events
WHERE operation = 'promote_ready_gate_if_eligible';

COMMENT ON VIEW public.v_event_loop_promotion_events IS
  'Row-level promotion (promote_ready_gate_if_eligible) observability. Filter by time/event_id in queries.';

CREATE OR REPLACE VIEW public.v_event_loop_drain_events
WITH (security_invoker = true) AS
SELECT
  id,
  created_at,
  outcome,
  reason_code,
  latency_ms,
  event_id,
  actor_id,
  session_id,
  detail,
  (detail->>'found')::boolean AS detail_found,
  (detail->>'queued')::boolean AS detail_queued
FROM public.event_loop_observability_events
WHERE operation = 'drain_match_queue';

COMMENT ON VIEW public.v_event_loop_drain_events IS
  'Row-level drain_match_queue observability. Useful work: found=true or queued=true with presence reasons.';

CREATE OR REPLACE VIEW public.v_event_loop_expire_events
WITH (security_invoker = true) AS
SELECT
  id,
  created_at,
  outcome,
  reason_code,
  latency_ms,
  detail,
  COALESCE((detail->>'total_mutations')::int, 0) AS total_mutations,
  COALESCE((detail->>'snooze_wake')::int, 0) AS snooze_wake,
  COALESCE((detail->>'queued_ttl_expired')::int, 0) AS queued_ttl_expired,
  COALESCE((detail->>'ready_gate_expired')::int, 0) AS ready_gate_expired,
  COALESCE((detail->>'hygiene_orphans')::int, 0) AS hygiene_orphans
FROM public.event_loop_observability_events
WHERE operation = 'expire_stale_video_sessions';

COMMENT ON VIEW public.v_event_loop_expire_events IS
  'Expire/hygiene invocations with detail.* counters exposed as columns.';

CREATE OR REPLACE VIEW public.v_event_loop_swipe_mutual_events
WITH (security_invoker = true) AS
SELECT
  id,
  created_at,
  outcome,
  reason_code,
  latency_ms,
  event_id,
  actor_id,
  session_id,
  detail,
  detail->>'swipe_type' AS swipe_type,
  (detail->>'mutual')::boolean AS mutual,
  (detail->>'immediate')::boolean AS immediate
FROM public.event_loop_observability_events
WHERE operation = 'handle_swipe';

COMMENT ON VIEW public.v_event_loop_swipe_mutual_events IS
  'Mutual / promotion-relevant handle_swipe rows only (operation filter).';

CREATE OR REPLACE VIEW public.v_event_loop_mark_lobby_events
WITH (security_invoker = true) AS
SELECT
  id,
  created_at,
  outcome,
  reason_code,
  latency_ms,
  event_id,
  actor_id,
  session_id,
  detail,
  detail->'promotion' AS promotion,
  detail->'promotion'->>'promoted' AS promotion_promoted,
  detail->'promotion'->>'reason' AS promotion_reason
FROM public.event_loop_observability_events
WHERE operation = 'mark_lobby_foreground';

COMMENT ON VIEW public.v_event_loop_mark_lobby_events IS
  'mark_lobby_foreground rows. Interpret promotion via detail.promotion, not outcome alone.';

-- ---------------------------------------------------------------------------
-- Hourly rollups (UTC bucket)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_event_loop_promotion_outcomes_hourly
WITH (security_invoker = true) AS
SELECT
  date_trunc('hour', created_at) AS bucket_utc,
  outcome,
  reason_code,
  COUNT(*)::bigint AS n,
  AVG(latency_ms)::numeric(14, 2) AS avg_latency_ms,
  percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50_latency_ms,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms
FROM public.event_loop_observability_events
WHERE operation = 'promote_ready_gate_if_eligible'
GROUP BY 1, 2, 3;

COMMENT ON VIEW public.v_event_loop_promotion_outcomes_hourly IS
  'Promotion success vs block vs conflict vs no-op rates and latency by hour (UTC).';

CREATE OR REPLACE VIEW public.v_event_loop_drain_outcomes_hourly
WITH (security_invoker = true) AS
SELECT
  date_trunc('hour', created_at) AS bucket_utc,
  outcome,
  reason_code,
  COUNT(*)::bigint AS n,
  COUNT(*) FILTER (WHERE COALESCE((detail->>'found')::boolean, false))::bigint AS n_found_true,
  COUNT(*) FILTER (WHERE COALESCE((detail->>'queued')::boolean, false))::bigint AS n_queued_wait,
  AVG(latency_ms)::numeric(14, 2) AS avg_latency_ms,
  percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50_latency_ms,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms
FROM public.event_loop_observability_events
WHERE operation = 'drain_match_queue'
GROUP BY 1, 2, 3;

COMMENT ON VIEW public.v_event_loop_drain_outcomes_hourly IS
  'Drain outcomes per hour; n_found_true = useful match handoff; n_queued_wait = still queued with presence reasons.';

CREATE OR REPLACE VIEW public.v_event_loop_expire_activity_hourly
WITH (security_invoker = true) AS
SELECT
  date_trunc('hour', created_at) AS bucket_utc,
  outcome,
  COUNT(*)::bigint AS invoke_count,
  SUM(COALESCE((detail->>'total_mutations')::bigint, 0)) AS sum_total_mutations,
  SUM(COALESCE((detail->>'snooze_wake')::bigint, 0)) AS sum_snooze_wake,
  SUM(COALESCE((detail->>'queued_ttl_expired')::bigint, 0)) AS sum_queued_ttl_expired,
  SUM(COALESCE((detail->>'ready_gate_expired')::bigint, 0)) AS sum_ready_gate_expired,
  SUM(COALESCE((detail->>'hygiene_orphans')::bigint, 0)) AS sum_hygiene_orphans,
  AVG(latency_ms)::numeric(14, 2) AS avg_latency_ms
FROM public.event_loop_observability_events
WHERE operation = 'expire_stale_video_sessions'
GROUP BY 1, 2;

COMMENT ON VIEW public.v_event_loop_expire_activity_hourly IS
  'Cleanup/expiry path volume aggregated per hour; sums mirror detail json counters.';

CREATE OR REPLACE VIEW public.v_event_loop_guard_outcomes_hourly
WITH (security_invoker = true) AS
SELECT
  date_trunc('hour', created_at) AS bucket_utc,
  operation,
  outcome,
  reason_code,
  COUNT(*)::bigint AS n
FROM public.event_loop_observability_events
WHERE outcome IN ('conflict', 'blocked', 'error')
  AND operation IN (
    'promote_ready_gate_if_eligible',
    'drain_match_queue',
    'handle_swipe'
  )
GROUP BY 1, 2, 3, 4;

COMMENT ON VIEW public.v_event_loop_guard_outcomes_hourly IS
  'Conflict / block / error rows by operation and reason_code (why promotions or drains fail, session conflicts).';

CREATE OR REPLACE VIEW public.v_event_loop_latency_by_operation_outcome_hourly
WITH (security_invoker = true) AS
SELECT
  date_trunc('hour', created_at) AS bucket_utc,
  operation,
  outcome,
  COUNT(*)::bigint AS n,
  AVG(latency_ms)::numeric(14, 2) AS avg_latency_ms,
  percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50_latency_ms,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms
FROM public.event_loop_observability_events
WHERE latency_ms IS NOT NULL
GROUP BY 1, 2, 3;

COMMENT ON VIEW public.v_event_loop_latency_by_operation_outcome_hourly IS
  'Latency distribution by operation and outcome per UTC hour.';

-- ---------------------------------------------------------------------------
-- Permissions (match base table: operators via service_role)
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE public.v_event_loop_promotion_events FROM PUBLIC;
REVOKE ALL ON TABLE public.v_event_loop_drain_events FROM PUBLIC;
REVOKE ALL ON TABLE public.v_event_loop_expire_events FROM PUBLIC;
REVOKE ALL ON TABLE public.v_event_loop_swipe_mutual_events FROM PUBLIC;
REVOKE ALL ON TABLE public.v_event_loop_mark_lobby_events FROM PUBLIC;
REVOKE ALL ON TABLE public.v_event_loop_promotion_outcomes_hourly FROM PUBLIC;
REVOKE ALL ON TABLE public.v_event_loop_drain_outcomes_hourly FROM PUBLIC;
REVOKE ALL ON TABLE public.v_event_loop_expire_activity_hourly FROM PUBLIC;
REVOKE ALL ON TABLE public.v_event_loop_guard_outcomes_hourly FROM PUBLIC;
REVOKE ALL ON TABLE public.v_event_loop_latency_by_operation_outcome_hourly FROM PUBLIC;

REVOKE ALL ON TABLE public.v_event_loop_promotion_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.v_event_loop_drain_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.v_event_loop_expire_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.v_event_loop_swipe_mutual_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.v_event_loop_mark_lobby_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.v_event_loop_promotion_outcomes_hourly FROM anon, authenticated;
REVOKE ALL ON TABLE public.v_event_loop_drain_outcomes_hourly FROM anon, authenticated;
REVOKE ALL ON TABLE public.v_event_loop_expire_activity_hourly FROM anon, authenticated;
REVOKE ALL ON TABLE public.v_event_loop_guard_outcomes_hourly FROM anon, authenticated;
REVOKE ALL ON TABLE public.v_event_loop_latency_by_operation_outcome_hourly FROM anon, authenticated;

GRANT SELECT ON TABLE public.v_event_loop_promotion_events TO service_role;
GRANT SELECT ON TABLE public.v_event_loop_drain_events TO service_role;
GRANT SELECT ON TABLE public.v_event_loop_expire_events TO service_role;
GRANT SELECT ON TABLE public.v_event_loop_swipe_mutual_events TO service_role;
GRANT SELECT ON TABLE public.v_event_loop_mark_lobby_events TO service_role;
GRANT SELECT ON TABLE public.v_event_loop_promotion_outcomes_hourly TO service_role;
GRANT SELECT ON TABLE public.v_event_loop_drain_outcomes_hourly TO service_role;
GRANT SELECT ON TABLE public.v_event_loop_expire_activity_hourly TO service_role;
GRANT SELECT ON TABLE public.v_event_loop_guard_outcomes_hourly TO service_role;
GRANT SELECT ON TABLE public.v_event_loop_latency_by_operation_outcome_hourly TO service_role;
