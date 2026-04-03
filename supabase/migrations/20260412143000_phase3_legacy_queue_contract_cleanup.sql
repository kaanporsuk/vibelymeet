-- Phase 3 events hardening: retire legacy queue-era RPC surfaces and normalize swipe/session contracts.
-- This is a compatibility-focused cleanup pass; swipe-first matching remains canonical.

-- 1) Canonical handle_swipe contract and semantics
--    - preserve strict 60s true-lobby foreground requirement for immediate ready gate
--    - preserve queued path with canonical queued_expires_at TTL
--    - normalize payload keys for active flow: video_session_id + event_id (+ legacy match_id alias)
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
        WHEN v_actor_present AND v_target_present THEN now() + interval '30 seconds'
        ELSE NULL
      END,
      CASE
        WHEN v_actor_present AND v_target_present THEN NULL
        ELSE now() + interval '10 minutes'
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

-- 2) Canonical drain_match_queue semantics
--    - cleanup-first behavior
--    - strict 60s foreground proof for both participants
--    - queued TTL guard via queued_expires_at
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

  PERFORM public.expire_stale_video_sessions();

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
    AND ended_at IS NULL
    AND COALESCE(queued_expires_at, COALESCE(started_at, now()) + interval '10 minutes') > now()
    AND ((participant_1_id = v_uid) OR (participant_2_id = v_uid))
  ORDER BY started_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_match IS NULL THEN
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
      ready_gate_expires_at = now() + interval '30 seconds',
      queued_expires_at = NULL
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

-- 3) Deprecated legacy queue-era surfaces (compatibility no-op)
--    Active product flow does not call these surfaces anymore.
CREATE OR REPLACE FUNCTION public.join_matching_queue(
  p_event_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'deprecated', true,
    'surface', 'join_matching_queue',
    'error', 'deprecated_legacy_queue_surface',
    'message', 'Legacy queue join is retired. Use swipe-first flow via handle_swipe + drain_match_queue.'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.find_video_date_match(
  p_event_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'deprecated', true,
    'surface', 'find_video_date_match',
    'error', 'deprecated_legacy_queue_surface',
    'message', 'Legacy queue match finder is retired. Use swipe-first flow via handle_swipe + drain_match_queue.'
  );
END;
$function$;

-- 4) Keep leave_matching_queue for compatibility, but mark deprecated in response contract
CREATE OR REPLACE FUNCTION public.leave_matching_queue(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_partner_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT current_partner_id INTO v_partner_id
  FROM public.event_registrations
  WHERE event_id = p_event_id AND profile_id = v_uid;

  UPDATE public.event_registrations
  SET queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      dates_completed = dates_completed + CASE WHEN v_partner_id IS NOT NULL THEN 1 ELSE 0 END
  WHERE event_id = p_event_id AND profile_id = v_uid;

  IF v_partner_id IS NOT NULL THEN
    UPDATE public.event_registrations
    SET queue_status = 'idle',
        current_room_id = NULL,
        current_partner_id = NULL,
        dates_completed = dates_completed + 1
    WHERE event_id = p_event_id AND profile_id = v_partner_id;

    UPDATE public.video_sessions
    SET ended_at = now(),
        duration_seconds = COALESCE(
          duration_seconds,
          GREATEST(0, floor(EXTRACT(EPOCH FROM (now() - started_at)))::int)
        )
    WHERE event_id = p_event_id
      AND ((participant_1_id = v_uid AND participant_2_id = v_partner_id)
        OR (participant_2_id = v_uid AND participant_1_id = v_partner_id))
      AND ended_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'deprecated', true,
    'surface', 'leave_matching_queue'
  );
END;
$function$;

COMMENT ON FUNCTION public.join_matching_queue(uuid, uuid) IS
  'Deprecated in Phase 3: legacy queue-era surface retained as compatibility no-op. Active flow uses handle_swipe + drain_match_queue.';

COMMENT ON FUNCTION public.find_video_date_match(uuid, uuid) IS
  'Deprecated in Phase 3: legacy queue-era surface retained as compatibility no-op. Active flow uses handle_swipe + drain_match_queue.';

COMMENT ON FUNCTION public.leave_matching_queue(uuid) IS
  'Deprecated in Phase 3 for active event flow; retained for compatibility cleanup calls.';
