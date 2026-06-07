-- Video Date Daily owner definitive recovery.
--
-- The provider-overlap promotion migration intentionally replaced the public
-- Daily alive/joined RPCs, but that also made it the outermost layer after the
-- 20260607155414 lifecycle fail-soft wrappers. Re-establish a final public
-- fail-soft layer for web, mobile web, and native without removing the provider
-- overlap behavior underneath.

BEGIN;

CREATE OR REPLACE FUNCTION public.video_date_lifecycle_rpc_exception_observability_v1(
  p_session_id uuid,
  p_actor_id uuid,
  p_rpc text,
  p_sqlstate text,
  p_message text DEFAULT NULL,
  p_detail text DEFAULT NULL,
  p_hint text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_event_id uuid := NULL;
BEGIN
  SELECT vs.event_id
  INTO v_event_id
  FROM public.video_sessions vs
  WHERE vs.id = p_session_id;

  PERFORM public.record_event_loop_observability(
    COALESCE(NULLIF(btrim(p_rpc), ''), 'video_date_lifecycle_rpc'),
    'error',
    'lifecycle_rpc_exception',
    NULL,
    v_event_id,
    p_actor_id,
    p_session_id,
    jsonb_build_object(
      'rpc', p_rpc,
      'sqlstate', p_sqlstate,
      'message', p_message,
      'detail', NULLIF(p_detail, ''),
      'hint', NULLIF(p_hint, '')
    )
  );
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_lifecycle_rpc_exception_observability_v1(
  uuid, uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_lifecycle_rpc_exception_observability_v1(
  uuid, uuid, text, text, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.video_date_lifecycle_safe_failsoft_payload_v1(
  p_session_id uuid,
  p_actor_id uuid,
  p_rpc text,
  p_error text,
  p_code text,
  p_retryable boolean DEFAULT true,
  p_sqlstate text DEFAULT NULL,
  p_message text DEFAULT NULL,
  p_detail text DEFAULT NULL,
  p_hint text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_retryable boolean := COALESCE(p_retryable, true);
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  BEGIN
    RETURN public.video_date_lifecycle_failsoft_payload_v1(
      p_session_id,
      p_actor_id,
      p_rpc,
      p_error,
      p_code,
      p_retryable,
      p_sqlstate,
      p_message,
      p_detail,
      p_hint
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;
      PERFORM public.video_date_lifecycle_rpc_exception_observability_v1(
        p_session_id,
        p_actor_id,
        COALESCE(NULLIF(btrim(p_rpc), ''), 'video_date_lifecycle_rpc') || '.failsoft_payload',
        SQLSTATE,
        v_message,
        v_detail,
        v_hint
      );
      v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
      -- The raw exception detail stays in server observability above. This
      -- last-resort client payload is intentionally small and sanitized.
      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', COALESCE(NULLIF(btrim(p_error), ''), 'lifecycle_rpc_failed'),
        'code', COALESCE(NULLIF(btrim(p_code), ''), 'LIFECYCLE_RPC_FAILED'),
        'error_code', COALESCE(NULLIF(btrim(p_code), ''), 'LIFECYCLE_RPC_FAILED'),
        'rpc', p_rpc,
        'sqlstate', p_sqlstate,
        'retryable', v_retryable,
        'retry_after_ms', CASE WHEN v_retryable THEN 1500 ELSE NULL END,
        'server_now_ms', v_server_now_ms,
        'serverNowMs', v_server_now_ms,
        'session_id', p_session_id,
        'fallback_payload_builder_failed', true,
        'fallback_sqlstate', SQLSTATE
      );
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_lifecycle_safe_failsoft_payload_v1(
  uuid, uuid, text, text, text, boolean, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_lifecycle_safe_failsoft_payload_v1(
  uuid, uuid, text, text, text, boolean, text, text, text, text
) TO service_role;

DO $$
BEGIN
  IF to_regprocedure('public.mark_video_date_daily_alive_20260607222923_definitive_base(uuid, text, text, text, text, text)') IS NULL
     AND to_regprocedure('public.mark_video_date_daily_alive(uuid, text, text, text, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text)
      RENAME TO mark_video_date_daily_alive_20260607222923_definitive_base;
  END IF;

  IF to_regprocedure('public.mark_video_date_daily_joined_20260607222923_definitive_base(uuid, text, text, text, text, text)') IS NULL
     AND to_regprocedure('public.mark_video_date_daily_joined(uuid, text, text, text, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text)
      RENAME TO mark_video_date_daily_joined_20260607222923_definitive_base;
  END IF;

  IF to_regprocedure('public.video_date_transition_20260607222923_definitive_base(uuid, text, text)') IS NULL
     AND to_regprocedure('public.video_date_transition(uuid, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.video_date_transition(uuid, text, text)
      RENAME TO video_date_transition_20260607222923_definitive_base;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_alive_20260607222923_definitive_base(
  uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_alive_20260607222923_definitive_base(
  uuid, text, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_joined_20260607222923_definitive_base(
  uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_joined_20260607222923_definitive_base(
  uuid, text, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.video_date_transition_20260607222923_definitive_base(
  uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_transition_20260607222923_definitive_base(
  uuid, text, text
) TO service_role;

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
  RETURN public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
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
    -- Raw exception text is captured in observability above; authenticated
    -- clients only need stable code/retry/terminal context.
    RETURN public.video_date_lifecycle_safe_failsoft_payload_v1(
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
  RETURN public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
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
    -- Raw exception text is captured in observability above; authenticated
    -- clients only need stable code/retry/terminal context.
    RETURN public.video_date_lifecycle_safe_failsoft_payload_v1(
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
  RETURN public.video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result);
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
    -- Raw exception text is captured in observability above; authenticated
    -- clients only need stable code/retry/terminal context.
    RETURN public.video_date_lifecycle_safe_failsoft_payload_v1(
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

COMMENT ON FUNCTION public.video_date_lifecycle_rpc_exception_observability_v1(
  uuid, uuid, text, text, text, text, text
) IS
  'Best-effort exception telemetry for final Video Date lifecycle RPC wrappers.';
COMMENT ON FUNCTION public.video_date_lifecycle_safe_failsoft_payload_v1(
  uuid, uuid, text, text, text, boolean, text, text, text, text
) IS
  'Never-raise fallback wrapper around the richer Video Date lifecycle fail-soft payload builder.';
COMMENT ON FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text) IS
  'Final outermost fail-soft wrapper around provider-backed Daily alive heartbeats and provider-overlap promotion.';
COMMENT ON FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text) IS
  'Final outermost fail-soft wrapper around provider-backed Daily joined confirmation and provider-overlap promotion.';
COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Final outermost fail-soft wrapper around Video Date lifecycle transitions with exception telemetry.';

NOTIFY pgrst, 'reload schema';

COMMIT;
