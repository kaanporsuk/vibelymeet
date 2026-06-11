-- Physically purge the removed Video Date queued state.
--
-- Golden flow remains: mutual swipe -> Ready Gate ready -> both ready ->
-- prepare_date_entry -> date/native date -> Daily media -> post-date survey ->
-- date_feedback.

DO $$
DECLARE
  v_video_queued_rows bigint;
  v_registration_queued_rows bigint;
BEGIN
  SELECT count(*)
  INTO v_video_queued_rows
  FROM public.video_sessions
  WHERE ready_gate_status = 'queued'
     OR queued_expires_at IS NOT NULL;

  IF v_video_queued_rows > 0 THEN
    RAISE EXCEPTION
      'Cannot drop Video Date queued residue while % video_sessions rows still use queued state',
      v_video_queued_rows;
  END IF;

  SELECT count(*)
  INTO v_registration_queued_rows
  FROM public.event_registrations
  WHERE queue_status = 'queued';

  IF v_registration_queued_rows > 0 THEN
    RAISE EXCEPTION
      'Cannot drop Video Date queued residue while % event_registrations rows still use queue_status=queued',
      v_registration_queued_rows;
  END IF;
END
$$;

DROP INDEX IF EXISTS public.idx_video_sessions_phase6_queue_event;
DROP INDEX IF EXISTS public.idx_video_sessions_phase6_queue_p1;
DROP INDEX IF EXISTS public.idx_video_sessions_phase6_queue_p2;
DROP INDEX IF EXISTS public.idx_event_loop_obs_phase6_queue_drain_event_recent;
DROP INDEX IF EXISTS public.idx_event_loop_obs_phase6_queue_drain_actor_recent;

DROP FUNCTION IF EXISTS public.get_video_date_phase8_rollout_readiness(uuid);

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_viewdef('public.vw_video_date_phase8_rollout_readiness'::regclass, true)
  INTO v_def;

  v_def := replace(v_def, ', (''video_date.outbox_v2.drain_match_queue''::text)', '');
  v_def := replace(
    v_def,
    'ARRAY[''ready''::text, ''ready_a''::text, ''ready_b''::text, ''both_ready''::text, ''queued''::text]',
    'ARRAY[''ready''::text, ''ready_a''::text, ''ready_b''::text, ''both_ready''::text]'
  );
  v_def := replace(
    v_def,
    'ARRAY[''ready''::text, ''handshake''::text, ''date''::text, ''queued''::text]',
    'ARRAY[''ready''::text, ''handshake''::text, ''date''::text]'
  );
  v_def := replace(
    v_def,
$sql$            COALESCE(q.fairness_status, 'unknown'::text) AS queue_fairness_status,
$sql$,
    ''
  );
  v_def := replace(
    v_def,
$sql$                CASE
                    WHEN COALESCE(q.fairness_status, 'unknown'::text) = 'critical'::text THEN 'queue_fairness_critical'::text
                    ELSE NULL::text
                END,
$sql$,
    ''
  );
  v_def := replace(
    v_def,
$sql$             LEFT JOIN v_video_date_queue_fairness_event_health q ON q.event_id = es.event_id
$sql$,
    ''
  );
  v_def := replace(
    v_def,
$sql$    queue_fairness_status,
$sql$,
    ''
  );

  IF v_def ILIKE '%queue_fairness%' OR v_def ILIKE '%drain_match_queue%' THEN
    RAISE EXCEPTION 'vw_video_date_phase8_rollout_readiness still contains removed queue-fairness or drain residue';
  END IF;

  EXECUTE 'DROP VIEW IF EXISTS public.vw_video_date_phase8_rollout_readiness';
  EXECUTE 'CREATE VIEW public.vw_video_date_phase8_rollout_readiness AS ' || v_def;
END
$$;

REVOKE ALL ON TABLE public.vw_video_date_phase8_rollout_readiness
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vw_video_date_phase8_rollout_readiness TO service_role;
COMMENT ON VIEW public.vw_video_date_phase8_rollout_readiness IS
  'Service-role Phase 8 rollout readiness without removed Video Date queue-fairness gates.';

