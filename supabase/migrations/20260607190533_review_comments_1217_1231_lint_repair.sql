-- Repair the PR #1217-#1231 follow-up reconciler after linked DB lint
-- identified a reference to nonexistent video_date_surface_claims.release_reason.

BEGIN;

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
  'Provider-authoritative post-encounter absence reconciler. Clears reconnect grace and participant away markers when Daily provider truth shows a rejoin, releases surface claims using existing columns, and otherwise starts/settles provider-absence terminal survey flow.';

NOTIFY pgrst, 'reload schema';

COMMIT;
