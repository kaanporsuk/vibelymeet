CREATE OR REPLACE FUNCTION public.video_session_mark_ready_v2(p_session_id uuid, p_idempotency_key text DEFAULT NULL::text, p_request_hash text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
-- video_session_mark_ready_v2.single_body_core (rebuild PR 4): actionability
-- precheck -> event-inactive sweep -> decisive command core -> both-ready
-- entry protection -> partner/date-starting notifications -> enrichment ->
-- both-ready route payload owner, inside the hot-path no-throw shell.
DECLARE
  v_actor uuid := NULL;
  v_now timestamptz := clock_timestamp();
  v_server_now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_key text := COALESCE(
    NULLIF(btrim(p_idempotency_key), ''),
    COALESCE(p_session_id::text, 'missing-session') || ':phase3:mark_ready'
  );
  v_request jsonb := jsonb_build_object('action', 'mark_ready');
  v_precheck jsonb;
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
  v_clean_result jsonb;
  v_protection jsonb;
  v_success boolean := false;
  v_event_id uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_partner_id uuid;
  v_recipient uuid;
  v_enqueue_result jsonb;
  v_path text;
  v_notification_degraded boolean := false;
  v_date_starting_degraded boolean := false;
  v_auxiliary_errors jsonb := '[]'::jsonb;
  v_row_count integer := 0;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  BEGIN
    v_actor := auth.uid();
  EXCEPTION
    WHEN OTHERS THEN
      v_actor := NULL;
  END;

  -- ── Hot-path no-throw shell: everything below returns structured JSON. ──
  BEGIN
    -- ── Decisive actionability precheck (owner-eligibility + participant
    -- eligibility + safety + registration, locking the session and both
    -- registration rows; invalid gates terminalize). ──
    v_precheck := public.video_date_ready_gate_actionability_v1(
      p_session_id,
      v_actor,
      'video_session_mark_ready_v2',
      false,
      true,
      true,
      true
    );

    IF lower(COALESCE(v_precheck ->> 'ok', 'false')) NOT IN ('true', 't', '1', 'yes') THEN
      v_result := v_precheck
        - 'sqlstate'
        - 'message'
        - 'detail'
        - 'hint'
        - 'context'
        || jsonb_build_object(
          'ok', false,
          'success', false,
          'session_id', p_session_id,
          'commandStatus', 'rejected',
          'decisive_mark_ready_prechecked', true,
          'server_now_ms', v_server_now_ms,
          'serverNowMs', v_server_now_ms
        );
    ELSE
      -- ── Event-inactive sweep (former routeable_entry pre-pass): events
      -- that died between the precheck statement and this statement still
      -- terminalize their gates before the decisive commit. ──
      IF p_session_id IS NOT NULL THEN
        SELECT *
        INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id;

        IF FOUND
           AND v_session.event_id IS NOT NULL
           AND v_session.ended_at IS NULL
           AND COALESCE(v_session.state, 'ready_gate'::public.video_date_state) = 'ready_gate'::public.video_date_state
           AND COALESCE(v_session.phase, 'ready_gate') = 'ready_gate'
           AND COALESCE(v_session.ready_gate_status, 'ready') IN ('queued', 'ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed') THEN
          v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);
          IF v_inactive_reason IS NOT NULL THEN
            PERFORM public.terminalize_event_ready_gates(v_session.event_id, v_inactive_reason);
          END IF;
          v_inactive_reason := NULL;
        END IF;
      END IF;

      -- ── Decisive event-cleanup command core. Its own handlers own the
      -- READY_GATE_TRANSITION_TIMEOUT / MARK_READY_FAILED payloads and the
      -- command-finish bookkeeping. ──
      BEGIN
        PERFORM set_config('lock_timeout', '10000ms', true);
        PERFORM set_config('statement_timeout', '20000ms', true);

        IF p_session_id IS NULL THEN
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
            'server_now_ms', v_server_now_ms,
            'serverNowMs', v_server_now_ms
          );
        ELSIF v_actor IS NULL THEN
          v_result := jsonb_build_object(
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
        ELSE
          v_begin := public.video_session_command_begin_v2(
            p_session_id,
            v_actor,
            'mark_ready',
            v_key,
            v_request,
            p_request_hash
          );

          IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
            v_result := COALESCE(v_begin, '{}'::jsonb) || jsonb_build_object(
              'ok', false,
              'success', false,
              'commandStatus', COALESCE(v_begin->>'status', 'rejected'),
              'terminal', false,
              'server_now_ms', v_server_now_ms,
              'serverNowMs', v_server_now_ms
            );
          ELSE
            v_command_status := COALESCE(v_begin->>'status', 'unknown');
            v_command_id := NULLIF(v_begin->>'commandId', '')::bigint;
            v_request_hash := v_begin->>'requestHash';
            v_result := NULL;

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
                v_result := COALESCE(v_begin->'result', '{}'::jsonb) || jsonb_build_object(
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

            IF v_result IS NULL AND v_command_status = 'replay' THEN
              v_result := COALESCE(v_begin->'result', '{}'::jsonb) || jsonb_build_object(
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

            IF v_result IS NULL AND v_command_status = 'replay_rejected' THEN
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
                  v_result := v_replay_result || jsonb_build_object(
                    'commandStatus', 'replay_rejected',
                    'commandId', NULLIF(v_begin->>'commandId', '')::bigint,
                    'requestHash', v_request_hash,
                    'server_now_ms', v_server_now_ms,
                    'serverNowMs', v_server_now_ms
                  );
                ELSE
                  v_reopened_retryable_command := true;
                END IF;
              ELSE
                v_result := v_replay_result || jsonb_build_object(
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
            ELSIF v_result IS NULL AND v_command_status = 'in_progress' THEN
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
                v_result := jsonb_build_object(
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
            ELSIF v_result IS NULL AND v_command_status IS DISTINCT FROM 'started' THEN
              v_result := jsonb_build_object(
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

            IF v_result IS NULL THEN
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
              ELSE
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
                END IF;
              END IF;
            END IF;

            IF v_result IS NULL THEN
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
                  v_after.entry_started_at IS NOT NULL
                  OR v_after.date_started_at IS NOT NULL
                  OR v_after.daily_room_name IS NOT NULL
                  OR v_after.daily_room_url IS NOT NULL
                  OR v_after.participant_1_joined_at IS NOT NULL
                  OR v_after.participant_2_joined_at IS NOT NULL
                  OR v_after.state IN ('entry'::public.video_date_state, 'date'::public.video_date_state)
                  OR COALESCE(v_after.phase, '') IN ('entry', 'date')
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
              ELSIF v_session.ended_at IS NOT NULL
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
              ELSIF v_session.ready_gate_status = 'both_ready' THEN
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
              ELSIF v_session.state IS DISTINCT FROM 'ready_gate'::public.video_date_state
                 OR v_session.entry_started_at IS NOT NULL
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
              ELSIF v_session.ready_gate_expires_at IS NOT NULL
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
                  AND entry_started_at IS NULL
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
                  BEGIN
                    PERFORM public.video_date_lifecycle_observe_exception_v2(
                      p_session_id, v_actor,
                      'video_session_mark_ready_v2.expired_registration_cleanup',
                      SQLSTATE, v_message, NULL, NULL);
                  EXCEPTION WHEN OTHERS THEN
                    NULL;
                  END;
                  v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
                    'kind', 'expired_registration_cleanup'
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
              ELSE
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
                  AND entry_started_at IS NULL
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
                ELSE
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
                    BEGIN
                      PERFORM public.video_date_lifecycle_observe_exception_v2(
                        p_session_id, v_actor,
                        'video_session_mark_ready_v2.command_finish',
                        SQLSTATE, v_message, NULL, NULL);
                    EXCEPTION WHEN OTHERS THEN
                      NULL;
                    END;
                    v_result := v_result || jsonb_build_object(
                      'command_finish_degraded', true
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
                    BEGIN
                      PERFORM public.video_date_lifecycle_observe_exception_v2(
                        p_session_id, v_actor,
                        'video_session_mark_ready_v2.observability',
                        SQLSTATE, v_message, NULL, NULL);
                    EXCEPTION WHEN OTHERS THEN
                      NULL;
                    END;
                    v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
                      'kind', 'observability'
                    ));
                  END;

                  BEGIN
                    PERFORM public.append_video_session_event_v2(
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
                    BEGIN
                      PERFORM public.video_date_lifecycle_observe_exception_v2(
                        p_session_id, v_actor,
                        'video_session_mark_ready_v2.event_append',
                        SQLSTATE, v_message, NULL, NULL);
                    EXCEPTION WHEN OTHERS THEN
                      NULL;
                    END;
                    v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
                      'kind', 'event_append'
                    ));
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
                      BEGIN
                        PERFORM public.video_date_lifecycle_observe_exception_v2(
                          p_session_id, v_actor,
                          'video_session_mark_ready_v2.daily_room_outbox',
                          SQLSTATE, v_message, NULL, NULL);
                      EXCEPTION WHEN OTHERS THEN
                        NULL;
                      END;
                      v_auxiliary_errors := v_auxiliary_errors || jsonb_build_array(jsonb_build_object(
                        'kind', 'daily_room_outbox'
                      ));
                    END;
                  END IF;

                  v_result := v_result || jsonb_build_object(
                    'session_seq', v_after.session_seq,
                    'auxiliary_errors', v_auxiliary_errors,
                    'provider_outbox_degraded', jsonb_array_length(v_auxiliary_errors) > 0
                  );
                END IF;
              END IF;
            END IF;
          END IF;
        END IF;
      EXCEPTION
        WHEN query_canceled OR lock_not_available THEN
          GET STACKED DIAGNOSTICS
            v_message = MESSAGE_TEXT,
            v_detail = PG_EXCEPTION_DETAIL,
            v_hint = PG_EXCEPTION_HINT;
          v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

          BEGIN
            PERFORM public.video_date_lifecycle_observe_exception_v2(
              p_session_id,
              v_actor,
              'video_session_mark_ready_v2.decisive_core_timeout',
              SQLSTATE,
              v_message,
              v_detail,
              v_hint
            );
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END;

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
        WHEN OTHERS THEN
          GET STACKED DIAGNOSTICS
            v_message = MESSAGE_TEXT,
            v_detail = PG_EXCEPTION_DETAIL,
            v_hint = PG_EXCEPTION_HINT;
          v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

          BEGIN
            PERFORM public.video_date_lifecycle_observe_exception_v2(
              p_session_id,
              v_actor,
              'video_session_mark_ready_v2.decisive_core',
              SQLSTATE,
              v_message,
              v_detail,
              v_hint
            );
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END;

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
      END;

      -- ── Both-ready entry protection (former review_comments post): runs on
      -- the un-enriched core result. ──
      v_success := COALESCE(
        NULLIF(v_result ->> 'success', '')::boolean,
        NULLIF(v_result ->> 'ok', '')::boolean,
        false
      );
      v_status := COALESCE(
        NULLIF(v_result ->> 'ready_gate_status', ''),
        NULLIF(v_result ->> 'result_ready_gate_status', ''),
        NULLIF(v_result ->> 'status', '')
      );

      IF v_success AND v_status = 'both_ready' THEN
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

      -- ── First-ready partner notification (former terminal_truth post). ──
      v_event_id := NULLIF(v_result ->> 'event_id', '')::uuid;
      v_p1 := NULLIF(v_result ->> 'participant_1_id', '')::uuid;
      v_p2 := NULLIF(v_result ->> 'participant_2_id', '')::uuid;
      v_partner_id := CASE
        WHEN v_actor IS NOT NULL AND v_actor = v_p1 THEN v_p2
        WHEN v_actor IS NOT NULL AND v_actor = v_p2 THEN v_p1
        ELSE NULL
      END;

      IF v_success
         AND v_status IN ('ready_a', 'ready_b')
         AND v_partner_id IS NOT NULL THEN
        BEGIN
          PERFORM public.video_date_outbox_enqueue_v2(
            p_session_id,
            'notification.send',
            jsonb_build_object(
              'user_id', v_partner_id,
              'recipient_id', v_partner_id,
              'match_user_id', v_actor,
              'category', 'partner_ready',
              'title', 'Your match is ready!',
              'body', 'Tap to start your video date',
              'data', jsonb_build_object(
                'session_id', p_session_id,
                'event_id', v_event_id,
                'ready_gate_status', v_status,
                'actor_id', v_actor,
                'source', 'video_session_mark_ready_v2_first_ready'
              ),
              'dedupe_key', 'video_date:partner_ready:' || p_session_id::text || ':' || v_partner_id::text,
              'provider_idempotency_key', 'video_date:partner_ready:' || p_session_id::text || ':' || v_partner_id::text,
              'source', 'video_session_mark_ready_v2',
              'event_id', v_event_id,
              'session_id', p_session_id,
              'actor_id', v_actor
            ),
            'notification:partner_ready:' || p_session_id::text || ':' || v_partner_id::text,
            now()
          );
        EXCEPTION
          WHEN OTHERS THEN
            v_notification_degraded := true;
        END;
      END IF;

      v_result := v_result || jsonb_build_object(
        'ready_gate_actionability_checked', true,
        'partner_ready_notification_degraded', v_notification_degraded
      );
    END IF;

    -- ── Enrichment (former both_ready_owner post): applies to every outcome,
    -- including precheck rejections. ──
    BEGIN
      v_result := public.video_date_lifecycle_enrich_and_sanitize_payload_v2(
        p_session_id,
        v_actor,
        'video_session_mark_ready_v2',
        v_result
      );
    EXCEPTION
      WHEN OTHERS THEN
        v_result := COALESCE(v_result, '{}'::jsonb)
          - 'message'
          - 'detail'
          - 'hint'
          || jsonb_build_object(
            'ok', false,
            'success', false,
            'session_id', p_session_id,
            'error', 'mark_ready_enrichment_failed',
            'reason', 'mark_ready_enrichment_failed',
            'code', 'MARK_READY_ENRICHMENT_FAILED',
            'error_code', 'MARK_READY_ENRICHMENT_FAILED',
            'retryable', true
          );
    END;

    -- ── Both-ready route owner (former active_entry post): safety-payload
    -- hygiene, date_starting notifications, route payload, shell markers. ──
    v_clean_result := COALESCE(v_result, '{}'::jsonb);
    IF COALESCE(v_clean_result ->> 'code', v_clean_result ->> 'error_code') = 'SAFETY_CHECK_UNAVAILABLE' THEN
      v_clean_result := v_clean_result
        - 'sqlstate'
        - 'message'
        - 'detail'
        - 'hint'
        - 'context'
        - 'auxiliary_errors';
    END IF;

    v_success := lower(COALESCE(v_clean_result ->> 'success', v_clean_result ->> 'ok', 'false')) IN ('true', 't', '1', 'yes');
    v_status := COALESCE(
      NULLIF(v_clean_result ->> 'ready_gate_status', ''),
      NULLIF(v_clean_result ->> 'result_ready_gate_status', ''),
      NULLIF(v_clean_result ->> 'status', '')
    );

    IF v_success AND v_status = 'both_ready' THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;

      IF FOUND THEN
        v_path := '/date/' || p_session_id::text;
        FOREACH v_recipient IN ARRAY ARRAY[v_session.participant_1_id, v_session.participant_2_id]
        LOOP
          BEGIN
            v_enqueue_result := public.video_date_outbox_enqueue_v2(
              p_session_id,
              'notification.send',
              jsonb_build_object(
                'user_id', v_recipient,
                'recipient_id', v_recipient,
                'match_user_id', CASE
                  WHEN v_recipient = v_session.participant_1_id THEN v_session.participant_2_id
                  ELSE v_session.participant_1_id
                END,
                'category', 'date_starting',
                'title', 'Your video date is starting',
                'body', 'Tap to join your video date',
                'data', jsonb_build_object(
                  'session_id', p_session_id,
                  'event_id', v_session.event_id,
                  'ready_gate_status', v_status,
                  'actor_id', v_actor,
                  'url', v_path,
                  'deep_link', v_path,
                  'source', 'video_session_mark_ready_v2_both_ready'
                ),
                'dedupe_key', 'video_date:date_starting:' || p_session_id::text || ':' || v_recipient::text,
                'provider_idempotency_key', 'video_date:date_starting:' || p_session_id::text || ':' || v_recipient::text,
                'source', 'video_session_mark_ready_v2',
                'event_id', v_session.event_id,
                'session_id', p_session_id,
                'actor_id', v_actor
              ),
              'notification:date_starting:' || p_session_id::text || ':' || v_recipient::text,
              now()
            );

            IF lower(COALESCE(v_enqueue_result ->> 'ok', v_enqueue_result ->> 'success', 'false')) NOT IN ('true', 't', '1', 'yes') THEN
              v_date_starting_degraded := true;
            END IF;
          EXCEPTION
            WHEN OTHERS THEN
              v_date_starting_degraded := true;
          END;
        END LOOP;
      END IF;
    END IF;

    RETURN public.video_date_both_ready_route_payload_v1(
      p_session_id,
      v_actor,
      v_clean_result || jsonb_build_object(
        'date_starting_notification_degraded', v_date_starting_degraded,
        'both_ready_route_owner_checked', true
      ),
      'video_session_mark_ready_v2.both_ready_owner'
    ) || jsonb_build_object(
      'active_entry_failsoft_shell', true,
      'hot_path_no_throw_shell', true
    );
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;

      BEGIN
        RETURN public.video_date_lifecycle_exception_payload_v2(
          p_session_id,
          v_actor,
          'video_session_mark_ready_v2.hot_path_shell',
          'mark_ready_unavailable',
          'MARK_READY_UNAVAILABLE',
          true,
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        ) || jsonb_build_object(
          'hot_path_no_throw_shell', true,
          'active_entry_failsoft_shell', true,
          'commandStatus', 'rejected'
        );
      EXCEPTION
        WHEN OTHERS THEN
          BEGIN
            RETURN public.video_date_direct_json_fallback_v1(
              p_session_id,
              v_actor,
              'video_session_mark_ready_v2',
              'mark_ready_wrapper_failed',
              'MARK_READY_WRAPPER_FAILED',
              true,
              SQLSTATE
            ) || jsonb_build_object(
              'hot_path_no_throw_shell', true,
              'active_entry_failsoft_shell', true,
              'commandStatus', 'rejected'
            );
          EXCEPTION
            WHEN OTHERS THEN
              RETURN jsonb_build_object(
                'ok', false,
                'success', false,
                'session_id', p_session_id,
                'rpc', 'video_session_mark_ready_v2',
                'error', 'mark_ready_unavailable',
                'reason', 'mark_ready_unavailable',
                'code', 'MARK_READY_UNAVAILABLE',
                'error_code', 'MARK_READY_UNAVAILABLE',
                'retryable', true,
                'terminal', false,
                'commandStatus', 'rejected',
                'hot_path_no_throw_shell', true,
                'active_entry_failsoft_shell', true,
                'last_resort_payload', true,
                'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
                'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
              );
          END;
      END;
  END;
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'session_id', p_session_id,
      'rpc', 'video_session_mark_ready_v2',
      'error', 'mark_ready_unavailable',
      'reason', 'mark_ready_unavailable',
      'code', 'MARK_READY_UNAVAILABLE',
      'error_code', 'MARK_READY_UNAVAILABLE',
      'retryable', true,
      'terminal', false,
      'commandStatus', 'rejected',
      'hot_path_no_throw_shell', true,
      'active_entry_failsoft_shell', true,
      'last_resort_payload', true,
      'outer_last_resort_payload', true,
      'server_now_ms', floor(extract(epoch from clock_timestamp()) * 1000)::bigint,
      'serverNowMs', floor(extract(epoch from clock_timestamp()) * 1000)::bigint
    );
END;
$function$
