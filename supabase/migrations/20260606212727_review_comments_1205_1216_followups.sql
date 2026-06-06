-- Corrective follow-ups for unresolved Codex review threads across PR #1205-#1216.
-- These replace live public functions instead of editing already-applied migration history.

BEGIN;

CREATE OR REPLACE FUNCTION public.video_date_promote_confirmed_encounter_v1(
  p_session_id uuid,
  p_actor uuid DEFAULT NULL,
  p_source text DEFAULT 'video_date_promote_confirmed_encounter_v1',
  p_reason text DEFAULT NULL,
  p_require_participant boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_session public.video_sessions%ROWTYPE;
  v_auth_actor uuid := auth.uid();
  v_effective_actor uuid;
  v_require_participant boolean := COALESCE(p_require_participant, false);
  v_is_service_role boolean := auth.role() = 'service_role';
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_id_required');
  END IF;

  IF v_is_service_role THEN
    v_effective_actor := COALESCE(p_actor, v_auth_actor);
  ELSE
    IF v_auth_actor IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
    END IF;

    IF p_actor IS NOT NULL AND p_actor IS DISTINCT FROM v_auth_actor THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'actor_mismatch');
    END IF;

    v_effective_actor := v_auth_actor;
    v_require_participant := true;
  END IF;

  IF v_require_participant THEN
    IF v_effective_actor IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
    END IF;

    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'session_not_found');
    END IF;

    IF v_effective_actor IS DISTINCT FROM v_session.participant_1_id
       AND v_effective_actor IS DISTINCT FROM v_session.participant_2_id THEN
      RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_participant');
    END IF;
  END IF;

  RETURN public.vd_promote_ce_auth_20260605221535_base(
    p_session_id,
    v_effective_actor,
    p_source,
    p_reason,
    v_require_participant
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_promote_confirmed_encounter_v1(uuid, uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_promote_confirmed_encounter_v1(uuid, uuid, text, text, boolean)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_promote_confirmed_encounter_v1(uuid, uuid, text, text, boolean) IS
  'Caller-bound confirmed-encounter promotion wrapper. Authenticated callers are bound to auth.uid() and participant-checked before privileged room repair delegation.';

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
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_result_code text;
  v_ok boolean;
  v_blocked boolean;
  v_retryable boolean;
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  v_result := public.claim_video_date_surface_20260605232304_single_owner_base(
    p_session_id,
    p_surface,
    p_client_instance_id,
    p_takeover,
    p_ttl_seconds
  );
  v_result_code := public.video_date_client_stuck_safe_text(
    COALESCE(v_result->>'code', v_result->>'error_code', v_result->>'error', v_result->>'reason'),
    120
  );
  v_ok := CASE lower(COALESCE(v_result->>'ok', v_result->>'success', ''))
    WHEN 'true' THEN true
    WHEN 'false' THEN false
    ELSE NULL
  END;
  v_blocked := CASE lower(COALESCE(v_result->>'blocked', ''))
    WHEN 'true' THEN true
    WHEN 'false' THEN false
    ELSE CASE
      WHEN v_result_code = 'SURFACE_CLAIM_CONFLICT' THEN true
      ELSE NULL
    END
  END;
  v_retryable := CASE lower(COALESCE(v_result->>'retryable', ''))
    WHEN 'true' THEN true
    WHEN 'false' THEN false
    ELSE NULL
  END;

  BEGIN
    INSERT INTO public.video_date_surface_claim_events (
      session_id,
      actor_id,
      surface,
      client_instance_id,
      action,
      takeover,
      ttl_seconds,
      ok,
      blocked,
      retryable,
      result_code,
      detail
    ) VALUES (
      p_session_id,
      v_actor,
      public.video_date_client_stuck_safe_text(p_surface, 80),
      public.video_date_client_stuck_safe_text(p_client_instance_id, 160),
      'claim',
      COALESCE(p_takeover, false),
      CASE
        WHEN p_ttl_seconds IS NULL THEN NULL
        ELSE LEAST(3600, GREATEST(1, p_ttl_seconds))
      END,
      v_ok,
      v_blocked,
      v_retryable,
      v_result_code,
      jsonb_strip_nulls(jsonb_build_object(
        'result', v_result,
        'source', 'claim_video_date_surface',
        'ok_source', CASE
          WHEN v_result ? 'ok' THEN 'ok'
          WHEN v_result ? 'success' THEN 'success'
          ELSE NULL
        END,
        'blocked_source', CASE
          WHEN v_result ? 'blocked' THEN 'blocked'
          WHEN v_result_code = 'SURFACE_CLAIM_CONFLICT' THEN 'code'
          ELSE NULL
        END
      ))
    );
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

    BEGIN
      INSERT INTO public.video_date_surface_claim_events (
        session_id,
        actor_id,
        surface,
        client_instance_id,
        action,
        takeover,
        ttl_seconds,
        ok,
        blocked,
        retryable,
        result_code,
        detail
      ) VALUES (
        p_session_id,
        v_actor,
        public.video_date_client_stuck_safe_text(p_surface, 80),
        public.video_date_client_stuck_safe_text(p_client_instance_id, 160),
        'claim_exception',
        COALESCE(p_takeover, false),
        CASE
          WHEN p_ttl_seconds IS NULL THEN NULL
          ELSE LEAST(3600, GREATEST(1, p_ttl_seconds))
        END,
        false,
        false,
        SQLSTATE IS DISTINCT FROM '42501',
        'SURFACE_CLAIM_FAILED',
        jsonb_strip_nulls(jsonb_build_object(
          'sqlstate', SQLSTATE,
          'message', v_message,
          'detail', NULLIF(v_detail, ''),
          'hint', NULLIF(v_hint, '')
        ))
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;

    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'surface_claim_failed',
      'code', 'SURFACE_CLAIM_FAILED',
      'error_code', 'SURFACE_CLAIM_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'detail', NULLIF(v_detail, ''),
      'hint', NULLIF(v_hint, ''),
      'retryable', SQLSTATE IS DISTINCT FROM '42501',
      'retry_after_ms', 1500,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

DO $$
BEGIN
  IF to_regprocedure('public.video_session_mark_ready_v2_20260606212727_event_cleanup_base(uuid, text, text)') IS NULL THEN
    ALTER FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
      RENAME TO video_session_mark_ready_v2_20260606212727_event_cleanup_base;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2_20260606212727_event_cleanup_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2_20260606212727_event_cleanup_base(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.video_session_mark_ready_v2(
  p_session_id uuid,
  p_idempotency_key text DEFAULT NULL,
  p_request_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_session public.video_sessions%ROWTYPE;
  v_inactive_reason text;
BEGIN
  IF p_session_id IS NOT NULL THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND
       AND v_session.event_id IS NOT NULL
       AND v_session.ended_at IS NULL
       AND COALESCE(v_session.state, 'ready_gate'::public.video_date_state) = 'ready_gate'::public.video_date_state
       AND COALESCE(v_session.phase, 'ready_gate') = 'ready_gate'
       AND COALESCE(v_session.ready_gate_status, 'ready') IN ('queued', 'ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed') THEN
      v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
      IF v_inactive_reason IS NOT NULL THEN
        PERFORM public.terminalize_event_ready_gates(v_session.event_id, v_inactive_reason);
      END IF;
    END IF;
  END IF;

  RETURN public.video_session_mark_ready_v2_20260606212727_event_cleanup_base(
    p_session_id,
    p_idempotency_key,
    p_request_hash
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text) IS
  'Ready Gate mark-ready wrapper that restores event-wide inactive Ready Gate cleanup before delegating to the decisive commit hot path.';

NOTIFY pgrst, 'reload schema';

COMMIT;
