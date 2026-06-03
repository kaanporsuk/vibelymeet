-- Video Date remote-seen encounter guard.
--
-- A local Daily join is not enough to prove that a date actually happened.
-- Persist the first remote video evidence from both clients and require that
-- bilateral evidence before opening Vibe/Pass for warm-up endings.

BEGIN;

ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS participant_1_remote_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS participant_2_remote_seen_at timestamptz;

COMMENT ON COLUMN public.video_sessions.participant_1_remote_seen_at IS
  'First server-stamped time participant 1 reported visible remote date media.';
COMMENT ON COLUMN public.video_sessions.participant_2_remote_seen_at IS
  'First server-stamped time participant 2 reported visible remote date media.';

CREATE OR REPLACE FUNCTION public.video_date_session_has_confirmed_encounter(
  p_date_started_at timestamptz,
  p_state text,
  p_phase text,
  p_participant_1_joined_at timestamptz,
  p_participant_2_joined_at timestamptz,
  p_participant_1_remote_seen_at timestamptz,
  p_participant_2_remote_seen_at timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_participant_1_remote_seen_at IS NOT NULL
    AND p_participant_2_remote_seen_at IS NOT NULL
    AND (
      p_date_started_at IS NOT NULL
      OR (
        p_participant_1_joined_at IS NOT NULL
        AND p_participant_2_joined_at IS NOT NULL
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.video_date_session_has_confirmed_encounter(
  timestamptz,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_session_has_confirmed_encounter(
  timestamptz,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.video_date_session_is_post_date_survey_eligible_v2(
  p_ended_at timestamptz,
  p_ended_reason text,
  p_date_started_at timestamptz,
  p_state text,
  p_phase text,
  p_participant_1_joined_at timestamptz,
  p_participant_2_joined_at timestamptz,
  p_participant_1_remote_seen_at timestamptz,
  p_participant_2_remote_seen_at timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_ended_at IS NOT NULL
    AND public.video_date_session_has_confirmed_encounter(
      p_date_started_at,
      p_state,
      p_phase,
      p_participant_1_joined_at,
      p_participant_2_joined_at,
      p_participant_1_remote_seen_at,
      p_participant_2_remote_seen_at
    )
    AND COALESCE(p_ended_reason, '') NOT IN (
      'ready_gate_forfeit',
      'ready_gate_expired',
      'queued_ttl_expired',
      'handshake_grace_expired',
      'partial_join_peer_timeout',
      'peer_missing_timeout',
      'prepare_entry_daily_join_missing',
      'blocked_pair',
      'blocked_or_reported_pair'
    );
$function$;

REVOKE ALL ON FUNCTION public.video_date_session_is_post_date_survey_eligible_v2(
  timestamptz,
  text,
  timestamptz,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_session_is_post_date_survey_eligible_v2(
  timestamptz,
  text,
  timestamptz,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  timestamptz
) TO service_role;

CREATE OR REPLACE FUNCTION public.video_date_pair_has_terminal_encounter(
  p_event_id uuid,
  p_user_a uuid,
  p_user_b uuid,
  p_exclude_session_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.video_sessions vs
    WHERE vs.event_id = p_event_id
      AND vs.participant_1_id = LEAST(p_user_a, p_user_b)
      AND vs.participant_2_id = GREATEST(p_user_a, p_user_b)
      AND (p_exclude_session_id IS NULL OR vs.id <> p_exclude_session_id)
      AND public.video_date_session_is_post_date_survey_eligible_v2(
        vs.ended_at,
        vs.ended_reason,
        vs.date_started_at,
        vs.state::text,
        vs.phase,
        vs.participant_1_joined_at,
        vs.participant_2_joined_at,
        vs.participant_1_remote_seen_at,
        vs.participant_2_remote_seen_at
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.video_date_pair_has_terminal_encounter(uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_pair_has_terminal_encounter(uuid, uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.mark_video_date_remote_seen(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
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

  IF v_uid = v_session.participant_1_id THEN
    UPDATE public.video_sessions
    SET
      participant_1_remote_seen_at = COALESCE(participant_1_remote_seen_at, v_now),
      state_updated_at = CASE WHEN ended_at IS NULL THEN v_now ELSE state_updated_at END
    WHERE id = p_session_id
    RETURNING * INTO v_session;
  ELSE
    UPDATE public.video_sessions
    SET
      participant_2_remote_seen_at = COALESCE(participant_2_remote_seen_at, v_now),
      state_updated_at = CASE WHEN ended_at IS NULL THEN v_now ELSE state_updated_at END
    WHERE id = p_session_id
    RETURNING * INTO v_session;
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

REVOKE ALL ON FUNCTION public.mark_video_date_remote_seen(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_video_date_remote_seen(uuid) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_video_sessions_p1_remote_seen_pending_survey
  ON public.video_sessions(participant_1_id, ended_at DESC)
  WHERE ended_at IS NOT NULL
    AND participant_1_remote_seen_at IS NOT NULL
    AND participant_2_remote_seen_at IS NOT NULL
    AND (
      date_started_at IS NOT NULL
      OR (
        participant_1_joined_at IS NOT NULL
        AND participant_2_joined_at IS NOT NULL
      )
    );

CREATE INDEX IF NOT EXISTS idx_video_sessions_p2_remote_seen_pending_survey
  ON public.video_sessions(participant_2_id, ended_at DESC)
  WHERE ended_at IS NOT NULL
    AND participant_1_remote_seen_at IS NOT NULL
    AND participant_2_remote_seen_at IS NOT NULL
    AND (
      date_started_at IS NOT NULL
      OR (
        participant_1_joined_at IS NOT NULL
        AND participant_2_joined_at IS NOT NULL
      )
    );

CREATE INDEX IF NOT EXISTS idx_video_sessions_terminal_confirmed_pair_lookup
  ON public.video_sessions(event_id, participant_1_id, participant_2_id, ended_at DESC)
  WHERE ended_at IS NOT NULL
    AND participant_1_remote_seen_at IS NOT NULL
    AND participant_2_remote_seen_at IS NOT NULL
    AND (
      date_started_at IS NOT NULL
      OR (
        participant_1_joined_at IS NOT NULL
        AND participant_2_joined_at IS NOT NULL
      )
    );

CREATE OR REPLACE FUNCTION public.end_unconfirmed_video_date_start(
  p_session_id uuid,
  p_actor uuid DEFAULT NULL,
  p_source text DEFAULT 'unconfirmed_remote_video',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_session public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_event_live boolean := false;
  v_resume_status text := 'idle';
BEGIN
  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'state', 'ended',
      'reason', 'partial_join_peer_timeout',
      'survey_required', false,
      'error', 'session_not_found'
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.events ev
    WHERE ev.id = v_session.event_id
      AND ev.status = 'live'
      AND ev.archived_at IS NULL
  ) INTO v_event_live;
  v_resume_status := CASE WHEN v_event_live THEN 'browsing' ELSE 'idle' END;

  IF v_session.ended_at IS NULL THEN
    UPDATE public.video_sessions
    SET
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'partial_join_peer_timeout',
      date_started_at = NULL,
      handshake_grace_expires_at = NULL,
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(date_started_at, handshake_started_at, started_at))))::int)
      ),
      state_updated_at = v_now
    WHERE id = p_session_id
    RETURNING * INTO v_session;
  END IF;

  UPDATE public.event_registrations
  SET
    queue_status = v_resume_status,
    current_room_id = NULL,
    current_partner_id = NULL,
    last_active_at = v_now
  WHERE event_id = v_session.event_id
    AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id)
    AND (
      current_room_id = p_session_id
      OR current_room_id IS NULL
    );

  PERFORM public.record_event_loop_observability(
    'video_date_transition',
    'success',
    'unconfirmed_remote_video_terminalized',
    NULL,
    v_session.event_id,
    p_actor,
    p_session_id,
    jsonb_build_object(
      'source', p_source,
      'reason', p_reason,
      'ended_reason', v_session.ended_reason,
      'date_started_at_cleared', true,
      'participant_1_joined_at', v_session.participant_1_joined_at,
      'participant_2_joined_at', v_session.participant_2_joined_at,
      'participant_1_remote_seen_at', v_session.participant_1_remote_seen_at,
      'participant_2_remote_seen_at', v_session.participant_2_remote_seen_at,
      'survey_required', false,
      'resume_status', v_resume_status
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'state', 'ended',
    'reason', 'partial_join_peer_timeout',
    'ended_reason', 'partial_join_peer_timeout',
    'survey_required', false,
    'unconfirmed_remote_video', true,
    'resume_status', v_resume_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.end_unconfirmed_video_date_start(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.end_unconfirmed_video_date_start(uuid, uuid, text, text)
  TO service_role;

DROP FUNCTION IF EXISTS public.video_date_transition_20260603090000_remote_seen_base(uuid, text, text);

ALTER FUNCTION public.video_date_transition(uuid, text, text)
  RENAME TO video_date_transition_20260603090000_remote_seen_base;

REVOKE ALL ON FUNCTION public.video_date_transition_20260603090000_remote_seen_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_transition_20260603090000_remote_seen_base(uuid, text, text)
  TO service_role;

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
  v_result jsonb;
  v_session public.video_sessions%ROWTYPE;
  v_should_open_survey boolean := false;
  v_event_live boolean := false;
  v_resume_status text := 'idle';
BEGIN
  v_result := public.video_date_transition_20260603090000_remote_seen_base(
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
$function$;

REVOKE ALL ON FUNCTION public.video_date_transition(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_date_transition(uuid, text, text)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.finalize_vd_handshake_deadline_20260603090000_base(uuid, uuid, text, text);

ALTER FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text)
  RENAME TO finalize_vd_handshake_deadline_20260603090000_base;

REVOKE ALL ON FUNCTION public.finalize_vd_handshake_deadline_20260603090000_base(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_vd_handshake_deadline_20260603090000_base(uuid, uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_video_date_handshake_deadline(
  p_session_id uuid,
  p_actor uuid DEFAULT NULL,
  p_source text DEFAULT 'manual',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_result jsonb;
  v_session public.video_sessions%ROWTYPE;
  v_should_open_survey boolean := false;
  v_event_live boolean := false;
  v_resume_status text := 'idle';
BEGIN
  v_result := public.finalize_vd_handshake_deadline_20260603090000_base(
    p_session_id,
    p_actor,
    p_source,
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
        p_actor,
        'deadline_' || COALESCE(NULLIF(p_source, ''), 'unknown'),
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
          AND (current_room_id = p_session_id OR current_room_id IS NULL);
      END IF;

      PERFORM public.record_event_loop_observability(
        'video_date_transition',
        'success',
        CASE WHEN v_should_open_survey THEN 'deadline_confirmed_encounter_survey' ELSE 'deadline_unconfirmed_encounter_no_survey' END,
        NULL,
        v_session.event_id,
        p_actor,
        p_session_id,
        jsonb_build_object(
          'source', p_source,
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
$function$;

REVOKE ALL ON FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text)
  TO service_role;

DROP FUNCTION IF EXISTS public.video_session_continue_handshake_v2_20260603090000_remote_seen_base(uuid, text, text);

ALTER FUNCTION public.video_session_continue_handshake_v2(uuid, text, text)
  RENAME TO video_session_continue_handshake_v2_20260603090000_remote_seen_base;

REVOKE ALL ON FUNCTION public.video_session_continue_handshake_v2_20260603090000_remote_seen_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_session_continue_handshake_v2_20260603090000_remote_seen_base(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.video_session_continue_handshake_v2(
  p_session_id uuid,
  p_idempotency_key text DEFAULT NULL,
  p_request_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_session public.video_sessions%ROWTYPE;
  v_success boolean := false;
  v_survey_required boolean := false;
BEGIN
  v_result := public.video_session_continue_handshake_v2_20260603090000_remote_seen_base(
    p_session_id,
    p_idempotency_key,
    p_request_hash
  );

  v_success := COALESCE(
    CASE WHEN jsonb_typeof(v_result->'success') = 'boolean' THEN (v_result->>'success')::boolean ELSE NULL END,
    CASE WHEN jsonb_typeof(v_result->'ok') = 'boolean' THEN (v_result->>'ok')::boolean ELSE NULL END,
    false
  );

  IF v_success AND v_result->>'state' = 'date' THEN
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
        'video_session_continue_handshake_v2',
        COALESCE(NULLIF(v_result->>'reason', ''), p_request_hash)
      );
    END IF;
  END IF;

  IF v_success AND v_result->>'state' = 'ended' THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND THEN
      v_survey_required := public.video_date_session_is_post_date_survey_eligible_v2(
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
      RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object('survey_required', v_survey_required);
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_continue_handshake_v2(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_session_continue_handshake_v2(uuid, text, text)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.video_session_handshake_auto_promote_v2_20260603090000_remote_seen_base(uuid, text, text);

ALTER FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text)
  RENAME TO video_session_handshake_auto_promote_v2_20260603090000_remote_seen_base;

REVOKE ALL ON FUNCTION public.video_session_handshake_auto_promote_v2_20260603090000_remote_seen_base(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_session_handshake_auto_promote_v2_20260603090000_remote_seen_base(uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.video_session_handshake_auto_promote_v2(
  p_session_id uuid,
  p_idempotency_key text DEFAULT NULL,
  p_request_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_result jsonb;
  v_session public.video_sessions%ROWTYPE;
  v_success boolean := false;
  v_survey_required boolean := false;
BEGIN
  v_result := public.video_session_handshake_auto_promote_v2_20260603090000_remote_seen_base(
    p_session_id,
    p_idempotency_key,
    p_request_hash
  );

  v_success := COALESCE(
    CASE WHEN jsonb_typeof(v_result->'success') = 'boolean' THEN (v_result->>'success')::boolean ELSE NULL END,
    CASE WHEN jsonb_typeof(v_result->'ok') = 'boolean' THEN (v_result->>'ok')::boolean ELSE NULL END,
    false
  );

  IF v_success AND v_result->>'state' = 'date' THEN
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
        'video_session_handshake_auto_promote_v2',
        COALESCE(NULLIF(v_result->>'reason', ''), p_request_hash)
      );
    END IF;
  END IF;

  IF v_success AND v_result->>'state' = 'ended' THEN
    SELECT *
    INTO v_session
    FROM public.video_sessions
    WHERE id = p_session_id;

    IF FOUND THEN
      v_survey_required := public.video_date_session_is_post_date_survey_eligible_v2(
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
      RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object('survey_required', v_survey_required);
    END IF;
  END IF;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.video_session_handshake_auto_promote_v2(uuid, text, text)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.submit_post_date_verdict_20260603090000_remote_seen_base(uuid, boolean);

ALTER FUNCTION public.submit_post_date_verdict(uuid, boolean)
  RENAME TO submit_post_date_verdict_20260603090000_remote_seen_base;

REVOKE ALL ON FUNCTION public.submit_post_date_verdict_20260603090000_remote_seen_base(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_post_date_verdict_20260603090000_remote_seen_base(uuid, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.submit_post_date_verdict(p_session_id uuid, p_liked boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_uid
     AND v_session.participant_2_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_participant');
  END IF;

  IF NOT public.video_date_session_is_post_date_survey_eligible_v2(
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
    RETURN jsonb_build_object(
      'success', false,
      'error', 'session_not_survey_eligible',
      'code', 'session_not_survey_eligible',
      'verdict_recorded', false
    );
  END IF;

  RETURN public.submit_post_date_verdict_20260603090000_remote_seen_base(p_session_id, p_liked);
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_post_date_verdict(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_post_date_verdict(uuid, boolean)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_video_date_snapshot_core(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_phase text;
  v_started_at timestamptz;
  v_deadline_row_at timestamptz;
  v_computed_deadline_at timestamptz;
  v_deadline_at timestamptz;
  v_allowed text[] := ARRAY[]::text[];
  v_confirmed_encounter boolean := false;
  v_survey_required boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_not_found');
  END IF;

  IF v_uid IS DISTINCT FROM v_session.participant_1_id
     AND v_uid IS DISTINCT FROM v_session.participant_2_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant');
  END IF;

  v_phase := CASE
    WHEN v_session.ended_at IS NOT NULL OR v_session.state::text = 'ended' THEN 'ended'
    WHEN v_session.date_started_at IS NOT NULL OR v_session.state::text = 'date' THEN 'date'
    WHEN v_session.handshake_started_at IS NOT NULL OR v_session.state::text = 'handshake' THEN 'handshake'
    WHEN v_session.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
      OR v_session.state::text = 'ready_gate' THEN 'ready_gate'
    WHEN v_session.ready_gate_status = 'queued' THEN 'queued'
    WHEN NULLIF(v_session.phase, '') IN ('queued', 'ready_gate', 'handshake', 'date', 'verdict', 'ended')
      THEN v_session.phase
    ELSE COALESCE(v_session.state::text, 'queued')
  END;

  v_started_at := CASE
    WHEN v_phase = 'ready_gate' THEN COALESCE(v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'handshake' THEN COALESCE(v_session.handshake_started_at, v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'date' THEN COALESCE(v_session.date_started_at, v_session.state_updated_at, v_session.started_at)
    WHEN v_phase = 'ended' THEN COALESCE(v_session.ended_at, v_session.state_updated_at, v_session.started_at)
    ELSE COALESCE(v_session.started_at, v_session.state_updated_at)
  END;

  SELECT due_at
  INTO v_deadline_row_at
  FROM public.video_session_deadlines
  WHERE session_id = p_session_id
    AND state = 'pending'
    AND (
      (v_phase = 'ready_gate' AND kind = 'ready_gate_expiry')
      OR (v_phase = 'handshake' AND kind IN ('handshake_auto_promote', 'handshake_timeout'))
      OR (v_phase = 'date' AND kind = 'date_timeout')
      OR (v_phase = 'verdict' AND kind = 'verdict_timeout')
    )
  ORDER BY due_at ASC
  LIMIT 1;

  v_computed_deadline_at := CASE
    WHEN v_phase = 'ready_gate' THEN v_session.ready_gate_expires_at
    WHEN v_phase = 'handshake' THEN COALESCE(v_session.handshake_started_at, v_session.state_updated_at) + interval '60 seconds'
    WHEN v_phase = 'date' THEN COALESCE(v_session.date_started_at, v_session.state_updated_at) + ((300 + COALESCE(v_session.date_extra_seconds, 0)) * interval '1 second')
    WHEN v_phase = 'verdict' THEN COALESCE(v_session.ended_at, v_session.state_updated_at) + interval '30 seconds'
    ELSE NULL
  END;

  v_deadline_at := CASE
    WHEN v_phase = 'date' AND v_deadline_row_at IS NOT NULL AND v_computed_deadline_at IS NOT NULL
      THEN GREATEST(v_deadline_row_at, v_computed_deadline_at)
    WHEN v_deadline_row_at IS NOT NULL THEN v_deadline_row_at
    ELSE v_computed_deadline_at
  END;

  v_confirmed_encounter := public.video_date_session_has_confirmed_encounter(
    v_session.date_started_at,
    v_session.state::text,
    v_session.phase,
    v_session.participant_1_joined_at,
    v_session.participant_2_joined_at,
    v_session.participant_1_remote_seen_at,
    v_session.participant_2_remote_seen_at
  );
  v_survey_required := CASE
    WHEN v_phase = 'verdict' THEN v_confirmed_encounter
    ELSE public.video_date_session_is_post_date_survey_eligible_v2(
      v_session.ended_at,
      v_session.ended_reason,
      v_session.date_started_at,
      v_session.state::text,
      v_session.phase,
      v_session.participant_1_joined_at,
      v_session.participant_2_joined_at,
      v_session.participant_1_remote_seen_at,
      v_session.participant_2_remote_seen_at
    )
  END;

  v_allowed := CASE
    WHEN v_session.ended_at IS NOT NULL OR v_phase = 'ended' THEN CASE WHEN v_survey_required THEN ARRAY['submit_verdict']::text[] ELSE ARRAY[]::text[] END
    WHEN v_phase = 'ready_gate' THEN ARRAY['mark_ready', 'forfeit', 'report_block']::text[]
    WHEN v_phase = 'handshake' THEN ARRAY['continue', 'pass', 'end_call', 'report_block']::text[]
    WHEN v_phase = 'date' THEN ARRAY['spend_extension', 'end_call', 'report_block']::text[]
    WHEN v_phase = 'verdict' THEN CASE WHEN v_survey_required THEN ARRAY['submit_verdict', 'report_block']::text[] ELSE ARRAY['report_block']::text[] END
    ELSE ARRAY[]::text[]
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'sessionId', v_session.id,
    'eventId', v_session.event_id,
    'seq', COALESCE(v_session.session_seq, 0),
    'serverNow', (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint,
    'phase', v_phase,
    'phaseStartedAt', CASE WHEN v_started_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_started_at) * 1000)::bigint END,
    'phaseDeadlineAt', CASE WHEN v_deadline_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_deadline_at) * 1000)::bigint END,
    'allowedActions', to_jsonb(v_allowed),
    'surveyRequired', v_survey_required,
    'survey_required', v_survey_required,
    'participants', jsonb_build_array(
      jsonb_build_object(
        'id', v_session.participant_1_id,
        'isSelf', v_session.participant_1_id = v_uid,
        'isPartner', v_session.participant_1_id <> v_uid,
        'mediaJoinedAt', CASE WHEN v_session.participant_1_joined_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_1_joined_at) * 1000)::bigint END,
        'remoteSeenAt', CASE WHEN v_session.participant_1_remote_seen_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_1_remote_seen_at) * 1000)::bigint END,
        'awayAt', CASE WHEN v_session.participant_1_away_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_1_away_at) * 1000)::bigint END
      ),
      jsonb_build_object(
        'id', v_session.participant_2_id,
        'isSelf', v_session.participant_2_id = v_uid,
        'isPartner', v_session.participant_2_id <> v_uid,
        'mediaJoinedAt', CASE WHEN v_session.participant_2_joined_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_2_joined_at) * 1000)::bigint END,
        'remoteSeenAt', CASE WHEN v_session.participant_2_remote_seen_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_2_remote_seen_at) * 1000)::bigint END,
        'awayAt', CASE WHEN v_session.participant_2_away_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.participant_2_away_at) * 1000)::bigint END
      )
    ),
    'room', CASE
      WHEN v_session.daily_room_url IS NULL THEN NULL
      ELSE jsonb_build_object(
        'name', v_session.daily_room_name,
        'url', v_session.daily_room_url,
        'tokenRequired', true
      )
    END,
    'endedReason', v_session.ended_reason,
    'endedAt', CASE WHEN v_session.ended_at IS NULL THEN NULL ELSE (EXTRACT(EPOCH FROM v_session.ended_at) * 1000)::bigint END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_video_date_snapshot_core(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_video_date_snapshot_core(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_post_date_next_surface(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.video_sessions%ROWTYPE;
  v_next public.video_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_target_id uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_match_id uuid;
  v_event_active boolean := false;
  v_event_reason text := 'unknown';
  v_event_ends_at timestamptz;
  v_seconds_until_event_end integer;
  v_has_feedback boolean := false;
  v_pair_blocked_or_reported boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHORIZED', 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF v_session.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'error', 'session_not_found');
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_uid
     AND v_session.participant_2_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'code', 'ACCESS_DENIED', 'error', 'not_participant');
  END IF;

  v_target_id := CASE
    WHEN v_session.participant_1_id = v_uid THEN v_session.participant_2_id
    ELSE v_session.participant_1_id
  END;

  SELECT
    public.is_blocked(v_uid, v_target_id)
    OR EXISTS (
      SELECT 1
      FROM public.user_reports ur
      WHERE (ur.reporter_id = v_uid AND ur.reported_id = v_target_id)
         OR (ur.reporter_id = v_target_id AND ur.reported_id = v_uid)
    )
  INTO v_pair_blocked_or_reported;

  SELECT EXISTS (
    SELECT 1
    FROM public.date_feedback
    WHERE session_id = p_session_id
      AND user_id = v_uid
  ) INTO v_has_feedback;

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
    )
    AND NOT v_has_feedback
    AND NOT COALESCE(v_pair_blocked_or_reported, false) THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'survey',
      'route', 'date',
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'target_id', v_target_id,
      'reason', 'survey_required'
    );
  END IF;

  IF v_session.event_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'home',
      'route', 'home',
      'session_id', p_session_id,
      'target_id', v_target_id,
      'reason', 'no_event_context'
    );
  END IF;

  v_p1 := LEAST(v_session.participant_1_id, v_session.participant_2_id);
  v_p2 := GREATEST(v_session.participant_1_id, v_session.participant_2_id);

  IF NOT COALESCE(v_pair_blocked_or_reported, false) THEN
    SELECT id INTO v_match_id
    FROM public.matches
    WHERE profile_id_1 = v_p1
      AND profile_id_2 = v_p2
    LIMIT 1;
  END IF;

  SELECT state.is_active, state.reason
  INTO v_event_active, v_event_reason
  FROM public.get_event_lobby_active_state(v_session.event_id, v_now) AS state
  LIMIT 1;

  SELECT e.event_date + (COALESCE(e.duration_minutes, 60) * interval '1 minute')
  INTO v_event_ends_at
  FROM public.events e
  WHERE e.id = v_session.event_id;

  IF v_event_ends_at IS NOT NULL THEN
    v_seconds_until_event_end := floor(EXTRACT(EPOCH FROM (v_event_ends_at - v_now)))::integer;
  END IF;

  SELECT * INTO v_next
  FROM public.video_sessions vs
  WHERE vs.id <> p_session_id
    AND (vs.participant_1_id = v_uid OR vs.participant_2_id = v_uid)
    AND public.video_date_session_is_active_surface(vs.ended_at, vs.state::text, vs.phase)
    AND NOT public.is_blocked(
      v_uid,
      CASE
        WHEN vs.participant_1_id = v_uid THEN vs.participant_2_id
        ELSE vs.participant_1_id
      END
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_reports ur
      WHERE (
        ur.reporter_id = v_uid
        AND ur.reported_id = CASE
          WHEN vs.participant_1_id = v_uid THEN vs.participant_2_id
          ELSE vs.participant_1_id
        END
      )
      OR (
        ur.reported_id = v_uid
        AND ur.reporter_id = CASE
          WHEN vs.participant_1_id = v_uid THEN vs.participant_2_id
          ELSE vs.participant_1_id
        END
      )
    )
  ORDER BY
    CASE
      WHEN vs.state = 'date'::public.video_date_state THEN 1
      WHEN vs.state = 'handshake'::public.video_date_state THEN 2
      WHEN vs.state = 'ready_gate'::public.video_date_state THEN 3
      ELSE 4
    END,
    COALESCE(
      vs.date_started_at,
      vs.handshake_started_at,
      vs.ready_participant_1_at,
      vs.ready_participant_2_at,
      vs.started_at
    ) DESC
  LIMIT 1;

  IF v_next.id IS NOT NULL THEN
    IF v_next.state = 'ready_gate'::public.video_date_state THEN
      RETURN jsonb_build_object(
        'success', true,
        'action', 'ready_gate',
        'route', 'ready_gate',
        'session_id', p_session_id,
        'next_session_id', v_next.id,
        'event_id', v_next.event_id,
        'reason', 'active_ready_gate'
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'video_date',
      'route', 'date',
      'session_id', p_session_id,
      'next_session_id', v_next.id,
      'event_id', v_next.event_id,
      'reason', 'active_video_date'
    );
  END IF;

  IF COALESCE(v_event_active, false) THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'lobby',
      'route', 'event_lobby',
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'target_id', v_target_id,
      'match_id', v_match_id,
      'seconds_until_event_end', v_seconds_until_event_end,
      'reason', CASE
        WHEN COALESCE(v_pair_blocked_or_reported, false) THEN 'pair_safety_blocked'
        WHEN v_seconds_until_event_end IS NOT NULL AND v_seconds_until_event_end <= 300 THEN 'last_chance'
        ELSE 'event_active'
      END
    );
  END IF;

  IF v_match_id IS NOT NULL AND NOT COALESCE(v_pair_blocked_or_reported, false) THEN
    RETURN jsonb_build_object(
      'success', true,
      'action', 'chat',
      'route', 'chat',
      'session_id', p_session_id,
      'event_id', v_session.event_id,
      'target_id', v_target_id,
      'match_id', v_match_id,
      'event_active', false,
      'reason', 'event_closed_mutual_match'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'wrap_up',
    'route', 'event_wrap_up',
    'session_id', p_session_id,
    'event_id', v_session.event_id,
    'event_active', false,
    'event_reason', v_event_reason,
    'reason', CASE
      WHEN COALESCE(v_pair_blocked_or_reported, false) THEN 'pair_safety_blocked'
      ELSE 'event_not_active'
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_post_date_next_surface(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_post_date_next_surface(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_post_date_pending_verdict_reminders(
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  session_id uuid,
  event_id uuid,
  submitted_by uuid,
  missing_user_id uuid,
  first_detected_at timestamptz,
  reminder_sent_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT pd.session_id
    FROM public.post_date_pending_verdicts pd
    JOIN public.video_sessions vs ON vs.id = pd.session_id
    WHERE pd.completed_at IS NULL
      AND pd.stale_at IS NULL
      AND pd.reminder_sent_at IS NULL
      AND pd.reminder_eligible_at <= now()
      AND EXISTS (
        SELECT 1
        FROM public.date_feedback df
        WHERE df.session_id = pd.session_id
          AND df.user_id = pd.submitted_by
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.date_feedback df
        WHERE df.session_id = pd.session_id
          AND df.user_id = pd.missing_user_id
      )
      AND NOT public.is_blocked(pd.submitted_by, pd.missing_user_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.user_reports ur
        WHERE (ur.reporter_id = pd.submitted_by AND ur.reported_id = pd.missing_user_id)
           OR (ur.reporter_id = pd.missing_user_id AND ur.reported_id = pd.submitted_by)
      )
      AND public.video_date_session_is_post_date_survey_eligible_v2(
        vs.ended_at,
        vs.ended_reason,
        vs.date_started_at,
        vs.state::text,
        vs.phase,
        vs.participant_1_joined_at,
        vs.participant_2_joined_at,
        vs.participant_1_remote_seen_at,
        vs.participant_2_remote_seen_at
      )
    ORDER BY pd.first_detected_at
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
    FOR UPDATE OF pd SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.post_date_pending_verdicts pd
    SET
      reminder_sent_at = now(),
      reminder_error = NULL,
      status = 'reminded',
      updated_at = now()
    FROM candidates
    WHERE pd.session_id = candidates.session_id
    RETURNING
      pd.session_id,
      pd.event_id,
      pd.submitted_by,
      pd.missing_user_id,
      pd.first_detected_at,
      pd.reminder_sent_at
  )
  SELECT
    claimed.session_id,
    claimed.event_id,
    claimed.submitted_by,
    claimed.missing_user_id,
    claimed.first_detected_at,
    claimed.reminder_sent_at
  FROM claimed;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_post_date_pending_verdict_reminders(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_post_date_pending_verdict_reminders(integer) TO service_role;

COMMIT;
