-- Event Lobby Ready Gate / queued-match contract hardening.
--
-- Safe launch policy:
-- - Backend deck hides candidates that are already busy in Ready Gate,
--   handshake, date, survey, offline, or any non-lobby foreground status.
-- - Direct swipes acquire ordered participant locks and reject active-session
--   conflicts before event_swipes or video_sessions can be mutated.
-- - Queue promotion acquires the same ordered participant locks and checks for
--   another active session before delegating to the canonical promotion helper.

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
  shared_vibe_count integer
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
  SELECT deck.*
  FROM public.get_event_deck_20260501180000_active_base(
    p_event_id,
    p_user_id,
    p_limit
  ) AS deck
  WHERE COALESCE(deck.queue_status, 'idle') IN ('browsing', 'idle')
    AND NOT EXISTS (
      SELECT 1
      FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND vs.ended_at IS NULL
        AND (
          vs.participant_1_id = deck.profile_id
          OR vs.participant_2_id = deck.profile_id
        )
        AND (
          vs.ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed')
          OR vs.state IN ('handshake', 'date')
          OR vs.phase IN ('handshake', 'date')
          OR vs.handshake_started_at IS NOT NULL
          OR vs.date_started_at IS NOT NULL
        )
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_deck(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_deck(uuid, uuid, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_event_deck(uuid, uuid, integer) IS
  'Event deck RPC. Raises event_not_active unless the event is active; hides busy Ready Gate/handshake/date candidates from normal swipe decks.';

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
  v_ready_gate_status text;
  v_t0 timestamptz;
  v_ms integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object('result', 'unauthorized');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations
    WHERE event_id = p_event_id
      AND profile_id = p_actor_id
      AND admission_status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('result', 'not_registered');
  END IF;

  SELECT *
  INTO v_active
  FROM public.get_event_lobby_active_state(p_event_id, now());

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
    RETURN jsonb_build_object('result', 'target_not_found');
  END IF;

  -- Hold the event row stable before any replay or delegated mutation path.
  PERFORM 1
  FROM public.events ev
  WHERE ev.id = p_event_id
    AND ev.status = 'live'
    AND ev.ended_at IS NULL
    AND ev.archived_at IS NULL
    AND now() >= ev.event_date
    AND now() < (ev.event_date + COALESCE(ev.duration_minutes, 60) * interval '1 minute')
  FOR SHARE OF ev;

  SELECT *
  INTO v_active
  FROM public.get_event_lobby_active_state(p_event_id, now());

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

  IF public.is_blocked(p_actor_id, p_target_id) THEN
    RETURN jsonb_build_object('result', 'blocked');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_reports
    WHERE reporter_id = p_actor_id
      AND reported_id = p_target_id
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

  -- Serialize all session-producing work that involves either participant.
  -- The order prevents opposite-direction queue drains/swipes from deadlocking.
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
      jsonb_build_object(
        'step', 'pre_swipe_active_session_guard',
        'swipe_type', p_swipe_type,
        'notification_suppressed', true
      )
    );
    RETURN jsonb_build_object(
      'success', false,
      'outcome', 'participant_has_active_session_conflict',
      'result', 'participant_has_active_session_conflict',
      'error', 'participant_has_active_session_conflict',
      'notification_suppressed', true,
      'dedupe_reason', 'active_session_conflict'
    );
  END IF;

  -- Serialize the natural idempotency key before checking the existing swipe.
  -- This prevents concurrent duplicate requests from racing past the replay
  -- branch into super-vibe cap accounting or match/session side effects.
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
      INTO v_session_id, v_ready_gate_status
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
          'immediate', v_ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'),
          'ready_gate_status', v_ready_gate_status,
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

  RETURN public.handle_swipe_20260501210000_idempotency_base(
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

COMMENT ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) IS
  'Swipe-first event matching. Enforces active-event, busy-session conflict, participant lock, and natural-key retry idempotency before delegated swipe/session mutation.';

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
  v_admission_status text;
  v_active record;
  v_inactive_reason text;
  v_match_id uuid;
  v_partner_id uuid;
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
      jsonb_build_object(
        'step', 'auth_guard',
        'requested_uid', p_uid
      )
    );
    RETURN jsonb_build_object(
      'promoted', false,
      'reason', 'unauthorized'
    );
  END IF;

  SELECT er.admission_status
  INTO v_admission_status
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = p_uid;

  IF NOT FOUND THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'blocked',
      'registration_missing',
      v_ms,
      p_event_id,
      p_uid,
      NULL,
      jsonb_build_object('step', 'actor_registration_guard')
    );
    RETURN jsonb_build_object(
      'promoted', false,
      'reason', 'registration_missing'
    );
  END IF;

  IF v_admission_status IS DISTINCT FROM 'confirmed' THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'promote_ready_gate_if_eligible',
      'blocked',
      'admission_not_confirmed',
      v_ms,
      p_event_id,
      p_uid,
      NULL,
      jsonb_build_object('step', 'actor_admission_guard')
    );
    RETURN jsonb_build_object(
      'promoted', false,
      'reason', 'admission_not_confirmed'
    );
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
      NULL,
      jsonb_build_object(
        'step', 'active_event_guard',
        'inactive_reason', v_inactive_reason
      )
    );
    RETURN jsonb_build_object(
      'promoted', false,
      'reason', 'event_not_valid',
      'inactive_reason', v_inactive_reason
    );
  END IF;

  -- Hold the event row stable while the delegated promotion helper moves a
  -- queued session into Ready Gate.
  PERFORM 1
  FROM public.events ev
  WHERE ev.id = p_event_id
    AND ev.status = 'live'
    AND ev.ended_at IS NULL
    AND ev.archived_at IS NULL
    AND now() >= ev.event_date
    AND now() < (ev.event_date + COALESCE(ev.duration_minutes, 60) * interval '1 minute')
  FOR SHARE OF ev;

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
      NULL,
      jsonb_build_object(
        'step', 'active_event_lock',
        'inactive_reason', v_inactive_reason
      )
    );
    RETURN jsonb_build_object(
      'promoted', false,
      'reason', 'event_not_valid',
      'inactive_reason', v_inactive_reason
    );
  END IF;

  SELECT
    vs.id,
    CASE
      WHEN vs.participant_1_id = p_uid THEN vs.participant_2_id
      ELSE vs.participant_1_id
    END
  INTO v_match_id, v_partner_id
  FROM public.video_sessions vs
  WHERE vs.event_id = p_event_id
    AND vs.ready_gate_status = 'queued'
    AND vs.ended_at IS NULL
    AND COALESCE(vs.queued_expires_at, COALESCE(vs.started_at, now()) + interval '10 minutes') > now()
    AND (vs.participant_1_id = p_uid OR vs.participant_2_id = p_uid)
  ORDER BY vs.started_at ASC
  LIMIT 1;

  IF v_match_id IS NOT NULL AND v_partner_id IS NOT NULL THEN
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

    IF EXISTS (
      SELECT 1
      FROM public.video_sessions z
      WHERE z.event_id = p_event_id
        AND z.id <> v_match_id
        AND z.ended_at IS NULL
        AND (
          z.participant_1_id IN (p_uid, v_partner_id)
          OR z.participant_2_id IN (p_uid, v_partner_id)
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
        v_match_id,
        jsonb_build_object('step', 'pre_promotion_active_session_guard')
      );
      RETURN jsonb_build_object(
        'promoted', false,
        'reason', 'participant_has_active_session_conflict'
      );
    END IF;
  END IF;

  RETURN public.promote_ready_gate_if_eligible_20260501180000_active_base(
    p_event_id,
    p_uid
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid) IS
  'Promotes queued video_sessions only while canonical active-event state is true and participants have no other active session.';

COMMENT ON FUNCTION public.drain_match_queue(uuid) IS
  'Queue-drain RPC. Requires active live event window, then delegates promotion through promote_ready_gate_if_eligible participant-lock and conflict guards.';
