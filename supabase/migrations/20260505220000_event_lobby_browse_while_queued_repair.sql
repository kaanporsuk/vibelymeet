-- Event Lobby queued-browse repair.
--
-- Product contract: queued Ready Gate matches are browseable. A queued
-- video_sessions row must not block passes, one-way swipes, additional queued
-- mutuals, or FIFO promotion of another queued row. Only non-ended active
-- Ready Gate, handshake, date, snoozed, or both-ready sessions block new matching.

CREATE OR REPLACE FUNCTION public.event_lobby_video_session_blocks_new_match(
  p_ready_gate_status text,
  p_state text,
  p_phase text,
  p_handshake_started_at timestamptz,
  p_date_started_at timestamptz,
  p_ended_at timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT p_ended_at IS NULL
    AND COALESCE(p_ready_gate_status, '') <> 'queued'
    AND (
      p_ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
      OR p_state IN ('handshake', 'date')
      OR p_phase IN ('handshake', 'date')
      OR p_handshake_started_at IS NOT NULL
      OR p_date_started_at IS NOT NULL
    );
$function$;

REVOKE ALL ON FUNCTION public.event_lobby_video_session_blocks_new_match(text, text, text, timestamptz, timestamptz, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_lobby_video_session_blocks_new_match(text, text, text, timestamptz, timestamptz, timestamptz)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.event_lobby_video_session_blocks_new_match(text, text, text, timestamptz, timestamptz, timestamptz) IS
  'True only for non-ended, non-queued Ready Gate/handshake/date sessions that block creating another match. Queued sessions are browseable.';

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
          AND (
            vs.participant_1_id = base.profile_id
            OR vs.participant_2_id = base.profile_id
          )
          AND public.event_lobby_video_session_blocks_new_match(
            vs.ready_gate_status,
            vs.state::text,
            vs.phase,
            vs.handshake_started_at,
            vs.date_started_at,
            vs.ended_at
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

COMMENT ON FUNCTION public.get_event_deck(uuid, uuid, integer) IS
  'Event deck RPC. Queued matches remain browseable; terminal same-event pairs and true non-queued active sessions are hidden.';

DROP FUNCTION IF EXISTS public.handle_swipe_20260505220000_queued_browse_base(uuid, uuid, uuid, text);
ALTER FUNCTION public.handle_swipe(uuid, uuid, uuid, text)
  RENAME TO handle_swipe_20260505220000_queued_browse_base;
REVOKE ALL ON FUNCTION public.handle_swipe_20260505220000_queued_browse_base(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_swipe_20260505220000_queued_browse_base(uuid, uuid, uuid, text)
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
DECLARE
  v_active record;
  v_inactive_reason text;
  v_existing_swipe_type text;
  v_existing_swipe_created_at timestamptz;
  v_mutual boolean := false;
  v_session_id uuid;
  v_existing_status text;
  v_actor_status text;
  v_target_status text;
  v_actor_foregrounded_at timestamptz;
  v_target_foregrounded_at timestamptz;
  v_actor_present boolean := false;
  v_target_present boolean := false;
  v_has_queued_session boolean := false;
  v_create_queued boolean := false;
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
    AND v_actor_foregrounded_at >= v_now - interval '120 seconds';

  v_target_present :=
    v_target_status IN ('browsing', 'idle')
    AND v_target_foregrounded_at IS NOT NULL
    AND v_target_foregrounded_at >= v_now - interval '120 seconds';

  SELECT EXISTS (
    SELECT 1
    FROM public.video_sessions z
    WHERE z.event_id = p_event_id
      AND z.ended_at IS NULL
      AND z.ready_gate_status = 'queued'
      AND (
        z.participant_1_id IN (p_actor_id, p_target_id)
        OR z.participant_2_id IN (p_actor_id, p_target_id)
      )
      AND NOT (
        z.participant_1_id = LEAST(p_actor_id, p_target_id)
        AND z.participant_2_id = GREATEST(p_actor_id, p_target_id)
      )
  ) INTO v_has_queued_session;

  v_create_queued := v_has_queued_session OR NOT (v_actor_present AND v_target_present);

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
    CASE WHEN v_create_queued THEN 'queued' ELSE 'ready' END,
    CASE WHEN v_create_queued THEN NULL ELSE v_now + interval '30 seconds' END,
    CASE WHEN v_create_queued THEN v_now + interval '10 minutes' ELSE NULL END
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

  IF NOT v_create_queued THEN
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
    AND profile_id IN (p_actor_id, p_target_id)
    AND (queue_status IS NULL OR queue_status IN ('browsing', 'idle'));

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
      'immediate', false,
      'queued_sessions_browseable', true,
      'existing_queued_session', v_has_queued_session
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'outcome', 'match_queued',
    'result', 'match_queued',
    'match_id', v_session_id,
    'video_session_id', v_session_id,
    'event_id', p_event_id,
    'immediate', false,
    'ready_gate_status', 'queued'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) IS
  'Swipe-first event matching. Queued matches are browseable; additional mutuals while queued create queued sessions, while only true non-queued active sessions block new matching.';

DROP FUNCTION IF EXISTS public.promote_ready_gate_20260505220000_queued_browse_base(uuid, uuid);
ALTER FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid)
  RENAME TO promote_ready_gate_20260505220000_queued_browse_base;
REVOKE ALL ON FUNCTION public.promote_ready_gate_20260505220000_queued_browse_base(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_ready_gate_20260505220000_queued_browse_base(uuid, uuid)
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
  v_t0 timestamptz := clock_timestamp();
  v_ms integer;
  v_actor uuid := auth.uid();
  v_is_service_role boolean := auth.role() = 'service_role';
  v_active record;
  v_inactive_reason text;
  v_match record;
  v_partner_id uuid;
  v_p_low uuid;
  v_p_high uuid;
  v_er_low record;
  v_er_high record;
  v_self record;
  v_partner record;
  v_self_present boolean := false;
  v_partner_present boolean := false;
BEGIN
  IF NOT v_is_service_role
     AND (v_actor IS NULL OR v_actor IS DISTINCT FROM p_uid) THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'error',
      'unauthorized',
      v_ms,
      p_event_id,
      v_actor,
      NULL,
      jsonb_build_object('step', 'auth_guard', 'requested_uid', p_uid)
    );
    RETURN jsonb_build_object('promoted', false, 'reason', 'unauthorized');
  END IF;

  SELECT *
  INTO v_active
  FROM public.lock_event_lobby_scheduled_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    v_inactive_reason := COALESCE(v_active.reason, 'event_not_active');
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'blocked',
      'event_not_valid',
      v_ms,
      p_event_id,
      p_uid,
      NULL,
      jsonb_build_object('step', 'active_event_guard', 'inactive_reason', v_inactive_reason)
    );
    RETURN jsonb_build_object(
      'promoted', false,
      'reason', 'event_not_valid',
      'inactive_reason', v_inactive_reason
    );
  END IF;

  SELECT vs.*
  INTO v_match
  FROM public.video_sessions vs
  WHERE vs.event_id = p_event_id
    AND vs.ready_gate_status = 'queued'
    AND vs.ended_at IS NULL
    AND COALESCE(vs.queued_expires_at, COALESCE(vs.started_at, now()) + interval '10 minutes') > now()
    AND (vs.participant_1_id = p_uid OR vs.participant_2_id = p_uid)
  ORDER BY vs.started_at ASC NULLS LAST, vs.id ASC
  LIMIT 1
  FOR UPDATE OF vs SKIP LOCKED;

  IF NOT FOUND THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'no_op',
      'no_queued_session',
      v_ms,
      p_event_id,
      p_uid,
      NULL,
      jsonb_build_object('step', 'pick_queued_session')
    );
    RETURN jsonb_build_object('promoted', false, 'reason', 'no_queued_session');
  END IF;

  v_partner_id := CASE
    WHEN v_match.participant_1_id = p_uid THEN v_match.participant_2_id
    ELSE v_match.participant_1_id
  END;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        LEAST(p_uid, v_partner_id)::text,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'event_lobby_participant_session:' || p_event_id::text || ':' ||
        GREATEST(p_uid, v_partner_id)::text,
      0
    )
  );

  IF public.video_date_pair_has_terminal_encounter(p_event_id, p_uid, v_partner_id, v_match.id) THEN
    UPDATE public.video_sessions
    SET
      ended_at = COALESCE(ended_at, now()),
      ended_reason = COALESCE(ended_reason, 'pair_already_met_this_event'),
      state = 'ended'::public.video_date_state,
      phase = 'ended',
      state_updated_at = now()
    WHERE id = v_match.id
      AND ended_at IS NULL;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id IN (p_uid, v_partner_id)
      AND (
        current_room_id = v_match.id
        OR queue_status IN ('in_ready_gate', 'in_handshake', 'in_date')
      );

    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'blocked',
      'pair_already_met_this_event',
      NULL,
      p_event_id,
      p_uid,
      v_match.id,
      jsonb_build_object(
        'partner_id', v_partner_id,
        'terminal_encounter_pair', true
      )
    );

    RETURN jsonb_build_object(
      'promoted', false,
      'reason', 'pair_already_met_this_event',
      'session_id', v_match.id
    );
  END IF;

  v_p_low := LEAST(v_match.participant_1_id, v_match.participant_2_id);
  v_p_high := GREATEST(v_match.participant_1_id, v_match.participant_2_id);

  SELECT *
  INTO v_er_low
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_p_low
  FOR UPDATE;

  IF NOT FOUND THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'blocked',
      'registration_missing',
      v_ms,
      p_event_id,
      p_uid,
      v_match.id,
      jsonb_build_object('step', 'lock_registration_low')
    );
    RETURN jsonb_build_object('promoted', false, 'reason', 'registration_missing');
  END IF;

  SELECT *
  INTO v_er_high
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_p_high
  FOR UPDATE;

  IF NOT FOUND THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'blocked',
      'registration_missing',
      v_ms,
      p_event_id,
      p_uid,
      v_match.id,
      jsonb_build_object('step', 'lock_registration_high')
    );
    RETURN jsonb_build_object('promoted', false, 'reason', 'registration_missing');
  END IF;

  IF v_er_low.profile_id = p_uid THEN
    v_self := v_er_low;
    v_partner := v_er_high;
  ELSE
    v_self := v_er_high;
    v_partner := v_er_low;
  END IF;

  IF v_self.admission_status IS DISTINCT FROM 'confirmed'
     OR v_partner.admission_status IS DISTINCT FROM 'confirmed' THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'blocked',
      'admission_not_confirmed',
      v_ms,
      p_event_id,
      p_uid,
      v_match.id,
      jsonb_build_object('step', 'admission_check')
    );
    RETURN jsonb_build_object('promoted', false, 'reason', 'admission_not_confirmed');
  END IF;

  v_self_present :=
    v_self.queue_status IN ('browsing', 'idle')
    AND v_self.last_lobby_foregrounded_at IS NOT NULL
    AND v_self.last_lobby_foregrounded_at >= now() - interval '120 seconds';

  v_partner_present :=
    v_partner.queue_status IN ('browsing', 'idle')
    AND v_partner.last_lobby_foregrounded_at IS NOT NULL
    AND v_partner.last_lobby_foregrounded_at >= now() - interval '120 seconds';

  IF NOT v_self_present THEN
    UPDATE public.event_registrations
    SET
      last_lobby_foregrounded_at = now(),
      last_active_at = now()
    WHERE event_id = p_event_id
      AND profile_id = p_uid;

    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'blocked',
      'self_not_present',
      v_ms,
      p_event_id,
      p_uid,
      v_match.id,
      jsonb_build_object('step', 'presence_self')
    );
    RETURN jsonb_build_object('promoted', false, 'reason', 'self_not_present');
  END IF;

  IF NOT v_partner_present THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'blocked',
      'partner_not_present',
      v_ms,
      p_event_id,
      p_uid,
      v_match.id,
      jsonb_build_object('step', 'presence_partner')
    );
    RETURN jsonb_build_object('promoted', false, 'reason', 'partner_not_present');
  END IF;

  SELECT *
  INTO v_active
  FROM public.get_event_lobby_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    v_inactive_reason := COALESCE(v_active.reason, 'event_not_active');
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'blocked',
      'event_not_valid',
      v_ms,
      p_event_id,
      p_uid,
      v_match.id,
      jsonb_build_object('step', 'revalidate_event', 'inactive_reason', v_inactive_reason)
    );
    RETURN jsonb_build_object(
      'promoted', false,
      'reason', 'event_not_valid',
      'inactive_reason', v_inactive_reason
    );
  END IF;

  IF v_match.ready_gate_status IS DISTINCT FROM 'queued'
     OR v_match.ended_at IS NOT NULL
     OR COALESCE(v_match.queued_expires_at, COALESCE(v_match.started_at, now()) + interval '10 minutes') <= now() THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'no_op',
      'session_not_promotable',
      v_ms,
      p_event_id,
      p_uid,
      v_match.id,
      jsonb_build_object('step', 'revalidate_session')
    );
    RETURN jsonb_build_object('promoted', false, 'reason', 'session_not_promotable');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.video_sessions z
    WHERE z.event_id = p_event_id
      AND z.id <> v_match.id
      AND (
        z.participant_1_id IN (p_uid, v_partner_id)
        OR z.participant_2_id IN (p_uid, v_partner_id)
      )
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
      'promote_ready_gate_if_eligible',
      'conflict',
      'participant_has_active_session_conflict',
      v_ms,
      p_event_id,
      p_uid,
      v_match.id,
      jsonb_build_object(
        'step', 'pre_promotion_active_session_guard',
        'queued_sessions_browseable', true
      )
    );
    RETURN jsonb_build_object('promoted', false, 'reason', 'participant_has_active_session_conflict');
  END IF;

  UPDATE public.video_sessions
  SET
    ready_gate_status = 'ready',
    ready_gate_expires_at = now() + interval '30 seconds',
    queued_expires_at = NULL
  WHERE id = v_match.id;

  UPDATE public.event_registrations
  SET
    queue_status = 'in_ready_gate',
    current_room_id = v_match.id,
    current_partner_id = CASE
      WHEN profile_id = p_uid THEN v_partner_id
      ELSE p_uid
    END,
    last_active_at = now()
  WHERE event_id = p_event_id
    AND profile_id IN (p_uid, v_partner_id);

  v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
  PERFORM public.record_event_loop_observability(
    'promote_ready_gate_if_eligible',
    'success',
    NULL,
    v_ms,
    p_event_id,
    p_uid,
    v_match.id,
    jsonb_build_object(
      'promoted', true,
      'partner_id', v_partner_id,
      'queued_sessions_browseable', true
    )
  );

  RETURN jsonb_build_object(
    'promoted', true,
    'match_id', v_match.id,
    'video_session_id', v_match.id,
    'event_id', p_event_id,
    'partner_id', v_partner_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid) IS
  'Promotes the oldest queued match only when both users are present. Other queued rows do not block FIFO promotion; true non-queued active sessions still do.';
