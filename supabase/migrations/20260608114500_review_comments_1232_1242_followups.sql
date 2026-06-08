-- Review-comment follow-ups for PR #1232 through PR #1242.
--
-- Applied history is immutable. This migration wraps already-applied public
-- bodies instead of editing 20260607190533 or 20260608063016.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.video_session_mark_ready_v2_20260608114500_review_comments_base(uuid, text, text)') IS NULL
     AND to_regprocedure('public.video_session_mark_ready_v2(uuid, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
      RENAME TO video_session_mark_ready_v2_20260608114500_review_comments_base;
  END IF;

  IF to_regprocedure('public.video_date_reconcile_provider_absence_v1_20260608114500_review_comments_base(uuid, text)') IS NULL
     AND to_regprocedure('public.video_date_reconcile_provider_absence_v1(uuid, text)') IS NOT NULL THEN
    ALTER FUNCTION public.video_date_reconcile_provider_absence_v1(uuid, text)
      RENAME TO video_date_reconcile_provider_absence_v1_20260608114500_review_comments_base;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2_20260608114500_review_comments_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2_20260608114500_review_comments_base(uuid, text, text)
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
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_error text;
  v_code text;
  v_sqlstate text;
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
BEGIN
  v_result := public.video_session_mark_ready_v2_20260608114500_review_comments_base(
    p_session_id,
    p_idempotency_key,
    p_request_hash
  );

  v_error := lower(COALESCE(NULLIF(v_result ->> 'error', ''), NULLIF(v_result ->> 'reason', ''), ''));
  v_code := upper(COALESCE(NULLIF(v_result ->> 'code', ''), NULLIF(v_result ->> 'error_code', ''), ''));

  IF v_error = 'safety_check_unavailable' OR v_code = 'SAFETY_CHECK_UNAVAILABLE' THEN
    v_sqlstate := NULLIF(v_result ->> 'sqlstate', '');
    v_message := NULLIF(v_result ->> 'message', '');
    v_detail := NULLIF(v_result ->> 'detail', '');
    v_hint := NULLIF(v_result ->> 'hint', '');

    PERFORM public.video_date_lifecycle_observe_exception_v2(
      p_session_id,
      v_actor,
      'video_session_mark_ready_v2.safety_check',
      v_sqlstate,
      v_message,
      v_detail,
      v_hint
    );

    RETURN v_result
      - 'sqlstate'
      - 'message'
      - 'detail'
      - 'hint'
      - 'context'
      || jsonb_build_object(
        'ok', false,
        'success', false,
        'session_id', p_session_id,
        'error', 'safety_check_unavailable',
        'reason', 'safety_check_unavailable',
        'code', 'SAFETY_CHECK_UNAVAILABLE',
        'error_code', 'SAFETY_CHECK_UNAVAILABLE',
        'retryable', true,
        'terminal', false,
        'commandStatus', 'rejected',
        'decisive_mark_ready_prechecked', true,
        'server_now_ms', v_server_now_ms,
        'serverNowMs', v_server_now_ms
      );
  END IF;

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;

    PERFORM public.video_date_lifecycle_observe_exception_v2(
      p_session_id,
      v_actor,
      'video_session_mark_ready_v2',
      SQLSTATE,
      v_message,
      v_detail,
      v_hint
    );

    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', p_session_id,
      'error', 'mark_ready_unavailable',
      'reason', 'mark_ready_unavailable',
      'code', 'MARK_READY_UNAVAILABLE',
      'error_code', 'MARK_READY_UNAVAILABLE',
      'retryable', true,
      'terminal', false,
      'commandStatus', 'rejected',
      'decisive_mark_ready_prechecked', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text) IS
  'Participant-owned Ready Gate mark-ready wrapper with sanitized safety-check failure payloads. SQL diagnostics are recorded through service-side lifecycle observability, not returned to authenticated clients.';

REVOKE ALL ON FUNCTION public.video_date_reconcile_provider_absence_v1_20260608114500_review_comments_base(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_reconcile_provider_absence_v1_20260608114500_review_comments_base(uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.video_date_reconcile_provider_absence_v1(
  p_session_id uuid,
  p_source text DEFAULT 'video_date_reconcile_provider_absence_v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_result jsonb;
  v_terminal boolean := false;
  v_survey_required boolean := false;
  v_resume_status text;
  v_session record;
  v_now timestamptz := clock_timestamp();
BEGIN
  v_result := public.video_date_reconcile_provider_absence_v1_20260608114500_review_comments_base(
    p_session_id,
    p_source
  );

  v_terminal := lower(COALESCE(v_result ->> 'terminal', 'false')) IN ('true', 't', '1', 'yes');
  v_survey_required := lower(COALESCE(v_result ->> 'survey_required', 'false')) IN ('true', 't', '1', 'yes');
  v_resume_status := NULLIF(v_result ->> 'resume_status', '');

  IF v_terminal AND NOT v_survey_required AND v_resume_status = 'idle' THEN
    SELECT
      vs.event_id,
      vs.participant_1_id,
      vs.participant_2_id
    INTO v_session
    FROM public.video_sessions vs
    WHERE vs.id = p_session_id;

    IF FOUND THEN
      UPDATE public.event_registrations
      SET
        queue_status = 'idle',
        current_room_id = NULL,
        current_partner_id = NULL,
        updated_at = v_now
      WHERE event_id = v_session.event_id
        AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
        AND queue_status IS DISTINCT FROM 'in_survey';
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_reconcile_provider_absence_v1(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_reconcile_provider_absence_v1(uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.video_date_reconcile_provider_absence_v1(uuid, text) IS
  'Provider-authoritative post-encounter absence reconciler. Wraps the applied base and preserves idle resume status for no-survey terminalization when the event is no longer live.';

NOTIFY pgrst, 'reload schema';

COMMIT;
