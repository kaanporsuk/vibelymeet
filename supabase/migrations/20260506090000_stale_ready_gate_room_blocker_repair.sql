-- Stale Ready Gate room-metadata blocker repair.
--
-- A pre-date Ready Gate can have Daily room metadata from an early warmup path
-- without ever reaching handshake/date. Older cleanup treated that metadata as
-- provider evidence, so expired or event-ended rows could remain non-ended and
-- globally block later mutual swipes through enforce_one_active_video_session().

CREATE OR REPLACE FUNCTION public.video_session_blocks_global_active_conflict(
  p_event_id uuid,
  p_ready_gate_status text,
  p_state text,
  p_phase text,
  p_handshake_started_at timestamptz,
  p_date_started_at timestamptz,
  p_ended_at timestamptz,
  p_ready_gate_expires_at timestamptz,
  p_queued_expires_at timestamptz,
  p_snooze_expires_at timestamptz,
  p_prepare_entry_expires_at timestamptz,
  p_participant_1_joined_at timestamptz,
  p_participant_2_joined_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_status text := COALESCE(NULLIF(p_ready_gate_status, ''), '');
  v_state text := COALESCE(NULLIF(p_state, ''), '');
  v_phase text := COALESCE(NULLIF(p_phase, ''), '');
  v_inactive_reason text;
BEGIN
  IF p_ended_at IS NOT NULL OR v_state = 'ended' OR v_phase = 'ended' THEN
    RETURN false;
  END IF;

  IF p_handshake_started_at IS NOT NULL
     OR p_date_started_at IS NOT NULL
     OR p_participant_1_joined_at IS NOT NULL
     OR p_participant_2_joined_at IS NOT NULL
     OR v_state IN ('handshake', 'date')
     OR v_phase IN ('handshake', 'date') THEN
    RETURN true;
  END IF;

  -- Queued matches are browseable by product contract and do not block another
  -- match. TTL cleanup owns their eventual terminalization.
  IF v_status = 'queued' THEN
    RETURN false;
  END IF;

  IF v_status IN ('expired', 'forfeited') THEN
    RETURN false;
  END IF;

  IF v_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed') THEN
    IF p_event_id IS NOT NULL THEN
      v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);
      IF v_inactive_reason IS NOT NULL THEN
        RETURN false;
      END IF;
    END IF;

    IF p_prepare_entry_expires_at IS NOT NULL AND p_prepare_entry_expires_at > v_now THEN
      RETURN true;
    END IF;

    IF v_status = 'snoozed' THEN
      RETURN p_snooze_expires_at IS NULL OR p_snooze_expires_at > v_now;
    END IF;

    RETURN p_ready_gate_expires_at IS NULL OR p_ready_gate_expires_at > v_now;
  END IF;

  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_blocks_global_active_conflict(
  uuid, text, text, text, timestamptz, timestamptz, timestamptz,
  timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_session_blocks_global_active_conflict(
  uuid, text, text, text, timestamptz, timestamptz, timestamptz,
  timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz
) TO service_role;

COMMENT ON FUNCTION public.video_session_blocks_global_active_conflict(
  uuid, text, text, text, timestamptz, timestamptz, timestamptz,
  timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz
) IS
  'True for real non-ended participant conflicts across events. Queued, expired, event-inactive, and expired pre-date Ready Gates do not block future matches.';

CREATE OR REPLACE FUNCTION public.enforce_one_active_video_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_left text;
  v_right text;
  v_lock_left bigint;
  v_lock_right bigint;
BEGIN
  IF NEW.participant_1_id IS NULL OR NEW.participant_2_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.ended_at IS NOT NULL
     OR NEW.state = 'ended'::public.video_date_state
     OR NEW.phase = 'ended' THEN
    RETURN NEW;
  END IF;

  v_left := LEAST(NEW.participant_1_id::text, NEW.participant_2_id::text);
  v_right := GREATEST(NEW.participant_1_id::text, NEW.participant_2_id::text);
  v_lock_left := hashtextextended(v_left, 0);
  v_lock_right := hashtextextended(v_right, 0);

  PERFORM pg_advisory_xact_lock(v_lock_left);
  IF v_lock_right IS DISTINCT FROM v_lock_left THEN
    PERFORM pg_advisory_xact_lock(v_lock_right);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions vs
    WHERE vs.id IS DISTINCT FROM NEW.id
      AND (
        vs.participant_1_id IN (NEW.participant_1_id, NEW.participant_2_id)
        OR vs.participant_2_id IN (NEW.participant_1_id, NEW.participant_2_id)
      )
      AND public.video_session_blocks_global_active_conflict(
        vs.event_id,
        vs.ready_gate_status,
        vs.state::text,
        vs.phase,
        vs.handshake_started_at,
        vs.date_started_at,
        vs.ended_at,
        vs.ready_gate_expires_at,
        vs.queued_expires_at,
        vs.snooze_expires_at,
        vs.prepare_entry_expires_at,
        vs.participant_1_joined_at,
        vs.participant_2_joined_at
      )
  ) THEN
    RAISE EXCEPTION 'participant_has_active_session_conflict'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_one_active_video_session() IS
  'Serializes participant-level writes and rejects true active video_sessions for the same user. Expired/event-inactive pre-date Ready Gates and queued matches do not block new matches.';

