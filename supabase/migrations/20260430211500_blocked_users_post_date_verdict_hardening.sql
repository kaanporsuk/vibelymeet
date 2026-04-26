-- Blocked Users post-date verdict hardening.
-- Keeps stale post-date verdicts / primitive mutual-match calls from recreating
-- persistent matches after a block cleanup has ended the video session.

CREATE OR REPLACE FUNCTION public.check_mutual_vibe_and_match(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session record;
  v_user1_liked boolean;
  v_user2_liked boolean;
  v_match_id uuid;
  v_existing_match uuid;
  v_p1 uuid;
  v_p2 uuid;
BEGIN
  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session not found');
  END IF;

  IF COALESCE(v_session.ended_reason, '') = 'blocked_pair'
     OR public.is_blocked(v_session.participant_1_id, v_session.participant_2_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'blocked_pair',
      'code', 'blocked_pair',
      'mutual', false,
      'blocked', true
    );
  END IF;

  SELECT liked INTO v_user1_liked
  FROM public.date_feedback
  WHERE session_id = p_session_id
    AND user_id = v_session.participant_1_id;

  SELECT liked INTO v_user2_liked
  FROM public.date_feedback
  WHERE session_id = p_session_id
    AND user_id = v_session.participant_2_id;

  IF v_user1_liked IS TRUE AND v_user2_liked IS TRUE THEN
    v_p1 := LEAST(v_session.participant_1_id, v_session.participant_2_id);
    v_p2 := GREATEST(v_session.participant_1_id, v_session.participant_2_id);

    SELECT id INTO v_existing_match
    FROM public.matches
    WHERE profile_id_1 = v_p1
      AND profile_id_2 = v_p2;

    IF v_existing_match IS NULL THEN
      INSERT INTO public.matches (profile_id_1, profile_id_2, event_id)
      VALUES (v_p1, v_p2, v_session.event_id)
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_match_id;

      IF v_match_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'mutual', true, 'match_id', v_match_id);
      END IF;

      SELECT id INTO v_existing_match
      FROM public.matches
      WHERE profile_id_1 = v_p1
        AND profile_id_2 = v_p2;

      RETURN jsonb_build_object(
        'success', true,
        'mutual', true,
        'match_id', v_existing_match,
        'already_matched', true
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'mutual', true,
      'match_id', v_existing_match,
      'already_matched', true
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'mutual', false);
END;
$function$;

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

  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_uid
     AND v_session.participant_2_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_participant');
  END IF;

  IF v_session.participant_1_id = v_uid THEN
    v_target := v_session.participant_2_id;
  ELSE
    v_target := v_session.participant_1_id;
  END IF;

  IF COALESCE(v_session.ended_reason, '') = 'blocked_pair'
     OR public.is_blocked(v_uid, v_target) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'blocked_pair',
      'code', 'blocked_pair',
      'blocked', true
    );
  END IF;

  IF v_session.participant_1_id = v_uid THEN
    UPDATE public.video_sessions
    SET participant_1_liked = p_liked,
        state_updated_at = now()
    WHERE id = p_session_id;
  ELSE
    UPDATE public.video_sessions
    SET participant_2_liked = p_liked,
        state_updated_at = now()
    WHERE id = p_session_id;
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

REVOKE ALL ON FUNCTION public.check_mutual_vibe_and_match(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_post_date_verdict(uuid, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.check_mutual_vibe_and_match(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_post_date_verdict(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.check_mutual_vibe_and_match(uuid) IS
  'Post-date mutual-match primitive. Refuses blocked-pair or block-ended sessions before creating persistent matches.';

COMMENT ON FUNCTION public.submit_post_date_verdict(uuid, boolean) IS
  'Post-date screen 1: records verdict and runs mutual matching only when the pair is not blocked and the session was not ended by block cleanup.';
