-- Repair the public PostgREST argument name for mark_video_date_daily_joined.
--
-- 20260609105249 kept the six-text signature but accidentally exposed the
-- fifth argument as p_provider_participant_id. Current web/native clients and
-- generated types call this RPC with named argument p_entry_attempt_id, so the
-- public wrapper must preserve that name while delegating to the same active
-- entry base.

BEGIN;

DROP FUNCTION IF EXISTS public.mark_video_date_daily_joined(uuid, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.mark_video_date_daily_joined(
  p_session_id uuid,
  p_owner_id text DEFAULT NULL,
  p_call_instance_id text DEFAULT NULL,
  p_provider_session_id text DEFAULT NULL,
  p_entry_attempt_id text DEFAULT NULL,
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
    p_entry_attempt_id,
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

COMMENT ON FUNCTION public.mark_video_date_daily_joined(uuid, text, text, text, text, text) IS
  'Provider-backed Daily joined RPC with active-entry outer fail-soft shell and preserved p_entry_attempt_id PostgREST argument name.';

NOTIFY pgrst, 'reload schema';

COMMIT;
