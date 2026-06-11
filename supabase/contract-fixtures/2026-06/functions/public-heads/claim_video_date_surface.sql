CREATE OR REPLACE FUNCTION public.claim_video_date_surface(p_session_id uuid, p_surface text, p_client_instance_id text, p_takeover boolean DEFAULT false, p_ttl_seconds integer DEFAULT 12)
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
    v_result := public.vd_claim_surface_20260609130139_hot_base(
      p_session_id,
      p_surface,
      p_client_instance_id,
      p_takeover,
      p_ttl_seconds
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
          'claim_video_date_surface.hot_path_shell',
          'surface_claim_failed',
          'SURFACE_CLAIM_FAILED',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        ) || jsonb_build_object(
          'hot_path_no_throw_shell', true,
          'active_entry_failsoft_shell', true
        );
      EXCEPTION
        WHEN OTHERS THEN
          RETURN jsonb_build_object(
            'ok', false,
            'success', false,
            'session_id', p_session_id,
            'rpc', 'claim_video_date_surface',
            'surface', left(btrim(COALESCE(p_surface, '')), 80),
            'client_instance_id', NULLIF(left(btrim(COALESCE(p_client_instance_id, '')), 180), ''),
            'error', 'surface_claim_failed',
            'reason', 'surface_claim_failed',
            'code', 'SURFACE_CLAIM_FAILED',
            'error_code', 'SURFACE_CLAIM_FAILED',
            'retryable', true,
            'terminal', false,
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
      'rpc', 'claim_video_date_surface',
      'surface', left(btrim(COALESCE(p_surface, '')), 80),
      'client_instance_id', NULLIF(left(btrim(COALESCE(p_client_instance_id, '')), 180), ''),
      'error', 'surface_claim_failed',
      'reason', 'surface_claim_failed',
      'code', 'SURFACE_CLAIM_FAILED',
      'error_code', 'SURFACE_CLAIM_FAILED',
      'retryable', true,
      'terminal', false,
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
