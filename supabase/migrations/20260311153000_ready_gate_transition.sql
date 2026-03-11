-- Stream 2B: Server-owned Ready Gate transitions
-- Goal: move ready_gate_status / ready timestamps / snooze / forfeit into a canonical, backend-authoritative RPC.

CREATE OR REPLACE FUNCTION public.ready_gate_transition(
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
  v_new_status text;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  v_is_p1 := (v_session.participant_1_id = v_actor);
  IF NOT v_is_p1 AND v_session.participant_2_id != v_actor THEN
    RETURN jsonb_build_object('success', false, 'error', 'access_denied');
  END IF;

  -- Do not allow transitions from terminal statuses
  IF v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready') THEN
    RETURN jsonb_build_object('success', true, 'status', v_session.ready_gate_status);
  END IF;

  -- Action: mark_ready (idempotent)
  IF p_action = 'mark_ready' THEN
    IF v_is_p1 AND v_session.ready_participant_1_at IS NULL THEN
      v_session.ready_participant_1_at := v_now;
    ELSIF NOT v_is_p1 AND v_session.ready_participant_2_at IS NULL THEN
      v_session.ready_participant_2_at := v_now;
    END IF;

    IF v_session.ready_participant_1_at IS NOT NULL
       AND v_session.ready_participant_2_at IS NOT NULL THEN
      v_new_status := 'both_ready';
    ELSIF v_is_p1 THEN
      v_new_status := 'ready_a';
    ELSE
      v_new_status := 'ready_b';
    END IF;

    UPDATE public.video_sessions
    SET
      ready_participant_1_at = v_session.ready_participant_1_at,
      ready_participant_2_at = v_session.ready_participant_2_at,
      ready_gate_status = v_new_status
    WHERE id = p_session_id;

    RETURN jsonb_build_object('success', true, 'status', v_new_status);
  END IF;

  -- Action: snooze (idempotent best-effort; later calls extend the window)
  IF p_action = 'snooze' THEN
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'snoozed',
      snoozed_by = v_actor,
      snooze_expires_at = v_now + interval '2 minutes'
    WHERE id = p_session_id;

    RETURN jsonb_build_object('success', true, 'status', 'snoozed');
  END IF;

  -- Action: forfeit / leave
  IF p_action = 'forfeit' THEN
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'forfeited',
      ready_gate_expires_at = v_now,
      snoozed_by = NULL,
      snooze_expires_at = NULL
    WHERE id = p_session_id;

    RETURN jsonb_build_object('success', true, 'status', 'forfeited');
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'unknown_action');
END;
$function$;

