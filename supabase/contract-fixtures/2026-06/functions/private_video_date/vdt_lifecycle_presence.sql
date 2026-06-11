CREATE OR REPLACE FUNCTION private_video_date.vdt_lifecycle_presence(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_reason text := NULLIF(lower(btrim(COALESCE(p_reason, ''))), '');
  v_now timestamptz := clock_timestamp();
  v_session public.video_sessions%ROWTYPE;
  v_actor_active boolean := false;
  v_result jsonb;
  v_rows_changed integer := 0;
BEGIN
  IF v_action = 'mark_reconnect_self_away'
     AND v_reason IN ('web_visibilitychange', 'web_freeze', 'app_background') THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF FOUND
       AND v_actor IS NOT NULL
       AND v_session.ended_at IS NULL
       AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id) THEN
      v_actor_active := CASE
        WHEN v_actor = v_session.participant_1_id THEN
          public.video_date_latest_presence_is_active(v_session.participant_1_joined_at, v_session.participant_1_away_at)
        ELSE
          public.video_date_latest_presence_is_active(v_session.participant_2_joined_at, v_session.participant_2_away_at)
      END;

      IF v_actor_active THEN
        IF v_actor = v_session.participant_1_id THEN
          UPDATE public.video_sessions
          SET
            participant_1_away_at = NULL,
            reconnect_grace_ends_at = NULL,
            state_updated_at = v_now
          WHERE id = p_session_id
            AND (participant_1_away_at IS NOT NULL OR reconnect_grace_ends_at IS NOT NULL);
        ELSE
          UPDATE public.video_sessions
          SET
            participant_2_away_at = NULL,
            reconnect_grace_ends_at = NULL,
            state_updated_at = v_now
          WHERE id = p_session_id
            AND (participant_2_away_at IS NOT NULL OR reconnect_grace_ends_at IS NOT NULL);
        END IF;
        GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
        IF v_rows_changed > 0 THEN
          PERFORM public.bump_video_session_seq(p_session_id);
        END IF;

        PERFORM public.record_event_loop_observability(
          'video_date_transition',
          'no_op',
          'mark_reconnect_self_away_suppressed_active_daily_presence',
          NULL,
          v_session.event_id,
          v_actor,
          p_session_id,
          jsonb_build_object(
            'action', v_action,
            'p_reason', v_reason,
            'away_mark_suppressed', true,
            'reconnect_grace_cleared', v_rows_changed > 0,
            'participant_1_joined_at', v_session.participant_1_joined_at,
            'participant_1_away_at', v_session.participant_1_away_at,
            'participant_2_joined_at', v_session.participant_2_joined_at,
            'participant_2_away_at', v_session.participant_2_away_at
          )
        );

        RETURN jsonb_build_object(
          'ok', true,
          'success', true,
          'state', v_session.state,
          'phase', v_session.phase,
          'ended', false,
          'self_marked_away', false,
          'away_mark_suppressed', true,
          'suppression_reason', 'active_daily_presence',
          'reconnect_grace_cleared', v_rows_changed > 0,
          'p_reason', v_reason
        );
      END IF;
    END IF;
  END IF;

  v_result := private_video_date.vdt_latest_presence(
    p_session_id,
    p_action,
    p_reason
  );

  IF v_action = 'mark_reconnect_return'
     AND COALESCE((v_result->>'ok')::boolean, true) THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF FOUND
       AND v_actor IS NOT NULL
       AND v_session.ended_at IS NULL
       AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id) THEN
      IF v_actor = v_session.participant_1_id THEN
        UPDATE public.video_sessions
        SET
          participant_1_away_at = NULL,
          reconnect_grace_ends_at = NULL,
          state_updated_at = v_now
        WHERE id = p_session_id
          AND (participant_1_away_at IS NOT NULL OR reconnect_grace_ends_at IS NOT NULL);
      ELSE
        UPDATE public.video_sessions
        SET
          participant_2_away_at = NULL,
          reconnect_grace_ends_at = NULL,
          state_updated_at = v_now
        WHERE id = p_session_id
          AND (participant_2_away_at IS NOT NULL OR reconnect_grace_ends_at IS NOT NULL);
      END IF;
      GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
      IF v_rows_changed > 0 THEN
        PERFORM public.bump_video_session_seq(p_session_id);
        PERFORM public.record_event_loop_observability(
          'video_date_transition',
          'success',
          'reconnect_grace_cleared_by_return',
          NULL,
          v_session.event_id,
          v_actor,
          p_session_id,
          jsonb_build_object(
            'action', v_action,
            'p_reason', v_reason,
            'reconnect_grace_cleared', true
          )
        );
      END IF;
      v_result := v_result || jsonb_build_object('reconnect_grace_cleared', v_rows_changed > 0);
    END IF;
  END IF;

  RETURN v_result;
END;
$function$
