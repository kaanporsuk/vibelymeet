-- Handle-swipe UX hardening:
-- - A user who just swiped is foreground-present by definition, so refresh their lobby
--   foreground stamp before mutual-match eligibility is evaluated.
-- - Serialize the pair's swipe record/check path to avoid simultaneous mutual-swipe races.
-- - Return the existing video_session id on already_matched so the losing client can open
--   Ready Gate immediately instead of waiting for a realtime tick.

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
  v_existing_status text;
  v_actor_status text;
  v_target_status text;
  v_actor_foregrounded_at timestamptz;
  v_target_foregrounded_at timestamptz;
  v_actor_present boolean := false;
  v_target_present boolean := false;
  v_super_count integer;
  v_recent_super boolean;
  v_t0 timestamptz;
  v_now timestamptz := now();
  v_ms integer;
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
      'message', 'Your profile is currently hidden from discovery'
    );
  END IF;

  IF NOT public.is_profile_discoverable(p_target_id, p_actor_id) THEN
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
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        'handle_swipe_super_vibe_cap:' || p_event_id::text || ':' || p_actor_id::text,
        0
      )
    );

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
        AND created_at > v_now - interval '30 days'
    ) INTO v_recent_super;

    IF v_recent_super THEN
      RETURN jsonb_build_object('result', 'already_super_vibed_recently');
    END IF;
  END IF;

  -- Serialize non-pass swipes for the pair before recording/checking mutuality.
  -- Otherwise exact simultaneous Vibes can both miss the other transaction's uncommitted row.
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

  IF v_mutual THEN
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
      AND v_actor_foregrounded_at >= v_now - interval '60 seconds';

    v_target_present :=
      v_target_status IN ('browsing', 'idle')
      AND v_target_foregrounded_at IS NOT NULL
      AND v_target_foregrounded_at >= v_now - interval '60 seconds';

    IF EXISTS (
      SELECT 1
      FROM public.video_sessions z
      WHERE z.event_id = p_event_id
        AND z.ended_at IS NULL
        AND NOT (
          z.participant_1_id = LEAST(p_actor_id, p_target_id)
          AND z.participant_2_id = GREATEST(p_actor_id, p_target_id)
        )
        AND (
          z.participant_1_id IN (p_actor_id, p_target_id)
          OR z.participant_2_id IN (p_actor_id, p_target_id)
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
        jsonb_build_object('swipe_type', p_swipe_type, 'mutual', true)
      );
      RETURN jsonb_build_object('result', 'participant_has_active_session_conflict');
    END IF;

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
      CASE
        WHEN v_actor_present AND v_target_present THEN 'ready'
        ELSE 'queued'
      END,
      CASE
        WHEN v_actor_present AND v_target_present THEN v_now + interval '30 seconds'
        ELSE NULL
      END,
      CASE
        WHEN v_actor_present AND v_target_present THEN NULL
        ELSE v_now + interval '10 minutes'
      END
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

      IF v_session_id IS NOT NULL THEN
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
      END IF;

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
        'result', 'already_matched',
        'match_id', v_session_id,
        'video_session_id', v_session_id,
        'event_id', p_event_id,
        'immediate', v_existing_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'),
        'ready_gate_status', v_existing_status
      );
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
        'result', 'match',
        'match_id', v_session_id,
        'video_session_id', v_session_id,
        'event_id', p_event_id,
        'immediate', true
      );
    END IF;

    UPDATE public.event_registrations
    SET
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
      'queued',
      'match_queued',
      v_ms,
      p_event_id,
      p_actor_id,
      v_session_id,
      jsonb_build_object(
        'swipe_type', p_swipe_type,
        'mutual', true,
        'immediate', false
      )
    );

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

GRANT EXECUTE ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) IS
  'Swipe-first event matching. Pair swipes are serialized; actor swipes refresh foreground presence; simultaneous already_matched responses return the active video_sessions.id.';
