CREATE OR REPLACE FUNCTION public.confirm_video_date_entry_prepared(p_session_id uuid, p_room_name text, p_room_url text, p_entry_attempt_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session public.video_sessions%ROWTYPE;
  v_inactive_reason text;
  v_cleanup jsonb;
  v_already_entry boolean := false;
BEGIN
  IF p_room_name IS NULL
     OR btrim(p_room_name) = ''
     OR p_room_url IS NULL
     OR btrim(p_room_url) = '' THEN
    RETURN public.confirm_vde_event_inactive_base_v1(
      p_session_id,
      p_room_name,
      p_room_url,
      p_entry_attempt_id
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND OR v_session.ended_at IS NOT NULL THEN
    RETURN public.confirm_vde_event_inactive_base_v1(
      p_session_id,
      p_room_name,
      p_room_url,
      p_entry_attempt_id
    );
  END IF;

  v_already_entry := (
    v_session.entry_started_at IS NOT NULL
    OR v_session.date_started_at IS NOT NULL
    OR v_session.daily_room_name IS NOT NULL
    OR v_session.daily_room_url IS NOT NULL
    OR v_session.participant_1_joined_at IS NOT NULL
    OR v_session.participant_2_joined_at IS NOT NULL
    OR v_session.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
    OR COALESCE(v_session.phase, '') IN ('entry', 'date')
  );

  IF NOT v_already_entry THEN
    v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);

    IF v_inactive_reason IS NOT NULL THEN
      v_cleanup := public.terminalize_event_ready_gates(v_session.event_id, v_inactive_reason);

      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;

      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'blocked',
        'confirm_prepare_entry_event_inactive',
        NULL,
        v_session.event_id,
        NULL,
        p_session_id,
        jsonb_build_object(
          'entry_attempt_id', p_entry_attempt_id,
          'inactive_reason', v_inactive_reason,
          'cleanup', v_cleanup
        )
      );

      RETURN jsonb_build_object(
        'success', false,
        'error', 'Event is no longer active',
        'code', 'READY_GATE_NOT_READY',
        'error_code', 'EVENT_NOT_ACTIVE',
        'reason', 'event_not_active',
        'inactive_reason', v_inactive_reason,
        'state', COALESCE(v_session.state::text, 'ended'),
        'phase', COALESCE(v_session.phase, 'ended'),
        'event_id', v_session.event_id,
        'participant_1_id', v_session.participant_1_id,
        'participant_2_id', v_session.participant_2_id,
        'entry_started_at', v_session.entry_started_at,
        'ready_gate_status', v_session.ready_gate_status,
        'ready_gate_expires_at', v_session.ready_gate_expires_at,
        'terminal', v_session.ended_at IS NOT NULL
      );
    END IF;
  END IF;

  RETURN public.confirm_vde_event_inactive_base_v1(
    p_session_id,
    p_room_name,
    p_room_url,
    p_entry_attempt_id
  );
END;
$function$
