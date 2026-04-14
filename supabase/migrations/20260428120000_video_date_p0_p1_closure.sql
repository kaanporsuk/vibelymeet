-- Video Dates P0/P1 closure: server timeouts, ready-gate both_ready refresh,
-- participant status allowlist, beforeunload partner reconciliation,
-- canonical user report RPC.

-- ─── 1) Handshake / date phase expiry (server-owned; aligns with web HANDSHAKE_TIME=60, DATE_TIME=300) ───
CREATE OR REPLACE FUNCTION public.expire_stale_video_date_phases()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  r record;
  v_h int := 0;
  v_d int := 0;
  v_ev uuid;
  v_p1 uuid;
  v_p2 uuid;
BEGIN
  -- Icebreaker handshake exceeded (60s product window + 30s buffer). Skip while reconnect grace is open.
  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, handshake_started_at, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'handshake'::public.video_date_state
      AND handshake_started_at IS NOT NULL
      AND handshake_started_at + interval '90 seconds' <= v_now
      AND NOT (
        reconnect_grace_ends_at IS NOT NULL
        AND reconnect_grace_ends_at > v_now
      )
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_ev := r.event_id;
    v_p1 := r.participant_1_id;
    v_p2 := r.participant_2_id;

    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'handshake_timeout',
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(r.handshake_started_at, r.started_at))))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2);

    v_h := v_h + 1;
  END LOOP;

  -- Main date phase exceeded (300s + 60s buffer). Skip while reconnect grace is open.
  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, date_started_at, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'date'::public.video_date_state
      AND date_started_at IS NOT NULL
      AND date_started_at + interval '360 seconds' <= v_now
      AND NOT (
        reconnect_grace_ends_at IS NOT NULL
        AND reconnect_grace_ends_at > v_now
      )
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_ev := r.event_id;
    v_p1 := r.participant_1_id;
    v_p2 := r.participant_2_id;

    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'date_timeout',
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(r.date_started_at, r.started_at))))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id;

    UPDATE public.event_registrations
    SET
      queue_status = 'in_survey',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2);

    v_d := v_d + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'handshake_timeout', v_h,
    'date_timeout', v_d,
    'total', v_h + v_d
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_stale_video_date_phases() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_video_date_phases() FROM authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_video_date_phases() FROM anon;

COMMENT ON FUNCTION public.expire_stale_video_date_phases() IS
  'Ends stale handshake (60s+30s buffer) and date (300s+60s buffer) phases using persisted video_sessions timestamps. Skips active reconnect-grace windows. Invoked from expire_stale_video_sessions / pg_cron.';

-- ─── 2) Instrumented expire_stale_video_sessions: both_ready expiry + phase expiry hook ───
CREATE OR REPLACE FUNCTION public.expire_stale_video_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  v_ms integer;
  v_now timestamptz := now();
  r record;
  n int := 0;
  v_new_status text;
  v_orphans int := 0;
  v_snooze int := 0;
  v_queued_ttl int := 0;
  v_ready_exp int := 0;
  v_both_ready_exp int := 0;
  v_phase jsonb;
  v_phase_total int := 0;
