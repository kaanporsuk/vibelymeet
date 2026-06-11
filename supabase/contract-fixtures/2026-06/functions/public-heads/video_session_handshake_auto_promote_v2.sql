CREATE OR REPLACE FUNCTION public.video_session_handshake_auto_promote_v2(p_session_id uuid, p_idempotency_key text DEFAULT NULL::text, p_request_hash text DEFAULT NULL::text)
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
$function$
