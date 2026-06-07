-- Video Date routeable both-ready entry protection.
--
-- The 2026-06-07 production failure showed a pre-Daily gap:
-- video_session_mark_ready_v2 committed both_ready and deterministic Daily room
-- metadata, but prepare_date_entry confirmed routeable handshake state only
-- after provider verification/token minting. Slow provider work left users in
-- Ready Gate long enough for stale cleanup to terminalize the session.
--
-- This migration makes both_ready entry protection independent of whether room
-- metadata already exists, extends the server-owned handoff window, and keeps
-- terminal diagnostics intact if the handoff truly times out.

CREATE OR REPLACE FUNCTION public.video_date_protect_both_ready_entry_v1(
  p_session_id uuid,
  p_actor_id uuid DEFAULT auth.uid(),
  p_entry_attempt_id text DEFAULT NULL,
  p_source text DEFAULT 'video_date_protect_both_ready_entry_v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_session public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_actor uuid := p_actor_id;
  v_attempt_id text := NULLIF(btrim(COALESCE(p_entry_attempt_id, '')), '');
  v_source text := COALESCE(NULLIF(btrim(p_source), ''), 'video_date_protect_both_ready_entry_v1');
  v_inactive_reason text;
  v_previous_lease_expires_at timestamptz;
  v_lease_expires_at timestamptz;
  v_expected_room_name text := 'date-' || replace(COALESCE(p_session_id::text, ''), '-', '');
  v_domain text;
  v_url text;
  v_row_count integer := 0;
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'SESSION_NOT_FOUND',
      'error', 'Session not found'
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'SESSION_NOT_FOUND',
      'error', 'Session not found'
    );
  END IF;

  IF v_session.ended_at IS NOT NULL
     OR v_session.state = 'ended'::public.video_date_state
     OR COALESCE(v_session.phase, '') = 'ended' THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'SESSION_ENDED',
      'error', 'Session has ended',
      'state', v_session.state::text,
      'phase', v_session.phase,
      'ready_gate_status', v_session.ready_gate_status,
      'ended_at', v_session.ended_at,
      'ended_reason', v_session.ended_reason
    );
  END IF;

  IF v_actor IS NULL
     OR (
       v_session.participant_1_id IS DISTINCT FROM v_actor
       AND v_session.participant_2_id IS DISTINCT FROM v_actor
     ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'ACCESS_DENIED',
      'error', 'Access denied',
      'event_id', v_session.event_id,
      'state', v_session.state::text,
      'phase', v_session.phase,
      'ready_gate_status', v_session.ready_gate_status
    );
  END IF;

  v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
  IF v_inactive_reason IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'EVENT_INACTIVE',
      'error', 'Event is no longer active',
      'inactive_reason', v_inactive_reason,
      'event_id', v_session.event_id,
      'state', v_session.state::text,
      'phase', v_session.phase,
      'ready_gate_status', v_session.ready_gate_status
    );
  END IF;

  IF v_session.state IS DISTINCT FROM 'ready_gate'::public.video_date_state
     OR COALESCE(v_session.phase, 'ready_gate') IS DISTINCT FROM 'ready_gate'
     OR v_session.ready_gate_status IS DISTINCT FROM 'both_ready'
     OR v_session.handshake_started_at IS NOT NULL
     OR v_session.date_started_at IS NOT NULL
     OR v_session.participant_1_joined_at IS NOT NULL
     OR v_session.participant_2_joined_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'NOT_PROTECTABLE',
      'retryable', true,
      'event_id', v_session.event_id,
      'state', v_session.state::text,
      'phase', v_session.phase,
      'ready_gate_status', v_session.ready_gate_status,
      'handshake_started_at', v_session.handshake_started_at,
      'date_started_at', v_session.date_started_at,
      'participant_1_joined_at', v_session.participant_1_joined_at,
      'participant_2_joined_at', v_session.participant_2_joined_at
    );
  END IF;

  v_domain := NULLIF(btrim(current_setting('app.daily_domain', true)), '');
  IF v_domain IS NULL
     AND v_session.daily_room_url IS NOT NULL
     AND v_session.daily_room_url LIKE ('%/' || v_expected_room_name) THEN
    v_domain := substring(v_session.daily_room_url from '^https?://([^/]+)/');
  END IF;
  IF v_domain IS NULL THEN
    SELECT substring(vs.daily_room_url from '^https?://([^/]+)/')
    INTO v_domain
    FROM public.video_sessions vs
    WHERE vs.daily_room_url LIKE 'http%://%/date-%'
    ORDER BY vs.state_updated_at DESC NULLS LAST
    LIMIT 1;
  END IF;
  v_domain := COALESCE(v_domain, 'vibelyapp.daily.co');
  v_url := 'https://' || v_domain || '/' || v_expected_room_name;

  v_previous_lease_expires_at := v_session.prepare_entry_expires_at;
  v_lease_expires_at := GREATEST(
    COALESCE(v_session.prepare_entry_expires_at, v_now),
    v_now + interval '5 minutes'
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
    daily_room_name = v_expected_room_name,
    daily_room_url = CASE
      WHEN daily_room_url IS NOT NULL AND daily_room_url LIKE ('%/' || v_expected_room_name)
        THEN daily_room_url
      ELSE v_url
    END,
    daily_room_provider_verify_reason = COALESCE(
      daily_room_provider_verify_reason,
      'ready_gate_entry_protected'
    ),
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL
    AND state = 'ready_gate'::public.video_date_state
    AND COALESCE(phase, 'ready_gate') = 'ready_gate'
    AND ready_gate_status = 'both_ready'
    AND handshake_started_at IS NULL
    AND date_started_at IS NULL
    AND participant_1_joined_at IS NULL
    AND participant_2_joined_at IS NULL
  RETURNING * INTO v_after;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'ok', false,
      'code', 'PROTECT_ZERO_ROWS',
      'retryable', true,
      'event_id', v_session.event_id,
      'state', v_session.state::text,
      'phase', v_session.phase,
      'ready_gate_status', v_session.ready_gate_status
    );
  END IF;

  PERFORM public.record_event_loop_observability(
    'video_date_transition',
    'success',
    CASE
      WHEN v_previous_lease_expires_at IS NULL THEN 'prepare_entry_route_protected'
      ELSE 'prepare_entry_route_protection_refreshed'
    END,
    NULL,
    v_after.event_id,
    v_actor,
    v_after.id,
    jsonb_build_object(
      'source', v_source,
      'entry_attempt_id', v_attempt_id,
      'ready_gate_status', v_after.ready_gate_status,
      'prepare_entry_started_at', v_after.prepare_entry_started_at,
      'prepare_entry_expires_at', v_after.prepare_entry_expires_at,
      'previous_prepare_entry_expires_at', v_previous_lease_expires_at,
      'ready_gate_expires_at', v_after.ready_gate_expires_at,
      'daily_room_name', v_after.daily_room_name,
      'daily_room_url', v_after.daily_room_url,
      'provider_reason', v_after.daily_room_provider_verify_reason,
      'routeable', false
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'ok', true,
    'code', 'OK',
    'event_id', v_after.event_id,
    'state', v_after.state::text,
    'phase', v_after.phase,
    'ready_gate_status', v_after.ready_gate_status,
    'ready_gate_expires_at', v_after.ready_gate_expires_at,
    'prepare_entry_started_at', v_after.prepare_entry_started_at,
    'prepare_entry_expires_at', v_after.prepare_entry_expires_at,
    'prepare_entry_attempt_id', v_after.prepare_entry_attempt_id,
    'prepare_entry_actor_id', v_after.prepare_entry_actor_id,
    'participant_1_id', v_after.participant_1_id,
    'participant_2_id', v_after.participant_2_id,
    'daily_room_name', v_after.daily_room_name,
    'daily_room_url', v_after.daily_room_url,
    'daily_room_verified_at', v_after.daily_room_verified_at,
    'daily_room_expires_at', v_after.daily_room_expires_at,
    'daily_room_provider_verify_reason', v_after.daily_room_provider_verify_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_protect_both_ready_entry_v1(uuid, uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_date_protect_both_ready_entry_v1(uuid, uuid, text, text)
  TO service_role;

COMMENT ON FUNCTION public.video_date_protect_both_ready_entry_v1(uuid, uuid, text, text) IS
  'Protects a both_ready Ready Gate handoff before Daily entry by refreshing a 5 minute prepare-entry lease and deterministic Daily room metadata regardless of whether room metadata already exists.';

DO $$
BEGIN
  IF to_regprocedure('public.video_session_mark_ready_v2_20260607123952_routeable_entry_base(uuid, text, text)') IS NULL
     AND to_regprocedure('public.video_session_mark_ready_v2(uuid, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
      RENAME TO video_session_mark_ready_v2_20260607123952_routeable_entry_base;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2_20260607123952_routeable_entry_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2_20260607123952_routeable_entry_base(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.video_session_mark_ready_v2(
  p_session_id uuid,
  p_idempotency_key text DEFAULT NULL,
  p_request_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_protection jsonb;
  v_ready_gate_status text;
  v_success boolean := false;
BEGIN
  v_result := public.video_session_mark_ready_v2_20260607123952_routeable_entry_base(
    p_session_id,
    p_idempotency_key,
    p_request_hash
  );

  v_success := COALESCE(
    NULLIF(v_result ->> 'success', '')::boolean,
    NULLIF(v_result ->> 'ok', '')::boolean,
    false
  );
  v_ready_gate_status := COALESCE(
    NULLIF(v_result ->> 'ready_gate_status', ''),
    NULLIF(v_result ->> 'result_ready_gate_status', ''),
    NULLIF(v_result ->> 'status', '')
  );

  IF v_success AND v_ready_gate_status = 'both_ready' THEN
    v_protection := public.video_date_protect_both_ready_entry_v1(
      p_session_id,
      v_actor,
      NULL,
      'video_session_mark_ready_v2'
    );

    IF COALESCE(NULLIF(v_protection ->> 'success', '')::boolean, false) THEN
      v_result := v_result || jsonb_build_object(
        'entry_protection', 'active',
        'prepare_entry_started_at', v_protection ->> 'prepare_entry_started_at',
        'prepare_entry_expires_at', v_protection ->> 'prepare_entry_expires_at',
        'daily_room_name', v_protection ->> 'daily_room_name',
        'daily_room_url', v_protection ->> 'daily_room_url',
        'ready_gate_expires_at', v_protection ->> 'ready_gate_expires_at'
      );
    ELSE
      v_result := v_result || jsonb_build_object(
        'entry_protection', 'failed',
        'entry_protection_code', v_protection ->> 'code'
      );
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text) IS
  'Ready Gate mark-ready wrapper that delegates to the current decisive commit stack and immediately protects both_ready entry with a route handoff lease.';

DO $$
BEGIN
  IF to_regprocedure('public.video_date_transition_20260607123952_routeable_entry_base(uuid, text, text)') IS NULL
     AND to_regprocedure('public.video_date_transition(uuid, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.video_date_transition(uuid, text, text)
      RENAME TO video_date_transition_20260607123952_routeable_entry_base;
  END IF;
END
$$;

REVOKE ALL ON FUNCTION public.video_date_transition_20260607123952_routeable_entry_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_transition_20260607123952_routeable_entry_base(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.video_date_transition(
  p_session_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_attempt_id text := NULLIF(substring(COALESCE(p_reason, '') FROM '^entry_attempt:(.+)$'), '');
  v_result jsonb;
  v_protection jsonb;
BEGIN
  IF p_action = 'prepare_entry' THEN
    v_protection := public.video_date_protect_both_ready_entry_v1(
      p_session_id,
      v_actor,
      v_attempt_id,
      'video_date_transition_prepare_entry'
    );

    IF COALESCE(NULLIF(v_protection ->> 'success', '')::boolean, false) IS FALSE
       AND COALESCE(v_protection ->> 'code', '') IN ('SESSION_NOT_FOUND', 'SESSION_ENDED', 'ACCESS_DENIED', 'EVENT_INACTIVE') THEN
      RETURN v_protection;
    END IF;
  END IF;

  v_result := public.video_date_transition_20260607123952_routeable_entry_base(
    p_session_id,
    p_action,
    p_reason
  );

  IF p_action = 'prepare_entry'
     AND COALESCE(NULLIF(v_result ->> 'success', '')::boolean, false)
     AND COALESCE(NULLIF(v_protection ->> 'success', '')::boolean, false) THEN
    v_result := v_result || jsonb_build_object(
      'prepare_entry_started_at', v_protection ->> 'prepare_entry_started_at',
      'prepare_entry_expires_at', v_protection ->> 'prepare_entry_expires_at',
      'prepare_entry_attempt_id', v_protection ->> 'prepare_entry_attempt_id',
      'daily_room_name', COALESCE(v_result ->> 'daily_room_name', v_protection ->> 'daily_room_name'),
      'daily_room_url', COALESCE(v_result ->> 'daily_room_url', v_protection ->> 'daily_room_url'),
      'ready_gate_expires_at', COALESCE(v_result ->> 'ready_gate_expires_at', v_protection ->> 'ready_gate_expires_at')
    );
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_transition(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_date_transition(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Video Date transition wrapper that protects both_ready prepare_entry handoff before delegating to the existing transition stack.';

CREATE OR REPLACE FUNCTION public.terminalize_stale_pre_date_ready_gate_blockers(
  p_limit integer DEFAULT 100,
  p_reason text DEFAULT 'cron'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
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
  v_expected_room_name text;
  v_domain text;
  v_url text;
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
      WHEN r.ready_gate_status = 'both_ready'
           AND r.prepare_entry_expires_at IS NOT NULL
           AND r.prepare_entry_expires_at <= v_now THEN 'date_entry_prepare_timeout'
      ELSE 'ready_gate_expired'
    END;

    v_expected_room_name := 'date-' || replace(r.id::text, '-', '');
    v_domain := NULLIF(btrim(current_setting('app.daily_domain', true)), '');
    IF v_domain IS NULL
       AND r.daily_room_url IS NOT NULL
       AND r.daily_room_url LIKE ('%/' || v_expected_room_name) THEN
      v_domain := substring(r.daily_room_url from '^https?://([^/]+)/');
    END IF;
    IF v_domain IS NULL THEN
      SELECT substring(vs.daily_room_url from '^https?://([^/]+)/')
      INTO v_domain
      FROM public.video_sessions vs
      WHERE vs.daily_room_url LIKE 'http%://%/date-%'
      ORDER BY vs.state_updated_at DESC NULLS LAST
      LIMIT 1;
    END IF;
    v_domain := COALESCE(v_domain, 'vibelyapp.daily.co');
    v_url := 'https://' || v_domain || '/' || v_expected_room_name;

    UPDATE public.video_sessions
    SET
      ready_gate_status = 'expired',
      ready_gate_expires_at = COALESCE(ready_gate_expires_at, v_now),
      queued_expires_at = NULL,
      snoozed_by = NULL,
      snooze_expires_at = NULL,
      daily_room_name = CASE
        WHEN r.ready_gate_status = 'both_ready' THEN COALESCE(daily_room_name, v_expected_room_name)
        ELSE NULL
      END,
      daily_room_url = CASE
        WHEN r.ready_gate_status = 'both_ready' THEN
          CASE
            WHEN daily_room_url IS NOT NULL AND daily_room_url LIKE ('%/' || v_expected_room_name)
              THEN daily_room_url
            ELSE v_url
          END
        ELSE NULL
      END,
      daily_room_verified_at = CASE
        WHEN r.ready_gate_status = 'both_ready' THEN daily_room_verified_at
        ELSE NULL
      END,
      daily_room_expires_at = CASE
        WHEN r.ready_gate_status = 'both_ready' THEN daily_room_expires_at
        ELSE NULL
      END,
      daily_room_provider_verify_reason = CASE
        WHEN r.ready_gate_status = 'both_ready' THEN COALESCE(daily_room_provider_verify_reason, 'ready_gate_entry_terminal_diagnostic')
        ELSE NULL
      END,
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
      CASE
        WHEN r.ready_gate_status = 'both_ready' THEN 'stale_both_ready_entry_terminalized_with_room_diagnostic'
        ELSE 'stale_pre_date_ready_gate_room_metadata_terminalized'
      END,
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
        'previous_prepare_entry_started_at', r.prepare_entry_started_at,
        'previous_prepare_entry_expires_at', r.prepare_entry_expires_at,
        'had_daily_room_metadata',
          r.daily_room_name IS NOT NULL
          OR r.daily_room_url IS NOT NULL
          OR r.daily_room_verified_at IS NOT NULL
          OR r.daily_room_expires_at IS NOT NULL
          OR r.daily_room_provider_verify_reason IS NOT NULL,
        'preserved_terminal_room_metadata', r.ready_gate_status = 'both_ready',
        'daily_room_name', v_after.daily_room_name,
        'daily_room_url', v_after.daily_room_url,
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
  'Internal cleanup for expired or event-inactive pre-date Ready Gates. Both-ready handoff failures preserve canonical room metadata and emit date-entry timeout diagnostics.';

CREATE INDEX IF NOT EXISTS idx_video_sessions_prepare_entry_routeable_handoff
  ON public.video_sessions (prepare_entry_expires_at, id)
  WHERE ended_at IS NULL
    AND prepare_entry_expires_at IS NOT NULL
    AND ready_gate_status = 'both_ready';

NOTIFY pgrst, 'reload schema';
