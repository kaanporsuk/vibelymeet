CREATE OR REPLACE FUNCTION private_video_date.vdt_failsoft_base(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_session public.video_sessions%ROWTYPE;
  v_should_open_survey boolean := false;
  v_event_live boolean := false;
  v_resume_status text := 'idle';
BEGIN
  v_result := private_video_date.vdt_remote_seen(
    p_session_id,
    p_action,
    p_reason
  );

  IF COALESCE(v_result->>'success', 'false') = 'true'
     AND v_result->>'state' = 'date' THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND
       AND NOT public.video_date_session_has_confirmed_encounter(
         v_session.date_started_at,
         v_session.state::text,
         v_session.phase,
         v_session.participant_1_joined_at,
         v_session.participant_2_joined_at,
         v_session.participant_1_remote_seen_at,
         v_session.participant_2_remote_seen_at
       ) THEN
      RETURN public.end_unconfirmed_video_date_start(
        p_session_id,
        v_actor,
        'transition_' || COALESCE(NULLIF(p_action, ''), 'unknown'),
        p_reason
      );
    END IF;
  END IF;

  IF COALESCE(v_result->>'success', 'false') = 'true'
     AND v_result->>'state' = 'ended' THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND THEN
      v_should_open_survey := public.video_date_session_is_post_date_survey_eligible_v2(
        v_session.ended_at,
        v_session.ended_reason,
        v_session.date_started_at,
        v_session.state::text,
        v_session.phase,
        v_session.participant_1_joined_at,
        v_session.participant_2_joined_at,
        v_session.participant_1_remote_seen_at,
        v_session.participant_2_remote_seen_at
      );

      IF v_should_open_survey THEN
        UPDATE public.event_registrations
        SET
          queue_status = 'in_survey',
          current_room_id = p_session_id,
          current_partner_id = CASE
            WHEN profile_id = v_session.participant_1_id THEN v_session.participant_2_id
            ELSE v_session.participant_1_id
          END,
          last_active_at = now()
        WHERE event_id = v_session.event_id
          AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);
      ELSE
        SELECT EXISTS (
          SELECT 1
          FROM public.events ev
          WHERE ev.id = v_session.event_id
            AND ev.status = 'live'
            AND ev.archived_at IS NULL
        ) INTO v_event_live;
        v_resume_status := CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END;

        UPDATE public.event_registrations
        SET
          queue_status = v_resume_status,
          current_room_id = NULL,
          current_partner_id = NULL,
          last_active_at = now()
        WHERE event_id = v_session.event_id
          AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
          AND current_room_id = p_session_id;
      END IF;

      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'success',
        CASE WHEN v_should_open_survey THEN 'terminal_confirmed_encounter_survey' ELSE 'terminal_unconfirmed_encounter_no_survey' END,
        NULL,
        v_session.event_id,
        v_actor,
        p_session_id,
        jsonb_build_object(
          'action', p_action,
          'reason', p_reason,
          'ended_reason', v_session.ended_reason,
          'date_started_at', v_session.date_started_at,
          'participant_1_joined_at', v_session.participant_1_joined_at,
          'participant_2_joined_at', v_session.participant_2_joined_at,
          'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
          'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
          'survey_required', v_should_open_survey,
          'resume_status', CASE WHEN v_should_open_survey THEN 'in_survey' ELSE v_resume_status END
        )
      );
    END IF;

    RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object('survey_required', v_should_open_survey);
  END IF;

  RETURN v_result;
END;
$function$
