-- Ready Gate 57014 reliability hardening.
--
-- The live incident showed mark-ready losing the short Ready Gate window while
-- sync/deck/presence/provider work competed for locks. This migration keeps
-- backend-owned Ready Gate semantics, but makes normal sync snapshots light,
-- mark-ready auxiliary work fail-soft, and deck fetches non-blocking.

CREATE INDEX IF NOT EXISTS idx_event_registrations_profile_active_room
  ON public.event_registrations(profile_id, queue_status, current_room_id)
  WHERE current_room_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.ready_gate_transition_20260602231752_57014_base(uuid, text, text);

ALTER FUNCTION public.ready_gate_transition(uuid, text, text)
  RENAME TO ready_gate_transition_20260602231752_57014_base;

REVOKE ALL ON FUNCTION public.ready_gate_transition_20260602231752_57014_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;

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
  v_actor uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_inactive_reason text;
  v_server_now_ms bigint;
  v_message text;
BEGIN
  v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

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
  END IF;

  RETURN public.ready_gate_transition_20260602231752_57014_base(
    p_session_id,
    p_action,
    p_reason
  );
EXCEPTION
  WHEN query_canceled OR lock_not_available THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;

    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'ready_gate_transition_timeout',
      'reason', 'ready_gate_transition_timeout',
      'code', 'READY_GATE_TRANSITION_TIMEOUT',
      'error_code', 'READY_GATE_TRANSITION_TIMEOUT',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'retryable', true,
      'retry_after_seconds', 2,
      'retry_after_ms', 2000,
      'status', COALESCE(v_session.ready_gate_status, 'unknown'),
      'ready_gate_status', COALESCE(v_session.ready_gate_status, 'unknown'),
      'result_status', COALESCE(v_session.ready_gate_status, 'unknown'),
      'result_ready_gate_status', COALESCE(v_session.ready_gate_status, 'unknown'),
      'terminal', false,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.ready_gate_transition(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ready_gate_transition(uuid, text, text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.ready_gate_transition(uuid, text, text) IS
  'Canonical Ready Gate transition RPC. Uses a lock-light participant snapshot for active sync, delegates mutations to the prior transition stack, and returns retryable timeout metadata for transient 57014 pressure.';

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
  v_key text := COALESCE(NULLIF(btrim(p_idempotency_key), ''), p_session_id::text || ':phase3:mark_ready');
  v_request jsonb := jsonb_build_object('action', 'mark_ready');
  v_begin jsonb;
  v_command_id bigint;
  v_transition jsonb;
  v_success boolean := false;
  v_before public.video_sessions%ROWTYPE;
  v_after public.video_sessions%ROWTYPE;
  v_status text;
  v_changed boolean := false;
  v_actor_role text;
  v_event jsonb := '{}'::jsonb;
  v_room_name text := 'date-' || replace(p_session_id::text, '-', '');
  v_result jsonb;
  v_auxiliary_errors jsonb := '[]'::jsonb;
  v_message text;
BEGIN
  PERFORM set_config('lock_timeout', '1500ms', true);

  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'success', false, 'error', 'not_authenticated');
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
      'commandStatus', COALESCE(v_begin->>'status', 'rejected')
    );
  END IF;

  IF v_begin->>'status' IN ('replay', 'replay_rejected') THEN
    SELECT *
    INTO v_after
    FROM public.video_sessions
    WHERE id = p_session_id;

    v_status := COALESCE(
      v_after.ready_gate_status,
      COALESCE(v_begin->'result', '{}'::jsonb)->>'ready_gate_status',
      COALESCE(v_begin->'result', '{}'::jsonb)->>'status',
      COALESCE(v_begin->'result', '{}'::jsonb)->>'result_ready_gate_status',
      COALESCE(v_begin->'result', '{}'::jsonb)->>'result_status'
    );

    RETURN COALESCE(v_begin->'result', '{}'::jsonb) || jsonb_build_object(
      'commandStatus', v_begin->>'status',
      'commandId', (v_begin->>'commandId')::bigint,
      'requestHash', v_begin->>'requestHash',
      'status', v_status,
      'ready_gate_status', v_status,
      'result_status', v_status,
      'result_ready_gate_status', v_status,
      'session_seq', COALESCE(v_after.session_seq, (COALESCE(v_begin->'result', '{}'::jsonb)->>'session_seq')::bigint)
    );
  END IF;

  IF v_begin->>'status' IS DISTINCT FROM 'started' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'command_in_progress',
      'retryable', true,
      'retry_after_seconds', 1,
      'retry_after_ms', 1000,
      'commandStatus', v_begin->>'status',
      'commandId', (v_begin->>'commandId')::bigint,
      'requestHash', v_begin->>'requestHash'
    );
  END IF;

  v_command_id := (v_begin->>'commandId')::bigint;

  SELECT *
  INTO v_before
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    v_result := jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'session_not_found',
      'commandStatus', 'rejected',
      'commandId', v_command_id,
      'requestHash', v_begin->>'requestHash'
    );
    PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
    RETURN v_result;
  END IF;

  BEGIN
    v_transition := public.ready_gate_transition(p_session_id, 'mark_ready', NULL);
  EXCEPTION
    WHEN query_canceled OR lock_not_available THEN
      GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;

      SELECT *
      INTO v_after
      FROM public.video_sessions
      WHERE id = p_session_id;

      v_status := COALESCE(v_after.ready_gate_status, v_before.ready_gate_status, 'unknown');
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
        'retry_after_seconds', 2,
        'retry_after_ms', 2000,
        'status', v_status,
        'ready_gate_status', v_status,
        'result_status', v_status,
        'result_ready_gate_status', v_status,
        'commandStatus', 'rejected',
        'commandId', v_command_id,
        'requestHash', v_begin->>'requestHash',
        'terminal', COALESCE(v_after.ended_at IS NOT NULL, false)
      );
      PERFORM public.video_session_command_finish_v2(v_command_id, v_actor, 'rejected', v_result);
      RETURN v_result;
  END;

  v_success := COALESCE(
    jsonb_typeof(v_transition->'success') = 'boolean'
      AND (v_transition->>'success')::boolean,
    false
  );

  SELECT *
  INTO v_after
  FROM public.video_sessions
  WHERE id = p_session_id;

  v_status := COALESCE(
    v_transition->>'ready_gate_status',
    v_transition->>'status',
    v_transition->>'result_ready_gate_status',
    v_transition->>'result_status',
    v_after.ready_gate_status
  );
  v_actor_role := CASE
    WHEN v_actor = v_after.participant_1_id THEN 'participant_1'
    WHEN v_actor = v_after.participant_2_id THEN 'participant_2'
    ELSE NULL
  END;
  v_changed :=
    v_success
    AND (
      v_before.ready_gate_status IS DISTINCT FROM v_after.ready_gate_status
      OR v_before.ready_participant_1_at IS DISTINCT FROM v_after.ready_participant_1_at
      OR v_before.ready_participant_2_at IS DISTINCT FROM v_after.ready_participant_2_at
    );

  IF v_changed THEN
    BEGIN
      v_event := public.append_video_session_event_v2(
        p_session_id,
        CASE WHEN v_status = 'both_ready' THEN 'ready_gate_both_ready' ELSE 'ready_gate_mark_ready' END,
        'participants',
        v_actor,
        jsonb_build_object(
          'action', 'mark_ready',
          'ready_gate_status', v_status,
          'actor_role', v_actor_role
        ),
        jsonb_build_object(
          'ready_gate_status', v_status,
          'actor_role', v_actor_role
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
    END;
  END IF;

  IF v_success AND v_status = 'both_ready' THEN
    BEGIN
      PERFORM public.video_date_outbox_enqueue_v2(
        p_session_id,
        'daily.ensure_video_date_room',
        jsonb_build_object(
          'roomName', COALESCE(NULLIF(v_after.daily_room_name, ''), v_room_name),
          'source', 'video_session_mark_ready_v2'
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

  v_result := COALESCE(v_transition, '{}'::jsonb) || jsonb_build_object(
    'ok', v_success,
    'success', v_success,
    'commandStatus', CASE WHEN v_success THEN 'committed' ELSE 'rejected' END,
    'commandId', v_command_id,
    'requestHash', v_begin->>'requestHash',
    'status', v_status,
    'ready_gate_status', v_status,
    'result_status', v_status,
    'result_ready_gate_status', v_status,
    'session_seq', COALESCE((v_event->>'sessionSeq')::bigint, v_after.session_seq),
    'auxiliary_errors', v_auxiliary_errors,
    'provider_outbox_degraded', jsonb_array_length(v_auxiliary_errors) > 0
  );

  PERFORM public.video_session_command_finish_v2(
    v_command_id,
    v_actor,
    CASE WHEN v_success THEN 'committed' ELSE 'rejected' END,
    v_result
  );
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text) IS
  'Phase 3.1 participant mark-ready transition. Keeps Ready Gate mutation decisive while event append and Daily room outbox enqueue are fail-soft, and returns retryable timeout metadata for transient 57014 pressure.';

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
  v_confirmed_candidate_count integer := 0;
  v_eligible_unswiped_count integer := 0;
  v_raw_count integer := 0;
  v_eligible_count integer := 0;
  v_profile_count integer := 0;
  v_marked_count integer := 0;
  v_reused_reservation_count integer := 0;
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
      AND COALESCE(er.admission_status, '') = 'confirmed'
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

  SELECT count(*)::integer
  INTO v_confirmed_candidate_count
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id <> p_user_id
    AND COALESCE(er.admission_status, '') = 'confirmed';

  IF NOT pg_try_advisory_xact_lock(
    hashtextextended('video_date_deck_v3:' || p_event_id::text || ':' || p_user_id::text, 0)
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'profiles', '[]'::jsonb,
      'deck_state', jsonb_build_object(
        'reason', 'deck_busy',
        'retryable', true,
        'retry_after_seconds', 2,
        'retry_after_ms', 2000,
        'limit', v_limit
      )
    );
  END IF;

  WITH raw_deck AS (
    SELECT gd.*, gd.ordinality::integer AS base_rn
    FROM public.get_event_deck(p_event_id, p_user_id, v_scan_limit) WITH ORDINALITY AS gd
  ),
  raw_count AS (
    SELECT count(*)::integer AS n FROM raw_deck
  ),
  eligible_raw AS (
    SELECT rd.*
    FROM raw_deck rd
    CROSS JOIN LATERAL (
      SELECT public.event_deck_candidate_eligibility(
        p_event_id,
        p_user_id,
        rd.profile_id,
        true,
        true
      ) AS value
    ) eligibility
    WHERE COALESCE((eligibility.value->>'ok')::boolean, false)
  ),
  eligible_count AS (
    SELECT count(*)::integer AS n FROM eligible_raw
  ),
  latest_active_batch AS (
    SELECT r.issued_at
    FROM public.event_deck_card_reservations r
    WHERE r.event_id = p_event_id
      AND r.viewer_id = p_user_id
      AND r.expires_at > now()
      AND r.swiped_at IS NULL
    GROUP BY r.issued_at
    ORDER BY r.issued_at DESC
    LIMIT 1
  ),
  latest_active_reservations AS (
    SELECT
      r.id,
      r.target_id,
      r.deck_token,
      r.deck_rank,
      r.expires_at,
      r.issued_at
    FROM public.event_deck_card_reservations r
    JOIN latest_active_batch b ON b.issued_at = r.issued_at
    WHERE r.event_id = p_event_id
      AND r.viewer_id = p_user_id
      AND r.expires_at > now()
      AND r.swiped_at IS NULL
  ),
  reservation_batch AS (
    SELECT COALESCE((SELECT issued_at FROM latest_active_batch), now()) AS issued_at
  ),
  filtered AS (
    SELECT
      erd.*,
      epi.strongest_exclusion_reason AS impression_reason,
      epi.prefetch_expires_at AS impression_prefetch_expires_at,
      lar.deck_token AS active_reservation_deck_token,
      lar.deck_rank AS active_reservation_deck_rank,
      lar.expires_at AS active_reservation_expires_at,
      lar.issued_at AS active_reservation_issued_at
    FROM eligible_raw erd
    LEFT JOIN public.event_profile_impressions epi
      ON epi.event_id = p_event_id
      AND epi.viewer_id = p_user_id
      AND epi.target_id = erd.profile_id
    LEFT JOIN latest_active_reservations lar
      ON lar.target_id = erd.profile_id
    WHERE epi.target_id IS NULL
      OR public.video_date_impression_rank(epi.strongest_exclusion_reason)
          < public.video_date_impression_rank('pass')
  ),
  ranked AS (
    SELECT *
    FROM (
      SELECT
        filtered.*,
        row_number() OVER (
          ORDER BY
            CASE
              WHEN filtered.active_reservation_deck_rank IS NOT NULL THEN 0
              ELSE 1
            END,
            filtered.active_reservation_deck_rank,
            CASE
              WHEN filtered.impression_prefetch_expires_at IS NULL
                   OR filtered.impression_prefetch_expires_at <= now()
                THEN 0
              ELSE 1
            END,
            filtered.base_rn
        ) AS rn
      FROM filtered
    ) ordered
    ORDER BY rn
    LIMIT v_limit
  ),
  active_reusable_reservations AS (
    UPDATE public.event_deck_card_reservations r
    SET deck_rank = ranked.rn::integer,
        expires_at = GREATEST(r.expires_at, now() + interval '2 minutes'),
        metadata = r.metadata || jsonb_build_object(
          'reservation_reused', true,
          'reservation_reused_at', now(),
          'reservation_reuse_scope', 'card',
          'reservation_previous_deck_rank', r.deck_rank
        )
    FROM latest_active_batch b, ranked
    WHERE r.event_id = p_event_id
      AND r.viewer_id = p_user_id
      AND ranked.profile_id = r.target_id
      AND r.issued_at = b.issued_at
      AND r.expires_at > now()
      AND r.swiped_at IS NULL
    RETURNING r.target_id, r.deck_token, r.deck_rank, r.expires_at, true AS reused
  ),
  new_reservations AS (
    INSERT INTO public.event_deck_card_reservations (
      event_id,
      viewer_id,
      target_id,
      deck_token,
      deck_rank,
      issued_at,
      expires_at,
      source,
      metadata
    )
    SELECT
      p_event_id,
      p_user_id,
      ranked.profile_id,
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      ranked.rn::integer,
      rb.issued_at,
      now() + interval '2 minutes',
      'get_event_deck_v3',
      jsonb_build_object('deck_version', 'v3', 'server_prefetched', true)
    FROM ranked
    CROSS JOIN reservation_batch rb
    WHERE NOT EXISTS (
      SELECT 1
      FROM active_reusable_reservations existing
      WHERE existing.target_id = ranked.profile_id
    )
    RETURNING target_id, deck_token, deck_rank, expires_at, false AS reused
  ),
  reservations AS (
    SELECT target_id, deck_token, deck_rank, expires_at, reused FROM active_reusable_reservations
    UNION ALL
    SELECT target_id, deck_token, deck_rank, expires_at, reused FROM new_reservations
  ),
  mark_buffer AS (
    SELECT public.record_event_profile_impression_v2(
      p_event_id,
      p_user_id,
      ranked.profile_id,
      'prefetched',
      'get_event_deck_v3_buffer',
      NULL,
      jsonb_build_object(
        'server_prefetched', true,
        'prefetch_ttl_seconds', 120,
        'deck_rank', ranked.rn,
        'deck_version', 'v3',
        'reservation_issued', true
      )
    ) AS result
    FROM ranked
    JOIN reservations r ON r.target_id = ranked.profile_id
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.event_profile_impressions existing_prefetch
      WHERE existing_prefetch.event_id = p_event_id
        AND existing_prefetch.viewer_id = p_user_id
        AND existing_prefetch.target_id = ranked.profile_id
        AND (
          public.video_date_impression_rank(existing_prefetch.strongest_exclusion_reason)
            >= public.video_date_impression_rank('dealt')
          OR (
            existing_prefetch.strongest_exclusion_reason = 'prefetched'
            AND existing_prefetch.prefetch_expires_at > now()
          )
        )
    )
  )
  SELECT
    COALESCE(
      jsonb_agg(
        (
          to_jsonb(ranked)
            - 'rn'
            - 'base_rn'
            - 'ordinality'
            - 'impression_reason'
            - 'impression_prefetch_expires_at'
            - 'active_reservation_deck_token'
            - 'active_reservation_deck_rank'
            - 'active_reservation_expires_at'
            - 'active_reservation_issued_at'
        ) || jsonb_build_object(
          'deck_token', reservations.deck_token,
          'deck_rank', ranked.rn
        )
        ORDER BY ranked.rn
      ),
      '[]'::jsonb
    ),
    COALESCE((SELECT n FROM raw_count), 0),
    COALESCE((SELECT n FROM eligible_count), 0),
    count(ranked.profile_id)::integer,
    COALESCE((
      SELECT count(*)::integer
      FROM mark_buffer
      WHERE COALESCE((result->>'ok')::boolean, false)
    ), 0),
    COALESCE((
      SELECT count(*)::integer
      FROM reservations
      WHERE reused
    ), 0)
  INTO v_profiles, v_raw_count, v_eligible_count, v_profile_count, v_marked_count, v_reused_reservation_count
  FROM ranked
  JOIN reservations ON reservations.target_id = ranked.profile_id;

  IF v_profile_count = 0 AND v_confirmed_candidate_count > 0 THEN
    SELECT count(*)::integer
    INTO v_eligible_unswiped_count
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id <> p_user_id
      AND COALESCE(er.admission_status, '') = 'confirmed'
      AND COALESCE((public.event_deck_candidate_eligibility(
        p_event_id,
        p_user_id,
        er.profile_id,
        true,
        false
      )->>'ok')::boolean, false);
  END IF;

  v_reason := CASE
    WHEN v_profile_count > 0 THEN 'has_profiles'
    WHEN v_eligible_count > 0 THEN 'no_remaining_profiles'
    WHEN v_raw_count > 0 THEN 'scan_window_exhausted'
    WHEN v_eligible_unswiped_count > 0 THEN 'no_remaining_profiles'
    WHEN v_confirmed_candidate_count = 0 THEN 'no_confirmed_candidates'
    ELSE 'scan_window_exhausted'
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'profiles', v_profiles,
    'deck_state', jsonb_build_object(
      'reason', v_reason,
      'retryable', false,
      'limit', v_limit,
      'scan_limit', v_scan_limit,
      'confirmed_candidate_count', v_confirmed_candidate_count,
      'raw_count', v_raw_count,
      'eligible_count', v_eligible_count,
      'eligible_unswiped_count', v_eligible_unswiped_count,
      'profile_count', v_profile_count,
      'marked_count', v_marked_count,
      'mark_action', 'prefetched',
      'prefetch_ttl_seconds', 120,
      'reservation_ttl_seconds', 120,
      'reused_reservation_count', v_reused_reservation_count,
      'preserves_active_reservations', true,
      'redeal_unacted', true
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_event_deck_v3(uuid, uuid, integer) IS
  'Event deck v3 RPC. Returns retryable deck_busy instead of waiting on advisory locks, preserves active reservation buffers during top-up refetches, and leaves stale-reservation cleanup to bounded service paths.';
