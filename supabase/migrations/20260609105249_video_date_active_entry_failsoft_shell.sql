-- Video Date active-entry fail-soft shell.
--
-- The June 9 production run still showed hot-path transport 500s while the
-- clients were between Ready Gate and a stable Daily join. Keep the existing
-- state-machine bodies intact, but put final public shells around mark-ready
-- and launch-latency diagnostics so transient helper/observability failures do
-- not masquerade as terminal date failures.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.video_session_mark_ready_v2_20260609105249_active_entry_base(uuid, text, text)') IS NULL
     AND to_regprocedure('public.video_session_mark_ready_v2(uuid, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
      RENAME TO video_session_mark_ready_v2_20260609105249_active_entry_base;
  END IF;

  IF to_regprocedure('public.video_date_transition_20260609105249_active_entry_base(uuid, text, text)') IS NULL
     AND to_regprocedure('public.video_date_transition(uuid, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.video_date_transition(uuid, text, text)
      RENAME TO video_date_transition_20260609105249_active_entry_base;
  END IF;

  IF to_regprocedure('public.mark_video_date_daily_joined_20260609105249_active_entry_base(uuid, text, text, text, text, text)') IS NULL
     AND to_regprocedure('public.mark_video_date_daily_joined(uuid, text, text, text, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text)
      RENAME TO mark_video_date_daily_joined_20260609105249_active_entry_base;
  END IF;

  IF to_regprocedure('public.record_vd_launch_lat_20260609105249_active_base(uuid, text, jsonb, integer)') IS NULL
     AND to_regprocedure('public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)') IS NOT NULL THEN
    ALTER FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
      RENAME TO record_vd_launch_lat_20260609105249_active_base;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2_20260609105249_active_entry_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2_20260609105249_active_entry_base(uuid, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.video_date_transition_20260609105249_active_entry_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_transition_20260609105249_active_entry_base(uuid, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_joined_20260609105249_active_entry_base(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_joined_20260609105249_active_entry_base(uuid, text, text, text, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.record_vd_launch_lat_20260609105249_active_base(uuid, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_vd_launch_lat_20260609105249_active_base(uuid, text, jsonb, integer)
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

  v_result := public.video_session_mark_ready_v2_20260609105249_active_entry_base(
    p_session_id,
    p_idempotency_key,
    p_request_hash
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
        'video_session_mark_ready_v2.active_entry_shell',
        'mark_ready_unavailable',
        'MARK_READY_UNAVAILABLE',
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
          'error', 'mark_ready_unavailable',
          'reason', 'mark_ready_unavailable',
          'code', 'MARK_READY_UNAVAILABLE',
          'error_code', 'MARK_READY_UNAVAILABLE',
          'retryable', true,
          'terminal', false,
          'commandStatus', 'rejected',
          'active_entry_failsoft_shell', true,
          'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
          'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
        );
    END;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  TO authenticated, service_role;

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

  v_result := public.video_date_transition_20260609105249_active_entry_base(
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
$function$;

REVOKE ALL ON FUNCTION public.video_date_transition(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_transition(uuid, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_video_date_daily_joined(
  p_session_id uuid,
  p_owner_id text DEFAULT NULL,
  p_call_instance_id text DEFAULT NULL,
  p_provider_session_id text DEFAULT NULL,
  p_provider_participant_id text DEFAULT NULL,
  p_owner_state text DEFAULT 'joined'
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

  v_result := public.mark_video_date_daily_joined_20260609105249_active_entry_base(
    p_session_id,
    p_owner_id,
    p_call_instance_id,
    p_provider_session_id,
    p_provider_participant_id,
    p_owner_state
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
        'mark_video_date_daily_joined.active_entry_shell',
        'daily_join_stamp_failed',
        'DAILY_JOIN_STAMP_FAILED',
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
          'error', 'daily_join_stamp_failed',
          'reason', 'daily_join_stamp_failed',
          'code', 'DAILY_JOIN_STAMP_FAILED',
          'error_code', 'DAILY_JOIN_STAMP_FAILED',
          'retryable', true,
          'terminal', false,
          'active_entry_failsoft_shell', true,
          'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
          'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
        );
    END;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_video_date_launch_latency_checkpoint(
  p_session_id uuid,
  p_checkpoint text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_latency_ms integer DEFAULT NULL
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

  v_result := public.record_vd_launch_lat_20260609105249_active_base(
    p_session_id,
    p_checkpoint,
    p_payload,
    p_latency_ms
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
      PERFORM public.video_date_lifecycle_observe_exception_v2(
        p_session_id,
        v_actor,
        'record_video_date_launch_latency_checkpoint.active_entry_shell',
        SQLSTATE,
        v_message,
        v_detail,
        v_hint
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;

    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', p_session_id,
      'checkpoint', lower(btrim(COALESCE(p_checkpoint, ''))),
      'error', 'launch_latency_checkpoint_failed',
      'reason', 'launch_latency_checkpoint_failed',
      'code', 'LAUNCH_LATENCY_CHECKPOINT_FAILED',
      'error_code', 'LAUNCH_LATENCY_CHECKPOINT_FAILED',
      'retryable', true,
      'terminal', false,
      'active_entry_failsoft_shell', true
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text) IS
  'Participant Ready Gate mark-ready RPC with active-entry outer fail-soft shell. Uncaught helper/route-payload failures return retryable JSON instead of transport errors.';

COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Video Date lifecycle transition RPC with active-entry outer fail-soft shell. Uncaught prepare/entry/reconnect helper failures return retryable JSON instead of transport errors.';

COMMENT ON FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text) IS
  'Provider-backed Daily joined RPC with active-entry outer fail-soft shell. Uncaught join-stamp failures return retryable JSON instead of transport errors.';

COMMENT ON FUNCTION public.record_video_date_launch_latency_checkpoint(uuid, text, jsonb, integer) IS
  'Authenticated Video Date launch-latency checkpoint ingestion with active-entry outer fail-soft shell. Observability failures never block room entry.';

NOTIFY pgrst, 'reload schema';

COMMIT;
