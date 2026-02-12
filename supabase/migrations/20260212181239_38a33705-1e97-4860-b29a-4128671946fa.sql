
-- Prompt F: Race condition protection

-- 1. Atomic credit deduction function
CREATE OR REPLACE FUNCTION public.deduct_credit(p_user_id uuid, p_credit_type text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows int;
BEGIN
  IF p_credit_type = 'extra_time' THEN
    UPDATE user_credits SET extra_time_credits = extra_time_credits - 1
    WHERE user_id = p_user_id AND extra_time_credits > 0;
  ELSIF p_credit_type = 'extended_vibe' THEN
    UPDATE user_credits SET extended_vibe_credits = extended_vibe_credits - 1
    WHERE user_id = p_user_id AND extended_vibe_credits > 0;
  ELSIF p_credit_type = 'super_vibe' THEN
    UPDATE user_credits SET super_vibe_credits = super_vibe_credits - 1
    WHERE user_id = p_user_id AND super_vibe_credits > 0;
  ELSE
    RETURN false;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- 2. Survey idempotency: unique constraint on (session_id, user_id) for date_feedback
ALTER TABLE public.date_feedback
  ADD CONSTRAINT date_feedback_session_user_unique UNIQUE (session_id, user_id);

-- 3. Duplicate match prevention: unique constraint on event_swipes
-- Already has unique on (event_id, actor_id, target_id) from migration, add if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'event_swipes_event_actor_target_key'
  ) THEN
    ALTER TABLE public.event_swipes
      ADD CONSTRAINT event_swipes_event_actor_target_key UNIQUE (event_id, actor_id, target_id);
  END IF;
END $$;

-- 4. Mystery match function (Prompt G)
CREATE OR REPLACE FUNCTION public.find_mystery_match(p_event_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_gender text;
  v_user_interested_in text[];
  v_partner_id uuid;
  v_session_id uuid;
BEGIN
  SELECT gender, interested_in INTO v_user_gender, v_user_interested_in
  FROM public.profiles WHERE id = p_user_id;

  IF v_user_gender IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Profile not found');
  END IF;

  SELECT er.profile_id INTO v_partner_id
  FROM public.event_registrations er
  JOIN public.profiles p ON p.id = er.profile_id
  WHERE er.event_id = p_event_id
    AND er.queue_status = 'browsing'
    AND er.profile_id != p_user_id
    -- Gender compatibility (bidirectional)
    AND (v_user_interested_in IS NULL OR cardinality(v_user_interested_in) = 0
      OR p.gender = ANY(v_user_interested_in)
      OR (p.gender = 'woman' AND 'women' = ANY(v_user_interested_in))
      OR (p.gender = 'man' AND 'men' = ANY(v_user_interested_in))
      OR (p.gender = 'non-binary' AND 'non-binary' = ANY(v_user_interested_in)))
    AND (p.interested_in IS NULL OR cardinality(p.interested_in) = 0
      OR v_user_gender = ANY(p.interested_in)
      OR (v_user_gender = 'woman' AND 'women' = ANY(p.interested_in))
      OR (v_user_gender = 'man' AND 'men' = ANY(p.interested_in))
      OR (v_user_gender = 'non-binary' AND 'non-binary' = ANY(p.interested_in)))
    AND NOT is_blocked(p_user_id, er.profile_id)
    -- Not previously dated in this event
    AND NOT EXISTS (
      SELECT 1 FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND ((vs.participant_1_id = p_user_id AND vs.participant_2_id = er.profile_id)
          OR (vs.participant_2_id = p_user_id AND vs.participant_1_id = er.profile_id))
    )
    -- Not persistent match
    AND NOT EXISTS (
      SELECT 1 FROM public.matches m
      WHERE ((m.profile_id_1 = p_user_id AND m.profile_id_2 = er.profile_id)
          OR (m.profile_id_2 = p_user_id AND m.profile_id_1 = er.profile_id))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_reports ur
      WHERE ur.reporter_id = p_user_id AND ur.reported_id = er.profile_id
    )
    AND (p.is_suspended = false OR p.is_suspended IS NULL)
  ORDER BY random()
  LIMIT 1
  FOR UPDATE OF er SKIP LOCKED;

  IF v_partner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'no_candidates', true);
  END IF;

  -- Create session with ready gate
  INSERT INTO public.video_sessions (
    event_id, participant_1_id, participant_2_id,
    ready_gate_status, ready_gate_expires_at
  ) VALUES (
    p_event_id,
    LEAST(p_user_id, v_partner_id),
    GREATEST(p_user_id, v_partner_id),
    'waiting',
    now() + interval '30 seconds'
  )
  RETURNING id INTO v_session_id;

  -- Update both users to in_ready_gate
  UPDATE public.event_registrations
  SET queue_status = 'in_ready_gate',
      current_room_id = v_session_id,
      current_partner_id = CASE WHEN profile_id = p_user_id THEN v_partner_id ELSE p_user_id END,
      last_active_at = now()
  WHERE event_id = p_event_id AND profile_id IN (p_user_id, v_partner_id);

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'partner_id', v_partner_id
  );
END;
$$;
