-- Single-writer post-date verdict: session liked flags + date_feedback + mutual/persistent match in one RPC.
-- Clients must not patch video_sessions/date_feedback for the mandatory verdict then call check_mutual separately.

CREATE OR REPLACE FUNCTION public.submit_post_date_verdict(p_session_id uuid, p_liked boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session record;
  v_target uuid;
  v_inner jsonb;
  v_persistent_created boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_uid AND v_session.participant_2_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_participant');
  END IF;

  IF v_session.participant_1_id = v_uid THEN
    UPDATE public.video_sessions
    SET participant_1_liked = p_liked, state_updated_at = now()
    WHERE id = p_session_id;
    v_target := v_session.participant_2_id;
  ELSE
    UPDATE public.video_sessions
    SET participant_2_liked = p_liked, state_updated_at = now()
    WHERE id = p_session_id;
    v_target := v_session.participant_1_id;
  END IF;

  INSERT INTO public.date_feedback (session_id, user_id, target_id, liked)
  VALUES (p_session_id, v_uid, v_target, p_liked)
  ON CONFLICT (session_id, user_id)
  DO UPDATE SET
    liked = EXCLUDED.liked,
    target_id = EXCLUDED.target_id;

  v_inner := public.check_mutual_vibe_and_match(p_session_id);

  IF NOT COALESCE((v_inner->>'success')::boolean, false) THEN
    RETURN v_inner || jsonb_build_object('verdict_recorded', true);
  END IF;

  v_persistent_created := NULL;
  IF COALESCE((v_inner->>'mutual')::boolean, false) THEN
    IF COALESCE((v_inner->>'already_matched')::boolean, false) THEN
      v_persistent_created := false;
    ELSE
      v_persistent_created := true;
    END IF;
  END IF;

  RETURN v_inner
    || jsonb_build_object(
      'verdict_recorded', true,
      'persistent_match_created', v_persistent_created
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_post_date_verdict(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_post_date_verdict(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.submit_post_date_verdict(uuid, boolean) IS
  'Post-date screen 1: records verdict (video_sessions + date_feedback) and runs mutual/persistent match logic. Canonical path for post-date outcome; clients should not write those rows separately for the mandatory verdict.';
