-- Short-name follow-up for provider-bound remote-seen recovery.
--
-- 20260608120000 intentionally preserved applied history after cloud apply, but
-- Postgres truncated the Daily alive base helper name. Keep applied history
-- immutable and correct the live catalog with an explicit short service-only
-- helper name plus a recreated public wrapper.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.vd_daily_alive_remote_seen_base(uuid, text, text, text, text, text)') IS NULL THEN
    IF to_regprocedure('public.mark_video_date_daily_alive_20260608120000_provider_remote_seen(uuid, text, text, text, text, text)') IS NOT NULL THEN
      ALTER FUNCTION public.mark_video_date_daily_alive_20260608120000_provider_remote_seen(
        uuid, text, text, text, text, text
      ) RENAME TO vd_daily_alive_remote_seen_base;
    END IF;
  END IF;

  IF to_regprocedure('public.vd_daily_alive_remote_seen_base(uuid, text, text, text, text, text)') IS NULL THEN
    RAISE EXCEPTION 'missing provider-bound Daily alive base for identifier hygiene';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.vd_daily_alive_remote_seen_base(
  uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_daily_alive_remote_seen_base(
  uuid, text, text, text, text, text
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
  v_actor uuid := NULL;
  v_result jsonb;
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  BEGIN
    RETURN public.vd_daily_alive_remote_seen_base(
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
        v_result := public.video_date_lifecycle_exception_payload_v2(
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
        RETURN v_result;
      EXCEPTION
        WHEN OTHERS THEN
          v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
          RETURN jsonb_build_object(
            'ok', false,
            'success', false,
            'error', 'daily_alive_stamp_failed',
            'code', 'DAILY_ALIVE_STAMP_FAILED',
            'error_code', 'DAILY_ALIVE_STAMP_FAILED',
            'rpc', 'mark_video_date_daily_alive',
            'retryable', true,
            'retry_after_ms', 1500,
            'session_id', p_session_id,
            'actor_id', v_actor,
            'provider_session_id', NULLIF(left(btrim(COALESCE(p_provider_session_id, '')), 180), ''),
            'owner_state', NULLIF(left(btrim(COALESCE(p_owner_state, '')), 80), ''),
            'server_now_ms', v_server_now_ms,
            'serverNowMs', v_server_now_ms,
            'direct_json_fallback', true
          );
      END;
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_alive(
  uuid, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_alive(
  uuid, text, text, text, text, text
) TO authenticated;

COMMENT ON FUNCTION public.vd_daily_alive_remote_seen_base(
  uuid, text, text, text, text, text
) IS
  'Short service-only base for provider-bound Daily alive after 20260608120000 identifier hygiene.';

COMMENT ON FUNCTION public.mark_video_date_daily_alive(
  uuid, text, text, text, text, text
) IS
  'Provider-authoritative Daily alive heartbeat with a direct JSON last-resort fallback for stale/terminal provider paths.';

NOTIFY pgrst, 'reload schema';

COMMIT;
