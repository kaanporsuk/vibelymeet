-- Ready Gate transition expiry/rowcount hardening.
--
-- The previous public ready_gate_transition implementation was layered through
-- observability and both-ready grace wrappers. This migration keeps the public
-- signature stable, preserves observability/grants, and makes the canonical
-- public RPC own the row lock, expiry re-check, and guarded-update rowcount
-- truth for mark_ready/snooze/forfeit.

DROP FUNCTION IF EXISTS public.ready_gate_transition_20260501190000_expiry_rowcount_prior(uuid, text, text);

ALTER FUNCTION public.ready_gate_transition(uuid, text, text)
  RENAME TO ready_gate_transition_20260501190000_expiry_rowcount_prior;

REVOKE ALL ON FUNCTION public.ready_gate_transition_20260501190000_expiry_rowcount_prior(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ready_gate_transition(
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
  v_before public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_session public.video_sessions%ROWTYPE;
  v_result jsonb;
  v_success boolean := false;
  v_status_after text;
  v_outcome text;
  v_reason_code text;
  v_is_p1 boolean := false;
  v_now timestamptz := now();
  v_new_status text;
  v_expires_at timestamptz;
  v_row_count integer := 0;
BEGIN
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
        -- Expiry is re-checked under the locked row for transition-sensitive
        -- actions. This closes the race where cleanup ran just before the gate
        -- elapsed, but the user action reached the RPC immediately afterward.
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
        ELSIF p_action = 'mark_ready' THEN
          IF v_is_p1 AND v_session.ready_participant_1_at IS NULL THEN
            v_session.ready_participant_1_at := v_now;
          ELSIF NOT v_is_p1 AND v_session.ready_participant_2_at IS NULL THEN
            v_session.ready_participant_2_at := v_now;
          END IF;

          IF v_session.ready_participant_1_at IS NOT NULL
             AND v_session.ready_participant_2_at IS NOT NULL THEN
            v_new_status := 'both_ready';
            v_expires_at := GREATEST(
              COALESCE(v_session.ready_gate_expires_at, v_now),
              v_now + interval '45 seconds'
            );
          ELSIF v_is_p1 THEN
            v_new_status := 'ready_a';
            v_expires_at := COALESCE(v_session.ready_gate_expires_at, v_now + interval '30 seconds');
          ELSE
            v_new_status := 'ready_b';
            v_expires_at := COALESCE(v_session.ready_gate_expires_at, v_now + interval '30 seconds');
          END IF;

          UPDATE public.video_sessions
          SET
            ready_participant_1_at = v_session.ready_participant_1_at,
            ready_participant_2_at = v_session.ready_participant_2_at,
            ready_gate_status = v_new_status,
            ready_gate_expires_at = v_expires_at,
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
            IF v_new_status = 'both_ready' THEN
              PERFORM public.record_event_loop_observability(
                'ready_gate_transition',
                'success',
                'both_ready_provider_prepare_grace_extended',
                NULL,
                v_session.event_id,
                v_actor,
                p_session_id,
                jsonb_build_object(
                  'action', p_action,
                  'p_reason', p_reason,
                  'ready_gate_expires_at', v_session.ready_gate_expires_at,
                  'provider_prepare_grace_seconds', 45
                )
              );
            END IF;

            v_result := jsonb_build_object(
              'success', true,
              'status', v_new_status,
              'ready_gate_status', v_new_status,
              'ready_gate_expires_at', v_session.ready_gate_expires_at,
              'terminal', v_new_status = 'both_ready'
            );
          END IF;
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
            queued_expires_at = NULL,
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
    WHEN p_action = 'mark_ready' AND v_status_after = 'both_ready' THEN 'both_ready'
    WHEN p_action = 'mark_ready' THEN 'mark_ready'
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

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.ready_gate_transition(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ready_gate_transition(uuid, text, text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.ready_gate_transition(uuid, text, text) IS
  'Canonical Ready Gate transition RPC. Owns row-locked ready/snooze/forfeit transitions, rejects elapsed gates under lock, checks guarded-update row counts, preserves observability, and keeps the public signature stable.';
