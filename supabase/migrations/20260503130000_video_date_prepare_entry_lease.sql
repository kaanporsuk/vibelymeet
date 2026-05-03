-- Video Date prepare-entry lease.
--
-- Ready Gate -> Daily provider preparation is intentionally non-routeable
-- until confirm_video_date_entry_prepared persists Daily room truth. The gap is
-- that slow provider calls can outlive the visible both_ready expiry and let
-- cleanup end the session before metadata is persisted. These nullable columns
-- add a bounded server-owned lease for that provider handoff without changing
-- public routes, enums, Daily room naming, or token response shape.

ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS prepare_entry_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS prepare_entry_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS prepare_entry_attempt_id text,
  ADD COLUMN IF NOT EXISTS prepare_entry_actor_id uuid;

CREATE INDEX IF NOT EXISTS idx_video_sessions_prepare_entry_lease
  ON public.video_sessions (prepare_entry_expires_at, id)
  WHERE ended_at IS NULL
    AND prepare_entry_expires_at IS NOT NULL
    AND daily_room_name IS NULL
    AND daily_room_url IS NULL;

COMMENT ON COLUMN public.video_sessions.prepare_entry_started_at IS
  'Nullable bounded lease timestamp for Ready Gate -> Daily provider preparation. Does not make a session routeable.';
COMMENT ON COLUMN public.video_sessions.prepare_entry_expires_at IS
  'Nullable expiry for the prepare-entry lease; cleanup may terminalize unconfirmed rows after this timestamp.';
COMMENT ON COLUMN public.video_sessions.prepare_entry_attempt_id IS
  'Best-effort client/server trace id for the active prepare-entry lease.';
COMMENT ON COLUMN public.video_sessions.prepare_entry_actor_id IS
  'Participant who first opened/refreshed the active prepare-entry lease.';

DROP FUNCTION IF EXISTS public.video_date_transition_20260503130000_prepare_lease_base(uuid, text, text);

ALTER FUNCTION public.video_date_transition(uuid, text, text)
  RENAME TO video_date_transition_20260503130000_prepare_lease_base;

REVOKE ALL ON FUNCTION public.video_date_transition_20260503130000_prepare_lease_base(uuid, text, text)
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
    RETURN public.video_date_transition_20260503130000_prepare_lease_base(
      p_session_id,
      p_action,
      p_reason
    );
  END IF;

  IF v_actor IS NULL THEN
    RETURN public.video_date_transition_20260503130000_prepare_lease_base(
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
    RETURN public.video_date_transition_20260503130000_prepare_lease_base(
      p_session_id,
      p_action,
      p_reason
    );
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_actor
     AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
    RETURN public.video_date_transition_20260503130000_prepare_lease_base(
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

  RETURN public.video_date_transition_20260503130000_prepare_lease_base(
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
  'Canonical participant-owned video date state machine. Adds a bounded non-routeable prepare-entry lease before delegating existing prepare_entry semantics.';

DROP FUNCTION IF EXISTS public.confirm_vde_prepared_202605031300_base(uuid, text, text, text);

ALTER FUNCTION public.confirm_video_date_entry_prepared(uuid, text, text, text)
  RENAME TO confirm_vde_prepared_202605031300_base;

REVOKE ALL ON FUNCTION public.confirm_vde_prepared_202605031300_base(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_vde_prepared_202605031300_base(uuid, text, text, text)
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
  v_result jsonb;
  v_success boolean := false;
BEGIN
  v_result := public.confirm_vde_prepared_202605031300_base(
    p_session_id,
    p_room_name,
    p_room_url,
    p_entry_attempt_id
  );

  v_success := COALESCE((v_result ->> 'success')::boolean, false);

  IF v_success THEN
    UPDATE public.video_sessions
    SET
      prepare_entry_started_at = NULL,
      prepare_entry_expires_at = NULL,
      prepare_entry_attempt_id = NULL,
      prepare_entry_actor_id = NULL
    WHERE id = p_session_id
      AND (
        prepare_entry_started_at IS NOT NULL
        OR prepare_entry_expires_at IS NOT NULL
        OR prepare_entry_attempt_id IS NOT NULL
        OR prepare_entry_actor_id IS NOT NULL
      );
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_video_date_entry_prepared(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_video_date_entry_prepared(uuid, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.confirm_video_date_entry_prepared(uuid, text, text, text) IS
  'Service-role-only provider-atomic transition. Clears the bounded prepare-entry lease after Daily room metadata is confirmed.';

DROP FUNCTION IF EXISTS public.expire_stale_video_sessions_bounded_202605031300_base(integer);

ALTER FUNCTION public.expire_stale_video_sessions_bounded(integer)
  RENAME TO expire_stale_video_sessions_bounded_202605031300_base;

REVOKE ALL ON FUNCTION public.expire_stale_video_sessions_bounded_202605031300_base(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_video_sessions_bounded_202605031300_base(integer)
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
  v_now timestamptz := now();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  r record;
  v_rows integer := 0;
  v_registration_rows integer := 0;
  v_base integer := 0;
  v_extended integer := 0;
BEGIN
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
    AND handshake_started_at IS NULL
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
      AND handshake_started_at IS NULL
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
      AND handshake_started_at IS NULL
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

  v_base := v_base + public.expire_stale_video_sessions_bounded_202605031300_base(v_limit);

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

  RETURN v_base;
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_stale_video_sessions_bounded(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_video_sessions_bounded(integer)
  TO service_role;

COMMENT ON FUNCTION public.expire_stale_video_sessions_bounded(integer) IS
  'Bounded stale-session cleanup. Preserves active prepare-entry leases and terminalizes expired unconfirmed leases with prepare_entry_timeout before delegated cleanup.';
