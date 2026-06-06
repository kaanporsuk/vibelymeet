-- Video Date decisive Ready Gate mark-ready commit.
--
-- Latest production failure: one participant's mark-ready command repeatedly
-- returned retryable SQLSTATE 57014 payloads while the other participant was
-- already ready. Grace extended the gate, but no ready timestamp was committed,
-- so the session expired at ready_b before Daily could start.
--
-- Fix:
--   * Replace the public mark-ready RPC with a single direct hot path.
--   * Do not take a wrapper/preflight FOR UPDATE lock before command begin.
--   * Commit the participant ready timestamp and both_ready room metadata before
--     observability/event/outbox work.
--   * Keep idempotent replay, retryable rejected replay reopening, and stale
--     processing-command reclamation for already deployed web/native/mobile
--     clients.

BEGIN;

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
  v_key text := COALESCE(
    NULLIF(btrim(p_idempotency_key), ''),
    COALESCE(p_session_id::text, 'missing-session') || ':phase3:mark_ready'
  );
  v_request jsonb := jsonb_build_object('action', 'mark_ready');
  v_begin jsonb;
  v_command_id bigint;
  v_command_status text;
  v_request_hash text;
  v_replay_result jsonb := '{}'::jsonb;
  v_replay_retryable boolean := false;
  v_replay_terminal boolean := false;
  v_reopened_retryable_command boolean := false;
  v_reclaimed_processing_command boolean := false;
  v_command_created_at timestamptz;
  v_session public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_is_p1 boolean := false;
  v_actor_ready boolean := false;
  v_new_p1_ready_at timestamptz;
  v_new_p2_ready_at timestamptz;
  v_new_status text;
  v_expires_at timestamptz;
  v_expected_room_name text := 'date-' || replace(COALESCE(p_session_id::text, ''), '-', '');
  v_domain text;
  v_url text;
  v_inactive_reason text;
  v_status text;
  v_date_capable boolean := false;
  v_cleanup jsonb := '{}'::jsonb;
  v_result jsonb;
  v_event jsonb := '{}'::jsonb;
  v_auxiliary_errors jsonb := '[]'::jsonb;
  v_message text;
  v_row_count integer := 0;
