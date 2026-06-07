-- Review comments follow-up for PRs #1217 through #1231.
--
-- All referenced migrations are already part of applied history, so this file
-- patches current public/helper definitions without rewriting prior migrations.

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
  v_is_service boolean := COALESCE(auth.role(), '') = 'service_role';
  v_session public.video_sessions%ROWTYPE;
  v_result jsonb;
  v_protection jsonb;
  v_ready_gate_status text;
  v_success boolean := false;
  v_server_now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
BEGIN
  -- The preserved event-cleanup base can terminalize an inactive event before
  -- the decisive mark-ready base verifies participant membership. Gate that base
  -- behind the same participant/service precheck for authenticated callers.
  IF NOT v_is_service THEN
    IF v_actor IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'success', false,
        'error', 'auth_required',
        'reason', 'auth_required',
        'code', 'AUTH_REQUIRED',
        'error_code', 'AUTH_REQUIRED',
        'retryable', false,
        'terminal', true,
        'server_now_ms', v_server_now_ms,
        'serverNowMs', v_server_now_ms
      );
    END IF;

    IF p_session_id IS NOT NULL THEN
      SELECT *
      INTO v_session
      FROM public.video_sessions
      WHERE id = p_session_id;

      IF FOUND
         AND v_session.participant_1_id IS DISTINCT FROM v_actor
         AND v_session.participant_2_id IS DISTINCT FROM v_actor THEN
        RETURN jsonb_build_object(
          'ok', false,
          'success', false,
          'error', 'not_participant',
          'reason', 'not_participant',
          'code', 'ACCESS_DENIED',
          'error_code', 'ACCESS_DENIED',
          'retryable', false,
          'terminal', true,
          'event_cleanup_prechecked', true,
          'server_now_ms', v_server_now_ms,
          'serverNowMs', v_server_now_ms
        );
      END IF;
    END IF;
  END IF;

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
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_session_mark_ready_v2(uuid, text, text) IS
  'Participant-gated Ready Gate mark-ready wrapper. Non-participants cannot trigger preserved event-wide inactive cleanup before decisive mark-ready authorization; both_ready entry protection remains active.';

