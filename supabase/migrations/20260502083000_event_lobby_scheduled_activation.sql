-- Event Lobby scheduled activation.
--
-- The lobby opens from the scheduled event window, not from an operator-owned
-- status flip. Terminal/admin hold states still block access.

CREATE OR REPLACE FUNCTION public.get_event_lobby_active_state(
  p_event_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(
  is_active boolean,
  reason text,
  event_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_now timestamptz := COALESCE(p_now, now());
  v_status text;
  v_scheduled_end timestamptz;
BEGIN
  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'event_not_found'::text, NULL::text;
    RETURN;
  END IF;

  v_status := COALESCE(NULLIF(v_event.status, ''), 'upcoming');

  IF v_status = 'draft' THEN
    RETURN QUERY SELECT false, 'event_draft'::text, v_event.status;
    RETURN;
  END IF;

  IF v_status = 'cancelled' THEN
    RETURN QUERY SELECT false, 'event_cancelled'::text, v_event.status;
    RETURN;
  END IF;

  IF v_event.archived_at IS NOT NULL OR v_status = 'archived' THEN
    RETURN QUERY SELECT false, 'event_archived'::text, v_event.status;
    RETURN;
  END IF;

  IF v_event.ended_at IS NOT NULL OR v_status IN ('ended', 'completed') THEN
    RETURN QUERY SELECT false, 'event_ended'::text, v_event.status;
    RETURN;
  END IF;

  IF v_status NOT IN ('upcoming', 'live') THEN
    RETURN QUERY SELECT false, 'event_not_live'::text, v_event.status;
    RETURN;
  END IF;

  IF v_event.event_date IS NULL THEN
    RETURN QUERY SELECT false, 'event_outside_live_window'::text, v_event.status;
    RETURN;
  END IF;

  IF v_now < v_event.event_date THEN
    RETURN QUERY SELECT false, 'event_not_started'::text, v_event.status;
    RETURN;
  END IF;

  v_scheduled_end :=
    v_event.event_date + COALESCE(v_event.duration_minutes, 60) * interval '1 minute';

  IF v_now >= v_scheduled_end THEN
    RETURN QUERY SELECT false, 'event_outside_live_window'::text, v_event.status;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text, v_event.status;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_lobby_active_state(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_lobby_active_state(uuid, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.get_event_lobby_active_state(uuid, timestamptz) IS
  'Internal canonical Event Lobby active-state helper. Active requires no terminal/admin hold state and DB time within event_date + duration_minutes; status upcoming and live are both scheduled-active states.';

CREATE OR REPLACE FUNCTION public.get_event_lobby_inactive_reason(
  p_event_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT state.reason
  FROM public.get_event_lobby_active_state(p_event_id, now()) AS state
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.is_event_lobby_active(
  p_event_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(state.is_active, false)
  FROM public.get_event_lobby_active_state(p_event_id, now()) AS state
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_event_lobby_inactive_reason(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_event_lobby_active(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_lobby_inactive_reason(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_event_lobby_active(uuid) TO service_role;

COMMENT ON FUNCTION public.get_event_lobby_inactive_reason(uuid) IS
  'Compatibility wrapper around get_event_lobby_active_state(uuid, timestamptz). Returns NULL only for scheduled-active Event Lobby events.';

COMMENT ON FUNCTION public.is_event_lobby_active(uuid) IS
  'Compatibility boolean wrapper around get_event_lobby_active_state(uuid, timestamptz).';

CREATE OR REPLACE FUNCTION public.lock_event_lobby_scheduled_active_state(
  p_event_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(
  is_active boolean,
  reason text,
  event_status text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM 1
  FROM public.events ev
  WHERE ev.id = p_event_id
  FOR SHARE OF ev;

  RETURN QUERY
  SELECT state.is_active, state.reason, state.event_status
  FROM public.get_event_lobby_active_state(p_event_id, p_now) AS state;
END;
$function$;

REVOKE ALL ON FUNCTION public.lock_event_lobby_scheduled_active_state(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_event_lobby_scheduled_active_state(uuid, timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.lock_event_lobby_scheduled_active_state(uuid, timestamptz) IS
  'Internal row-locking active-state helper for lobby mutation RPCs. Locks the event row, then applies scheduled-time lobby activation rules.';

DROP FUNCTION IF EXISTS public.handle_swipe_20260502083000_ready_queue_base(uuid, uuid, uuid, text);

ALTER FUNCTION public.handle_swipe(uuid, uuid, uuid, text)
  RENAME TO handle_swipe_20260502083000_ready_queue_base;

REVOKE ALL ON FUNCTION public.handle_swipe_20260502083000_ready_queue_base(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

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
  FROM public.lock_event_lobby_scheduled_active_state(p_event_id, now());

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

  RETURN public.handle_swipe_20260502083000_ready_queue_base(
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
  'Swipe-first event matching. Uses scheduled-time active-event state before delegated swipe/session mutation.';

CREATE OR REPLACE FUNCTION public.handle_swipe_20260501210000_idempotency_base(
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
  v_existing_result text;
  v_mutual boolean := false;
  v_session_id uuid;
  v_ready_gate_status text;
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
  FROM public.lock_event_lobby_scheduled_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    v_inactive_reason := COALESCE(v_active.reason, 'event_not_active');
    RETURN jsonb_build_object(
      'success', false,
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
        'result', 'swipe_already_recorded',
        'error', 'swipe_already_recorded',
        'existing_swipe_type', v_existing_swipe_type,
        'requested_swipe_type', p_swipe_type,
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
          'result', 'already_matched',
          'match_id', v_session_id,
          'video_session_id', v_session_id,
          'event_id', p_event_id,
          'immediate', v_ready_gate_status IN ('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'),
          'ready_gate_status', v_ready_gate_status,
          'existing_swipe_type', v_existing_swipe_type,
          'requested_swipe_type', p_swipe_type,
          'idempotent', true,
          'replay', true,
          'notification_suppressed', true,
          'dedupe_reason', 'existing_match'
        );
      END IF;
    END IF;

    v_existing_result := CASE v_existing_swipe_type
      WHEN 'pass' THEN 'pass_recorded'
      WHEN 'super_vibe' THEN 'super_vibe_sent'
      ELSE 'vibe_recorded'
    END;

    RETURN jsonb_build_object(
      'result', v_existing_result,
      'existing_swipe_type', v_existing_swipe_type,
      'requested_swipe_type', p_swipe_type,
      'idempotent', true,
      'replay', true,
      'notification_suppressed', true,
      'dedupe_reason', 'existing_swipe',
      'swipe_recorded_at', v_existing_swipe_created_at
    );
  END IF;

  RETURN public.handle_swipe_20260501180000_active_base(
    p_event_id,
    p_actor_id,
    p_target_id,
    p_swipe_type
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_swipe_20260501210000_idempotency_base(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.find_mystery_match_20260502083000_active_base(uuid, uuid);

ALTER FUNCTION public.find_mystery_match(uuid, uuid)
  RENAME TO find_mystery_match_20260502083000_active_base;

REVOKE ALL ON FUNCTION public.find_mystery_match_20260502083000_active_base(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.find_mystery_match(
  p_event_id uuid,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_active record;
  v_inactive_reason text;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  IF public.is_profile_hidden(p_user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_hidden');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.profile_id = p_user_id
      AND er.admission_status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_registered');
  END IF;

  SELECT *
  INTO v_active
  FROM public.lock_event_lobby_scheduled_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    v_inactive_reason := COALESCE(v_active.reason, 'event_not_active');
    RETURN jsonb_build_object(
      'success', false,
      'error', 'event_not_active',
      'reason', v_inactive_reason,
      'terminal', true
    );
  END IF;

  RETURN public.find_mystery_match_20260502083000_active_base(
    p_event_id,
    p_user_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.find_mystery_match(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_mystery_match(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.find_mystery_match(uuid, uuid) IS
  'Mystery Match fallback. Requires scheduled-time active-event state before creating a Ready Gate session.';

DROP FUNCTION IF EXISTS public.promote_ready_gate_if_eligible_20260502083000_ready_queue_base(uuid, uuid);

ALTER FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid)
  RENAME TO promote_ready_gate_if_eligible_20260502083000_ready_queue_base;

REVOKE ALL ON FUNCTION public.promote_ready_gate_if_eligible_20260502083000_ready_queue_base(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

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
    RETURN jsonb_build_object('promoted', false, 'reason', 'registration_missing');
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
    RETURN jsonb_build_object('promoted', false, 'reason', 'admission_not_confirmed');
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

  RETURN public.promote_ready_gate_if_eligible_20260502083000_ready_queue_base(
    p_event_id,
    p_uid
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid) IS
  'Promotes queued video_sessions only while scheduled-time active-event state is true and participants have no other active session.';

CREATE OR REPLACE FUNCTION public.promote_ready_gate_if_eligible_20260501180000_active_base(
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
  v_match record;
  v_partner_id uuid;
  v_p_low uuid;
  v_p_high uuid;
  v_er_low record;
  v_er_high record;
  v_self record;
  v_partner record;
  v_self_status text;
  v_self_foregrounded_at timestamptz;
  v_partner_status text;
  v_partner_foregrounded_at timestamptz;
  v_self_present boolean := false;
  v_partner_present boolean := false;
  v_active record;
  v_inactive_reason text;
BEGIN
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
      jsonb_build_object('step', 'event_share_lock', 'inactive_reason', v_inactive_reason)
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
  ORDER BY vs.started_at ASC
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

  v_self_status := v_self.queue_status;
  v_self_foregrounded_at := v_self.last_lobby_foregrounded_at;
  v_partner_status := v_partner.queue_status;
  v_partner_foregrounded_at := v_partner.last_lobby_foregrounded_at;

  v_self_present :=
    v_self_status IN ('browsing', 'idle')
    AND v_self_foregrounded_at IS NOT NULL
    AND v_self_foregrounded_at >= now() - interval '120 seconds';

  v_partner_present :=
    v_partner_status IN ('browsing', 'idle')
    AND v_partner_foregrounded_at IS NOT NULL
    AND v_partner_foregrounded_at >= now() - interval '120 seconds';

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
      v_match.id,
      jsonb_build_object('step', 'active_session_guard')
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
      'partner_id', v_partner_id
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

REVOKE ALL ON FUNCTION public.promote_ready_gate_if_eligible_20260501180000_active_base(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.drain_match_queue_20260502083000_active_base(uuid);

ALTER FUNCTION public.drain_match_queue(uuid)
  RENAME TO drain_match_queue_20260502083000_active_base;

REVOKE ALL ON FUNCTION public.drain_match_queue_20260502083000_active_base(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.drain_match_queue(
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  v_ms integer;
  v_uid uuid := auth.uid();
  v_admission_status text;
  v_active record;
  v_inactive_reason text;
BEGIN
  IF v_uid IS NULL THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue',
      'error',
      'unauthorized',
      v_ms,
      p_event_id,
      NULL,
      NULL,
      '{}'::jsonb
    );
    RETURN jsonb_build_object('found', false, 'error', 'unauthorized', 'reason', 'unauthorized');
  END IF;

  SELECT er.admission_status
  INTO v_admission_status
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_uid;

  IF NOT FOUND THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue',
      'blocked',
      'registration_missing',
      v_ms,
      p_event_id,
      v_uid,
      NULL,
      jsonb_build_object('step', 'actor_registration_guard')
    );
    RETURN jsonb_build_object('found', false, 'reason', 'registration_missing');
  END IF;

  IF v_admission_status IS DISTINCT FROM 'confirmed' THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue',
      'blocked',
      'admission_not_confirmed',
      v_ms,
      p_event_id,
      v_uid,
      NULL,
      jsonb_build_object('step', 'actor_admission_guard')
    );
    RETURN jsonb_build_object('found', false, 'reason', 'admission_not_confirmed');
  END IF;

  SELECT *
  INTO v_active
  FROM public.lock_event_lobby_scheduled_active_state(p_event_id, now());

  IF NOT COALESCE(v_active.is_active, false) THEN
    v_inactive_reason := COALESCE(v_active.reason, 'event_not_active');
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue',
      'blocked',
      'event_not_valid',
      v_ms,
      p_event_id,
      v_uid,
      NULL,
      jsonb_build_object('found', false, 'inactive_reason', v_inactive_reason)
    );
    RETURN jsonb_build_object(
      'found', false,
      'reason', 'event_not_valid',
      'inactive_reason', v_inactive_reason
    );
  END IF;

  RETURN public.drain_match_queue_20260502083000_active_base(p_event_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.drain_match_queue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.drain_match_queue(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.drain_match_queue(uuid) IS
  'Queue-drain RPC. Requires scheduled-time active-event state before stale cleanup or queued Ready Gate promotion.';