CREATE OR REPLACE FUNCTION public.terminalize_stale_pre_date_ready_gate_blockers(
  p_limit integer DEFAULT 100,
  p_reason text DEFAULT 'cron'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_reason text := COALESCE(NULLIF(btrim(p_reason), ''), 'cron');
  v_inactive_reason text;
  v_terminal_reason text;
  v_row_count integer := 0;
  v_registration_rows integer := 0;
  v_total integer := 0;
  r public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
BEGIN
  FOR r IN
    SELECT vs.*
    FROM public.video_sessions vs
    WHERE vs.ended_at IS NULL
      AND vs.state = 'ready_gate'::public.video_date_state
      AND COALESCE(vs.phase, 'ready_gate') NOT IN ('handshake', 'date')
      AND vs.ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready')
      AND vs.handshake_started_at IS NULL
      AND vs.date_started_at IS NULL
      AND vs.participant_1_joined_at IS NULL
      AND vs.participant_2_joined_at IS NULL
      AND (
        vs.daily_room_name IS NOT NULL
        OR vs.daily_room_url IS NOT NULL
        OR vs.daily_room_verified_at IS NOT NULL
        OR vs.daily_room_expires_at IS NOT NULL
        OR vs.daily_room_provider_verify_reason IS NOT NULL
        OR public.get_event_lobby_inactive_reason(vs.event_id) IS NOT NULL
      )
      AND (
        public.get_event_lobby_inactive_reason(vs.event_id) IS NOT NULL
        OR (
          vs.ready_gate_status = 'queued'
          AND COALESCE(vs.queued_expires_at, COALESCE(vs.started_at, v_now) + interval '10 minutes') <= v_now
        )
        OR (
          vs.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready')
          AND vs.ready_gate_expires_at IS NOT NULL
          AND vs.ready_gate_expires_at <= v_now
          AND (vs.prepare_entry_expires_at IS NULL OR vs.prepare_entry_expires_at <= v_now)
        )
      )
    ORDER BY COALESCE(vs.ready_gate_expires_at, vs.queued_expires_at, vs.started_at), vs.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_inactive_reason := public.get_event_lobby_inactive_reason(r.event_id);
    v_terminal_reason := CASE
      WHEN v_inactive_reason = 'event_archived' THEN 'ready_gate_event_archived'
      WHEN v_inactive_reason = 'event_cancelled' THEN 'ready_gate_event_cancelled'
      WHEN v_inactive_reason IN ('event_ended', 'event_outside_live_window') THEN 'ready_gate_event_ended'
      WHEN v_inactive_reason IS NOT NULL THEN 'ready_gate_event_inactive'
      WHEN r.ready_gate_status = 'queued' THEN 'queued_ttl_expired'
      ELSE 'ready_gate_expired'
    END;

    UPDATE public.video_sessions
    SET
      ready_gate_status = 'expired',
      ready_gate_expires_at = COALESCE(ready_gate_expires_at, v_now),
      queued_expires_at = NULL,
      snoozed_by = NULL,
      snooze_expires_at = NULL,
      daily_room_name = NULL,
      daily_room_url = NULL,
      daily_room_verified_at = NULL,
      daily_room_expires_at = NULL,
      daily_room_provider_verify_reason = NULL,
      prepare_entry_started_at = NULL,
      prepare_entry_expires_at = NULL,
      prepare_entry_attempt_id = NULL,
      prepare_entry_actor_id = NULL,
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
      AND COALESCE(phase, 'ready_gate') NOT IN ('handshake', 'date')
      AND ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready')
      AND handshake_started_at IS NULL
      AND date_started_at IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
    RETURNING * INTO v_after;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count = 0 THEN
      CONTINUE;
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
        OR (
          queue_status = 'in_ready_gate'
          AND current_partner_id IN (v_after.participant_1_id, v_after.participant_2_id)
        )
      );

    GET DIAGNOSTICS v_registration_rows = ROW_COUNT;

    PERFORM public.record_event_loop_observability(
      'expire_stale_video_sessions',
      'success',
      'stale_pre_date_ready_gate_room_metadata_terminalized',
      NULL,
      v_after.event_id,
      NULL,
      v_after.id,
      jsonb_build_object(
        'source', v_reason,
        'terminal_reason', v_terminal_reason,
        'inactive_reason', v_inactive_reason,
        'previous_ready_gate_status', r.ready_gate_status,
        'previous_state', r.state::text,
        'previous_phase', r.phase,
        'had_daily_room_metadata',
          r.daily_room_name IS NOT NULL
          OR r.daily_room_url IS NOT NULL
          OR r.daily_room_verified_at IS NOT NULL
          OR r.daily_room_expires_at IS NOT NULL
          OR r.daily_room_provider_verify_reason IS NOT NULL,
        'registration_rows', v_registration_rows
      )
    );

    v_total := v_total + 1;
  END LOOP;

  RETURN v_total;
