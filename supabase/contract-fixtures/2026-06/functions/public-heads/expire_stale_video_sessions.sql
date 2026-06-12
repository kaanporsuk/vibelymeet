CREATE OR REPLACE FUNCTION public.expire_stale_video_sessions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_limit integer := 100;

  v_total integer := 0;

  v_recovery jsonb;

  v_repaired integer := 0;

  v_phase jsonb;
  v_now timestamptz := now();

  r record;

  v_rows integer := 0;

  v_registration_rows integer := 0;

  v_base integer := 0;

  v_extended integer := 0;
BEGIN
  -- (fold of expire_stale_video_sessions_bounded) ready-gate room recovery
  v_recovery := public.recover_ready_gate_missing_rooms_v1(v_limit, 20, 120);
  v_total := v_total + COALESCE((v_recovery->>'terminalized')::integer, 0);

  -- (fold of *_202605232020_base) stale pre-date ready-gate blocker repair
  v_repaired := public.terminalize_stale_pre_date_ready_gate_blockers(
    v_limit,
    'expire_stale_video_sessions'
  );
  v_total := v_total + COALESCE(v_repaired, 0);

  -- (fold of *_202605060900_base) prepare-entry lease guard + expiry
  -- Defensive compatibility: if a lease exists from a previous deploy window,
  -- make the legacy ready_gate_expires_at guard match the lease so delegated
  -- cleanup cannot expire an active provider handoff.
  UPDATE public.video_sessions
  SET
    ready_gate_expires_at = prepare_entry_expires_at,
    state_updated_at = v_now
  WHERE ended_at IS NULL
    AND state = 'ready_gate'::public.video_date_state
    AND ready_gate_status = 'both_ready'
    AND prepare_entry_expires_at IS NOT NULL
    AND prepare_entry_expires_at > v_now
    AND (ready_gate_expires_at IS NULL OR ready_gate_expires_at < prepare_entry_expires_at)
    AND date_started_at IS NULL
    AND entry_started_at IS NULL
    AND daily_room_name IS NULL
    AND daily_room_url IS NULL
    AND participant_1_joined_at IS NULL
    AND participant_2_joined_at IS NULL;

  GET DIAGNOSTICS v_extended = ROW_COUNT;

  FOR r IN
    SELECT *
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'ready_gate'::public.video_date_state
      AND ready_gate_status = 'both_ready'
      AND prepare_entry_expires_at IS NOT NULL
      AND prepare_entry_expires_at <= v_now
      AND date_started_at IS NULL
      AND entry_started_at IS NULL
      AND daily_room_name IS NULL
      AND daily_room_url IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
    ORDER BY prepare_entry_expires_at, id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'expired',
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'prepare_entry_timeout',
      prepare_entry_started_at = NULL,
      prepare_entry_expires_at = NULL,
      prepare_entry_attempt_id = NULL,
      prepare_entry_actor_id = NULL,
      snoozed_by = NULL,
      snooze_expires_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id
      AND ended_at IS NULL
      AND state = 'ready_gate'::public.video_date_state
      AND ready_gate_status = 'both_ready'
      AND prepare_entry_expires_at IS NOT NULL
      AND prepare_entry_expires_at <= v_now
      AND date_started_at IS NULL
      AND entry_started_at IS NULL
      AND daily_room_name IS NULL
      AND daily_room_url IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
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

    GET DIAGNOSTICS v_registration_rows = ROW_COUNT;

    PERFORM public.record_event_loop_observability(
      'expire_stale_video_sessions',
      'success',
      'prepare_entry_timeout',
      NULL,
      r.event_id,
      r.prepare_entry_actor_id,
      r.id,
      jsonb_build_object(
        'entry_attempt_id', r.prepare_entry_attempt_id,
        'prepare_entry_started_at', r.prepare_entry_started_at,
        'prepare_entry_expires_at', r.prepare_entry_expires_at,
        'registration_rows', v_registration_rows
      )
    );

    v_base := v_base + 1;
  END LOOP;

  -- (fold of *_202605031300_base) phase expiry + prepare-entry repair
  v_phase := public.expire_stale_video_date_phases_bounded(v_limit);
  v_base := v_base + COALESCE((v_phase->>'total')::integer, 0)
    + COALESCE(public.repair_stale_video_date_prepare_entries(v_limit), 0);

  IF v_extended > 0 THEN
    PERFORM public.record_event_loop_observability(
      'expire_stale_video_sessions',
      'no_op',
      'active_prepare_entry_lease_preserved',
      NULL,
      NULL,
      NULL,
      NULL,
      jsonb_build_object('extended_rows', v_extended)
    );
  END IF;

  v_total := v_total + COALESCE(v_base, 0);
  RETURN v_total;
END;
$function$
