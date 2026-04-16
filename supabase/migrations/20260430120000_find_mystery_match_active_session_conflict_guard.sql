-- Mirror `handle_swipe`'s active-session conflict guard inside `find_mystery_match`
-- so that Mystery Match cannot create a net-new video_sessions row when either
-- participant already has a different non-ended session in the same event.
--
-- Preserves existing Mystery Match behavior (candidate selection, canonical
-- ready-gate status, registration promotion) — only adds the EXISTS guard
-- that was already shipped for mutual `handle_swipe`
-- (see: 20260420123000_handle_swipe_mutual_session_conflict_guard.sql).
--
-- Goal: exactly one valid active session per participant on this path.

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
    AND NOT public.is_profile_hidden(p.id)
  ORDER BY random()
  LIMIT 1
  FOR UPDATE OF er SKIP LOCKED;

  IF v_partner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'no_candidates', true);
  END IF;

  -- Active-session conflict guard (parity with handle_swipe mutual path):
  -- block a *new* session row when either participant is already in another
  -- non-ended session for this event with a *different* pair.
  IF EXISTS (
    SELECT 1
    FROM public.video_sessions z
    WHERE z.event_id = p_event_id
      AND z.ended_at IS NULL
      AND NOT (
        z.participant_1_id = LEAST(p_user_id, v_partner_id)
        AND z.participant_2_id = GREATEST(p_user_id, v_partner_id)
      )
      AND (
        z.participant_1_id IN (p_user_id, v_partner_id)
        OR z.participant_2_id IN (p_user_id, v_partner_id)
      )
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'participant_has_active_session_conflict'
    );
  END IF;

  -- Mystery Match opens Ready Gate immediately for both participants, so canonical status is 'ready'.
  INSERT INTO public.video_sessions (
    event_id, participant_1_id, participant_2_id,
    ready_gate_status, ready_gate_expires_at, queued_expires_at
  ) VALUES (
    p_event_id,
    LEAST(p_user_id, v_partner_id),
    GREATEST(p_user_id, v_partner_id),
    'ready',
    now() + interval '30 seconds',
    NULL
  )
  RETURNING id INTO v_session_id;

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
