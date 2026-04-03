-- Phase 1 hardening: canonical lobby presence recency + atomic ready-gate/date cleanup.

ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS last_lobby_foregrounded_at timestamptz;

COMMENT ON COLUMN public.event_registrations.last_lobby_foregrounded_at IS
  'Most recent time the participant foregrounded the event lobby/deck (presence proof for immediate matching).';

-- One-time soft backfill for currently active lobby users to avoid rollout cold-start queueing.
UPDATE public.event_registrations
SET last_lobby_foregrounded_at = last_active_at
WHERE queue_status IN ('browsing', 'idle')
  AND last_active_at IS NOT NULL
  AND last_active_at >= now() - interval '60 seconds'
  AND last_lobby_foregrounded_at IS NULL;

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
DECLARE
  v_mutual boolean := false;
  v_session_id uuid;
  v_actor_status text;
  v_target_status text;
  v_actor_foregrounded_at timestamptz;
  v_target_foregrounded_at timestamptz;
  v_actor_present boolean := false;
  v_target_present boolean := false;
  v_super_count integer;
  v_recent_super boolean;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object('result', 'unauthorized');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_registrations
    WHERE event_id = p_event_id AND profile_id = p_actor_id AND admission_status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('result', 'not_registered');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_registrations
    WHERE event_id = p_event_id AND profile_id = p_target_id AND admission_status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('result', 'target_not_found');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.events ev
    WHERE ev.id = p_event_id
      AND (ev.status = 'cancelled' OR ev.archived_at IS NOT NULL)
  ) THEN
    RETURN jsonb_build_object('result', 'event_not_active', 'reason', 'cancelled_or_archived');
  END IF;

  IF is_blocked(p_actor_id, p_target_id) THEN
    RETURN jsonb_build_object('result', 'blocked');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_reports
    WHERE reporter_id = p_actor_id AND reported_id = p_target_id
  ) THEN
    RETURN jsonb_build_object('result', 'reported');
  END IF;

  IF public.is_profile_hidden(p_actor_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'account_paused',
      'message', 'Your account is currently on a break'
    );
  END IF;

  IF public.is_profile_hidden(p_target_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'target_unavailable',
      'message', 'This profile is no longer available'
    );
  END IF;

  IF p_swipe_type = 'pass' THEN
    INSERT INTO public.event_swipes (event_id, actor_id, target_id, swipe_type)
    VALUES (p_event_id, p_actor_id, p_target_id, 'pass')
    ON CONFLICT (event_id, actor_id, target_id) DO NOTHING;

    RETURN jsonb_build_object('result', 'pass_recorded');
  END IF;

  IF p_swipe_type = 'super_vibe' THEN
    SELECT COUNT(*) INTO v_super_count
    FROM public.event_swipes
    WHERE event_id = p_event_id
      AND actor_id = p_actor_id
      AND swipe_type = 'super_vibe';

    IF v_super_count >= 3 THEN
      RETURN jsonb_build_object('result', 'limit_reached');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.event_swipes
      WHERE actor_id = p_actor_id
        AND target_id = p_target_id
        AND swipe_type = 'super_vibe'
        AND created_at > now() - interval '30 days'
    ) INTO v_recent_super;

    IF v_recent_super THEN
      RETURN jsonb_build_object('result', 'already_super_vibed_recently');
    END IF;
  END IF;

  INSERT INTO public.event_swipes (event_id, actor_id, target_id, swipe_type)
  VALUES (p_event_id, p_actor_id, p_target_id, p_swipe_type)
  ON CONFLICT (event_id, actor_id, target_id) DO NOTHING;

  SELECT EXISTS (
    SELECT 1
    FROM public.event_swipes
    WHERE event_id = p_event_id
      AND actor_id = p_target_id
      AND target_id = p_actor_id
      AND swipe_type IN ('vibe', 'super_vibe')
  ) INTO v_mutual;

  IF v_mutual THEN
    SELECT er.queue_status, er.last_lobby_foregrounded_at
    INTO v_actor_status, v_actor_foregrounded_at
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_actor_id
      AND er.admission_status = 'confirmed'
    FOR UPDATE;

    SELECT er.queue_status, er.last_lobby_foregrounded_at
    INTO v_target_status, v_target_foregrounded_at
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_target_id
      AND er.admission_status = 'confirmed'
    FOR UPDATE;

    v_actor_present :=
      v_actor_status IN ('browsing', 'idle')
      AND v_actor_foregrounded_at IS NOT NULL
      AND v_actor_foregrounded_at >= now() - interval '60 seconds';

    v_target_present :=
      v_target_status IN ('browsing', 'idle')
      AND v_target_foregrounded_at IS NOT NULL
      AND v_target_foregrounded_at >= now() - interval '60 seconds';

    INSERT INTO public.video_sessions (
      event_id,
      participant_1_id,
      participant_2_id,
      ready_gate_status,
      ready_gate_expires_at
    )
    VALUES (
      p_event_id,
      LEAST(p_actor_id, p_target_id),
      GREATEST(p_actor_id, p_target_id),
      CASE
        WHEN v_actor_present AND v_target_present THEN 'ready'
        ELSE 'queued'
      END,
      CASE
        WHEN v_actor_present AND v_target_present THEN now() + interval '30 seconds'
        ELSE NULL
      END
    )
    ON CONFLICT (event_id, participant_1_id, participant_2_id) DO NOTHING
    RETURNING id INTO v_session_id;

    IF v_session_id IS NULL THEN
      RETURN jsonb_build_object('result', 'already_matched');
    END IF;

    IF v_actor_present AND v_target_present THEN
      UPDATE public.event_registrations
      SET
        queue_status = 'in_ready_gate',
        current_room_id = v_session_id,
        current_partner_id = CASE
          WHEN profile_id = p_actor_id THEN p_target_id
          ELSE p_actor_id
        END,
        last_active_at = now()
      WHERE event_id = p_event_id
        AND profile_id IN (p_actor_id, p_target_id);

      RETURN jsonb_build_object(
        'result', 'match',
        'match_id', v_session_id,
        'video_session_id', v_session_id,
        'event_id', p_event_id,
        'immediate', true
      );
    END IF;

    RETURN jsonb_build_object(
      'result', 'match_queued',
      'match_id', v_session_id,
      'video_session_id', v_session_id,
      'event_id', p_event_id
    );
  END IF;

  IF p_swipe_type = 'super_vibe' THEN
    RETURN jsonb_build_object('result', 'super_vibe_sent');
  END IF;

  RETURN jsonb_build_object('result', 'vibe_recorded');
