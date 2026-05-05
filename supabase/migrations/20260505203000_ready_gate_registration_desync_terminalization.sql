-- Ready Gate registration-desync terminalization.
--
-- Existing Ready Gate expiry/event-inactive wrappers protect session truth, but
-- dashboard/home active-session banners can still observe a stale participant
-- registration pointing at a pre-date Ready Gate after the peer has already
-- left. Keep the public RPC signature stable and close those pre-date gates
-- after the current transition stack has produced nonterminal Ready Gate truth.

DROP FUNCTION IF EXISTS public.ready_gate_transition_20260505203000_registration_desync_base(uuid, text, text);

ALTER FUNCTION public.ready_gate_transition(uuid, text, text)
  RENAME TO ready_gate_transition_20260505203000_registration_desync_base;

REVOKE ALL ON FUNCTION public.ready_gate_transition_20260505203000_registration_desync_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

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
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_session public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_status text;
  v_terminal boolean := false;
  v_p1_ready_gate boolean := false;
  v_p2_ready_gate boolean := false;
  v_missing_participant_registration text := NULL;
  v_row_count integer := 0;
BEGIN
  v_result := public.ready_gate_transition_20260505203000_registration_desync_base(
    p_session_id,
    p_action,
    p_reason
  );

  IF v_actor IS NULL THEN
    RETURN v_result;
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN v_result;
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_actor
     AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
    RETURN v_result;
  END IF;

  v_status := COALESCE(v_result->>'ready_gate_status', v_result->>'status', v_session.ready_gate_status);
  v_terminal := CASE
    WHEN jsonb_typeof(v_result->'terminal') = 'boolean' THEN (v_result->>'terminal')::boolean
    ELSE false
  END;

  -- `both_ready` is a valid pre-provider handoff while its expiry is open.
  -- Other terminal statuses/reasons are owned by the base transition stack.
  IF COALESCE(v_result->>'success', 'true') = 'false'
     OR v_status NOT IN ('ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready')
     OR (v_terminal AND v_status IS DISTINCT FROM 'both_ready')
     OR v_session.ended_at IS NOT NULL
     OR v_session.state IS DISTINCT FROM 'ready_gate'::public.video_date_state
     OR v_session.handshake_started_at IS NOT NULL
     OR v_session.date_started_at IS NOT NULL
     OR v_session.daily_room_name IS NOT NULL
     OR v_session.daily_room_url IS NOT NULL
     OR v_session.participant_1_joined_at IS NOT NULL
     OR v_session.participant_2_joined_at IS NOT NULL
     OR COALESCE(v_session.phase, 'ready_gate') IN ('handshake', 'date')
     OR v_session.ready_gate_expires_at IS NULL
     OR v_session.ready_gate_expires_at <= v_now THEN
    RETURN v_result;
  END IF;

  SELECT er.queue_status = 'in_ready_gate' AND er.current_room_id = p_session_id
  INTO v_p1_ready_gate
  FROM public.event_registrations er
  WHERE er.event_id = v_session.event_id
    AND er.profile_id = v_session.participant_1_id
  FOR UPDATE;

  v_p1_ready_gate := COALESCE(v_p1_ready_gate, false);

  SELECT er.queue_status = 'in_ready_gate' AND er.current_room_id = p_session_id
  INTO v_p2_ready_gate
  FROM public.event_registrations er
  WHERE er.event_id = v_session.event_id
    AND er.profile_id = v_session.participant_2_id
  FOR UPDATE;

  v_p2_ready_gate := COALESCE(v_p2_ready_gate, false);

  IF v_p1_ready_gate AND v_p2_ready_gate THEN
    RETURN v_result;
  END IF;

  v_missing_participant_registration := CASE
    WHEN NOT v_p1_ready_gate AND NOT v_p2_ready_gate THEN 'both'
    WHEN NOT v_p1_ready_gate THEN 'participant_1'
    ELSE 'participant_2'
  END;

  UPDATE public.video_sessions
  SET
    ready_gate_status = 'forfeited',
    ready_gate_expires_at = v_now,
    queued_expires_at = NULL,
    snoozed_by = NULL,
    snooze_expires_at = NULL,
    state = 'ended'::public.video_date_state,
    phase = 'ended',
    ended_at = COALESCE(ended_at, v_now),
    ended_reason = COALESCE(ended_reason, 'ready_gate_registration_desync'),
    duration_seconds = COALESCE(
      duration_seconds,
      GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
    ),
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL
    AND state = 'ready_gate'::public.video_date_state
    AND ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready')
    AND handshake_started_at IS NULL
    AND date_started_at IS NULL
    AND daily_room_name IS NULL
    AND daily_room_url IS NULL
    AND participant_1_joined_at IS NULL
    AND participant_2_joined_at IS NULL
    AND COALESCE(phase, 'ready_gate') NOT IN ('handshake', 'date')
  RETURNING * INTO v_after;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count = 0 THEN
    RETURN v_result;
  END IF;

  UPDATE public.event_registrations
  SET
    queue_status = 'idle',
    current_room_id = NULL,
    current_partner_id = NULL,
    last_active_at = v_now
  WHERE event_id = v_after.event_id
    AND profile_id IN (v_after.participant_1_id, v_after.participant_2_id)
    AND (
      current_room_id = v_after.id
      OR (queue_status = 'in_ready_gate' AND current_room_id IS NULL)
    );

  PERFORM public.record_event_loop_observability(
    'ready_gate_transition',
    'success',
    'ready_gate_registration_desync',
    NULL,
    v_after.event_id,
    v_actor,
    p_session_id,
    jsonb_build_object(
      'action', p_action,
      'p_reason', p_reason,
      'status_before', v_status,
      'missing_participant_registration', v_missing_participant_registration,
      'registration_desync', true
    )
  );

  RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
    'success', true,
    'status', 'forfeited',
    'ready_gate_status', 'forfeited',
    'ready_gate_expires_at', v_after.ready_gate_expires_at,
    'reason', 'ready_gate_registration_desync',
    'error_code', 'ready_gate_registration_desync',
    'terminal', true,
    'registration_desync', true,
    'missing_participant_registration', v_missing_participant_registration,
    'event_id', v_after.event_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ready_gate_transition(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ready_gate_transition(uuid, text, text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.ready_gate_transition(uuid, text, text) IS
  'Canonical Ready Gate transition RPC. Delegates existing transition semantics, then terminalizes stale pre-date Ready Gates when either participant registration no longer points at the same in_ready_gate room.';
