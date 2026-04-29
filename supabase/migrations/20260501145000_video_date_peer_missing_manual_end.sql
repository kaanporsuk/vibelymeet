-- Peer-missing manual exit for partial Daily joins.
--
-- Server timeout already ends exactly-one-joined handshakes with
-- partial_join_peer_timeout. This wrapper gives the same canonical terminal
-- reason to the user-driven "peer missing -> back to lobby" path, while
-- preserving ordinary pre-date manual-end and date-phase survey behavior.

DROP FUNCTION IF EXISTS public.video_date_transition_20260501145000_peer_missing_end_base(uuid, text, text);

ALTER FUNCTION public.video_date_transition(uuid, text, text)
  RENAME TO video_date_transition_20260501145000_peer_missing_end_base;

REVOKE ALL ON FUNCTION public.video_date_transition_20260501145000_peer_missing_end_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

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
  v_actor uuid;
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_requested_reason text := lower(btrim(COALESCE(p_reason, '')));
  v_canonical_reason text;
  v_is_p1 boolean;
  v_reached_date_phase boolean := false;
  v_exactly_one_joined boolean := false;
  v_event_live boolean := false;
  v_registration_status text := 'idle';
  v_rowcnt integer := 0;
  v_joined_participant_id uuid;
  v_missing_participant_id uuid;
  v_joined_slot text;
BEGIN
  v_canonical_reason := CASE
    WHEN v_requested_reason IN ('partial_join_peer_timeout', 'peer_missing_timeout')
      THEN 'partial_join_peer_timeout'
    ELSE NULL
  END;

  IF p_action IS DISTINCT FROM 'end'
     OR v_canonical_reason IS DISTINCT FROM 'partial_join_peer_timeout' THEN
    RETURN public.video_date_transition_20260501145000_peer_missing_end_base(
      p_session_id,
      p_action,
      p_reason
    );
  END IF;

  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'unauthorized',
      NULL,
      NULL,
      NULL,
      p_session_id,
      jsonb_build_object('action', p_action, 'p_reason', p_reason)
    );
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized', 'code', 'UNAUTHORIZED');
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'session_not_found',
      NULL,
      NULL,
      v_actor,
      p_session_id,
      jsonb_build_object('action', p_action, 'p_reason', p_reason)
    );
    RETURN jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
  END IF;

  v_is_p1 := v_session.participant_1_id = v_actor;
  IF NOT v_is_p1 AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'access_denied',
      NULL,
      v_session.event_id,
      v_actor,
      p_session_id,
      jsonb_build_object('action', p_action, 'p_reason', p_reason)
    );
    RETURN jsonb_build_object('success', false, 'error', 'Access denied', 'code', 'ACCESS_DENIED');
  END IF;

  IF v_session.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'state', 'ended',
      'already_ended', true,
      'reason', v_session.ended_reason,
      'survey_eligible', v_session.date_started_at IS NOT NULL
    );
  END IF;

  v_reached_date_phase := (
    v_session.date_started_at IS NOT NULL
    OR v_session.state = 'date'::public.video_date_state
    OR v_session.phase = 'date'
  );
  v_exactly_one_joined := (
    (v_session.participant_1_joined_at IS NULL)
    <> (v_session.participant_2_joined_at IS NULL)
  );

  IF v_reached_date_phase OR NOT v_exactly_one_joined THEN
    RETURN public.video_date_transition_20260501145000_peer_missing_end_base(
      p_session_id,
      p_action,
      'ended_from_client'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.events ev
    WHERE ev.id = v_session.event_id
      AND ev.status = 'live'
      AND ev.archived_at IS NULL
  ) INTO v_event_live;

  v_registration_status := CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END;
  v_joined_participant_id := CASE
    WHEN v_session.participant_1_joined_at IS NOT NULL THEN v_session.participant_1_id
    ELSE v_session.participant_2_id
  END;
  v_missing_participant_id := CASE
    WHEN v_session.participant_1_joined_at IS NOT NULL THEN v_session.participant_2_id
    ELSE v_session.participant_1_id
  END;
  v_joined_slot := CASE
    WHEN v_session.participant_1_joined_at IS NOT NULL THEN 'participant_1'
    ELSE 'participant_2'
  END;

  UPDATE public.video_sessions
  SET
    state = 'ended',
    phase = 'ended',
    ended_at = v_now,
    ended_reason = 'partial_join_peer_timeout',
    handshake_grace_expires_at = NULL,
    reconnect_grace_ends_at = NULL,
    participant_1_away_at = NULL,
    participant_2_away_at = NULL,
    duration_seconds = COALESCE(
      duration_seconds,
      GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(handshake_started_at, started_at))))::int)
    ),
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL
    AND date_started_at IS NULL
    AND ((participant_1_joined_at IS NULL) <> (participant_2_joined_at IS NULL));

  GET DIAGNOSTICS v_rowcnt = ROW_COUNT;
  IF v_rowcnt = 0 THEN
    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
    RETURN jsonb_build_object(
      'success', true,
      'state', COALESCE(v_session.state::text, 'ended'),
      'already_ended', v_session.ended_at IS NOT NULL,
      'reason', v_session.ended_reason,
      'survey_eligible', v_session.date_started_at IS NOT NULL
    );
  END IF;

  UPDATE public.event_registrations
  SET
    queue_status = v_registration_status,
    current_room_id = NULL,
    current_partner_id = NULL,
    last_active_at = v_now
  WHERE event_id = v_session.event_id
    AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
    AND current_room_id = p_session_id;

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

  PERFORM public.record_event_loop_observability(
    'video_date_transition',
    'success',
    'partial_join_peer_manual_end',
    NULL,
    v_session.event_id,
    v_actor,
    p_session_id,
    jsonb_build_object(
      'action', p_action,
      'p_reason', p_reason,
      'ended_reason', 'partial_join_peer_timeout',
      'transition', 'handshake_to_ended',
      'watchdog_source', 'client_peer_missing_exit',
      'joined_participant_id', v_joined_participant_id,
      'missing_participant_id', v_missing_participant_id,
      'joined_slot', v_joined_slot,
      'registration_status', v_registration_status,
      'survey_eligible', false,
      'joined_evidence', jsonb_build_object(
        'participant_1_joined', v_session.participant_1_joined_at IS NOT NULL,
        'participant_2_joined', v_session.participant_2_joined_at IS NOT NULL,
        'participant_1_joined_at', v_session.participant_1_joined_at,
        'participant_2_joined_at', v_session.participant_2_joined_at
      )
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'state', 'ended',
    'reason', 'partial_join_peer_timeout',
    'survey_eligible', false,
    'registration_status', v_registration_status
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.video_date_transition(uuid, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Canonical participant-owned video date state machine. Adds partial_join_peer_timeout for user-driven peer-missing exits after exactly one Daily join, and delegates all other transitions to the prior implementation.';
