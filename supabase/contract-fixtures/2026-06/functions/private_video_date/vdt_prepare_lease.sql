CREATE OR REPLACE FUNCTION private_video_date.vdt_prepare_lease(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_session public.video_sessions%ROWTYPE;
  v_should_open_survey boolean := false;
BEGIN
  v_result := private_video_date.vdt_survey_continuity(
    p_session_id,
    p_action,
    p_reason
  );

  IF COALESCE(v_result->>'success', 'false') = 'true'
     AND v_result->>'state' = 'ended' THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND THEN
      v_should_open_survey := public.video_date_session_is_post_date_survey_eligible(
        v_session.ended_at,
        v_session.ended_reason,
        v_session.date_started_at,
        v_session.state::text,
        v_session.phase,
        v_session.participant_1_joined_at,
        v_session.participant_2_joined_at
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

        PERFORM public.record_event_loop_observability(
          'video_date_transition',
          'success',
          'terminal_encounter_survey_continuity_applied',
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
            'survey_required', true
          )
        );
      END IF;
    END IF;

    RETURN v_result || jsonb_build_object('survey_required', v_should_open_survey);
  END IF;

  RETURN v_result;
END;
$function$
