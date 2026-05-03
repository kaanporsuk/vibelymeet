-- Keep Video Date ice-breaker questions synchronized across clients.
-- Older rows defaulted `vibe_questions` to [] which made the seeding RPC return local fallbacks
-- instead of persisting the shared question list. This migration treats empty arrays as unseeded
-- and adds server-owned active question state for synchronized manual/automatic rotation.

ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS vibe_question_index integer,
  ADD COLUMN IF NOT EXISTS vibe_question_anchor_at timestamptz;

UPDATE public.video_sessions
SET vibe_question_index = 0
WHERE vibe_question_index IS NULL;

ALTER TABLE public.video_sessions
  ALTER COLUMN vibe_question_index SET DEFAULT 0,
  ALTER COLUMN vibe_question_index SET NOT NULL;

COMMENT ON COLUMN public.video_sessions.vibe_question_index IS
  'Server-owned base index for the active Video Date ice-breaker question.';

COMMENT ON COLUMN public.video_sessions.vibe_question_anchor_at IS
  'Timestamp anchoring synchronized 30s Video Date ice-breaker rotation.';

CREATE OR REPLACE FUNCTION public.get_or_seed_video_session_vibe_questions(
  p_session_id uuid,
  p_questions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row record;
  v_questions jsonb := '[]'::jsonb;
  v_question_count integer := 0;
  v_question_index integer := 0;
  v_question_anchor_at timestamptz := NULL;
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'questions', '[]'::jsonb);
  END IF;

  SELECT id, participant_1_id, participant_2_id, vibe_questions, vibe_question_index, vibe_question_anchor_at
  INTO v_row
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'questions', '[]'::jsonb);
  END IF;

  IF v_uid IS DISTINCT FROM v_row.participant_1_id
     AND v_uid IS DISTINCT FROM v_row.participant_2_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACCESS_DENIED', 'questions', '[]'::jsonb);
  END IF;

  IF jsonb_typeof(v_row.vibe_questions) = 'array'
     AND jsonb_array_length(v_row.vibe_questions) > 0 THEN
    v_questions := v_row.vibe_questions;
    v_question_count := jsonb_array_length(v_questions);
    v_question_index := mod(mod(COALESCE(v_row.vibe_question_index, 0), v_question_count) + v_question_count, v_question_count);
    v_question_anchor_at := COALESCE(v_row.vibe_question_anchor_at, v_now);

    IF v_row.vibe_question_index IS DISTINCT FROM v_question_index
       OR v_row.vibe_question_anchor_at IS NULL THEN
      UPDATE public.video_sessions
      SET vibe_question_index = v_question_index,
          vibe_question_anchor_at = v_question_anchor_at
      WHERE id = p_session_id
      RETURNING vibe_questions, vibe_question_index, vibe_question_anchor_at
      INTO v_questions, v_question_index, v_question_anchor_at;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'seeded', false,
      'questions', v_questions,
      'question_index', v_question_index,
      'question_anchor_at', v_question_anchor_at
    );
  END IF;

  IF jsonb_typeof(p_questions) = 'array' THEN
    SELECT COALESCE(jsonb_agg(value), '[]'::jsonb)
    INTO v_questions
    FROM (
      SELECT value
      FROM jsonb_array_elements(p_questions) AS q(value)
      WHERE jsonb_typeof(value) = 'string'
        AND length(btrim(value #>> '{}')) BETWEEN 1 AND 240
      LIMIT 8
    ) limited;
  END IF;

  IF jsonb_array_length(v_questions) = 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_QUESTIONS', 'questions', '[]'::jsonb);
  END IF;

  UPDATE public.video_sessions
  SET vibe_questions = v_questions,
      vibe_question_index = 0,
      vibe_question_anchor_at = v_now
  WHERE id = p_session_id
  RETURNING vibe_questions, vibe_question_index, vibe_question_anchor_at
  INTO v_questions, v_question_index, v_question_anchor_at;

  RETURN jsonb_build_object(
    'success', true,
    'seeded', true,
    'questions', v_questions,
    'question_index', v_question_index,
    'question_anchor_at', v_question_anchor_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.advance_video_session_vibe_question(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row record;
  v_questions jsonb := '[]'::jsonb;
  v_question_count integer := 0;
  v_question_index integer := 0;
  v_question_anchor_at timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'questions', '[]'::jsonb);
  END IF;

  SELECT id, participant_1_id, participant_2_id, vibe_questions, vibe_question_index
  INTO v_row
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'questions', '[]'::jsonb);
  END IF;

  IF v_uid IS DISTINCT FROM v_row.participant_1_id
     AND v_uid IS DISTINCT FROM v_row.participant_2_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACCESS_DENIED', 'questions', '[]'::jsonb);
  END IF;

  IF jsonb_typeof(v_row.vibe_questions) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('success', false, 'code', 'QUESTIONS_NOT_SEEDED', 'questions', '[]'::jsonb);
  END IF;

  IF jsonb_array_length(v_row.vibe_questions) = 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'QUESTIONS_NOT_SEEDED', 'questions', '[]'::jsonb);
  END IF;

  v_questions := v_row.vibe_questions;
  v_question_count := jsonb_array_length(v_questions);
  v_question_index := mod(mod(COALESCE(v_row.vibe_question_index, 0) + 1, v_question_count) + v_question_count, v_question_count);

  UPDATE public.video_sessions
  SET vibe_question_index = v_question_index,
      vibe_question_anchor_at = v_question_anchor_at
  WHERE id = p_session_id
  RETURNING vibe_questions, vibe_question_index, vibe_question_anchor_at
  INTO v_questions, v_question_index, v_question_anchor_at;

  RETURN jsonb_build_object(
    'success', true,
    'questions', v_questions,
    'question_index', v_question_index,
    'question_anchor_at', v_question_anchor_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.advance_video_session_vibe_question(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_video_session_vibe_question(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_or_seed_video_session_vibe_questions(uuid, jsonb) IS
  'Participant-only server-owned seeding and state read for synchronized Video Date ice-breaker questions.';

COMMENT ON FUNCTION public.advance_video_session_vibe_question(uuid) IS
  'Participant-only server-owned manual advancement of the synchronized Video Date ice-breaker question.';
