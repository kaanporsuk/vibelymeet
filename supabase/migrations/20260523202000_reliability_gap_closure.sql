-- Reliability gap closure for queue/deck contracts and Ready Gate missing-room recovery.

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
        prepare_entry_expires_at = GREATEST(COALESCE(prepare_entry_expires_at, v_now), r.both_ready_at + v_grace),
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
  'Grant-restricted bounded recovery for both-ready Ready Gate sessions missing or carrying invalid Daily room metadata. Enqueues ensure-room before terminalizing exhausted recovery attempts.';

DROP FUNCTION IF EXISTS public.expire_stale_vsessions_bounded_202605232020_base(integer);

ALTER FUNCTION public.expire_stale_video_sessions_bounded(integer)
  RENAME TO expire_stale_vsessions_bounded_202605232020_base;

REVOKE ALL ON FUNCTION public.expire_stale_vsessions_bounded_202605232020_base(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_vsessions_bounded_202605232020_base(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.expire_stale_video_sessions_bounded(
  p_limit integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
  v_recovery jsonb;
  v_base integer := 0;
BEGIN
  v_recovery := public.recover_ready_gate_missing_rooms_v1(v_limit, 20, 120);
  v_base := public.expire_stale_vsessions_bounded_202605232020_base(v_limit);

  RETURN COALESCE(v_base, 0)
    + COALESCE((v_recovery->>'terminalized')::integer, 0);
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_stale_video_sessions_bounded(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_video_sessions_bounded(integer)
  TO service_role;

COMMENT ON FUNCTION public.expire_stale_video_sessions_bounded(integer) IS
  'Bounded stale-session cleanup. Recovers both-ready Ready Gates missing provider room metadata before delegating to terminal stale cleanup.';

-- Additive authoritative overlays for earlier queue/deck migrations.
-- These CREATE OR REPLACE definitions make the gap-closure fixes land even when
-- earlier authoritative migrations have already been applied in an environment.

CREATE OR REPLACE FUNCTION public.get_event_deck_v3(
  p_event_id uuid,
  p_user_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_viewer uuid := auth.uid();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 50), 50));
  v_scan_limit integer := 5000;
  v_active record;
  v_profiles jsonb := '[]'::jsonb;
  v_raw_count integer := 0;
  v_profile_count integer := 0;
  v_marked_count integer := 0;
  v_reason text := 'unknown';
BEGIN
  IF v_viewer IS NULL OR v_viewer <> p_user_id THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_active
  FROM public.get_event_lobby_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'profiles', '[]'::jsonb,
      'deck_state', jsonb_build_object(
        'reason', 'event_not_active',
        'inactive_reason', COALESCE(v_active.reason, 'event_not_active'),
        'retryable', false,
        'limit', v_limit
      )
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_user_id
      AND COALESCE(er.admission_status, 'confirmed') = 'confirmed'
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'profiles', '[]'::jsonb,
      'deck_state', jsonb_build_object(
        'reason', 'not_registered',
        'retryable', false,
        'limit', v_limit
      )
    );
  END IF;

  IF public.is_profile_hidden(p_user_id) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'profiles', '[]'::jsonb,
      'deck_state', jsonb_build_object(
        'reason', 'viewer_paused',
        'retryable', false,
        'limit', v_limit
      )
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('video_date_deck_v3:' || p_event_id::text || ':' || p_user_id::text, 0)
  );

  WITH raw_deck AS (
    SELECT *
    FROM public.get_event_deck(p_event_id, p_user_id, v_scan_limit)
  ),
  raw_count AS (
    SELECT count(*)::integer AS n FROM raw_deck
  ),
  filtered AS (
    SELECT rd.*
    FROM raw_deck rd
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.event_profile_impressions epi
      WHERE epi.event_id = p_event_id
        AND epi.viewer_id = p_user_id
        AND epi.target_id = rd.profile_id
        AND public.video_date_impression_rank(epi.strongest_exclusion_reason) >= public.video_date_impression_rank('dealt')
    )
  ),
  ranked AS (
    SELECT filtered.*, row_number() OVER () AS rn
    FROM filtered
    LIMIT v_limit
  ),
  mark_buffer AS (
    SELECT public.record_event_profile_impression_v2(
      p_event_id,
      p_user_id,
      ranked.profile_id,
      'dealt',
      'get_event_deck_v3_buffer',
      NULL,
      jsonb_build_object(
        'server_dealt', true,
        'deck_rank', ranked.rn,
        'deck_version', 'v3'
      )
    ) AS result
    FROM ranked
  )
  SELECT
    COALESCE(jsonb_agg(to_jsonb(ranked) - 'rn' ORDER BY ranked.rn), '[]'::jsonb),
    COALESCE((SELECT n FROM raw_count), 0),
    count(ranked.profile_id)::integer,
    COALESCE((SELECT count(*)::integer FROM mark_buffer), 0)
  INTO v_profiles, v_raw_count, v_profile_count, v_marked_count
  FROM ranked;

  v_reason := CASE
    WHEN v_profile_count > 0 THEN 'has_profiles'
    ELSE 'no_remaining_profiles'
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'profiles', v_profiles,
    'deck_state', jsonb_build_object(
      'reason', v_reason,
      'retryable', false,
      'limit', v_limit,
      'scan_limit', v_scan_limit,
      'raw_count', v_raw_count,
      'profile_count', v_profile_count,
      'marked_count', v_marked_count
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer) IS
  'Event deck v3 RPC. Returns structured deck_state and marks every server-buffered returned profile as dealt for web and native deck consumers.';

