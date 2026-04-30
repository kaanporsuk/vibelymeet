-- Ready Gate event-inactive terminalization and stale prepare-entry guard.
--
-- Stream 1 blocks new Event Lobby actions outside the live event window.
-- Stream 2 makes Ready Gate actions truthful at expiry boundaries.
-- This migration closes the remaining backend gap for Ready Gates that already
-- exist when an event ends/cancels/archives or naturally falls outside its live
-- window, and prevents stale both_ready rows from preparing Daily entry.

CREATE OR REPLACE FUNCTION public.terminalize_event_ready_gates(
  p_event_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_inactive_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_terminal_reason text;
  v_total integer := 0;
  v_row_count integer := 0;
  v_registration_rows integer := 0;
  r public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
BEGIN
  IF p_event_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'invalid_event_id',
      'terminalized', 0
    );
  END IF;

  IF v_inactive_reason IS NULL THEN
    v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);
  END IF;

  IF v_inactive_reason IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'event_id', p_event_id,
      'inactive_reason', NULL,
      'terminalized', 0
    );
  END IF;

  v_terminal_reason := CASE v_inactive_reason
    WHEN 'event_archived' THEN 'ready_gate_event_archived'
    WHEN 'event_cancelled' THEN 'ready_gate_event_cancelled'
    WHEN 'event_ended' THEN 'ready_gate_event_ended'
    WHEN 'event_outside_live_window' THEN 'ready_gate_event_ended'
    ELSE 'ready_gate_event_inactive'
  END;

  -- Target only pre-date Ready Gate rows. Provider-prepared/date-capable rows
  -- are intentionally excluded so already-started handshakes/dates can finish.
  FOR r IN
    SELECT vs.*
    FROM public.video_sessions vs
    WHERE vs.event_id = p_event_id
      AND vs.ended_at IS NULL
      AND vs.state = 'ready_gate'::public.video_date_state
      AND vs.ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready')
      AND vs.handshake_started_at IS NULL
      AND vs.date_started_at IS NULL
      AND vs.daily_room_name IS NULL
      AND vs.daily_room_url IS NULL
      AND vs.participant_1_joined_at IS NULL
      AND vs.participant_2_joined_at IS NULL
      AND COALESCE(vs.phase, 'ready_gate') NOT IN ('handshake', 'date')
    ORDER BY COALESCE(vs.ready_gate_expires_at, vs.queued_expires_at, vs.started_at), vs.id
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'expired',
      ready_gate_expires_at = COALESCE(ready_gate_expires_at, v_now),
      queued_expires_at = NULL,
      snoozed_by = NULL,
      snooze_expires_at = NULL,
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ended_at = v_now,
      ended_reason = v_terminal_reason,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id
      AND ended_at IS NULL
      AND state = 'ready_gate'::public.video_date_state
      AND ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready')
      AND handshake_started_at IS NULL
      AND date_started_at IS NULL
      AND daily_room_name IS NULL
      AND daily_room_url IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
      AND COALESCE(phase, 'ready_gate') NOT IN ('handshake', 'date')
    RETURNING * INTO v_after;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;

    IF v_row_count > 0 THEN
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
          OR (
            current_room_id IS NULL
            AND current_partner_id IN (v_after.participant_1_id, v_after.participant_2_id)
          )
          OR queue_status = 'in_ready_gate'
        );

      GET DIAGNOSTICS v_registration_rows = ROW_COUNT;

      PERFORM public.record_event_loop_observability(
        'ready_gate_transition',
        'success',
        'READY_GATE_EVENT_ENDED',
        NULL,
        v_after.event_id,
        NULL,
        v_after.id,
        jsonb_build_object(
          'inactive_reason', v_inactive_reason,
          'terminal_reason', v_terminal_reason,
          'previous_ready_gate_status', r.ready_gate_status,
          'previous_state', r.state::text,
          'previous_phase', r.phase,
          'registration_rows', v_registration_rows,
          'provider_prepared_excluded', false
        )
      );

      v_total := v_total + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'inactive_reason', v_inactive_reason,
    'terminal_reason', v_terminal_reason,
    'terminalized', v_total
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.terminalize_event_ready_gates(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.terminalize_event_ready_gates(uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.terminalize_event_ready_gates(uuid, text) IS
  'Internal Ready Gate cleanup for inactive events. Terminalizes only pre-date ready_gate rows, excludes provider-prepared handshake/date evidence, clears affected registration pointers to idle, and emits READY_GATE_EVENT_ENDED observability.';

CREATE OR REPLACE FUNCTION public.handle_event_ready_gate_terminalization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inactive_reason text;
BEGIN
  v_inactive_reason := public.get_event_lobby_inactive_reason(NEW.id);

  IF v_inactive_reason IS NOT NULL
     AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.ended_at IS DISTINCT FROM OLD.ended_at
       OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
     ) THEN
    PERFORM public.terminalize_event_ready_gates(NEW.id, v_inactive_reason);
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_event_ready_gate_terminalization()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_event_ready_gate_terminalization()
  TO service_role;

COMMENT ON FUNCTION public.handle_event_ready_gate_terminalization() IS
  'Events lifecycle trigger function that closes pre-date Ready Gates when status, ended_at, or archived_at makes the event inactive.';

DROP TRIGGER IF EXISTS events_terminalize_ready_gates_on_inactive ON public.events;
CREATE TRIGGER events_terminalize_ready_gates_on_inactive
AFTER UPDATE OF status, ended_at, archived_at ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.handle_event_ready_gate_terminalization();

DROP FUNCTION IF EXISTS public.ready_gate_transition_20260501200000_event_inactive_base(uuid, text, text);

ALTER FUNCTION public.ready_gate_transition(uuid, text, text)
  RENAME TO ready_gate_transition_20260501200000_event_inactive_base;

REVOKE ALL ON FUNCTION public.ready_gate_transition_20260501200000_event_inactive_base(uuid, text, text)
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
  v_session public.video_sessions%ROWTYPE;
  v_inactive_reason text;
  v_cleanup jsonb;
  v_date_capable boolean := false;
BEGIN
  IF p_action NOT IN ('sync', 'mark_ready', 'snooze') THEN
    RETURN public.ready_gate_transition_20260501200000_event_inactive_base(
      p_session_id,
      p_action,
      p_reason
    );
  END IF;

  IF v_actor IS NULL THEN
    RETURN public.ready_gate_transition_20260501200000_event_inactive_base(
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
    RETURN public.ready_gate_transition_20260501200000_event_inactive_base(
      p_session_id,
      p_action,
      p_reason
    );
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_actor
     AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
    RETURN public.ready_gate_transition_20260501200000_event_inactive_base(
      p_session_id,
      p_action,
      p_reason
    );
  END IF;

  -- Natural live-window expiry has no event-row trigger, so participant sync,
  -- ready, and snooze actions detect event inactivity under the locked session.
  v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);

  IF v_inactive_reason IS NOT NULL THEN
    v_cleanup := public.terminalize_event_ready_gates(v_session.event_id, v_inactive_reason);

    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    v_date_capable := (
      v_session.handshake_started_at IS NOT NULL
      OR v_session.date_started_at IS NOT NULL
      OR v_session.daily_room_name IS NOT NULL
      OR v_session.daily_room_url IS NOT NULL
      OR v_session.participant_1_joined_at IS NOT NULL
      OR v_session.participant_2_joined_at IS NOT NULL
      OR v_session.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
      OR COALESCE(v_session.phase, '') IN ('handshake', 'date')
    );

    IF v_session.ended_at IS NOT NULL OR v_session.ready_gate_status = 'expired' THEN
      RETURN jsonb_build_object(
        'success', true,
        'status', v_session.ready_gate_status,
        'ready_gate_status', v_session.ready_gate_status,
        'ready_gate_expires_at', v_session.ready_gate_expires_at,
        'reason', COALESCE(v_session.ended_reason, 'ready_gate_event_ended'),
        'inactive_reason', v_inactive_reason,
        'error_code', COALESCE(v_session.ended_reason, 'ready_gate_event_ended'),
        'terminal', true,
        'event_id', v_session.event_id
      );
    END IF;

    IF p_action = 'sync' OR v_date_capable THEN
      RETURN jsonb_build_object(
        'success', true,
        'status', v_session.ready_gate_status,
        'ready_gate_status', v_session.ready_gate_status,
        'ready_participant_1_at', v_session.ready_participant_1_at,
        'ready_participant_2_at', v_session.ready_participant_2_at,
        'ready_gate_expires_at', v_session.ready_gate_expires_at,
        'snoozed_by', v_session.snoozed_by,
        'snooze_expires_at', v_session.snooze_expires_at,
        'reason', 'event_not_active',
        'inactive_reason', v_inactive_reason,
        'date_capable', v_date_capable,
        'terminal', false,
        'event_id', v_session.event_id,
        'cleanup', v_cleanup
      );
    END IF;

    PERFORM public.record_event_loop_observability(
      'ready_gate_transition',
      'blocked',
      'READY_GATE_EVENT_ENDED',
      NULL,
      v_session.event_id,
      v_actor,
      p_session_id,
      jsonb_build_object(
        'action', p_action,
        'p_reason', p_reason,
        'inactive_reason', v_inactive_reason,
        'cleanup', v_cleanup
      )
    );

    RETURN jsonb_build_object(
      'success', false,
      'error', 'event_not_active',
      'code', 'EVENT_NOT_ACTIVE',
      'error_code', 'EVENT_NOT_ACTIVE',
      'reason', 'event_not_active',
      'inactive_reason', v_inactive_reason,
      'status', v_session.ready_gate_status,
      'ready_gate_status', v_session.ready_gate_status,
      'ready_gate_expires_at', v_session.ready_gate_expires_at,
      'terminal', false,
      'event_id', v_session.event_id
    );
  END IF;

  RETURN public.ready_gate_transition_20260501200000_event_inactive_base(
    p_session_id,
    p_action,
    p_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ready_gate_transition(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ready_gate_transition(uuid, text, text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.ready_gate_transition(uuid, text, text) IS
  'Canonical Ready Gate transition RPC. Adds event-inactive cleanup and stale sync/ready/snooze blocking before delegating active-event behavior to the Stream 2 rowcount/expiry-hardened implementation.';

DROP FUNCTION IF EXISTS public.video_date_transition_20260501200000_event_inactive_base(uuid, text, text);

ALTER FUNCTION public.video_date_transition(uuid, text, text)
  RENAME TO video_date_transition_20260501200000_event_inactive_base;

REVOKE ALL ON FUNCTION public.video_date_transition_20260501200000_event_inactive_base(uuid, text, text)
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
  v_actor uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_inactive_reason text;
  v_cleanup jsonb;
  v_already_entry boolean := false;
BEGIN
  IF p_action IS DISTINCT FROM 'prepare_entry' THEN
    RETURN public.video_date_transition_20260501200000_event_inactive_base(
      p_session_id,
      p_action,
      p_reason
    );
  END IF;

  IF v_actor IS NULL THEN
    RETURN public.video_date_transition_20260501200000_event_inactive_base(
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
    RETURN public.video_date_transition_20260501200000_event_inactive_base(
      p_session_id,
      p_action,
      p_reason
    );
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_actor
     AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
    RETURN public.video_date_transition_20260501200000_event_inactive_base(
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

  -- Block stale both_ready -> Daily handoff after event inactivity, while
  -- preserving already-prepared handshakes/dates for normal event end.
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
        'prepare_entry_event_inactive',
        NULL,
        v_session.event_id,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', p_action,
          'p_reason', p_reason,
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
        'handshake_started_at', v_session.handshake_started_at,
        'ready_gate_status', v_session.ready_gate_status,
        'ready_gate_expires_at', v_session.ready_gate_expires_at,
        'terminal', v_session.ended_at IS NOT NULL
      );
    END IF;
  END IF;

  RETURN public.video_date_transition_20260501200000_event_inactive_base(
    p_session_id,
    p_action,
    p_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_transition(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_transition(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Canonical participant-owned video date state machine. Adds stale prepare_entry event-inactive blocking before delegating active/prepared behavior to the prior implementation.';

DROP FUNCTION IF EXISTS public.confirm_video_date_entry_prepared_20260501200000_event_inactive_base(uuid, text, text, text);

ALTER FUNCTION public.confirm_video_date_entry_prepared(uuid, text, text, text)
  RENAME TO confirm_video_date_entry_prepared_20260501200000_event_inactive_base;

REVOKE ALL ON FUNCTION public.confirm_video_date_entry_prepared_20260501200000_event_inactive_base(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_video_date_entry_prepared_20260501200000_event_inactive_base(uuid, text, text, text)
  TO service_role;

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
  v_inactive_reason text;
  v_cleanup jsonb;
  v_already_entry boolean := false;
BEGIN
  IF p_room_name IS NULL
     OR btrim(p_room_name) = ''
     OR p_room_url IS NULL
     OR btrim(p_room_url) = '' THEN
    RETURN public.confirm_video_date_entry_prepared_20260501200000_event_inactive_base(
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
    RETURN public.confirm_video_date_entry_prepared_20260501200000_event_inactive_base(
      p_session_id,
      p_room_name,
      p_room_url,
      p_entry_attempt_id
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
        'handshake_started_at', v_session.handshake_started_at,
        'ready_gate_status', v_session.ready_gate_status,
        'ready_gate_expires_at', v_session.ready_gate_expires_at,
        'terminal', v_session.ended_at IS NOT NULL
      );
    END IF;
  END IF;

  RETURN public.confirm_video_date_entry_prepared_20260501200000_event_inactive_base(
    p_session_id,
    p_room_name,
    p_room_url,
    p_entry_attempt_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_video_date_entry_prepared(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_video_date_entry_prepared(uuid, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.confirm_video_date_entry_prepared(uuid, text, text, text) IS
  'Service-role-only provider-atomic transition. Rejects inactive-event pre-entry confirmation for unprepared Ready Gates, while preserving already-prepared handshakes/dates.';
