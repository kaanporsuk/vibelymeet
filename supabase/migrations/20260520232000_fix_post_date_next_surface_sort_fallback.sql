-- Fix the authoritative post-date router after schema drift: video_sessions has
-- started_at, not created_at. This function is called by both web and native.

CREATE OR REPLACE FUNCTION public.resolve_post_date_next_surface(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_next public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_target_id uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_match_id uuid;
  v_event_active boolean := false;
  v_event_reason text := 'unknown';
  v_event_ends_at timestamptz;
  v_seconds_until_event_end integer;
  v_has_feedback boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'error', 'session_not_found');
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_uid
     AND v_session.participant_2_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACCESS_DENIED', 'error', 'not_participant');
  END IF;

  v_target_id := CASE
    WHEN v_session.participant_1_id = v_uid THEN v_session.participant_2_id
    ELSE v_session.participant_1_id
  END;

  SELECT EXISTS (
    SELECT 1
    FROM public.date_feedback
    WHERE session_id = p_session_id
      AND user_id = v_uid
  ) INTO v_has_feedback;

  IF public.video_date_session_is_post_date_survey_eligible(
      v_session.ended_at,
      v_session.ended_reason,
      v_session.date_started_at,
      v_session.state::text,
      v_session.phase,
      v_session.participant_1_joined_at,
      v_session.participant_2_joined_at
    )
    AND NOT v_has_feedback THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'survey',
      'route', 'date',
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'target_id', v_target_id,
      'reason', 'survey_required'
    );
  END IF;

  IF v_session.event_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'home',
      'route', 'home',
      'session_id', p_session_id,
      'target_id', v_target_id,
      'reason', 'no_event_context'
    );
  END IF;

  v_p1 := LEAST(v_session.participant_1_id, v_session.participant_2_id);
  v_p2 := GREATEST(v_session.participant_1_id, v_session.participant_2_id);

  SELECT id INTO v_match_id
  FROM public.matches
  WHERE profile_id_1 = v_p1
    AND profile_id_2 = v_p2
  LIMIT 1;

  SELECT state.is_active, state.reason
  INTO v_event_active, v_event_reason
  FROM public.get_event_lobby_active_state(v_session.event_id, v_now) AS state
  LIMIT 1;

  SELECT e.event_date + (COALESCE(e.duration_minutes, 60) * interval '1 minute')
  INTO v_event_ends_at
  FROM public.events e
  WHERE e.id = v_session.event_id;

  IF v_event_ends_at IS NOT NULL THEN
    v_seconds_until_event_end := floor(EXTRACT(EPOCH FROM (v_event_ends_at - v_now)))::integer;
  END IF;

  SELECT * INTO v_next
  FROM public.video_sessions vs
  WHERE vs.id <> p_session_id
    AND (vs.participant_1_id = v_uid OR vs.participant_2_id = v_uid)
    AND public.video_date_session_is_active_surface(vs.ended_at, vs.state::text, vs.phase)
  ORDER BY
    CASE
      WHEN vs.state = 'date'::public.video_date_state THEN 1
      WHEN vs.state = 'handshake'::public.video_date_state THEN 2
      WHEN vs.state = 'ready_gate'::public.video_date_state THEN 3
      ELSE 4
    END,
    COALESCE(
      vs.date_started_at,
      vs.handshake_started_at,
      vs.ready_participant_1_at,
      vs.ready_participant_2_at,
      vs.started_at
    ) DESC
  LIMIT 1;

  IF v_next.id IS NOT NULL THEN
    IF v_next.state = 'ready_gate'::public.video_date_state THEN
      RETURN jsonb_build_object(
        'success', true,
        'action', 'ready_gate',
        'route', 'event_lobby_pending_ready_gate',
        'session_id', p_session_id,
        'next_session_id', v_next.id,
        'event_id', v_next.event_id,
        'reason', 'active_ready_gate'
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'video_date',
      'route', 'date',
      'session_id', p_session_id,
      'next_session_id', v_next.id,
      'event_id', v_next.event_id,
      'reason', 'active_video_date'
    );
  END IF;

  IF COALESCE(v_event_active, false) THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'lobby',
      'route', 'event_lobby',
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'target_id', v_target_id,
      'match_id', v_match_id,
      'seconds_until_event_end', v_seconds_until_event_end,
      'reason', CASE
        WHEN v_seconds_until_event_end IS NOT NULL AND v_seconds_until_event_end <= 300 THEN 'last_chance'
        ELSE 'event_active'
      END
    );
  END IF;

  IF v_match_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'chat',
      'route', 'chat',
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'target_id', v_target_id,
      'match_id', v_match_id,
      'event_active', false,
      'reason', 'event_closed_mutual_match'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'wrap_up',
    'route', 'event_wrap_up',
    'session_id', p_session_id,
    'event_id', v_session.event_id,
    'event_active', false,
    'event_reason', v_event_reason,
    'reason', 'event_not_active'
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.resolve_post_date_next_surface(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_post_date_next_surface(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.resolve_post_date_next_surface(uuid) IS
  'Participant-only authoritative post-date router. Returns survey, ready_gate, video_date, lobby, chat, or wrap_up based on backend session/event/match truth.';
