CREATE OR REPLACE FUNCTION private_video_date.vdt_latest_presence(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text)
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
  v_warmup_window interval := interval '20 seconds';
  v_session public.video_sessions%ROWTYPE;
  v_recent_remote_seen boolean := false;
  v_recent_joined boolean := false;
  v_recent_handshake boolean := false;
  v_warmup_state boolean := false;
BEGIN
  IF v_action = 'mark_reconnect_partner_away'
     AND COALESCE(v_reason, '') <> 'daily_transport_grace_expired' THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF FOUND
       AND v_actor IS NOT NULL
       AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id)
       AND v_session.ended_at IS NULL THEN
      v_recent_remote_seen :=
        v_session.participant_1_remote_seen_at IS NOT NULL
        AND v_session.participant_2_remote_seen_at IS NOT NULL
        AND GREATEST(
          v_session.participant_1_remote_seen_at,
          v_session.participant_2_remote_seen_at
        ) >= v_now - v_warmup_window;

      v_recent_joined :=
        v_session.participant_1_joined_at IS NOT NULL
        AND v_session.participant_2_joined_at IS NOT NULL
        AND GREATEST(
          v_session.participant_1_joined_at,
          v_session.participant_2_joined_at
        ) >= v_now - v_warmup_window;

      v_recent_handshake :=
        v_session.handshake_started_at IS NOT NULL
        AND v_session.handshake_started_at >= v_now - v_warmup_window;

      v_warmup_state :=
        v_session.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
        OR COALESCE(v_session.phase, '') IN ('handshake', 'date')
        OR v_session.handshake_started_at IS NOT NULL
        OR v_session.date_started_at IS NOT NULL;

      IF v_warmup_state
         AND (v_recent_remote_seen OR v_recent_joined OR v_recent_handshake) THEN
        BEGIN
          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'no_op',
            'mark_reconnect_partner_away_suppressed_transport_grace_pending',
            NULL,
            v_session.event_id,
            v_actor,
            p_session_id,
            jsonb_build_object(
              'action', v_action,
              'p_reason', v_reason,
              'away_mark_suppressed', true,
              'daily_transport_grace_required', true,
              'warmup_window_seconds', extract(epoch from v_warmup_window)::integer,
              'participant_1_joined_at', v_session.participant_1_joined_at,
              'participant_2_joined_at', v_session.participant_2_joined_at,
              'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
              'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
              'handshake_started_at', v_session.handshake_started_at
            )
          );
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;

        RETURN jsonb_build_object(
          'ok', true,
          'success', true,
          'state', v_session.state,
          'phase', v_session.phase,
          'ended', false,
          'partner_marked_away', false,
          'away_mark_suppressed', true,
          'suppression_reason', 'daily_transport_grace_required',
          'daily_transport_grace_required', true,
          'p_reason', v_reason,
          'participant_1_joined_at', v_session.participant_1_joined_at,
          'participant_2_joined_at', v_session.participant_2_joined_at,
          'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
          'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
          'handshake_started_at', v_session.handshake_started_at
        );
      END IF;
    END IF;
  END IF;

  RETURN private_video_date.vdt_warmup_stability(
    p_session_id,
    p_action,
    p_reason
  );
END;
$function$
