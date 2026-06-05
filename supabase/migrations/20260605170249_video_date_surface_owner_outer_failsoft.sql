-- Latest failed two-user Video Date session showed route ownership was now the main
-- remaining client problem, but the Network tab still had raw 500s from exposed
-- lifecycle RPCs. Keep the existing implementations intact and add an outermost
-- fail-soft shell so web/native/mobile callers receive retryable JSON instead of
-- transport-level failures during handoff churn.

DO $$
BEGIN
  IF to_regprocedure('public.claim_video_date_surface_20260605170249_outer_base(uuid, text, text, boolean, integer)') IS NULL
     AND to_regprocedure('public.claim_video_date_surface(uuid, text, text, boolean, integer)') IS NOT NULL THEN
    ALTER FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer)
      RENAME TO claim_video_date_surface_20260605170249_outer_base;
  END IF;

  IF to_regprocedure('public.mark_video_date_daily_joined_20260605170249_outer_base(uuid)') IS NULL
     AND to_regprocedure('public.mark_video_date_daily_joined(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.mark_video_date_daily_joined(uuid)
      RENAME TO mark_video_date_daily_joined_20260605170249_outer_base;
  END IF;

  IF to_regprocedure('public.mark_video_date_remote_seen_20260605170249_outer_base(uuid)') IS NULL
     AND to_regprocedure('public.mark_video_date_remote_seen(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.mark_video_date_remote_seen(uuid)
      RENAME TO mark_video_date_remote_seen_20260605170249_outer_base;
  END IF;

  IF to_regprocedure('public.vd_vibe_q_outer_20260605170249_base(uuid, jsonb)') IS NULL
     AND to_regprocedure('public.get_or_seed_video_session_vibe_questions(uuid, jsonb)') IS NOT NULL THEN
    ALTER FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb)
      RENAME TO vd_vibe_q_outer_20260605170249_base;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.claim_video_date_surface_20260605170249_outer_base(uuid, text, text, boolean, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_video_date_surface_20260605170249_outer_base(uuid, text, text, boolean, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_joined_20260605170249_outer_base(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_joined_20260605170249_outer_base(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_video_date_remote_seen_20260605170249_outer_base(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_remote_seen_20260605170249_outer_base(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.vd_vibe_q_outer_20260605170249_base(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_vibe_q_outer_20260605170249_base(uuid, jsonb)
  TO service_role;

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
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  RETURN public.claim_video_date_surface_20260605170249_outer_base(
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
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
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
      'retryable', true,
      'retry_after_ms', 1500,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_video_date_daily_joined(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  RETURN public.mark_video_date_daily_joined_20260605170249_outer_base(p_session_id);
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'daily_join_stamp_failed',
      'code', 'DAILY_JOIN_STAMP_FAILED',
      'error_code', 'DAILY_JOIN_STAMP_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'detail', NULLIF(v_detail, ''),
      'hint', NULLIF(v_hint, ''),
      'retryable', true,
      'retry_after_ms', 1500,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_video_date_remote_seen(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  RETURN public.mark_video_date_remote_seen_20260605170249_outer_base(p_session_id);
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'remote_seen_failed',
      'code', 'REMOTE_SEEN_FAILED',
      'error_code', 'REMOTE_SEEN_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'detail', NULLIF(v_detail, ''),
      'hint', NULLIF(v_hint, ''),
      'retryable', true,
      'retry_after_ms', 1500,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_or_seed_video_session_vibe_questions(
  p_session_id uuid,
  p_questions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  RETURN public.vd_vibe_q_outer_20260605170249_base(
    p_session_id,
    p_questions
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'seeded', false,
      'questions', '[]'::jsonb,
      'error', 'vibe_questions_seed_failed',
      'code', 'VIBE_QUESTIONS_SEED_FAILED',
      'error_code', 'VIBE_QUESTIONS_SEED_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'detail', NULLIF(v_detail, ''),
      'hint', NULLIF(v_hint, ''),
      'retryable', true,
      'retry_after_ms', 1500,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_joined(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_joined(uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.mark_video_date_remote_seen(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_remote_seen(uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.claim_video_date_surface(uuid, text, text, boolean, integer) IS
  'Outermost fail-soft shell around Video Date surface ownership. Converts uncaught claim errors into retryable JSON so web/native/mobile do not false-close on a raw 500.';
COMMENT ON FUNCTION public.mark_video_date_daily_joined(uuid) IS
  'Outermost fail-soft shell around Daily join stamping. Converts uncaught join-stamp errors into retryable JSON during route/Daily handoff churn.';
COMMENT ON FUNCTION public.mark_video_date_remote_seen(uuid) IS
  'Outermost fail-soft shell around remote media evidence and early confirmed-encounter promotion. Converts uncaught errors into retryable JSON.';
COMMENT ON FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb) IS
  'Outermost fail-soft shell around Video Date vibe question seeding. Converts uncaught seed/read errors into retryable JSON with an empty questions fallback.';

NOTIFY pgrst, 'reload schema';
