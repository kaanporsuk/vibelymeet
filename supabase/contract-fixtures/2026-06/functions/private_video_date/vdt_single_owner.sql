CREATE OR REPLACE FUNCTION private_video_date.vdt_single_owner(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
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
  v_actor_joined_at timestamptz;
  v_actor_away_at timestamptz;
  v_actor_remote_seen_at timestamptz;
  v_surface_claim_at timestamptz;
  v_actor_active boolean := false;
  v_surface_active boolean := false;
  v_remote_seen_active boolean := false;
  v_rows_changed integer := 0;
BEGIN
  IF v_action = 'mark_reconnect_self_away'
     AND v_reason IN (
       'web_visibilitychange',
       'web_freeze',
       'web_beforeunload',
       'web_pagehide',
       'app_background'
     ) THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF FOUND
       AND v_actor IS NOT NULL
       AND v_session.ended_at IS NULL
       AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id)
       AND (
         v_session.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
         OR v_session.phase IN ('handshake', 'date')
         OR v_session.handshake_started_at IS NOT NULL
         OR v_session.date_started_at IS NOT NULL
       ) THEN
      v_actor_joined_at := CASE
        WHEN v_actor = v_session.participant_1_id THEN v_session.participant_1_joined_at
        ELSE v_session.participant_2_joined_at
      END;
      v_actor_away_at := CASE
        WHEN v_actor = v_session.participant_1_id THEN v_session.participant_1_away_at
        ELSE v_session.participant_2_away_at
      END;
      v_actor_remote_seen_at := CASE
        WHEN v_actor = v_session.participant_1_id THEN v_session.participant_1_remote_seen_at
        ELSE v_session.participant_2_remote_seen_at
      END;
      v_actor_active := public.video_date_latest_presence_is_active(v_actor_joined_at, v_actor_away_at);
      v_remote_seen_active :=
        v_actor_remote_seen_at IS NOT NULL
        AND (v_actor_away_at IS NULL OR v_actor_remote_seen_at >= v_actor_away_at);

      SELECT max(GREATEST(COALESCE(updated_at, claimed_at), claimed_at))
      INTO v_surface_claim_at
      FROM public.video_date_surface_claims
      WHERE session_id = p_session_id
        AND profile_id = v_actor
        AND surface = 'video_date'
        AND released_at IS NULL
        AND expires_at >= v_now - interval '2 seconds';

      v_surface_active := v_surface_claim_at IS NOT NULL;

      IF v_actor_active OR v_remote_seen_active OR v_surface_active THEN
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
            'actor_joined_at', v_actor_joined_at,
            'actor_away_at', v_actor_away_at,
            'actor_remote_seen_at', v_actor_remote_seen_at,
            'surface_claim_at', v_surface_claim_at,
            'active_by_joined_presence', v_actor_active,
            'active_by_remote_seen', v_remote_seen_active,
            'active_by_surface_claim', v_surface_active
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

  RETURN private_video_date.vdt_lifecycle_presence(
    p_session_id,
    p_action,
    p_reason
  );
END;
$function$
