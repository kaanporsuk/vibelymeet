-- Follow-ups for Codex review comments on PRs 1183, 1184, 1187, and 1188.
--
-- Keeps public signatures stable while closing:
--   * queued Ready Gate syncs masking expired queued TTL cleanup,
--   * mark-ready grace being reset by fresh idempotency keys,
--   * mark-ready hot path mutating ended/cancelled events.

BEGIN;

CREATE OR REPLACE FUNCTION public.video_session_mark_ready_grace_extend_v1(
  p_session_id uuid,
  p_actor uuid,
  p_idempotency_key text,
  p_source text DEFAULT 'pre_call',
  p_retryable boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_grace_window interval := interval '15 seconds';
  v_grace_max_age interval := interval '45 seconds';
  v_extend_until timestamptz := v_now + interval '15 seconds';
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_started_at timestamptz;
  v_max_extend_until timestamptz;
  v_existing_command_found boolean := false;
  v_event_id uuid;
  v_previous_expires_at timestamptz;
  v_new_expires_at timestamptz;
  v_status text;
BEGIN
  PERFORM set_config('lock_timeout', '800ms', true);
  PERFORM set_config('statement_timeout', '3000ms', true);

  IF p_session_id IS NULL OR p_actor IS NULL THEN
    RETURN jsonb_build_object(
      'expiry_grace_applied', false,
      'mark_ready_started_at', v_now,
      'ready_gate_grace_source', p_source,
      'ready_gate_grace_skipped', 'missing_session_or_actor'
    );
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.video_session_commands vsc
      WHERE vsc.session_id = p_session_id
        AND vsc.actor = p_actor
        AND vsc.command_kind = 'mark_ready'
        AND vsc.idempotency_key = v_key
    )
    INTO v_existing_command_found;
  END IF;

  SELECT MIN(vsc.created_at)
  INTO v_started_at
  FROM public.video_session_commands vsc
  WHERE vsc.session_id = p_session_id
    AND vsc.actor = p_actor
    AND vsc.command_kind = 'mark_ready';

  v_started_at := COALESCE(v_started_at, v_now);
  v_max_extend_until := v_started_at + v_grace_max_age;

  WITH candidate AS (
    SELECT
      vs.id,
      vs.event_id,
      vs.ready_gate_expires_at,
      vs.ready_gate_status
    FROM public.video_sessions vs
    WHERE vs.id = p_session_id
      AND p_actor IN (vs.participant_1_id, vs.participant_2_id)
      AND vs.ended_at IS NULL
      AND COALESCE(vs.state, 'ready_gate') = 'ready_gate'
      AND COALESCE(vs.phase, 'ready_gate') = 'ready_gate'
      AND COALESCE(vs.ready_gate_status, 'ready') IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed')
      AND (
        vs.ready_gate_expires_at IS NULL
        OR vs.ready_gate_expires_at <= v_extend_until
      )
      AND (
        vs.ready_gate_expires_at IS NULL
        OR vs.ready_gate_expires_at >= v_now - v_grace_window
      )
      AND (
        vs.ready_gate_expires_at IS NULL
        OR v_started_at <= vs.ready_gate_expires_at
      )
      AND v_now < v_max_extend_until
      AND (
        vs.ready_gate_expires_at IS NULL
        OR vs.ready_gate_expires_at < LEAST(v_extend_until, v_max_extend_until)
      )
  ),
  updated AS (
    UPDATE public.video_sessions vs
    SET
      ready_gate_expires_at = GREATEST(
        COALESCE(vs.ready_gate_expires_at, LEAST(v_extend_until, v_max_extend_until)),
        LEAST(v_extend_until, v_max_extend_until)
      ),
      state_updated_at = v_now
    FROM candidate c
    WHERE vs.id = c.id
      AND vs.ended_at IS NULL
      AND COALESCE(vs.state, 'ready_gate') = 'ready_gate'
      AND COALESCE(vs.phase, 'ready_gate') = 'ready_gate'
      AND COALESCE(vs.ready_gate_status, 'ready') IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed')
      AND (
        vs.ready_gate_expires_at IS NULL
        OR vs.ready_gate_expires_at <= v_extend_until
      )
      AND (
        vs.ready_gate_expires_at IS NULL
        OR vs.ready_gate_expires_at >= v_now - v_grace_window
      )
      AND (
        vs.ready_gate_expires_at IS NULL
        OR v_started_at <= vs.ready_gate_expires_at
      )
      AND v_now < v_max_extend_until
      AND (
        vs.ready_gate_expires_at IS NULL
        OR vs.ready_gate_expires_at < LEAST(v_extend_until, v_max_extend_until)
      )
    RETURNING
      c.event_id,
      c.ready_gate_expires_at AS previous_expires_at,
      vs.ready_gate_expires_at AS new_expires_at,
      vs.ready_gate_status
  )
  SELECT
    u.event_id,
    u.previous_expires_at,
    u.new_expires_at,
    u.ready_gate_status
  INTO
    v_event_id,
    v_previous_expires_at,
    v_new_expires_at,
    v_status
  FROM updated u
  LIMIT 1;

  IF v_new_expires_at IS NOT NULL THEN
    PERFORM public.record_event_loop_observability(
      'video_session_mark_ready_v2',
      'success',
      'mark_ready_expiry_grace_applied',
      NULL,
      v_event_id,
      p_actor,
      p_session_id,
      jsonb_build_object(
        'source', p_source,
        'retryable', COALESCE(p_retryable, false),
        'existing_command_found', v_existing_command_found,
        'mark_ready_started_at', v_started_at,
        'original_attempt_cap_applied', true,
        'previous_ready_gate_expires_at', v_previous_expires_at,
        'ready_gate_expires_at', v_new_expires_at,
        'ready_gate_status', v_status,
        'hot_path', true
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'expiry_grace_applied', v_new_expires_at IS NOT NULL,
    'mark_ready_started_at', v_started_at,
    'existing_command_found', v_existing_command_found,
    'original_attempt_cap_applied', true,
    'ready_gate_grace_source', p_source,
    'ready_gate_expires_at_before', v_previous_expires_at,
    'ready_gate_expires_at_after', v_new_expires_at,
    'ready_gate_status', v_status
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'expiry_grace_applied', false,
      'mark_ready_started_at', COALESCE(v_started_at, v_now),
      'ready_gate_grace_source', p_source,
      'ready_gate_grace_error', SQLSTATE,
      'ready_gate_grace_message', left(SQLERRM, 240)
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_grace_extend_v1(uuid, uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_grace_extend_v1(uuid, uuid, text, text, boolean)
  TO service_role;

COMMENT ON FUNCTION public.video_session_mark_ready_grace_extend_v1(uuid, uuid, text, text, boolean) IS
  'Internal Ready Gate mark-ready grace extender. Caps grace to the participant original mark-ready command for the session, not the latest idempotency key.';

DROP FUNCTION IF EXISTS public.video_session_mark_ready_v2_20260604131708_event_active_base(uuid, text, text);

ALTER FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  RENAME TO video_session_mark_ready_v2_20260604131708_event_active_base;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2_20260604131708_event_active_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

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
  v_now timestamptz := clock_timestamp();
  v_server_now_ms bigint := floor(extract(epoch from v_now) * 1000)::bigint;
  v_session public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_inactive_reason text;
  v_cleanup jsonb := '{}'::jsonb;
  v_status text;
  v_date_capable boolean := false;
  v_message text;
BEGIN
  IF p_session_id IS NULL OR v_actor IS NULL THEN
    RETURN public.video_session_mark_ready_v2_20260604131708_event_active_base(
      p_session_id,
      p_idempotency_key,
      p_request_hash
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF FOUND
     AND v_session.event_id IS NOT NULL
     AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id)
     AND v_session.ended_at IS NULL
     AND COALESCE(v_session.state, 'ready_gate'::public.video_date_state) = 'ready_gate'::public.video_date_state
     AND COALESCE(v_session.phase, 'ready_gate') = 'ready_gate'
     AND COALESCE(v_session.ready_gate_status, 'ready') IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed') THEN
    v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);

    IF v_inactive_reason IS NOT NULL THEN
      v_cleanup := public.terminalize_event_ready_gates(v_session.event_id, v_inactive_reason);

      SELECT *
      INTO v_after
      FROM public.video_sessions
      WHERE id = p_session_id;

      v_status := COALESCE(v_after.ready_gate_status, v_session.ready_gate_status, 'ended');
      v_date_capable := (
        v_after.handshake_started_at IS NOT NULL
        OR v_after.date_started_at IS NOT NULL
        OR v_after.daily_room_name IS NOT NULL
        OR v_after.daily_room_url IS NOT NULL
        OR v_after.participant_1_joined_at IS NOT NULL
        OR v_after.participant_2_joined_at IS NOT NULL
        OR v_after.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
        OR COALESCE(v_after.phase, '') IN ('handshake', 'date')
      );

      IF v_after.ended_at IS NOT NULL
         OR v_status IN ('expired', 'cancelled', 'ended', 'forfeited') THEN
        RETURN jsonb_build_object(
          'ok', true,
          'success', true,
          'status', v_status,
          'ready_gate_status', v_status,
          'result_status', v_status,
          'result_ready_gate_status', v_status,
          'ready_gate_expires_at', v_after.ready_gate_expires_at,
          'reason', COALESCE(v_after.ended_reason, 'ready_gate_event_ended'),
          'error_code', COALESCE(v_after.ended_reason, 'ready_gate_event_ended'),
          'inactive_reason', v_inactive_reason,
          'terminal', true,
          'event_id', v_after.event_id,
          'event_active_preflight_blocked', true,
          'cleanup', v_cleanup,
          'commandStatus', 'rejected',
          'server_now_ms', v_server_now_ms,
          'serverNowMs', v_server_now_ms
        );
      END IF;

      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'event_not_active',
        'code', 'EVENT_NOT_ACTIVE',
        'error_code', 'EVENT_NOT_ACTIVE',
        'reason', 'event_not_active',
        'inactive_reason', v_inactive_reason,
        'status', v_status,
        'ready_gate_status', v_status,
        'result_status', v_status,
        'result_ready_gate_status', v_status,
        'ready_gate_expires_at', COALESCE(v_after.ready_gate_expires_at, v_session.ready_gate_expires_at),
        'date_capable', v_date_capable,
        'retryable', false,
        'terminal', false,
        'event_id', COALESCE(v_after.event_id, v_session.event_id),
        'event_active_preflight_blocked', true,
        'cleanup', v_cleanup,
        'commandStatus', 'rejected',
        'server_now_ms', v_server_now_ms,
        'serverNowMs', v_server_now_ms
      );
    END IF;
  END IF;

  RETURN public.video_session_mark_ready_v2_20260604131708_event_active_base(
    p_session_id,
    p_idempotency_key,
    p_request_hash
  );
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'mark_ready_event_active_preflight_failed',
      'reason', 'mark_ready_event_active_preflight_failed',
      'code', 'MARK_READY_EVENT_ACTIVE_PREFLIGHT_FAILED',
      'error_code', 'MARK_READY_EVENT_ACTIVE_PREFLIGHT_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'retryable', true,
      'retry_after_seconds', 2,
      'retry_after_ms', 2000,
      'terminal', false,
      'event_active_preflight_degraded', true,
      'commandStatus', 'rejected',
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text) IS
  'Ready Gate mark-ready RPC with event-active preflight, original-attempt grace cap, retryable replay preservation, and standardized response fields.';

