CREATE OR REPLACE FUNCTION private_video_date.vdt_routeable_entry(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  RETURN private_video_date.vdt_single_owner(
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
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'video_date_transition_failed',
      'reason', 'video_date_transition_failed',
      'code', 'VIDEO_DATE_TRANSITION_FAILED',
      'error_code', 'VIDEO_DATE_TRANSITION_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'detail', NULLIF(v_detail, ''),
      'hint', NULLIF(v_hint, ''),
      'retryable', SQLSTATE IS DISTINCT FROM '42501',
      'retry_after_ms', 1500,
      'retry_after_seconds', 2,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$
