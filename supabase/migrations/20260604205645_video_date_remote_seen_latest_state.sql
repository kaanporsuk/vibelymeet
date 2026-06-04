BEGIN;

CREATE OR REPLACE FUNCTION public.mark_video_date_remote_seen(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_previous_remote_seen_at timestamptz;
  v_latest_remote_seen_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_uid IS DISTINCT FROM v_session.participant_1_id
     AND v_uid IS DISTINCT FROM v_session.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  v_previous_remote_seen_at := CASE
    WHEN v_uid = v_session.participant_1_id THEN v_session.participant_1_remote_seen_at
    ELSE v_session.participant_2_remote_seen_at
  END;

  IF v_uid = v_session.participant_1_id THEN
    UPDATE public.video_sessions
    SET
      participant_1_remote_seen_at = GREATEST(COALESCE(participant_1_remote_seen_at, v_now), v_now),
      state_updated_at = CASE WHEN ended_at IS NULL THEN v_now ELSE state_updated_at END
    WHERE id = p_session_id
    RETURNING * INTO v_session;
    v_latest_remote_seen_at := v_session.participant_1_remote_seen_at;
  ELSE
    UPDATE public.video_sessions
    SET
      participant_2_remote_seen_at = GREATEST(COALESCE(participant_2_remote_seen_at, v_now), v_now),
      state_updated_at = CASE WHEN ended_at IS NULL THEN v_now ELSE state_updated_at END
    WHERE id = p_session_id
    RETURNING * INTO v_session;
    v_latest_remote_seen_at := v_session.participant_2_remote_seen_at;
  END IF;

  IF public.video_date_session_is_post_date_survey_eligible_v2(
    v_session.ended_at,
    v_session.ended_reason,
    v_session.date_started_at,
    v_session.state::text,
    v_session.phase,
    v_session.participant_1_joined_at,
    v_session.participant_2_joined_at,
    v_session.participant_1_remote_seen_at,
    v_session.participant_2_remote_seen_at
  ) THEN
    UPDATE public.event_registrations
    SET
      queue_status = 'in_survey',
      current_room_id = p_session_id,
      current_partner_id = CASE
        WHEN profile_id = v_session.participant_1_id THEN v_session.participant_2_id
        ELSE v_session.participant_1_id
      END,
      last_active_at = v_now
    WHERE event_id = v_session.event_id
      AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
      AND (
        current_room_id IS NULL
        OR current_room_id = p_session_id
      )
      AND (
        NOT EXISTS (
          SELECT 1
          FROM public.date_feedback df1
          WHERE df1.session_id = p_session_id
            AND df1.user_id = v_session.participant_1_id
        )
        OR NOT EXISTS (
          SELECT 1
          FROM public.date_feedback df2
          WHERE df2.session_id = p_session_id
            AND df2.user_id = v_session.participant_2_id
        )
      )
      AND NOT public.is_blocked(v_session.participant_1_id, v_session.participant_2_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_reports ur
        WHERE (ur.reporter_id = v_session.participant_1_id AND ur.reported_id = v_session.participant_2_id)
           OR (ur.reporter_id = v_session.participant_2_id AND ur.reported_id = v_session.participant_1_id)
      );
  END IF;

  PERFORM public.record_event_loop_observability(
    'video_date_transition',
    'success',
    'remote_video_seen',
    NULL,
    v_session.event_id,
    v_uid,
    p_session_id,
    jsonb_build_object(
      'participant_1_joined_at', v_session.participant_1_joined_at,
      'participant_2_joined_at', v_session.participant_2_joined_at,
      'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
      'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
      'latest_remote_seen_at', v_latest_remote_seen_at,
      'previous_remote_seen_at', v_previous_remote_seen_at,
      'remote_seen_canonical_repaired', v_previous_remote_seen_at IS DISTINCT FROM v_latest_remote_seen_at,
      'confirmed_encounter', public.video_date_session_has_confirmed_encounter(
        v_session.date_started_at,
        v_session.state::text,
        v_session.phase,
        v_session.participant_1_joined_at,
        v_session.participant_2_joined_at,
        v_session.participant_1_remote_seen_at,
        v_session.participant_2_remote_seen_at
      )
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
    'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
    'latest_remote_seen_at', v_latest_remote_seen_at,
    'previous_remote_seen_at', v_previous_remote_seen_at,
    'remote_seen_canonical_repaired', v_previous_remote_seen_at IS DISTINCT FROM v_latest_remote_seen_at,
    'confirmed_encounter', public.video_date_session_has_confirmed_encounter(
      v_session.date_started_at,
      v_session.state::text,
      v_session.phase,
      v_session.participant_1_joined_at,
      v_session.participant_2_joined_at,
      v_session.participant_1_remote_seen_at,
      v_session.participant_2_remote_seen_at
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_video_date_remote_seen(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_remote_seen(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.mark_video_date_remote_seen(uuid) IS
  'Marks canonical remote-media evidence for a Video Date participant. This version advances the timestamp on every observation so reconnect expiry can use remote_seen as latest-state recovery proof.';

COMMIT;