CREATE OR REPLACE FUNCTION public.ready_gate_transition(
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
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_actor uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_snapshot jsonb;
  v_result jsonb;
  v_status text;
  v_server_now_ms bigint;
  v_message text;
BEGIN
  IF v_action = 'mark_ready' THEN
    RETURN public.video_session_mark_ready_v2(
      p_session_id,
      p_session_id::text || ':phase3:mark_ready:legacy_ready_gate_transition',
      NULL
    ) || jsonb_build_object('legacy_ready_gate_transition_bridge', true);
  END IF;

  IF v_action = 'sync' AND v_actor IS NOT NULL THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND
       AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id)
       AND v_session.ended_at IS NULL
       AND v_session.ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
       AND (
         v_session.ready_gate_status <> 'queued'
         OR COALESCE(v_session.queued_expires_at, COALESCE(v_session.started_at, now()) + interval '10 minutes') > now()
       )
       AND (
         v_session.ready_gate_expires_at IS NULL
         OR v_session.ready_gate_expires_at > now()
         OR v_session.ready_gate_status = 'both_ready'
       )
       AND (
         v_session.ready_gate_status <> 'snoozed'
         OR v_session.snooze_expires_at IS NULL
         OR v_session.snooze_expires_at > now()
       ) THEN
      v_snapshot := public.get_video_date_start_snapshot_v1(p_session_id);

      IF NULLIF(COALESCE(v_snapshot->>'inactive_reason', v_snapshot->>'inactiveReason'), '') IS NULL THEN
        v_status := COALESCE(
          v_snapshot->>'ready_gate_status',
          v_snapshot->>'status',
          'unknown'
        );

        RETURN COALESCE(v_snapshot, '{}'::jsonb) || jsonb_build_object(
          'success', COALESCE((v_snapshot->>'ok')::boolean, false),
          'status', v_status,
          'ready_gate_status', v_status,
          'result_status', v_status,
          'result_ready_gate_status', v_status,
          'startup_snapshot', v_snapshot
        );
      END IF;
    END IF;
  END IF;

  v_result := public.ready_gate_transition_20260603150106_start_snapshot_base(
    p_session_id,
    p_action,
    p_reason
  );
  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    BEGIN
      v_snapshot := public.get_video_date_start_snapshot_v1(p_session_id);
    EXCEPTION
      WHEN OTHERS THEN
        v_snapshot := NULL;
    END;
    v_status := COALESCE(
      v_snapshot->>'ready_gate_status',
      v_snapshot->>'status',
      'unknown'
    );
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'ready_gate_transition_failed',
      'reason', 'ready_gate_transition_failed',
      'code', 'READY_GATE_TRANSITION_FAILED',
      'error_code', 'READY_GATE_TRANSITION_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'retryable', true,
      'retry_after_seconds', 2,
      'retry_after_ms', 2000,
      'status', v_status,
      'ready_gate_status', v_status,
      'result_status', v_status,
      'result_ready_gate_status', v_status,
      'startup_snapshot', v_snapshot,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.ready_gate_transition(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ready_gate_transition(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.ready_gate_transition(uuid, text, text) IS
  'Canonical Ready Gate transition RPC. mark_ready bridges to event-active hot path; active sync snapshots only when ready/queued/snoozed TTLs are still live.';

NOTIFY pgrst, 'reload schema';

COMMIT;
