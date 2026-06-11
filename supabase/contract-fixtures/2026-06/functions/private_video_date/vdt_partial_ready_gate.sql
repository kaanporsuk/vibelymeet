CREATE OR REPLACE FUNCTION private_video_date.vdt_partial_ready_gate(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := NULL;
  v_result jsonb;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  BEGIN
    v_result := private_video_date.vdt_last_resort(
      p_session_id,
      p_action,
      p_reason
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;
      RETURN public.video_date_lifecycle_exception_payload_v2(
        p_session_id,
        v_actor,
        'video_date_transition',
        'video_date_transition_failed',
        'VIDEO_DATE_TRANSITION_FAILED',
        true,
        SQLSTATE,
        v_message,
        v_detail,
        v_hint
      );
  END;

  RETURN public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
    p_session_id,
    v_actor,
    'video_date_transition',
    v_result
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    RETURN public.video_date_lifecycle_exception_payload_v2(
      p_session_id,
      v_actor,
      'video_date_transition',
      'video_date_transition_wrapper_failed',
      'VIDEO_DATE_TRANSITION_WRAPPER_FAILED',
      true,
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    );
END;
$function$
