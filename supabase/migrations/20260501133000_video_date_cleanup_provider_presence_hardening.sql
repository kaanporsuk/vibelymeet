-- Sprint 1E: bound stale video-date cleanup and preserve joined/date evidence.
--
-- This is forward-only and intentionally replaces the no-arg cron entrypoint
-- without editing historical migrations. The old delegated implementation is
-- left in place but is no longer called by expire_stale_video_sessions().

CREATE OR REPLACE FUNCTION public.expire_stale_video_date_phases_bounded(
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  r record;
  v_h int := 0;
  v_hg int := 0;
  v_d int := 0;
  v_ev uuid;
  v_p1 uuid;
  v_p2 uuid;
BEGIN
  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, handshake_started_at, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'handshake'::public.video_date_state
      AND date_started_at IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
      AND handshake_grace_expires_at IS NOT NULL
      AND handshake_grace_expires_at <= v_now
      AND NOT (
        reconnect_grace_ends_at IS NOT NULL
        AND reconnect_grace_ends_at > v_now
      )
    ORDER BY handshake_grace_expires_at, id
    LIMIT v_limit
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
      ended_reason = 'handshake_grace_expired',
      handshake_grace_expires_at = NULL,
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(r.handshake_started_at, r.started_at))))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id
      AND ended_at IS NULL
      AND date_started_at IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2)
      AND current_room_id = r.id;

    v_hg := v_hg + 1;
  END LOOP;

  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, handshake_started_at, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'handshake'::public.video_date_state
      AND date_started_at IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
      AND handshake_grace_expires_at IS NULL
      AND handshake_started_at IS NOT NULL
      AND handshake_started_at + interval '90 seconds' <= v_now
      AND NOT (
        reconnect_grace_ends_at IS NOT NULL
        AND reconnect_grace_ends_at > v_now
      )
    ORDER BY handshake_started_at, id
    LIMIT v_limit
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
    WHERE id = r.id
      AND ended_at IS NULL
      AND date_started_at IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2)
      AND current_room_id = r.id;

    v_h := v_h + 1;
  END LOOP;

  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, date_started_at, started_at
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND state = 'date'::public.video_date_state
      AND date_started_at IS NOT NULL
      AND date_started_at
        + ((300 + COALESCE(date_extra_seconds, 0) + 60) * interval '1 second') <= v_now
      AND NOT (
        reconnect_grace_ends_at IS NOT NULL
        AND reconnect_grace_ends_at > v_now
      )
    ORDER BY date_started_at, id
    LIMIT v_limit
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
    WHERE id = r.id
      AND ended_at IS NULL
      AND date_started_at IS NOT NULL;

    UPDATE public.event_registrations
    SET
      queue_status = 'in_survey',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2)
      AND current_room_id = r.id;

    v_d := v_d + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'handshake_timeout', v_h,
    'handshake_grace_expired', v_hg,
    'date_timeout', v_d,
    'limit', v_limit,
    'total', v_h + v_hg + v_d
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_stale_video_date_phases_bounded(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_video_date_phases_bounded(integer) TO service_role;

COMMENT ON FUNCTION public.expire_stale_video_date_phases_bounded(integer) IS
  'Bounded stale video-date phase cleanup. Skips handshake cleanup when joined/date evidence exists; date timeout still routes date sessions to survey.';

CREATE OR REPLACE FUNCTION public.expire_stale_video_sessions_bounded(
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  v_ms integer;
  v_now timestamptz := now();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  r record;
  n int := 0;
  v_new_status text;
  v_idle_orphans int := 0;
  v_survey_orphans int := 0;
  v_orphans int := 0;
  v_snooze int := 0;
  v_queued_ttl int := 0;
  v_ready_exp int := 0;
  v_both_ready_exp int := 0;
  v_phase jsonb;
  v_phase_total int := 0;
  v_repaired int := 0;
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
      AND date_started_at IS NULL
      AND handshake_started_at IS NULL
      AND daily_room_name IS NULL
      AND daily_room_url IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
    ORDER BY snooze_expires_at, id
    LIMIT v_limit
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
      AND date_started_at IS NULL
      AND handshake_started_at IS NULL
      AND daily_room_name IS NULL
      AND daily_room_url IS NULL
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
      AND date_started_at IS NULL
      AND handshake_started_at IS NULL
      AND daily_room_name IS NULL
      AND daily_room_url IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
    ORDER BY COALESCE(queued_expires_at, started_at), id
    LIMIT v_limit
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
      AND date_started_at IS NULL
      AND handshake_started_at IS NULL
      AND daily_room_name IS NULL
      AND daily_room_url IS NULL
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
      AND date_started_at IS NULL
      AND handshake_started_at IS NULL
      AND daily_room_name IS NULL
      AND daily_room_url IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
    ORDER BY ready_gate_expires_at, id
    LIMIT v_limit
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
      AND date_started_at IS NULL
      AND handshake_started_at IS NULL
      AND daily_room_name IS NULL
      AND daily_room_url IS NULL
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
      AND date_started_at IS NULL
      AND handshake_started_at IS NULL
      AND daily_room_name IS NULL
      AND daily_room_url IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
    ORDER BY ready_gate_expires_at, id
    LIMIT v_limit
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
      AND date_started_at IS NULL
      AND handshake_started_at IS NULL
      AND daily_room_name IS NULL
      AND daily_room_url IS NULL
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

  WITH survey_candidates AS (
    SELECT er.event_id, er.profile_id
    FROM public.event_registrations er
    JOIN public.video_sessions vs ON er.current_room_id = vs.id
    WHERE vs.ended_at IS NOT NULL
      AND vs.date_started_at IS NOT NULL
      AND COALESCE(vs.ended_reason, '') NOT IN (
        'ready_gate_forfeit',
        'ready_gate_expired',
        'queued_ttl_expired',
        'handshake_not_mutual',
        'handshake_grace_expired',
        'handshake_timeout',
        'blocked_pair'
      )
      AND er.queue_status = 'in_ready_gate'
    ORDER BY vs.ended_at, vs.id, er.profile_id
    LIMIT v_limit
  )
  UPDATE public.event_registrations er
  SET
    queue_status = 'in_survey',
    current_room_id = NULL,
    current_partner_id = NULL,
    last_active_at = v_now
  FROM survey_candidates sc
  WHERE er.event_id = sc.event_id
    AND er.profile_id = sc.profile_id;

  GET DIAGNOSTICS v_survey_orphans = ROW_COUNT;

  WITH idle_candidates AS (
    SELECT er.event_id, er.profile_id
    FROM public.event_registrations er
    JOIN public.video_sessions vs ON er.current_room_id = vs.id
    WHERE vs.ended_at IS NOT NULL
      AND (
        vs.date_started_at IS NULL
        OR COALESCE(vs.ended_reason, '') IN (
          'ready_gate_forfeit',
          'ready_gate_expired',
          'queued_ttl_expired',
          'handshake_not_mutual',
          'handshake_grace_expired',
          'handshake_timeout',
          'blocked_pair'
        )
      )
      AND er.queue_status = 'in_ready_gate'
    ORDER BY vs.ended_at, vs.id, er.profile_id
    LIMIT v_limit
  )
  UPDATE public.event_registrations er
  SET
    queue_status = 'idle',
    current_room_id = NULL,
    current_partner_id = NULL,
    last_active_at = v_now
  FROM idle_candidates ic
  WHERE er.event_id = ic.event_id
    AND er.profile_id = ic.profile_id;

  GET DIAGNOSTICS v_idle_orphans = ROW_COUNT;
  v_orphans := v_survey_orphans + v_idle_orphans;
  n := n + v_orphans;

  v_phase := public.expire_stale_video_date_phases_bounded(v_limit);
  v_phase_total := COALESCE((v_phase->>'total')::int, 0);
  n := n + v_phase_total;

  v_repaired := public.repair_stale_video_date_prepare_entries(v_limit);
  n := n + COALESCE(v_repaired, 0);

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
      'bounded', true,
      'limit', v_limit,
      'total_mutations', n,
      'snooze_wake', v_snooze,
      'queued_ttl_expired', v_queued_ttl,
      'ready_gate_expired', v_ready_exp,
      'both_ready_expired', v_both_ready_exp,
      'handshake_timeout', COALESCE((v_phase->>'handshake_timeout')::int, 0),
      'handshake_grace_expired', COALESCE((v_phase->>'handshake_grace_expired')::int, 0),
      'date_timeout', COALESCE((v_phase->>'date_timeout')::int, 0),
      'prepare_entry_repaired', COALESCE(v_repaired, 0),
      'hygiene_orphans', v_orphans,
      'survey_orphans', v_survey_orphans,
      'idle_orphans', v_idle_orphans
    )
  );

  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_stale_video_sessions_bounded(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_video_sessions_bounded(integer) TO service_role;

COMMENT ON FUNCTION public.expire_stale_video_sessions_bounded(integer) IS
  'Bounded stale video-session cleanup. Ready Gate expiry only touches pre-Daily/pre-date rows with no joined/provider evidence.';

CREATE OR REPLACE FUNCTION public.expire_stale_video_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.expire_stale_video_sessions_bounded(100);
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_stale_video_sessions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_video_sessions() TO service_role;

COMMENT ON FUNCTION public.expire_stale_video_sessions() IS
  'Cron entrypoint for bounded stale video-session cleanup. Does not delegate to the historical unbounded implementation.';
