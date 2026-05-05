-- Guard Daily join stamping so solo prejoin cannot make a Ready Gate routeable.
--
-- prepare_solo_entry may let a first-ready participant enter the provider room
-- early, but only prepare_date_entry/confirm_video_date_entry_prepared may make
-- the app session routeable. This RPC therefore refuses to stamp Daily join
-- presence until both-ready route truth exists.

CREATE OR REPLACE FUNCTION public.mark_video_date_daily_joined(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.video_sessions%ROWTYPE;
  v_status text;
  v_now timestamptz := now();
  v_started_handshake boolean := false;
  v_routeable boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_row.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_ended');
  END IF;

  IF v_uid IS DISTINCT FROM v_row.participant_1_id AND v_uid IS DISTINCT FROM v_row.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  v_routeable :=
    v_row.ready_gate_status = 'both_ready'
    AND (
      v_row.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
      OR v_row.phase IN ('handshake', 'date')
      OR v_row.handshake_started_at IS NOT NULL
      OR v_row.date_started_at IS NOT NULL
    );

  IF NOT v_routeable THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'not_routeable',
      'ready_gate_status', v_row.ready_gate_status,
      'state', v_row.state,
      'phase', v_row.phase
    );
  END IF;

  IF v_uid = v_row.participant_1_id THEN
    UPDATE public.video_sessions
    SET participant_1_joined_at = COALESCE(participant_1_joined_at, v_now)
    WHERE id = p_session_id;
  ELSE
    UPDATE public.video_sessions
    SET participant_2_joined_at = COALESCE(participant_2_joined_at, v_now)
    WHERE id = p_session_id;
  END IF;

  SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;

  IF v_row.date_started_at IS NULL
     AND v_row.handshake_started_at IS NULL
     AND v_row.participant_1_joined_at IS NOT NULL
     AND v_row.participant_2_joined_at IS NOT NULL THEN
    UPDATE public.video_sessions
    SET
      handshake_started_at = v_now,
      state = 'handshake'::public.video_date_state,
      phase = 'handshake',
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND date_started_at IS NULL
      AND handshake_started_at IS NULL
      AND participant_1_joined_at IS NOT NULL
      AND participant_2_joined_at IS NOT NULL
    RETURNING * INTO v_row;

    IF FOUND THEN
      v_started_handshake := true;
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'success',
        'handshake_started_after_both_daily_joined',
        NULL,
        v_row.event_id,
        v_uid,
        p_session_id,
        jsonb_build_object(
          'action', 'mark_video_date_daily_joined',
          'handshake_started_at', v_row.handshake_started_at,
          'participant_1_joined_at', v_row.participant_1_joined_at,
          'participant_2_joined_at', v_row.participant_2_joined_at
        )
      );
    ELSE
      SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id;
    END IF;
  END IF;

  v_status := CASE
    WHEN v_row.date_started_at IS NOT NULL
      OR v_row.state = 'date'::public.video_date_state
      OR v_row.phase = 'date'
      THEN 'in_date'
    ELSE 'in_handshake'
  END;

  UPDATE public.event_registrations
  SET
    queue_status = v_status,
    current_room_id = p_session_id,
    current_partner_id = CASE
      WHEN profile_id = v_row.participant_1_id THEN v_row.participant_2_id
      ELSE v_row.participant_1_id
    END,
    last_active_at = v_now
  WHERE event_id = v_row.event_id
    AND profile_id IN (v_row.participant_1_id, v_row.participant_2_id);

  RETURN jsonb_build_object(
    'ok', true,
    'queue_status', v_status,
    'handshake_started', v_started_handshake,
    'handshake_started_at', v_row.handshake_started_at,
    'participant_1_joined_at', v_row.participant_1_joined_at,
    'participant_2_joined_at', v_row.participant_2_joined_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_video_date_daily_joined(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_daily_joined(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.mark_video_date_daily_joined(uuid) IS
  'Idempotent Daily join stamp for routeable Video Date sessions only. Solo prejoin calls before both-ready prepared route truth return not_routeable without mutating registration or join stamps.';
