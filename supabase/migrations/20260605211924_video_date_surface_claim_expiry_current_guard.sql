CREATE OR REPLACE FUNCTION public.expire_video_date_reconnect_graces()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := now();
  r public.video_sessions%ROWTYPE;
  n int := 0;
  v_event_live boolean := false;
  v_resume_status text := 'idle';
  v_should_open_survey boolean := false;
  v_participant_1_active boolean := false;
  v_participant_2_active boolean := false;
  v_latest_away_at timestamptz;
  v_latest_away_reason text;
  v_lifecycle_away boolean := false;
  v_remote_seen_after_away boolean := false;
  v_join_after_away boolean := false;
  v_surface_active_near_away boolean := false;
  v_recent_lifecycle_media boolean := false;
BEGIN
  FOR r IN
    SELECT *
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND reconnect_grace_ends_at IS NOT NULL
      AND reconnect_grace_ends_at <= v_now
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    v_participant_1_active := public.video_date_latest_presence_is_active(
      r.participant_1_joined_at,
      r.participant_1_away_at
    );
    v_participant_2_active := public.video_date_latest_presence_is_active(
      r.participant_2_joined_at,
      r.participant_2_away_at
    );
    v_latest_away_at := GREATEST(
      COALESCE(r.participant_1_away_at, '-infinity'::timestamptz),
      COALESCE(r.participant_2_away_at, '-infinity'::timestamptz)
    );

    SELECT lower(NULLIF(COALESCE(e.detail->>'reason', e.detail->>'p_reason'), ''))
    INTO v_latest_away_reason
    FROM public.event_loop_observability_events e
    WHERE e.session_id = r.id
      AND e.operation = 'video_date_transition'
      AND e.reason_code = 'mark_reconnect_self_away'
    ORDER BY e.created_at DESC
    LIMIT 1;

    v_lifecycle_away := v_latest_away_reason IN (
      'web_visibilitychange',
      'web_freeze',
      'web_beforeunload',
      'web_pagehide',
      'app_background'
    );

    v_join_after_away :=
      v_latest_away_at <> '-infinity'::timestamptz
      AND GREATEST(
        COALESCE(r.participant_1_joined_at, '-infinity'::timestamptz),
        COALESCE(r.participant_2_joined_at, '-infinity'::timestamptz)
      ) > v_latest_away_at;

    v_remote_seen_after_away :=
      r.participant_1_remote_seen_at IS NOT NULL
      AND r.participant_2_remote_seen_at IS NOT NULL
      AND v_latest_away_at <> '-infinity'::timestamptz
      AND GREATEST(r.participant_1_remote_seen_at, r.participant_2_remote_seen_at) > v_latest_away_at;

    v_recent_lifecycle_media :=
      v_lifecycle_away
      AND r.participant_1_remote_seen_at IS NOT NULL
      AND r.participant_2_remote_seen_at IS NOT NULL
      AND v_latest_away_at <> '-infinity'::timestamptz
      AND GREATEST(r.participant_1_remote_seen_at, r.participant_2_remote_seen_at) >= v_latest_away_at - interval '30 seconds';

    SELECT EXISTS (
      SELECT 1
      FROM public.video_date_surface_claims c
      WHERE c.session_id = r.id
        AND c.profile_id IN (r.participant_1_id, r.participant_2_id)
        AND c.surface = 'video_date'
        AND c.released_at IS NULL
        AND v_latest_away_at <> '-infinity'::timestamptz
        AND c.expires_at >= v_latest_away_at
        AND c.expires_at >= v_now
        AND GREATEST(COALESCE(c.updated_at, c.claimed_at), c.claimed_at) >= v_latest_away_at - interval '20 seconds'
    )
    INTO v_surface_active_near_away;

    IF (v_participant_1_active AND v_participant_2_active)
       OR v_remote_seen_after_away
       OR v_join_after_away
       OR (v_lifecycle_away AND (v_surface_active_near_away OR v_recent_lifecycle_media)) THEN
      UPDATE public.video_sessions
      SET
        reconnect_grace_ends_at = NULL,
        participant_1_away_at = CASE
          WHEN v_participant_1_active OR v_remote_seen_after_away OR v_join_after_away OR v_lifecycle_away THEN NULL
          ELSE participant_1_away_at
        END,
        participant_2_away_at = CASE
          WHEN v_participant_2_active OR v_remote_seen_after_away OR v_join_after_away OR v_lifecycle_away THEN NULL
          ELSE participant_2_away_at
        END,
        state_updated_at = v_now
      WHERE id = r.id;

      PERFORM public.bump_video_session_seq(r.id);
      PERFORM public.record_event_loop_observability(
        'expire_video_date_reconnect_graces',
        'no_op',
        'reconnect_grace_expiry_suppressed_latest_presence',
        NULL,
        r.event_id,
        NULL,
        r.id,
        jsonb_build_object(
          'participant_1_active', v_participant_1_active,
          'participant_2_active', v_participant_2_active,
          'remote_seen_after_away', v_remote_seen_after_away,
          'join_after_away', v_join_after_away,
          'surface_active_near_away', v_surface_active_near_away,
          'recent_lifecycle_media', v_recent_lifecycle_media,
          'latest_away_reason', v_latest_away_reason,
          'participant_1_joined_at', r.participant_1_joined_at,
          'participant_2_joined_at', r.participant_2_joined_at,
          'participant_1_away_at', r.participant_1_away_at,
          'participant_2_away_at', r.participant_2_away_at,
          'participant_1_remote_seen_at', r.participant_1_remote_seen_at,
          'participant_2_remote_seen_at', r.participant_2_remote_seen_at
        )
      );
      CONTINUE;
    END IF;

    v_should_open_survey := public.video_date_session_is_post_date_survey_eligible_v2(
      v_now,
      'reconnect_grace_expired',
      r.date_started_at,
      r.state::text,
      r.phase,
      r.participant_1_joined_at,
      r.participant_2_joined_at,
      r.participant_1_remote_seen_at,
      r.participant_2_remote_seen_at
    );

    SELECT EXISTS (
      SELECT 1
      FROM public.events ev
      WHERE ev.id = r.event_id
        AND ev.status = 'live'
        AND ev.archived_at IS NULL
    ) INTO v_event_live;

    v_resume_status := CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END;

    UPDATE public.video_sessions
    SET
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'reconnect_grace_expired',
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        r.duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(r.started_at, v_now))))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id;

    UPDATE public.event_registrations
    SET
      queue_status = CASE WHEN v_should_open_survey THEN 'in_survey' ELSE v_resume_status END,
      current_room_id = CASE WHEN v_should_open_survey THEN r.id ELSE NULL END,
      current_partner_id = CASE
        WHEN v_should_open_survey AND profile_id = r.participant_1_id THEN r.participant_2_id
        WHEN v_should_open_survey AND profile_id = r.participant_2_id THEN r.participant_1_id
        ELSE NULL
      END,
      last_active_at = v_now
    WHERE event_id = r.event_id
      AND profile_id IN (r.participant_1_id, r.participant_2_id);

    PERFORM public.record_event_loop_observability(
      'expire_video_date_reconnect_graces',
      'success',
      CASE WHEN v_should_open_survey THEN 'terminal_confirmed_encounter_survey' ELSE 'terminal_unconfirmed_encounter_no_survey' END,
      NULL,
      r.event_id,
      NULL,
      r.id,
      jsonb_build_object(
        'ended_reason', 'reconnect_grace_expired',
        'survey_required', v_should_open_survey,
        'resume_status', CASE WHEN v_should_open_survey THEN 'in_survey' ELSE v_resume_status END,
        'latest_away_reason', v_latest_away_reason,
        'participant_1_joined_at', r.participant_1_joined_at,
        'participant_2_joined_at', r.participant_2_joined_at,
        'participant_1_remote_seen_at', r.participant_1_remote_seen_at,
        'participant_2_remote_seen_at', r.participant_2_remote_seen_at
      )
    );

    n := n + 1;
  END LOOP;

  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_video_date_reconnect_graces()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.expire_video_date_reconnect_graces() IS
  'Ends expired Video Date reconnect graces only after rechecking latest joined, remote-media, lifecycle reason, and current unexpired video-date surface evidence. Browser/native lifecycle graces with fresh active evidence are cleared instead of terminalized.';

NOTIFY pgrst, 'reload schema';
