BEGIN;

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
  v_stable_copresence boolean := false;
  v_heartbeat_ready boolean := false;
  v_bilateral_remote_seen boolean := false;
  v_one_remote_seen boolean := false;
  v_stable_bilateral_media boolean := false;
  v_reason text := 'missing_session';
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'stable_bilateral_media', false,
      'stable_copresence', false,
      'waiting_for_stable_copresence', true,
      'reason', 'session_id_required',
      'retry_after_ms', 750
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
      'waiting_for_stable_copresence', true,
      'reason', v_reason,
      'retry_after_ms', 750
    );
  END IF;

  IF v_session.date_started_at IS NOT NULL
     OR v_session.state = 'date'::public.video_date_state
     OR v_session.phase = 'date' THEN
    RETURN jsonb_build_object(
      'stable_bilateral_media', true,
      'stable_copresence', true,
      'waiting_for_stable_copresence', false,
      'reason', 'already_date',
      'retry_after_ms', 0
    );
  END IF;

  v_stable := public.video_date_stable_copresence_v1(p_session_id);
  v_stable_copresence := COALESCE((v_stable->>'stable_copresence')::boolean, false);
  v_one_remote_seen := COALESCE((v_stable->>'one_remote_seen')::boolean, false);
  v_heartbeat_ready :=
    v_stable_copresence
    AND COALESCE((v_stable->>'heartbeat_overlap')::boolean, false)
    AND COALESCE((v_stable->>'heartbeat_fresh')::boolean, false);
  v_bilateral_remote_seen :=
    v_stable_copresence
    AND COALESCE((v_stable->>'remote_seen')::boolean, false)
    AND NOT v_one_remote_seen;
  v_stable_bilateral_media := v_heartbeat_ready OR v_bilateral_remote_seen;

  IF v_stable_bilateral_media THEN
    v_reason := CASE
      WHEN v_heartbeat_ready THEN 'stable_bilateral_owner_heartbeat'
      ELSE 'stable_bilateral_remote_seen'
    END;
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
    'waiting_for_stable_copresence', NOT v_stable_bilateral_media,
    'reason', v_reason,
    'retry_after_ms', CASE WHEN v_stable_bilateral_media THEN 0 ELSE 750 END,
    'heartbeat_ready', v_heartbeat_ready,
    'bilateral_remote_seen', v_bilateral_remote_seen,
    'one_remote_seen', v_one_remote_seen,
    'stable_copresence_detail', v_stable
  );
END;
$function$;

DO $$
BEGIN
  IF to_regprocedure('public.vd_provider_overlap_stable_media_base(uuid, uuid, text, text, boolean)') IS NULL
     AND to_regprocedure('public.video_date_promote_provider_overlap_v1(uuid, uuid, text, text, boolean)') IS NOT NULL THEN
    ALTER FUNCTION public.video_date_promote_provider_overlap_v1(uuid, uuid, text, text, boolean)
      RENAME TO vd_provider_overlap_stable_media_base;
  END IF;

  IF to_regprocedure('public.vd_provider_overlap_stable_media_base(uuid, uuid, text, text, boolean)') IS NULL THEN
    RAISE EXCEPTION 'missing provider-overlap promotion base for stable bilateral media gate';
  END IF;

  IF to_regprocedure('public.vd_auto_promote_stable_media_base(uuid, text, text)') IS NULL
     AND to_regprocedure('public.video_session_handshake_auto_promote_v2(uuid, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text)
      RENAME TO vd_auto_promote_stable_media_base;
  END IF;

  IF to_regprocedure('public.vd_auto_promote_stable_media_base(uuid, text, text)') IS NULL THEN
    RAISE EXCEPTION 'missing auto-promote base for stable bilateral media gate';
  END IF;

  IF to_regprocedure('public.vd_promote_ce_stable_media_base(uuid, uuid, text, text, boolean)') IS NULL
     AND to_regprocedure('public.video_date_promote_confirmed_encounter_v1(uuid, uuid, text, text, boolean)') IS NOT NULL THEN
    ALTER FUNCTION public.video_date_promote_confirmed_encounter_v1(uuid, uuid, text, text, boolean)
      RENAME TO vd_promote_ce_stable_media_base;
  END IF;

  IF to_regprocedure('public.vd_promote_ce_stable_media_base(uuid, uuid, text, text, boolean)') IS NULL THEN
    RAISE EXCEPTION 'missing confirmed-encounter promotion base for stable bilateral media gate';
  END IF;
END
$$;

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
    v_payload := v_eligibility || jsonb_build_object(
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

    RETURN v_payload;
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

  RETURN COALESCE(public.vd_provider_overlap_stable_media_base(
    p_session_id,
    p_actor,
    p_source,
    p_reason,
    p_require_participant
  ), '{}'::jsonb) || jsonb_build_object(
    'lifecycle_eligibility_checked', true,
    'stable_bilateral_media_gate_checked', true,
    'stable_bilateral_media_gate', v_gate
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

  RETURN COALESCE(public.vd_promote_ce_stable_media_base(
    p_session_id,
    v_effective_actor,
    p_source,
    p_reason,
    v_require_participant
  ), '{}'::jsonb) || jsonb_build_object(
    'stable_bilateral_media_gate_checked', true,
    'stable_bilateral_media_gate', v_gate
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
BEGIN
  RETURN COALESCE(public.vd_auto_promote_stable_media_base(
    p_session_id,
    p_idempotency_key,
    p_request_hash
  ), '{}'::jsonb) || jsonb_build_object(
    'stable_bilateral_media_gate_checked', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_stable_bilateral_media_gate_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_stable_bilateral_media_gate_v1(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.vd_provider_overlap_stable_media_base(uuid, uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_provider_overlap_stable_media_base(uuid, uuid, text, text, boolean)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_date_promote_provider_overlap_v1(uuid, uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_promote_provider_overlap_v1(uuid, uuid, text, text, boolean)
  TO service_role;

REVOKE ALL ON FUNCTION public.vd_promote_ce_stable_media_base(uuid, uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_promote_ce_stable_media_base(uuid, uuid, text, text, boolean)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_date_promote_confirmed_encounter_v1(uuid, uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_promote_confirmed_encounter_v1(uuid, uuid, text, text, boolean)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.vd_auto_promote_stable_media_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_auto_promote_stable_media_base(uuid, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_stable_bilateral_media_gate_v1(uuid) IS
  'Returns true only when a Video Date has already started or has stable bilateral media proof: fresh provider-backed owner heartbeat overlap or bilateral render-bound remote-seen evidence.';

COMMENT ON FUNCTION public.video_date_promote_provider_overlap_v1(uuid, uuid, text, text, boolean) IS
  'Provider-overlap promotion wrapper that preserves lifecycle eligibility and blocks date start until stable bilateral media proof exists.';

COMMENT ON FUNCTION public.video_date_promote_confirmed_encounter_v1(uuid, uuid, text, text, boolean) IS
  'Confirmed-encounter promotion wrapper that keeps caller binding and blocks date start until stable bilateral media proof exists.';

COMMIT;
