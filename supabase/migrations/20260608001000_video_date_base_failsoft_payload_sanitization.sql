-- Video Date lifecycle base fail-soft payload sanitization.
--
-- 20260607222923 sanitized exceptions thrown by the outer public wrappers, but
-- the renamed provider-overlap base RPCs can also return fail-soft JSON from
-- their own EXCEPTION blocks. Sanitize those base-returned client payloads too
-- without rewriting the already-applied migration history.

BEGIN;

CREATE OR REPLACE FUNCTION public.video_date_lifecycle_sanitize_client_failsoft_payload_v1(
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_has_failure_shape boolean;
BEGIN
  v_has_failure_shape :=
    v_payload ? 'ok'
    OR v_payload ? 'success'
    OR v_payload ? 'error'
    OR v_payload ? 'code'
    OR v_payload ? 'error_code';

  IF NOT v_has_failure_shape THEN
    RETURN v_payload;
  END IF;

  IF public.video_date_lifecycle_jsonb_true_v1(v_payload, 'ok')
     OR public.video_date_lifecycle_jsonb_true_v1(v_payload, 'success') THEN
    RETURN v_payload;
  END IF;

  -- Client retry/terminal semantics stay intact. Raw database diagnostics stay
  -- server-side in lifecycle_rpc_exception observability rows.
  RETURN v_payload
    - 'message'
    - 'detail'
    - 'hint'
    - 'fallback_message'
    - 'fallback_detail'
    - 'fallback_hint';
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_lifecycle_sanitize_client_failsoft_payload_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_lifecycle_sanitize_client_failsoft_payload_v1(jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.mark_video_date_daily_alive(
  p_session_id uuid,
  p_owner_id text DEFAULT NULL,
  p_call_instance_id text DEFAULT NULL,
  p_provider_session_id text DEFAULT NULL,
  p_entry_attempt_id text DEFAULT NULL,
  p_owner_state text DEFAULT NULL
)
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
  v_result := public.mark_video_date_daily_alive_20260607222923_definitive_base(
    p_session_id,
    p_owner_id,
    p_call_instance_id,
    p_provider_session_id,
    p_entry_attempt_id,
    p_owner_state
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
      'mark_video_date_daily_alive',
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    );
    RETURN public.video_date_lifecycle_sanitize_client_failsoft_payload_v1(
      public.video_date_lifecycle_safe_failsoft_payload_v1(
        p_session_id,
        v_actor,
        'mark_video_date_daily_alive',
        'daily_alive_stamp_failed',
        'DAILY_ALIVE_STAMP_FAILED',
        true,
        SQLSTATE,
        NULL,
        NULL,
        NULL
      )
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_video_date_daily_joined(
  p_session_id uuid,
  p_owner_id text DEFAULT NULL,
  p_call_instance_id text DEFAULT NULL,
  p_provider_session_id text DEFAULT NULL,
  p_entry_attempt_id text DEFAULT NULL,
  p_owner_state text DEFAULT NULL
)
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
  v_result := public.mark_video_date_daily_joined_20260607222923_definitive_base(
    p_session_id,
    p_owner_id,
    p_call_instance_id,
    p_provider_session_id,
    p_entry_attempt_id,
    p_owner_state
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
      'mark_video_date_daily_joined',
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    );
    RETURN public.video_date_lifecycle_sanitize_client_failsoft_payload_v1(
      public.video_date_lifecycle_safe_failsoft_payload_v1(
        p_session_id,
        v_actor,
        'mark_video_date_daily_joined',
        'daily_join_stamp_failed',
        'DAILY_JOIN_STAMP_FAILED',
        true,
        SQLSTATE,
        NULL,
        NULL,
        NULL
      )
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_transition(
  p_session_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
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
  v_result := public.video_date_transition_20260607222923_definitive_base(
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
$function$;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.video_date_transition(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_transition(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_lifecycle_sanitize_client_failsoft_payload_v1(jsonb) IS
  'Service-only helper that strips raw diagnostic message/detail/hint fields from fail-soft payloads before authenticated clients receive them.';

COMMENT ON FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text) IS
  'Video Date Daily owner alive heartbeat wrapper with provider-overlap delegation, lifecycle enrichment, and sanitized fail-soft client payloads.';

COMMENT ON FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text) IS
  'Video Date Daily joined wrapper with provider-overlap delegation, lifecycle enrichment, and sanitized fail-soft client payloads.';

COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Video Date lifecycle transition wrapper with definitive base delegation, lifecycle enrichment, and sanitized fail-soft client payloads.';

NOTIFY pgrst, 'reload schema';

COMMIT;