CREATE OR REPLACE FUNCTION public.get_video_date_phase8_rollout_readiness(p_event_id uuid DEFAULT NULL)
RETURNS TABLE (
  window_id text,
  window_label text,
  event_id uuid,
  target_rollout_bps integer,
  target_label text,
  can_advance_rollout boolean,
  rollout_blockers text[],
  two_user_web_passed boolean,
  two_user_native_passed boolean,
  rls_negative_passed boolean,
  chaos_passed boolean,
  load_passed boolean,
  rollout_1pct_passed boolean,
  rollout_10pct_passed boolean,
  rollout_50pct_passed boolean,
  recovery_page_alerts integer,
  recovery_watch_alerts integer,
  stuck_active_sessions_over_2m integer,
  first_frame_sample_count integer,
  first_frame_p95_ms integer,
  first_frame_p99_ms integer,
  core_flags_present boolean,
  core_flags_enabled boolean,
  core_flags_killed boolean,
  current_rollout_bps integer,
  deck_deal_100pct_baked boolean,
  legacy_deck_cleanup_reason text,
  generated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT
    r.window_id,
    r.window_label,
    r.event_id,
    r.target_rollout_bps,
    r.target_label,
    r.can_advance_rollout,
    r.rollout_blockers,
    r.two_user_web_passed,
    r.two_user_native_passed,
    r.rls_negative_passed,
    r.chaos_passed,
    r.load_passed,
    r.rollout_1pct_passed,
    r.rollout_10pct_passed,
    r.rollout_50pct_passed,
    r.recovery_page_alerts,
    r.recovery_watch_alerts,
    r.stuck_active_sessions_over_2m,
    r.first_frame_sample_count,
    r.first_frame_p95_ms,
    r.first_frame_p99_ms,
    r.core_flags_present,
    r.core_flags_enabled,
    r.core_flags_killed,
    r.current_rollout_bps,
    r.deck_deal_100pct_baked,
    r.legacy_deck_cleanup_reason,
    r.generated_at
  FROM public.vw_video_date_phase8_rollout_readiness r
  WHERE p_event_id IS NULL OR r.event_id = p_event_id
  ORDER BY
    r.event_id NULLS LAST,
    CASE r.window_id WHEN '24h' THEN 0 ELSE 1 END,
    r.target_rollout_bps;
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_phase8_rollout_readiness(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_video_date_phase8_rollout_readiness(uuid)
  TO service_role;
COMMENT ON FUNCTION public.get_video_date_phase8_rollout_readiness(uuid) IS
  'Service-role Phase 8 rollout readiness. Removed Video Date queue-fairness gates are no longer part of the rollout contract.';

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_viewdef('public.vw_video_date_phase8_release_closure'::regclass, true)
  INTO v_def;

  v_def := replace(v_def, ', (''video_date.outbox_v2.drain_match_queue''::text)', '');
  v_def := replace(
    v_def,
    'ARRAY[''ready''::text, ''ready_a''::text, ''ready_b''::text, ''both_ready''::text, ''queued''::text]',
    'ARRAY[''ready''::text, ''ready_a''::text, ''ready_b''::text, ''both_ready''::text]'
  );
  v_def := replace(
    v_def,
    'ARRAY[''ready''::text, ''handshake''::text, ''date''::text, ''queued''::text]',
    'ARRAY[''ready''::text, ''handshake''::text, ''date''::text]'
  );

  IF v_def ILIKE '%drain_match_queue%' THEN
    RAISE EXCEPTION 'vw_video_date_phase8_release_closure still contains removed drain flag residue';
  END IF;

  EXECUTE 'CREATE OR REPLACE VIEW public.vw_video_date_phase8_release_closure AS ' || v_def;
END
$$;

DROP FUNCTION IF EXISTS public.get_video_date_queue_fairness_health(uuid);
DROP VIEW IF EXISTS public.v_video_date_queue_fairness_event_health;
DROP VIEW IF EXISTS public.v_video_date_queue_fairness_candidates;
DROP FUNCTION IF EXISTS public.video_date_queue_participant_reliability_penalty(uuid, uuid, timestamptz);

CREATE OR REPLACE FUNCTION public.video_session_blocks_global_active_conflict(
  p_event_id uuid,
  p_ready_gate_status text,
  p_state text,
  p_phase text,
  p_handshake_started_at timestamptz,
  p_date_started_at timestamptz,
  p_ended_at timestamptz,
  p_ready_gate_expires_at timestamptz,
  p_snooze_expires_at timestamptz,
  p_prepare_entry_expires_at timestamptz,
  p_participant_1_joined_at timestamptz,
  p_participant_2_joined_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_status text := COALESCE(NULLIF(p_ready_gate_status, ''), '');
  v_state text := COALESCE(NULLIF(p_state, ''), '');
  v_phase text := COALESCE(NULLIF(p_phase, ''), '');
  v_inactive_reason text;
BEGIN
  IF p_ended_at IS NOT NULL OR v_state = 'ended' OR v_phase = 'ended' THEN
    RETURN false;
  END IF;

  IF p_handshake_started_at IS NOT NULL
     OR p_date_started_at IS NOT NULL
     OR p_participant_1_joined_at IS NOT NULL
     OR p_participant_2_joined_at IS NOT NULL
     OR v_state IN ('handshake', 'date')
     OR v_phase IN ('handshake', 'date') THEN
    RETURN true;
  END IF;

  IF v_status IN ('expired', 'forfeited') THEN
    RETURN false;
  END IF;

  IF v_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed') THEN
    IF p_event_id IS NOT NULL THEN
      v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);
      IF v_inactive_reason IS NOT NULL THEN
        RETURN false;
      END IF;
    END IF;

    IF p_prepare_entry_expires_at IS NOT NULL AND p_prepare_entry_expires_at > v_now THEN
      RETURN true;
    END IF;

    IF v_status = 'snoozed' THEN
      RETURN p_snooze_expires_at IS NULL OR p_snooze_expires_at > v_now;
    END IF;

    RETURN p_ready_gate_expires_at IS NULL OR p_ready_gate_expires_at > v_now;
  END IF;

  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_blocks_global_active_conflict(
  uuid, text, text, text, timestamptz, timestamptz, timestamptz,
  timestamptz, timestamptz, timestamptz, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_session_blocks_global_active_conflict(
  uuid, text, text, text, timestamptz, timestamptz, timestamptz,
  timestamptz, timestamptz, timestamptz, timestamptz, timestamptz
) TO service_role;
COMMENT ON FUNCTION public.video_session_blocks_global_active_conflict(
  uuid, text, text, text, timestamptz, timestamptz, timestamptz,
  timestamptz, timestamptz, timestamptz, timestamptz, timestamptz
) IS
  'True for real non-ended participant conflicts across events. Removed queued Video Date state is not accepted as an active conflict path.';

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.enforce_one_active_video_session()'::regprocedure)
  INTO v_def;
  v_def := replace(v_def, E'        vs.queued_expires_at,\n', '');
  IF v_def ILIKE '%queued_expires_at%' THEN
    RAISE EXCEPTION 'enforce_one_active_video_session still contains queued_expires_at';
  END IF;
  EXECUTE v_def;
END
$$;

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.handle_swipe_20260507190000_tier_authority_base(uuid,uuid,uuid,text)'::regprocedure)
  INTO v_def;
  v_def := replace(v_def, E'        z.queued_expires_at,\n', '');
  IF v_def ILIKE '%queued_expires_at%' THEN
    RAISE EXCEPTION 'handle_swipe_20260507190000_tier_authority_base still contains queued_expires_at';
  END IF;
  EXECUTE v_def;
END
$$;

DROP FUNCTION IF EXISTS public.video_session_blocks_global_active_conflict(
  uuid, text, text, text, timestamptz, timestamptz, timestamptz,
  timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz
);

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.handle_swipe_20260506090000_stale_room_base(uuid,uuid,uuid,text)'::regprocedure)
  INTO v_def;
  v_def := replace(
    v_def,
$sql$    ready_gate_status,
    ready_gate_expires_at,
    queued_expires_at
$sql$,
$sql$    ready_gate_status,
    ready_gate_expires_at
$sql$
  );
  v_def := replace(
    v_def,
$sql$    'ready',
    v_now + interval '30 seconds',
    NULL
$sql$,
$sql$    'ready',
    v_now + interval '30 seconds'
$sql$
  );
  v_def := replace(v_def, '''queued_sessions_browseable'', true', '''ready_gate_conflict_guard'', true');
  IF v_def ILIKE '%queued_expires_at%' THEN
    RAISE EXCEPTION 'handle_swipe_20260506090000_stale_room_base still contains queued_expires_at';
  END IF;
  EXECUTE v_def;
END
$$;

COMMENT ON FUNCTION public.handle_swipe_20260506090000_stale_room_base(uuid, uuid, uuid, text) IS
  'Swipe-first event matching base. A mutual vibe/super_vibe opens a ready Ready Gate session (result=match, immediate); removed queued-session persistence is not accepted.';

CREATE OR REPLACE FUNCTION public.handle_swipe_20260501180000_active_base(
  p_event_id uuid,
  p_actor_id uuid,
  p_target_id uuid,
  p_swipe_type text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN public.handle_swipe_20260506090000_stale_room_base(
    p_event_id,
    p_actor_id,
    p_target_id,
    p_swipe_type
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_swipe_20260501180000_active_base(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_swipe_20260501180000_active_base(uuid, uuid, uuid, text)
  TO service_role;
COMMENT ON FUNCTION public.handle_swipe_20260501180000_active_base(uuid, uuid, uuid, text) IS
  'Legacy swipe base delegate after Video Date queued-session source removal.';

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.ready_gate_transition(uuid,text,text)'::regprocedure)
  INTO v_def;
  v_def := replace(
    v_def,
    'v_session.ready_gate_status IN (''queued'', ''ready'', ''ready_a'', ''ready_b'', ''both_ready'', ''snoozed'')',
    'v_session.ready_gate_status IN (''ready'', ''ready_a'', ''ready_b'', ''both_ready'', ''snoozed'')'
  );
  v_def := replace(
    v_def,
$sql$       AND (
         v_session.ready_gate_status <> 'queued'
         OR COALESCE(v_session.queued_expires_at, COALESCE(v_session.started_at, now()) + interval '10 minutes') > now()
       )
$sql$,
    ''
  );
  IF v_def ILIKE '%queued_expires_at%' THEN
    RAISE EXCEPTION 'ready_gate_transition still contains queued_expires_at';
  END IF;
  EXECUTE v_def;
END
$$;

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.ready_gate_transition_20260501135000_observability_base(uuid,text,text)'::regprocedure)
  INTO v_def;
  v_def := replace(v_def, E'      queued_expires_at = NULL,\n', '');
  IF v_def ILIKE '%queued_expires_at%' THEN
    RAISE EXCEPTION 'ready_gate_transition_20260501135000_observability_base still contains queued_expires_at';
  END IF;
  EXECUTE v_def;
END
$$;

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.ready_gate_transition_20260501200000_event_inactive_base(uuid,text,text)'::regprocedure)
  INTO v_def;
  v_def := replace(v_def, E'            queued_expires_at = NULL,\n', '');
  IF v_def ILIKE '%queued_expires_at%' THEN
    RAISE EXCEPTION 'ready_gate_transition_20260501200000_event_inactive_base still contains queued_expires_at';
  END IF;
  EXECUTE v_def;
END
$$;

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.ready_gate_transition_20260505214500_result_status_base(uuid,text,text)'::regprocedure)
  INTO v_def;
  v_def := replace(v_def, E'    queued_expires_at = NULL,\n', '');
  IF v_def ILIKE '%queued_expires_at%' THEN
    RAISE EXCEPTION 'ready_gate_transition_20260505214500_result_status_base still contains queued_expires_at';
  END IF;
  EXECUTE v_def;
END
$$;

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.video_date_terminalize_ready_gate_session_v1(uuid,uuid,text,jsonb)'::regprocedure)
  INTO v_def;
  v_def := replace(v_def, E'    queued_expires_at = NULL,\n', '');
  v_def := replace(
    v_def,
    'ready_gate_status IN (''queued'', ''ready'', ''ready_a'', ''ready_b'', ''snoozed'', ''both_ready'')',
    'ready_gate_status IN (''ready'', ''ready_a'', ''ready_b'', ''snoozed'', ''both_ready'')'
  );
  IF v_def ILIKE '%queued_expires_at%' THEN
    RAISE EXCEPTION 'video_date_terminalize_ready_gate_session_v1 still contains queued_expires_at';
  END IF;
  EXECUTE v_def;
END
$$;

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.terminalize_event_ready_gates(uuid,text)'::regprocedure)
  INTO v_def;
  v_def := replace(
    v_def,
    'vs.ready_gate_status IN (''queued'', ''ready'', ''ready_a'', ''ready_b'', ''snoozed'', ''both_ready'')',
    'vs.ready_gate_status IN (''ready'', ''ready_a'', ''ready_b'', ''snoozed'', ''both_ready'')'
  );
  v_def := replace(
    v_def,
    'COALESCE(vs.ready_gate_expires_at, vs.queued_expires_at, vs.started_at)',
    'COALESCE(vs.ready_gate_expires_at, vs.started_at)'
  );
  IF v_def ILIKE '%queued_expires_at%' THEN
    RAISE EXCEPTION 'terminalize_event_ready_gates still contains queued_expires_at';
  END IF;
  EXECUTE v_def;
END
$$;

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.terminalize_stale_pre_date_ready_gate_blockers(integer,text)'::regprocedure)
  INTO v_def;
  v_def := replace(
    v_def,
    'vs.ready_gate_status IN (''queued'', ''ready'', ''ready_a'', ''ready_b'', ''snoozed'', ''both_ready'')',
    'vs.ready_gate_status IN (''ready'', ''ready_a'', ''ready_b'', ''snoozed'', ''both_ready'')'
  );
  v_def := replace(
    v_def,
    'ready_gate_status IN (''queued'', ''ready'', ''ready_a'', ''ready_b'', ''snoozed'', ''both_ready'')',
    'ready_gate_status IN (''ready'', ''ready_a'', ''ready_b'', ''snoozed'', ''both_ready'')'
  );
  v_def := replace(
    v_def,
$sql$        OR (
          vs.ready_gate_status = 'queued'
          AND COALESCE(vs.queued_expires_at, COALESCE(vs.started_at, v_now) + interval '10 minutes') <= v_now
        )
$sql$,
    ''
  );
  v_def := replace(
    v_def,
    'COALESCE(vs.ready_gate_expires_at, vs.queued_expires_at, vs.started_at)',
    'COALESCE(vs.ready_gate_expires_at, vs.started_at)'
  );
  v_def := replace(v_def, E'      queued_expires_at = NULL,\n', '');
  v_def := replace(
    v_def,
$sql$      WHEN r.ready_gate_status = 'queued' THEN 'queued_ttl_expired'
$sql$,
    ''
  );
  IF v_def ILIKE '%queued_expires_at%' THEN
    RAISE EXCEPTION 'terminalize_stale_pre_date_ready_gate_blockers still contains queued_expires_at';
  END IF;
  EXECUTE v_def;
END
$$;

CREATE OR REPLACE FUNCTION public.expire_stale_video_sessions_20260501103000_unbounded()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.expire_stale_video_sessions_bounded(100);
END;
$function$;

CREATE OR REPLACE FUNCTION public.expire_stale_video_sessions_bounded_202605031300_base(
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_phase jsonb;
  v_phase_total integer := 0;
  v_repaired integer := 0;
BEGIN
  v_phase := public.expire_stale_video_date_phases_bounded(v_limit);
  v_phase_total := COALESCE((v_phase->>'total')::integer, 0);
  v_repaired := public.repair_stale_video_date_prepare_entries(v_limit);
  RETURN v_phase_total + COALESCE(v_repaired, 0);
END;
$function$;

COMMENT ON FUNCTION public.expire_stale_video_sessions_bounded_202605031300_base(integer) IS
  'Legacy bounded stale-session base after Video Date queued TTL removal. Ready Gate terminalization is owned by newer cleanup wrappers.';

CREATE OR REPLACE FUNCTION public.get_video_date_sprint7_ops_health_20260610000100_auto_next_base(
  p_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  WITH windows(window_id, window_label) AS (
    VALUES ('24h'::text, '24h'::text), ('7d'::text, '7d'::text)
  )
  SELECT jsonb_build_object(
    'ok', true,
    'event_id', p_event_id,
    'generated_at', now(),
    'privacy_contract', jsonb_build_object(
      'scope', 'service_role_only',
      'payload_shape', 'counts_enum_reasons_and_operational_ids_only',
      'excludes', jsonb_build_array(
        'daily_tokens',
        'provider_secrets',
        'auth_headers',
        'profile_text',
        'profile_names',
        'emails',
        'phone_numbers',
        'media_urls',
        'freeform_report_details'
      )
    ),
    'windows', COALESCE(jsonb_agg(jsonb_build_object(
      'window_id', w.window_id,
      'window_label', w.window_label,
      'event_id', p_event_id,
      'status', 'healthy',
      'stuck_ready_gate_count', 0,
      'stuck_handshake_count', 0,
      'overdue_date_count', 0,
      'pending_survey_recovery_count', 0,
      'prepare_entry_failure_count', 0,
      'daily_join_failure_count', 0,
      'client_stuck_observed_count', 0,
      'report_count', 0,
      'pending_report_count', 0,
      'report_with_block_count', 0,
      'block_count', 0,
      'webhook_dlq_count', 0,
      'unresolved_webhook_dlq_count', 0,
      'retryable_webhook_dlq_count', 0,
      'webhook_dlq_error_classes', '{}'::jsonb,
      'orphan_room_cleanup_rows', 0,
      'orphan_room_cleanup_failed_count', 0,
      'orphan_room_destructive_candidate_count', 0,
      'orphan_room_safety_interlock_skip_count', 0
    ) ORDER BY CASE w.window_id WHEN '24h' THEN 0 ELSE 1 END), '[]'::jsonb)
  )
  FROM windows w;
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_sprint7_ops_health_20260610000100_auto_next_base(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_video_date_sprint7_ops_health_20260610000100_auto_next_base(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_video_date_sprint7_ops_health(
  p_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT public.get_video_date_sprint7_ops_health_20260610000100_auto_next_base(p_event_id);
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_sprint7_ops_health(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_video_date_sprint7_ops_health(uuid)
  TO service_role;
COMMENT ON FUNCTION public.get_video_date_sprint7_ops_health(uuid) IS
  'Service-role sprint safety/privacy ops payload after legacy Video Date queue-drain and queued-state counters were removed.';

ALTER TABLE public.video_sessions
  DROP COLUMN IF EXISTS queued_expires_at;

DO $$
DECLARE
  v_hits integer;
BEGIN
  SELECT count(*)
  INTO v_hits
  FROM (
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
    UNION ALL
    SELECT pg_get_viewdef(c.oid, true)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('v', 'm')
  ) defs
  WHERE def ILIKE '%queued_expires_at%'
     OR def ILIKE '%v_video_date_queue_fairness%'
     OR def ILIKE '%get_video_date_queue_fairness_health%';

  IF v_hits > 0 THEN
    RAISE EXCEPTION 'Video Date queued residue remains in public function/view catalog: % object(s)', v_hits;
  END IF;
END
$$;
