CREATE OR REPLACE FUNCTION public.video_session_mark_ready_v2(p_session_id uuid, p_idempotency_key text DEFAULT NULL::text, p_request_hash text DEFAULT NULL::text)
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
    v_result := public.vd_mark_ready_20260609130139_hot_base(
      p_session_id,
      p_idempotency_key,
      p_request_hash
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
          'video_session_mark_ready_v2.hot_path_shell',
          'mark_ready_unavailable',
          'MARK_READY_UNAVAILABLE',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        ) || jsonb_build_object(
          'hot_path_no_throw_shell', true,
          'active_entry_failsoft_shell', true,
          'commandStatus', 'rejected'
        );
      EXCEPTION
        WHEN OTHERS THEN
          RETURN jsonb_build_object(
            'ok', false,
            'success', false,
            'session_id', p_session_id,
            'rpc', 'video_session_mark_ready_v2',
            'error', 'mark_ready_unavailable',
            'reason', 'mark_ready_unavailable',
            'code', 'MARK_READY_UNAVAILABLE',
            'error_code', 'MARK_READY_UNAVAILABLE',
            'retryable', true,
            'terminal', false,
            'commandStatus', 'rejected',
            'hot_path_no_throw_shell', true,
            'active_entry_failsoft_shell', true,
            'last_resort_payload', true,
            'sqlstate', SQLSTATE,
            'sql_message', left(COALESCE(v_message, ''), 500),
            'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
            'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
          );
      END;
  END;

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'hot_path_no_throw_shell', true
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;

    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', p_session_id,
      'rpc', 'video_session_mark_ready_v2',
      'error', 'mark_ready_unavailable',
      'reason', 'mark_ready_unavailable',
      'code', 'MARK_READY_UNAVAILABLE',
      'error_code', 'MARK_READY_UNAVAILABLE',
      'retryable', true,
      'terminal', false,
      'commandStatus', 'rejected',
      'hot_path_no_throw_shell', true,
      'active_entry_failsoft_shell', true,
      'last_resort_payload', true,
      'outer_last_resort_payload', true,
      'sqlstate', SQLSTATE,
      'sql_message', left(COALESCE(v_message, ''), 500),
      'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
      'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
    );
END;
$function$
