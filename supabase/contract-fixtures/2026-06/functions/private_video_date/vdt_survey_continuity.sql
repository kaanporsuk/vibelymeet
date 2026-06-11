CREATE OR REPLACE FUNCTION private_video_date.vdt_survey_continuity(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_due boolean := false;
BEGIN
  IF p_action = 'complete_handshake' THEN
    IF v_actor IS NULL THEN
      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'blocked',
        'unauthorized',
        NULL,
        NULL,
        NULL,
        p_session_id,
        jsonb_build_object('action', p_action, 'p_reason', p_reason)
      );
      RETURN jsonb_build_object('success', false, 'error', 'Unauthorized', 'code', 'UNAUTHORIZED');
    END IF;

    RETURN public.finalize_video_date_handshake_deadline(
      p_session_id,
      v_actor,
      'rpc_complete_handshake',
      p_reason
    );
  END IF;

  IF p_action IN ('vibe', 'pass') AND v_actor IS NOT NULL THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND
       AND v_session.ended_at IS NULL
       AND v_session.state = 'handshake'::public.video_date_state
       AND v_session.date_started_at IS NULL
       AND (v_session.participant_1_id = v_actor OR v_session.participant_2_id = v_actor)
       AND v_session.handshake_started_at IS NOT NULL THEN
      v_due := v_session.handshake_started_at + interval '60 seconds' <= now();

      IF v_due THEN
        RETURN public.finalize_video_date_handshake_deadline(
          p_session_id,
          v_actor,
          'late_' || p_action || '_after_handshake_deadline',
          p_reason
        );
      END IF;
    END IF;
  END IF;

  RETURN private_video_date.vdt_deadline(
    p_session_id,
    p_action,
    p_reason
  );
END;
$function$
