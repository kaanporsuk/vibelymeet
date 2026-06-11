CREATE OR REPLACE FUNCTION public.mark_video_date_daily_alive(p_session_id uuid, p_owner_id text DEFAULT NULL::text, p_call_instance_id text DEFAULT NULL::text, p_provider_session_id text DEFAULT NULL::text, p_entry_attempt_id text DEFAULT NULL::text, p_owner_state text DEFAULT NULL::text)
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
    v_result := public.vd_daily_alive_20260609130139_hot_base(
      p_session_id,
      p_owner_id,
      p_call_instance_id,
      p_provider_session_id,
      p_entry_attempt_id,
      p_owner_state
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
          'mark_video_date_daily_alive.hot_path_shell',
          'daily_alive_failed',
          'DAILY_ALIVE_FAILED',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        ) || jsonb_build_object(
          'hot_path_no_throw_shell', true,
          'active_entry_failsoft_shell', true,
          'provider_presence_required', true,
          'provider_backed_current', false,
          'provider_presence_missing', true
        );
      EXCEPTION
        WHEN OTHERS THEN
          RETURN jsonb_build_object(
            'ok', false,
            'success', false,
            'session_id', p_session_id,
            'rpc', 'mark_video_date_daily_alive',
            'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
            'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
            'provider_session_id', NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), ''),
            'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
            'owner_state', COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, '')), 80), ''), 'unknown'),
            'error', 'daily_alive_failed',
            'reason', 'daily_alive_failed',
            'code', 'DAILY_ALIVE_FAILED',
            'error_code', 'DAILY_ALIVE_FAILED',
            'retryable', true,
            'terminal', false,
            'provider_presence_required', true,
            'provider_backed_current', false,
            'provider_presence_missing', true,
            'join_stamp_accepted', false,
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
      'rpc', 'mark_video_date_daily_alive',
      'owner_id', NULLIF(left(btrim(COALESCE(p_owner_id, '')), 180), ''),
      'call_instance_id', NULLIF(left(btrim(COALESCE(p_call_instance_id, '')), 180), ''),
      'provider_session_id', NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), ''),
      'entry_attempt_id', NULLIF(left(btrim(COALESCE(p_entry_attempt_id, '')), 180), ''),
      'owner_state', COALESCE(NULLIF(left(btrim(COALESCE(p_owner_state, '')), 80), ''), 'unknown'),
      'error', 'daily_alive_failed',
      'reason', 'daily_alive_failed',
      'code', 'DAILY_ALIVE_FAILED',
      'error_code', 'DAILY_ALIVE_FAILED',
      'retryable', true,
      'terminal', false,
      'provider_presence_required', true,
      'provider_backed_current', false,
      'provider_presence_missing', true,
      'join_stamp_accepted', false,
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
