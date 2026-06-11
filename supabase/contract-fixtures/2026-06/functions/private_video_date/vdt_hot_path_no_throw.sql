CREATE OR REPLACE FUNCTION private_video_date.vdt_hot_path_no_throw(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
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

  v_result := private_video_date.vdt_active_entry_failsoft(
    p_session_id,
    p_action,
    p_reason
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'active_entry_failsoft_shell', true
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;

    BEGIN
      RETURN public.video_date_lifecycle_exception_payload_v2(
        p_session_id,
        v_actor,
        'video_date_transition.active_entry_shell',
        'video_date_transition_failed',
        'VIDEO_DATE_TRANSITION_FAILED',
        true,
        SQLSTATE,
        v_message,
        v_detail,
        v_hint
      ) || jsonb_build_object(
        'active_entry_failsoft_shell', true
      );
    EXCEPTION
      WHEN OTHERS THEN
        RETURN jsonb_build_object(
          'ok', false,
          'success', false,
          'session_id', p_session_id,
          'error', 'video_date_transition_failed',
          'reason', 'video_date_transition_failed',
          'code', 'VIDEO_DATE_TRANSITION_FAILED',
          'error_code', 'VIDEO_DATE_TRANSITION_FAILED',
          'retryable', true,
          'terminal', false,
          'active_entry_failsoft_shell', true,
          'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
          'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
        );
    END;
END;
$function$
