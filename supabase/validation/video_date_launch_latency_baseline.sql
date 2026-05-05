-- Video Date launch latency baseline.
-- Read-only. Run in the Supabase SQL editor (or psql) before/after each
-- prewarm rollout slice to compare cohorts.
--
-- Source: event_loop_observability_events rows with
--   operation = 'video_date_launch_latency_checkpoint'
-- written by record_video_date_launch_latency_checkpoint().
--
-- The query reports p50/p95/count per duration, split by the dimensions that
-- the rollout cares about. All durations are taken from the per-checkpoint
-- detail JSON written by the RPC; we filter checkpoint = 'first_remote_frame'
-- so each session contributes at most one row to the headline metric.

WITH window_bounds AS (
  -- Tweak the window before running. 7d is a reasonable default.
  SELECT now() - interval '7 days' AS started_at,
         now()                     AS ended_at
),
launch_rows AS (
  SELECT
    e.session_id,
    e.actor_id,
    e.created_at,
    (e.detail->>'platform')                             AS platform,
    (e.detail->>'checkpoint')                           AS checkpoint,
    (e.detail->>'ready_actor_order')                    AS ready_actor_order,
    (e.detail->>'cached_prepare_entry')::boolean        AS cached_prepare_entry,
    (e.detail->>'provider_verify_skipped')::boolean     AS provider_verify_skipped,
    (e.detail->>'permission_handoff_used')::boolean     AS permission_handoff_used,
    NULLIF(e.detail->>'ready_tap_to_first_remote_frame_ms','')::int     AS ready_tap_to_first_remote_frame_ms,
    NULLIF(e.detail->>'both_ready_to_first_remote_frame_ms','')::int   AS both_ready_to_first_remote_frame_ms,
    NULLIF(e.detail->>'both_ready_to_daily_join_ms','')::int           AS both_ready_to_daily_join_ms,
    NULLIF(e.detail->>'date_route_to_daily_join_ms','')::int           AS date_route_to_daily_join_ms,
    NULLIF(e.detail->>'daily_join_ms','')::int                         AS daily_join_ms,
    NULLIF(e.detail->>'daily_join_to_first_remote_frame_ms','')::int   AS daily_join_to_first_remote_frame_ms,
    NULLIF(e.detail->>'remote_seen_to_first_remote_frame_ms','')::int  AS remote_seen_to_first_remote_frame_ms,
    NULLIF(e.detail->>'first_remote_frame_to_readable_ms','')::int     AS first_remote_frame_to_readable_ms,
    NULLIF(e.detail->>'room_warmup_ms','')::int                        AS room_warmup_ms,
    NULLIF(e.detail->>'prepare_entry_ms','')::int                      AS prepare_entry_ms,
    NULLIF(e.detail->>'provider_verify_ms','')::int                    AS provider_verify_ms,
    NULLIF(e.detail->>'permission_check_ms','')::int                   AS permission_check_ms,
    NULLIF(e.detail->>'daily_token_ms','')::int                        AS daily_token_ms,
    NULLIF(e.detail->>'ready_tap_to_both_ready_ms','')::int            AS ready_tap_to_both_ready_ms
  FROM public.event_loop_observability_events e, window_bounds w
  WHERE e.operation = 'video_date_launch_latency_checkpoint'
    AND e.created_at >= w.started_at
    AND e.created_at <  w.ended_at
),
headline AS (
  -- One row per (session, participant, attempt) so we report
  -- end-to-end latency per actual completion, not per checkpoint.
  SELECT *
  FROM launch_rows
  WHERE checkpoint = 'first_remote_frame'
    AND both_ready_to_first_remote_frame_ms IS NOT NULL
)

-- Headline: both_ready_observed -> first_remote_frame, sliced.
SELECT
  'headline_both_ready_to_first_remote_frame' AS metric,
  COALESCE(platform, 'unknown')               AS platform,
  COALESCE(ready_actor_order, 'unknown')      AS ready_actor_order,
  COALESCE(cached_prepare_entry::text, 'unknown')      AS cached_prepare_entry,
  COALESCE(provider_verify_skipped::text, 'unknown')   AS provider_verify_skipped,
  COALESCE(permission_handoff_used::text, 'unknown')   AS permission_handoff_used,
  COUNT(*)                                                                                AS sample_count,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY both_ready_to_first_remote_frame_ms)::int AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY both_ready_to_first_remote_frame_ms)::int AS p95_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY both_ready_to_first_remote_frame_ms)::int AS p99_ms,
  MIN(both_ready_to_first_remote_frame_ms)                                                AS min_ms,
  MAX(both_ready_to_first_remote_frame_ms)                                                AS max_ms
FROM headline
GROUP BY platform, ready_actor_order, cached_prepare_entry, provider_verify_skipped, permission_handoff_used

UNION ALL

-- Per-segment percentiles. We aggregate from launch_rows (any checkpoint that
-- carries the segment duration) so each segment is sampled wherever it's
-- emitted. NULLs are filtered by percentile_cont automatically.
SELECT metric, platform, 'all' AS ready_actor_order, 'all' AS cached_prepare_entry,
       'all' AS provider_verify_skipped, 'all' AS permission_handoff_used,
       sample_count, p50_ms, p95_ms, p99_ms, min_ms, max_ms