BEGIN
  PERFORM set_config('lock_timeout', '10000ms', true);
  PERFORM set_config('statement_timeout', '20000ms', true);

  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'session_not_found',
      'reason', 'session_not_found',
      'code', 'SESSION_NOT_FOUND',
      'error_code', 'SESSION_NOT_FOUND',
      'retryable', false,
      'terminal', true,
      'commandStatus', 'rejected',
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  IF v_actor IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'not_authenticated',
      'reason', 'not_authenticated',
      'code', 'NOT_AUTHENTICATED',
      'error_code', 'NOT_AUTHENTICATED',
      'retryable', false,
      'terminal', false,
      'commandStatus', 'rejected',
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  v_begin := public.video_session_command_begin_v2(
    p_session_id,
    v_actor,
    'mark_ready',
    v_key,
    v_request,
    p_request_hash
  );

  IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
    RETURN COALESCE(v_begin, '{}'::jsonb) || jsonb_build_object(
      'ok', false,
      'success', false,
      'commandStatus', COALESCE(v_begin->>'status', 'rejected'),
      'terminal', false,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  v_command_status := COALESCE(v_begin->>'status', 'unknown');
  v_command_id := NULLIF(v_begin->>'commandId', '')::bigint;
  v_request_hash := v_begin->>'requestHash';

  IF v_command_status IN ('replay', 'replay_rejected', 'in_progress') THEN
    SELECT *
    INTO v_after
    FROM public.video_sessions
    WHERE id = p_session_id;

    v_actor_ready := (
      (v_after.participant_1_id = v_actor AND v_after.ready_participant_1_at IS NOT NULL)
      OR (v_after.participant_2_id = v_actor AND v_after.ready_participant_2_at IS NOT NULL)
      OR v_after.ready_gate_status = 'both_ready'
    );

    IF v_actor_ready AND v_command_status IS DISTINCT FROM 'in_progress' THEN
      RETURN COALESCE(v_begin->'result', '{}'::jsonb) || jsonb_build_object(
        'ok', true,
        'success', true,
        'commandStatus', v_command_status,
        'commandId', v_command_id,
        'requestHash', v_request_hash,
        'status', COALESCE(v_after.ready_gate_status, 'ready'),
        'ready_gate_status', COALESCE(v_after.ready_gate_status, 'ready'),
        'result_status', COALESCE(v_after.ready_gate_status, 'ready'),
        'result_ready_gate_status', COALESCE(v_after.ready_gate_status, 'ready'),
        'event_id', v_after.event_id,
        'participant_1_id', v_after.participant_1_id,
        'participant_2_id', v_after.participant_2_id,
        'ready_participant_1_at', v_after.ready_participant_1_at,
        'ready_participant_2_at', v_after.ready_participant_2_at,
        'ready_gate_expires_at', v_after.ready_gate_expires_at,
        'daily_room_name', v_after.daily_room_name,
        'daily_room_url', v_after.daily_room_url,
        'daily_room_verified_at', v_after.daily_room_verified_at,
        'daily_room_expires_at', v_after.daily_room_expires_at,
        'daily_room_provider_verify_reason', v_after.daily_room_provider_verify_reason,
        'session_seq', v_after.session_seq,
        'terminal', v_after.ready_gate_status = 'both_ready',
        'server_now_ms', v_server_now_ms,
        'serverNowMs', v_server_now_ms
      );
    END IF;
  END IF;

  IF v_command_status = 'replay' THEN
    RETURN COALESCE(v_begin->'result', '{}'::jsonb) || jsonb_build_object(
      'commandStatus', 'replay',
      'commandId', v_command_id,
      'requestHash', v_request_hash,
      'status', COALESCE(v_after.ready_gate_status, (v_begin->'result')->>'ready_gate_status', (v_begin->'result')->>'status'),
      'ready_gate_status', COALESCE(v_after.ready_gate_status, (v_begin->'result')->>'ready_gate_status', (v_begin->'result')->>'status'),
      'result_status', COALESCE(v_after.ready_gate_status, (v_begin->'result')->>'ready_gate_status', (v_begin->'result')->>'status'),
      'result_ready_gate_status', COALESCE(v_after.ready_gate_status, (v_begin->'result')->>'ready_gate_status', (v_begin->'result')->>'status'),
      'ready_participant_1_at', v_after.ready_participant_1_at,
      'ready_participant_2_at', v_after.ready_participant_2_at,
      'ready_gate_expires_at', v_after.ready_gate_expires_at,
      'daily_room_name', v_after.daily_room_name,
      'daily_room_url', v_after.daily_room_url,
      'session_seq', v_after.session_seq,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  IF v_command_status = 'replay_rejected' THEN
    v_replay_result := COALESCE(v_begin->'result', '{}'::jsonb);
    v_replay_retryable :=
      jsonb_typeof(v_replay_result->'retryable') = 'boolean'
      AND (v_replay_result->>'retryable')::boolean;
    v_replay_terminal :=
      jsonb_typeof(v_replay_result->'terminal') = 'boolean'
      AND (v_replay_result->>'terminal')::boolean;

    IF v_replay_retryable AND NOT v_replay_terminal THEN
      UPDATE public.video_session_commands
      SET
        status = 'processing',
        committed_at = NULL,
        result_payload = NULL
      WHERE id = v_command_id
        AND actor = v_actor
        AND session_id = p_session_id
        AND command_kind = 'mark_ready'
        AND idempotency_key = v_key
        AND request_hash = v_request_hash
        AND status = 'rejected'
      RETURNING id INTO v_command_id;

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      IF v_row_count = 0 THEN
        RETURN v_replay_result || jsonb_build_object(
          'commandStatus', 'replay_rejected',
          'commandId', NULLIF(v_begin->>'commandId', '')::bigint,
          'requestHash', v_request_hash,
          'server_now_ms', v_server_now_ms,
          'serverNowMs', v_server_now_ms
        );
      END IF;

      v_reopened_retryable_command := true;
    ELSE
      RETURN v_replay_result || jsonb_build_object(
        'commandStatus', 'replay_rejected',
        'commandId', v_command_id,
        'requestHash', v_request_hash,
        'status', COALESCE(v_after.ready_gate_status, v_replay_result->>'ready_gate_status', v_replay_result->>'status'),
        'ready_gate_status', COALESCE(v_after.ready_gate_status, v_replay_result->>'ready_gate_status', v_replay_result->>'status'),
        'result_status', COALESCE(v_after.ready_gate_status, v_replay_result->>'ready_gate_status', v_replay_result->>'status'),
        'result_ready_gate_status', COALESCE(v_after.ready_gate_status, v_replay_result->>'ready_gate_status', v_replay_result->>'status'),
        'server_now_ms', v_server_now_ms,
        'serverNowMs', v_server_now_ms
      );
    END IF;
  ELSIF v_command_status = 'in_progress' THEN
    SELECT created_at
    INTO v_command_created_at
    FROM public.video_session_commands
    WHERE id = v_command_id
      AND actor = v_actor
      AND session_id = p_session_id
      AND command_kind = 'mark_ready'
      AND idempotency_key = v_key
      AND request_hash = v_request_hash;

    IF v_command_created_at IS NOT NULL
       AND v_command_created_at < v_now - interval '6 seconds' THEN
      UPDATE public.video_session_commands
      SET
        status = 'processing',
        committed_at = NULL,
        result_payload = NULL
      WHERE id = v_command_id
        AND actor = v_actor
        AND session_id = p_session_id
        AND command_kind = 'mark_ready'
        AND idempotency_key = v_key
        AND request_hash = v_request_hash
        AND status = 'processing'
      RETURNING id INTO v_command_id;

      GET DIAGNOSTICS v_row_count = ROW_COUNT;
      v_reclaimed_processing_command := v_row_count > 0;
    END IF;

    IF NOT v_reclaimed_processing_command THEN
      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'command_in_progress',
        'reason', 'command_in_progress',
        'retryable', true,
        'retry_after_seconds', 1,
        'retry_after_ms', 1000,
        'commandStatus', 'in_progress',
        'commandId', v_command_id,
        'requestHash', v_request_hash,
        'terminal', false,
        'server_now_ms', v_server_now_ms,
        'serverNowMs', v_server_now_ms
      );
    END IF;
  ELSIF v_command_status IS DISTINCT FROM 'started' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'command_in_progress',
      'reason', 'command_in_progress',
      'retryable', true,
      'retry_after_seconds', 1,
      'retry_after_ms', 1000,
      'commandStatus', v_command_status,
      'commandId', v_command_id,
      'requestHash', v_request_hash,
      'terminal', false,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_result := jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'session_not_found',
      'reason', 'session_not_found',
      'code', 'SESSION_NOT_FOUND',
      'error_code', 'SESSION_NOT_FOUND',
      'retryable', false,
      'terminal', true,
      'commandStatus', 'rejected',
      'commandId', v_command_id,
      'requestHash', v_request_hash,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
    BEGIN
      PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN v_result;
  END IF;

  v_is_p1 := v_session.participant_1_id = v_actor;
  IF NOT v_is_p1 AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
    v_result := jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'not_participant',
      'reason', 'not_participant',
      'retryable', false,
      'terminal', true,
      'commandStatus', 'rejected',
      'commandId', v_command_id,
      'requestHash', v_request_hash,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
    BEGIN
      PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN v_result;
  END IF;

  IF v_session.event_id IS NOT NULL
     AND v_session.ended_at IS NULL
     AND COALESCE(v_session.state, 'ready_gate'::public.video_date_state) = 'ready_gate'::public.video_date_state
     AND COALESCE(v_session.phase, 'ready_gate') = 'ready_gate'
     AND COALESCE(v_session.ready_gate_status, 'ready') IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed') THEN
    v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
  END IF;

  IF v_inactive_reason IS NOT NULL THEN
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'expired',
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ended_at = v_now,
      ended_reason = COALESCE(ended_reason, v_inactive_reason),
      snoozed_by = NULL,
      snooze_expires_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
      ),
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND COALESCE(state, 'ready_gate'::public.video_date_state) = 'ready_gate'::public.video_date_state
      AND COALESCE(phase, 'ready_gate') = 'ready_gate'
      AND COALESCE(ready_gate_status, 'ready') IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed')
    RETURNING * INTO v_after;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = COALESCE(v_after.event_id, v_session.event_id)
      AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
      AND current_room_id = p_session_id;

    v_status := COALESCE(v_after.ready_gate_status, v_session.ready_gate_status, 'expired');
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
    v_cleanup := jsonb_build_object('session_terminalized', true);

    v_result := jsonb_build_object(
      'ok', true,
      'success', true,
      'status', v_status,
      'ready_gate_status', v_status,
      'result_status', v_status,
      'result_ready_gate_status', v_status,
      'ready_gate_expires_at', COALESCE(v_after.ready_gate_expires_at, v_session.ready_gate_expires_at),
      'reason', COALESCE(v_after.ended_reason, v_inactive_reason),
      'error_code', COALESCE(v_after.ended_reason, v_inactive_reason),
      'inactive_reason', v_inactive_reason,
      'date_capable', v_date_capable,
      'terminal', true,
      'event_id', COALESCE(v_after.event_id, v_session.event_id),
      'event_active_preflight_blocked', true,
      'cleanup', v_cleanup,
      'commandStatus', 'committed',
      'commandId', v_command_id,
      'requestHash', v_request_hash,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
    BEGIN
      PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN v_result;
  END IF;

  IF v_session.ended_at IS NOT NULL
     OR v_session.ready_gate_status IN ('forfeited', 'expired', 'cancelled', 'ended') THEN
    v_result := jsonb_build_object(
      'ok', true,
      'success', true,
      'status', COALESCE(v_session.ready_gate_status, 'ended'),
      'ready_gate_status', COALESCE(v_session.ready_gate_status, 'ended'),
      'result_status', COALESCE(v_session.ready_gate_status, 'ended'),
      'result_ready_gate_status', COALESCE(v_session.ready_gate_status, 'ended'),
      'ready_gate_expires_at', v_session.ready_gate_expires_at,
      'reason', COALESCE(v_session.ended_reason, 'terminal_state'),
      'terminal', true,
      'commandStatus', 'committed',
      'commandId', v_command_id,
      'requestHash', v_request_hash,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
    BEGIN
      PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN v_result;
  END IF;

  IF v_session.ready_gate_status = 'both_ready' THEN
    v_result := jsonb_build_object(
      'ok', true,
      'success', true,
      'status', 'both_ready',
      'ready_gate_status', 'both_ready',
      'result_status', 'both_ready',
      'result_ready_gate_status', 'both_ready',
      'event_id', v_session.event_id,
      'participant_1_id', v_session.participant_1_id,
      'participant_2_id', v_session.participant_2_id,
      'ready_participant_1_at', v_session.ready_participant_1_at,
      'ready_participant_2_at', v_session.ready_participant_2_at,
      'ready_gate_expires_at', v_session.ready_gate_expires_at,
      'daily_room_name', v_session.daily_room_name,
      'daily_room_url', v_session.daily_room_url,
      'daily_room_verified_at', v_session.daily_room_verified_at,
      'daily_room_expires_at', v_session.daily_room_expires_at,
      'daily_room_provider_verify_reason', v_session.daily_room_provider_verify_reason,
      'session_seq', v_session.session_seq,
      'terminal', true,
      'commandStatus', 'committed',
      'commandId', v_command_id,
      'requestHash', v_request_hash,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
    BEGIN
      PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN v_result;
  END IF;

  IF v_session.state IS DISTINCT FROM 'ready_gate'::public.video_date_state
     OR v_session.handshake_started_at IS NOT NULL
     OR v_session.date_started_at IS NOT NULL
     OR v_session.participant_1_joined_at IS NOT NULL
     OR v_session.participant_2_joined_at IS NOT NULL
     OR v_session.ready_gate_status NOT IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed') THEN
    v_result := jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'session_no_longer_ready_gate_mutable',
      'reason', 'session_no_longer_ready_gate_mutable',
      'status', v_session.ready_gate_status,
      'ready_gate_status', v_session.ready_gate_status,
      'result_status', v_session.ready_gate_status,
      'result_ready_gate_status', v_session.ready_gate_status,
      'terminal', false,
      'retryable', true,
      'retry_after_ms', 1000,
      'commandStatus', 'rejected',
      'commandId', v_command_id,
      'requestHash', v_request_hash,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
    BEGIN
      PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN v_result;
  END IF;

  IF v_session.ready_gate_expires_at IS NOT NULL
     AND v_session.ready_gate_expires_at <= v_now THEN
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'expired',
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ended_at = v_now,
      ended_reason = COALESCE(ended_reason, 'ready_gate_expired'),
      snoozed_by = NULL,
      snooze_expires_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
      ),
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND state = 'ready_gate'::public.video_date_state
      AND ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed')
      AND handshake_started_at IS NULL
      AND date_started_at IS NULL
      AND participant_1_joined_at IS NULL
      AND participant_2_joined_at IS NULL
    RETURNING * INTO v_after;

    BEGIN
      UPDATE public.event_registrations
      SET
        queue_status = 'idle',
        current_room_id = NULL,
        current_partner_id = NULL,
        last_active_at = v_now
      WHERE event_id = COALESCE(v_after.event_id, v_session.event_id)
        AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
        AND current_room_id = p_session_id;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
        'kind', 'expired_registration_cleanup',
        'sqlstate', SQLSTATE,
        'message', v_message
      ));
    END;

    v_result := jsonb_build_object(
      'ok', true,
      'success', true,
      'status', 'expired',
      'ready_gate_status', 'expired',
      'result_status', 'expired',
      'result_ready_gate_status', 'expired',
      'ready_gate_expires_at', COALESCE(v_after.ready_gate_expires_at, v_session.ready_gate_expires_at),
      'reason', 'ready_gate_expired',
      'error_code', 'ready_gate_expired',
      'terminal', true,
      'auxiliary_errors', v_auxiliary_errors,
      'commandStatus', 'committed',
      'commandId', v_command_id,
      'requestHash', v_request_hash,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
    BEGIN
      PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN v_result;
  END IF;

  v_new_p1_ready_at := v_session.ready_participant_1_at;
  v_new_p2_ready_at := v_session.ready_participant_2_at;

  IF v_is_p1 THEN
    v_new_p1_ready_at := COALESCE(v_new_p1_ready_at, v_now);
  ELSE
    v_new_p2_ready_at := COALESCE(v_new_p2_ready_at, v_now);
  END IF;

  IF v_new_p1_ready_at IS NOT NULL AND v_new_p2_ready_at IS NOT NULL THEN
    v_new_status := 'both_ready';
  ELSIF v_is_p1 THEN
    v_new_status := 'ready_a';
  ELSE
    v_new_status := 'ready_b';
  END IF;

  v_expires_at := GREATEST(
    COALESCE(v_session.ready_gate_expires_at, v_now),
    v_now + interval '45 seconds'
  );

  IF v_new_status = 'both_ready' THEN
    v_domain := nullif(btrim(current_setting('app.daily_domain', true)), '');
    IF v_domain IS NULL AND v_session.daily_room_url IS NOT NULL THEN
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
  END IF;

  UPDATE public.video_sessions
  SET
    ready_participant_1_at = v_new_p1_ready_at,
    ready_participant_2_at = v_new_p2_ready_at,
    ready_gate_status = v_new_status,
    ready_gate_expires_at = v_expires_at,
    daily_room_name = CASE
      WHEN v_new_status = 'both_ready' THEN v_expected_room_name
      ELSE daily_room_name
    END,
    daily_room_url = CASE
      WHEN v_new_status = 'both_ready' THEN v_url
      ELSE daily_room_url
    END,
    daily_room_provider_verify_reason = CASE
      WHEN v_new_status = 'both_ready'
        THEN COALESCE(daily_room_provider_verify_reason, 'ready_gate_mark_ready_decisive_commit')
      ELSE daily_room_provider_verify_reason
    END,
    state = 'ready_gate'::public.video_date_state,
    phase = 'ready_gate',
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL
    AND state = 'ready_gate'::public.video_date_state
    AND ready_gate_status IN ('queued', 'ready', 'ready_a', 'ready_b', 'snoozed')
    AND handshake_started_at IS NULL
    AND date_started_at IS NULL
    AND participant_1_joined_at IS NULL
    AND participant_2_joined_at IS NULL
  RETURNING * INTO v_after;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;

  IF v_row_count = 0 THEN
    SELECT *
    INTO v_after
    FROM public.video_sessions
    WHERE id = p_session_id;

    v_result := jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'guarded_update_zero_rows',
      'reason', 'guarded_update_zero_rows',
      'status', COALESCE(v_after.ready_gate_status, 'unknown'),
      'ready_gate_status', COALESCE(v_after.ready_gate_status, 'unknown'),
      'result_status', COALESCE(v_after.ready_gate_status, 'unknown'),
      'result_ready_gate_status', COALESCE(v_after.ready_gate_status, 'unknown'),
      'retryable', true,
      'retry_after_ms', 1000,
      'terminal', COALESCE(v_after.ended_at IS NOT NULL, false),
      'commandStatus', 'rejected',
      'commandId', v_command_id,
      'requestHash', v_request_hash,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
    BEGIN
      PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RETURN v_result;
  END IF;

  v_result := jsonb_build_object(
    'ok', true,
    'success', true,
    'commandStatus', 'committed',
    'commandId', v_command_id,
    'requestHash', v_request_hash,
    'status', v_after.ready_gate_status,
    'ready_gate_status', v_after.ready_gate_status,
    'result_status', v_after.ready_gate_status,
    'result_ready_gate_status', v_after.ready_gate_status,
    'event_id', v_after.event_id,
    'participant_1_id', v_after.participant_1_id,
    'participant_2_id', v_after.participant_2_id,
    'ready_participant_1_at', v_after.ready_participant_1_at,
    'ready_participant_2_at', v_after.ready_participant_2_at,
    'ready_gate_expires_at', v_after.ready_gate_expires_at,
    'snoozed_by', v_after.snoozed_by,
    'snooze_expires_at', v_after.snooze_expires_at,
    'daily_room_name', v_after.daily_room_name,
    'daily_room_url', v_after.daily_room_url,
    'daily_room_verified_at', v_after.daily_room_verified_at,
    'daily_room_expires_at', v_after.daily_room_expires_at,
    'daily_room_provider_verify_reason', v_after.daily_room_provider_verify_reason,
    'session_seq', v_after.session_seq,
    'terminal', v_after.ready_gate_status = 'both_ready',
    'provider_outbox_degraded', false,
    'retryable_command_reopened', v_reopened_retryable_command,
    'reclaimed_processing_command', v_reclaimed_processing_command,
    'hot_path', true,
    'decisive_mark_ready_commit', true,
    'server_now_ms', v_server_now_ms,
    'serverNowMs', v_server_now_ms
  );

  BEGIN
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_result := v_result || jsonb_build_object(
      'command_finish_degraded', true,
      'command_finish_sqlstate', SQLSTATE,
      'command_finish_message', v_message
    );
  END;

  BEGIN
    PERFORM public.record_event_loop_observability(
      'ready_gate_transition',
      'success',
      'mark_ready',
      NULL,
      v_after.event_id,
      v_actor,
      p_session_id,
      jsonb_build_object(
        'action', 'mark_ready',
        'hot_path', true,
        'decisive_mark_ready_commit', true,
        'status_before', v_session.ready_gate_status,
        'status_after', v_after.ready_gate_status,
        'ready_participant_1_at_before', v_session.ready_participant_1_at,
        'ready_participant_1_at_after', v_after.ready_participant_1_at,
        'ready_participant_2_at_before', v_session.ready_participant_2_at,
        'ready_participant_2_at_after', v_after.ready_participant_2_at,
        'ready_gate_expires_at_before', v_session.ready_gate_expires_at,
        'ready_gate_expires_at_after', v_after.ready_gate_expires_at,
        'daily_room_name', v_after.daily_room_name,
        'retryable_command_reopened', v_reopened_retryable_command,
        'reclaimed_processing_command', v_reclaimed_processing_command
      )
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
      'kind', 'observability',
      'sqlstate', SQLSTATE,
      'message', v_message
    ));
  END;

  BEGIN
    v_event := public.append_video_session_event_v2(
      p_session_id,
      CASE WHEN v_after.ready_gate_status = 'both_ready' THEN 'ready_gate_both_ready' ELSE 'ready_gate_mark_ready' END,
      'participants',
      v_actor,
      jsonb_build_object(
        'action', 'mark_ready',
        'ready_gate_status', v_after.ready_gate_status,
        'actor_role', CASE WHEN v_is_p1 THEN 'participant_1' ELSE 'participant_2' END,
        'hot_path', true,
        'decisive_mark_ready_commit', true
      ),
      jsonb_build_object(
        'ready_gate_status', v_after.ready_gate_status,
        'actor_role', CASE WHEN v_is_p1 THEN 'participant_1' ELSE 'participant_2' END
      ),
      true,
      gen_random_uuid()
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
      'kind', 'event_append',
      'sqlstate', SQLSTATE,
      'message', v_message
    ));
    v_event := '{}'::jsonb;
  END;

  IF v_after.ready_gate_status = 'both_ready' THEN
    BEGIN
      PERFORM public.video_date_outbox_enqueue_v2(
        p_session_id,
        'daily.ensure_video_date_room',
        jsonb_build_object(
          'roomName', COALESCE(NULLIF(v_after.daily_room_name, ''), v_expected_room_name),
          'source', 'video_session_mark_ready_v2_decisive_commit'
        ),
        'phase3:ensure_room:' || p_session_id::text,
        now()
      );
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
        'kind', 'daily_room_outbox',
        'sqlstate', SQLSTATE,
        'message', v_message
      ));
    END;
  END IF;

  RETURN v_result || jsonb_build_object(
    'session_seq', v_after.session_seq,
    'auxiliary_errors', v_auxiliary_errors,
    'provider_outbox_degraded', jsonb_array_length(v_auxiliary_errors) > 0
  );
