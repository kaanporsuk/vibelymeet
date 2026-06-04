-- Ready Gate mark-ready hot path and retryable command replay recovery.
--
-- Production failure (2026-06-04): one participant tapped Ready, but their
-- video_session_mark_ready_v2 command was stored as rejected with SQLSTATE 57014
-- (statement timeout). Later taps reused the deterministic per-actor
-- idempotency key and replayed that rejected result, so the participant could
-- never become ready before the gate expired. The visible "Ready Gate changed"
-- toast was only the downstream symptom.
--
-- Root causes:
--   1. mark_ready delegated through the full ready_gate_transition wrapper chain.
--      That chain performs snapshot/room repair/observability/registration work
--      before the critical ready timestamp commit.
--   2. Older guarded mark_ready semantics rejected rows that already had
--      pre-warmed Daily room metadata, so wrappers cleared/re-derived metadata
--      around the ready write. That made the hot path lock-heavy.
--   3. Retryable command failures were replayed as terminal rejected commands.
--
-- Fix:
--   * video_session_mark_ready_v2 now owns a compact, row-locked mark_ready
--     mutation directly. It commits participant readiness first, tolerates
--     existing Daily metadata, and deterministically fills canonical Daily room
--     metadata only when the second ready tap reaches both_ready.
--   * Replay of a nonterminal retryable rejected command is reopened and retried
--     with the same idempotency key, preserving already deployed clients.
--   * The legacy ready_gate_transition('mark_ready') path bridges to the same
--     hot path so web, native, mobile, and older clients share one behavior.
--   * Event append / provider outbox / observability remain fail-soft.

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
  v_now timestamptz := now();
  v_server_now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_key text := COALESCE(NULLIF(btrim(p_idempotency_key), ''), p_session_id::text || ':phase3:mark_ready');
  v_request jsonb := jsonb_build_object('action', 'mark_ready');
  v_begin jsonb;
  v_command_id bigint;
  v_command_status text;
  v_request_hash text;
  v_replay_result jsonb := '{}'::jsonb;
  v_replay_retryable boolean := false;
  v_replay_terminal boolean := false;
  v_reopened_retryable_command boolean := false;
  v_session public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_is_p1 boolean := false;
  v_new_p1_ready_at timestamptz;
  v_new_p2_ready_at timestamptz;
  v_new_status text;
  v_expires_at timestamptz;
  v_expected_room_name text := 'date-' || replace(p_session_id::text, '-', '');
  v_domain text;
  v_url text;
  v_event jsonb := '{}'::jsonb;
  v_result jsonb;
  v_auxiliary_errors jsonb := '[]'::jsonb;
  v_message text;
  v_row_count integer := 0;