FROM (
  SELECT 'segment_ready_tap_to_both_ready' AS metric,
         COALESCE(platform, 'unknown') AS platform,
         COUNT(ready_tap_to_both_ready_ms)                                                          AS sample_count,
         percentile_cont(0.50) WITHIN GROUP (ORDER BY ready_tap_to_both_ready_ms)::int             AS p50_ms,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY ready_tap_to_both_ready_ms)::int             AS p95_ms,
         percentile_cont(0.99) WITHIN GROUP (ORDER BY ready_tap_to_both_ready_ms)::int             AS p99_ms,
         MIN(ready_tap_to_both_ready_ms) AS min_ms, MAX(ready_tap_to_both_ready_ms) AS max_ms
  FROM launch_rows GROUP BY platform
  UNION ALL
  SELECT 'segment_room_warmup',                         COALESCE(platform, 'unknown'),
         COUNT(room_warmup_ms),
         percentile_cont(0.50) WITHIN GROUP (ORDER BY room_warmup_ms)::int,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY room_warmup_ms)::int,
         percentile_cont(0.99) WITHIN GROUP (ORDER BY room_warmup_ms)::int,
         MIN(room_warmup_ms), MAX(room_warmup_ms)
  FROM launch_rows GROUP BY platform
  UNION ALL
  SELECT 'segment_prepare_entry',                       COALESCE(platform, 'unknown'),
         COUNT(prepare_entry_ms),
         percentile_cont(0.50) WITHIN GROUP (ORDER BY prepare_entry_ms)::int,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY prepare_entry_ms)::int,
         percentile_cont(0.99) WITHIN GROUP (ORDER BY prepare_entry_ms)::int,
         MIN(prepare_entry_ms), MAX(prepare_entry_ms)
  FROM launch_rows GROUP BY platform
  UNION ALL
  SELECT 'segment_provider_verify',                     COALESCE(platform, 'unknown'),
         COUNT(provider_verify_ms),
         percentile_cont(0.50) WITHIN GROUP (ORDER BY provider_verify_ms)::int,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY provider_verify_ms)::int,
         percentile_cont(0.99) WITHIN GROUP (ORDER BY provider_verify_ms)::int,
         MIN(provider_verify_ms), MAX(provider_verify_ms)
  FROM launch_rows GROUP BY platform
  UNION ALL
  SELECT 'segment_permission_check',                    COALESCE(platform, 'unknown'),
         COUNT(permission_check_ms),
         percentile_cont(0.50) WITHIN GROUP (ORDER BY permission_check_ms)::int,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY permission_check_ms)::int,
         percentile_cont(0.99) WITHIN GROUP (ORDER BY permission_check_ms)::int,
         MIN(permission_check_ms), MAX(permission_check_ms)
  FROM launch_rows GROUP BY platform
  UNION ALL
  SELECT 'segment_daily_token',                         COALESCE(platform, 'unknown'),
         COUNT(daily_token_ms),
         percentile_cont(0.50) WITHIN GROUP (ORDER BY daily_token_ms)::int,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY daily_token_ms)::int,
         percentile_cont(0.99) WITHIN GROUP (ORDER BY daily_token_ms)::int,
         MIN(daily_token_ms), MAX(daily_token_ms)
  FROM launch_rows GROUP BY platform
  UNION ALL
  SELECT 'segment_daily_join',                          COALESCE(platform, 'unknown'),
         COUNT(daily_join_ms),
         percentile_cont(0.50) WITHIN GROUP (ORDER BY daily_join_ms)::int,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY daily_join_ms)::int,
         percentile_cont(0.99) WITHIN GROUP (ORDER BY daily_join_ms)::int,
         MIN(daily_join_ms), MAX(daily_join_ms)
  FROM launch_rows GROUP BY platform
  UNION ALL
  SELECT 'segment_daily_join_to_first_remote_frame',    COALESCE(platform, 'unknown'),
         COUNT(daily_join_to_first_remote_frame_ms),
         percentile_cont(0.50) WITHIN GROUP (ORDER BY daily_join_to_first_remote_frame_ms)::int,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY daily_join_to_first_remote_frame_ms)::int,
         percentile_cont(0.99) WITHIN GROUP (ORDER BY daily_join_to_first_remote_frame_ms)::int,
         MIN(daily_join_to_first_remote_frame_ms), MAX(daily_join_to_first_remote_frame_ms)
  FROM launch_rows GROUP BY platform
  UNION ALL
  SELECT 'segment_remote_seen_to_first_remote_frame',   COALESCE(platform, 'unknown'),
         COUNT(remote_seen_to_first_remote_frame_ms),
         percentile_cont(0.50) WITHIN GROUP (ORDER BY remote_seen_to_first_remote_frame_ms)::int,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY remote_seen_to_first_remote_frame_ms)::int,
         percentile_cont(0.99) WITHIN GROUP (ORDER BY remote_seen_to_first_remote_frame_ms)::int,
         MIN(remote_seen_to_first_remote_frame_ms), MAX(remote_seen_to_first_remote_frame_ms)
  FROM launch_rows GROUP BY platform
) s
ORDER BY metric, platform;
