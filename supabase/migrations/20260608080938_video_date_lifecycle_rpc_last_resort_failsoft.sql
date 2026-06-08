-- Video Date lifecycle RPC last-resort fail-soft shell.
--
-- The 2026-06-08 production attempt proved the backend could reach a real
-- provider-backed date, but the client still saw raw 500s from lifecycle RPCs
-- while route ownership was churning. Add one final wrapper layer for the
-- browser/native callable lifecycle RPCs. The layer preserves all existing
-- base behavior and guarantees a sanitized JSON payload if delegation,
-- enrichment, sanitization, or observability fails.

BEGIN;

CREATE OR REPLACE FUNCTION public.video_date_lifecycle_client_safe_payload_v2(
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
BEGIN
  BEGIN
    RETURN public.video_date_lifecycle_sanitize_client_failsoft_payload_v1(v_payload);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN v_payload
        - 'message'
        - 'detail'
        - 'hint'
        - 'fallback_message'
        - 'fallback_detail'
        - 'fallback_hint'
        - 'terminal_context_message'
        || jsonb_build_object('client_payload_sanitizer_failed', true);
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_lifecycle_last_resort_payload_v2(
  p_session_id uuid,
  p_actor_id uuid,
  p_rpc text,
  p_error text,
  p_code text,
  p_retryable boolean DEFAULT true,
  p_sqlstate text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_code text := COALESCE(NULLIF(btrim(p_code), ''), 'LIFECYCLE_RPC_FAILED');
  v_error text := COALESCE(NULLIF(btrim(p_error), ''), lower(v_code));
  v_retryable boolean := COALESCE(p_retryable, true);
  v_server_now_ms bigint;
BEGIN
  v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

  RETURN jsonb_build_object(
    'ok', false,
    'success', false,
    'error', v_error,
    'code', v_code,
    'error_code', v_code,
    'rpc', COALESCE(NULLIF(btrim(p_rpc), ''), 'video_date_lifecycle_rpc'),
    'sqlstate', p_sqlstate,
    'retryable', v_retryable,
    'retry_after_ms', CASE WHEN v_retryable THEN 1500 ELSE NULL END,
    'server_now_ms', v_server_now_ms,
    'serverNowMs', v_server_now_ms,
    'session_id', p_session_id,
    'actor_id', p_actor_id,
    'terminal_context_available', false,
    'session_ended', false,
    'terminal', false,
    'survey_required', false,
    'fallback_payload_builder_failed', true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_lifecycle_observe_exception_v2(
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
BEGIN
  BEGIN
    PERFORM public.video_date_lifecycle_rpc_exception_observability_v1(
      p_session_id,
      p_actor_id,
      p_rpc,
      p_sqlstate,
      p_message,
      p_detail,
      p_hint
    );
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_lifecycle_exception_payload_v2(
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
  v_payload jsonb;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  PERFORM public.video_date_lifecycle_observe_exception_v2(
    p_session_id,
    p_actor_id,
    p_rpc,
    p_sqlstate,
    p_message,
    p_detail,
    p_hint
  );

  BEGIN
    v_payload := public.video_date_lifecycle_safe_failsoft_payload_v1(
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
      PERFORM public.video_date_lifecycle_observe_exception_v2(
        p_session_id,
        p_actor_id,
        COALESCE(NULLIF(btrim(p_rpc), ''), 'video_date_lifecycle_rpc') || '.safe_failsoft',
        SQLSTATE,
        v_message,
        v_detail,
        v_hint
      );
      v_payload := public.video_date_lifecycle_last_resort_payload_v2(
        p_session_id,
        p_actor_id,
        p_rpc,
        p_error,
        p_code,
        p_retryable,
        p_sqlstate
      );
  END;

  RETURN public.video_date_lifecycle_client_safe_payload_v2(v_payload);
EXCEPTION
  WHEN OTHERS THEN
    RETURN public.video_date_lifecycle_last_resort_payload_v2(
      p_session_id,
      p_actor_id,
      p_rpc,
      p_error,
      p_code,
      p_retryable,
      SQLSTATE
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
  p_session_id uuid,
  p_actor_id uuid,
  p_rpc text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  BEGIN
    v_payload := public.video_date_enrich_lifecycle_payload_v1(
      p_session_id,
      p_actor_id,
      v_payload
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;
      PERFORM public.video_date_lifecycle_observe_exception_v2(
        p_session_id,
        p_actor_id,
        COALESCE(NULLIF(btrim(p_rpc), ''), 'video_date_lifecycle_rpc') || '.enrich',
        SQLSTATE,
        v_message,
        v_detail,
        v_hint
      );
      v_payload :=
        public.video_date_lifecycle_last_resort_payload_v2(
          p_session_id,
          p_actor_id,
          p_rpc,
          'lifecycle_enrich_failed',
          'LIFECYCLE_ENRICH_FAILED',
          true,
          SQLSTATE
        )
        || v_payload
        || jsonb_build_object('enrichment_failed', true);
  END;

  RETURN public.video_date_lifecycle_client_safe_payload_v2(v_payload);
EXCEPTION
  WHEN OTHERS THEN
    RETURN public.video_date_lifecycle_last_resort_payload_v2(
      p_session_id,
      p_actor_id,
      p_rpc,
      'lifecycle_payload_failed',
      'LIFECYCLE_PAYLOAD_FAILED',
      true,
      SQLSTATE
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_lifecycle_client_safe_payload_v2(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_lifecycle_client_safe_payload_v2(jsonb)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_date_lifecycle_last_resort_payload_v2(
  uuid, uuid, text, text, text, boolean, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_lifecycle_last_resort_payload_v2(
  uuid, uuid, text, text, text, boolean, text
) TO service_role;

REVOKE ALL ON FUNCTION public.video_date_lifecycle_observe_exception_v2(
  uuid, uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_lifecycle_observe_exception_v2(
  uuid, uuid, text, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.video_date_lifecycle_exception_payload_v2(
  uuid, uuid, text, text, text, boolean, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_lifecycle_exception_payload_v2(
  uuid, uuid, text, text, text, boolean, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
  uuid, uuid, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
  uuid, uuid, text, jsonb
) TO service_role;

DO $$
BEGIN
  IF to_regprocedure('public.claim_video_date_surface_20260608080938_last_resort_base(uuid, text, text, boolean, integer)') IS NULL
     AND to_regprocedure('public.claim_video_date_surface(uuid, text, text, boolean, integer)') IS NOT NULL THEN
    ALTER FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer)
      RENAME TO claim_video_date_surface_20260608080938_last_resort_base;
  END IF;

  IF to_regprocedure('public.mark_video_date_daily_alive_20260608080938_last_resort_base(uuid, text, text, text, text, text)') IS NULL
     AND to_regprocedure('public.mark_video_date_daily_alive(uuid, text, text, text, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text)
      RENAME TO mark_video_date_daily_alive_20260608080938_last_resort_base;
  END IF;

  IF to_regprocedure('public.mark_video_date_daily_joined_20260608080938_last_resort_base(uuid, text, text, text, text, text)') IS NULL
     AND to_regprocedure('public.mark_video_date_daily_joined(uuid, text, text, text, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text)
      RENAME TO mark_video_date_daily_joined_20260608080938_last_resort_base;
  END IF;

  IF to_regprocedure('public.video_date_transition_20260608080938_last_resort_base(uuid, text, text)') IS NULL
     AND to_regprocedure('public.video_date_transition(uuid, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.video_date_transition(uuid, text, text)
      RENAME TO video_date_transition_20260608080938_last_resort_base;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.claim_video_date_surface_20260608080938_last_resort_base(
  uuid, text, text, boolean, integer
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_video_date_surface_20260608080938_last_resort_base(
  uuid, text, text, boolean, integer
) TO service_role;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_alive_20260608080938_last_resort_base(
  uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_alive_20260608080938_last_resort_base(
  uuid, text, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_joined_20260608080938_last_resort_base(
  uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_joined_20260608080938_last_resort_base(
  uuid, text, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.video_date_transition_20260608080938_last_resort_base(
  uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_transition_20260608080938_last_resort_base(
  uuid, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_video_date_surface(
  p_session_id uuid,
  p_surface text,
  p_client_instance_id text,
  p_takeover boolean DEFAULT false,
  p_ttl_seconds integer DEFAULT 12
)
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
    v_result := public.claim_video_date_surface_20260608080938_last_resort_base(
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
      RETURN public.video_date_lifecycle_exception_payload_v2(
        p_session_id,
        v_actor,
        'claim_video_date_surface',
        'surface_claim_failed',
        'SURFACE_CLAIM_FAILED',
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
    'claim_video_date_surface',
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
      'claim_video_date_surface',
      'surface_claim_wrapper_failed',
      'SURFACE_CLAIM_WRAPPER_FAILED',
      true,
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    );
END;
$function$;

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
    v_result := public.mark_video_date_daily_alive_20260608080938_last_resort_base(
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
      RETURN public.video_date_lifecycle_exception_payload_v2(
        p_session_id,
        v_actor,
        'mark_video_date_daily_alive',
        'daily_alive_stamp_failed',
        'DAILY_ALIVE_STAMP_FAILED',
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
    'mark_video_date_daily_alive',
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
      'mark_video_date_daily_alive',
      'daily_alive_wrapper_failed',
      'DAILY_ALIVE_WRAPPER_FAILED',
      true,
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
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
    v_result := public.mark_video_date_daily_joined_20260608080938_last_resort_base(
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
      RETURN public.video_date_lifecycle_exception_payload_v2(
        p_session_id,
        v_actor,
        'mark_video_date_daily_joined',
        'daily_join_stamp_failed',
        'DAILY_JOIN_STAMP_FAILED',
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
    'mark_video_date_daily_joined',
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
      'mark_video_date_daily_joined',
      'daily_join_wrapper_failed',
      'DAILY_JOIN_WRAPPER_FAILED',
      true,
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
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
    v_result := public.video_date_transition_20260608080938_last_resort_base(
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
$function$;

REVOKE ALL ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer)
  TO authenticated, service_role;

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

COMMENT ON FUNCTION public.video_date_lifecycle_client_safe_payload_v2(jsonb) IS
  'Last-resort client sanitizer for Video Date lifecycle RPC payloads. Never exposes raw message/detail/hint diagnostics.';
COMMENT ON FUNCTION public.video_date_lifecycle_last_resort_payload_v2(uuid, uuid, text, text, text, boolean, text) IS
  'Minimal JSON fallback returned when Video Date lifecycle fail-soft builders themselves fail.';
COMMENT ON FUNCTION public.video_date_lifecycle_observe_exception_v2(uuid, uuid, text, text, text, text, text) IS
  'Exception-safe observability shim for Video Date lifecycle RPC wrapper failures.';
COMMENT ON FUNCTION public.video_date_lifecycle_exception_payload_v2(uuid, uuid, text, text, text, boolean, text, text, text, text) IS
  'Builds sanitized fail-soft JSON for Video Date lifecycle RPC exceptions with last-resort fallback.';
COMMENT ON FUNCTION public.video_date_lifecycle_enrich_and_sanitize_payload_v2(uuid, uuid, text, jsonb) IS
  'Enriches successful Video Date lifecycle RPC payloads and downgrades enrichment failures into sanitized JSON.';
COMMENT ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer) IS
  'Final public fail-soft shell for Video Date surface ownership; delegates to the prior wrapper stack.';
COMMENT ON FUNCTION public.mark_video_date_daily_alive(uuid, text, text, text, text, text) IS
  'Final public fail-soft shell for provider-backed Video Date Daily alive heartbeats; delegates to the prior wrapper stack.';
COMMENT ON FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text) IS
  'Final public fail-soft shell for provider-backed Video Date Daily joined confirmation; delegates to the prior wrapper stack.';
COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Final public fail-soft shell for Video Date lifecycle transitions; delegates to the prior wrapper stack.';

NOTIFY pgrst, 'reload schema';

COMMIT;
