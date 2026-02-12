
-- 1. Add last_active_at to event_registrations
ALTER TABLE public.event_registrations
ADD COLUMN IF NOT EXISTS last_active_at timestamptz DEFAULT now();

-- 2. Add super_vibe_credits to user_credits
ALTER TABLE public.user_credits
ADD COLUMN IF NOT EXISTS super_vibe_credits integer NOT NULL DEFAULT 0;

-- 3. Create event_swipes table
CREATE TABLE IF NOT EXISTS public.event_swipes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.events(id),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  target_id uuid NOT NULL REFERENCES public.profiles(id),
  swipe_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_swipes_unique UNIQUE (event_id, actor_id, target_id),
  CONSTRAINT event_swipes_type_check CHECK (swipe_type IN ('vibe', 'pass', 'super_vibe'))
);

ALTER TABLE public.event_swipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create own swipes" ON public.event_swipes
FOR INSERT WITH CHECK (auth.uid() = actor_id);

CREATE POLICY "Users can view own swipes" ON public.event_swipes
FOR SELECT USING (auth.uid() = actor_id OR auth.uid() = target_id);

CREATE POLICY "Admins can view all swipes" ON public.event_swipes
FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- Index for mutual-match lookups
CREATE INDEX IF NOT EXISTS idx_event_swipes_mutual ON public.event_swipes (event_id, target_id, actor_id, swipe_type);

-- 4. Update get_event_deck to also exclude already-swiped profiles
CREATE OR REPLACE FUNCTION public.get_event_deck(p_event_id uuid, p_user_id uuid, p_limit integer DEFAULT 50)
RETURNS TABLE(
  profile_id uuid, name text, age integer, gender text, avatar_url text, photos text[],
  bio text, job text, location text, height_cm integer, tagline text, looking_for text,
  video_intro_url text, queue_status text, has_met_before boolean,
  is_already_connected boolean, has_super_vibed boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS profile_id, p.name, p.age, p.gender, p.avatar_url, p.photos,
    p.bio, p.job, p.location, p.height_cm, p.tagline, p.looking_for,
    p.video_intro_url, er.queue_status,
    EXISTS (
      SELECT 1 FROM public.video_sessions vs
      WHERE vs.event_id != p_event_id
        AND ((vs.participant_1_id = p_user_id AND vs.participant_2_id = p.id)
          OR (vs.participant_2_id = p_user_id AND vs.participant_1_id = p.id))
    ) AS has_met_before,
    EXISTS (
      SELECT 1 FROM public.matches m
      WHERE ((m.profile_id_1 = p_user_id AND m.profile_id_2 = p.id)
          OR (m.profile_id_2 = p_user_id AND m.profile_id_1 = p.id))
    ) AS is_already_connected,
    EXISTS (
      SELECT 1 FROM public.event_swipes es
      WHERE es.event_id = p_event_id AND es.actor_id = p.id AND es.target_id = p_user_id
        AND es.swipe_type = 'super_vibe'
    ) AS has_super_vibed
  FROM public.event_registrations er
  JOIN public.profiles p ON p.id = er.profile_id
  WHERE er.event_id = p_event_id
    AND er.profile_id != p_user_id
    -- Gender compatibility (bidirectional)
    AND EXISTS (
      SELECT 1 FROM public.profiles viewer WHERE viewer.id = p_user_id
      AND (viewer.interested_in IS NULL OR cardinality(viewer.interested_in) = 0
        OR p.gender = ANY(viewer.interested_in)
        OR (p.gender = 'woman' AND 'women' = ANY(viewer.interested_in))
        OR (p.gender = 'man' AND 'men' = ANY(viewer.interested_in))
        OR (p.gender = 'non-binary' AND 'non-binary' = ANY(viewer.interested_in)))
    )
    AND (p.interested_in IS NULL OR cardinality(p.interested_in) = 0
      OR EXISTS (
        SELECT 1 FROM public.profiles viewer WHERE viewer.id = p_user_id
        AND (viewer.gender = ANY(p.interested_in)
          OR (viewer.gender = 'woman' AND 'women' = ANY(p.interested_in))
          OR (viewer.gender = 'man' AND 'men' = ANY(p.interested_in))
          OR (viewer.gender = 'non-binary' AND 'non-binary' = ANY(p.interested_in)))
      )
    )
    -- EXCLUDE already swiped by current user in this event
    AND NOT EXISTS (
      SELECT 1 FROM public.event_swipes es
      WHERE es.event_id = p_event_id AND es.actor_id = p_user_id AND es.target_id = p.id
    )
    -- EXCLUDE already dated in this event
    AND NOT EXISTS (
      SELECT 1 FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND ((vs.participant_1_id = p_user_id AND vs.participant_2_id = p.id)
          OR (vs.participant_2_id = p_user_id AND vs.participant_1_id = p.id))
    )
    -- EXCLUDE persistent matches
    AND NOT EXISTS (
      SELECT 1 FROM public.matches m
      WHERE ((m.profile_id_1 = p_user_id AND m.profile_id_2 = p.id)
          OR (m.profile_id_2 = p_user_id AND m.profile_id_1 = p.id))
    )
    -- EXCLUDE blocked
    AND NOT is_blocked(p_user_id, p.id)
    -- EXCLUDE reported by current user
    AND NOT EXISTS (
      SELECT 1 FROM public.user_reports ur
      WHERE ur.reporter_id = p_user_id AND ur.reported_id = p.id
    )
    -- Don't show suspended users
    AND (p.is_suspended = false OR p.is_suspended IS NULL)
  ORDER BY
    -- Super vibes first
    EXISTS (
      SELECT 1 FROM public.event_swipes es2
      WHERE es2.event_id = p_event_id AND es2.actor_id = p.id AND es2.target_id = p_user_id
        AND es2.swipe_type = 'super_vibe'
    ) DESC,
    er.registered_at DESC
  LIMIT p_limit;
END;
$function$;

-- 5. handle_swipe RPC
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
  -- Validate auth
  IF auth.uid() != p_actor_id THEN
    RETURN jsonb_build_object('result', 'unauthorized');
  END IF;

  -- Validate both registered
  IF NOT is_registered_for_event(p_actor_id, p_event_id)
    OR NOT is_registered_for_event(p_target_id, p_event_id) THEN
    RETURN jsonb_build_object('result', 'not_registered');
  END IF;

  -- Validate not blocked
  IF is_blocked(p_actor_id, p_target_id) THEN
    RETURN jsonb_build_object('result', 'blocked');
  END IF;

  -- Validate not reported
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

  -- Handle super_vibe
  IF p_swipe_type = 'super_vibe' THEN
    IF NOT EXISTS (SELECT 1 FROM user_credits WHERE user_id = p_actor_id AND super_vibe_credits > 0) THEN
      RETURN jsonb_build_object('result', 'no_credits');
    END IF;

    SELECT count(*) INTO v_super_count FROM event_swipes
    WHERE event_id = p_event_id AND actor_id = p_actor_id AND swipe_type = 'super_vibe';
    IF v_super_count >= 3 THEN
      RETURN jsonb_build_object('result', 'limit_reached');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM event_swipes
      WHERE actor_id = p_actor_id AND target_id = p_target_id
        AND swipe_type = 'super_vibe' AND created_at > now() - interval '30 days'
    ) INTO v_recent_super;
    IF v_recent_super THEN
      RETURN jsonb_build_object('result', 'already_super_vibed_recently');
    END IF;

    UPDATE user_credits SET super_vibe_credits = super_vibe_credits - 1
    WHERE user_id = p_actor_id AND super_vibe_credits > 0;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('result', 'no_credits');
    END IF;
  END IF;

  -- Insert swipe (vibe or super_vibe)
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
    -- Check statuses for immediate vs queued
    SELECT queue_status INTO v_actor_status FROM event_registrations
    WHERE event_id = p_event_id AND profile_id = p_actor_id;
    SELECT queue_status INTO v_target_status FROM event_registrations
    WHERE event_id = p_event_id AND profile_id = p_target_id;

    -- Create video session as match record with canonical ordering
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
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_session_id;

    IF v_session_id IS NULL THEN
      RETURN jsonb_build_object('result', 'already_matched');
    END IF;

    IF v_actor_status IN ('browsing', 'idle') AND v_target_status IN ('browsing', 'idle') THEN
      -- Update both to in_ready_gate
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