EXCEPTION
  WHEN query_canceled OR lock_not_available THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

    BEGIN
      SELECT *
      INTO v_after
      FROM public.video_sessions
      WHERE id = p_session_id;
    EXCEPTION WHEN OTHERS THEN
      v_after := NULL;
    END;

    v_result := jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'mark_ready_timeout',
      'reason', 'mark_ready_timeout',
      'code', 'READY_GATE_TRANSITION_TIMEOUT',
      'error_code', 'READY_GATE_TRANSITION_TIMEOUT',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'retryable', true,
      'retry_after_seconds', 1,
      'retry_after_ms', 1000,
      'status', COALESCE(v_after.ready_gate_status, 'unknown'),
      'ready_gate_status', COALESCE(v_after.ready_gate_status, 'unknown'),
      'result_status', COALESCE(v_after.ready_gate_status, 'unknown'),
      'result_ready_gate_status', COALESCE(v_after.ready_gate_status, 'unknown'),
      'terminal', COALESCE(v_after.ended_at IS NOT NULL, false),
      'commandStatus', 'rejected',
      'commandId', v_command_id,
      'requestHash', v_request_hash,
      'hot_path', true,
      'decisive_mark_ready_commit', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );

    IF v_command_id IS NOT NULL THEN
      BEGIN
        PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;

    RETURN v_result;
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

    BEGIN
      SELECT *
      INTO v_after
      FROM public.video_sessions
      WHERE id = p_session_id;
    EXCEPTION WHEN OTHERS THEN
      v_after := NULL;
    END;

    v_result := jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'mark_ready_failed',
      'reason', 'mark_ready_failed',
      'code', 'MARK_READY_FAILED',
      'error_code', 'MARK_READY_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'retryable', true,
      'retry_after_seconds', 1,
      'retry_after_ms', 1000,
      'status', COALESCE(v_after.ready_gate_status, 'unknown'),
      'ready_gate_status', COALESCE(v_after.ready_gate_status, 'unknown'),
      'result_status', COALESCE(v_after.ready_gate_status, 'unknown'),
      'result_ready_gate_status', COALESCE(v_after.ready_gate_status, 'unknown'),
      'terminal', COALESCE(v_after.ended_at IS NOT NULL, false),
      'commandStatus', 'rejected',
      'commandId', v_command_id,
      'requestHash', v_request_hash,
      'hot_path', true,
      'decisive_mark_ready_commit', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );

    IF v_command_id IS NOT NULL THEN
      BEGIN
        PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;

    RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text) IS
  'Decisive Ready Gate mark-ready RPC. Commits participant readiness and deterministic both_ready room metadata before observability/outbox work, without delegating through the legacy wrapper stack.';

NOTIFY pgrst, 'reload schema';

COMMIT;
