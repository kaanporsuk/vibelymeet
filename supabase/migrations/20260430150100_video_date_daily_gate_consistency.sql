-- Canonicalize ready-gate rows so legacy `phase` cannot drift ahead of `state`
-- and create mixed truths like `state = ready_gate` + `phase = handshake`.
-- Daily entry must use `state` / `handshake_started_at` / live `both_ready` gate,
-- never `phase` alone.

ALTER TABLE public.video_sessions
  ALTER COLUMN phase SET DEFAULT 'ready_gate';

COMMENT ON COLUMN public.video_sessions.phase IS
  'Legacy compatibility field. Ready Gate and Daily entry must gate on state, handshake_started_at, and ready_gate_status/ready_gate_expires_at, never phase alone.';

UPDATE public.video_sessions
SET
  state = 'ready_gate',
  phase = 'ready_gate',
  state_updated_at = now()
WHERE ended_at IS NULL
  AND state = 'ready_gate'::public.video_date_state
  AND handshake_started_at IS NULL
  AND date_started_at IS NULL
  AND participant_1_joined_at IS NULL
  AND participant_2_joined_at IS NULL
  AND phase IS DISTINCT FROM 'ready_gate';

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
        WHEN v_new_status = 'both_ready' THEN ready_gate_expires_at
        ELSE COALESCE(ready_gate_expires_at, v_now + interval '30 seconds')
      END,
      state = 'ready_gate',
      phase = 'ready_gate',
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND handshake_started_at IS NULL
      AND date_started_at IS NULL;

    RETURN jsonb_build_object('success', true, 'status', v_new_status);
  END IF;

  IF p_action = 'snooze' THEN
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'snoozed',
      snoozed_by = v_actor,
      snooze_expires_at = v_now + interval '2 minutes',
      ready_gate_expires_at = v_now + interval '2 minutes',
      state = 'ready_gate',
      phase = 'ready_gate',
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND handshake_started_at IS NULL
      AND date_started_at IS NULL;

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
  v_rowcnt int := 0;
BEGIN
  FOR r IN
    SELECT id, ready_participant_1_at, ready_participant_2_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND ready_gate_status = 'snoozed'
      AND snooze_expires_at IS NOT NULL
      AND snooze_expires_at <= v_now
      AND state = 'ready_gate'::public.video_date_state
      AND handshake_started_at IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
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
      phase = 'ready_gate',
      state_updated_at = v_now
    WHERE id = r.id
      AND ended_at IS NULL
      AND state = 'ready_gate'::public.video_date_state
      AND handshake_started_at IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL;

    GET DIAGNOSTICS v_rowcnt = ROW_COUNT;
    IF v_rowcnt > 0 THEN
      n := n + 1;
      v_snooze := v_snooze + 1;
    END IF;
  END LOOP;

  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND ready_gate_status = 'queued'
      AND COALESCE(queued_expires_at, COALESCE(started_at, v_now) + interval '10 minutes') <= v_now
      AND state = 'ready_gate'::public.video_date_state
      AND handshake_started_at IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
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
    WHERE id = r.id
      AND ended_at IS NULL
      AND state = 'ready_gate'::public.video_date_state
      AND handshake_started_at IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL;

    GET DIAGNOSTICS v_rowcnt = ROW_COUNT;
    IF v_rowcnt = 0 THEN
      CONTINUE;
    END IF;

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
      AND state = 'ready_gate'::public.video_date_state
      AND handshake_started_at IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
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
    WHERE id = r.id
      AND ended_at IS NULL
      AND state = 'ready_gate'::public.video_date_state
      AND handshake_started_at IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL;

    GET DIAGNOSTICS v_rowcnt = ROW_COUNT;
    IF v_rowcnt = 0 THEN
      CONTINUE;
    END IF;

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

  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND ready_gate_status = 'both_ready'
      AND ready_gate_expires_at IS NOT NULL
      AND ready_gate_expires_at <= v_now
      AND state = 'ready_gate'::public.video_date_state
      AND handshake_started_at IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
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
    WHERE id = r.id
      AND ended_at IS NULL
      AND state = 'ready_gate'::public.video_date_state
      AND handshake_started_at IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL;

    GET DIAGNOSTICS v_rowcnt = ROW_COUNT;
    IF v_rowcnt = 0 THEN
      CONTINUE;
    END IF;

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
  'Canonical cleanup for queued TTL, ready-gate, snooze wake-up, orphan in_ready_gate pointers, and handshake/date phase timeouts. Ready-gate expiry only applies before handshake_started_at or Daily joined stamps exist.';

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
  v_status text;
  v_current_status text;
  v_current_room_id uuid;
  v_has_active_joined_session boolean := false;
  v_has_recent_joined_end boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_status IS NULL OR btrim(p_status) = '' THEN
    RETURN;
  END IF;

  v_status := lower(btrim(p_status));
  IF v_status NOT IN (
    'browsing',
    'idle',
    'in_ready_gate',
    'in_survey',
    'offline'
  ) THEN
    RETURN;
  END IF;

  SELECT queue_status, current_room_id
  INTO v_current_status, v_current_room_id
  FROM public.event_registrations
  WHERE event_id = p_event_id
    AND profile_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_status IN ('browsing', 'idle', 'in_ready_gate', 'offline')
     AND v_current_room_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.video_sessions vs
      WHERE vs.id = v_current_room_id
        AND vs.ended_at IS NULL
        AND (
          vs.handshake_started_at IS NOT NULL
          OR vs.participant_1_joined_at IS NOT NULL
          OR vs.participant_2_joined_at IS NOT NULL
          OR vs.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
        )
    )
    INTO v_has_active_joined_session;

    IF v_has_active_joined_session THEN
      RETURN;
    END IF;
  END IF;

  IF v_status = 'offline' AND v_current_status = 'in_survey' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND v_uid IN (vs.participant_1_id, vs.participant_2_id)
        AND vs.ended_at IS NOT NULL
        AND vs.ended_at > now() - interval '30 seconds'
        AND (
          vs.handshake_started_at IS NOT NULL
          OR vs.participant_1_joined_at IS NOT NULL
          OR vs.participant_2_joined_at IS NOT NULL
          OR vs.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state, 'ended'::public.video_date_state)
        )
    )
    INTO v_has_recent_joined_end;

    IF v_has_recent_joined_end THEN
      RETURN;
    END IF;
  END IF;

  UPDATE public.event_registrations
  SET queue_status = v_status, last_active_at = now()
  WHERE event_id = p_event_id AND profile_id = v_uid;
END;
$function$;

COMMENT ON FUNCTION public.update_participant_status(uuid, text) IS
  'Client-writable event presence/status with guards that prevent client unloads from regressing active joined video-date or fresh survey state.';
