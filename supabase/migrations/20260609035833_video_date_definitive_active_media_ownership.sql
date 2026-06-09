BEGIN;

ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS stable_bilateral_media_at timestamptz,
  ADD COLUMN IF NOT EXISTS stable_bilateral_media_source text,
  ADD COLUMN IF NOT EXISTS stable_bilateral_media_detail jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.video_sessions.stable_bilateral_media_at IS
  'First time this Video Date was certified with durable bilateral provider-backed media and current active surface claims.';
COMMENT ON COLUMN public.video_sessions.stable_bilateral_media_source IS
  'Server promotion path that certified stable bilateral media.';
COMMENT ON COLUMN public.video_sessions.stable_bilateral_media_detail IS
  'Stable media gate payload captured at certification time for later terminal/survey decisions.';

CREATE OR REPLACE FUNCTION public.video_date_active_surface_claims_v1(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_p1 public.video_date_surface_claims%ROWTYPE;
  v_p2 public.video_date_surface_claims%ROWTYPE;
  v_p1_active boolean := false;
  v_p2_active boolean := false;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'both_active', false,
      'reason', 'session_id_required'
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'both_active', false,
      'reason', 'session_not_found'
    );
  END IF;

  SELECT *
  INTO v_p1
  FROM public.video_date_surface_claims c
  WHERE c.session_id = p_session_id
    AND c.profile_id = v_session.participant_1_id
    AND c.surface = 'video_date'
    AND c.released_at IS NULL
    AND c.expires_at > v_now
  ORDER BY c.updated_at DESC, c.claimed_at DESC
  LIMIT 1;

  SELECT *
  INTO v_p2
  FROM public.video_date_surface_claims c
  WHERE c.session_id = p_session_id
    AND c.profile_id = v_session.participant_2_id
    AND c.surface = 'video_date'
    AND c.released_at IS NULL
    AND c.expires_at > v_now
  ORDER BY c.updated_at DESC, c.claimed_at DESC
  LIMIT 1;

  v_p1_active := v_p1.profile_id IS NOT NULL;
  v_p2_active := v_p2.profile_id IS NOT NULL;

  RETURN jsonb_build_object(
    'both_active', v_p1_active AND v_p2_active,
    'participant_1_surface_active', v_p1_active,
    'participant_2_surface_active', v_p2_active,
    'participant_1_client_instance_id', v_p1.client_instance_id,
    'participant_2_client_instance_id', v_p2.client_instance_id,
    'participant_1_claimed_at', v_p1.claimed_at,
    'participant_2_claimed_at', v_p2.claimed_at,
    'participant_1_updated_at', v_p1.updated_at,
    'participant_2_updated_at', v_p2.updated_at,
    'participant_1_expires_at', v_p1.expires_at,
    'participant_2_expires_at', v_p2.expires_at,
    'reason', CASE
      WHEN v_p1_active AND v_p2_active THEN 'both_video_date_surface_claims_current'
      WHEN NOT v_p1_active AND NOT v_p2_active THEN 'both_video_date_surface_claims_missing'
      WHEN NOT v_p1_active THEN 'participant_1_video_date_surface_claim_missing'
      ELSE 'participant_2_video_date_surface_claim_missing'
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_active_surface_claims_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_active_surface_claims_v1(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.video_date_stable_bilateral_media_gate_v1(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_session public.video_sessions%ROWTYPE;
  v_stable jsonb := '{}'::jsonb;
  v_surface jsonb := '{}'::jsonb;
  v_stable_copresence boolean := false;
  v_heartbeat_ready boolean := false;
  v_bilateral_remote_seen boolean := false;
  v_one_remote_seen boolean := false;
  v_surface_ready boolean := false;
  v_historical_certified boolean := false;
  v_stable_bilateral_media boolean := false;
  v_reason text := 'missing_session';
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'stable_bilateral_media', false,
      'stable_copresence', false,
      'surface_claims_current', false,
      'waiting_for_stable_copresence', true,
      'reason', 'session_id_required',
      'retry_after_ms', 750,
      'stable_bilateral_media_gate_v2', true
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'stable_bilateral_media', false,
      'stable_copresence', false,
      'surface_claims_current', false,
      'waiting_for_stable_copresence', true,
      'reason', v_reason,
      'retry_after_ms', 750,
      'stable_bilateral_media_gate_v2', true
    );
  END IF;

  v_historical_certified := v_session.stable_bilateral_media_at IS NOT NULL;

  IF v_historical_certified
     AND (
       v_session.date_started_at IS NOT NULL
       OR v_session.state = 'date'::public.video_date_state
       OR v_session.phase = 'date'
       OR v_session.ended_at IS NOT NULL
     ) THEN
    RETURN jsonb_build_object(
      'stable_bilateral_media', true,
      'stable_copresence', true,
      'surface_claims_current', true,
      'waiting_for_stable_copresence', false,
      'reason', 'already_date_stable_bilateral_media_certified',
      'retry_after_ms', 0,
      'stable_bilateral_media_at', v_session.stable_bilateral_media_at,
      'stable_bilateral_media_source', v_session.stable_bilateral_media_source,
      'stable_bilateral_media_detail', v_session.stable_bilateral_media_detail,
      'stable_bilateral_media_gate_v2', true
    );
  END IF;

  v_stable := public.video_date_stable_copresence_v1(p_session_id);
  v_surface := public.video_date_active_surface_claims_v1(p_session_id);
  v_stable_copresence := COALESCE((v_stable->>'stable_copresence')::boolean, false);
  v_one_remote_seen := COALESCE((v_stable->>'one_remote_seen')::boolean, false);
  v_surface_ready := COALESCE((v_surface->>'both_active')::boolean, false);
  v_heartbeat_ready :=
    v_stable_copresence
    AND NOT v_one_remote_seen
    AND COALESCE((v_stable->>'heartbeat_overlap')::boolean, false)
    AND COALESCE((v_stable->>'heartbeat_fresh')::boolean, false);
  v_bilateral_remote_seen :=
    v_stable_copresence
    AND COALESCE((v_stable->>'remote_seen')::boolean, false)
    AND NOT v_one_remote_seen;
  v_stable_bilateral_media := v_surface_ready AND (v_heartbeat_ready OR v_bilateral_remote_seen);

  IF v_stable_bilateral_media THEN
    v_reason := CASE
      WHEN v_heartbeat_ready THEN 'stable_bilateral_owner_heartbeat_with_surface_claims'
      ELSE 'stable_bilateral_remote_seen_with_surface_claims'
    END;
  ELSIF v_session.date_started_at IS NOT NULL
     OR v_session.state = 'date'::public.video_date_state
     OR v_session.phase = 'date' THEN
    v_reason := 'already_date_requires_stable_bilateral_media_certification';
  ELSIF NOT v_surface_ready THEN
    v_reason := COALESCE(v_surface->>'reason', 'bilateral_video_date_surface_claims_required');
  ELSIF v_one_remote_seen THEN
    v_reason := 'bilateral_remote_seen_required';
  ELSIF NOT v_stable_copresence THEN
    v_reason := COALESCE(v_stable->>'reason', 'stable_copresence_not_ready');
  ELSIF NOT COALESCE((v_stable->>'heartbeat_overlap')::boolean, false) THEN
    v_reason := 'bilateral_owner_heartbeat_overlap_required';
  ELSIF NOT COALESCE((v_stable->>'heartbeat_fresh')::boolean, false) THEN
    v_reason := 'fresh_bilateral_owner_heartbeat_required';
  ELSE
    v_reason := 'stable_bilateral_media_required';
  END IF;

  RETURN jsonb_build_object(
    'stable_bilateral_media', v_stable_bilateral_media,
    'stable_copresence', v_stable_copresence,
    'surface_claims_current', v_surface_ready,
    'waiting_for_stable_copresence', NOT v_stable_bilateral_media,
    'reason', v_reason,
    'retry_after_ms', CASE WHEN v_stable_bilateral_media THEN 0 ELSE 750 END,
    'heartbeat_ready', v_heartbeat_ready,
    'bilateral_remote_seen', v_bilateral_remote_seen,
    'one_remote_seen', v_one_remote_seen,
    'historical_date_started_without_stable_media_certification',
      (v_session.date_started_at IS NOT NULL OR v_session.state = 'date'::public.video_date_state OR v_session.phase = 'date')
      AND NOT v_historical_certified,
    'stable_copresence_detail', v_stable,
    'surface_claims_detail', v_surface,
    'stable_bilateral_media_gate_v2', true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_mark_stable_bilateral_media_v1(
  p_session_id uuid,
  p_source text,
  p_gate jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_source text := NULLIF(left(btrim(COALESCE(p_source, '')), 160), '');
  v_session public.video_sessions%ROWTYPE;
BEGIN
  IF p_session_id IS NULL
     OR COALESCE((p_gate->>'stable_bilateral_media')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'stable_bilateral_media_marked', false,
      'reason', 'stable_bilateral_media_required'
    );
  END IF;

  UPDATE public.video_sessions
  SET
    stable_bilateral_media_at = COALESCE(stable_bilateral_media_at, v_now),
    stable_bilateral_media_source = COALESCE(stable_bilateral_media_source, COALESCE(v_source, 'video_date_mark_stable_bilateral_media_v1')),
    stable_bilateral_media_detail = CASE
      WHEN stable_bilateral_media_at IS NULL THEN COALESCE(p_gate, '{}'::jsonb)
      ELSE stable_bilateral_media_detail
    END,
    state_updated_at = v_now
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'stable_bilateral_media_marked', false,
      'reason', 'session_not_found'
    );
  END IF;

  RETURN jsonb_build_object(
    'stable_bilateral_media_marked', true,
    'stable_bilateral_media_at', v_session.stable_bilateral_media_at,
    'stable_bilateral_media_source', v_session.stable_bilateral_media_source,
    'stable_bilateral_media_detail', v_session.stable_bilateral_media_detail
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_mark_stable_bilateral_media_v1(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_mark_stable_bilateral_media_v1(uuid, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.video_date_promote_provider_overlap_v1(
  p_session_id uuid,
  p_actor uuid DEFAULT NULL,
  p_source text DEFAULT 'video_date_promote_provider_overlap_v1',
  p_reason text DEFAULT NULL,
  p_require_participant boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := p_actor;
  v_session public.video_sessions%ROWTYPE;
  v_eligibility jsonb := '{}'::jsonb;
  v_gate jsonb := '{}'::jsonb;
  v_mark jsonb := '{}'::jsonb;
  v_payload jsonb;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_id_required');
  END IF;

  IF p_require_participant AND v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
  END IF;

  IF v_actor IS NULL AND p_require_participant IS NOT TRUE THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND THEN
      v_actor := v_session.participant_1_id;
    END IF;
  END IF;

  v_eligibility := public.video_date_session_lifecycle_eligibility_v1(
    p_session_id,
    v_actor,
    COALESCE(NULLIF(btrim(p_source), ''), 'video_date_promote_provider_overlap_v1')
  );

  IF COALESCE((v_eligibility->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN v_eligibility || jsonb_build_object(
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'confirmed_encounter_promoted_to_date', false,
      'early_confirmed_encounter_promoted', false,
      'reason', 'lifecycle_eligibility_failed',
      'promotion_reason', 'lifecycle_eligibility_failed',
      'retryable', COALESCE((v_eligibility->>'retryable')::boolean, false),
      'terminal', COALESCE((v_eligibility->>'terminal')::boolean, true),
      'lifecycle_eligibility_checked', true,
      'stable_bilateral_media_gate_checked', false,
      'promotion_blocked_by_lifecycle_eligibility', true
    );
  END IF;

  v_gate := public.video_date_stable_bilateral_media_gate_v1(p_session_id);

  IF COALESCE((v_gate->>'stable_bilateral_media')::boolean, false) IS NOT TRUE THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND THEN
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'no_op',
        'stable_bilateral_media_promotion_waiting',
        NULL,
        v_session.event_id,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'source', p_source,
          'p_reason', p_reason,
          'stable_bilateral_media_gate', v_gate
        )
      );
    END IF;

    RETURN v_eligibility || jsonb_build_object(
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'confirmed_encounter_promoted_to_date', false,
      'early_confirmed_encounter_promoted', false,
      'reason', COALESCE(v_gate->>'reason', 'stable_bilateral_media_required'),
      'promotion_reason', COALESCE(v_gate->>'reason', 'stable_bilateral_media_required'),
      'retryable', true,
      'terminal', false,
      'waiting_for_stable_copresence', true,
      'lifecycle_eligibility_checked', true,
      'stable_bilateral_media_gate_checked', true,
      'promotion_blocked_by_stable_bilateral_media', true,
      'stable_bilateral_media_gate', v_gate
    );
  END IF;

  v_mark := public.video_date_mark_stable_bilateral_media_v1(
    p_session_id,
    COALESCE(NULLIF(btrim(p_source), ''), 'video_date_promote_provider_overlap_v1'),
    v_gate
  );

  v_payload := COALESCE(public.vd_provider_overlap_stable_media_base(
    p_session_id,
    p_actor,
    p_source,
    p_reason,
    p_require_participant
  ), '{}'::jsonb);

  RETURN v_payload || jsonb_build_object(
    'lifecycle_eligibility_checked', true,
    'stable_bilateral_media_gate_checked', true,
    'stable_bilateral_media_gate', v_gate,
    'stable_bilateral_media_mark', v_mark
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_promote_confirmed_encounter_v1(
  p_session_id uuid,
  p_actor uuid DEFAULT NULL,
  p_source text DEFAULT 'video_date_promote_confirmed_encounter_v1',
  p_reason text DEFAULT NULL,
  p_require_participant boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_session public.video_sessions%ROWTYPE;
  v_auth_actor uuid := auth.uid();
  v_effective_actor uuid;
  v_require_participant boolean := COALESCE(p_require_participant, false);
  v_is_service_role boolean := auth.role() = 'service_role';
  v_gate jsonb := '{}'::jsonb;
  v_mark jsonb := '{}'::jsonb;
  v_payload jsonb := '{}'::jsonb;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_id_required');
  END IF;

  IF v_is_service_role THEN
    v_effective_actor := COALESCE(p_actor, v_auth_actor);
  ELSE
    IF v_auth_actor IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
    END IF;

    IF p_actor IS NOT NULL AND p_actor IS DISTINCT FROM v_auth_actor THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'actor_mismatch');
    END IF;

    v_effective_actor := v_auth_actor;
    v_require_participant := true;
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_not_found');
  END IF;

  IF v_require_participant
     AND v_effective_actor IS DISTINCT FROM v_session.participant_1_id
     AND v_effective_actor IS DISTINCT FROM v_session.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_participant');
  END IF;

  v_gate := public.video_date_stable_bilateral_media_gate_v1(p_session_id);

  IF COALESCE((v_gate->>'stable_bilateral_media')::boolean, false) IS NOT TRUE THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'no_op',
      'confirmed_encounter_stable_bilateral_media_waiting',
      NULL,
      v_session.event_id,
      v_effective_actor,
      p_session_id,
      jsonb_build_object(
        'source', p_source,
        'p_reason', p_reason,
        'stable_bilateral_media_gate', v_gate
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'success', true,
      'promoted', false,
      'confirmed_encounter_promoted_to_date', false,
      'reason', COALESCE(v_gate->>'reason', 'stable_bilateral_media_required'),
      'promotion_reason', COALESCE(v_gate->>'reason', 'stable_bilateral_media_required'),
      'confirmed_encounter', false,
      'active_confirmed_encounter', false,
      'retryable', true,
      'terminal', false,
      'waiting_for_stable_copresence', true,
      'stable_bilateral_media_gate_checked', true,
      'promotion_blocked_by_stable_bilateral_media', true,
      'stable_bilateral_media_gate', v_gate,
      'session_seq', COALESCE(v_session.session_seq, 0)
    );
  END IF;

  v_mark := public.video_date_mark_stable_bilateral_media_v1(
    p_session_id,
    COALESCE(NULLIF(btrim(p_source), ''), 'video_date_promote_confirmed_encounter_v1'),
    v_gate
  );

  v_payload := COALESCE(public.vd_promote_ce_stable_media_base(
    p_session_id,
    v_effective_actor,
    p_source,
    p_reason,
    v_require_participant
  ), '{}'::jsonb);

  RETURN v_payload || jsonb_build_object(
    'stable_bilateral_media_gate_checked', true,
    'stable_bilateral_media_gate', v_gate,
    'stable_bilateral_media_mark', v_mark
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_session_handshake_auto_promote_v2(
  p_session_id uuid,
  p_idempotency_key text DEFAULT NULL,
  p_request_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_session public.video_sessions%ROWTYPE;
  v_eligibility jsonb := '{}'::jsonb;
  v_gate jsonb := '{}'::jsonb;
  v_mark jsonb := '{}'::jsonb;
  v_payload jsonb := '{}'::jsonb;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_id_required');
  END IF;

  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  v_eligibility := public.video_date_session_lifecycle_eligibility_v1(
    p_session_id,
    v_actor,
    'video_session_handshake_auto_promote_v2'
  );

  IF COALESCE((v_eligibility->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN v_eligibility || jsonb_build_object(
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'confirmed_encounter_promoted_to_date', false,
      'early_confirmed_encounter_promoted', false,
      'reason', 'lifecycle_eligibility_failed',
      'promotion_reason', 'lifecycle_eligibility_failed',
      'retryable', COALESCE((v_eligibility->>'retryable')::boolean, false),
      'terminal', COALESCE((v_eligibility->>'terminal')::boolean, true),
      'lifecycle_eligibility_checked', true,
      'stable_bilateral_media_gate_checked', false,
      'promotion_blocked_by_lifecycle_eligibility', true
    );
  END IF;

  v_gate := public.video_date_stable_bilateral_media_gate_v1(p_session_id);

  IF COALESCE((v_gate->>'stable_bilateral_media')::boolean, false) IS NOT TRUE THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND THEN
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'no_op',
        'stable_bilateral_media_auto_promotion_waiting',
        NULL,
        v_session.event_id,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'source', 'video_session_handshake_auto_promote_v2',
          'stable_bilateral_media_gate', v_gate,
          'idempotency_key_present', p_idempotency_key IS NOT NULL,
          'request_hash_present', p_request_hash IS NOT NULL
        )
      );
    END IF;

    RETURN v_eligibility || jsonb_build_object(
      'promoted', false,
      'provider_overlap_promoted_to_date', false,
      'confirmed_encounter_promoted_to_date', false,
      'early_confirmed_encounter_promoted', false,
      'reason', COALESCE(v_gate->>'reason', 'stable_bilateral_media_required'),
      'promotion_reason', COALESCE(v_gate->>'reason', 'stable_bilateral_media_required'),
      'retryable', true,
      'terminal', false,
      'waiting_for_stable_copresence', true,
      'lifecycle_eligibility_checked', true,
      'stable_bilateral_media_gate_checked', true,
      'promotion_blocked_by_stable_bilateral_media', true,
      'stable_bilateral_media_gate', v_gate
    );
  END IF;

  v_mark := public.video_date_mark_stable_bilateral_media_v1(
    p_session_id,
    'video_session_handshake_auto_promote_v2',
    v_gate
  );

  v_payload := COALESCE(public.vd_auto_promote_stable_media_base(
    p_session_id,
    p_idempotency_key,
    p_request_hash
  ), '{}'::jsonb);

  RETURN v_payload || jsonb_build_object(
    'lifecycle_eligibility_checked', true,
    'stable_bilateral_media_gate_checked', true,
    'stable_bilateral_media_gate', v_gate,
    'stable_bilateral_media_mark', v_mark
  );
END;
$function$;

DO $$
BEGIN
  IF to_regprocedure('public.vd_absence_stable_media_base(uuid, text)') IS NULL
     AND to_regprocedure('public.video_date_reconcile_provider_absence_v1(uuid, text)') IS NOT NULL THEN
    ALTER FUNCTION public.video_date_reconcile_provider_absence_v1(uuid, text)
      RENAME TO vd_absence_stable_media_base;
  END IF;

  IF to_regprocedure('public.vd_absence_stable_media_base(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'missing provider absence base for stable media survey gate';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.vd_absence_stable_media_base(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_absence_stable_media_base(uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.video_date_reconcile_provider_absence_v1(
  p_session_id uuid,
  p_source text DEFAULT 'video_date_reconcile_provider_absence_v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_result jsonb;
  v_terminal boolean := false;
  v_survey_required boolean := false;
  v_ended_reason text;
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_event_live boolean := false;
  v_resume_status text := 'idle';
  v_rows_changed integer := 0;
BEGIN
  v_result := public.vd_absence_stable_media_base(
    p_session_id,
    p_source
  );

  v_terminal := lower(COALESCE(v_result ->> 'terminal', 'false')) IN ('true', 't', '1', 'yes');
  v_survey_required := lower(COALESCE(v_result ->> 'survey_required', 'false')) IN ('true', 't', '1', 'yes');
  v_ended_reason := NULLIF(v_result ->> 'ended_reason', '');

  IF NOT v_terminal
     OR NOT v_survey_required
     OR v_ended_reason IS DISTINCT FROM 'provider_absence_after_confirmed_encounter' THEN
    RETURN v_result;
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND OR v_session.stable_bilateral_media_at IS NOT NULL THEN
    RETURN v_result;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.events ev
    WHERE ev.id = v_session.event_id
      AND ev.status = 'live'
      AND ev.archived_at IS NULL
  ) INTO v_event_live;

  v_resume_status := CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END;

  UPDATE public.video_sessions
  SET
    ended_reason = 'pre_stable_media_failed',
    terminal_audit_at = v_now,
    terminal_audit_reason = 'pre_stable_media_failed',
    terminal_audit_source = COALESCE(NULLIF(btrim(p_source), ''), 'video_date_reconcile_provider_absence_v1'),
    terminal_audit_detail = COALESCE(terminal_audit_detail, '{}'::jsonb) || jsonb_build_object(
      'original_ended_reason', 'provider_absence_after_confirmed_encounter',
      'original_reconcile_result', v_result,
      'pre_stable_media_failed', true,
      'stable_bilateral_media_at', stable_bilateral_media_at,
      'stable_bilateral_media_required_for_survey', true
    ),
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_reason = 'provider_absence_after_confirmed_encounter'
    AND stable_bilateral_media_at IS NULL;
  GET DIAGNOSTICS v_rows_changed = ROW_COUNT;

  IF v_rows_changed > 0 THEN
    UPDATE public.event_registrations
    SET
      queue_status = v_resume_status,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now,
      updated_at = v_now
    WHERE event_id = v_session.event_id
      AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
      AND queue_status = 'in_survey';

    PERFORM public.bump_video_session_seq(p_session_id);
    PERFORM public.record_event_loop_observability(
      'video_date_provider_absence',
      'success',
      'pre_stable_media_failed_no_survey',
      NULL,
      v_session.event_id,
      NULL,
      p_session_id,
      jsonb_build_object(
        'source', COALESCE(NULLIF(btrim(p_source), ''), 'video_date_reconcile_provider_absence_v1'),
        'original_ended_reason', 'provider_absence_after_confirmed_encounter',
        'ended_reason', 'pre_stable_media_failed',
        'survey_required', false,
        'queue_status', v_resume_status,
        'stable_bilateral_media_required_for_survey', true,
        'base_result', v_result
      )
    );
  END IF;

  RETURN v_result
    || jsonb_build_object(
      'terminal', true,
      'terminalized', true,
      'provider_presence_terminal', true,
      'ended_reason', 'pre_stable_media_failed',
      'original_ended_reason', 'provider_absence_after_confirmed_encounter',
      'survey_required', false,
      'queue_status', v_resume_status,
      'reason', 'pre_stable_media_failed',
      'stable_bilateral_media_required_for_survey', true
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_active_surface_claims_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_active_surface_claims_v1(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_date_stable_bilateral_media_gate_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_stable_bilateral_media_gate_v1(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_date_promote_provider_overlap_v1(uuid, uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_promote_provider_overlap_v1(uuid, uuid, text, text, boolean)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_date_promote_confirmed_encounter_v1(uuid, uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_promote_confirmed_encounter_v1(uuid, uuid, text, text, boolean)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.video_date_reconcile_provider_absence_v1(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_reconcile_provider_absence_v1(uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.video_date_active_surface_claims_v1(uuid) IS
  'Service-only helper that proves both participants currently own live video_date surface claims for a session.';
COMMENT ON FUNCTION public.video_date_stable_bilateral_media_gate_v1(uuid) IS
  'Service-only Video Date promotion gate v2. Date promotion requires fresh provider-backed bilateral media plus active surface ownership, or prior stable-media certification; already-date alone is not proof.';
COMMENT ON FUNCTION public.video_date_mark_stable_bilateral_media_v1(uuid, text, jsonb) IS
  'Stores the first durable bilateral media certification that later terminal/survey decisions must honor.';
COMMENT ON FUNCTION public.video_date_reconcile_provider_absence_v1(uuid, text) IS
  'Provider-authoritative absence reconciler. A provider-absence terminal only opens survey after prior stable bilateral media certification; pre-stable failures resume users instead.';

NOTIFY pgrst, 'reload schema';

COMMIT;
