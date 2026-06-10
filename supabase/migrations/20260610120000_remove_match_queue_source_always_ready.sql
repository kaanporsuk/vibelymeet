-- Remove queued-session creation from the Event Lobby swipe source.
--
-- Golden flow: Event Lobby -> pass/vibe -> immediate mutual match -> Ready Gate.
-- Prior cleanup (20260610000100 / 20260610022531) dropped the queue drain/hint/
-- promotion helpers and converted any 'match_queued' fallback to a Ready Gate
-- 'ready' session inside the swipe wrapper. This forward-only change removes the
-- queued branch at its source: a mutual match now always inserts a 'ready'
-- Ready Gate session and returns 'match'. The swipe path never creates a
-- 'queued' video_sessions row and never returns 'match_queued'.
--
-- The deck-authority wrapper's post-hoc queued->ready promotion becomes dead and
-- is collapsed to a pass-through. queued_expires_at and the 'queued' status value
-- are left in place as inert/vestigial (always NULL / unused) to avoid touching
-- the shared video_session_blocks_global_active_conflict guard and generated
-- types; they carry no live writer after this change.

CREATE OR REPLACE FUNCTION public.handle_swipe_20260506090000_stale_room_base(
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
  v_active record;
  v_inactive_reason text;
  v_existing_swipe_type text;
  v_existing_swipe_created_at timestamptz;
  v_mutual boolean := false;
  v_session_id uuid;
  v_existing_status text;
  v_super_count integer;
  v_recent_super boolean;
  v_t0 timestamptz;
  v_now timestamptz := now();
  v_ms integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object('success', false, 'result', 'unauthorized', 'error', 'unauthorized');
  END IF;

  IF p_swipe_type NOT IN ('pass', 'vibe', 'super_vibe') THEN
    RETURN jsonb_build_object('success', false, 'result', 'invalid_request', 'error', 'invalid_request');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations
    WHERE event_id = p_event_id
      AND profile_id = p_actor_id
      AND admission_status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('success', false, 'result', 'not_registered', 'error', 'not_registered');
  END IF;

  SELECT *
  INTO v_active
  FROM public.lock_event_lobby_scheduled_active_state(p_event_id, v_now);

  IF NOT COALESCE(v_active.is_active, false) THEN
    v_inactive_reason := COALESCE(v_active.reason, 'event_not_active');
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'event_not_active',
      'result', 'event_not_active',
      'error', 'event_not_active',
      'reason', v_inactive_reason,
      'message', 'This event is no longer active.',
      'notification_suppressed', true,
      'dedupe_reason', 'event_not_active'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations
    WHERE event_id = p_event_id
      AND profile_id = p_target_id
      AND admission_status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('success', false, 'result', 'target_not_found', 'error', 'target_not_found');
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
      'message', 'You already met this person in this event. Keep browsing for new people.',
      'notification_suppressed', true,
      'dedupe_reason', 'terminal_encounter_pair'
    );
  END IF;

  IF public.is_blocked(p_actor_id, p_target_id) THEN
    RETURN jsonb_build_object('success', false, 'result', 'blocked', 'error', 'blocked');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_reports
    WHERE reporter_id = p_actor_id
      AND reported_id = p_target_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'result', 'reported', 'error', 'reported');
  END IF;

  IF public.is_profile_hidden(p_actor_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'account_paused',
      'result', 'account_paused',
      'error', 'account_paused',
      'message', 'Resume your account before swiping in this event.',
      'notification_suppressed', true
    );
  END IF;

  IF NOT public.is_profile_discoverable(p_target_id, p_actor_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'target_unavailable',
      'result', 'target_unavailable',
      'error', 'target_unavailable',
      'message', 'This person is no longer available in the lobby.',
      'notification_suppressed', true
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        LEAST(p_actor_id, p_target_id)::text,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        GREATEST(p_actor_id, p_target_id)::text,
      0
    )
  );

  v_t0 := clock_timestamp();

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions z
    WHERE z.event_id = p_event_id
      AND NOT (
        z.participant_1_id = LEAST(p_actor_id, p_target_id)
        AND z.participant_2_id = GREATEST(p_actor_id, p_target_id)
      )
      AND (z.participant_1_id = p_actor_id OR z.participant_2_id = p_actor_id)
      AND public.event_lobby_video_session_blocks_new_match(
        z.ready_gate_status,
        z.state::text,
        z.phase,
        z.handshake_started_at,
        z.date_started_at,
        z.ended_at
      )
  ) THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'handle_swipe',
      'conflict',
      'participant_has_active_session_conflict',
      v_ms,
      p_event_id,
      p_actor_id,
      NULL,
      jsonb_build_object(
        'step', 'pre_swipe_active_session_guard',
        'swipe_type', p_swipe_type,
        'notification_suppressed', true,
        'queued_sessions_browseable', true
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'participant_has_active_session_conflict',
      'result', 'participant_has_active_session_conflict',
      'error', 'participant_has_active_session_conflict',
      'message', 'You are already in a live Ready Gate or video date. Finish it before matching again.',
      'notification_suppressed', true,
      'dedupe_reason', 'active_session_conflict'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions z
    WHERE z.event_id = p_event_id
      AND NOT (
        z.participant_1_id = LEAST(p_actor_id, p_target_id)
        AND z.participant_2_id = GREATEST(p_actor_id, p_target_id)
      )
      AND (z.participant_1_id = p_target_id OR z.participant_2_id = p_target_id)
      AND public.event_lobby_video_session_blocks_new_match(
        z.ready_gate_status,
        z.state::text,
        z.phase,
        z.handshake_started_at,
        z.date_started_at,
        z.ended_at
      )
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'target_unavailable',
      'result', 'target_unavailable',
      'error', 'target_unavailable',
      'message', 'This person is no longer available in the lobby.',
      'notification_suppressed', true,
      'dedupe_reason', 'target_active_session_conflict'
    );
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'handle_swipe_idempotency:' || p_event_id::text || ':' ||
        p_actor_id::text || ':' || p_target_id::text,
      0
    )
  );

  SELECT es.swipe_type, es.created_at
  INTO v_existing_swipe_type, v_existing_swipe_created_at
  FROM public.event_swipes es
  WHERE es.event_id = p_event_id
    AND es.actor_id = p_actor_id
    AND es.target_id = p_target_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_swipe_type IS DISTINCT FROM p_swipe_type THEN
      RETURN jsonb_build_object(
        'success', false,
        'outcome', 'swipe_already_recorded',
        'result', 'swipe_already_recorded',
        'error', 'swipe_already_recorded',
        'message', 'You already swiped on this person.',
        'existing_swipe_type', v_existing_swipe_type,
        'requested_swipe_type', p_swipe_type,
        'duplicate', true,
        'idempotent', true,
        'replay', true,
        'notification_suppressed', true,
        'dedupe_reason', 'swipe_type_conflict'
      );
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.event_swipes peer
      WHERE peer.event_id = p_event_id
        AND peer.actor_id = p_target_id
        AND peer.target_id = p_actor_id
        AND peer.swipe_type IN ('vibe', 'super_vibe')
        AND v_existing_swipe_type IN ('vibe', 'super_vibe')
    ) INTO v_mutual;

    IF v_mutual THEN
      SELECT vs.id, vs.ready_gate_status
      INTO v_session_id, v_existing_status
      FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND vs.participant_1_id = LEAST(p_actor_id, p_target_id)
        AND vs.participant_2_id = GREATEST(p_actor_id, p_target_id)
        AND vs.ended_at IS NULL
      ORDER BY vs.started_at DESC
      LIMIT 1;

      IF v_session_id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'success', true,
          'outcome', 'already_matched',
          'result', 'already_matched',
          'match_id', v_session_id,
          'video_session_id', v_session_id,
          'event_id', p_event_id,
          'immediate', v_existing_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'),
          'ready_gate_status', v_existing_status,
          'existing_swipe_type', v_existing_swipe_type,
          'requested_swipe_type', p_swipe_type,
          'duplicate', true,
          'idempotent', true,
          'replay', true,
          'notification_suppressed', true,
          'dedupe_reason', 'existing_match'
        );
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'outcome', 'already_swiped',
      'result', 'already_swiped',
      'existing_swipe_type', v_existing_swipe_type,
      'requested_swipe_type', p_swipe_type,
      'duplicate', true,
      'idempotent', true,
      'replay', true,
      'notification_suppressed', true,
      'dedupe_reason', 'existing_swipe',
      'swipe_recorded_at', v_existing_swipe_created_at
    );
  END IF;

  IF p_swipe_type = 'pass' THEN
    INSERT INTO public.event_swipes (event_id, actor_id, target_id, swipe_type)
    VALUES (p_event_id, p_actor_id, p_target_id, 'pass')
    ON CONFLICT (event_id, actor_id, target_id) DO NOTHING;

    RETURN jsonb_build_object('success', true, 'outcome', 'pass_recorded', 'result', 'pass_recorded');
  END IF;

  IF p_swipe_type = 'super_vibe' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'handle_swipe_super_vibe_cap:' || p_event_id::text || ':' || p_actor_id::text,
        0
      )
    );

    SELECT COUNT(*)
    INTO v_super_count
    FROM public.event_swipes
    WHERE event_id = p_event_id
      AND actor_id = p_actor_id
      AND swipe_type = 'super_vibe';

    IF v_super_count >= 3 THEN
      RETURN jsonb_build_object('success', true, 'outcome', 'limit_reached', 'result', 'limit_reached');
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.event_swipes
      WHERE actor_id = p_actor_id
        AND target_id = p_target_id
        AND swipe_type = 'super_vibe'
        AND created_at > v_now - interval '30 days'
    ) INTO v_recent_super;

    IF v_recent_super THEN
      RETURN jsonb_build_object(
        'success', true,
        'outcome', 'already_super_vibed_recently',
        'result', 'already_super_vibed_recently'
      );
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'handle_swipe_mutual_pair:' || p_event_id::text || ':' ||
        LEAST(p_actor_id, p_target_id)::text || ':' ||
        GREATEST(p_actor_id, p_target_id)::text,
      0
    )
  );

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

  IF NOT v_mutual THEN
    IF p_swipe_type = 'super_vibe' THEN
      RETURN jsonb_build_object('success', true, 'outcome', 'super_vibe_sent', 'result', 'super_vibe_sent');
    END IF;

    RETURN jsonb_build_object('success', true, 'outcome', 'vibe_recorded', 'result', 'vibe_recorded');
  END IF;

  v_t0 := clock_timestamp();

  UPDATE public.event_registrations
  SET
    queue_status = 'browsing',
    last_lobby_foregrounded_at = v_now,
    last_active_at = v_now
  WHERE event_id = p_event_id
    AND profile_id = p_actor_id
    AND admission_status = 'confirmed'
    AND (queue_status IS NULL OR queue_status IN ('browsing', 'idle'));

  INSERT INTO public.video_sessions (
    event_id,
    participant_1_id,
    participant_2_id,
    ready_gate_status,
    ready_gate_expires_at,
    queued_expires_at
  )
  VALUES (
    p_event_id,
    LEAST(p_actor_id, p_target_id),
    GREATEST(p_actor_id, p_target_id),
    'ready',
    v_now + interval '30 seconds',
    NULL
  )
  ON CONFLICT (event_id, participant_1_id, participant_2_id) DO NOTHING
  RETURNING id INTO v_session_id;

  IF v_session_id IS NULL THEN
    SELECT id, ready_gate_status
    INTO v_session_id, v_existing_status
    FROM public.video_sessions
    WHERE event_id = p_event_id
      AND participant_1_id = LEAST(p_actor_id, p_target_id)
      AND participant_2_id = GREATEST(p_actor_id, p_target_id)
      AND ended_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1;

    IF v_session_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'outcome', 'pair_already_met_this_event',
        'result', 'pair_already_met_this_event',
        'error', 'pair_already_met_this_event',
        'message', 'You already met this person in this event. Keep browsing for new people.',
        'notification_suppressed', true,
        'dedupe_reason', 'same_event_pair_not_reopenable'
      );
    END IF;

    UPDATE public.event_registrations
    SET
      queue_status = CASE
        WHEN v_existing_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed') THEN 'in_ready_gate'
        ELSE queue_status
      END,
      current_room_id = v_session_id,
      current_partner_id = CASE
        WHEN profile_id = p_actor_id THEN p_target_id
        ELSE p_actor_id
      END,
      last_active_at = v_now
    WHERE event_id = p_event_id
      AND profile_id IN (p_actor_id, p_target_id)
      AND (queue_status IS NULL OR queue_status NOT IN ('in_handshake', 'in_date', 'in_survey'));

    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'handle_swipe',
      'no_op',
      'already_matched',
      v_ms,
      p_event_id,
      p_actor_id,
      v_session_id,
      jsonb_build_object(
        'swipe_type', p_swipe_type,
        'mutual', true,
        'ready_gate_status', v_existing_status
      )
    );

    RETURN jsonb_build_object(
      'success', true,
      'outcome', 'already_matched',
      'result', 'already_matched',
      'match_id', v_session_id,
      'video_session_id', v_session_id,
      'event_id', p_event_id,
      'immediate', v_existing_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'),
      'ready_gate_status', v_existing_status,
      'notification_suppressed', true,
      'dedupe_reason', 'existing_match'
    );
  END IF;

  UPDATE public.event_registrations
  SET
    queue_status = 'in_ready_gate',
    current_room_id = v_session_id,
    current_partner_id = CASE
      WHEN profile_id = p_actor_id THEN p_target_id
      ELSE p_actor_id
    END,
    last_active_at = v_now
  WHERE event_id = p_event_id
    AND profile_id IN (p_actor_id, p_target_id);

  v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
  PERFORM public.record_event_loop_observability(
    'handle_swipe',
    'success',
    'match_immediate',
    v_ms,
    p_event_id,
    p_actor_id,
    v_session_id,
    jsonb_build_object(
      'swipe_type', p_swipe_type,
      'mutual', true,
      'immediate', true
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'outcome', 'match',
    'result', 'match',
    'match_id', v_session_id,
    'video_session_id', v_session_id,
    'event_id', p_event_id,
    'immediate', true,
    'ready_gate_status', 'ready'
  );
END;
$function$;

COMMENT ON FUNCTION public.handle_swipe_20260506090000_stale_room_base(uuid, uuid, uuid, text) IS
  'Swipe-first event matching base. A mutual vibe/super_vibe always opens a ready Ready Gate session (result=match, immediate). The queued-session branch and match_queued outcome were removed; queued_expires_at is left inert.';

-- Collapse the deck-authority wrapper to a pass-through: the base never returns
-- 'match_queued' anymore, so the queued->ready promotion is dead code. Super Vibe
-- consumed truth is preserved by the inner auto-next/super-vibe base.
CREATE OR REPLACE FUNCTION public.handle_swipe_20260601183000_deck_authority_base(
  p_event_id uuid,
  p_actor_id uuid,
  p_target_id uuid,
  p_swipe_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN public.handle_swipe_20260610000100_auto_next_base(
    p_event_id,
    p_actor_id,
    p_target_id,
    p_swipe_type
  );
END;
$function$;

COMMENT ON FUNCTION public.handle_swipe_20260601183000_deck_authority_base(uuid, uuid, uuid, text) IS
  'Swipe mutation base wrapper. Pass-through after queued-session removal: every mutual match is an immediate Ready Gate session, so no match_queued promotion is needed.';
