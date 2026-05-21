SELECT
  'video_date_phase0_events_is_test_event_exists' AS check_name,
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'is_test_event'
      AND column_default = 'false'
  ) AS ok;

SELECT
  'video_date_phase0_views_exist' AS check_name,
  COUNT(*) = 5 AS ok
FROM information_schema.views
WHERE table_schema = 'public'
  AND table_name IN (
    'vw_session_health',
    'vw_session_funnel',
    'vw_synthetic_video_date_health',
    'vw_video_date_flag_rollout',
    'vw_outbox_health'
  );

SELECT
  'video_date_phase0_flags_seeded_off' AS check_name,
  COUNT(*) = 19
  AND bool_and(enabled = false)
  AND bool_and(rollout_bps = 0)
  AND bool_and(kill_switch_active = false) AS ok
FROM public.client_feature_flags
WHERE flag_key LIKE 'video_date.%';

SELECT
  'video_date_phase0_discovery_excludes_test_events' AS check_name,
  pg_get_functiondef('public.get_visible_events(uuid, double precision, double precision, boolean, double precision, double precision, double precision)'::regprocedure)
    LIKE '%COALESCE(e.is_test_event, false) = false%'
  AND pg_get_functiondef('public.get_other_city_events(uuid, double precision, double precision)'::regprocedure)
    LIKE '%COALESCE(e.is_test_event, false) = false%' AS ok;

SELECT
  'video_date_phase0_get_visible_events_preserves_current_shape' AS check_name,
  pg_get_function_result('public.get_visible_events(uuid, double precision, double precision, boolean, double precision, double precision, double precision)'::regprocedure)
    LIKE '%category_keys text[]%'
  AND pg_get_function_result('public.get_visible_events(uuid, double precision, double precision, boolean, double precision, double precision, double precision)'::regprocedure)
    LIKE '%categories jsonb%'
  AND pg_get_function_result('public.get_visible_events(uuid, double precision, double precision, boolean, double precision, double precision, double precision)'::regprocedure)
    LIKE '%vibes text[]%' AS ok;
