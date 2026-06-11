CREATE OR REPLACE FUNCTION private_video_date.vdt_prepare_payload(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_attempt_id text := NULLIF(substring(COALESCE(p_reason, '') FROM '^entry_attempt:(.+)$'), '');
  v_already_entry boolean := false;
  v_active_lease boolean := false;
  v_gate_live boolean := false;
  v_inactive_reason text;
  v_lease_expires_at timestamptz;
  v_previous_lease_expires_at timestamptz;
BEGIN
  IF p_action IS DISTINCT FROM 'prepare_entry' THEN
    RETURN private_video_date.vdt_prepare_lease(
      p_session_id,
      p_action,
      p_reason
    );
  END IF;

  IF v_actor IS NULL THEN
    RETURN private_video_date.vdt_prepare_lease(
      p_session_id,
      p_action,
      p_reason
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN private_video_date.vdt_prepare_lease(
      p_session_id,
      p_action,
      p_reason
    );
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_actor
     AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
    RETURN private_video_date.vdt_prepare_lease(
      p_session_id,
      p_action,
      p_reason
    );
  END IF;

  v_already_entry := (
    v_session.handshake_started_at IS NOT NULL
    OR v_session.date_started_at IS NOT NULL
    OR v_session.daily_room_name IS NOT NULL
    OR v_session.daily_room_url IS NOT NULL
    OR v_session.participant_1_joined_at IS NOT NULL
    OR v_session.participant_2_joined_at IS NOT NULL
    OR v_session.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
    OR COALESCE(v_session.phase, '') IN ('handshake', 'date')
  );

  IF NOT v_already_entry AND v_session.ended_at IS NULL THEN
    v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);

    IF v_inactive_reason IS NULL THEN
      v_active_lease := (
        v_session.prepare_entry_expires_at IS NOT NULL
        AND v_session.prepare_entry_expires_at > v_now
      );
      v_gate_live := (
        v_session.ready_gate_status = 'both_ready'
        AND v_session.ready_gate_expires_at IS NOT NULL
        AND v_session.ready_gate_expires_at > v_now
      );

      IF v_session.state = 'ready_gate'::public.video_date_state
         AND v_session.ready_gate_status = 'both_ready'
         AND (v_gate_live OR v_active_lease)
         AND v_session.date_started_at IS NULL
         AND v_session.handshake_started_at IS NULL
         AND v_session.daily_room_name IS NULL
         AND v_session.daily_room_url IS NULL
         AND v_session.participant_1_joined_at IS NULL
         AND v_session.participant_2_joined_at IS NULL THEN
        v_previous_lease_expires_at := v_session.prepare_entry_expires_at;
        v_lease_expires_at := GREATEST(
          COALESCE(v_session.prepare_entry_expires_at, v_now),
          v_now + interval '90 seconds'
        );

        UPDATE public.video_sessions
        SET
          prepare_entry_started_at = COALESCE(prepare_entry_started_at, v_now),
          prepare_entry_expires_at = v_lease_expires_at,
          prepare_entry_attempt_id = COALESCE(NULLIF(prepare_entry_attempt_id, ''), v_attempt_id),
          prepare_entry_actor_id = COALESCE(prepare_entry_actor_id, v_actor),
          ready_gate_expires_at = GREATEST(
            COALESCE(ready_gate_expires_at, v_now),
            v_lease_expires_at
          ),
          state_updated_at = v_now
        WHERE id = p_session_id
          AND ended_at IS NULL
          AND state = 'ready_gate'::public.video_date_state
          AND ready_gate_status = 'both_ready'
          AND date_started_at IS NULL
          AND handshake_started_at IS NULL
          AND daily_room_name IS NULL
          AND daily_room_url IS NULL
          AND participant_1_joined_at IS NULL
          AND participant_2_joined_at IS NULL
        RETURNING * INTO v_session;

        IF FOUND THEN
          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'success',
            CASE
              WHEN v_previous_lease_expires_at IS NULL THEN 'prepare_entry_lease_started'
              ELSE 'prepare_entry_lease_refreshed'
            END,
            NULL,
            v_session.event_id,
            v_actor,
            p_session_id,
            jsonb_build_object(
              'action', p_action,
              'p_reason', p_reason,
              'entry_attempt_id', v_attempt_id,
              'prepare_entry_started_at', v_session.prepare_entry_started_at,
              'prepare_entry_expires_at', v_session.prepare_entry_expires_at,
              'previous_prepare_entry_expires_at', v_previous_lease_expires_at,
              'ready_gate_expires_at', v_session.ready_gate_expires_at,
              'routeable', false
            )
          );
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN private_video_date.vdt_prepare_lease(
    p_session_id,
    p_action,
    p_reason
  );
END;
$function$