END;
$function$;

CREATE OR REPLACE FUNCTION public.drain_match_queue(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_match record;
  v_partner_id uuid;
  v_partner_status text;
  v_partner_foregrounded_at timestamptz;
  v_self_status text;
  v_self_foregrounded_at timestamptz;
  v_self_present boolean := false;
  v_partner_present boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error', 'unauthorized');
  END IF;

  SELECT er.queue_status, er.last_lobby_foregrounded_at
  INTO v_self_status, v_self_foregrounded_at
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_uid
    AND er.admission_status = 'confirmed';

  v_self_present :=
    v_self_status IN ('browsing', 'idle')
    AND v_self_foregrounded_at IS NOT NULL
    AND v_self_foregrounded_at >= now() - interval '60 seconds';

  IF NOT v_self_present THEN
    RETURN jsonb_build_object('found', false, 'queued', true);
  END IF;

  SELECT * INTO v_match
  FROM public.video_sessions
  WHERE event_id = p_event_id
    AND ready_gate_status = 'queued'
    AND ((participant_1_id = v_uid) OR (participant_2_id = v_uid))
    AND created_at > now() - interval '10 minutes'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_match IS NULL THEN
    UPDATE public.video_sessions
    SET ready_gate_status = 'expired', ended_at = now()
    WHERE event_id = p_event_id
      AND ready_gate_status = 'queued'
      AND created_at < now() - interval '10 minutes'
      AND ((participant_1_id = v_uid) OR (participant_2_id = v_uid));

    RETURN jsonb_build_object('found', false);
  END IF;

  v_partner_id := CASE
    WHEN v_match.participant_1_id = v_uid THEN v_match.participant_2_id
    ELSE v_match.participant_1_id
  END;

  SELECT er.queue_status, er.last_lobby_foregrounded_at
  INTO v_partner_status, v_partner_foregrounded_at
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_partner_id
    AND er.admission_status = 'confirmed';

  v_partner_present :=
    v_partner_status IN ('browsing', 'idle')
    AND v_partner_foregrounded_at IS NOT NULL
    AND v_partner_foregrounded_at >= now() - interval '60 seconds';

  IF v_partner_present THEN
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'ready',
      ready_gate_expires_at = now() + interval '30 seconds'
    WHERE id = v_match.id;

    UPDATE public.event_registrations
    SET
      queue_status = 'in_ready_gate',
      current_room_id = v_match.id,
      current_partner_id = CASE
        WHEN profile_id = v_uid THEN v_partner_id
        ELSE v_uid
      END,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (v_uid, v_partner_id);

    RETURN jsonb_build_object(
      'found', true,
      'match_id', v_match.id,
      'video_session_id', v_match.id,
      'event_id', p_event_id,
      'partner_id', v_partner_id
    );
  END IF;

  RETURN jsonb_build_object('found', false, 'queued', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ready_gate_transition(
  p_session_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session record;
  v_actor uuid;
  v_is_p1 boolean;
  v_now timestamptz := now();
  v_new_status text;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  v_is_p1 := (v_session.participant_1_id = v_actor);
  IF NOT v_is_p1 AND v_session.participant_2_id != v_actor THEN
    RETURN jsonb_build_object('success', false, 'error', 'access_denied');
  END IF;

  IF v_session.ready_gate_status IN ('forfeited', 'expired', 'both_ready') THEN
    RETURN jsonb_build_object('success', true, 'status', v_session.ready_gate_status);
  END IF;

  IF p_action = 'mark_ready' THEN
    IF v_is_p1 AND v_session.ready_participant_1_at IS NULL THEN
      v_session.ready_participant_1_at := v_now;
    ELSIF NOT v_is_p1 AND v_session.ready_participant_2_at IS NULL THEN
      v_session.ready_participant_2_at := v_now;
    END IF;

    IF v_session.ready_participant_1_at IS NOT NULL
       AND v_session.ready_participant_2_at IS NOT NULL THEN
      v_new_status := 'both_ready';
    ELSIF v_is_p1 THEN
      v_new_status := 'ready_a';
    ELSE
      v_new_status := 'ready_b';
    END IF;

    UPDATE public.video_sessions
    SET
      ready_participant_1_at = v_session.ready_participant_1_at,
      ready_participant_2_at = v_session.ready_participant_2_at,
      ready_gate_status = v_new_status
    WHERE id = p_session_id;

    RETURN jsonb_build_object('success', true, 'status', v_new_status);
  END IF;

  IF p_action = 'snooze' THEN
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'snoozed',
      snoozed_by = v_actor,
      snooze_expires_at = v_now + interval '2 minutes'
    WHERE id = p_session_id;

    RETURN jsonb_build_object('success', true, 'status', 'snoozed');
  END IF;

  IF p_action = 'forfeit' THEN
    UPDATE public.video_sessions
    SET
      ready_gate_status = 'forfeited',
      ready_gate_expires_at = v_now,
      snoozed_by = NULL,
      snooze_expires_at = NULL,
      state = 'ended',
      phase = 'ended',
      ended_at = COALESCE(ended_at, v_now),
      ended_reason = COALESCE(p_reason, ended_reason, 'ready_gate_forfeit'),
      state_updated_at = v_now
    WHERE id = p_session_id;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_session.event_id
      AND profile_id IN (v_session.participant_1_id, v_session.participant_2_id);

    RETURN jsonb_build_object('success', true, 'status', 'forfeited');
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'unknown_action');
END;
$function$;

CREATE OR REPLACE FUNCTION public.video_date_transition(
  p_session_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session record;
  v_actor uuid;
  v_is_p1 boolean;
  v_now timestamptz := now();
  v_allow_handshake boolean;
  v_ev uuid;
  v_p1 uuid;
  v_p2 uuid;
  v_rowcnt bigint;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unauthorized', 'code', 'UNAUTHORIZED');
  END IF;

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session not found', 'code', 'SESSION_NOT_FOUND');
  END IF;

  v_ev := v_session.event_id;
  v_p1 := v_session.participant_1_id;
  v_p2 := v_session.participant_2_id;

  IF v_session.ended_at IS NULL
     AND v_session.reconnect_grace_ends_at IS NOT NULL
     AND v_session.reconnect_grace_ends_at <= v_now THEN
    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'reconnect_grace_expired',
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_session.started_at)))::int)
      ),
      state_updated_at = v_now
    WHERE id = p_session_id;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2);

    RETURN jsonb_build_object(
      'success', true,
      'state', 'ended',
      'reason', 'reconnect_grace_expired'
    );
  END IF;

  v_is_p1 := (v_p1 = v_actor);
  IF NOT v_is_p1 AND v_p2 != v_actor THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied', 'code', 'ACCESS_DENIED');
  END IF;

  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
  v_ev := v_session.event_id;
  v_p1 := v_session.participant_1_id;
  v_p2 := v_session.participant_2_id;

  IF p_action = 'sync_reconnect' THEN
    RETURN jsonb_build_object(
      'success', true,
      'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at,
      'participant_1_away_at', v_session.participant_1_away_at,
      'participant_2_away_at', v_session.participant_2_away_at,
      'ended', v_session.ended_at IS NOT NULL,
      'ended_reason', v_session.ended_reason,
      'state', v_session.state::text,
      'phase', v_session.phase,
      'partner_marked_away',
        CASE
          WHEN v_is_p1 THEN v_session.participant_2_away_at IS NOT NULL
          ELSE v_session.participant_1_away_at IS NOT NULL
        END
    );
  END IF;

  IF p_action = 'mark_reconnect_partner_away' THEN
    IF v_session.ended_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Session has ended', 'code', 'SESSION_ENDED');
    END IF;
    IF v_session.state NOT IN ('handshake'::public.video_date_state, 'date'::public.video_date_state) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Not in reconnect-eligible phase', 'code', 'INVALID_PHASE');
    END IF;

    UPDATE public.video_sessions
    SET
      participant_1_away_at = CASE WHEN v_is_p1 THEN participant_1_away_at ELSE v_now END,
      participant_2_away_at = CASE WHEN v_is_p1 THEN v_now ELSE participant_2_away_at END,
      reconnect_grace_ends_at = COALESCE(reconnect_grace_ends_at, v_now + interval '30 seconds'),
      state_updated_at = v_now
    WHERE id = p_session_id;

    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

    RETURN jsonb_build_object(
      'success', true,
      'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at,
      'participant_1_away_at', v_session.participant_1_away_at,
      'participant_2_away_at', v_session.participant_2_away_at
    );
  END IF;

  IF p_action = 'mark_reconnect_return' THEN
    IF v_session.ended_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Session has ended', 'code', 'SESSION_ENDED');
    END IF;

    UPDATE public.video_sessions
    SET
      participant_1_away_at = CASE WHEN v_is_p1 THEN NULL ELSE participant_1_away_at END,
      participant_2_away_at = CASE WHEN v_is_p1 THEN participant_2_away_at ELSE NULL END,
      state_updated_at = v_now
    WHERE id = p_session_id;

    UPDATE public.video_sessions
    SET
      reconnect_grace_ends_at = CASE
        WHEN participant_1_away_at IS NULL AND participant_2_away_at IS NULL THEN NULL
        ELSE reconnect_grace_ends_at
      END,
      state_updated_at = v_now
    WHERE id = p_session_id;

    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;

    RETURN jsonb_build_object(
      'success', true,
      'reconnect_grace_ends_at', v_session.reconnect_grace_ends_at,
      'participant_1_away_at', v_session.participant_1_away_at,
      'participant_2_away_at', v_session.participant_2_away_at
    );
  END IF;

  IF p_action = 'enter_handshake' THEN
    IF v_session.ended_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Session has ended', 'code', 'SESSION_ENDED');
    END IF;

    IF v_session.handshake_started_at IS NULL THEN
      v_allow_handshake :=
        COALESCE(v_session.ready_gate_status, '') = 'both_ready'
        OR v_session.state IN ('handshake'::public.video_date_state, 'date'::public.video_date_state)
        OR v_session.phase IN ('handshake', 'date');

      IF NOT v_allow_handshake THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'Both participants must be ready before starting the video date',
          'code', 'READY_GATE_NOT_READY'
        );
      END IF;
    END IF;

    UPDATE public.video_sessions
    SET
      state = 'handshake',
      phase = 'handshake',
      handshake_started_at = COALESCE(handshake_started_at, v_now),
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = 'in_handshake',
      current_room_id = p_session_id,
      current_partner_id = CASE
        WHEN profile_id = v_p1 THEN v_p2
        ELSE v_p1
      END,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2);

    RETURN jsonb_build_object('success', true, 'state', 'handshake');
  END IF;

  IF p_action = 'vibe' THEN
    IF v_is_p1 THEN
      UPDATE public.video_sessions
      SET participant_1_liked = TRUE, state_updated_at = v_now
      WHERE id = p_session_id AND ended_at IS NULL;
    ELSE
      UPDATE public.video_sessions
      SET participant_2_liked = TRUE, state_updated_at = v_now
      WHERE id = p_session_id AND ended_at IS NULL;
    END IF;

    UPDATE public.video_sessions
    SET
      state = 'date',
      phase = 'date',
      date_started_at = COALESCE(date_started_at, v_now),
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL
      AND participant_1_liked IS TRUE
      AND participant_2_liked IS TRUE;

    GET DIAGNOSTICS v_rowcnt = ROW_COUNT;
    IF v_rowcnt > 0 THEN
      UPDATE public.event_registrations
      SET
        queue_status = 'in_date',
        current_room_id = p_session_id,
        current_partner_id = CASE
          WHEN profile_id = v_p1 THEN v_p2
          ELSE v_p1
        END,
        last_active_at = v_now
      WHERE event_id = v_ev
        AND profile_id IN (v_p1, v_p2);
    END IF;

    RETURN jsonb_build_object('success', true);
  END IF;

  IF p_action = 'complete_handshake' THEN
    SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
    v_ev := v_session.event_id;
    v_p1 := v_session.participant_1_id;
    v_p2 := v_session.participant_2_id;

    IF v_session.participant_1_liked IS TRUE AND v_session.participant_2_liked IS TRUE THEN
      UPDATE public.video_sessions
      SET
        state = 'date',
        phase = 'date',
        date_started_at = COALESCE(date_started_at, v_now),
        reconnect_grace_ends_at = NULL,
        participant_1_away_at = NULL,
        participant_2_away_at = NULL,
        state_updated_at = v_now
      WHERE id = p_session_id AND ended_at IS NULL;

      UPDATE public.event_registrations
      SET
        queue_status = 'in_date',
        current_room_id = p_session_id,
        current_partner_id = CASE
          WHEN profile_id = v_p1 THEN v_p2
          ELSE v_p1
        END,
        last_active_at = v_now
      WHERE event_id = v_ev
        AND profile_id IN (v_p1, v_p2);

      RETURN jsonb_build_object('success', true, 'state', 'date');
    END IF;

    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = COALESCE(ended_at, v_now),
      ended_reason = COALESCE(p_reason, 'handshake_not_mutual'),
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

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = v_ev
      AND profile_id IN (v_p1, v_p2);

    RETURN jsonb_build_object('success', true, 'state', 'ended');
  END IF;

  IF p_action = 'end' THEN
    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = COALESCE(ended_at, v_now),
      ended_reason = COALESCE(p_reason, ended_reason, 'ended_by_participant'),
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_session.started_at)))::int)
      ),
      state_updated_at = v_now
    WHERE id = p_session_id
      AND ended_at IS NULL;

    GET DIAGNOSTICS v_rowcnt = ROW_COUNT;

    IF v_rowcnt > 0 THEN
      IF COALESCE(p_reason, '') = 'beforeunload' THEN
        UPDATE public.event_registrations
        SET
          queue_status = 'offline',
          current_room_id = NULL,
          current_partner_id = NULL,
          last_active_at = v_now
        WHERE event_id = v_ev
          AND profile_id IN (v_p1, v_p2);
      ELSIF COALESCE(p_reason, '') = 'reconnect_grace_expired' THEN
        UPDATE public.event_registrations
        SET
          queue_status = 'idle',
          current_room_id = NULL,
          current_partner_id = NULL,
          last_active_at = v_now
        WHERE event_id = v_ev
          AND profile_id IN (v_p1, v_p2);
      ELSE
        UPDATE public.event_registrations
        SET
          queue_status = 'in_survey',
          current_room_id = NULL,
          current_partner_id = NULL,
          dates_completed = COALESCE(dates_completed, 0) + 1,
          last_active_at = v_now
        WHERE event_id = v_ev
          AND profile_id IN (v_p1, v_p2);
      END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'state', 'ended');
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'Unknown action', 'code', 'UNKNOWN_ACTION');
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_participant_status(
  p_event_id uuid,
  p_status text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.event_registrations
  SET
    queue_status = p_status,
    last_active_at = v_now,
    last_lobby_foregrounded_at = CASE
      WHEN p_status = 'browsing' THEN v_now
      ELSE last_lobby_foregrounded_at
    END
  WHERE event_id = p_event_id
    AND profile_id = v_uid;
END;
$function$;