BEGIN
  PERFORM set_config('lock_timeout', '1200ms', true);
  PERFORM set_config('statement_timeout', '7000ms', true);

  IF v_actor IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'not_authenticated',
      'terminal', false,
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
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  END IF;

  v_command_status := COALESCE(v_begin->>'status', 'unknown');
  v_command_id := NULLIF(v_begin->>'commandId', '')::bigint;
  v_request_hash := v_begin->>'requestHash';

  IF v_command_status = 'replay' THEN
    SELECT *
    INTO v_after
    FROM public.video_sessions
    WHERE id = p_session_id;

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
      'session_seq', COALESCE(v_after.session_seq, ((v_begin->'result')->>'session_seq')::bigint),
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
      SELECT *
      INTO v_after
      FROM public.video_sessions
      WHERE id = p_session_id;

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
  ELSIF v_command_status IS DISTINCT FROM 'started' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'command_in_progress',
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
      'commandStatus', 'rejected',
      'commandId', v_command_id,
      'requestHash', v_request_hash,
      'terminal', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
    BEGIN
      PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
        v_result := v_result || jsonb_build_object(
          'command_finish_degraded', true,
          'command_finish_sqlstate', SQLSTATE,
          'command_finish_message', v_message
        );
    END;
    RETURN v_result;
  END IF;

  v_is_p1 := v_session.participant_1_id = v_actor;
  IF NOT v_is_p1 AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
    v_result := jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'not_participant',
      'commandStatus', 'rejected',
      'commandId', v_command_id,
      'requestHash', v_request_hash,
      'terminal', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
    BEGIN
      PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
        v_result := v_result || jsonb_build_object(
          'command_finish_degraded', true,
          'command_finish_sqlstate', SQLSTATE,
          'command_finish_message', v_message
        );
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
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
        v_result := v_result || jsonb_build_object(
          'command_finish_degraded', true,
          'command_finish_sqlstate', SQLSTATE,
          'command_finish_message', v_message
        );
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
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
        v_result := v_result || jsonb_build_object(
          'command_finish_degraded', true,
          'command_finish_sqlstate', SQLSTATE,
          'command_finish_message', v_message
        );
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
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
        v_result := v_result || jsonb_build_object(
          'command_finish_degraded', true,
          'command_finish_sqlstate', SQLSTATE,
          'command_finish_message', v_message
        );
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
    EXCEPTION
      WHEN OTHERS THEN
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
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
        v_result := v_result || jsonb_build_object(
          'command_finish_degraded', true,
          'command_finish_sqlstate', SQLSTATE,
          'command_finish_message', v_message
        );
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
    v_expires_at := GREATEST(
      COALESCE(v_session.ready_gate_expires_at, v_now),
      v_now + interval '45 seconds'
    );

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
  ELSIF v_is_p1 THEN
    v_new_status := 'ready_a';
    v_expires_at := COALESCE(v_session.ready_gate_expires_at, v_now + interval '30 seconds');
  ELSE
    v_new_status := 'ready_b';
    v_expires_at := COALESCE(v_session.ready_gate_expires_at, v_now + interval '30 seconds');
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
        THEN COALESCE(daily_room_provider_verify_reason, 'ready_gate_mark_ready_hot_path')
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
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
        v_result := v_result || jsonb_build_object(
          'command_finish_degraded', true,
          'command_finish_sqlstate', SQLSTATE,
          'command_finish_message', v_message
        );
    END;
    RETURN v_result;
  END IF;

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
        'status_before', v_session.ready_gate_status,
        'status_after', v_after.ready_gate_status,
        'ready_participant_1_at_before', v_session.ready_participant_1_at,
        'ready_participant_1_at_after', v_after.ready_participant_1_at,
        'ready_participant_2_at_before', v_session.ready_participant_2_at,
        'ready_participant_2_at_after', v_after.ready_participant_2_at,
        'ready_gate_expires_at_before', v_session.ready_gate_expires_at,
        'ready_gate_expires_at_after', v_after.ready_gate_expires_at,
        'daily_room_name', v_after.daily_room_name,
        'retryable_command_reopened', v_reopened_retryable_command
      )
    );
  EXCEPTION
    WHEN OTHERS THEN
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
        'hot_path', true
      ),
      jsonb_build_object(
        'ready_gate_status', v_after.ready_gate_status,
        'actor_role', CASE WHEN v_is_p1 THEN 'participant_1' ELSE 'participant_2' END
      ),
      true,
      gen_random_uuid()
    );
  EXCEPTION
    WHEN OTHERS THEN
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
          'source', 'video_session_mark_ready_v2_hot_path'
        ),
        'phase3:ensure_room:' || p_session_id::text,
        now()
      );
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
        v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
          'kind', 'daily_room_outbox',
          'sqlstate', SQLSTATE,
          'message', v_message
        ));
    END;
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
    'session_seq', COALESCE(NULLIF(v_event->>'sessionSeq', '')::bigint, v_after.session_seq),
    'terminal', v_after.ready_gate_status = 'both_ready',
    'auxiliary_errors', v_auxiliary_errors,
    'provider_outbox_degraded', jsonb_array_length(v_auxiliary_errors) > 0,
    'retryable_command_reopened', v_reopened_retryable_command,
    'server_now_ms', v_server_now_ms,
    'serverNowMs', v_server_now_ms
  );

  BEGIN
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
      v_result := v_result || jsonb_build_object(
        'command_finish_degraded', true,
        'command_finish_sqlstate', SQLSTATE,
        'command_finish_message', v_message
      );
  END;

  RETURN v_result;
EXCEPTION
  WHEN query_canceled OR lock_not_available THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

    BEGIN
      SELECT *
      INTO v_after
      FROM public.video_sessions
      WHERE id = p_session_id;
    EXCEPTION
      WHEN OTHERS THEN
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
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );

    IF v_command_id IS NOT NULL THEN
      BEGIN
        PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
      EXCEPTION
        WHEN OTHERS THEN
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
    EXCEPTION
      WHEN OTHERS THEN
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
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );

    IF v_command_id IS NOT NULL THEN
      BEGIN
        PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
      EXCEPTION
        WHEN OTHERS THEN
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
  'Hot-path Ready Gate mark-ready RPC. Commits participant readiness without room-metadata clearing, reopens retryable rejected commands for the same idempotency key, deterministically fills Daily room metadata at both_ready, and leaves auxiliary event/outbox work fail-soft.';

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
  'Canonical Ready Gate transition RPC. mark_ready bridges to the hot-path video_session_mark_ready_v2 implementation; active sync remains snapshot-backed; snooze/forfeit delegate to the prior transition stack.';

NOTIFY pgrst, 'reload schema';

COMMIT;
