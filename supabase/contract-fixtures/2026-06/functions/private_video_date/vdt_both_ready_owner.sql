CREATE OR REPLACE FUNCTION private_video_date.vdt_both_ready_owner(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_action text := lower(COALESCE(NULLIF(btrim(p_action), ''), ''));
  v_actionability jsonb;
  v_result jsonb;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  IF v_action = 'prepare_entry' THEN
    v_actionability := public.video_date_ready_gate_actionability_v1(
      p_session_id,
      v_actor,
      'video_date_transition.prepare_entry',
      false,
      true,
      true,
      true
    );

    IF lower(COALESCE(v_actionability ->> 'ok', 'false')) NOT IN ('true', 't', '1', 'yes') THEN
      RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'video_date_transition',
        v_actionability
          - 'sqlstate'
          - 'message'
          - 'detail'
          - 'hint'
          - 'context'
          || jsonb_build_object(
            'ok', false,
            'success', false,
            'action', 'prepare_entry',
            'code', COALESCE(v_actionability ->> 'code', v_actionability ->> 'error_code', 'READY_GATE_NOT_ACTIONABLE'),
            'error_code', COALESCE(v_actionability ->> 'error_code', v_actionability ->> 'code', 'READY_GATE_NOT_ACTIONABLE'),
            'error', COALESCE(v_actionability ->> 'error', 'ready_gate_not_actionable'),
            'reason', COALESCE(v_actionability ->> 'reason', 'ready_gate_not_actionable')
          )
      );
    END IF;
  END IF;

  v_result := private_video_date.vdt_partial_ready_gate(
    p_session_id,
    p_action,
    p_reason
  );

  RETURN v_result || jsonb_build_object('ready_gate_actionability_checked', v_action = 'prepare_entry');
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    RETURN public.video_date_lifecycle_exception_payload_v2(
      p_session_id,
      v_actor,
      'video_date_transition.partial_ready_closure',
      'video_date_transition_failed',
      'VIDEO_DATE_TRANSITION_FAILED',
      true,
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    );
END;
$function$
