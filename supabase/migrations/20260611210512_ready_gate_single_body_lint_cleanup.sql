-- Lint cleanup for rebuild PR 4 (same branch, forward correction): the
-- single-body ready_gate_transition declared v_new_status / v_expires_at,
-- leftovers of the legacy in-chain mark_ready machine that PR 4 intentionally
-- did not carry over. Recreate the identical body without the two unused
-- declarations. No signature, grant, or behavior change.

CREATE OR REPLACE FUNCTION public.ready_gate_transition(
  p_session_id uuid,
  p_action text,
  p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
-- ready_gate_transition.single_body_core (rebuild PR 4). mark_ready bridges to
-- video_session_mark_ready_v2; the inner machine owns sync/snooze/forfeit.
DECLARE
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_actor uuid := auth.uid();
  v_now timestamptz := now();
  v_session public.video_sessions%ROWTYPE;
  v_before public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_restored public.video_sessions%ROWTYPE;
  v_snapshot jsonb;
  v_result jsonb;
  v_cleanup jsonb;
  v_status text;
  v_terminal boolean := false;
  v_inactive_reason text;
  v_date_capable boolean := false;
  v_core_decided boolean := false;
  v_is_p1 boolean := false;
  v_success boolean := false;
  v_status_after text;
  v_outcome text;
  v_reason_code text;
  v_expected_room_name text := 'date-' || replace(COALESCE(p_session_id::text, ''), '-', '');
  v_domain text;
  v_url text;
  v_p1_ready_gate boolean := false;
  v_p2_ready_gate boolean := false;
  v_missing_participant_registration text := NULL;
  v_repair_count integer := 0;
  v_row_count integer := 0;
  v_server_now_ms bigint;
  v_message text;
  v_detail text;
  v_hint text;
BEGIN
  -- ── mark_ready bridge: every spelling routes to the idempotent v2 command;
  -- the machine below never sees mark_ready. ──
  IF v_action = 'mark_ready' THEN
    RETURN public.video_session_mark_ready_v2(
      p_session_id,
      p_session_id::text || ':phase3:mark_ready:legacy_ready_gate_transition',
      NULL
    ) || jsonb_build_object('legacy_ready_gate_transition_bridge', true);
  END IF;

  -- ── sync fast path A: startup-snapshot-backed, live participant-owned
  -- gates only; both_ready is expiry-exempt. ──
  IF v_action = 'sync' AND v_actor IS NOT NULL THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND
       AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id)
       AND v_session.ended_at IS NULL
       AND v_session.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
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

  -- ── Inner machine. Statement timeouts / lock contention inside it produce
  -- the pinned retryable READY_GATE_TRANSITION_TIMEOUT payload. ──
  BEGIN
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

    -- ── sync fast path B: queued-inclusive direct-row snapshot when the
    -- event is still active (former start_snapshot base). ──
    IF p_action = 'sync' AND v_actor IS NOT NULL THEN
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
        v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);

        IF v_inactive_reason IS NULL THEN
          RETURN jsonb_build_object(
            'ok', true,
            'success', true,
            'status', v_session.ready_gate_status,
            'ready_gate_status', v_session.ready_gate_status,
            'result_status', v_session.ready_gate_status,
            'result_ready_gate_status', v_session.ready_gate_status,
            'state', v_session.state,
            'phase', v_session.phase,
            'event_id', v_session.event_id,
            'participant_1_id', v_session.participant_1_id,
            'participant_2_id', v_session.participant_2_id,
            'ready_participant_1_at', v_session.ready_participant_1_at,
            'ready_participant_2_at', v_session.ready_participant_2_at,
            'ready_gate_expires_at', v_session.ready_gate_expires_at,
            'snoozed_by', v_session.snoozed_by,
            'snooze_expires_at', v_session.snooze_expires_at,
            'daily_room_name', v_session.daily_room_name,
            'daily_room_url', v_session.daily_room_url,
            'session_seq', v_session.session_seq,
            'terminal', false,
            'snapshot', true,
            'server_now_ms', v_server_now_ms,
            'serverNowMs', v_server_now_ms
          );
        END IF;
      END IF;

      v_inactive_reason := NULL;
    END IF;

    -- ── Pre-ready room-metadata repair (former rgt_preserve_warmup pre-pass):
    -- a pre-both_ready gate must not carry Daily room metadata into a
    -- transition-sensitive action. ──
    IF v_actor IS NOT NULL AND p_action IN ('mark_ready', 'snooze') THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;

      IF FOUND
         AND (v_session.participant_1_id = v_actor OR v_session.participant_2_id = v_actor)
         AND v_session.ended_at IS NULL
         AND v_session.state = 'ready_gate'::public.video_date_state
         AND v_session.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed')
         AND v_session.handshake_started_at IS NULL
         AND v_session.date_started_at IS NULL
         AND v_session.participant_1_joined_at IS NULL
         AND v_session.participant_2_joined_at IS NULL
         AND (
           v_session.daily_room_name IS NOT NULL
           OR v_session.daily_room_url IS NOT NULL
           OR v_session.daily_room_verified_at IS NOT NULL
           OR v_session.daily_room_expires_at IS NOT NULL
           OR v_session.daily_room_provider_verify_reason IS NOT NULL
         ) THEN
        UPDATE public.video_sessions
        SET
          daily_room_name = NULL,
          daily_room_url = NULL,
          daily_room_verified_at = NULL,
          daily_room_expires_at = NULL,
          daily_room_provider_verify_reason = NULL,
          state_updated_at = now()
        WHERE id = p_session_id
          AND ended_at IS NULL
          AND state = 'ready_gate'::public.video_date_state
          AND ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed')
          AND handshake_started_at IS NULL
          AND date_started_at IS NULL
          AND participant_1_joined_at IS NULL
          AND participant_2_joined_at IS NULL
          AND (
            daily_room_name IS NOT NULL
            OR daily_room_url IS NOT NULL
            OR daily_room_verified_at IS NOT NULL
            OR daily_room_expires_at IS NOT NULL
            OR daily_room_provider_verify_reason IS NOT NULL
          )
        RETURNING * INTO v_session;

        GET DIAGNOSTICS v_repair_count = ROW_COUNT;

        IF v_repair_count > 0 THEN
          PERFORM public.record_event_loop_observability(
            'ready_gate_transition',
            'success',
            'pre_ready_room_metadata_repaired',
            NULL,
            v_session.event_id,
            v_actor,
            p_session_id,
            jsonb_build_object(
              'action', p_action,
              'p_reason', p_reason,
              'repaired_daily_room_metadata', true
            )
          );
        END IF;
      END IF;
    END IF;

    -- ── Event-inactive ownership under the locked session row (former
    -- rgt_pre_ready_room_meta). Natural live-window expiry has no event-row
    -- trigger, so participant sync/snooze actions detect it here. ──
    IF p_action IN ('sync', 'mark_ready', 'snooze') AND v_actor IS NOT NULL THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;

      IF FOUND
         AND NOT (
           v_session.participant_1_id IS DISTINCT FROM v_actor
           AND v_session.participant_2_id IS DISTINCT FROM v_actor
         ) THEN
        v_inactive_reason := public.get_event_lobby_inactive_reason(v_session.event_id);

        IF v_inactive_reason IS NOT NULL THEN
          v_cleanup := public.terminalize_event_ready_gates(v_session.event_id, v_inactive_reason);

          SELECT *
          INTO v_session
          FROM public.video_sessions
          WHERE id = p_session_id;

          v_date_capable := (
            v_session.handshake_started_at IS NOT NULL
            OR v_session.date_started_at IS NOT NULL
            OR v_session.daily_room_name IS NOT NULL
            OR v_session.daily_room_url IS NOT NULL
            OR v_session.participant_1_joined_at IS NOT NULL
            OR v_session.participant_2_joined_at IS NOT NULL
            OR v_session.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
            OR COALESCE(v_session.phase, '') IN ('handshake', 'date')
          );

          IF v_session.ended_at IS NOT NULL OR v_session.ready_gate_status = 'expired' THEN
            v_result := jsonb_build_object(
              'success', true,
              'status', v_session.ready_gate_status,
              'ready_gate_status', v_session.ready_gate_status,
              'ready_gate_expires_at', v_session.ready_gate_expires_at,
              'reason', COALESCE(v_session.ended_reason, 'ready_gate_event_ended'),
              'inactive_reason', v_inactive_reason,
              'error_code', COALESCE(v_session.ended_reason, 'ready_gate_event_ended'),
              'terminal', true,
              'event_id', v_session.event_id
            );
          ELSIF p_action = 'sync' OR v_date_capable THEN
            v_result := jsonb_build_object(
              'success', true,
              'status', v_session.ready_gate_status,
              'ready_gate_status', v_session.ready_gate_status,
              'ready_participant_1_at', v_session.ready_participant_1_at,
              'ready_participant_2_at', v_session.ready_participant_2_at,
              'ready_gate_expires_at', v_session.ready_gate_expires_at,
              'snoozed_by', v_session.snoozed_by,
              'snooze_expires_at', v_session.snooze_expires_at,
              'reason', 'event_not_active',
              'inactive_reason', v_inactive_reason,
              'date_capable', v_date_capable,
              'terminal', false,
              'event_id', v_session.event_id,
              'cleanup', v_cleanup
            );
          ELSE
            PERFORM public.record_event_loop_observability(
              'ready_gate_transition',
              'blocked',
              'READY_GATE_EVENT_ENDED',
              NULL,
              v_session.event_id,
              v_actor,
              p_session_id,
              jsonb_build_object(
                'action', p_action,
                'p_reason', p_reason,
                'inactive_reason', v_inactive_reason,
                'cleanup', v_cleanup
              )
            );

            v_result := jsonb_build_object(
              'success', false,
              'error', 'event_not_active',
              'code', 'EVENT_NOT_ACTIVE',
              'error_code', 'EVENT_NOT_ACTIVE',
              'reason', 'event_not_active',
              'inactive_reason', v_inactive_reason,
              'status', v_session.ready_gate_status,
              'ready_gate_status', v_session.ready_gate_status,
              'ready_gate_expires_at', v_session.ready_gate_expires_at,
              'terminal', false,
              'event_id', v_session.event_id
            );
          END IF;

          v_core_decided := true;
        END IF;
      END IF;
    END IF;

    -- ── Core machine (former event_inactive base) for sync/snooze/forfeit/
    -- unknown actions when the event is active. ──
    IF NOT v_core_decided THEN
      SELECT *
      INTO v_before
      FROM public.video_sessions
      WHERE id = p_session_id;

      IF v_actor IS NULL THEN
        v_result := jsonb_build_object('success', false, 'error', 'unauthorized');
      ELSE
        PERFORM public.expire_stale_video_sessions();

        SELECT *
        INTO v_session
        FROM public.video_sessions
        WHERE id = p_session_id
        FOR UPDATE;

        IF NOT FOUND THEN
          v_result := jsonb_build_object('success', false, 'error', 'session_not_found');
        ELSE
          v_is_p1 := (v_session.participant_1_id = v_actor);
          IF NOT v_is_p1 AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
            v_result := jsonb_build_object('success', false, 'error', 'access_denied');
          ELSIF p_action = 'sync' THEN
            v_result := jsonb_build_object(
              'success', true,
              'status', v_session.ready_gate_status,
              'ready_gate_status', v_session.ready_gate_status,
              'ready_participant_1_at', v_session.ready_participant_1_at,
              'ready_participant_2_at', v_session.ready_participant_2_at,
              'ready_gate_expires_at', v_session.ready_gate_expires_at,
              'snoozed_by', v_session.snoozed_by,
              'snooze_expires_at', v_session.snooze_expires_at,
              'terminal', v_session.ended_at IS NOT NULL
                OR v_session.ready_gate_status IN ('forfeited', 'expired')
            );
          ELSE
            -- Expiry is re-checked under the locked row for transition-
            -- sensitive actions. This closes the race where cleanup ran just
            -- before the gate elapsed, but the user action reached the RPC
            -- immediately afterward. (mark_ready never reaches this machine;
            -- the literal guard is kept for the pinned contract shape.)
            IF p_action IN ('mark_ready', 'snooze')
               AND v_session.ended_at IS NULL
               AND v_session.state = 'ready_gate'::public.video_date_state
               AND v_session.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready')
               AND v_session.ready_gate_expires_at IS NOT NULL
               AND v_session.ready_gate_expires_at <= v_now THEN
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
                  GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
                ),
                state_updated_at = v_now
              WHERE id = p_session_id
                AND ended_at IS NULL
                AND state = 'ready_gate'::public.video_date_state
                AND ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready')
                AND ready_gate_expires_at IS NOT NULL
                AND ready_gate_expires_at <= v_now
                AND date_started_at IS NULL
                AND handshake_started_at IS NULL
                AND daily_room_name IS NULL
                AND daily_room_url IS NULL
                AND participant_1_joined_at IS NULL
                AND participant_2_joined_at IS NULL
              RETURNING * INTO v_session;

              GET DIAGNOSTICS v_row_count = ROW_COUNT;

              IF v_row_count > 0 THEN
                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_session.event_id
                  AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
                  AND current_room_id = v_session.id;

                v_result := jsonb_build_object(
                  'success', true,
                  'status', 'expired',
                  'ready_gate_status', 'expired',
                  'ready_gate_expires_at', v_session.ready_gate_expires_at,
                  'reason', 'ready_gate_expired',
                  'error_code', 'ready_gate_expired',
                  'terminal', true
                );
              ELSE
                SELECT *
                INTO v_session
                FROM public.video_sessions
                WHERE id = p_session_id;

                IF NOT FOUND THEN
                  v_result := jsonb_build_object('success', false, 'error', 'session_not_found');
                ELSIF v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready')
                      OR v_session.ended_at IS NOT NULL THEN
                  v_result := jsonb_build_object(
                    'success', true,
                    'status', v_session.ready_gate_status,
                    'ready_gate_status', v_session.ready_gate_status,
                    'ready_gate_expires_at', v_session.ready_gate_expires_at,
                    'reason', COALESCE(v_session.ended_reason, 'terminal_state'),
                    'terminal', true
                  );
                ELSE
                  v_result := jsonb_build_object(
                    'success', false,
                    'error', 'stale_transition',
                    'error_code', 'stale_transition',
                    'status', v_session.ready_gate_status,
                    'ready_gate_status', v_session.ready_gate_status,
                    'reason', 'guarded_update_zero_rows',
                    'terminal', false
                  );
                END IF;
              END IF;
            ELSIF v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready') THEN
              v_result := jsonb_build_object(
                'success', true,
                'status', v_session.ready_gate_status,
                'ready_gate_status', v_session.ready_gate_status,
                'ready_gate_expires_at', v_session.ready_gate_expires_at,
                'terminal', true
              );
            ELSIF p_action = 'snooze' THEN
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
                AND state = 'ready_gate'::public.video_date_state
                AND handshake_started_at IS NULL
                AND date_started_at IS NULL
                AND daily_room_name IS NULL
                AND daily_room_url IS NULL
                AND participant_1_joined_at IS NULL
                AND participant_2_joined_at IS NULL
              RETURNING * INTO v_session;

              GET DIAGNOSTICS v_row_count = ROW_COUNT;

              IF v_row_count = 0 THEN
                SELECT *
                INTO v_session
                FROM public.video_sessions
                WHERE id = p_session_id;

                IF NOT FOUND THEN
                  v_result := jsonb_build_object('success', false, 'error', 'session_not_found');
                ELSIF v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready')
                      OR v_session.ended_at IS NOT NULL THEN
                  v_result := jsonb_build_object(
                    'success', true,
                    'status', v_session.ready_gate_status,
                    'ready_gate_status', v_session.ready_gate_status,
                    'ready_gate_expires_at', v_session.ready_gate_expires_at,
                    'reason', COALESCE(v_session.ended_reason, 'terminal_state'),
                    'terminal', true
                  );
                ELSE
                  v_result := jsonb_build_object(
                    'success', false,
                    'error', 'conflict',
                    'error_code', 'guarded_update_zero_rows',
                    'status', v_session.ready_gate_status,
                    'ready_gate_status', v_session.ready_gate_status,
                    'reason', 'session_no_longer_ready_gate_mutable',
                    'terminal', false
                  );
                END IF;
              ELSE
                v_result := jsonb_build_object(
                  'success', true,
                  'status', 'snoozed',
                  'ready_gate_status', 'snoozed',
                  'ready_gate_expires_at', v_session.ready_gate_expires_at,
                  'snoozed_by', v_session.snoozed_by,
                  'snooze_expires_at', v_session.snooze_expires_at,
                  'terminal', false
                );
              END IF;
            ELSIF p_action = 'forfeit' THEN
              UPDATE public.video_sessions
              SET
                ready_gate_status = 'forfeited',
                ready_gate_expires_at = v_now,
                snoozed_by = NULL,
                snooze_expires_at = NULL,
                state = 'ended',
                phase = 'ended',
                ended_at = COALESCE(ended_at, v_now),
                ended_reason = COALESCE(p_reason, ended_reason, 'ready_gate_forfeit'),
                state_updated_at = v_now
              WHERE id = p_session_id
                AND ready_gate_status NOT IN ('forfeited', 'expired', 'both_ready')
              RETURNING * INTO v_session;

              GET DIAGNOSTICS v_row_count = ROW_COUNT;

              IF v_row_count = 0 THEN
                SELECT *
                INTO v_session
                FROM public.video_sessions
                WHERE id = p_session_id;

                IF NOT FOUND THEN
                  v_result := jsonb_build_object('success', false, 'error', 'session_not_found');
                ELSE
                  v_result := jsonb_build_object(
                    'success', true,
                    'status', v_session.ready_gate_status,
                    'ready_gate_status', v_session.ready_gate_status,
                    'ready_gate_expires_at', v_session.ready_gate_expires_at,
                    'reason', COALESCE(v_session.ended_reason, 'terminal_state'),
                    'terminal', v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready')
                      OR v_session.ended_at IS NOT NULL
                  );
                END IF;
              ELSE
                UPDATE public.event_registrations
                SET
                  queue_status = 'idle',
                  current_room_id = NULL,
                  current_partner_id = NULL,
                  last_active_at = v_now
                WHERE event_id = v_session.event_id
                  AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
                  AND current_room_id = v_session.id;

                v_result := jsonb_build_object(
                  'success', true,
                  'status', 'forfeited',
                  'ready_gate_status', 'forfeited',
                  'ready_gate_expires_at', v_session.ready_gate_expires_at,
                  'reason', COALESCE(p_reason, 'ready_gate_forfeit'),
                  'terminal', true
                );
              END IF;
            ELSE
              v_result := jsonb_build_object('success', false, 'error', 'unknown_action');
            END IF;
          END IF;
        END IF;
      END IF;

      -- ── Core observability: every machine call records a before/after
      -- comparison row. ──
      SELECT *
      INTO v_after
      FROM public.video_sessions
      WHERE id = p_session_id;

      v_success := COALESCE(v_result @> '{"success": true}'::jsonb, false);
      v_status_after := COALESCE(v_after.ready_gate_status, v_result->>'ready_gate_status', v_result->>'status');

      v_reason_code := CASE
        WHEN NOT v_success THEN COALESCE(v_result->>'error_code', v_result->>'error', v_result->>'code', 'unknown_error')
        WHEN p_action = 'sync' AND v_status_after = 'expired' THEN 'sync_expired'
        WHEN p_action = 'sync' THEN 'sync'
        WHEN p_action IN ('mark_ready', 'snooze') AND COALESCE(v_result->>'reason', '') = 'ready_gate_expired' THEN 'ready_gate_expired'
        WHEN p_action = 'snooze' THEN 'snooze'
        WHEN p_action = 'forfeit' THEN 'forfeit'
        ELSE COALESCE(p_action, 'unknown_action')
      END;

      v_outcome := CASE
        WHEN v_success THEN 'success'
        WHEN v_reason_code IN ('unauthorized', 'session_not_found', 'access_denied', 'unknown_action') THEN 'blocked'
        ELSE 'error'
      END;

      PERFORM public.record_event_loop_observability(
        'ready_gate_transition',
        v_outcome,
        v_reason_code,
        NULL,
        COALESCE(v_after.event_id, v_before.event_id),
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', p_action,
          'p_reason', p_reason,
          'success', v_success,
          'result_status', v_result->>'status',
          'result_error', v_result->>'error',
          'result_error_code', v_result->>'error_code',
          'result_reason', v_result->>'reason',
          'status_before', v_before.ready_gate_status,
          'status_after', v_status_after,
          'state_before', v_before.state::text,
          'state_after', v_after.state::text,
          'phase_before', v_before.phase,
          'phase_after', v_after.phase,
          'ready_gate_expires_at_before', v_before.ready_gate_expires_at,
          'ready_gate_expires_at_after', v_after.ready_gate_expires_at,
          'ready_participant_1_at_before', v_before.ready_participant_1_at,
          'ready_participant_1_at_after', v_after.ready_participant_1_at,
          'ready_participant_2_at_before', v_before.ready_participant_2_at,
          'ready_participant_2_at_after', v_after.ready_participant_2_at,
          'snoozed_by_before', v_before.snoozed_by,
          'snoozed_by_after', v_after.snoozed_by,
          'snooze_expires_at_before', v_before.snooze_expires_at,
          'snooze_expires_at_after', v_after.snooze_expires_at,
          'ended_reason_after', v_after.ended_reason,
          'row_count_checked', true,
          'observed_at', now()
        )
      );
    END IF;

    -- ── Canonical-truth enrichment (former rgt_preserve_warmup post-merge):
    -- participant-safe session truth rides on every machine result. ──
    IF v_actor IS NOT NULL THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;

      IF FOUND
         AND NOT (
           v_session.participant_1_id IS DISTINCT FROM v_actor
           AND v_session.participant_2_id IS DISTINCT FROM v_actor
         ) THEN
        v_status := COALESCE(v_result->>'ready_gate_status', v_result->>'status', v_session.ready_gate_status);
        v_terminal := CASE
          WHEN jsonb_typeof(v_result->'terminal') = 'boolean' THEN (v_result->>'terminal')::boolean
          ELSE v_session.ended_at IS NOT NULL
            OR v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready')
        END;

        v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
          'event_id', v_session.event_id,
          'participant_1_id', v_session.participant_1_id,
          'participant_2_id', v_session.participant_2_id,
          'ready_participant_1_at', v_session.ready_participant_1_at,
          'ready_participant_2_at', v_session.ready_participant_2_at,
          'status', v_status,
          'ready_gate_status', v_status,
          'ready_gate_expires_at', v_session.ready_gate_expires_at,
          'snoozed_by', v_session.snoozed_by,
          'snooze_expires_at', v_session.snooze_expires_at,
          'terminal', v_terminal
        );

        -- ── Canonical both_ready room metadata re-derivation (former
        -- registration_desync post): a successful both_ready result must
        -- never leave the deterministic date-<id> room fields NULL. ──
        v_status := COALESCE(v_result->>'ready_gate_status', v_result->>'status');

        IF COALESCE((v_result->>'success')::boolean, false)
           AND v_status = 'both_ready' THEN
          -- Resolve the canonical Daily domain: GUC (optional) -> most recent
          -- canonical host -> hard fallback. A domain is ALWAYS resolved.
          v_domain := nullif(btrim(current_setting('app.daily_domain', true)), '');

          IF v_domain IS NULL THEN
            SELECT substring(vs.daily_room_url from '^https?://([^/]+)/')
            INTO v_domain
            FROM public.video_sessions vs
            WHERE vs.daily_room_url LIKE 'http%://%/date-%'
            ORDER BY vs.state_updated_at DESC NULLS LAST
            LIMIT 1;
          END IF;

          -- Locked, non-secret production Daily domain (= DAILY_ROOM_DOMAIN_FALLBACK).
          v_domain := COALESCE(v_domain, 'vibelyapp.daily.co');
          v_url := 'https://' || v_domain || '/' || v_expected_room_name;

          UPDATE public.video_sessions
            SET
              daily_room_name = v_expected_room_name,
              daily_room_url = v_url,
              daily_room_provider_verify_reason = COALESCE(
                daily_room_provider_verify_reason,
                'ready_gate_both_ready_canonical_rederive'
              ),
              state_updated_at = now()
            WHERE id = p_session_id
              AND ended_at IS NULL
              AND state = 'ready_gate'::public.video_date_state
              AND ready_gate_status = 'both_ready'
              AND handshake_started_at IS NULL
              AND date_started_at IS NULL
              AND participant_1_joined_at IS NULL
              AND participant_2_joined_at IS NULL
              AND (daily_room_name IS NULL OR daily_room_url IS NULL)
            RETURNING * INTO v_restored;

          IF FOUND THEN
            PERFORM public.record_event_loop_observability(
              'ready_gate_transition',
              'success',
              'both_ready_canonical_room_metadata_rederived',
              NULL,
              v_restored.event_id,
              v_actor,
              p_session_id,
              jsonb_build_object(
                'action', p_action,
                'p_reason', p_reason,
                'daily_room_name', v_restored.daily_room_name,
                'daily_room_verified_at', v_restored.daily_room_verified_at,
                'daily_room_expires_at', v_restored.daily_room_expires_at,
                'rederived', true,
                'provider_verify_skip_eligible', false
              )
            );

            v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
              'daily_room_name', v_restored.daily_room_name,
              'daily_room_url', v_restored.daily_room_url,
              'daily_room_verified_at', v_restored.daily_room_verified_at,
              'daily_room_expires_at', v_restored.daily_room_expires_at,
              'daily_room_provider_verify_reason', v_restored.daily_room_provider_verify_reason
            );
          END IF;
        END IF;
      END IF;
    END IF;

    -- ── Registration-desync forfeit post-check (former result_status base):
    -- an open pre-provider gate whose registrations no longer point at it is
    -- forfeited instead of being echoed back as live. ──
    IF v_actor IS NOT NULL THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id
      FOR UPDATE;

      IF FOUND
         AND NOT (
           v_session.participant_1_id IS DISTINCT FROM v_actor
           AND v_session.participant_2_id IS DISTINCT FROM v_actor
         ) THEN
        v_status := COALESCE(v_result->>'ready_gate_status', v_result->>'status', v_session.ready_gate_status);
        v_terminal := CASE
          WHEN jsonb_typeof(v_result->'terminal') = 'boolean' THEN (v_result->>'terminal')::boolean
          ELSE false
        END;

        -- `both_ready` is a valid pre-provider handoff while its expiry is
        -- open. Other terminal statuses/reasons are owned by the machine.
        IF NOT (
             COALESCE(v_result->>'success', 'true') = 'false'
             OR v_status NOT IN ('ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready')
             OR (v_terminal AND v_status IS DISTINCT FROM 'both_ready')
             OR v_session.ended_at IS NOT NULL
             OR v_session.state IS DISTINCT FROM 'ready_gate'::public.video_date_state
             OR v_session.handshake_started_at IS NOT NULL
             OR v_session.date_started_at IS NOT NULL
             OR v_session.daily_room_name IS NOT NULL
             OR v_session.daily_room_url IS NOT NULL
             OR v_session.participant_1_joined_at IS NOT NULL
             OR v_session.participant_2_joined_at IS NOT NULL
             OR COALESCE(v_session.phase, 'ready_gate') IN ('handshake', 'date')
             OR v_session.ready_gate_expires_at IS NULL
             OR v_session.ready_gate_expires_at <= v_now
           ) THEN
          SELECT er.queue_status = 'in_ready_gate' AND er.current_room_id = p_session_id
          INTO v_p1_ready_gate
          FROM public.event_registrations er
          WHERE er.event_id = v_session.event_id
            AND er.profile_id = v_session.participant_1_id
          FOR UPDATE;

          v_p1_ready_gate := COALESCE(v_p1_ready_gate, false);

          SELECT er.queue_status = 'in_ready_gate' AND er.current_room_id = p_session_id
          INTO v_p2_ready_gate
          FROM public.event_registrations er
          WHERE er.event_id = v_session.event_id
            AND er.profile_id = v_session.participant_2_id
          FOR UPDATE;

          v_p2_ready_gate := COALESCE(v_p2_ready_gate, false);

          IF NOT (v_p1_ready_gate AND v_p2_ready_gate) THEN
            v_missing_participant_registration := CASE
              WHEN NOT v_p1_ready_gate AND NOT v_p2_ready_gate THEN 'both'
              WHEN NOT v_p1_ready_gate THEN 'participant_1'
              ELSE 'participant_2'
            END;

            UPDATE public.video_sessions
            SET
              ready_gate_status = 'forfeited',
              ready_gate_expires_at = v_now,
              snoozed_by = NULL,
              snooze_expires_at = NULL,
              state = 'ended'::public.video_date_state,
              phase = 'ended',
              ended_at = COALESCE(ended_at, v_now),
              ended_reason = COALESCE(ended_reason, 'ready_gate_registration_desync'),
              duration_seconds = COALESCE(
                duration_seconds,
                GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(started_at, v_now))))::int)
              ),
              state_updated_at = v_now
            WHERE id = p_session_id
              AND ended_at IS NULL
              AND state = 'ready_gate'::public.video_date_state
              AND ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready')
              AND handshake_started_at IS NULL
              AND date_started_at IS NULL
              AND daily_room_name IS NULL
              AND daily_room_url IS NULL
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
                  OR (queue_status = 'in_ready_gate' AND current_room_id IS NULL)
                );

              PERFORM public.record_event_loop_observability(
                'ready_gate_transition',
                'success',
                'ready_gate_registration_desync',
                NULL,
                v_after.event_id,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', p_action,
                  'p_reason', p_reason,
                  'status_before', v_status,
                  'missing_participant_registration', v_missing_participant_registration,
                  'registration_desync', true
                )
              );

              v_result := COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
                'success', true,
                'status', 'forfeited',
                'ready_gate_status', 'forfeited',
                'ready_gate_expires_at', v_after.ready_gate_expires_at,
                'reason', 'ready_gate_registration_desync',
                'error_code', 'ready_gate_registration_desync',
                'terminal', true,
                'registration_desync', true,
                'missing_participant_registration', v_missing_participant_registration,
                'event_id', v_after.event_id
              );
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;

    -- ── result_status echo + dual server clock keys (former clock/57014
    -- layers). ──
    IF jsonb_typeof(v_result) = 'object' THEN
      v_status := COALESCE(
        v_result->>'ready_gate_status',
        v_result->>'status',
        v_result->>'result_ready_gate_status',
        v_result->>'result_status'
      );

      IF NULLIF(v_status, '') IS NOT NULL THEN
        v_result := v_result || jsonb_build_object(
          'result_status', v_status,
          'result_ready_gate_status', v_status
        );
      END IF;
    END IF;

    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

    RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
  EXCEPTION
    WHEN query_canceled OR lock_not_available THEN
      GET STACKED DIAGNOSTICS
        v_message = MESSAGE_TEXT,
        v_detail = PG_EXCEPTION_DETAIL,
        v_hint = PG_EXCEPTION_HINT;

      BEGIN
        PERFORM public.video_date_lifecycle_observe_exception_v2(
          p_session_id,
          v_actor,
          'ready_gate_transition.machine_timeout',
          SQLSTATE,
          v_message,
          v_detail,
          v_hint
        );
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;

      v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'ready_gate_transition_timeout',
        'reason', 'ready_gate_transition_timeout',
        'code', 'READY_GATE_TRANSITION_TIMEOUT',
        'error_code', 'READY_GATE_TRANSITION_TIMEOUT',
        'retryable', true,
        'retry_after_seconds', 2,
        'retry_after_ms', 2000,
        'status', COALESCE(v_session.ready_gate_status, 'unknown'),
        'ready_gate_status', COALESCE(v_session.ready_gate_status, 'unknown'),
        'result_status', COALESCE(v_session.ready_gate_status, 'unknown'),
        'result_ready_gate_status', COALESCE(v_session.ready_gate_status, 'unknown'),
        'terminal', false,
        'single_body_rpc', true,
        'server_now_ms', v_server_now_ms,
        'serverNowMs', v_server_now_ms
      );
  END;
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;

    BEGIN
      PERFORM public.video_date_lifecycle_observe_exception_v2(
        p_session_id,
        v_actor,
        'ready_gate_transition',
        SQLSTATE,
        v_message,
        v_detail,
        v_hint
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;

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
      'retryable', true,
      'retry_after_seconds', 2,
      'retry_after_ms', 2000,
      'status', v_status,
      'ready_gate_status', v_status,
      'result_status', v_status,
      'result_ready_gate_status', v_status,
      'startup_snapshot', v_snapshot,
      'single_body_rpc', true,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;
