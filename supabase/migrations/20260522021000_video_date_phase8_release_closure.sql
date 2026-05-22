-- Vibely Video Date v4 Phase 8.4-8.6:
-- Operational proof wrappers, final deck cutover closure, and release gate.
--
-- This migration keeps Phase 8 operational truth in Postgres without storing
-- Daily tokens or provider secrets. Clients do not receive access to these
-- objects; they are service-role/DB-owner rollout controls only.

CREATE OR REPLACE FUNCTION public.record_video_date_phase8_rollout_step_v2(
  p_event_id uuid,
  p_rollout_bps integer,
  p_commit_sha text DEFAULT NULL,
  p_report jsonb DEFAULT '{}'::jsonb,
  p_notes text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_report jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_report, '{}'::jsonb)) = 'object' THEN COALESCE(p_report, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_current_rollout_bps integer := 0;
  v_core_flags_enabled boolean := false;
  v_core_flags_killed boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'service_role_required');
  END IF;

  IF p_rollout_bps NOT IN (100, 1000, 5000, 10000) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_rollout_step_bps');
  END IF;

  IF public.video_date_jsonb_has_secret_key(v_report) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sensitive_report_payload');
  END IF;

  WITH core_flags(flag_key) AS (
    VALUES
      ('video_date.snapshot_v2'),
      ('video_date.deck_deal_v2'),
      ('video_date.readiness_v2'),
      ('video_date.micro_verdict_v2'),
      ('video_date.broadcast_v2'),
      ('video_date.timeline_v2'),
      ('video_date.daily_webhooks_v2'),
      ('video_date.extension_mutual_v2'),
      ('video_date.safety_always_on_v2'),
      ('video_date.multi_device_v2'),
      ('video_date.outbox_v2.mark_ready'),
      ('video_date.outbox_v2.forfeit'),
      ('video_date.outbox_v2.continue_handshake'),
      ('video_date.outbox_v2.handshake_auto_promote'),
      ('video_date.outbox_v2.date_timeout'),
      ('video_date.outbox_v2.submit_verdict'),
      ('video_date.outbox_v2.extension'),
      ('video_date.outbox_v2.safety'),
      ('video_date.outbox_v2.drain_match_queue')
  )
  SELECT
    COALESCE(min(f.rollout_bps), 0)::integer,
    COALESCE(count(f.flag_key) = count(cf.flag_key) AND bool_and(COALESCE(f.enabled, false)), false),
    COALESCE(bool_or(COALESCE(f.kill_switch_active, false)), false)
  INTO v_current_rollout_bps, v_core_flags_enabled, v_core_flags_killed
  FROM core_flags cf
  LEFT JOIN public.client_feature_flags f ON f.flag_key = cf.flag_key;

  IF NOT v_core_flags_enabled THEN
    RETURN jsonb_build_object('ok', false, 'error', 'core_flags_not_enabled');
  END IF;

  IF v_core_flags_killed THEN
    RETURN jsonb_build_object('ok', false, 'error', 'core_flag_kill_switch_active');
  END IF;

  IF v_current_rollout_bps < p_rollout_bps THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'rollout_step_not_live',
      'current_rollout_bps', v_current_rollout_bps,
      'required_rollout_bps', p_rollout_bps
    );
  END IF;

  v_report := v_report || jsonb_build_object(
    'recorded_via', 'record_video_date_phase8_rollout_step_v2',
    'live_rollout_bps', v_current_rollout_bps
  );

  RETURN public.record_video_date_phase8_certification_run_v2(
    'rollout_step',
    'ops',
    'passed',
    p_event_id,
    p_rollout_bps,
    p_commit_sha,
    v_report,
    p_notes,
    p_expires_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_phase8_rollout_step_v2(uuid, integer, text, jsonb, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_date_phase8_rollout_step_v2(uuid, integer, text, jsonb, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.record_video_date_phase8_rollout_step_v2(uuid, integer, text, jsonb, text, timestamptz) IS
  'Service-role Phase 8 rollout-step recorder. Requires the requested rollout bps to be live across core Video Date flags and rejects token/secret-shaped reports.';

CREATE OR REPLACE FUNCTION public.record_video_date_phase8_legacy_cleanup_v2(
  p_commit_sha text DEFAULT NULL,
  p_report jsonb DEFAULT '{}'::jsonb,
  p_notes text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_report jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_report, '{}'::jsonb)) = 'object' THEN COALESCE(p_report, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_cleanup_ready boolean := false;
  v_cleanup_reason text := 'legacy_cleanup_readiness_missing';
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'service_role_required');
  END IF;

  IF public.video_date_jsonb_has_secret_key(v_report) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sensitive_report_payload');
  END IF;

  SELECT
    COALESCE(deck_deal_100pct_baked, false),
    cleanup_readiness_reason
  INTO v_cleanup_ready, v_cleanup_reason
  FROM public.vw_video_date_legacy_deck_cleanup_readiness
  WHERE flag_key = 'video_date.deck_deal_v2'
  LIMIT 1;

  IF NOT COALESCE(v_cleanup_ready, false) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'legacy_cleanup_not_ready',
      'reason', COALESCE(v_cleanup_reason, 'legacy_cleanup_readiness_missing')
    );
  END IF;

  v_report := v_report || jsonb_build_object(
    'recorded_via', 'record_video_date_phase8_legacy_cleanup_v2',
    'legacy_cleanup_reason', v_cleanup_reason
  );

  RETURN public.record_video_date_phase8_certification_run_v2(
    'legacy_cleanup',
    'ops',
    'passed',
    NULL,
    10000,
    p_commit_sha,
    v_report,
    p_notes,
    p_expires_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_phase8_legacy_cleanup_v2(text, jsonb, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_date_phase8_legacy_cleanup_v2(text, jsonb, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.record_video_date_phase8_legacy_cleanup_v2(text, jsonb, text, timestamptz) IS
  'Service-role Phase 8 legacy-cleanup recorder. Requires server-dealt deck to be active at 100% for one week and rejects token/secret-shaped reports.';

CREATE OR REPLACE VIEW public.vw_video_date_phase8_release_closure
WITH (security_invoker = true)
AS
WITH
core_flags(flag_key) AS (
  VALUES
    ('video_date.snapshot_v2'),
    ('video_date.deck_deal_v2'),
    ('video_date.readiness_v2'),
    ('video_date.micro_verdict_v2'),
    ('video_date.broadcast_v2'),
    ('video_date.timeline_v2'),
    ('video_date.daily_webhooks_v2'),
    ('video_date.extension_mutual_v2'),
    ('video_date.safety_always_on_v2'),
    ('video_date.multi_device_v2'),
    ('video_date.outbox_v2.mark_ready'),
    ('video_date.outbox_v2.forfeit'),
    ('video_date.outbox_v2.continue_handshake'),
    ('video_date.outbox_v2.handshake_auto_promote'),
    ('video_date.outbox_v2.date_timeout'),
    ('video_date.outbox_v2.submit_verdict'),
    ('video_date.outbox_v2.extension'),
    ('video_date.outbox_v2.safety'),
    ('video_date.outbox_v2.drain_match_queue')
),
flag_rollup AS (
  SELECT
    count(f.flag_key) = count(cf.flag_key) AS core_flags_present,
    COALESCE(bool_and(COALESCE(f.enabled, false)), false) AS core_flags_enabled,
    COALESCE(bool_or(COALESCE(f.kill_switch_active, false)), false) AS core_flags_killed,
    COALESCE(min(COALESCE(f.rollout_bps, 0)), 0)::integer AS current_rollout_bps,
    count(cf.flag_key)::integer AS required_flag_count,
    count(f.flag_key)::integer AS present_flag_count
  FROM core_flags cf
  LEFT JOIN public.client_feature_flags f ON f.flag_key = cf.flag_key
),
rollout_steps AS (
  SELECT
    EXISTS (
      SELECT 1 FROM public.vw_video_date_phase8_rollout_step_latest r
      WHERE r.event_id IS NULL
        AND r.platform = 'ops'
        AND r.status = 'passed'
        AND r.rollout_bps = 100
    ) AS rollout_1pct_passed,
    EXISTS (
      SELECT 1 FROM public.vw_video_date_phase8_rollout_step_latest r
      WHERE r.event_id IS NULL
        AND r.platform = 'ops'
        AND r.status = 'passed'
        AND r.rollout_bps = 1000
    ) AS rollout_10pct_passed,
    EXISTS (
      SELECT 1 FROM public.vw_video_date_phase8_rollout_step_latest r
      WHERE r.event_id IS NULL
        AND r.platform = 'ops'
        AND r.status = 'passed'
        AND r.rollout_bps = 5000
    ) AS rollout_50pct_passed,
    EXISTS (
      SELECT 1 FROM public.vw_video_date_phase8_rollout_step_latest r
      WHERE r.event_id IS NULL
        AND r.platform = 'ops'
        AND r.status = 'passed'
        AND r.rollout_bps = 10000
    ) AS rollout_100pct_passed
),
legacy_cleanup AS (
  SELECT EXISTS (
    SELECT 1
    FROM public.vw_video_date_phase8_certification_latest r
    WHERE r.event_id IS NULL
      AND r.run_kind = 'legacy_cleanup'
      AND r.platform = 'ops'
      AND r.status = 'passed'
  ) AS legacy_cleanup_passed
),
alerts AS (
  SELECT
    count(*) FILTER (WHERE severity = 'page')::integer AS recovery_page_alerts,
    count(*) FILTER (WHERE severity = 'watch')::integer AS recovery_watch_alerts
  FROM public.vw_video_date_recovery_alerts
),
stuck AS (
  SELECT count(*)::integer AS stuck_active_sessions_over_2m
  FROM public.video_sessions vs
  WHERE vs.ended_at IS NULL
    AND COALESCE(vs.state::text, '') <> 'ended'
    AND COALESCE(vs.phase, '') <> 'ended'
    AND COALESCE(vs.state_updated_at, vs.started_at, now()) <= now() - interval '2 minutes'
    AND (
      vs.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'queued')
      OR COALESCE(vs.phase, '') IN ('handshake', 'date')
      OR COALESCE(vs.state::text, '') IN ('ready', 'handshake', 'date', 'queued')
    )
),
deck AS (
  SELECT
    COALESCE(deck_deal_100pct_baked, false) AS deck_deal_100pct_baked,
    cleanup_readiness_reason
  FROM public.vw_video_date_legacy_deck_cleanup_readiness
  WHERE flag_key = 'video_date.deck_deal_v2'
  LIMIT 1
)
SELECT
  'global'::text AS release_track,
  fr.core_flags_present,
  fr.core_flags_enabled,
  fr.core_flags_killed,
  fr.current_rollout_bps,
  fr.required_flag_count,
  fr.present_flag_count,
  rs.rollout_1pct_passed,
  rs.rollout_10pct_passed,
  rs.rollout_50pct_passed,
  rs.rollout_100pct_passed,
  COALESCE(d.deck_deal_100pct_baked, false) AS deck_deal_100pct_baked,
  COALESCE(d.cleanup_readiness_reason, 'deck_cleanup_readiness_missing') AS legacy_deck_cleanup_reason,
  lc.legacy_cleanup_passed,
  COALESCE(a.recovery_page_alerts, 0) AS recovery_page_alerts,
  COALESCE(a.recovery_watch_alerts, 0) AS recovery_watch_alerts,
  COALESCE(s.stuck_active_sessions_over_2m, 0) AS stuck_active_sessions_over_2m,
  array_remove(ARRAY[
    CASE WHEN NOT fr.core_flags_present THEN 'core_flags_missing' END,
    CASE WHEN NOT fr.core_flags_enabled THEN 'core_flags_not_enabled' END,
    CASE WHEN fr.core_flags_killed THEN 'core_flag_kill_switch_active' END,
    CASE WHEN fr.current_rollout_bps < 10000 THEN 'current_rollout_bps_below_100pct' END,
    CASE WHEN NOT rs.rollout_1pct_passed THEN 'rollout_1pct_not_certified' END,
    CASE WHEN NOT rs.rollout_10pct_passed THEN 'rollout_10pct_not_certified' END,
    CASE WHEN NOT rs.rollout_50pct_passed THEN 'rollout_50pct_not_certified' END,
    CASE WHEN NOT rs.rollout_100pct_passed THEN 'rollout_100pct_not_certified' END,
    CASE WHEN NOT COALESCE(d.deck_deal_100pct_baked, false) THEN 'deck_deal_100pct_not_baked' END,
    CASE WHEN NOT lc.legacy_cleanup_passed THEN 'legacy_cleanup_not_certified' END,
    CASE WHEN COALESCE(a.recovery_page_alerts, 0) > 0 THEN 'recovery_page_alerts_active' END,
    CASE WHEN COALESCE(s.stuck_active_sessions_over_2m, 0) > 0 THEN 'stuck_active_sessions_over_2m' END
  ], NULL)::text[] AS release_blockers,
  now() AS generated_at
FROM flag_rollup fr
CROSS JOIN rollout_steps rs
CROSS JOIN legacy_cleanup lc
CROSS JOIN alerts a
CROSS JOIN stuck s
LEFT JOIN deck d ON true;

REVOKE ALL ON TABLE public.vw_video_date_phase8_release_closure FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vw_video_date_phase8_release_closure TO service_role;

COMMENT ON VIEW public.vw_video_date_phase8_release_closure IS
  'Service-role Phase 8 final closure gate. Blocks closure until all rollout slices are certified, core flags are at 100%, server-dealt deck cleanup is certified, and no page-level recovery/stuck-session blockers remain.';

CREATE OR REPLACE FUNCTION public.get_video_date_phase8_release_closure()
RETURNS TABLE (
  release_track text,
  can_close_phase8 boolean,
  release_blockers text[],
  core_flags_present boolean,
  core_flags_enabled boolean,
  core_flags_killed boolean,
  current_rollout_bps integer,
  rollout_1pct_passed boolean,
  rollout_10pct_passed boolean,
  rollout_50pct_passed boolean,
  rollout_100pct_passed boolean,
  deck_deal_100pct_baked boolean,
  legacy_deck_cleanup_reason text,
  legacy_cleanup_passed boolean,
  recovery_page_alerts integer,
  recovery_watch_alerts integer,
  stuck_active_sessions_over_2m integer,
  generated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    c.release_track,
    COALESCE(array_length(c.release_blockers, 1), 0) = 0 AS can_close_phase8,
    c.release_blockers,
    c.core_flags_present,
    c.core_flags_enabled,
    c.core_flags_killed,
    c.current_rollout_bps,
    c.rollout_1pct_passed,
    c.rollout_10pct_passed,
    c.rollout_50pct_passed,
    c.rollout_100pct_passed,
    c.deck_deal_100pct_baked,
    c.legacy_deck_cleanup_reason,
    c.legacy_cleanup_passed,
    c.recovery_page_alerts,
    c.recovery_watch_alerts,
    c.stuck_active_sessions_over_2m,
    c.generated_at
  FROM public.vw_video_date_phase8_release_closure c;
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_phase8_release_closure()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_video_date_phase8_release_closure()
  TO service_role;

COMMENT ON FUNCTION public.get_video_date_phase8_release_closure() IS
  'Service-role Phase 8 release closure reader. Returns can_close_phase8 plus exact blockers for final rollout and legacy cleanup closure.';
