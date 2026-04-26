-- Server-owned pre-warm entry point for Ready Gate -> Video Date.
-- Adds `video_date_transition('prepare_entry')`, combining the reconnect sync
-- and enter-handshake state mutations under one row lock. All other actions
-- delegate to the previous wrapper.

DROP FUNCTION IF EXISTS public.video_date_transition_20260501091000_pre_date_end_cleanup(uuid, text, text);

ALTER FUNCTION public.video_date_transition(uuid, text, text)
  RENAME TO video_date_transition_20260501091000_pre_date_end_cleanup;

REVOKE ALL ON FUNCTION public.video_date_transition_20260501091000_pre_date_end_cleanup(uuid, text, text)
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
  v_session record;
  v_actor uuid;
  v_is_p1 boolean;
  v_now timestamptz := now();
  v_ev uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_partner uuid;
  v_state_before text;
  v_already_entry boolean := false;
  v_gate_live boolean := false;
  v_blocked boolean := false;
  v_registration_status text := 'in_handshake';
BEGIN
  IF p_action IS DISTINCT FROM 'prepare_entry' THEN
    RETURN public.video_date_transition_20260501091000_pre_date_end_cleanup(
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
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Unauthorized',
      'code', 'UNAUTHORIZED'
    );
  END IF;

  SELECT * INTO v_session
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
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session not found',
      'code', 'SESSION_NOT_FOUND'
    );
  END IF;

  v_ev := v_session.event_id;
  v_p1 := v_session.participant_1_id;
  v_p2 := v_session.participant_2_id;
  v_state_before := v_session.state::text;

  IF v_session.ended_at IS NULL
     AND v_session.reconnect_grace_ends_at IS NOT NULL
     AND v_session.reconnect_grace_ends_at <= v_now THEN
    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'reconnect_grace_expired',
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_session.started_at)))::int)
      ),
      state_updated_at = v_now
    WHERE id = p_session_id;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2)
      AND current_room_id = p_session_id;

    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'success',
      'prepare_entry_reconnect_grace_auto_ended',
      NULL,
      v_ev,
      v_actor,
      p_session_id,
      jsonb_build_object(
        'action', p_action,
        'state_before', v_state_before,
        'state_after', v_session.state::text,
        'p_reason', p_reason
      )
    );

    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session has ended',
      'code', 'SESSION_ENDED',
      'state', 'ended',
      'phase', 'ended',
      'event_id', v_ev,
      'participant_1_id', v_p1,
      'participant_2_id', v_p2,
      'handshake_started_at', v_session.handshake_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  v_is_p1 := (v_p1 = v_actor);
  IF NOT v_is_p1 AND v_p2 != v_actor THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'access_denied',
      NULL,
      v_ev,
      v_actor,
      p_session_id,
      jsonb_build_object(
        'action', p_action,
        'state_before', v_state_before,
        'state_after', v_session.state::text,
        'p_reason', p_reason
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Access denied',
      'code', 'ACCESS_DENIED',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_ev,
      'participant_1_id', v_p1,
      'participant_2_id', v_p2,
      'handshake_started_at', v_session.handshake_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  v_partner := CASE WHEN v_is_p1 THEN v_p2 ELSE v_p1 END;

  SELECT EXISTS (
    SELECT 1
    FROM public.blocked_users bu
    WHERE (bu.blocker_id = v_actor AND bu.blocked_id = v_partner)
       OR (bu.blocker_id = v_partner AND bu.blocked_id = v_actor)
  ) INTO v_blocked;

  IF v_blocked THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'blocked_pair',
      NULL,
      v_ev,
      v_actor,
      p_session_id,
      jsonb_build_object(
        'action', p_action,
        'state_before', v_state_before,
        'state_after', v_session.state::text,
        'p_reason', p_reason
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'error', 'This call is no longer available.',
      'code', 'BLOCKED_PAIR',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_ev,
      'participant_1_id', v_p1,
      'participant_2_id', v_p2,
      'handshake_started_at', v_session.handshake_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  IF v_session.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session has ended',
      'code', 'SESSION_ENDED',
      'state', 'ended',
      'phase', COALESCE(v_session.phase, 'ended'),
      'event_id', v_ev,
      'participant_1_id', v_p1,
      'participant_2_id', v_p2,
      'handshake_started_at', v_session.handshake_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  v_already_entry := (
    v_session.handshake_started_at IS NOT NULL
    OR v_session.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
    OR v_session.date_started_at IS NOT NULL
  );

  v_gate_live := (
    COALESCE(v_session.ready_gate_status, '') = 'both_ready'
    AND v_session.ready_gate_expires_at IS NOT NULL
    AND v_session.ready_gate_expires_at > v_now
  );

  IF NOT v_already_entry AND NOT v_gate_live THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'prepare_entry_ready_gate_not_ready',
      NULL,
      v_ev,
      v_actor,
      p_session_id,
      jsonb_build_object(
        'action', p_action,
        'state_before', v_state_before,
        'state_after', v_session.state::text,
        'ready_gate_status', v_session.ready_gate_status,
        'ready_gate_expires_at', v_session.ready_gate_expires_at,
        'p_reason', p_reason
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Both participants must be ready before starting the video date',
      'code', 'READY_GATE_NOT_READY',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_ev,
      'participant_1_id', v_p1,
      'participant_2_id', v_p2,
      'handshake_started_at', v_session.handshake_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  UPDATE public.video_sessions
  SET
    state = CASE
      WHEN date_started_at IS NOT NULL OR state = 'date'::public.video_date_state THEN state
      ELSE 'handshake'::public.video_date_state
    END,
    phase = CASE
      WHEN date_started_at IS NOT NULL OR phase = 'date' THEN phase
      ELSE 'handshake'
    END,
    handshake_started_at = COALESCE(handshake_started_at, v_now),
    reconnect_grace_ends_at = NULL,
    participant_1_away_at = NULL,
    participant_2_away_at = NULL,
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL;

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

  v_registration_status := CASE
    WHEN v_session.date_started_at IS NOT NULL
      OR v_session.state = 'date'::public.video_date_state
      OR v_session.phase = 'date'
      THEN 'in_date'
    ELSE 'in_handshake'
  END;

  UPDATE public.event_registrations
  SET
    queue_status = v_registration_status,
    current_room_id = p_session_id,
    current_partner_id = CASE
      WHEN profile_id = v_p1 THEN v_p2
      ELSE v_p1
    END,
    last_active_at = v_now
  WHERE event_id = v_ev
    AND profile_id IN (v_p1, v_p2);

  PERFORM public.record_event_loop_observability(
    'video_date_transition',
    'success',
    CASE WHEN v_already_entry THEN 'prepare_entry_already_active' ELSE 'prepare_entry_entered' END,
    NULL,
    v_ev,
    v_actor,
    p_session_id,
    jsonb_build_object(
      'action', p_action,
      'state_before', v_state_before,
      'state_after', v_session.state::text,
      'phase_after', v_session.phase,
      'handshake_started_at', v_session.handshake_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at,
      'registration_status', v_registration_status,
      'p_reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'OK',
    'state', v_session.state::text,
    'phase', v_session.phase,
    'event_id', v_ev,
    'participant_1_id', v_p1,
    'participant_2_id', v_p2,
    'handshake_started_at', v_session.handshake_started_at,
    'ready_gate_status', v_session.ready_gate_status,
    'ready_gate_expires_at', v_session.ready_gate_expires_at
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.video_date_transition(uuid, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Canonical participant-owned video date state machine. prepare_entry atomically syncs reconnect expiry and enters/reuses handshake/date truth for Ready Gate pre-warm; all other actions delegate to the 20260501091000 pre-date end cleanup wrapper.';
