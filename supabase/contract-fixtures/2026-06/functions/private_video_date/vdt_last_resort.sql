CREATE OR REPLACE FUNCTION private_video_date.vdt_last_resort(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  v_result := private_video_date.vdt_definitive_owner(
    p_session_id,
    p_action,
    p_reason
  );
  v_result := public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
  RETURN public.video_date_lifecycle_sanitize_client_failsoft_payload_v1(v_result);
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    PERFORM public.video_date_lifecycle_rpc_exception_observability_v1(
      p_session_id,
      v_actor,
      'video_date_transition',
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    );
    RETURN public.video_date_lifecycle_sanitize_client_failsoft_payload_v1(
      public.video_date_lifecycle_safe_failsoft_payload_v1(
        p_session_id,
        v_actor,
        'video_date_transition',
        'video_date_transition_failed',
        'VIDEO_DATE_TRANSITION_FAILED',
        true,
        SQLSTATE,
        NULL,
        NULL,
        NULL
      )
    );
END;
$function$