CREATE OR REPLACE FUNCTION public.video_date_reconcile_provider_absence_v1(
  p_session_id uuid,
  p_source text DEFAULT 'video_date_reconcile_provider_absence_v1'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_session public.video_sessions%ROWTYPE;
  v_p1 jsonb := '{}'::jsonb;
  v_p2 jsonb := '{}'::jsonb;
  v_p1_active boolean := false;
  v_p2_active boolean := false;
  v_p1_left_at timestamptz;
  v_p2_left_at timestamptz;
  v_latest_left_at timestamptz;
  v_confirmed boolean := false;
  v_confirmed_after_at timestamptz;
  v_grace_until timestamptz;
  v_should_open_survey boolean := false;
  v_event_live boolean := false;
  v_resume_status text := 'idle';
  v_rows_changed integer := 0;
  v_source text := NULLIF(left(btrim(COALESCE(p_source, '')), 120), '');
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_id_required');
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  IF v_session.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'terminal', true,
      'already_ended', true,
      'ended_at', v_session.ended_at,
      'ended_reason', v_session.ended_reason
    );
  END IF;

  v_confirmed := public.video_date_session_has_confirmed_encounter(
    v_session.date_started_at,
    v_session.state::text,
    v_session.phase,
    v_session.participant_1_joined_at,
    v_session.participant_2_joined_at,
    v_session.participant_1_remote_seen_at,
    v_session.participant_2_remote_seen_at
  );

  IF NOT v_confirmed THEN
    RETURN jsonb_build_object(
      'ok', true,
      'terminal', false,
      'provider_absence_checked', false,
      'reason', 'confirmed_encounter_required'
    );
  END IF;

  v_p1 := public.video_date_actor_provider_presence_v1(
    p_session_id,
    v_session.participant_1_id
  );
  v_p2 := public.video_date_actor_provider_presence_v1(
    p_session_id,
    v_session.participant_2_id
  );

  v_p1_active := COALESCE((v_p1->>'active')::boolean, false);
  v_p2_active := COALESCE((v_p2->>'active')::boolean, false);

  v_p1_left_at := CASE
    WHEN v_p1->>'latest_provider_event_type' = 'participant.left'
      AND NULLIF(v_p1->>'latest_provider_event_at', '') IS NOT NULL
      THEN (v_p1->>'latest_provider_event_at')::timestamptz
    ELSE NULL
  END;
  v_p2_left_at := CASE
    WHEN v_p2->>'latest_provider_event_type' = 'participant.left'
      AND NULLIF(v_p2->>'latest_provider_event_at', '') IS NOT NULL
      THEN (v_p2->>'latest_provider_event_at')::timestamptz
    ELSE NULL
  END;

  IF v_p1_active OR v_p2_active THEN
    UPDATE public.video_sessions
    SET
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = CASE
        WHEN v_p1_active THEN NULL
        ELSE participant_1_away_at
      END,
      participant_2_away_at = CASE
        WHEN v_p2_active THEN NULL
        ELSE participant_2_away_at
      END,
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND (
        reconnect_grace_ends_at IS NOT NULL
        OR (v_p1_active AND participant_1_away_at IS NOT NULL)
        OR (v_p2_active AND participant_2_away_at IS NOT NULL)
      );
    GET DIAGNOSTICS v_rows_changed = ROW_COUNT;

    IF v_rows_changed > 0 THEN
      PERFORM public.bump_video_session_seq(p_session_id);
      PERFORM public.record_event_loop_observability(
        'video_date_provider_absence',
        'success',
        'provider_absence_grace_cleared_by_rejoin',
        NULL,
        v_session.event_id,
        NULL,
        p_session_id,
        jsonb_build_object(
          'source', COALESCE(v_source, 'video_date_reconcile_provider_absence_v1'),
          'participant_1_provider_active', v_p1_active,
          'participant_2_provider_active', v_p2_active,
          'participant_1_provider_presence', v_p1,
          'participant_2_provider_presence', v_p2
        )
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'terminal', false,
      'provider_absence_checked', true,
      'provider_absence_grace_cleared', v_rows_changed > 0,
      'reason', 'active_provider_present',
      'participant_1_provider_presence', v_p1,
      'participant_2_provider_presence', v_p2
    );
  END IF;

  IF v_p1_left_at IS NULL OR v_p2_left_at IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'terminal', false,
      'provider_absence_checked', true,
      'reason', 'missing_left_pair',
      'participant_1_provider_presence', v_p1,
      'participant_2_provider_presence', v_p2
    );
  END IF;

  v_latest_left_at := GREATEST(v_p1_left_at, v_p2_left_at);
  v_confirmed_after_at := GREATEST(
    COALESCE(v_session.date_started_at, '-infinity'::timestamptz),
    COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz),
    COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz),
    COALESCE(v_session.handshake_started_at, '-infinity'::timestamptz),
    COALESCE(v_session.started_at, '-infinity'::timestamptz)
  );

  IF v_latest_left_at < v_confirmed_after_at - interval '5 seconds' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'terminal', false,
      'provider_absence_checked', true,
      'reason', 'provider_left_before_confirmed_encounter',
      'latest_left_at', v_latest_left_at,
      'confirmed_after_at', v_confirmed_after_at
    );
  END IF;

  v_grace_until := v_latest_left_at + interval '12 seconds';

  IF v_now < v_grace_until THEN
    UPDATE public.video_sessions
    SET
      reconnect_grace_ends_at = v_grace_until,
      participant_1_away_at = GREATEST(COALESCE(participant_1_away_at, '-infinity'::timestamptz), v_p1_left_at),
      participant_2_away_at = GREATEST(COALESCE(participant_2_away_at, '-infinity'::timestamptz), v_p2_left_at),
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND (
        reconnect_grace_ends_at IS DISTINCT FROM v_grace_until
        OR participant_1_away_at IS DISTINCT FROM GREATEST(COALESCE(participant_1_away_at, '-infinity'::timestamptz), v_p1_left_at)
        OR participant_2_away_at IS DISTINCT FROM GREATEST(COALESCE(participant_2_away_at, '-infinity'::timestamptz), v_p2_left_at)
      );
    GET DIAGNOSTICS v_rows_changed = ROW_COUNT;

    IF v_rows_changed > 0 THEN
      PERFORM public.bump_video_session_seq(p_session_id);
      PERFORM public.record_event_loop_observability(
        'video_date_provider_absence',
        'success',
        'provider_absence_reconnect_grace_started',
        NULL,
        v_session.event_id,
        NULL,
        p_session_id,
        jsonb_build_object(
          'source', COALESCE(v_source, 'video_date_reconcile_provider_absence_v1'),
          'latest_left_at', v_latest_left_at,
          'reconnect_grace_ends_at', v_grace_until,
          'participant_1_provider_presence', v_p1,
          'participant_2_provider_presence', v_p2
        )
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'terminal', false,
      'provider_absence_checked', true,
      'provider_absence_grace_started', true,
      'reconnect_grace_ends_at', v_grace_until,
      'latest_left_at', v_latest_left_at,
      'participant_1_provider_presence', v_p1,
      'participant_2_provider_presence', v_p2
    );
  END IF;

  v_should_open_survey := public.video_date_session_is_post_date_survey_eligible_v2(
    v_now,
    'provider_absence_after_confirmed_encounter',
    v_session.date_started_at,
    v_session.state::text,
    v_session.phase,
    v_session.participant_1_joined_at,
    v_session.participant_2_joined_at,
    v_session.participant_1_remote_seen_at,
    v_session.participant_2_remote_seen_at
  );

  SELECT EXISTS (
    SELECT 1
    FROM public.events ev
    WHERE ev.id = v_session.event_id
      AND ev.status = 'live'
      AND ev.archived_at IS NULL
  )
  INTO v_event_live;

  UPDATE public.video_sessions
  SET
    ended_at = v_now,
    state = 'ended'::public.video_date_state,
    phase = 'ended',
    ended_reason = 'provider_absence_after_confirmed_encounter',
    reconnect_grace_ends_at = NULL,
    participant_1_away_at = COALESCE(participant_1_away_at, v_p1_left_at),
    participant_2_away_at = COALESCE(participant_2_away_at, v_p2_left_at),
    duration_seconds = COALESCE(
      duration_seconds,
      GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(date_started_at, handshake_started_at, started_at, v_now))))::int)
    ),
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL;
  GET DIAGNOSTICS v_rows_changed = ROW_COUNT;

  IF v_rows_changed > 0 THEN
    PERFORM public.bump_video_session_seq(p_session_id);
  END IF;

  UPDATE public.event_registrations
  SET
    queue_status = CASE WHEN v_should_open_survey THEN 'in_survey' ELSE 'browsing' END,
    current_room_id = CASE WHEN v_should_open_survey THEN p_session_id ELSE NULL END,
    current_partner_id = CASE
      WHEN v_should_open_survey AND profile_id = v_session.participant_1_id THEN v_session.participant_2_id
      WHEN v_should_open_survey AND profile_id = v_session.participant_2_id THEN v_session.participant_1_id
      ELSE NULL
    END,
    last_active_at = v_now,
    updated_at = v_now
  WHERE event_id = v_session.event_id
    AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);

  UPDATE public.video_date_surface_claims
  SET
    released_at = COALESCE(released_at, v_now),
    release_reason = COALESCE(release_reason, 'provider_absence_after_confirmed_encounter'),
    updated_at = v_now
  WHERE session_id = p_session_id
    AND released_at IS NULL;

  v_resume_status := CASE
    WHEN v_should_open_survey THEN 'in_survey'
    WHEN v_event_live THEN 'browsing'
    ELSE 'idle'
  END;

  PERFORM public.record_event_loop_observability(
    'video_date_provider_absence',
    'success',
    CASE
      WHEN v_should_open_survey THEN 'provider_absence_terminal_survey'
      ELSE 'provider_absence_terminal_no_survey'
    END,
    NULL,
    v_session.event_id,
    NULL,
    p_session_id,
    jsonb_build_object(
      'source', COALESCE(v_source, 'video_date_reconcile_provider_absence_v1'),
      'ended_reason', 'provider_absence_after_confirmed_encounter',
      'latest_left_at', v_latest_left_at,
      'reconnect_grace_ends_at', v_grace_until,
      'survey_required', v_should_open_survey,
      'resume_status', v_resume_status,
      'participant_1_provider_presence', v_p1,
      'participant_2_provider_presence', v_p2
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'terminal', true,
    'terminalized', v_rows_changed > 0,
    'survey_required', v_should_open_survey,
    'ended_reason', 'provider_absence_after_confirmed_encounter',
    'resume_status', v_resume_status,
    'latest_left_at', v_latest_left_at,
    'participant_1_provider_presence', v_p1,
    'participant_2_provider_presence', v_p2
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_reconcile_provider_absence_v1(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_reconcile_provider_absence_v1(uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.video_date_reconcile_provider_absence_v1(uuid, text) IS
  'Provider-authoritative post-encounter absence reconciler. Clears reconnect grace and participant away markers when Daily provider truth shows a rejoin, otherwise starts/settles provider-absence terminal survey flow.';

CREATE OR REPLACE FUNCTION public.validate_video_date_registration_session_drift_v1(
  p_event_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));
  v_checked integer := 0;
  v_drift jsonb := '[]'::jsonb;
BEGIN
  WITH candidates AS (
    SELECT
      vs.id,
      vs.event_id,
      vs.participant_1_id,
      vs.participant_2_id,
      vs.ready_gate_status,
      vs.ready_gate_expires_at,
      vs.state::text AS state,
      vs.phase,
      vs.ended_at,
      vs.state_updated_at
    FROM public.video_sessions vs
    WHERE vs.ended_at IS NULL
      AND vs.state::text = 'ready_gate'
      AND COALESCE(vs.phase, 'ready_gate') = 'ready_gate'
      AND vs.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
      AND (p_event_id IS NULL OR vs.event_id = p_event_id)
    ORDER BY vs.state_updated_at DESC NULLS LAST, vs.started_at DESC NULLS LAST
    LIMIT v_limit
  ),
  joined AS (
    SELECT
      c.*,
      er1.profile_id AS p1_profile_id,
      er1.queue_status AS p1_queue_status,
      er1.current_room_id AS p1_current_room_id,
      er1.current_partner_id AS p1_current_partner_id,
      er2.profile_id AS p2_profile_id,
      er2.queue_status AS p2_queue_status,
      er2.current_room_id AS p2_current_room_id,
      er2.current_partner_id AS p2_current_partner_id
    FROM candidates c
    LEFT JOIN public.event_registrations er1
      ON er1.event_id = c.event_id
     AND er1.profile_id = c.participant_1_id
    LEFT JOIN public.event_registrations er2
      ON er2.event_id = c.event_id
     AND er2.profile_id = c.participant_2_id
  ),
  evaluated AS (
    SELECT
      j.*,
      array_remove(ARRAY[
        CASE WHEN j.p1_profile_id IS NULL THEN 'participant_1_registration_missing' END,
        CASE WHEN j.p2_profile_id IS NULL THEN 'participant_2_registration_missing' END,
        CASE WHEN j.p1_current_room_id IS DISTINCT FROM j.id THEN 'participant_1_current_room_mismatch' END,
        CASE WHEN j.p2_current_room_id IS DISTINCT FROM j.id THEN 'participant_2_current_room_mismatch' END,
        CASE WHEN j.p1_current_partner_id IS DISTINCT FROM j.participant_2_id THEN 'participant_1_partner_mismatch' END,
        CASE WHEN j.p2_current_partner_id IS DISTINCT FROM j.participant_1_id THEN 'participant_2_partner_mismatch' END,
        CASE WHEN j.p1_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_1_not_in_ready_gate' END,
        CASE WHEN j.p2_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_2_not_in_ready_gate' END
      ]::text[], NULL) AS issues
    FROM joined j
  )
  SELECT
    (SELECT count(*)::integer FROM evaluated),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'session_id', e.id,
          'event_id', e.event_id,
          'ready_gate_status', e.ready_gate_status,
          'state', e.state,
          'phase', e.phase,
          'participant_1_id', e.participant_1_id,
          'participant_2_id', e.participant_2_id,
          'participant_1_queue_status', e.p1_queue_status,
          'participant_2_queue_status', e.p2_queue_status,
          'participant_1_current_room_id', e.p1_current_room_id,
          'participant_2_current_room_id', e.p2_current_room_id,
          'participant_1_current_partner_id', e.p1_current_partner_id,
          'participant_2_current_partner_id', e.p2_current_partner_id,
          'issues', to_jsonb(e.issues)
        )
        ORDER BY e.state_updated_at DESC NULLS LAST
      ) FILTER (WHERE cardinality(e.issues) > 0),
      '[]'::jsonb
    )
  INTO v_checked, v_drift
  FROM evaluated e;

  RETURN jsonb_build_object(
    'ok', true,
    'checked_count', v_checked,
    'drift_count', jsonb_array_length(v_drift),
    'drift', v_drift,
    'queued_excluded', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_video_date_registration_session_drift_v1(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_video_date_registration_session_drift_v1(uuid, integer)
  TO service_role;

COMMENT ON FUNCTION public.validate_video_date_registration_session_drift_v1(uuid, integer) IS
  'Service-only assertion for active Ready Gate registration/session drift. Queued sessions are deliberately excluded because multiple queued matches can coexist for one participant.';

CREATE OR REPLACE FUNCTION public.repair_video_date_registration_session_drift_v1(
  p_event_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));
  v_row record;
  v_items jsonb := '[]'::jsonb;
  v_repaired integer := 0;
  v_skipped integer := 0;
BEGIN
  FOR v_row IN
    WITH candidates AS (
      SELECT
        vs.id,
        vs.event_id,
        vs.participant_1_id,
        vs.participant_2_id,
        vs.ready_gate_status,
        vs.state_updated_at
      FROM public.video_sessions vs
      WHERE vs.ended_at IS NULL
        AND vs.state::text = 'ready_gate'
        AND COALESCE(vs.phase, 'ready_gate') = 'ready_gate'
        AND vs.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
        AND (p_event_id IS NULL OR vs.event_id = p_event_id)
      ORDER BY vs.state_updated_at DESC NULLS LAST, vs.started_at DESC NULLS LAST
      LIMIT v_limit
    ),
    joined AS (
      SELECT
        c.*,
        er1.profile_id AS p1_profile_id,
        er1.queue_status AS p1_queue_status,
        er1.current_room_id AS p1_current_room_id,
        er1.current_partner_id AS p1_current_partner_id,
        er2.profile_id AS p2_profile_id,
        er2.queue_status AS p2_queue_status,
        er2.current_room_id AS p2_current_room_id,
        er2.current_partner_id AS p2_current_partner_id
      FROM candidates c
      LEFT JOIN public.event_registrations er1
        ON er1.event_id = c.event_id
       AND er1.profile_id = c.participant_1_id
      LEFT JOIN public.event_registrations er2
        ON er2.event_id = c.event_id
       AND er2.profile_id = c.participant_2_id
    ),
    evaluated AS (
      SELECT
        j.*,
        array_remove(ARRAY[
          CASE WHEN j.p1_profile_id IS NULL THEN 'participant_1_registration_missing' END,
          CASE WHEN j.p2_profile_id IS NULL THEN 'participant_2_registration_missing' END,
          CASE WHEN j.p1_current_room_id IS DISTINCT FROM j.id THEN 'participant_1_current_room_mismatch' END,
          CASE WHEN j.p2_current_room_id IS DISTINCT FROM j.id THEN 'participant_2_current_room_mismatch' END,
          CASE WHEN j.p1_current_partner_id IS DISTINCT FROM j.participant_2_id THEN 'participant_1_partner_mismatch' END,
          CASE WHEN j.p2_current_partner_id IS DISTINCT FROM j.participant_1_id THEN 'participant_2_partner_mismatch' END,
          CASE WHEN j.p1_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_1_not_in_ready_gate' END,
          CASE WHEN j.p2_queue_status IS DISTINCT FROM 'in_ready_gate' THEN 'participant_2_not_in_ready_gate' END
        ]::text[], NULL) AS issues
      FROM joined j
    )
    SELECT *
    FROM evaluated
    WHERE cardinality(issues) > 0
    ORDER BY state_updated_at DESC NULLS LAST
  LOOP
    IF v_row.p1_profile_id IS NULL OR v_row.p2_profile_id IS NULL THEN
      v_skipped := v_skipped + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'session_id', v_row.id,
        'event_id', v_row.event_id,
        'action', 'skipped',
        'reason', 'missing_registration',
        'issues', to_jsonb(v_row.issues)
      ));
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.event_registrations er
      WHERE er.event_id = v_row.event_id
        AND er.profile_id IN (v_row.participant_1_id, v_row.participant_2_id)
        AND er.current_room_id IS NOT NULL
        AND er.current_room_id IS DISTINCT FROM v_row.id
        AND er.queue_status IN ('in_ready_gate', 'in_handshake', 'in_date', 'in_survey')
    ) THEN
      v_skipped := v_skipped + 1;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'session_id', v_row.id,
        'event_id', v_row.event_id,
        'action', 'skipped',
        'reason', 'conflicting_active_registration',
        'issues', to_jsonb(v_row.issues)
      ));
      CONTINUE;
    END IF;

    IF NOT p_dry_run THEN
      UPDATE public.event_registrations er
      SET
        current_room_id = v_row.id,
        current_partner_id = CASE
          WHEN er.profile_id = v_row.participant_1_id THEN v_row.participant_2_id
          ELSE v_row.participant_1_id
        END,
        queue_status = 'in_ready_gate',
        updated_at = now()
      WHERE er.event_id = v_row.event_id
        AND er.profile_id IN (v_row.participant_1_id, v_row.participant_2_id);
    END IF;

    v_repaired := v_repaired + 1;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'session_id', v_row.id,
      'event_id', v_row.event_id,
      'ready_gate_status', v_row.ready_gate_status,
      'action', CASE WHEN p_dry_run THEN 'would_repair' ELSE 'repaired' END,
      'issues', to_jsonb(v_row.issues)
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'queued_excluded', true,
    'repairable_count', v_repaired,
    'skipped_count', v_skipped,
    'items', v_items
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.repair_video_date_registration_session_drift_v1(uuid, integer, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.repair_video_date_registration_session_drift_v1(uuid, integer, boolean)
  TO service_role;

COMMENT ON FUNCTION public.repair_video_date_registration_session_drift_v1(uuid, integer, boolean) IS
  'Service-only dry-run-by-default repair for active Ready Gate registration/session drift. Queued sessions are excluded because current_room_id is not exclusive while browse-while-queued can create multiple queued rows.';

CREATE OR REPLACE FUNCTION public.video_date_lifecycle_terminal_context_v1(
  p_session_id uuid,
  p_actor_id uuid DEFAULT auth.uid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_row public.video_sessions%ROWTYPE;
  v_queue_status text := NULL;
  v_current_room_id uuid := NULL;
  v_feedback_exists boolean := false;
  v_survey_required boolean := false;
  v_terminal boolean := false;
  v_authorized_context boolean := false;
  v_is_service boolean := COALESCE(auth.role(), '') = 'service_role';
BEGIN
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'terminal_context_available', false,
      'authorized_context', false,
      'session_ended', false,
      'terminal', false,
      'survey_required', false
    );
  END IF;

  SELECT *
  INTO v_row
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'terminal_context_available', false,
      'authorized_context', false,
      'session_ended', false,
      'terminal', false,
      'survey_required', false,
      'session_id', p_session_id
    );
  END IF;

  v_authorized_context :=
    v_is_service
    OR (
      p_actor_id IS NOT NULL
      AND (
        v_row.participant_1_id = p_actor_id
        OR v_row.participant_2_id = p_actor_id
      )
    );

  IF NOT v_authorized_context THEN
    RETURN jsonb_build_object(
      'terminal_context_available', false,
      'authorized_context', false,
      'session_id', p_session_id,
      'session_ended', false,
      'terminal', false,
      'survey_required', false,
      'access_denied', true,
      'code', 'ACCESS_DENIED',
      'error_code', 'ACCESS_DENIED',
      'error', 'not_participant'
    );
  END IF;

  IF p_actor_id IS NOT NULL THEN
    SELECT er.queue_status, er.current_room_id
    INTO v_queue_status, v_current_room_id
    FROM public.event_registrations er
    WHERE er.event_id = v_row.event_id
      AND er.profile_id = p_actor_id
    LIMIT 1;

    SELECT EXISTS (
      SELECT 1
      FROM public.date_feedback df
      WHERE df.session_id = p_session_id
        AND df.user_id = p_actor_id
    )
    INTO v_feedback_exists;
  END IF;

  v_terminal :=
    v_row.ended_at IS NOT NULL
    OR v_row.state::text = 'ended'
    OR COALESCE(v_row.phase, '') = 'ended';

  v_survey_required :=
    v_queue_status = 'in_survey'
    OR public.video_date_session_is_post_date_survey_eligible_v2(
      v_row.ended_at,
      v_row.ended_reason,
      v_row.date_started_at,
      v_row.state::text,
      v_row.phase,
      v_row.participant_1_joined_at,
      v_row.participant_2_joined_at,
      v_row.participant_1_remote_seen_at,
      v_row.participant_2_remote_seen_at
    );

  RETURN jsonb_build_object(
    'terminal_context_available', true,
    'authorized_context', true,
    'session_id', v_row.id,
    'event_id', v_row.event_id,
    'state', v_row.state::text,
    'phase', v_row.phase,
    'ready_gate_status', v_row.ready_gate_status,
    'session_ended', v_terminal,
    'terminal', v_terminal,
    'ended_at', v_row.ended_at,
    'ended_reason', v_row.ended_reason,
    'survey_required', v_survey_required,
    'queue_status', v_queue_status,
    'current_room_id', v_current_room_id,
    'date_started_at', v_row.date_started_at,
    'handshake_started_at', v_row.handshake_started_at,
    'participant_1_joined_at', v_row.participant_1_joined_at,
    'participant_2_joined_at', v_row.participant_2_joined_at,
    'participant_1_away_at', v_row.participant_1_away_at,
    'participant_2_away_at', v_row.participant_2_away_at,
    'participant_1_remote_seen_at', v_row.participant_1_remote_seen_at,
    'participant_2_remote_seen_at', v_row.participant_2_remote_seen_at,
    'daily_room_name', v_row.daily_room_name,
    'daily_room_url', v_row.daily_room_url,
    'feedback_exists', v_feedback_exists
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'terminal_context_available', false,
      'authorized_context', false,
      'session_ended', false,
      'terminal', false,
      'survey_required', false,
      'session_id', p_session_id,
      'terminal_context_error', SQLSTATE,
      'terminal_context_message', SQLERRM
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_lifecycle_terminal_context_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.video_date_lifecycle_terminal_context_v1(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.video_date_lifecycle_terminal_context_v1(uuid, uuid) IS
  'Service-only terminal context helper. Returns full Video Date terminal/survey metadata only for participants or service-role callers; non-participants get minimal nonterminal access-denied context.';

NOTIFY pgrst, 'reload schema';

COMMIT;
