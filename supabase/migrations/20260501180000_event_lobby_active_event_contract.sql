-- Event Lobby active-event contract hardening.
--
-- This migration intentionally sorts after the applied 20260501170000 tail.
-- It makes lobby deck/match entrypoints reject stale, pre-live, post-live,
-- cancelled, archived, draft, and ended events before they can mutate swipes,
-- queue promotion, Ready Gate sessions, or mystery-match sessions.

CREATE OR REPLACE FUNCTION public.get_event_lobby_inactive_reason(
  p_event_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_now timestamptz := now();
  v_scheduled_end timestamptz;
BEGIN
  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id;

  IF NOT FOUND THEN
    RETURN 'event_not_found';
  END IF;

  IF v_event.archived_at IS NOT NULL THEN
    RETURN 'event_archived';
  END IF;

  IF COALESCE(v_event.status, '') = 'cancelled' THEN
    RETURN 'event_cancelled';
  END IF;

  IF v_event.ended_at IS NOT NULL
     OR COALESCE(v_event.status, '') IN ('ended', 'completed') THEN
    RETURN 'event_ended';
  END IF;

  IF COALESCE(v_event.status, '') <> 'live' THEN
    RETURN 'event_not_live';
  END IF;

  IF v_event.event_date IS NULL THEN
    RETURN 'event_outside_live_window';
  END IF;

  v_scheduled_end :=
    v_event.event_date + COALESCE(v_event.duration_minutes, 60) * interval '1 minute';

  IF v_now < v_event.event_date OR v_now >= v_scheduled_end THEN
    RETURN 'event_outside_live_window';
  END IF;

  RETURN NULL;
END;
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
  SELECT public.get_event_lobby_inactive_reason(p_event_id) IS NULL;
$function$;

REVOKE ALL ON FUNCTION public.get_event_lobby_inactive_reason(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_event_lobby_active(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_lobby_inactive_reason(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_event_lobby_active(uuid) TO service_role;

COMMENT ON FUNCTION public.get_event_lobby_inactive_reason(uuid) IS
  'Internal helper for Event Lobby RPCs. Returns NULL only when event exists, is live, unended, unarchived, and current DB time is within event_date + duration_minutes.';

COMMENT ON FUNCTION public.is_event_lobby_active(uuid) IS
  'Internal boolean wrapper around get_event_lobby_inactive_reason for Event Lobby active-window checks.';

DROP FUNCTION IF EXISTS public.get_event_deck_20260501180000_active_base(uuid, uuid, integer);

ALTER FUNCTION public.get_event_deck(uuid, uuid, integer)
  RENAME TO get_event_deck_20260501180000_active_base;

REVOKE ALL ON FUNCTION public.get_event_deck_20260501180000_active_base(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;

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
BEGIN
  IF v_viewer IS NULL OR v_viewer <> p_user_id THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  IF public.get_event_lobby_inactive_reason(p_event_id) IS NOT NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.get_event_deck_20260501180000_active_base(
    p_event_id,
    p_user_id,
    p_limit
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_deck(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_deck(uuid, uuid, integer)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_event_deck(uuid, uuid, integer) IS
  'Event deck RPC. Returns no profiles unless the event is currently live, unended, unarchived, and inside its scheduled live window.';

DROP FUNCTION IF EXISTS public.handle_swipe_20260501180000_active_base(uuid, uuid, uuid, text);

ALTER FUNCTION public.handle_swipe(uuid, uuid, uuid, text)
  RENAME TO handle_swipe_20260501180000_active_base;

REVOKE ALL ON FUNCTION public.handle_swipe_20260501180000_active_base(uuid, uuid, uuid, text)
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

  v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);
  IF v_inactive_reason IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'result', 'event_not_active',
      'error', 'event_not_active',
      'reason', v_inactive_reason,
      'message', 'This event is no longer active.'
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

  -- Hold the event row stable while the delegated swipe RPC records swipes or
  -- creates/reuses video_sessions.
  PERFORM 1
  FROM public.events ev
  WHERE ev.id = p_event_id
    AND ev.status = 'live'
    AND ev.ended_at IS NULL
    AND ev.archived_at IS NULL
    AND now() >= ev.event_date
    AND now() < (ev.event_date + COALESCE(ev.duration_minutes, 60) * interval '1 minute')
  FOR SHARE OF ev;

  IF NOT FOUND THEN
    v_inactive_reason := COALESCE(
      public.get_event_lobby_inactive_reason(p_event_id),
      'event_not_active'
    );
    RETURN jsonb_build_object(
      'success', false,
      'result', 'event_not_active',
      'error', 'event_not_active',
      'reason', v_inactive_reason,
      'message', 'This event is no longer active.'
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

REVOKE ALL ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) IS
  'Swipe-first event matching. Requires the event to be live, unended, unarchived, and inside its scheduled live window before any swipe/session mutation.';

DROP FUNCTION IF EXISTS public.find_mystery_match_20260501180000_active_base(uuid, uuid);

ALTER FUNCTION public.find_mystery_match(uuid, uuid)
  RENAME TO find_mystery_match_20260501180000_active_base;

REVOKE ALL ON FUNCTION public.find_mystery_match_20260501180000_active_base(uuid, uuid)
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

  v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);
  IF v_inactive_reason IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'event_not_active',
      'reason', v_inactive_reason,
      'terminal', true
    );
  END IF;

  -- Hold the event row stable while the delegated mystery-match RPC creates a
  -- ready video_session and updates registrations.
  PERFORM 1
  FROM public.events ev
  WHERE ev.id = p_event_id
    AND ev.status = 'live'
    AND ev.ended_at IS NULL
    AND ev.archived_at IS NULL
    AND now() >= ev.event_date
    AND now() < (ev.event_date + COALESCE(ev.duration_minutes, 60) * interval '1 minute')
  FOR SHARE OF ev;

  IF NOT FOUND THEN
    v_inactive_reason := COALESCE(
      public.get_event_lobby_inactive_reason(p_event_id),
      'event_not_active'
    );
    RETURN jsonb_build_object(
      'success', false,
      'error', 'event_not_active',
      'reason', v_inactive_reason,
      'terminal', true
    );
  END IF;

  RETURN public.find_mystery_match_20260501180000_active_base(
    p_event_id,
    p_user_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.find_mystery_match(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_mystery_match(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.find_mystery_match(uuid, uuid) IS
  'Mystery Match fallback. Requires an active live event window before creating a Ready Gate session.';

DROP FUNCTION IF EXISTS public.promote_ready_gate_if_eligible_20260501180000_active_base(uuid, uuid);

ALTER FUNCTION public.promote_ready_gate_if_eligible(uuid, uuid)
  RENAME TO promote_ready_gate_if_eligible_20260501180000_active_base;

REVOKE ALL ON FUNCTION public.promote_ready_gate_if_eligible_20260501180000_active_base(uuid, uuid)
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

  v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);
  IF v_inactive_reason IS NOT NULL THEN
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

  IF NOT FOUND THEN
    v_inactive_reason := COALESCE(
      public.get_event_lobby_inactive_reason(p_event_id),
      'event_not_active'
    );
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
  'Promotes queued video_sessions only while the event is live, unended, unarchived, and inside its scheduled live window.';

DROP FUNCTION IF EXISTS public.drain_match_queue_20260501180000_active_base(uuid);

ALTER FUNCTION public.drain_match_queue(uuid)
  RENAME TO drain_match_queue_20260501180000_active_base;

REVOKE ALL ON FUNCTION public.drain_match_queue_20260501180000_active_base(uuid)
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
    RETURN jsonb_build_object(
      'found', false,
      'reason', 'registration_missing'
    );
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
    RETURN jsonb_build_object(
      'found', false,
      'reason', 'admission_not_confirmed'
    );
  END IF;

  v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);
  IF v_inactive_reason IS NOT NULL THEN
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue',
      'blocked',
      'event_not_valid',
      v_ms,
      p_event_id,
      v_uid,
      NULL,
      jsonb_build_object(
        'found', false,
        'inactive_reason', v_inactive_reason
      )
    );
    RETURN jsonb_build_object(
      'found', false,
      'reason', 'event_not_valid',
      'inactive_reason', v_inactive_reason
    );
  END IF;

  -- Hold the event row stable while the delegated drain can expire stale
  -- sessions and promote queued matches.
  PERFORM 1
  FROM public.events ev
  WHERE ev.id = p_event_id
    AND ev.status = 'live'
    AND ev.ended_at IS NULL
    AND ev.archived_at IS NULL
    AND now() >= ev.event_date
    AND now() < (ev.event_date + COALESCE(ev.duration_minutes, 60) * interval '1 minute')
  FOR SHARE OF ev;

  IF NOT FOUND THEN
    v_inactive_reason := COALESCE(
      public.get_event_lobby_inactive_reason(p_event_id),
      'event_not_active'
    );
    v_ms := (EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000)::int;
    PERFORM public.record_event_loop_observability(
      'drain_match_queue',
      'blocked',
      'event_not_valid',
      v_ms,
      p_event_id,
      v_uid,
      NULL,
      jsonb_build_object(
        'found', false,
        'inactive_reason', v_inactive_reason
      )
    );
    RETURN jsonb_build_object(
      'found', false,
      'reason', 'event_not_valid',
      'inactive_reason', v_inactive_reason
    );
  END IF;

  RETURN public.drain_match_queue_20260501180000_active_base(p_event_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.drain_match_queue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.drain_match_queue(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.drain_match_queue(uuid) IS
  'Queue-drain RPC. Requires active live event window before stale cleanup or queued Ready Gate promotion.';
