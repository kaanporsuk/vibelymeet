-- Video Date terminal encounter survey recovery + same-event pair guard.
--
-- Product rule: once both participants have joined the Daily room, the encounter
-- is established even if the warm-up handshake never reached date_started_at.
-- Established terminal encounters must route both users to survey and must not
-- re-enter Ready Gate for the same pair in the same event.

CREATE OR REPLACE FUNCTION public.video_date_session_has_encounter_exposure(
  p_date_started_at timestamptz,
  p_state text,
  p_phase text,
  p_participant_1_joined_at timestamptz,
  p_participant_2_joined_at timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_date_started_at IS NOT NULL
    OR p_state = 'date'
    OR p_phase = 'date'
    OR (p_participant_1_joined_at IS NOT NULL AND p_participant_2_joined_at IS NOT NULL);
$function$;

CREATE OR REPLACE FUNCTION public.video_date_session_is_post_date_survey_eligible(
  p_ended_at timestamptz,
  p_ended_reason text,
  p_date_started_at timestamptz,
  p_state text,
  p_phase text,
  p_participant_1_joined_at timestamptz,
  p_participant_2_joined_at timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_ended_at IS NOT NULL
    AND public.video_date_session_has_encounter_exposure(
      p_date_started_at,
      p_state,
      p_phase,
      p_participant_1_joined_at,
      p_participant_2_joined_at
    )
    AND COALESCE(p_ended_reason, '') NOT IN (
      'ready_gate_forfeit',
      'ready_gate_expired',
      'queued_ttl_expired',
      'handshake_grace_expired',
      'partial_join_peer_timeout',
      'blocked_pair'
    );
$function$;

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
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.video_sessions vs
    WHERE vs.event_id = p_event_id
      AND vs.participant_1_id = LEAST(p_user_a, p_user_b)
      AND vs.participant_2_id = GREATEST(p_user_a, p_user_b)
      AND (p_exclude_session_id IS NULL OR vs.id <> p_exclude_session_id)
      AND public.video_date_session_is_post_date_survey_eligible(
        vs.ended_at,
        vs.ended_reason,
        vs.date_started_at,
        vs.state::text,
        vs.phase,
        vs.participant_1_joined_at,
        vs.participant_2_joined_at
      )
  );
$function$;

CREATE INDEX IF NOT EXISTS idx_video_sessions_ended_encounter_survey_lookup
  ON public.video_sessions (event_id, ended_at DESC, participant_1_id, participant_2_id)
  WHERE ended_at IS NOT NULL
    AND (
      date_started_at IS NOT NULL
      OR state = 'date'::public.video_date_state
      OR phase = 'date'
      OR (participant_1_joined_at IS NOT NULL AND participant_2_joined_at IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_video_sessions_terminal_encounter_pair_lookup
  ON public.video_sessions (event_id, participant_1_id, participant_2_id, ended_at DESC)
  WHERE ended_at IS NOT NULL
    AND (
      date_started_at IS NOT NULL
      OR state = 'date'::public.video_date_state
      OR phase = 'date'
      OR (participant_1_joined_at IS NOT NULL AND participant_2_joined_at IS NOT NULL)
    );

CREATE OR REPLACE FUNCTION public.check_mutual_vibe_and_match(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session record;
  v_user1_liked boolean;
  v_user2_liked boolean;
  v_match_id uuid;
  v_existing_match uuid;
  v_p1 uuid;
  v_p2 uuid;
BEGIN
  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF NOT public.video_date_session_is_post_date_survey_eligible(
    v_session.ended_at,
    v_session.ended_reason,
    v_session.date_started_at,
    v_session.state::text,
    v_session.phase,
    v_session.participant_1_joined_at,
    v_session.participant_2_joined_at
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'session_not_survey_eligible',
      'code', 'session_not_survey_eligible',
      'mutual', false
    );
  END IF;

  IF public.is_blocked(v_session.participant_1_id, v_session.participant_2_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'blocked_pair',
      'code', 'blocked_pair',
      'mutual', false,
      'blocked', true
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_reports ur
    WHERE (ur.reporter_id = v_session.participant_1_id AND ur.reported_id = v_session.participant_2_id)
       OR (ur.reporter_id = v_session.participant_2_id AND ur.reported_id = v_session.participant_1_id)
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'mutual', false,
      'reported_pair', true
    );
  END IF;

  SELECT liked INTO v_user1_liked
  FROM public.date_feedback
  WHERE session_id = p_session_id
    AND user_id = v_session.participant_1_id;

  SELECT liked INTO v_user2_liked
  FROM public.date_feedback
  WHERE session_id = p_session_id
    AND user_id = v_session.participant_2_id;

  IF v_user1_liked IS TRUE AND v_user2_liked IS TRUE THEN
    v_p1 := LEAST(v_session.participant_1_id, v_session.participant_2_id);
    v_p2 := GREATEST(v_session.participant_1_id, v_session.participant_2_id);

    SELECT id INTO v_existing_match
    FROM public.matches
    WHERE profile_id_1 = v_p1
      AND profile_id_2 = v_p2;

    IF v_existing_match IS NULL THEN
      INSERT INTO public.matches (profile_id_1, profile_id_2, event_id)
      VALUES (v_p1, v_p2, v_session.event_id)
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_match_id;

      IF v_match_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'mutual', true, 'match_id', v_match_id);
      END IF;

      SELECT id INTO v_existing_match
      FROM public.matches
      WHERE profile_id_1 = v_p1
        AND profile_id_2 = v_p2;

      RETURN jsonb_build_object(
        'success', true,
        'mutual', true,
        'match_id', v_existing_match,
        'already_matched', true
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'mutual', true,
      'match_id', v_existing_match,
      'already_matched', true
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'mutual', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.check_mutual_vibe_and_match(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_mutual_vibe_and_match(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_post_date_verdict(p_session_id uuid, p_liked boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_session record;
  v_target uuid;
  v_inner jsonb;
  v_persistent_created boolean;
  v_partner_verdict_recorded boolean := false;
  v_mutual boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  IF v_session.participant_1_id IS DISTINCT FROM v_uid
     AND v_session.participant_2_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_participant');
  END IF;

  IF v_session.participant_1_id = v_uid THEN
    v_target := v_session.participant_2_id;
  ELSE
    v_target := v_session.participant_1_id;
  END IF;

  IF COALESCE(v_session.ended_reason, '') = 'blocked_pair'
     OR public.is_blocked(v_uid, v_target) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'blocked_pair',
      'code', 'blocked_pair',
      'blocked', true
    );
  END IF;

  IF NOT public.video_date_session_is_post_date_survey_eligible(
    v_session.ended_at,
    v_session.ended_reason,
    v_session.date_started_at,
    v_session.state::text,
    v_session.phase,
    v_session.participant_1_joined_at,
    v_session.participant_2_joined_at
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'session_not_survey_eligible',
      'code', 'session_not_survey_eligible',
      'verdict_recorded', false
    );
  END IF;

  INSERT INTO public.date_feedback (session_id, user_id, target_id, liked)
  VALUES (p_session_id, v_uid, v_target, p_liked)
  ON CONFLICT (session_id, user_id)
  DO UPDATE SET
    liked = EXCLUDED.liked,
    target_id = EXCLUDED.target_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.date_feedback df
    WHERE df.session_id = p_session_id
      AND df.user_id = v_target
  ) INTO v_partner_verdict_recorded;

  v_inner := public.check_mutual_vibe_and_match(p_session_id);
  v_mutual := COALESCE((v_inner->>'mutual')::boolean, false);

  IF NOT COALESCE((v_inner->>'success')::boolean, false) THEN
    RETURN v_inner || jsonb_build_object(
      'verdict_recorded', true,
      'partner_verdict_recorded', v_partner_verdict_recorded,
      'awaiting_partner_verdict', NOT v_partner_verdict_recorded
    );
  END IF;

  v_persistent_created := NULL;
  IF v_mutual THEN
    IF COALESCE((v_inner->>'already_matched')::boolean, false) THEN
      v_persistent_created := false;
    ELSE
      v_persistent_created := true;
    END IF;
  END IF;

  IF NOT v_partner_verdict_recorded THEN
    INSERT INTO public.post_date_pending_verdicts (
      session_id,
      event_id,
      submitted_by,
      missing_user_id,
      first_detected_at,
      last_seen_at,
      reminder_eligible_at,
      created_at,
      updated_at,
      status
    )
    VALUES (
      p_session_id,
      v_session.event_id,
      v_uid,
      v_target,
      now(),
      now(),
      now() + interval '5 minutes',
      now(),
      now(),
      'pending'
    )
    ON CONFLICT (session_id) DO UPDATE SET
      event_id = EXCLUDED.event_id,
      submitted_by = EXCLUDED.submitted_by,
      missing_user_id = EXCLUDED.missing_user_id,
      last_seen_at = now(),
      reminder_eligible_at = CASE
        WHEN public.post_date_pending_verdicts.reminder_sent_at IS NULL
          THEN LEAST(public.post_date_pending_verdicts.reminder_eligible_at, EXCLUDED.reminder_eligible_at)
        ELSE public.post_date_pending_verdicts.reminder_eligible_at
      END,
      completed_at = NULL,
      status = CASE
        WHEN public.post_date_pending_verdicts.stale_at IS NOT NULL THEN 'stale'
        WHEN public.post_date_pending_verdicts.reminder_sent_at IS NOT NULL THEN 'reminded'
        ELSE 'pending'
      END,
      updated_at = now();

    PERFORM public.record_event_loop_observability(
      'post_date_half_verdict_saved',
      'success',
      'partner_verdict_missing',
      NULL,
      v_session.event_id,
      v_uid,
      p_session_id,
      jsonb_build_object('target_id', v_target)
    );
    PERFORM public.record_event_loop_observability(
      'post_date_half_verdict_pending',
      'success',
      'partner_verdict_missing',
      NULL,
      v_session.event_id,
      v_uid,
      p_session_id,
      jsonb_build_object('target_id', v_target)
    );
  ELSE
    UPDATE public.post_date_pending_verdicts
    SET
      completed_at = COALESCE(completed_at, now()),
      status = 'completed',
      updated_at = now()
    WHERE session_id = p_session_id
      AND completed_at IS NULL;

    PERFORM public.record_event_loop_observability(
      'post_date_pending_verdict_completed',
      'success',
      CASE WHEN v_mutual THEN 'mutual' ELSE 'not_mutual' END,
      NULL,
      v_session.event_id,
      v_uid,
      p_session_id,
      jsonb_build_object(
        'target_id', v_target,
        'mutual', v_mutual,
        'persistent_match_created', v_persistent_created
      )
    );
  END IF;

  RETURN v_inner
    || jsonb_build_object(
      'verdict_recorded', true,
      'persistent_match_created', v_persistent_created,
      'partner_verdict_recorded', v_partner_verdict_recorded,
      'awaiting_partner_verdict', NOT v_partner_verdict_recorded
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_post_date_verdict(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_post_date_verdict(uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finalize_video_date_handshake_deadline(
  p_session_id uuid,
  p_actor uuid DEFAULT NULL,
  p_source text DEFAULT 'manual',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_session public.video_sessions%ROWTYPE;
  v_ev uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_is_p1 boolean := false;
  v_is_p2 boolean := false;
  v_actor_decided_at timestamptz;
  v_partner_decided_at timestamptz;
  v_waiting_for_self boolean := false;
  v_waiting_for_partner boolean := false;
  v_p1_decided boolean := false;
  v_p2_decided boolean := false;
  v_p1_explicit_pass boolean := false;
  v_p2_explicit_pass boolean := false;
  v_due boolean := false;
  v_seconds_remaining integer;
  v_state_before text;
  v_reason_code text;
  v_terminal_reason text;
  v_should_open_survey boolean := false;
BEGIN
  SELECT *
  INTO v_session
  FROM public.video_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'session_not_found',
      NULL,
      NULL,
      p_actor,
      p_session_id,
      jsonb_build_object(
        'action', 'complete_handshake',
        'source', p_source,
        'p_reason', p_reason
      )
    );
    RETURN jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
  END IF;

  v_ev := v_session.event_id;
  v_p1 := v_session.participant_1_id;
  v_p2 := v_session.participant_2_id;
  v_state_before := v_session.state::text;
  v_is_p1 := p_actor IS NOT NULL AND v_p1 = p_actor;
  v_is_p2 := p_actor IS NOT NULL AND v_p2 = p_actor;

  IF p_actor IS NOT NULL AND NOT v_is_p1 AND NOT v_is_p2 THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'blocked',
      'access_denied',
      NULL,
      v_ev,
      p_actor,
      p_session_id,
      jsonb_build_object(
        'action', 'complete_handshake',
        'source', p_source,
        'state_before', v_state_before,
        'p_reason', p_reason
      )
    );
    RETURN jsonb_build_object('success', false, 'error', 'Access denied', 'code', 'ACCESS_DENIED');
  END IF;

  v_p1_decided := v_session.participant_1_decided_at IS NOT NULL;
  v_p2_decided := v_session.participant_2_decided_at IS NOT NULL;
  v_p1_explicit_pass := v_p1_decided AND v_session.participant_1_liked IS FALSE;
  v_p2_explicit_pass := v_p2_decided AND v_session.participant_2_liked IS FALSE;
  v_actor_decided_at := CASE
    WHEN v_is_p1 THEN v_session.participant_1_decided_at
    WHEN v_is_p2 THEN v_session.participant_2_decided_at
    ELSE NULL
  END;
  v_partner_decided_at := CASE
    WHEN v_is_p1 THEN v_session.participant_2_decided_at
    WHEN v_is_p2 THEN v_session.participant_1_decided_at
    ELSE NULL
  END;
  v_waiting_for_self := p_actor IS NOT NULL AND v_actor_decided_at IS NULL;
  v_waiting_for_partner := p_actor IS NOT NULL AND v_partner_decided_at IS NULL;
  v_due := v_session.handshake_started_at IS NOT NULL
    AND v_session.handshake_started_at + interval '60 seconds' <= v_now;
  v_seconds_remaining := CASE
    WHEN v_session.handshake_started_at IS NULL THEN NULL
    ELSE GREATEST(
      0,
      CEIL(EXTRACT(EPOCH FROM ((v_session.handshake_started_at + interval '60 seconds') - v_now)))::int
    )
  END;

  IF v_session.ended_at IS NOT NULL THEN
    v_should_open_survey := public.video_date_session_is_post_date_survey_eligible(
      v_session.ended_at,
      v_session.ended_reason,
      v_session.date_started_at,
      v_session.state::text,
      v_session.phase,
      v_session.participant_1_joined_at,
      v_session.participant_2_joined_at
    );

    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'no_op',
      'session_already_ended',
      NULL,
      v_ev,
      p_actor,
      p_session_id,
      jsonb_build_object(
        'action', 'complete_handshake',
        'source', p_source,
        'participant_1_liked', v_session.participant_1_liked,
        'participant_2_liked', v_session.participant_2_liked,
        'participant_1_decided_at', v_session.participant_1_decided_at,
        'participant_2_decided_at', v_session.participant_2_decided_at,
        'waiting_for_self', v_waiting_for_self,
        'waiting_for_partner', v_waiting_for_partner,
        'state_before', v_state_before,
        'state_after', v_session.state::text,
        'deadline_due', v_due,
        'survey_required', v_should_open_survey,
        'handshake_grace_expires_at', v_session.handshake_grace_expires_at,
        'p_reason', p_reason
      )
    );
    RETURN jsonb_build_object(
      'success', true,
      'state', 'ended',
      'already_ended', true,
      'reason', v_session.ended_reason,
      'survey_required', v_should_open_survey,
      'waiting_for_self', v_waiting_for_self,
      'waiting_for_partner', v_waiting_for_partner,
      'local_decision_persisted', NOT v_waiting_for_self,
      'partner_decision_persisted', NOT v_waiting_for_partner
    );
  END IF;

  IF v_session.state = 'date'::public.video_date_state
     OR v_session.phase = 'date'
     OR v_session.date_started_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'state', 'date',
      'waiting_for_self', false,
      'waiting_for_partner', false,
      'local_decision_persisted', true,
      'partner_decision_persisted', true
    );
  END IF;

  IF v_p1_decided
     AND v_p2_decided
     AND v_session.participant_1_liked IS TRUE
     AND v_session.participant_2_liked IS TRUE THEN
    UPDATE public.video_sessions
    SET
      state = 'date'::public.video_date_state,
      phase = 'date',
      date_started_at = COALESCE(date_started_at, v_now),
      handshake_grace_expires_at = NULL,
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = 'in_date',
      current_room_id = p_session_id,
      current_partner_id = CASE WHEN profile_id = v_p1 THEN v_p2 ELSE v_p1 END,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2);

    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'success',
      'handshake_deadline_completed_mutual',
      NULL,
      v_ev,
      p_actor,
      p_session_id,
      jsonb_build_object(
        'action', 'complete_handshake',
        'source', p_source,
        'participant_1_liked', v_session.participant_1_liked,
        'participant_2_liked', v_session.participant_2_liked,
        'participant_1_decided_at', v_session.participant_1_decided_at,
        'participant_2_decided_at', v_session.participant_2_decided_at,
        'waiting_for_self', false,
        'waiting_for_partner', false,
        'state_before', v_state_before,
        'state_after', v_session.state::text,
        'deadline_due', v_due,
        'handshake_grace_expires_at', v_session.handshake_grace_expires_at,
        'p_reason', p_reason
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'state', 'date',
      'waiting_for_self', false,
      'waiting_for_partner', false,
      'local_decision_persisted', true,
      'partner_decision_persisted', true
    );
  END IF;

  IF NOT v_due THEN
    PERFORM public.record_event_loop_observability(
      'video_date_transition',
      'no_op',
      'handshake_deadline_not_due',
      NULL,
      v_ev,
      p_actor,
      p_session_id,
      jsonb_build_object(
        'action', 'complete_handshake',
        'source', p_source,
        'participant_1_liked', v_session.participant_1_liked,
        'participant_2_liked', v_session.participant_2_liked,
        'participant_1_decided_at', v_session.participant_1_decided_at,
        'participant_2_decided_at', v_session.participant_2_decided_at,
        'waiting_for_self', v_waiting_for_self,
        'waiting_for_partner', v_waiting_for_partner,
        'seconds_remaining', v_seconds_remaining,
        'state_before', v_state_before,
        'state_after', v_session.state::text,
        'deadline_due', false,
        'handshake_grace_expires_at', v_session.handshake_grace_expires_at,
        'p_reason', p_reason
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'state', 'handshake',
      'waiting_for_self', v_waiting_for_self,
      'waiting_for_partner', v_waiting_for_partner,
      'local_decision_persisted', NOT v_waiting_for_self,
      'partner_decision_persisted', NOT v_waiting_for_partner,
      'seconds_remaining', v_seconds_remaining
    );
  END IF;

  IF v_p1_explicit_pass OR v_p2_explicit_pass OR (v_p1_decided AND v_p2_decided) THEN
    v_terminal_reason := 'handshake_not_mutual';
    v_reason_code := 'handshake_deadline_not_mutual';
  ELSE
    v_terminal_reason := 'handshake_timeout';
    v_reason_code := 'handshake_deadline_timeout';
  END IF;

  UPDATE public.video_sessions
  SET
    state = 'ended'::public.video_date_state,
    phase = 'ended',
    ended_at = COALESCE(ended_at, v_now),
    ended_reason = v_terminal_reason,
    handshake_grace_expires_at = NULL,
    reconnect_grace_ends_at = NULL,
    participant_1_away_at = NULL,
    participant_2_away_at = NULL,
    duration_seconds = COALESCE(
      duration_seconds,
      GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - COALESCE(v_session.handshake_started_at, v_session.started_at))))::int)
    ),
    state_updated_at = v_now
  WHERE id = p_session_id
    AND ended_at IS NULL;

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

  v_should_open_survey := public.video_date_session_is_post_date_survey_eligible(
    v_session.ended_at,
    v_session.ended_reason,
    v_session.date_started_at,
    v_session.state::text,
    v_session.phase,
    v_session.participant_1_joined_at,
    v_session.participant_2_joined_at
  );

  UPDATE public.event_registrations
  SET
    queue_status = CASE WHEN v_should_open_survey THEN 'in_survey' ELSE 'idle' END,
    current_room_id = CASE WHEN v_should_open_survey THEN p_session_id ELSE NULL END,
    current_partner_id = CASE
      WHEN v_should_open_survey THEN CASE WHEN profile_id = v_p1 THEN v_p2 ELSE v_p1 END
      ELSE NULL
    END,
    last_active_at = v_now
  WHERE event_id = v_ev
    AND profile_id IN (v_p1, v_p2);

  v_actor_decided_at := CASE
    WHEN v_is_p1 THEN v_session.participant_1_decided_at
    WHEN v_is_p2 THEN v_session.participant_2_decided_at
    ELSE NULL
  END;
  v_partner_decided_at := CASE
    WHEN v_is_p1 THEN v_session.participant_2_decided_at
    WHEN v_is_p2 THEN v_session.participant_1_decided_at
    ELSE NULL
  END;
  v_waiting_for_self := p_actor IS NOT NULL AND v_actor_decided_at IS NULL;
  v_waiting_for_partner := p_actor IS NOT NULL AND v_partner_decided_at IS NULL;

  PERFORM public.record_event_loop_observability(
    'video_date_transition',
    'success',
    v_reason_code,
    NULL,
    v_ev,
    p_actor,
    p_session_id,
    jsonb_build_object(
      'action', 'complete_handshake',
      'source', p_source,
      'participant_1_liked', v_session.participant_1_liked,
      'participant_2_liked', v_session.participant_2_liked,
      'participant_1_decided_at', v_session.participant_1_decided_at,
      'participant_2_decided_at', v_session.participant_2_decided_at,
      'participant_1_joined_at', v_session.participant_1_joined_at,
      'participant_2_joined_at', v_session.participant_2_joined_at,
      'waiting_for_self', v_waiting_for_self,
      'waiting_for_partner', v_waiting_for_partner,
      'local_decision_persisted', NOT v_waiting_for_self,
      'partner_decision_persisted', NOT v_waiting_for_partner,
      'state_before', v_state_before,
      'state_after', v_session.state::text,
      'deadline_due', true,
      'handshake_deadline_seconds', 60,
      'handshake_grace_removed', true,
      'survey_required', v_should_open_survey,
      'handshake_grace_expires_at', v_session.handshake_grace_expires_at,
      'p_reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'state', 'ended',
    'reason', v_terminal_reason,
    'survey_required', v_should_open_survey,
    'waiting_for_self', v_waiting_for_self,
    'waiting_for_partner', v_waiting_for_partner,
    'local_decision_persisted', NOT v_waiting_for_self,
    'partner_decision_persisted', NOT v_waiting_for_partner
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_video_date_handshake_deadline(uuid, uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_event_deck(
  p_event_id uuid,
  p_user_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  profile_id uuid,
  name text,
  age integer,
  gender text,
  avatar_url text,
  photos text[],
  about_me text,
  job text,
  location text,
  height_cm integer,
  tagline text,
  looking_for text,
  queue_status text,
  has_met_before boolean,
  is_already_connected boolean,
  has_super_vibed boolean,
  shared_vibe_count integer,
  primary_photo_path text,
  photo_verified boolean,
  premium_badge text,
  availability_state text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_viewer uuid := auth.uid();
  v_active record;
BEGIN
  IF v_viewer IS NULL OR v_viewer <> p_user_id THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_active
  FROM public.get_event_lobby_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    RAISE EXCEPTION 'event_not_active'
      USING ERRCODE = 'P0001',
            DETAIL = COALESCE(v_active.reason, 'event_not_active');
  END IF;

  RETURN QUERY
  WITH deck AS (
    SELECT base.*
    FROM public.get_event_deck_20260501180000_active_base(
      p_event_id,
      p_user_id,
      p_limit
    ) AS base
    WHERE COALESCE(base.queue_status, 'idle') IN ('browsing', 'idle')
      AND NOT public.video_date_pair_has_terminal_encounter(p_event_id, p_user_id, base.profile_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.video_sessions vs
        WHERE vs.event_id = p_event_id
          AND vs.ended_at IS NULL
          AND (
            vs.participant_1_id = base.profile_id
            OR vs.participant_2_id = base.profile_id
          )
          AND (
            vs.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
            OR vs.state IN ('handshake', 'date')
            OR vs.phase IN ('handshake', 'date')
            OR vs.handshake_started_at IS NOT NULL
            OR vs.date_started_at IS NOT NULL
          )
      )
  )
  SELECT
    deck.profile_id,
    deck.name,
    deck.age,
    deck.gender,
    deck.avatar_url,
    deck.photos,
    deck.about_me,
    deck.job,
    deck.location,
    deck.height_cm,
    deck.tagline,
    deck.looking_for,
    deck.queue_status,
    deck.has_met_before,
    deck.is_already_connected,
    deck.has_super_vibed,
    deck.shared_vibe_count,
    COALESCE(
      (
        SELECT NULLIF(btrim(photo), '')
        FROM unnest(COALESCE(deck.photos, ARRAY[]::text[])) AS photo
        WHERE NULLIF(btrim(photo), '') IS NOT NULL
        LIMIT 1
      ),
      NULLIF(btrim(deck.avatar_url), '')
    ) AS primary_photo_path,
    COALESCE(p.photo_verified, false) AS photo_verified,
    CASE
      WHEN p.subscription_tier IN ('premium', 'vip') THEN p.subscription_tier
      ELSE NULL
    END AS premium_badge,
    'available'::text AS availability_state
  FROM deck
  JOIN public.profiles p ON p.id = deck.profile_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_deck(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_deck(uuid, uuid, integer)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.handle_swipe_20260503090000_encounter_guard_base(uuid, uuid, uuid, text);
ALTER FUNCTION public.handle_swipe(uuid, uuid, uuid, text)
  RENAME TO handle_swipe_20260503090000_encounter_guard_base;
REVOKE ALL ON FUNCTION public.handle_swipe_20260503090000_encounter_guard_base(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_swipe_20260503090000_encounter_guard_base(uuid, uuid, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.handle_swipe(
  p_event_id uuid,
  p_actor_id uuid,
  p_target_id uuid,
  p_swipe_type text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object('result', 'unauthorized');
  END IF;

  IF public.video_date_pair_has_terminal_encounter(p_event_id, p_actor_id, p_target_id) THEN
    PERFORM public.record_event_loop_observability(
      'handle_swipe',
      'blocked',
      'pair_already_met_this_event',
      NULL,
      p_event_id,
      p_actor_id,
      NULL,
      jsonb_build_object(
        'target_id', p_target_id,
        'swipe_type', p_swipe_type,
        'terminal_encounter_pair', true
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'pair_already_met_this_event',
      'result', 'pair_already_met_this_event',
      'error', 'pair_already_met_this_event',
      'notification_suppressed', true,
      'dedupe_reason', 'terminal_encounter_pair'
    );
  END IF;

  RETURN public.handle_swipe_20260503090000_encounter_guard_base(
    p_event_id,
    p_actor_id,
    p_target_id,
    p_swipe_type
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text)
  TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.promote_ready_gate_202605030900_base(uuid, uuid);
ALTER FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid)
  RENAME TO promote_ready_gate_202605030900_base;
REVOKE ALL ON FUNCTION public.promote_ready_gate_202605030900_base(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_ready_gate_202605030900_base(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.promote_ready_gate_if_eligible(
  p_event_id uuid,
  p_uid uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_is_service_role boolean := auth.role() = 'service_role';
  v_active record;
  v_queued record;
  v_partner uuid;
BEGIN
  IF NOT v_is_service_role
     AND (v_actor IS NULL OR v_actor IS DISTINCT FROM p_uid) THEN
    RETURN public.promote_ready_gate_202605030900_base(p_event_id, p_uid);
  END IF;

  SELECT *
  INTO v_active
  FROM public.lock_event_lobby_scheduled_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    RETURN public.promote_ready_gate_202605030900_base(p_event_id, p_uid);
  END IF;

  SELECT
    vs.id,
    vs.participant_1_id,
    vs.participant_2_id,
    CASE WHEN vs.participant_1_id = p_uid THEN vs.participant_2_id ELSE vs.participant_1_id END AS partner_id
  INTO v_queued
  FROM public.video_sessions vs
  WHERE vs.event_id = p_event_id
    AND vs.ended_at IS NULL
    AND vs.ready_gate_status = 'queued'
    AND (vs.participant_1_id = p_uid OR vs.participant_2_id = p_uid)
  ORDER BY vs.started_at ASC NULLS LAST, vs.id ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_partner := v_queued.partner_id;

    IF public.video_date_pair_has_terminal_encounter(p_event_id, p_uid, v_partner, v_queued.id) THEN
      UPDATE public.video_sessions
      SET
        ended_at = COALESCE(ended_at, now()),
        ended_reason = COALESCE(ended_reason, 'pair_already_met_this_event'),
        state = 'ended'::public.video_date_state,
        phase = 'ended',
        state_updated_at = now()
      WHERE id = v_queued.id
        AND ended_at IS NULL;

      UPDATE public.event_registrations
      SET
        queue_status = 'idle',
        current_room_id = NULL,
        current_partner_id = NULL,
        last_active_at = now()
      WHERE event_id = p_event_id
        AND profile_id IN (p_uid, v_partner)
        AND (
          current_room_id = v_queued.id
          OR queue_status IN ('in_ready_gate', 'in_handshake', 'in_date')
        );

      PERFORM public.record_event_loop_observability(
        'promote_ready_gate_if_eligible',
        'blocked',
        'pair_already_met_this_event',
        NULL,
        p_event_id,
        p_uid,
        v_queued.id,
        jsonb_build_object(
          'partner_id', v_partner,
          'terminal_encounter_pair', true
        )
      );

      RETURN jsonb_build_object(
        'promoted', false,
        'reason', 'pair_already_met_this_event',
        'session_id', v_queued.id
      );
    END IF;
  END IF;

  RETURN public.promote_ready_gate_202605030900_base(p_event_id, p_uid);
END;
$function$;

REVOKE ALL ON FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.video_date_session_has_encounter_exposure(timestamptz, text, text, timestamptz, timestamptz) IS
  'True once a video-date encounter was established: date phase/date_started_at or both participants joined Daily.';

COMMENT ON FUNCTION public.video_date_session_is_post_date_survey_eligible(timestamptz, text, timestamptz, text, text, timestamptz, timestamptz) IS
  'Post-date survey eligibility for terminal established encounters. Ready-gate/no-join/partial-join terminal rows stay ineligible.';

COMMENT ON FUNCTION public.video_date_pair_has_terminal_encounter(uuid, uuid, uuid, uuid) IS
  'Same-event pair guard used by deck, swipe, and Ready Gate promotion to prevent re-matching after an established terminal encounter.';
