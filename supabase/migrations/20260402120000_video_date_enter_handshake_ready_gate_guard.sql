-- Harden enter_handshake: require both_ready (or session already in handshake/date for rejoin/legacy),
-- and reject ended sessions explicitly.

CREATE OR REPLACE FUNCTION public.video_date_transition(
  p_session_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session record;
  v_actor uuid;
  v_is_p1 boolean;
  v_handshake_seconds integer := 60;
  v_date_seconds integer := 300;
  v_allow_handshake boolean;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized', 'code', 'UNAUTHORIZED');
  END IF;

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
  END IF;

  v_is_p1 := (v_session.participant_1_id = v_actor);
  IF NOT v_is_p1 AND v_session.participant_2_id != v_actor THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied', 'code', 'ACCESS_DENIED');
  END IF;

  -- Action: enter_handshake (idempotent; rejoin when handshake_started_at already set)
  IF p_action = 'enter_handshake' THEN
    IF v_session.ended_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Session has ended', 'code', 'SESSION_ENDED');
    END IF;

    IF v_session.handshake_started_at IS NULL THEN
      v_allow_handshake :=
        COALESCE(v_session.ready_gate_status, '') = 'both_ready'
        OR v_session.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
        OR v_session.phase IN ('handshake', 'date');

      IF NOT v_allow_handshake THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Both participants must be ready before starting the video date',
          'code', 'READY_GATE_NOT_READY'
        );
      END IF;
    END IF;

    UPDATE public.video_sessions
    SET
      state = 'handshake',
      phase = 'handshake',
      handshake_started_at = COALESCE(handshake_started_at, now()),
      state_updated_at = now()
    WHERE id = p_session_id
      AND ended_at IS NULL;

    RETURN jsonb_build_object('success', true, 'state', 'handshake');
  END IF;

  -- Action: vibe (record participant liked during handshake)
  IF p_action = 'vibe' THEN
    IF v_is_p1 THEN
      UPDATE public.video_sessions
      SET participant_1_liked = TRUE, state_updated_at = now()
      WHERE id = p_session_id AND ended_at IS NULL;
    ELSE
      UPDATE public.video_sessions
      SET participant_2_liked = TRUE, state_updated_at = now()
      WHERE id = p_session_id AND ended_at IS NULL;
    END IF;

    UPDATE public.video_sessions
    SET
      state = 'date',
      phase = 'date',
      date_started_at = COALESCE(date_started_at, now()),
      state_updated_at = now()
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND participant_1_liked IS TRUE
      AND participant_2_liked IS TRUE;

    RETURN jsonb_build_object('success', true);
  END IF;

  -- Action: complete_handshake (called when handshake timer ends)
  IF p_action = 'complete_handshake' THEN
    IF v_session.participant_1_liked IS TRUE AND v_session.participant_2_liked IS TRUE THEN
      UPDATE public.video_sessions
      SET
        state = 'date',
        phase = 'date',
        date_started_at = COALESCE(date_started_at, now()),
        state_updated_at = now()
      WHERE id = p_session_id AND ended_at IS NULL;
      RETURN jsonb_build_object('success', true, 'state', 'date');
    END IF;

    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(p_reason, 'handshake_not_mutual'),
      duration_seconds = COALESCE(duration_seconds, GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - COALESCE(handshake_started_at, started_at))))::int)),
      state_updated_at = now()
    WHERE id = p_session_id
      AND ended_at IS NULL;

    RETURN jsonb_build_object('success', true, 'state', 'ended');
  END IF;

  -- Action: end (idempotent)
  IF p_action = 'end' THEN
    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(p_reason, ended_reason, 'ended_by_participant'),
      duration_seconds = COALESCE(duration_seconds, GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - started_at)))::int)),
      state_updated_at = now()
    WHERE id = p_session_id
      AND ended_at IS NULL;

    RETURN jsonb_build_object('success', true, 'state', 'ended');
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'Unknown action', 'code', 'UNKNOWN_ACTION');
END;
$function$;
