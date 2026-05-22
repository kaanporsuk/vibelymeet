-- Video Date v4 Phase 8 certification and rollout validation.
-- Read-only. Run with service role or a database-owner SQL session before each rollout step.

SELECT
  'phase8_certification_ledger_exists' AS check_name,
  to_regclass('public.video_date_phase8_certification_runs') IS NOT NULL AS ok;

SELECT
  'phase8_rollout_views_exist' AS check_name,
  COUNT(*) = 5 AS ok
FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name IN (
    'vw_video_date_phase8_certification_latest',
    'vw_video_date_phase8_rollout_step_latest',
    'vw_video_date_legacy_deck_cleanup_readiness',
    'vw_video_date_phase8_rollout_readiness',
    'vw_video_date_phase8_release_closure'
  );

SELECT
  'phase8_rollout_rpc_exists' AS check_name,
  to_regprocedure('public.get_video_date_phase8_rollout_readiness(uuid)') IS NOT NULL
  AND to_regprocedure('public.record_video_date_phase8_rollout_step_v2(uuid, integer, text, jsonb, text, timestamp with time zone)') IS NOT NULL
  AND to_regprocedure('public.record_video_date_phase8_legacy_cleanup_v2(text, jsonb, text, timestamp with time zone)') IS NOT NULL
  AND to_regprocedure('public.get_video_date_phase8_release_closure()') IS NOT NULL AS ok;

SELECT
  'phase8_no_next_rollout_blockers' AS check_name,
  COALESCE(bool_and(can_advance_rollout), false) AS ok,
  jsonb_agg(
    jsonb_build_object(
      'event_id', event_id,
      'window_id', window_id,
      'current_rollout_bps', current_rollout_bps,
      'target_rollout_bps', target_rollout_bps,
      'blockers', rollout_blockers
    )
    ORDER BY event_id, window_id, target_rollout_bps
  ) FILTER (WHERE NOT can_advance_rollout) AS blockers
FROM public.vw_video_date_phase8_rollout_readiness
WHERE target_rollout_bps = CASE
  WHEN current_rollout_bps < 100 THEN 100
  WHEN current_rollout_bps < 1000 THEN 1000
  WHEN current_rollout_bps < 5000 THEN 5000
  WHEN current_rollout_bps < 10000 THEN 10000
  ELSE 10000
END;

SELECT
  'phase8_legacy_deck_cleanup_ready' AS check_name,
  COALESCE(bool_and(deck_deal_100pct_baked), false) AS ok,
  jsonb_agg(
    jsonb_build_object(
      'flag_key', flag_key,
      'enabled', enabled,
      'rollout_bps', rollout_bps,
      'kill_switch_active', kill_switch_active,
      'current_state_since', current_state_since,
      'reason', cleanup_readiness_reason
    )
  ) AS detail
FROM public.vw_video_date_legacy_deck_cleanup_readiness;

SELECT
  'phase8_runtime_rls_passed_recently' AS check_name,
  EXISTS (
    SELECT 1
    FROM public.vw_video_date_phase8_certification_latest
    WHERE run_kind = 'rls_negative'
      AND status = 'passed'
      AND (expires_at IS NULL OR expires_at > now())
  ) AS ok;

SELECT
  'phase8_two_user_web_and_native_passed_recently' AS check_name,
  EXISTS (
    SELECT 1
    FROM public.vw_video_date_phase8_certification_latest
    WHERE run_kind = 'two_user_e2e'
      AND platform IN ('web', 'cross_platform')
      AND status = 'passed'
      AND (expires_at IS NULL OR expires_at > now())
  )
  AND (
    EXISTS (
      SELECT 1
      FROM public.vw_video_date_phase8_certification_latest
      WHERE run_kind = 'two_user_e2e'
        AND platform IN ('native', 'mobile', 'cross_platform')
        AND status = 'passed'
        AND (expires_at IS NULL OR expires_at > now())
    )
    OR EXISTS (
      SELECT 1
      FROM public.vw_video_date_phase8_certification_latest
      WHERE run_kind = 'native_smoke'
        AND platform IN ('native', 'mobile', 'cross_platform')
        AND status = 'passed'
        AND (expires_at IS NULL OR expires_at > now())
    )
  ) AS ok;

SELECT
  'phase8_release_closure_has_no_blockers' AS check_name,
  COALESCE(bool_and(COALESCE(array_length(release_blockers, 1), 0) = 0), false) AS ok,
  jsonb_agg(
    jsonb_build_object(
      'release_track', release_track,
      'current_rollout_bps', current_rollout_bps,
      'blockers', release_blockers
    )
  ) FILTER (WHERE COALESCE(array_length(release_blockers, 1), 0) > 0) AS blockers
FROM public.vw_video_date_phase8_release_closure;
