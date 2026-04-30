-- Swipe retry idempotency and notification-dedupe hardening.
--
-- Natural idempotency key: (event_id, actor_id, target_id).
-- The prior canonical function relied on event_swipes uniqueness with
-- ON CONFLICT DO NOTHING, but returned fresh-looking outcomes on replay. That
-- allowed swipe-actions retries to re-emit notifications. This wrapper keeps
-- the Stream 1 active-event guard, serializes by natural key before inspecting
-- the existing swipe row, and returns explicit replay/conflict markers before
-- any super-vibe cap check, credit-like accounting, match creation, queue
-- creation, or notification-triggering outcome can run.

DROP FUNCTION IF EXISTS public.handle_swipe_20260501210000_idempotency_base(uuid, uuid, uuid, text);

ALTER FUNCTION public.handle_swipe(uuid, uuid, uuid, text)
  RENAME TO handle_swipe_20260501210000_idempotency_base;

REVOKE ALL ON FUNCTION public.handle_swipe_20260501210000_idempotency_base(uuid, uuid, uuid, text)
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

  v_inactive_reason := public.get_event_lobby_inactive_reason(p_event_id);
  IF v_inactive_reason IS NOT NULL THEN
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
  'Swipe-first event matching. Enforces active event and natural-key retry idempotency before delegated swipe/session mutation.';
