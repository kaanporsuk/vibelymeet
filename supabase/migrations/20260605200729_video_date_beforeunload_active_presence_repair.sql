BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.video_date_transition_20260605200729_lifecycle_base(uuid, text, text)') IS NULL
     AND to_regprocedure('public.video_date_transition(uuid, text, text)') IS NOT NULL THEN
    ALTER FUNCTION public.video_date_transition(uuid, text, text)
      RENAME TO video_date_transition_20260605200729_lifecycle_base;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.video_date_transition(
  p_session_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
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

  RETURN public.video_date_transition_20260605200729_lifecycle_base(
    p_session_id,
    p_action,
    p_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.video_date_transition(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.video_date_transition(uuid, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_transition(uuid, text, text) IS
  'Video Date transition wrapper. Suppresses browser/native lifecycle self-away while fresh Daily, remote-media, or video-date surface evidence proves the actor is still in the active date; explicit transport/background-timeout paths still delegate to the base transition.';

DO $$
BEGIN
  IF to_regprocedure('public.mark_video_date_remote_seen_20260605200729_grace_base(uuid)') IS NULL
     AND to_regprocedure('public.mark_video_date_remote_seen(uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.mark_video_date_remote_seen(uuid)
      RENAME TO mark_video_date_remote_seen_20260605200729_grace_base;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.mark_video_date_remote_seen(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_latest_away_at timestamptz;
  v_latest_remote_seen_at timestamptz;
  v_rows_changed integer := 0;
  v_message text;
  v_detail text;
  v_hint text;
  v_server_now_ms bigint;
BEGIN
  v_result := public.mark_video_date_remote_seen_20260605200729_grace_base(p_session_id);

  IF COALESCE(
       CASE WHEN jsonb_typeof(v_result->'ok') = 'boolean' THEN (v_result->>'ok')::boolean ELSE NULL END,
       false
     ) THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id
    FOR UPDATE;

    IF FOUND
       AND v_actor IS NOT NULL
       AND v_session.ended_at IS NULL
       AND v_session.reconnect_grace_ends_at IS NOT NULL
       AND (v_actor = v_session.participant_1_id OR v_actor = v_session.participant_2_id) THEN
      v_latest_away_at := GREATEST(
        COALESCE(v_session.participant_1_away_at, '-infinity'::timestamptz),
        COALESCE(v_session.participant_2_away_at, '-infinity'::timestamptz)
      );
      v_latest_remote_seen_at := GREATEST(
        COALESCE(v_session.participant_1_remote_seen_at, '-infinity'::timestamptz),
        COALESCE(v_session.participant_2_remote_seen_at, '-infinity'::timestamptz)
      );

      IF v_latest_away_at <> '-infinity'::timestamptz
         AND v_latest_remote_seen_at >= v_latest_away_at THEN
        UPDATE public.video_sessions
        SET
          participant_1_away_at = NULL,
          participant_2_away_at = NULL,
          reconnect_grace_ends_at = NULL,
          state_updated_at = v_now
        WHERE id = p_session_id
          AND reconnect_grace_ends_at IS NOT NULL;
        GET DIAGNOSTICS v_rows_changed = ROW_COUNT;
        IF v_rows_changed > 0 THEN
          PERFORM public.bump_video_session_seq(p_session_id);
          PERFORM public.record_event_loop_observability(
            'video_date_transition',
            'success',
            'reconnect_grace_cleared_by_remote_seen',
            NULL,
            v_session.event_id,
            v_actor,
            p_session_id,
            jsonb_build_object(
              'action', 'mark_video_date_remote_seen',
              'latest_away_at', v_latest_away_at,
              'latest_remote_seen_at', v_latest_remote_seen_at,
              'reconnect_grace_cleared', true
            )
          );
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN v_result || jsonb_build_object('reconnect_grace_cleared', v_rows_changed > 0);
EXCEPTION
  WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS
      v_message = MESSAGE_TEXT,
      v_detail = PG_EXCEPTION_DETAIL,
      v_hint = PG_EXCEPTION_HINT;
    v_server_now_ms := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
    RETURN jsonb_build_object(
      'ok', false,
      'success', false,
      'error', 'remote_seen_failed',
      'code', 'REMOTE_SEEN_FAILED',
      'error_code', 'REMOTE_SEEN_FAILED',
      'sqlstate', SQLSTATE,
      'message', v_message,
      'detail', NULLIF(v_detail, ''),
      'hint', NULLIF(v_hint, ''),
      'retryable', true,
      'retry_after_ms', 1500,
      'server_now_ms', v_server_now_ms,
      'serverNowMs', v_server_now_ms
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_video_date_remote_seen(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_video_date_remote_seen(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.mark_video_date_remote_seen(uuid) IS
  'Marks remote-media evidence through the existing base stack and clears reconnect grace when newer remote-media proof shows the pair recovered.';

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
  'Ends expired Video Date reconnect graces only after rechecking latest joined, remote-media, lifecycle reason, and video-date surface evidence. Browser lifecycle graces with fresh active evidence are cleared instead of terminalized.';

NOTIFY pgrst, 'reload schema';

COMMIT;