BEGIN
  FOR r IN
    SELECT id, ready_participant_1_at, ready_participant_2_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND ready_gate_status = 'snoozed'
      AND snooze_expires_at IS NOT NULL
      AND snooze_expires_at <= v_now
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_new_status :=
      CASE
        WHEN r.ready_participant_1_at IS NOT NULL AND r.ready_participant_2_at IS NOT NULL THEN 'both_ready'
        WHEN r.ready_participant_1_at IS NOT NULL THEN 'ready_a'
        WHEN r.ready_participant_2_at IS NOT NULL THEN 'ready_b'
        ELSE 'ready'
      END;

    UPDATE public.video_sessions
    SET
      ready_gate_status = v_new_status,
      snoozed_by = NULL,
      snooze_expires_at = NULL,
      ready_gate_expires_at = v_now + interval '30 seconds',
      state_updated_at = v_now
    WHERE id = r.id;

    n := n + 1;
    v_snooze := v_snooze + 1;
  END LOOP;

  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND ready_gate_status = 'queued'
      AND COALESCE(queued_expires_at, COALESCE(started_at, v_now) + interval '10 minutes') <= v_now
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'expired',
      queued_expires_at = NULL,
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'queued_ttl_expired',
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - r.started_at)))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = r.event_id
      AND profile_id IN (r.participant_1_id, r.participant_2_id)
      AND current_room_id = r.id;

    n := n + 1;
    v_queued_ttl := v_queued_ttl + 1;
  END LOOP;

  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND ready_gate_status IN ('ready', 'ready_a', 'ready_b')
      AND ready_gate_expires_at IS NOT NULL
      AND ready_gate_expires_at <= v_now
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'expired',
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'ready_gate_expired',
      snoozed_by = NULL,
      snooze_expires_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - r.started_at)))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = r.event_id
      AND profile_id IN (r.participant_1_id, r.participant_2_id)
      AND current_room_id = r.id;

    n := n + 1;
    v_ready_exp := v_ready_exp + 1;
  END LOOP;

  -- both_ready promotion window (refreshed when second participant taps ready). Expire if still idle on gate.
  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND ready_gate_status = 'both_ready'
      AND ready_gate_expires_at IS NOT NULL
      AND ready_gate_expires_at <= v_now
      AND state NOT IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'expired',
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'ready_gate_expired',
      snoozed_by = NULL,
      snooze_expires_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - r.started_at)))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = r.event_id
      AND profile_id IN (r.participant_1_id, r.participant_2_id)
      AND current_room_id = r.id;

    n := n + 1;
    v_both_ready_exp := v_both_ready_exp + 1;
  END LOOP;

  UPDATE public.event_registrations er
  SET
    queue_status = 'idle',
    current_room_id = NULL,
    current_partner_id = NULL,
    last_active_at = v_now
  FROM public.video_sessions vs
  WHERE er.current_room_id = vs.id
    AND vs.ended_at IS NOT NULL
    AND er.queue_status = 'in_ready_gate';

  GET DIAGNOSTICS v_orphans = ROW_COUNT;
  n := n + v_orphans;

  v_phase := public.expire_stale_video_date_phases();
  v_phase_total := COALESCE((v_phase->>'total')::int, 0);
  n := n + v_phase_total;

  v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;

  PERFORM public.record_event_loop_observability(
    'expire_stale_video_sessions',
    CASE WHEN n > 0 THEN 'success' ELSE 'no_op' END,
    NULL,
    v_ms,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'total_mutations', n,
      'snooze_wake', v_snooze,
      'queued_ttl_expired', v_queued_ttl,
      'ready_gate_expired', v_ready_exp,
      'both_ready_expired', v_both_ready_exp,
      'handshake_timeout', COALESCE((v_phase->>'handshake_timeout')::int, 0),
      'date_timeout', COALESCE((v_phase->>'date_timeout')::int, 0),
      'hygiene_orphans', v_orphans
    )
  );

  RETURN n;
END;
$function$;

COMMENT ON FUNCTION public.expire_stale_video_sessions() IS
  'Canonical cleanup for queued TTL, ready-gate (incl. both_ready), snooze wake-up, orphan in_ready_gate pointers, and handshake/date phase timeouts. Safe for pg_cron.';