-- 6. drain_match_queue RPC
CREATE OR REPLACE FUNCTION public.drain_match_queue(p_event_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_match record;
  v_partner_id uuid;
  v_partner_status text;
BEGIN
  -- Find oldest queued match for this user (not expired)
  SELECT * INTO v_match FROM video_sessions
  WHERE event_id = p_event_id
    AND ready_gate_status = 'queued'
    AND ((participant_1_id = p_user_id) OR (participant_2_id = p_user_id))
    AND created_at > now() - interval '10 minutes'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_match IS NULL THEN
    -- Expire any stale queued matches while we're here
    UPDATE video_sessions SET ready_gate_status = 'expired', ended_at = now()
    WHERE event_id = p_event_id
      AND ready_gate_status = 'queued'
      AND created_at < now() - interval '10 minutes'
      AND ((participant_1_id = p_user_id) OR (participant_2_id = p_user_id));
    RETURN jsonb_build_object('found', false);
  END IF;

  v_partner_id := CASE WHEN v_match.participant_1_id = p_user_id
    THEN v_match.participant_2_id ELSE v_match.participant_1_id END;

  SELECT queue_status INTO v_partner_status FROM event_registrations
  WHERE event_id = p_event_id AND profile_id = v_partner_id;

  IF v_partner_status IN ('browsing', 'idle') THEN
    -- Both ready — activate match
    UPDATE video_sessions
    SET ready_gate_status = 'ready', ready_gate_expires_at = now() + interval '30 seconds'
    WHERE id = v_match.id;

    UPDATE event_registrations
    SET queue_status = 'in_ready_gate',
        current_room_id = v_match.id,
        current_partner_id = CASE WHEN profile_id = p_user_id THEN v_partner_id ELSE p_user_id END,
        last_active_at = now()
    WHERE event_id = p_event_id AND profile_id IN (p_user_id, v_partner_id);

    RETURN jsonb_build_object('found', true, 'match_id', v_match.id, 'partner_id', v_partner_id);
  END IF;

  RETURN jsonb_build_object('found', false, 'queued', true);
END;
$function$;

-- 7. Update status helper RPC
CREATE OR REPLACE FUNCTION public.update_participant_status(
  p_event_id uuid, p_user_id uuid, p_status text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE event_registrations
  SET queue_status = p_status, last_active_at = now()
  WHERE event_id = p_event_id AND profile_id = p_user_id;
END;
$function$;