CREATE OR REPLACE FUNCTION public.drain_match_queue_v2(
  p_event_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  v_ms integer;
  v_actor uuid := auth.uid();
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_active record;
  v_inactive_reason text;
  v_match public.video_sessions%ROWTYPE;
  v_existing_command public.video_session_commands%ROWTYPE;
  v_partner_id uuid;
  v_p_low uuid;
  v_p_high uuid;
  v_er_low public.event_registrations%ROWTYPE;
  v_er_high public.event_registrations%ROWTYPE;
  v_self public.event_registrations%ROWTYPE;
  v_partner public.event_registrations%ROWTYPE;
  v_self_runtime public.event_participant_runtime_state%ROWTYPE;
  v_partner_runtime public.event_participant_runtime_state%ROWTYPE;
  v_self_runtime_ok boolean := false;
  v_partner_runtime_ok boolean := false;
  v_begin jsonb;
  v_command_id bigint;
  v_request jsonb;
  v_result jsonb;
  v_event jsonb := '{}'::jsonb;
  v_fairness jsonb := '{}'::jsonb;
BEGIN
  IF v_actor IS NULL THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'error',
      'unauthorized',
      v_ms,
      p_event_id,
      NULL,
      NULL,
      '{}'::jsonb
    );
    RETURN jsonb_build_object('found', false, 'error', 'unauthorized', 'reason', 'unauthorized');
  END IF;

  IF v_key IS NULL OR length(v_key) < 8 OR length(v_key) > 160 THEN
    RETURN jsonb_build_object('found', false, 'success', false, 'error', 'invalid_idempotency_key', 'reason', 'invalid_idempotency_key');
  END IF;

  IF NOT pg_try_advisory_xact_lock(
    hashtextextended('video_session_command:' || v_actor::text || ':' || v_key, 0)
  ) THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'no_op',
      'lock_busy',
      v_ms,
      p_event_id,
      v_actor,
      NULL,
      jsonb_build_object(
        'lock_scope', 'command',
        'idempotency_key_length', length(v_key)
      )
    );
    RETURN jsonb_build_object(
      'found', false,
      'success', true,
      'reason', 'lock_busy',
      'status', 'lock_busy',
      'commandStatus', 'lock_busy'
    );
  END IF;

  SELECT *
  INTO v_existing_command
  FROM public.video_session_commands
  WHERE actor = v_actor
    AND idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_command.command_kind IS DISTINCT FROM 'drain_match_queue'
       OR v_existing_command.request_payload->>'event_id' IS DISTINCT FROM p_event_id::text THEN
      RETURN jsonb_build_object(
        'found', false,
        'success', false,
        'error', 'idempotency_conflict',
        'commandStatus', 'idempotency_conflict',
        'existingSessionId', v_existing_command.session_id,
        'existingCommandKind', v_existing_command.command_kind,
        'existingRequestHash', v_existing_command.request_hash
      );
    END IF;

    v_begin := public.video_session_command_begin_v2(
      v_existing_command.session_id,
      v_actor,
      'drain_match_queue',
      v_key,
      COALESCE(v_existing_command.request_payload, '{}'::jsonb),
      v_existing_command.request_hash
    );

    IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
      RETURN jsonb_build_object(
        'found', false,
        'success', false,
        'error', COALESCE(v_begin->>'error', 'command_begin_failed'),
        'commandStatus', v_begin->>'status',
        'requestHash', v_begin->>'requestHash'
      );
    END IF;

    IF v_begin->>'status' IN ('replay', 'replay_rejected') THEN
      RETURN COALESCE(v_begin->'result', '{}'::jsonb)
        || jsonb_build_object(
          'idempotent', true,
          'requestHash', v_begin->>'requestHash',
          'commandStatus', v_begin->>'status'
        );
    END IF;

    RETURN jsonb_build_object(
      'found', false,
      'success', false,
      'error', 'command_in_progress',
      'commandStatus', 'in_progress',
      'requestHash', v_begin->>'requestHash'
    );
  END IF;

  SELECT *
  INTO v_active
  FROM public.lock_event_lobby_scheduled_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    v_inactive_reason := COALESCE(v_active.reason, 'event_not_active');
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'blocked',
      'event_not_valid',
      v_ms,
      p_event_id,
      v_actor,
      NULL,
      jsonb_build_object('inactive_reason', v_inactive_reason)
    );
    RETURN jsonb_build_object(
      'found', false,
      'reason', 'event_not_valid',
      'inactive_reason', v_inactive_reason
    );
  END IF;

  SELECT vs.*
  INTO v_match
  FROM public.video_sessions vs
  JOIN public.v_video_date_queue_fairness_candidates fair
    ON fair.session_id = vs.id
   AND fair.actor_id = v_actor
  WHERE vs.event_id = p_event_id
    AND vs.ready_gate_status = 'queued'
    AND vs.ended_at IS NULL
    AND COALESCE(vs.queued_expires_at, COALESCE(vs.started_at, now()) + interval '10 minutes') > now()
    AND (vs.participant_1_id = v_actor OR vs.participant_2_id = v_actor)
  ORDER BY
    fair.candidate_score DESC,
    fair.both_hot_ready DESC,
    fair.queued_age_seconds DESC,
    fair.ttl_remaining_seconds ASC,
    vs.started_at ASC NULLS LAST,
    vs.id ASC
  LIMIT 1
  FOR UPDATE OF vs SKIP LOCKED;

  IF NOT FOUND THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'no_op',
      'no_queued_session',
      v_ms,
      p_event_id,
      v_actor,
      NULL,
      jsonb_build_object(
        'step', 'pick_queued_session',
        'queue_scoring_version', 'phase6_v1',
        'candidate_source', 'v_video_date_queue_fairness_candidates'
      )
    );
    RETURN jsonb_build_object('found', false, 'reason', 'no_queued_session');
  END IF;

  SELECT jsonb_build_object(
    'queue_scoring_version', 'phase6_v1',
    'candidate_score', fair.candidate_score,
    'queued_age_seconds', fair.queued_age_seconds,
    'ttl_remaining_seconds', fair.ttl_remaining_seconds,
    'both_hot_ready', fair.both_hot_ready,
    'actor_hot_ready', fair.actor_hot_ready,
    'partner_hot_ready', fair.partner_hot_ready,
    'actor_recent_no_match_attempts', fair.actor_recent_no_match_attempts,
    'actor_recent_reliability_penalty', fair.actor_recent_reliability_penalty,
    'partner_recent_reliability_penalty', fair.partner_recent_reliability_penalty
  )
  INTO v_fairness
  FROM public.v_video_date_queue_fairness_candidates fair
  WHERE fair.session_id = v_match.id
    AND fair.actor_id = v_actor;

  v_fairness := COALESCE(v_fairness, jsonb_build_object('queue_scoring_version', 'phase6_v1'));

  v_partner_id := CASE
    WHEN v_match.participant_1_id = v_actor THEN v_match.participant_2_id
    ELSE v_match.participant_1_id
  END;

  IF NOT pg_try_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        LEAST(v_actor, v_partner_id)::text,
      0
    )
  ) THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'no_op',
      'lock_busy',
      v_ms,
      p_event_id,
      v_actor,
      v_match.id,
      jsonb_build_object(
        'lock_scope', 'participant_session_low',
        'partner_id', v_partner_id,
        'fairness', v_fairness
      )
    );
    RETURN jsonb_build_object(
      'found', false,
      'success', true,
      'reason', 'lock_busy',
      'status', 'lock_busy',
      'queuedSessionId', v_match.id,
      'video_session_id', v_match.id
    );
  END IF;

  IF NOT pg_try_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        GREATEST(v_actor, v_partner_id)::text,
      0
    )
  ) THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'no_op',
      'lock_busy',
      v_ms,
      p_event_id,
      v_actor,
      v_match.id,
      jsonb_build_object(
        'lock_scope', 'participant_session_high',
        'partner_id', v_partner_id,
        'fairness', v_fairness
      )
    );
    RETURN jsonb_build_object(
      'found', false,
      'success', true,
      'reason', 'lock_busy',
      'status', 'lock_busy',
      'queuedSessionId', v_match.id,
      'video_session_id', v_match.id
    );
  END IF;

  v_request := jsonb_build_object(
    'event_id', p_event_id,
    'queued_session_id', v_match.id,
    'partner_id', v_partner_id
  );

  v_begin := public.video_session_command_begin_v2(
    v_match.id,
    v_actor,
    'drain_match_queue',
    v_key,
    v_request,
    NULL
  );

  IF NOT COALESCE((v_begin->>'ok')::boolean, false) THEN
    RETURN jsonb_build_object(
      'found', false,
      'success', false,
      'error', COALESCE(v_begin->>'error', 'command_begin_failed'),
      'commandStatus', v_begin->>'status',
      'requestHash', v_begin->>'requestHash'
    );
  END IF;

  IF v_begin->>'status' IN ('replay', 'replay_rejected') THEN
    RETURN COALESCE(v_begin->'result', '{}'::jsonb)
      || jsonb_build_object(
        'idempotent', true,
        'requestHash', v_begin->>'requestHash',
        'commandStatus', v_begin->>'status'
      );
  END IF;

  IF v_begin->>'status' = 'in_progress' THEN
    RETURN jsonb_build_object(
      'found', false,
      'success', false,
      'error', 'command_in_progress',
      'commandStatus', 'in_progress',
      'requestHash', v_begin->>'requestHash'
    );
  END IF;

  v_command_id := (v_begin->>'commandId')::bigint;

  IF public.video_date_pair_has_terminal_encounter(p_event_id, v_actor, v_partner_id, v_match.id) THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'pair_already_met_this_event'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR (
          queue_status IN ('queued', 'in_ready_gate', 'in_handshake', 'in_date')
          AND current_partner_id IN (v_actor, v_partner_id)
        )
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object(
      'found', false,
      'reason', 'pair_already_met_this_event',
      'session_id', v_match.id,
      'video_session_id', v_match.id
    );

    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);

    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'blocked',
      'pair_already_met_this_event',
      v_ms,
      p_event_id,
      v_actor,
      v_match.id,
      jsonb_build_object('partner_id', v_partner_id, 'terminal_encounter_pair', true, 'fairness', v_fairness)
    );

    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  v_p_low := LEAST(v_match.participant_1_id, v_match.participant_2_id);
  v_p_high := GREATEST(v_match.participant_1_id, v_match.participant_2_id);

  SELECT *
  INTO v_er_low
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_p_low
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'registration_missing'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ready_gate_status = CASE
        WHEN ready_gate_status = 'queued' THEN 'expired'
        ELSE ready_gate_status
      END,
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN queue_status = 'queued' THEN 'browsing' ELSE queue_status END,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR current_partner_id IN (v_actor, v_partner_id)
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object('found', false, 'reason', 'registration_missing');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  SELECT *
  INTO v_er_high
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_p_high
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'registration_missing'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ready_gate_status = CASE
        WHEN ready_gate_status = 'queued' THEN 'expired'
        ELSE ready_gate_status
      END,
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN queue_status = 'queued' THEN 'browsing' ELSE queue_status END,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR current_partner_id IN (v_actor, v_partner_id)
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object('found', false, 'reason', 'registration_missing');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  IF v_er_low.profile_id = v_actor THEN
    v_self := v_er_low;
    v_partner := v_er_high;
  ELSE
    v_self := v_er_high;
    v_partner := v_er_low;
  END IF;

  IF v_self.admission_status IS DISTINCT FROM 'confirmed'
     OR v_partner.admission_status IS DISTINCT FROM 'confirmed' THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'admission_not_confirmed'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ready_gate_status = CASE
        WHEN ready_gate_status = 'queued' THEN 'expired'
        ELSE ready_gate_status
      END,
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN queue_status = 'queued' THEN 'browsing' ELSE queue_status END,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR current_partner_id IN (v_actor, v_partner_id)
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object('found', false, 'reason', 'admission_not_confirmed');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  SELECT *
  INTO v_self_runtime
  FROM public.event_participant_runtime_state
  WHERE event_id = p_event_id
    AND participant_id = v_actor
  FOR UPDATE;

  v_self_runtime_ok := FOUND
    AND v_self_runtime.foreground IS TRUE
    AND v_self_runtime.last_heartbeat_at >= now() - interval '45 seconds'
    AND v_self_runtime.readiness_status IN ('ready', 'warning');

  SELECT *
  INTO v_partner_runtime
  FROM public.event_participant_runtime_state
  WHERE event_id = p_event_id
    AND participant_id = v_partner_id
  FOR UPDATE;

  v_partner_runtime_ok := FOUND
    AND v_partner_runtime.foreground IS TRUE
    AND v_partner_runtime.last_heartbeat_at >= now() - interval '45 seconds'
    AND v_partner_runtime.readiness_status IN ('ready', 'warning');

  IF NOT v_self_runtime_ok THEN
    UPDATE public.event_registrations
    SET
      last_lobby_foregrounded_at = now(),
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id = v_actor;

    v_result := jsonb_build_object('found', false, 'queued', true, 'reason', 'self_runtime_not_ready');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);

    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'blocked',
      'self_runtime_not_ready',
      v_ms,
      p_event_id,
      v_actor,
      v_match.id,
      jsonb_build_object(
        'foreground', COALESCE(v_self_runtime.foreground, false),
        'readiness_status', v_self_runtime.readiness_status,
        'heartbeat_age_seconds', EXTRACT(EPOCH FROM (now() - v_self_runtime.last_heartbeat_at))::int,
        'fairness', v_fairness
      )
    );

    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  IF NOT v_partner_runtime_ok THEN
    v_result := jsonb_build_object('found', false, 'queued', true, 'reason', 'partner_runtime_not_ready');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);

    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'blocked',
      'partner_runtime_not_ready',
      v_ms,
      p_event_id,
      v_actor,
      v_match.id,
      jsonb_build_object(
        'foreground', COALESCE(v_partner_runtime.foreground, false),
        'readiness_status', v_partner_runtime.readiness_status,
        'heartbeat_age_seconds', EXTRACT(EPOCH FROM (now() - v_partner_runtime.last_heartbeat_at))::int,
        'fairness', v_fairness
      )
    );

    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  IF public.is_blocked(v_actor, v_partner_id)
     OR EXISTS (
       SELECT 1
       FROM public.user_reports ur
       WHERE (ur.reporter_id = v_actor AND ur.reported_id = v_partner_id)
          OR (ur.reporter_id = v_partner_id AND ur.reported_id = v_actor)
     ) THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'blocked_or_reported_pair'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = 'browsing',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR (
          queue_status IN ('queued', 'in_ready_gate', 'in_handshake', 'in_date')
          AND current_partner_id IN (v_actor, v_partner_id)
        )
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object('found', false, 'reason', 'blocked_or_reported_pair');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);

    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue_v2',
      'blocked',
      'blocked_or_reported_pair',
      v_ms,
      p_event_id,
      v_actor,
      v_match.id,
      jsonb_build_object('partner_id', v_partner_id, 'fairness', v_fairness)
    );

    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  SELECT *
  INTO v_active
  FROM public.get_event_lobby_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    v_inactive_reason := COALESCE(v_active.reason, 'event_not_active');
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, v_inactive_reason),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ready_gate_status = CASE
        WHEN ready_gate_status = 'queued' THEN 'expired'
        ELSE ready_gate_status
      END,
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN queue_status = 'queued' THEN 'browsing' ELSE queue_status END,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR current_partner_id IN (v_actor, v_partner_id)
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object(
      'found', false,
      'reason', 'event_not_valid',
      'inactive_reason', v_inactive_reason
    );
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  IF v_match.ready_gate_status IS DISTINCT FROM 'queued'
     OR v_match.ended_at IS NOT NULL
     OR COALESCE(v_match.queued_expires_at, COALESCE(v_match.started_at, now()) + interval '10 minutes') <= now() THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'queued_session_not_promotable'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ready_gate_status = CASE
        WHEN ready_gate_status = 'queued' THEN 'expired'
        ELSE ready_gate_status
      END,
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN queue_status = 'queued' THEN 'browsing' ELSE queue_status END,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR current_partner_id IN (v_actor, v_partner_id)
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object('found', false, 'reason', 'session_not_promotable');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions z
    WHERE z.event_id = p_event_id
      AND z.id <> v_match.id
      AND (
        z.participant_1_id IN (v_actor, v_partner_id)
        OR z.participant_2_id IN (v_actor, v_partner_id)
      )
      AND public.event_lobby_video_session_blocks_new_match(
        z.ready_gate_status,
        z.state::text,
        z.phase,
        z.handshake_started_at,
        z.date_started_at,
        z.ended_at
      )
  ) THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'participant_has_active_session_conflict'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ready_gate_status = CASE
        WHEN ready_gate_status = 'queued' THEN 'expired'
        ELSE ready_gate_status
      END,
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN queue_status = 'queued' THEN 'browsing' ELSE queue_status END,
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_actor, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR current_partner_id IN (v_actor, v_partner_id)
        OR (
          queue_status = 'queued'
          AND current_room_id IS NULL
          AND current_partner_id IS NULL
        )
      );

    v_result := jsonb_build_object('found', false, 'reason', 'participant_has_active_session_conflict');
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result || jsonb_build_object('requestHash', v_begin->>'requestHash', 'commandStatus', 'rejected');
  END IF;

  UPDATE public.video_sessions
  SET
    ready_gate_status = 'ready',
    ready_gate_expires_at = now() + interval '30 seconds',
    queued_expires_at = NULL,
    state_updated_at = now()
  WHERE id = v_match.id;

  UPDATE public.event_registrations
  SET
    queue_status = 'in_ready_gate',
    current_room_id = v_match.id,
    current_partner_id = CASE
      WHEN profile_id = v_actor THEN v_partner_id
      ELSE v_actor
    END,
    last_active_at = now()
  WHERE event_id = p_event_id
    AND profile_id IN (v_actor, v_partner_id);

  PERFORM public.record_event_profile_impression_v2(
    p_event_id,
    v_actor,
    v_partner_id,
    'paired',
    'drain_match_queue_v2',
    v_match.id,
    jsonb_build_object('ready_gate_promoted', true)
  );

  INSERT INTO public.event_profile_impressions (
    event_id,
    viewer_id,
    target_id,
    last_action,
    strongest_exclusion_reason,
    source,
    session_id,
    metadata
  )
  VALUES (
    p_event_id,
    v_partner_id,
    v_actor,
    'paired',
    'paired',
    'drain_match_queue_v2',
    v_match.id,
    jsonb_build_object('ready_gate_promoted', true)
  )
  ON CONFLICT (event_id, viewer_id, target_id) DO UPDATE
  SET
    last_action = EXCLUDED.last_action,
    last_action_at = now(),
    strongest_exclusion_reason = CASE
      WHEN public.video_date_impression_rank(EXCLUDED.strongest_exclusion_reason)
           >= public.video_date_impression_rank(event_profile_impressions.strongest_exclusion_reason)
        THEN EXCLUDED.strongest_exclusion_reason
      ELSE event_profile_impressions.strongest_exclusion_reason
    END,
    source = EXCLUDED.source,
    session_id = COALESCE(EXCLUDED.session_id, event_profile_impressions.session_id),
    metadata = event_profile_impressions.metadata || EXCLUDED.metadata,
    updated_at = now();

  INSERT INTO public.event_profile_impression_events (
    event_id,
    viewer_id,
    target_id,
    action,
    source,
    session_id,
    metadata
  )
  VALUES (
    p_event_id,
    v_partner_id,
    v_actor,
    'paired',
    'drain_match_queue_v2',
    v_match.id,
    jsonb_build_object('ready_gate_promoted', true)
  );

  v_event := public.append_video_session_event_v2(
    v_match.id,
    'queue_promoted_to_ready_gate',
    'participants',
    v_actor,
    jsonb_build_object(
      'event_id', p_event_id,
      'partner_id', v_partner_id,
      'ready_gate_status', 'ready'
    ),
    jsonb_build_object(
      'event_id', p_event_id,
      'ready_gate_status', 'ready'
    ),
    true,
    gen_random_uuid()
  );

  PERFORM public.video_date_outbox_enqueue_v2(
    v_match.id,
    'notification.send',
    jsonb_build_object(
      'user_id', v_actor,
      'category', 'ready_gate',
      'data', jsonb_build_object(
        'session_id', v_match.id,
        'event_id', p_event_id,
        'source', 'drain_match_queue_v2'
      )
    ),
    'phase3:ready_gate_push:' || v_match.id::text || ':' || v_actor::text,
    now()
  );

  PERFORM public.video_date_outbox_enqueue_v2(
    v_match.id,
    'notification.send',
    jsonb_build_object(
      'user_id', v_partner_id,
      'category', 'ready_gate',
      'data', jsonb_build_object(
        'session_id', v_match.id,
        'event_id', p_event_id,
        'source', 'drain_match_queue_v2'
      )
    ),
    'phase3:ready_gate_push:' || v_match.id::text || ':' || v_partner_id::text,
    now()
  );

  v_result := jsonb_build_object(
    'found', true,
    'promoted', true,
    'match_id', v_match.id,
    'video_session_id', v_match.id,
    'event_id', p_event_id,
    'partner_id', v_partner_id,
    'ready_gate_status', 'ready',
    'event', v_event
  );

  PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'committed', v_result);

  v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
  PERFORM public.record_event_loop_observability(
    'drain_match_queue_v2',
    'success',
    NULL,
    v_ms,
    p_event_id,
    v_actor,
    v_match.id,
    jsonb_build_object(
      'promoted', true,
      'partner_id', v_partner_id,
      'runtime_revalidated', true,
      'queued_sessions_browseable', true,
      'fairness', v_fairness
    )
  );

  RETURN v_result || jsonb_build_object(
    'idempotent', false,
    'requestHash', v_begin->>'requestHash',
    'commandStatus', 'committed'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.drain_match_queue_v2(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.drain_match_queue_v2(uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.drain_match_queue_v2(uuid, text) IS
  'Phase 6 queue-drain promotion. Scores queued sessions by wait age, no-match history, readiness, TTL pressure, and capped reliability penalties, then atomically revalidates runtime heartbeat/readiness, block/report exclusions, active-session absence, prior-pair exclusions, and registration state before promoting to Ready Gate with v4 command idempotency.';