-- ─── 3) ready_gate_transition: refresh ready_gate_expires_at when transitioning to both_ready ───
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

  PERFORM public.expire_stale_video_sessions();

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  v_is_p1 := (v_session.participant_1_id = v_actor);
  IF NOT v_is_p1 AND v_session.participant_2_id != v_actor THEN
    RETURN jsonb_build_object('success', false, 'error', 'access_denied');
  END IF;

  IF p_action = 'sync' THEN
    RETURN jsonb_build_object(
      'success', true,
      'status', v_session.ready_gate_status,
      'ready_participant_1_at', v_session.ready_participant_1_at,
      'ready_participant_2_at', v_session.ready_participant_2_at,
      'ready_gate_expires_at', v_session.ready_gate_expires_at,
      'snoozed_by', v_session.snoozed_by,
      'snooze_expires_at', v_session.snooze_expires_at
    );
  END IF;

  IF v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready') THEN
    RETURN jsonb_build_object('success', true, 'status', v_session.ready_gate_status);
  END IF;

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
      ready_gate_status = v_new_status,
      ready_gate_expires_at = CASE
        WHEN v_new_status = 'both_ready' THEN v_now + interval '30 seconds'
        ELSE COALESCE(ready_gate_expires_at, v_now + interval '30 seconds')
      END
    WHERE id = p_session_id;

    RETURN jsonb_build_object('success', true, 'status', v_new_status);
  END IF;

  IF p_action = 'snooze' THEN
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'snoozed',
      snoozed_by = v_actor,
      snooze_expires_at = v_now + interval '2 minutes',
      ready_gate_expires_at = v_now + interval '2 minutes'
    WHERE id = p_session_id;

    RETURN jsonb_build_object('success', true, 'status', 'snoozed');
  END IF;

  IF p_action = 'forfeit' THEN
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'forfeited',
      ready_gate_expires_at = v_now,
      queued_expires_at = NULL,
      snoozed_by = NULL,
      snooze_expires_at = NULL,
      state = 'ended',
      phase = 'ended',
      ended_at = COALESCE(ended_at, v_now),
      ended_reason = COALESCE(p_reason, ended_reason, 'ready_gate_forfeit'),
      state_updated_at = v_now
    WHERE id = p_session_id;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_session.event_id
      AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);

    RETURN jsonb_build_object('success', true, 'status', 'forfeited');
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'unknown_action');
END;
$function$;

