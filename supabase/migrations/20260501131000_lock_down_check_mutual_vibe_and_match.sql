-- Red-readiness sprint 1: prevent nonparticipants from directly invoking
-- check_mutual_vibe_and_match against arbitrary video_sessions.

CREATE OR REPLACE FUNCTION public.check_mutual_vibe_and_match(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session record;
  v_actor uuid := auth.uid();
  v_service_role boolean := auth.role() = 'service_role';
  v_user1_liked boolean;
  v_user2_liked boolean;
  v_match_id uuid;
  v_existing_match uuid;
  v_p1 uuid;
  v_p2 uuid;
BEGIN
  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF NOT v_service_role AND (
    v_actor IS NULL
    OR (
      v_session.participant_1_id IS DISTINCT FROM v_actor
      AND v_session.participant_2_id IS DISTINCT FROM v_actor
    )
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'not_participant',
      'code', 'not_participant',
      'mutual', false
    );
  END IF;

  IF v_session.ended_at IS NULL
     OR v_session.date_started_at IS NULL
     OR COALESCE(v_session.ended_reason, '') IN (
       'ready_gate_forfeit',
       'ready_gate_expired',
       'queued_ttl_expired',
       'handshake_not_mutual',
       'handshake_grace_expired',
       'handshake_timeout',
       'blocked_pair'
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'session_not_survey_eligible',
      'code', 'session_not_survey_eligible',
      'mutual', false
    );
  END IF;

  IF public.is_blocked(v_session.participant_1_id, v_session.participant_2_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'blocked_pair',
      'code', 'blocked_pair',
      'mutual', false,
      'blocked', true
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_reports ur
    WHERE (ur.reporter_id = v_session.participant_1_id AND ur.reported_id = v_session.participant_2_id)
       OR (ur.reporter_id = v_session.participant_2_id AND ur.reported_id = v_session.participant_1_id)
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'mutual', false,
      'reported_pair', true
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

REVOKE ALL ON FUNCTION public.check_mutual_vibe_and_match(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_mutual_vibe_and_match(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.check_mutual_vibe_and_match(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_mutual_vibe_and_match(uuid) TO service_role;

COMMENT ON FUNCTION public.check_mutual_vibe_and_match(uuid) IS
  'Service-owned mutual post-date match helper. Direct authenticated execution is revoked; defense-in-depth participant authorization remains inside the SECURITY DEFINER body so arbitrary authenticated users cannot inspect or trigger another session.';
