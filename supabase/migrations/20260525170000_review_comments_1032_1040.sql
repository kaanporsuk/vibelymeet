-- Follow-up for PR #1032-#1040 review comments.
-- Keep Ready Gate missing-room recovery grace from extending itself by
-- avoiding state_updated_at writes in the early-grace skip path.

CREATE OR REPLACE FUNCTION public.recover_ready_gate_missing_rooms_v1(
  p_limit integer DEFAULT 100,
  p_grace_seconds integer DEFAULT 20,
  p_terminal_after_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_t0 timestamptz := clock_timestamp();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_grace interval := make_interval(secs => GREATEST(5, LEAST(COALESCE(p_grace_seconds, 20), 300)));
  v_terminal_after interval := make_interval(secs => GREATEST(30, LEAST(COALESCE(p_terminal_after_seconds, 120), 1800)));
  v_enqueued integer := 0;
  v_waiting integer := 0;
  v_recovered integer := 0;
  v_terminalized integer := 0;
  v_skipped integer := 0;
  v_registration_rows integer := 0;
  v_rows integer := 0;
  v_ms integer;
  v_outbox jsonb;
  v_latest_outbox record;
  v_outbox_lock_key bigint;
  v_base_dedupe_key text;
  v_recovery_dedupe_key text;
  v_has_outbox boolean;
  v_latest_is_recovery boolean;
  r record;
BEGIN
  FOR r IN
    SELECT
      vs.id,
      vs.event_id,
      vs.participant_1_id,
      vs.participant_2_id,
      vs.started_at,
      vs.state_updated_at,
      vs.ready_participant_1_at,
      vs.ready_participant_2_at,
      vs.ready_gate_expires_at,
      vs.prepare_entry_expires_at,
      GREATEST(
        COALESCE(vs.ready_participant_1_at, vs.started_at, vs.state_updated_at, v_now),
        COALESCE(vs.ready_participant_2_at, vs.started_at, vs.state_updated_at, v_now),
        COALESCE(vs.state_updated_at, vs.started_at, v_now)
      ) AS both_ready_at
    FROM public.video_sessions vs
    WHERE vs.ended_at IS NULL
      AND vs.ready_gate_status = 'both_ready'
      AND vs.state = 'ready_gate'::public.video_date_state
      AND vs.date_started_at IS NULL
      AND vs.handshake_started_at IS NULL
      AND vs.participant_1_joined_at IS NULL
      AND vs.participant_2_joined_at IS NULL
      AND (
        NULLIF(vs.daily_room_name, '') IS NULL
        OR NULLIF(vs.daily_room_url, '') IS NULL
        OR (
          NULLIF(vs.daily_room_name, '') IS NOT NULL
          AND NULLIF(vs.daily_room_url, '') IS NOT NULL
          AND vs.daily_room_url NOT LIKE ('%/' || vs.daily_room_name)
        )
      )
    ORDER BY
      COALESCE(vs.ready_gate_expires_at, vs.prepare_entry_expires_at, vs.started_at, v_now),
      vs.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    v_base_dedupe_key := 'phase3:ensure_room:' || r.id::text;
    v_recovery_dedupe_key := 'phase3:ensure_room_recovery:' || r.id::text;

    SELECT o.*
    INTO v_latest_outbox
    FROM public.video_date_provider_outbox o
    WHERE o.session_id = r.id
      AND o.kind = 'daily.ensure_video_date_room'
      AND o.dedupe_key IN (v_base_dedupe_key, v_recovery_dedupe_key)
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT 1;

    v_has_outbox := FOUND;
    IF v_has_outbox THEN
      v_latest_is_recovery := v_latest_outbox.dedupe_key = v_recovery_dedupe_key;
    ELSE
      v_latest_is_recovery := false;
    END IF;

    IF r.both_ready_at + v_grace > v_now THEN
      UPDATE public.video_sessions
      SET
        ready_gate_expires_at = GREATEST(COALESCE(ready_gate_expires_at, v_now), r.both_ready_at + v_grace),
        prepare_entry_expires_at = GREATEST(COALESCE(prepare_entry_expires_at, v_now), r.both_ready_at + v_grace)
      WHERE id = r.id
        AND ended_at IS NULL
        AND ready_gate_status = 'both_ready'
        AND state = 'ready_gate'::public.video_date_state
        AND date_started_at IS NULL
        AND handshake_started_at IS NULL
        AND participant_1_joined_at IS NULL
        AND participant_2_joined_at IS NULL
        AND (
          NULLIF(daily_room_name, '') IS NULL
          OR NULLIF(daily_room_url, '') IS NULL
          OR (
            NULLIF(daily_room_name, '') IS NOT NULL
            AND NULLIF(daily_room_url, '') IS NOT NULL
            AND daily_room_url NOT LIKE ('%/' || daily_room_name)
          )
        );
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_has_outbox AND v_latest_outbox.state = 'done' THEN
      SELECT count(*)::integer
      INTO v_rows
      FROM public.video_sessions vs
      WHERE vs.id = r.id
        AND vs.ended_at IS NULL
        AND NULLIF(vs.daily_room_name, '') IS NOT NULL
        AND NULLIF(vs.daily_room_url, '') IS NOT NULL
        AND vs.daily_room_url LIKE ('%/' || vs.daily_room_name);

      IF v_rows > 0 THEN
        v_recovered := v_recovered + 1;
        PERFORM public.record_event_loop_observability(
          'ready_gate_missing_room_recovery',
          'success',
          'provider_room_recovered',
          NULL,
          r.event_id,
          NULL,
          r.id,
          jsonb_build_object('outbox_id', v_latest_outbox.id)
        );
        CONTINUE;
      END IF;
    END IF;

    IF v_has_outbox
       AND v_latest_is_recovery
       AND v_latest_outbox.state IN ('failed', 'done')
       AND COALESCE(v_latest_outbox.attempts, 0) > 0
       AND COALESCE(v_latest_outbox.updated_at, v_latest_outbox.created_at) + v_terminal_after <= v_now THEN
      UPDATE public.video_sessions
      SET
        ready_gate_status = 'expired',
        state = 'ended'::public.video_date_state,
        phase = 'ended',
        ended_at = v_now,
        ended_reason = 'ready_gate_room_recovery_failed',
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
        AND ready_gate_status = 'both_ready'
        AND state = 'ready_gate'::public.video_date_state
        AND date_started_at IS NULL
        AND handshake_started_at IS NULL
        AND participant_1_joined_at IS NULL
        AND participant_2_joined_at IS NULL
        AND (
          NULLIF(daily_room_name, '') IS NULL
          OR NULLIF(daily_room_url, '') IS NULL
          OR (
            NULLIF(daily_room_name, '') IS NOT NULL
            AND NULLIF(daily_room_url, '') IS NOT NULL
            AND daily_room_url NOT LIKE ('%/' || daily_room_name)
          )
        );

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows > 0 THEN
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
        v_terminalized := v_terminalized + 1;

        PERFORM public.record_event_loop_observability(
          'ready_gate_missing_room_recovery',
          'terminalized',
          'ready_gate_room_recovery_failed',
          NULL,
          r.event_id,
          NULL,
          r.id,
          jsonb_build_object(
            'outbox_id', v_latest_outbox.id,
            'outbox_state', v_latest_outbox.state,
            'outbox_attempts', v_latest_outbox.attempts,
            'outbox_created_at', v_latest_outbox.created_at,
            'registration_rows', v_registration_rows
          )
        );
      END IF;

      CONTINUE;
    END IF;

    IF v_has_outbox AND v_latest_is_recovery AND v_latest_outbox.state = 'failed' THEN
      UPDATE public.video_sessions
      SET
        ready_gate_expires_at = GREATEST(COALESCE(ready_gate_expires_at, v_now), v_now + v_grace),
        prepare_entry_expires_at = GREATEST(COALESCE(prepare_entry_expires_at, v_now), v_now + v_grace),
        state_updated_at = v_now
      WHERE id = r.id
        AND ended_at IS NULL;

      v_waiting := v_waiting + 1;

      PERFORM public.record_event_loop_observability(
        'ready_gate_missing_room_recovery',
        'no_op',
        'provider_room_recovery_failed_waiting_terminal_deadline',
        NULL,
        r.event_id,
        NULL,
        r.id,
        jsonb_build_object(
          'outbox_id', v_latest_outbox.id,
          'outbox_state', v_latest_outbox.state,
          'outbox_attempts', v_latest_outbox.attempts,
          'outbox_updated_at', v_latest_outbox.updated_at
        )
      );

      CONTINUE;
    END IF;

    IF v_has_outbox AND v_latest_is_recovery AND v_latest_outbox.state = 'done' THEN
      UPDATE public.video_sessions
      SET
        ready_gate_expires_at = GREATEST(COALESCE(ready_gate_expires_at, v_now), v_now + v_grace),
        prepare_entry_expires_at = GREATEST(COALESCE(prepare_entry_expires_at, v_now), v_now + v_grace),
        state_updated_at = v_now
      WHERE id = r.id
        AND ended_at IS NULL;

      v_waiting := v_waiting + 1;

      PERFORM public.record_event_loop_observability(
        'ready_gate_missing_room_recovery',
        'no_op',
        'provider_room_recovery_done_waiting_room_metadata',
        NULL,
        r.event_id,
        NULL,
        r.id,
        jsonb_build_object(
          'outbox_id', v_latest_outbox.id,
          'outbox_state', v_latest_outbox.state,
          'outbox_attempts', v_latest_outbox.attempts,
          'outbox_updated_at', v_latest_outbox.updated_at
        )
      );

      CONTINUE;
    END IF;

    IF v_has_outbox AND v_latest_outbox.state IN ('pending', 'claimed') THEN
      UPDATE public.video_sessions
      SET
        ready_gate_expires_at = GREATEST(COALESCE(ready_gate_expires_at, v_now), v_now + v_grace),
        prepare_entry_expires_at = GREATEST(COALESCE(prepare_entry_expires_at, v_now), v_now + v_grace),
        state_updated_at = v_now
      WHERE id = r.id
        AND ended_at IS NULL;

      v_waiting := v_waiting + 1;

      PERFORM public.record_event_loop_observability(
        'ready_gate_missing_room_recovery',
        'no_op',
        'provider_room_recovery_in_progress',
        NULL,
        r.event_id,
        NULL,
        r.id,
        jsonb_build_object(
          'outbox_id', v_latest_outbox.id,
          'outbox_state', v_latest_outbox.state,
          'outbox_attempts', v_latest_outbox.attempts
        )
      );

      CONTINUE;
    END IF;

    v_outbox_lock_key := hashtextextended(
      'video_date_outbox_v2:' ||
      r.id::text || ':daily.ensure_video_date_room:' || v_recovery_dedupe_key,
      0
    );

    IF NOT pg_try_advisory_xact_lock(v_outbox_lock_key) THEN
      v_waiting := v_waiting + 1;

      PERFORM public.record_event_loop_observability(
        'ready_gate_missing_room_recovery',
        'no_op',
        'provider_room_recovery_lock_busy',
        NULL,
        r.event_id,
        NULL,
        r.id,
        jsonb_build_object('lock_scope', 'ensure_room_outbox_dedupe')
      );

      CONTINUE;
    END IF;

    v_outbox := public.video_date_outbox_enqueue_v2(
      r.id,
      'daily.ensure_video_date_room',
      jsonb_build_object(
        'source', 'ready_gate_missing_room_recovery',
        'previous_outbox_id', CASE WHEN v_has_outbox THEN v_latest_outbox.id ELSE NULL END,
        'previous_outbox_state', CASE WHEN v_has_outbox THEN v_latest_outbox.state ELSE NULL END
      ),
      v_recovery_dedupe_key,
      v_now
    );

    IF COALESCE((v_outbox->>'ok')::boolean, false) THEN
      UPDATE public.video_sessions
      SET
        ready_gate_expires_at = GREATEST(COALESCE(ready_gate_expires_at, v_now), v_now + v_grace),
        prepare_entry_expires_at = GREATEST(COALESCE(prepare_entry_expires_at, v_now), v_now + v_grace),
        state_updated_at = v_now
      WHERE id = r.id
        AND ended_at IS NULL;

      v_enqueued := v_enqueued + 1;

      PERFORM public.record_event_loop_observability(
        'ready_gate_missing_room_recovery',
        'success',
        'provider_room_recovery_enqueued',
        NULL,
        r.event_id,
        NULL,
        r.id,
        jsonb_build_object(
          'outbox_id', v_outbox->>'outboxId',
          'deduped', COALESCE((v_outbox->>'deduped')::boolean, false)
        )
      );
    ELSE
      v_waiting := v_waiting + 1;
      PERFORM public.record_event_loop_observability(
        'ready_gate_missing_room_recovery',
        'error',
        'provider_room_recovery_enqueue_failed',
        NULL,
        r.event_id,
        NULL,
        r.id,
        jsonb_build_object('error', COALESCE(v_outbox->>'error', 'unknown'))
      );
    END IF;
  END LOOP;

  v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
  PERFORM public.record_event_loop_observability(
    'ready_gate_missing_room_recovery',
    CASE WHEN v_enqueued + v_recovered + v_terminalized > 0 THEN 'success' ELSE 'no_op' END,
    NULL,
    v_ms,
    NULL,
    NULL,
    NULL,
    jsonb_build_object(
      'limit', v_limit,
      'grace_seconds', EXTRACT(EPOCH FROM v_grace)::integer,
      'terminal_after_seconds', EXTRACT(EPOCH FROM v_terminal_after)::integer,
      'enqueued', v_enqueued,
      'waiting', v_waiting,
      'recovered', v_recovered,
      'terminalized', v_terminalized,
      'skipped', v_skipped
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'enqueued', v_enqueued,
    'waiting', v_waiting,
    'recovered', v_recovered,
    'terminalized', v_terminalized,
    'skipped', v_skipped
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.recover_ready_gate_missing_rooms_v1(integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_ready_gate_missing_rooms_v1(integer, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.recover_ready_gate_missing_rooms_v1(integer, integer, integer) IS
  'Grant-restricted bounded recovery for both-ready Ready Gate sessions missing or carrying invalid Daily room metadata. Enqueues ensure-room before terminalizing exhausted recovery attempts without extending early grace through state_updated_at.';