-- ─── 4) video_date_transition: beforeunload only offline for actor; partner → in_survey ───
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
  v_allow_handshake boolean;
  v_ev uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_rowcnt bigint;
  v_partner uuid;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized', 'code', 'UNAUTHORIZED');
  END IF;

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
  END IF;

  v_ev := v_session.event_id;
  v_p1 := v_session.participant_1_id;
  v_p2 := v_session.participant_2_id;

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
      AND profile_id IN (v_p1, v_p2);

    RETURN jsonb_build_object(
      'success', true,
      'state', 'ended',
      'reason', 'reconnect_grace_expired'
    );
  END IF;

  v_is_p1 := (v_p1 = v_actor);
  IF NOT v_is_p1 AND v_p2 != v_actor THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied', 'code', 'ACCESS_DENIED');
  END IF;

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
  v_ev := v_session.event_id;
  v_p1 := v_session.participant_1_id;
  v_p2 := v_session.participant_2_id;

  IF p_action = 'sync_reconnect' THEN
    RETURN jsonb_build_object(
      'success', true,
      'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at,
      'participant_1_away_at', v_session.participant_1_away_at,
      'participant_2_away_at', v_session.participant_2_away_at,
      'ended', v_session.ended_at IS NOT NULL,
      'ended_reason', v_session.ended_reason,
      'state', v_session.state::text,
      'phase', v_session.phase,
      'partner_marked_away',
        CASE
          WHEN v_is_p1 THEN v_session.participant_2_away_at IS NOT NULL
          ELSE v_session.participant_1_away_at IS NOT NULL
        END
    );
  END IF;

  IF p_action = 'mark_reconnect_partner_away' THEN
    IF v_session.ended_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Session has ended', 'code', 'SESSION_ENDED');
    END IF;
    IF v_session.state NOT IN ('handshake'::public.video_date_state, 'date'::public.video_date_state) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Not in reconnect-eligible phase', 'code', 'INVALID_PHASE');
    END IF;

    UPDATE public.video_sessions
    SET
      participant_1_away_at = CASE WHEN v_is_p1 THEN participant_1_away_at ELSE v_now END,
      participant_2_away_at = CASE WHEN v_is_p1 THEN v_now ELSE participant_2_away_at END,
      reconnect_grace_ends_at = COALESCE(reconnect_grace_ends_at, v_now + interval '30 seconds'),
      state_updated_at = v_now
    WHERE id = p_session_id;

    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

    RETURN jsonb_build_object(
      'success', true,
      'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at,
      'participant_1_away_at', v_session.participant_1_away_at,
      'participant_2_away_at', v_session.participant_2_away_at
    );
  END IF;

  IF p_action = 'mark_reconnect_return' THEN
    IF v_session.ended_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Session has ended', 'code', 'SESSION_ENDED');
    END IF;

    UPDATE public.video_sessions
    SET
      participant_1_away_at = CASE WHEN v_is_p1 THEN NULL ELSE participant_1_away_at END,
      participant_2_away_at = CASE WHEN v_is_p1 THEN participant_2_away_at ELSE NULL END,
      state_updated_at = v_now
    WHERE id = p_session_id;

    UPDATE public.video_sessions
    SET
      reconnect_grace_ends_at = CASE
        WHEN participant_1_away_at IS NULL AND participant_2_away_at IS NULL THEN NULL
        ELSE reconnect_grace_ends_at
      END,
      state_updated_at = v_now
    WHERE id = p_session_id;

    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

    RETURN jsonb_build_object(
      'success', true,
      'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at,
      'participant_1_away_at', v_session.participant_1_away_at,
      'participant_2_away_at', v_session.participant_2_away_at
    );
  END IF;

  IF p_action = 'enter_handshake' THEN
    IF v_session.ended_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Session has ended', 'code', 'SESSION_ENDED');
    END IF;

    IF v_session.handshake_started_at IS NULL THEN
      v_allow_handshake :=
        COALESCE(v_session.ready_gate_status, '') = 'both_ready'
        OR v_session.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
        OR v_session.phase IN ('handshake', 'date');

      IF NOT v_allow_handshake THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Both participants must be ready before starting the video date',
          'code', 'READY_GATE_NOT_READY'
        );
      END IF;
    END IF;

    UPDATE public.video_sessions
    SET
      state = 'handshake',
      phase = 'handshake',
      handshake_started_at = COALESCE(handshake_started_at, v_now),
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = 'in_handshake',
      current_room_id = p_session_id,
      current_partner_id = CASE
        WHEN profile_id = v_p1 THEN v_p2
        ELSE v_p1
      END,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2);

    RETURN jsonb_build_object('success', true, 'state', 'handshake');
  END IF;

  IF p_action = 'vibe' THEN
    IF v_is_p1 THEN
      UPDATE public.video_sessions
      SET participant_1_liked = TRUE, state_updated_at = v_now
      WHERE id = p_session_id AND ended_at IS NULL;
    ELSE
      UPDATE public.video_sessions
      SET participant_2_liked = TRUE, state_updated_at = v_now
      WHERE id = p_session_id AND ended_at IS NULL;
    END IF;

    UPDATE public.video_sessions
    SET
      state = 'date',
      phase = 'date',
      date_started_at = COALESCE(date_started_at, v_now),
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND participant_1_liked IS TRUE
      AND participant_2_liked IS TRUE;

    GET DIAGNOSTICS v_rowcnt = ROW_COUNT;
    IF v_rowcnt > 0 THEN
      UPDATE public.event_registrations
      SET
        queue_status = 'in_date',
        current_room_id = p_session_id,
        current_partner_id = CASE
          WHEN profile_id = v_p1 THEN v_p2
          ELSE v_p1
        END,
        last_active_at = v_now
      WHERE event_id = v_ev
        AND profile_id IN (v_p1, v_p2);
    END IF;

    RETURN jsonb_build_object('success', true);
  END IF;

  IF p_action = 'complete_handshake' THEN
    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
    v_ev := v_session.event_id;
    v_p1 := v_session.participant_1_id;
    v_p2 := v_session.participant_2_id;

    IF v_session.participant_1_liked IS TRUE AND v_session.participant_2_liked IS TRUE THEN
      UPDATE public.video_sessions
      SET
        state = 'date',
        phase = 'date',
        date_started_at = COALESCE(date_started_at, v_now),
        reconnect_grace_ends_at = NULL,
        participant_1_away_at = NULL,
        participant_2_away_at = NULL,
        state_updated_at = v_now
      WHERE id = p_session_id AND ended_at IS NULL;

      UPDATE public.event_registrations
      SET
        queue_status = 'in_date',
        current_room_id = p_session_id,
        current_partner_id = CASE
          WHEN profile_id = v_p1 THEN v_p2
          ELSE v_p1
        END,
        last_active_at = v_now
      WHERE event_id = v_ev
        AND profile_id IN (v_p1, v_p2);

      RETURN jsonb_build_object('success', true, 'state', 'date');
    END IF;

    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = COALESCE(ended_at, v_now),
      ended_reason = COALESCE(p_reason, 'handshake_not_mutual'),
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(v_session.handshake_started_at, v_session.started_at))))::int)
      ),
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2);

    RETURN jsonb_build_object('success', true, 'state', 'ended');
  END IF;

  IF p_action = 'end' THEN
    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = COALESCE(ended_at, v_now),
      ended_reason = COALESCE(p_reason, ended_reason, 'ended_by_participant'),
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

    IF COALESCE(p_reason, '') = 'beforeunload' THEN
      v_partner := CASE WHEN v_actor = v_p1 THEN v_p2 ELSE v_p1 END;
      UPDATE public.event_registrations
      SET
        queue_status = 'offline',
        current_room_id = NULL,
        current_partner_id = NULL,
        last_active_at = v_now
      WHERE event_id = v_ev
        AND profile_id = v_actor;

      UPDATE public.event_registrations
      SET
        queue_status = 'in_survey',
        current_room_id = NULL,
        current_partner_id = NULL,
        last_active_at = v_now
      WHERE event_id = v_ev
        AND profile_id = v_partner;
    ELSIF COALESCE(p_reason, '') = 'reconnect_grace_expired' THEN
      UPDATE public.event_registrations
      SET
        queue_status = 'idle',
        current_room_id = NULL,
        current_partner_id = NULL,
        last_active_at = v_now
      WHERE event_id = v_ev
        AND profile_id IN (v_p1, v_p2);
    ELSE
      UPDATE public.event_registrations
      SET
        queue_status = 'in_survey',
        current_room_id = NULL,
        current_partner_id = NULL,
        last_active_at = v_now
      WHERE event_id = v_ev
        AND profile_id IN (v_p1, v_p2);
    END IF;

    RETURN jsonb_build_object('success', true, 'state', 'ended');
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'Unknown action', 'code', 'UNKNOWN_ACTION');
END;
$function$;

