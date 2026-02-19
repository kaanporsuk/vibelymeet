
-- FIX 4: Clean up duplicate video_sessions and add unique constraint
DELETE FROM public.video_sessions
WHERE id NOT IN (
  SELECT DISTINCT ON (event_id, LEAST(participant_1_id, participant_2_id), GREATEST(participant_1_id, participant_2_id))
    id
  FROM public.video_sessions
  ORDER BY event_id, LEAST(participant_1_id, participant_2_id), GREATEST(participant_1_id, participant_2_id), started_at ASC
);

ALTER TABLE public.video_sessions
ADD CONSTRAINT video_sessions_event_participants_unique
UNIQUE (event_id, participant_1_id, participant_2_id);

-- FIX 5: Replace handle_swipe with FOR UPDATE locking version
CREATE OR REPLACE FUNCTION public.handle_swipe(
  p_event_id uuid, p_actor_id uuid, p_target_id uuid, p_swipe_type text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_mutual boolean := false;
  v_session_id uuid;
  v_actor_status text;
  v_target_status text;
  v_super_count integer;
  v_recent_super boolean;
BEGIN
  -- Validate both registered
  IF NOT EXISTS (SELECT 1 FROM event_registrations WHERE event_id = p_event_id AND profile_id = p_actor_id) THEN
    RETURN jsonb_build_object('result', 'not_registered');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM event_registrations WHERE event_id = p_event_id AND profile_id = p_target_id) THEN
    RETURN jsonb_build_object('result', 'target_not_found');
  END IF;

  -- Check blocks & reports
  IF is_blocked(p_actor_id, p_target_id) THEN
    RETURN jsonb_build_object('result', 'blocked');
  END IF;
  IF EXISTS (SELECT 1 FROM user_reports WHERE reporter_id = p_actor_id AND reported_id = p_target_id) THEN
    RETURN jsonb_build_object('result', 'reported');
  END IF;

  -- Handle pass
  IF p_swipe_type = 'pass' THEN
    INSERT INTO event_swipes (event_id, actor_id, target_id, swipe_type)
    VALUES (p_event_id, p_actor_id, p_target_id, 'pass')
    ON CONFLICT (event_id, actor_id, target_id) DO NOTHING;
    RETURN jsonb_build_object('result', 'pass_recorded');
  END IF;

  -- Super vibe checks
  IF p_swipe_type = 'super_vibe' THEN
    SELECT COUNT(*) INTO v_super_count FROM event_swipes
    WHERE event_id = p_event_id AND actor_id = p_actor_id AND swipe_type = 'super_vibe';
    IF v_super_count >= 3 THEN
      RETURN jsonb_build_object('result', 'limit_reached');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM event_swipes
      WHERE actor_id = p_actor_id AND target_id = p_target_id AND swipe_type = 'super_vibe'
        AND created_at > now() - interval '30 days'
    ) INTO v_recent_super;
    IF v_recent_super THEN
      RETURN jsonb_build_object('result', 'already_super_vibed_recently');
    END IF;

    IF NOT deduct_credit(p_actor_id, 'super_vibe') THEN
      RETURN jsonb_build_object('result', 'no_credits');
    END IF;
  END IF;

  -- Record swipe
  INSERT INTO event_swipes (event_id, actor_id, target_id, swipe_type)
  VALUES (p_event_id, p_actor_id, p_target_id, p_swipe_type)
  ON CONFLICT (event_id, actor_id, target_id) DO NOTHING;

  -- Check mutual match
  SELECT EXISTS (
    SELECT 1 FROM event_swipes
    WHERE event_id = p_event_id AND actor_id = p_target_id AND target_id = p_actor_id
      AND swipe_type IN ('vibe', 'super_vibe')
  ) INTO v_mutual;

  IF v_mutual THEN
    -- Lock BOTH registrations to prevent race conditions
    SELECT queue_status INTO v_actor_status FROM event_registrations
    WHERE event_id = p_event_id AND profile_id = p_actor_id
    FOR UPDATE;

    SELECT queue_status INTO v_target_status FROM event_registrations
    WHERE event_id = p_event_id AND profile_id = p_target_id
    FOR UPDATE;

    -- Create video session with canonical ordering
    INSERT INTO video_sessions (
      event_id, participant_1_id, participant_2_id, ready_gate_status, ready_gate_expires_at
    ) VALUES (
      p_event_id,
      LEAST(p_actor_id, p_target_id),
      GREATEST(p_actor_id, p_target_id),
      CASE WHEN v_actor_status IN ('browsing', 'idle') AND v_target_status IN ('browsing', 'idle')
        THEN 'ready' ELSE 'queued' END,
      CASE WHEN v_actor_status IN ('browsing', 'idle') AND v_target_status IN ('browsing', 'idle')
        THEN now() + interval '30 seconds' ELSE NULL END
    )
    ON CONFLICT (event_id, participant_1_id, participant_2_id) DO NOTHING
    RETURNING id INTO v_session_id;

    IF v_session_id IS NULL THEN
      RETURN jsonb_build_object('result', 'already_matched');
    END IF;

    IF v_actor_status IN ('browsing', 'idle') AND v_target_status IN ('browsing', 'idle') THEN
      -- Immediate match: update both to in_ready_gate
      UPDATE event_registrations
      SET queue_status = 'in_ready_gate',
          current_room_id = v_session_id,
          current_partner_id = CASE WHEN profile_id = p_actor_id THEN p_target_id ELSE p_actor_id END,
          last_active_at = now()
      WHERE event_id = p_event_id AND profile_id IN (p_actor_id, p_target_id);

      RETURN jsonb_build_object('result', 'match', 'match_id', v_session_id, 'immediate', true);
    ELSE
      RETURN jsonb_build_object('result', 'match_queued', 'match_id', v_session_id);
    END IF;
  END IF;

  IF p_swipe_type = 'super_vibe' THEN
    RETURN jsonb_build_object('result', 'super_vibe_sent');
  END IF;
  RETURN jsonb_build_object('result', 'swipe_recorded');
END;
$function$;

-- Reset stuck registrations from previous tests
UPDATE public.event_registrations
SET queue_status = 'idle', current_room_id = NULL, current_partner_id = NULL
WHERE queue_status NOT IN ('idle', 'browsing', 'offline')
AND current_room_id IS NOT NULL;
