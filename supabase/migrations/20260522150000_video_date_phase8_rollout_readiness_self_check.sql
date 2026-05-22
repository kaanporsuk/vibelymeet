-- Vibely Video Date v4.2 End-State Audit Closure:
-- Make rollout-step proof fail-safe by enforcing Phase 8 readiness in the
-- service-role RPC itself. The CLI also preflights this, but direct SQL calls
-- must be protected too.

CREATE OR REPLACE FUNCTION public.record_video_date_phase8_certification_run_v2(
  p_run_kind text,
  p_platform text,
  p_status text,
  p_event_id uuid DEFAULT NULL,
  p_rollout_bps integer DEFAULT NULL,
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
  v_run_kind text := lower(btrim(COALESCE(p_run_kind, '')));
  v_platform text := lower(btrim(COALESCE(p_platform, '')));
  v_status text := lower(btrim(COALESCE(p_status, '')));
  v_report jsonb := CASE
    WHEN jsonb_typeof(COALESCE(p_report, '{}'::jsonb)) = 'object' THEN COALESCE(p_report, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;
  v_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'service_role_required');
  END IF;

  IF v_run_kind NOT IN (
    'two_user_e2e',
    'rls_negative',
    'chaos',
    'load',
    'native_smoke',
    'rollout_step',
    'legacy_cleanup'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_run_kind');
  END IF;

  IF v_platform NOT IN ('web', 'native', 'mobile', 'cross_platform', 'backend', 'ops') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_platform');
  END IF;

  IF v_status NOT IN ('pending', 'passed', 'failed', 'blocked', 'waived') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status');
  END IF;

  IF p_rollout_bps IS NOT NULL AND (p_rollout_bps < 0 OR p_rollout_bps > 10000) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_rollout_bps');
  END IF;

  IF v_run_kind = 'rollout_step' AND COALESCE(p_rollout_bps, -1) NOT IN (100, 1000, 5000, 10000) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_rollout_step_bps');
  END IF;

  IF v_status = 'passed' AND v_run_kind = 'rollout_step' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'dedicated_rollout_step_recorder_required');
  END IF;

  IF v_status = 'passed' AND v_run_kind = 'legacy_cleanup' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'dedicated_legacy_cleanup_recorder_required');
  END IF;

  IF public.video_date_jsonb_has_secret_key(v_report) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sensitive_report_payload');
  END IF;

  INSERT INTO public.video_date_phase8_certification_runs (
    event_id,
    run_kind,
    platform,
    status,
    rollout_bps,
    commit_sha,
    report,
    notes,
    certified_by,
    certified_at,
    expires_at
  )
  VALUES (
    p_event_id,
    v_run_kind,
    v_platform,
    v_status,
    p_rollout_bps,
    NULLIF(lower(btrim(COALESCE(p_commit_sha, ''))), ''),
    v_report,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    auth.uid(),
    CASE WHEN v_status IN ('passed', 'failed', 'blocked', 'waived') THEN now() ELSE NULL END,
    p_expires_at
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'run_kind', v_run_kind,
    'platform', v_platform,
    'status', v_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_phase8_certification_run_v2(text, text, text, uuid, integer, text, jsonb, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_date_phase8_certification_run_v2(text, text, text, uuid, integer, text, jsonb, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.record_video_date_phase8_certification_run_v2(text, text, text, uuid, integer, text, jsonb, text, timestamptz) IS
  'Service-role writer for Phase 8 Video Date certification results. Rejects token/secret-shaped report payloads and requires dedicated wrappers for passed rollout-step and legacy-cleanup proof.';

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
  v_readiness_rows integer := 0;
  v_blocked_rows integer := 0;
  v_blockers jsonb := '[]'::jsonb;
  v_id uuid;
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

  WITH target_readiness AS (
    SELECT
      r.event_id,
      r.window_id,
      r.target_rollout_bps,
      r.can_advance_rollout,
      r.rollout_blockers
    FROM public.get_video_date_phase8_rollout_readiness(p_event_id) r
    WHERE r.target_rollout_bps = p_rollout_bps
  ),
  blocked AS (
    SELECT
      tr.event_id,
      tr.window_id,
      tr.target_rollout_bps,
      COALESCE(to_jsonb(tr.rollout_blockers), '[]'::jsonb) AS rollout_blockers
    FROM target_readiness tr
    WHERE COALESCE(tr.can_advance_rollout, false) IS NOT TRUE
  ),
  counts AS (
    SELECT count(*)::integer AS readiness_rows FROM target_readiness
  ),
  blocked_rollup AS (
    SELECT
      count(*)::integer AS blocked_rows,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'event_id', b.event_id,
            'window_id', b.window_id,
            'target_rollout_bps', b.target_rollout_bps,
            'rollout_blockers', b.rollout_blockers
          )
          ORDER BY b.event_id NULLS LAST, b.window_id
        ),
        '[]'::jsonb
      ) AS blockers
    FROM blocked b
  )
  SELECT c.readiness_rows, br.blocked_rows, br.blockers
  INTO v_readiness_rows, v_blocked_rows, v_blockers
  FROM counts c
  CROSS JOIN blocked_rollup br;

  IF COALESCE(v_readiness_rows, 0) = 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'rollout_readiness_missing',
      'event_id', p_event_id,
      'target_rollout_bps', p_rollout_bps
    );
  END IF;

  IF COALESCE(v_blocked_rows, 0) > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'rollout_readiness_blocked',
      'event_id', p_event_id,
      'target_rollout_bps', p_rollout_bps,
      'blocked_rows', v_blocked_rows,
      'blockers', v_blockers
    );
  END IF;

  v_report := v_report || jsonb_build_object(
    'recorded_via', 'record_video_date_phase8_rollout_step_v2',
    'live_rollout_bps', v_current_rollout_bps,
    'readiness_rows_checked', v_readiness_rows
  );

  INSERT INTO public.video_date_phase8_certification_runs (
    event_id,
    run_kind,
    platform,
    status,
    rollout_bps,
    commit_sha,
    report,
    notes,
    certified_by,
    certified_at,
    expires_at
  )
  VALUES (
    p_event_id,
    'rollout_step',
    'ops',
    'passed',
    p_rollout_bps,
    NULLIF(lower(btrim(COALESCE(p_commit_sha, ''))), ''),
    v_report,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    auth.uid(),
    now(),
    p_expires_at
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'run_kind', 'rollout_step',
    'platform', 'ops',
    'status', 'passed',
    'rollout_bps', p_rollout_bps
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_phase8_rollout_step_v2(uuid, integer, text, jsonb, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_date_phase8_rollout_step_v2(uuid, integer, text, jsonb, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.record_video_date_phase8_rollout_step_v2(uuid, integer, text, jsonb, text, timestamptz) IS
  'Service-role Phase 8 rollout-step recorder. Requires requested rollout bps to be live, rejects token/secret-shaped reports, and refuses rollout proof while get_video_date_phase8_rollout_readiness has blockers for the target.';

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
  v_id uuid;
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

  INSERT INTO public.video_date_phase8_certification_runs (
    event_id,
    run_kind,
    platform,
    status,
    rollout_bps,
    commit_sha,
    report,
    notes,
    certified_by,
    certified_at,
    expires_at
  )
  VALUES (
    NULL,
    'legacy_cleanup',
    'ops',
    'passed',
    10000,
    NULLIF(lower(btrim(COALESCE(p_commit_sha, ''))), ''),
    v_report,
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    auth.uid(),
    now(),
    p_expires_at
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'run_kind', 'legacy_cleanup',
    'platform', 'ops',
    'status', 'passed',
    'rollout_bps', 10000
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_phase8_legacy_cleanup_v2(text, jsonb, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_date_phase8_legacy_cleanup_v2(text, jsonb, text, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.record_video_date_phase8_legacy_cleanup_v2(text, jsonb, text, timestamptz) IS
  'Service-role Phase 8 legacy-cleanup recorder. Requires server-dealt deck to be active at 100% for one week, rejects token/secret-shaped reports, and is the only path for passed legacy-cleanup proof.';