-- ─── 5) update_participant_status: narrow allowlist (presence / lobby / survey only) ───
CREATE OR REPLACE FUNCTION public.update_participant_status(
  p_event_id uuid,
  p_status text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_status IS NULL OR btrim(p_status) = '' THEN
    RETURN;
  END IF;

  IF lower(btrim(p_status)) NOT IN (
    'browsing',
    'idle',
    'in_ready_gate',
    'in_survey',
    'offline'
  ) THEN
    RETURN;
  END IF;

  UPDATE public.event_registrations
  SET queue_status = lower(btrim(p_status)), last_active_at = now()
  WHERE event_id = p_event_id AND profile_id = v_uid;
END;
$function$;

-- ─── 6) Canonical report submission (validation + rate limit + optional block) ───
CREATE OR REPLACE FUNCTION public.submit_user_report(
  p_reported_id uuid,
  p_reason text,
  p_details text DEFAULT NULL,
  p_also_block boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_trim_reason text;
  v_details text;
  v_recent int;
  v_report_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF p_reported_id IS NULL OR p_reported_id = v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_target');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_reported_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'reported_not_found');
  END IF;

  v_trim_reason := lower(btrim(COALESCE(p_reason, '')));
  IF v_trim_reason NOT IN (
    'harassment',
    'fake',
    'inappropriate',
    'spam',
    'safety',
    'underage',
    'other'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_reason');
  END IF;

  v_details := NULLIF(left(btrim(COALESCE(p_details, '')), 4000), '');

  SELECT count(*)::int
  INTO v_recent
  FROM public.user_reports
  WHERE reporter_id = v_uid
    AND created_at > now() - interval '1 hour';

  IF v_recent >= 20 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rate_limited');
  END IF;

  INSERT INTO public.user_reports (
    reporter_id,
    reported_id,
    reason,
    details,
    also_blocked
  )
  VALUES (
    v_uid,
    p_reported_id,
    v_trim_reason,
    v_details,
    COALESCE(p_also_block, false)
  )
  RETURNING id INTO v_report_id;

  IF COALESCE(p_also_block, false) THEN
    INSERT INTO public.blocked_users (blocker_id, blocked_id, reason)
    VALUES (v_uid, p_reported_id, 'Reported: ' || v_trim_reason)
    ON CONFLICT (blocker_id, blocked_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'report_id', v_report_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.submit_user_report(uuid, text, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.submit_user_report(uuid, text, text, boolean) IS
  'Server-owned user report path: validates reason, trims details, rate-limits (20/hour), optional block with duplicate tolerance.';