END;
$function$;

REVOKE ALL ON FUNCTION public.terminalize_stale_pre_date_ready_gate_blockers(integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.terminalize_stale_pre_date_ready_gate_blockers(integer, text)
  TO service_role;

COMMENT ON FUNCTION public.terminalize_stale_pre_date_ready_gate_blockers(integer, text) IS
  'Internal cleanup for expired or event-inactive pre-date Ready Gates that have stale Daily room metadata but no handshake/date/join evidence.';

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

  FOR r IN
    SELECT vs.*
    FROM public.video_sessions vs
    WHERE vs.event_id = p_event_id
      AND vs.ended_at IS NULL
      AND vs.state = 'ready_gate'::public.video_date_state
      AND vs.ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready')
      AND vs.handshake_started_at IS NULL
      AND vs.date_started_at IS NULL
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
      daily_room_name = NULL,
      daily_room_url = NULL,
      daily_room_verified_at = NULL,
      daily_room_expires_at = NULL,
      daily_room_provider_verify_reason = NULL,
      prepare_entry_started_at = NULL,
      prepare_entry_expires_at = NULL,
      prepare_entry_attempt_id = NULL,
      prepare_entry_actor_id = NULL,
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
          'provider_prepared_excluded', false,
          'stale_room_metadata_cleared',
            r.daily_room_name IS NOT NULL
            OR r.daily_room_url IS NOT NULL
            OR r.daily_room_verified_at IS NOT NULL
            OR r.daily_room_expires_at IS NOT NULL
            OR r.daily_room_provider_verify_reason IS NOT NULL
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
  'Internal Ready Gate cleanup for inactive events. Terminalizes pre-date ready_gate rows even when stale room metadata exists, while preserving real handshake/date/join evidence.';

DROP FUNCTION IF EXISTS public.expire_stale_video_sessions_bounded_20260506090000_stale_room_base(integer);

ALTER FUNCTION public.expire_stale_video_sessions_bounded(integer)
  RENAME TO expire_stale_video_sessions_bounded_20260506090000_stale_room_base;

REVOKE ALL ON FUNCTION public.expire_stale_video_sessions_bounded_20260506090000_stale_room_base(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_video_sessions_bounded_20260506090000_stale_room_base(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.expire_stale_video_sessions_bounded(
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_repaired integer := 0;
  v_base integer := 0;
BEGIN
  v_repaired := public.terminalize_stale_pre_date_ready_gate_blockers(
    v_limit,
    'expire_stale_video_sessions'
  );
  v_base := public.expire_stale_video_sessions_bounded_20260506090000_stale_room_base(v_limit);
  RETURN COALESCE(v_repaired, 0) + COALESCE(v_base, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_stale_video_sessions_bounded(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_video_sessions_bounded(integer)
  TO service_role;

COMMENT ON FUNCTION public.expire_stale_video_sessions_bounded(integer) IS
  'Bounded stale-session cleanup. First terminalizes expired/event-inactive pre-date Ready Gates with stale room metadata, then delegates to the prior cleanup stack.';

DROP FUNCTION IF EXISTS public.handle_swipe_20260506090000_stale_room_base(uuid, uuid, uuid, text);

ALTER FUNCTION public.handle_swipe(uuid, uuid, uuid, text)
  RENAME TO handle_swipe_20260506090000_stale_room_base;

REVOKE ALL ON FUNCTION public.handle_swipe_20260506090000_stale_room_base(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_swipe_20260506090000_stale_room_base(uuid, uuid, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.handle_swipe(
  p_event_id uuid,
  p_actor_id uuid,
  p_target_id uuid,
  p_swipe_type text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_active record;
  v_now timestamptz := now();
  v_t0 timestamptz;
  v_ms integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RETURN public.handle_swipe_20260506090000_stale_room_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  IF p_swipe_type NOT IN ('pass', 'vibe', 'super_vibe') THEN
    RETURN public.handle_swipe_20260506090000_stale_room_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations
    WHERE event_id = p_event_id
      AND profile_id = p_actor_id
      AND admission_status = 'confirmed'
  ) THEN
    RETURN public.handle_swipe_20260506090000_stale_room_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  SELECT *
  INTO v_active
  FROM public.lock_event_lobby_scheduled_active_state(p_event_id, v_now);

  IF NOT COALESCE(v_active.is_active, false) THEN
    RETURN public.handle_swipe_20260506090000_stale_room_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations
    WHERE event_id = p_event_id
      AND profile_id = p_target_id
      AND admission_status = 'confirmed'
  ) THEN
    RETURN public.handle_swipe_20260506090000_stale_room_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  IF public.video_date_pair_has_terminal_encounter(p_event_id, p_actor_id, p_target_id)
     OR public.is_blocked(p_actor_id, p_target_id)
     OR public.is_profile_hidden(p_actor_id)
     OR NOT public.is_profile_discoverable(p_target_id, p_actor_id)
     OR EXISTS (
       SELECT 1
       FROM public.user_reports
       WHERE reporter_id = p_actor_id
         AND reported_id = p_target_id
     ) THEN
    RETURN public.handle_swipe_20260506090000_stale_room_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        LEAST(p_actor_id, p_target_id)::text,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        GREATEST(p_actor_id, p_target_id)::text,
      0
    )
  );

  v_t0 := clock_timestamp();

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions z
    WHERE NOT (
        z.event_id = p_event_id
        AND z.participant_1_id = LEAST(p_actor_id, p_target_id)
        AND z.participant_2_id = GREATEST(p_actor_id, p_target_id)
      )
      AND (z.participant_1_id = p_actor_id OR z.participant_2_id = p_actor_id)
      AND public.video_session_blocks_global_active_conflict(
        z.event_id,
        z.ready_gate_status,
        z.state::text,
        z.phase,
        z.handshake_started_at,
        z.date_started_at,
        z.ended_at,
        z.ready_gate_expires_at,
        z.queued_expires_at,
        z.snooze_expires_at,
        z.prepare_entry_expires_at,
        z.participant_1_joined_at,
        z.participant_2_joined_at
      )
  ) THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'handle_swipe',
      'conflict',
      'participant_has_active_session_conflict',
      v_ms,
      p_event_id,
      p_actor_id,
      NULL,
      jsonb_build_object(
        'step', 'pre_swipe_global_active_session_guard',
        'swipe_type', p_swipe_type,
        'notification_suppressed', true,
        'stale_ready_gate_room_blockers_ignored', true
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'participant_has_active_session_conflict',
      'result', 'participant_has_active_session_conflict',
      'error', 'participant_has_active_session_conflict',
      'message', 'You are already in a live Ready Gate or video date. Finish it before matching again.',
      'notification_suppressed', true,
      'dedupe_reason', 'active_session_conflict'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions z
    WHERE NOT (
        z.event_id = p_event_id
        AND z.participant_1_id = LEAST(p_actor_id, p_target_id)
        AND z.participant_2_id = GREATEST(p_actor_id, p_target_id)
      )
      AND (z.participant_1_id = p_target_id OR z.participant_2_id = p_target_id)
      AND public.video_session_blocks_global_active_conflict(
        z.event_id,
        z.ready_gate_status,
        z.state::text,
        z.phase,
        z.handshake_started_at,
        z.date_started_at,
        z.ended_at,
        z.ready_gate_expires_at,
        z.queued_expires_at,
        z.snooze_expires_at,
        z.prepare_entry_expires_at,
        z.participant_1_joined_at,
        z.participant_2_joined_at
      )
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'target_unavailable',
      'result', 'target_unavailable',
      'error', 'target_unavailable',
      'message', 'This person is no longer available in the lobby.',
      'notification_suppressed', true,
      'dedupe_reason', 'target_active_session_conflict'
    );
  END IF;

  RETURN public.handle_swipe_20260506090000_stale_room_base(
    p_event_id, p_actor_id, p_target_id, p_swipe_type
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) IS
  'Swipe-first event matching. Adds a global active-session preflight that ignores expired/event-inactive stale Ready Gate room blockers before delegating current swipe semantics.';

-- Immediate production repair for rows already wedged before this migration.
SELECT public.terminalize_stale_pre_date_ready_gate_blockers(
  500,
  'migration_backfill'
);
