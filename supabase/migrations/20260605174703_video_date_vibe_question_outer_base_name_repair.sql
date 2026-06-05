-- The previous outer fail-soft migration originally used an overlong private
-- helper name for the vibe-question RPC. PostgreSQL truncated it during cloud
-- apply. Normalize that helper to a short explicit name and repoint the public
-- wrapper so fresh databases and the linked cloud database converge.

DO $$
BEGIN
  IF to_regprocedure('public.vd_vibe_q_outer_20260605170249_base(uuid, jsonb)') IS NULL THEN
    IF to_regprocedure('public.get_or_seed_video_session_vibe_questions_20260605170249_outer_b(uuid, jsonb)') IS NOT NULL THEN
      ALTER FUNCTION public.get_or_seed_video_session_vibe_questions_20260605170249_outer_b(uuid, jsonb)
        RENAME TO vd_vibe_q_outer_20260605170249_base;
    ELSIF to_regprocedure('public.get_or_seed_video_session_vibe_questions(uuid, jsonb)') IS NOT NULL THEN
      ALTER FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb)
        RENAME TO vd_vibe_q_outer_20260605170249_base;
    END IF;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.vd_vibe_q_outer_20260605170249_base(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vd_vibe_q_outer_20260605170249_base(uuid, jsonb)
  TO service_role;

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

REVOKE ALL ON FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.vd_vibe_q_outer_20260605170249_base(uuid, jsonb) IS
  'Private base for the Video Date vibe-question fail-soft shell, renamed to avoid PostgreSQL identifier truncation.';
COMMENT ON FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb) IS
  'Outermost fail-soft shell around Video Date vibe question seeding. Converts uncaught seed/read errors into retryable JSON with an empty questions fallback.';

NOTIFY pgrst, 'reload schema';
