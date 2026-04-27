-- Sprint A: provider-atomic video-date entry.
-- `prepare_entry` is now a preflight-only validation. The routeable handshake
-- state is confirmed only after Daily room metadata, token creation, and
-- registration persistence have all succeeded.

DROP FUNCTION IF EXISTS public.video_date_transition_20260501110000_provider_atomic_base(uuid, text, text);

ALTER FUNCTION public.video_date_transition(uuid, text, text)
  RENAME TO video_date_transition_20260501110000_provider_atomic_base;

REVOKE ALL ON FUNCTION public.video_date_transition_20260501110000_provider_atomic_base(uuid, text, text)
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
  v_actor_away_at timestamptz;
BEGIN
  IF p_action IS DISTINCT FROM 'prepare_entry' THEN
    RETURN public.video_date_transition_20260501110000_provider_atomic_base(
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
    RETURN jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
  END IF;

  v_ev := v_session.event_id;
  v_p1 := v_session.participant_1_id;
  v_p2 := v_session.participant_2_id;
  v_state_before := v_session.state::text;
  v_is_p1 := (v_p1 = v_actor);

  IF NOT v_is_p1 AND v_p2 != v_actor THEN
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
  v_actor_away_at := CASE WHEN v_is_p1 THEN v_session.participant_1_away_at ELSE v_session.participant_2_away_at END;

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
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - started_at)))::int)
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

  SELECT EXISTS (
    SELECT 1
    FROM public.blocked_users bu
    WHERE (bu.blocker_id = v_actor AND bu.blocked_id = v_partner)
       OR (bu.blocker_id = v_partner AND bu.blocked_id = v_actor)
  ) INTO v_blocked;

  IF v_blocked THEN
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

  IF v_actor_away_at IS NOT NULL
     AND v_session.reconnect_grace_ends_at IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Reconnect sync required before prepare entry',
      'code', 'RECONNECT_SYNC_REQUIRED',
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
        'p_reason', p_reason,
        'preflight_only', true
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

  PERFORM public.record_event_loop_observability(
    'video_date_transition',
    'success',
    CASE WHEN v_already_entry THEN 'prepare_entry_preflight_already_active' ELSE 'prepare_entry_preflight_ok' END,
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
      'registration_status', 'deferred_until_confirm_prepare_entry',
      'preflight_only', true,
      'p_reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'OK',
    'preflight_only', true,
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
  'Canonical participant-owned video date state machine. prepare_entry is provider-atomic preflight only; routeable handshake/date truth is confirmed by confirm_video_date_entry_prepared after Daily proof.';

DROP FUNCTION IF EXISTS public.confirm_video_date_entry_prepared(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.confirm_video_date_entry_prepared(
  p_session_id uuid,
  p_room_name text,
  p_room_url text,
  p_entry_attempt_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_gate_live boolean := false;
  v_already_entry boolean := false;
  v_blocked boolean := false;
  v_registration_count integer := 0;
  v_update_count integer := 0;
  v_queue_status text;
BEGIN
  IF p_room_name IS NULL
     OR btrim(p_room_name) = ''
     OR p_room_url IS NULL
     OR btrim(p_room_url) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Daily room metadata is required',
      'code', 'DB_ROOM_PERSIST_FAILED'
    );
  END IF;

  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
  END IF;

  IF v_session.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Session has ended',
      'code', 'SESSION_ENDED',
      'state', 'ended',
      'phase', COALESCE(v_session.phase, 'ended'),
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'handshake_started_at', v_session.handshake_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.blocked_users bu
    WHERE (bu.blocker_id = v_session.participant_1_id AND bu.blocked_id = v_session.participant_2_id)
       OR (bu.blocker_id = v_session.participant_2_id AND bu.blocked_id = v_session.participant_1_id)
  ) INTO v_blocked;

  IF v_blocked THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'This call is no longer available.',
      'code', 'BLOCKED_PAIR',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
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
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Both participants must be ready before starting the video date',
      'code', 'READY_GATE_NOT_READY',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'handshake_started_at', v_session.handshake_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  SELECT count(*) INTO v_registration_count
  FROM (
    SELECT 1
    FROM public.event_registrations
    WHERE event_id = v_session.event_id
      AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
    FOR UPDATE
  ) locked_registrations;

  IF v_registration_count IS DISTINCT FROM 2 THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'confirm_prepare_entry_registration_missing',
      NULL,
      v_session.event_id,
      NULL,
      p_session_id,
      jsonb_build_object(
        'entry_attempt_id', p_entry_attempt_id,
        'registration_count', v_registration_count
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Could not persist date routing state',
      'code', 'REGISTRATION_PERSIST_FAILED',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'handshake_started_at', v_session.handshake_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  v_queue_status := CASE
    WHEN v_session.date_started_at IS NOT NULL
      OR v_session.state = 'date'::public.video_date_state
      OR v_session.phase = 'date'
      THEN 'in_date'
    ELSE 'in_handshake'
  END;

  UPDATE public.event_registrations
  SET
    queue_status = v_queue_status,
    current_room_id = v_session.id,
    current_partner_id = CASE
      WHEN profile_id = v_session.participant_1_id THEN v_session.participant_2_id
      ELSE v_session.participant_1_id
    END,
    last_active_at = v_now
  WHERE event_id = v_session.event_id
    AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);

  GET DIAGNOSTICS v_update_count = ROW_COUNT;
  IF v_update_count IS DISTINCT FROM 2 THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'confirm_prepare_entry_registration_update_failed',
      NULL,
      v_session.event_id,
      NULL,
      p_session_id,
      jsonb_build_object(
        'entry_attempt_id', p_entry_attempt_id,
        'updated_count', v_update_count
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Could not persist date routing state',
      'code', 'REGISTRATION_PERSIST_FAILED',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'handshake_started_at', v_session.handshake_started_at,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at
    );
  END IF;

  UPDATE public.video_sessions
  SET
    daily_room_name = p_room_name,
    daily_room_url = p_room_url,
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
    AND ended_at IS NULL
  RETURNING * INTO v_session;

  PERFORM public.record_event_loop_observability(
    'video_date_transition',
    'success',
    'confirm_prepare_entry_prepared',
    NULL,
    v_session.event_id,
    NULL,
    p_session_id,
    jsonb_build_object(
      'entry_attempt_id', p_entry_attempt_id,
      'state_after', v_session.state::text,
      'phase_after', v_session.phase,
      'room_metadata_persisted', true,
      'registration_status', v_queue_status
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', 'OK',
    'state', v_session.state::text,
    'phase', v_session.phase,
    'event_id', v_session.event_id,
    'participant_1_id', v_session.participant_1_id,
    'participant_2_id', v_session.participant_2_id,
    'handshake_started_at', v_session.handshake_started_at,
    'ready_gate_status', v_session.ready_gate_status,
    'ready_gate_expires_at', v_session.ready_gate_expires_at,
    'daily_room_name', v_session.daily_room_name,
    'daily_room_url', v_session.daily_room_url,
    'entry_attempt_id', p_entry_attempt_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_video_date_entry_prepared(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_video_date_entry_prepared(uuid, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.confirm_video_date_entry_prepared(uuid, text, text, text) IS
  'Service-role-only final provider-atomic transition: confirms Daily room metadata, registration routing, and routeable handshake state after token creation.';
