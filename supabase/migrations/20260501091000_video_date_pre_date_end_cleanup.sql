-- Video Date pre-date end cleanup:
-- `video_date_transition('end')` must not send users to survey unless the
-- session actually reached date phase. Keep the previous state machine intact
-- for every non-end action by delegating to the prior implementation.

DROP FUNCTION IF EXISTS public.video_date_transition_20260430180000_last_chance_grace_10s(uuid, text, text);

ALTER FUNCTION public.video_date_transition(uuid, text, text)
  RENAME TO video_date_transition_20260430180000_last_chance_grace_10s;

REVOKE ALL ON FUNCTION public.video_date_transition_20260430180000_last_chance_grace_10s(uuid, text, text)
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
  v_rowcnt bigint;
  v_partner uuid;
  v_state_before text;
  v_reached_date_phase boolean;
  v_event_live boolean := false;
  v_resume_status text := 'idle';
  v_end_reason text;
BEGIN
  IF p_action IS DISTINCT FROM 'end' THEN
    RETURN public.video_date_transition_20260430180000_last_chance_grace_10s(
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

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
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

  v_ev := v_session.event_id;
  v_p1 := v_session.participant_1_id;
  v_p2 := v_session.participant_2_id;

  -- Preserve the previous reconnect-grace expiry behavior. A date-phase row
  -- remains survey-eligible through `date_started_at`; pre-date rows do not.
  IF v_session.ended_at IS NULL
     AND v_session.reconnect_grace_ends_at IS NOT NULL
     AND v_session.reconnect_grace_ends_at <= v_now THEN
    v_state_before := v_session.state::text;

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
      'reconnect_grace_auto_ended',
      NULL,
      v_ev,
      v_actor,
      p_session_id,
      jsonb_build_object(
        'action', p_action,
        'participant_1_liked', v_session.participant_1_liked,
        'participant_2_liked', v_session.participant_2_liked,
        'state_before', v_state_before,
        'state_after', v_session.state::text,
        'grace_expires_at', v_session.handshake_grace_expires_at,
        'p_reason', p_reason,
        'survey_eligible', v_session.date_started_at IS NOT NULL
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'state', 'ended',
      'reason', 'reconnect_grace_expired',
      'survey_eligible', v_session.date_started_at IS NOT NULL
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
        'participant_1_liked', v_session.participant_1_liked,
        'participant_2_liked', v_session.participant_2_liked,
        'state_before', v_session.state::text,
        'state_after', v_session.state::text,
        'grace_expires_at', v_session.handshake_grace_expires_at,
        'p_reason', p_reason
      )
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

  SELECT EXISTS (
    SELECT 1
    FROM public.events ev
    WHERE ev.id = v_ev
      AND ev.status = 'live'
      AND ev.archived_at IS NULL
  ) INTO v_event_live;

  v_resume_status := CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END;

  IF v_reached_date_phase THEN
    v_end_reason := COALESCE(p_reason, v_session.ended_reason, 'ended_by_participant');
  ELSE
    v_end_reason := CASE
      WHEN COALESCE(p_reason, '') IN (
        'ready_gate_forfeit',
        'ready_gate_expired',
        'queued_ttl_expired',
        'handshake_not_mutual',
        'handshake_grace_expired',
        'handshake_timeout',
        'blocked_pair',
        'reconnect_grace_expired'
      ) THEN p_reason
      ELSE 'pre_date_manual_end'
    END;
  END IF;

  v_state_before := v_session.state::text;

  UPDATE public.video_sessions
  SET
    state = 'ended',
    phase = 'ended',
    ended_at = v_now,
    ended_reason = v_end_reason,
    reconnect_grace_ends_at = NULL,
    participant_1_away_at = NULL,
    participant_2_away_at = NULL,
    duration_seconds = COALESCE(
      duration_seconds,
      GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_session.started_at)))::int)
    ),
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL;

  GET DIAGNOSTICS v_rowcnt = ROW_COUNT;
  IF v_rowcnt = 0 THEN
    RETURN jsonb_build_object('success', true, 'state', 'ended', 'already_ended', true);
  END IF;

  IF v_reached_date_phase AND COALESCE(p_reason, '') = 'reconnect_grace_expired' THEN
    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2)
      AND current_room_id = p_session_id;
  ELSIF v_reached_date_phase THEN
    UPDATE public.event_registrations
    SET
      queue_status = 'in_survey',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2)
      AND current_room_id = p_session_id;
  ELSE
    -- Pre-date termination is not survey-eligible. Clear only registrations
    -- still pointing at this session so a newer ready gate/date cannot be
    -- overwritten by stale cleanup.
    UPDATE public.event_registrations
    SET
      queue_status = v_resume_status,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2)
      AND current_room_id = p_session_id;
  END IF;

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
  PERFORM public.record_event_loop_observability(
    'video_date_transition',
    'success',
    CASE WHEN v_reached_date_phase THEN 'date_end_survey' ELSE 'pre_date_end_cleanup' END,
    NULL,
    v_ev,
    v_actor,
    p_session_id,
    jsonb_build_object(
      'action', p_action,
      'participant_1_liked', v_session.participant_1_liked,
      'participant_2_liked', v_session.participant_2_liked,
      'participant_1_decided_at', v_session.participant_1_decided_at,
      'participant_2_decided_at', v_session.participant_2_decided_at,
      'state_before', v_state_before,
      'state_after', v_session.state::text,
      'grace_expires_at', v_session.handshake_grace_expires_at,
      'p_reason', p_reason,
      'ended_reason', v_end_reason,
      'survey_eligible', v_reached_date_phase,
      'registration_resume_status',
        CASE
          WHEN v_reached_date_phase AND COALESCE(p_reason, '') = 'reconnect_grace_expired' THEN 'idle'
          WHEN v_reached_date_phase THEN 'in_survey'
          ELSE v_resume_status
        END
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'state', 'ended',
    'reason', v_end_reason,
    'survey_eligible', v_reached_date_phase,
    'registration_status',
      CASE
        WHEN v_reached_date_phase AND COALESCE(p_reason, '') = 'reconnect_grace_expired' THEN 'idle'
        WHEN v_reached_date_phase THEN 'in_survey'
        ELSE v_resume_status
      END
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.video_date_transition(uuid, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Canonical participant-owned video date state machine. Delegates all non-end actions to the 20260430180000 implementation; end action now routes only sessions that reached date phase to survey and cleans pre-date sessions back to lobby/deck state.';
