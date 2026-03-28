-- Server-enforced event registration: tier check for premium/VIP visibility + block direct INSERT for authenticated.

CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_visibility text;
  v_max_attendees integer;
  v_current_attendees integer;
  v_status text;
  v_already boolean;
  v_user_tier text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT e.visibility, e.max_attendees, e.current_attendees, e.status
  INTO v_visibility, v_max_attendees, v_current_attendees, v_status
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.archived_at IS NULL
    AND e.status IS NOT NULL
    AND e.status NOT IN ('draft', 'cancelled', 'ended');

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event not found or not open for registration');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.event_registrations er
    WHERE er.event_id = p_event_id AND er.profile_id = v_user_id
  ) INTO v_already;

  IF v_already THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already registered');
  END IF;

  IF v_max_attendees IS NOT NULL
     AND v_current_attendees IS NOT NULL
     AND v_current_attendees >= v_max_attendees THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event is full');
  END IF;

  -- DB visibility: 'all' (public), 'premium', 'vip' — mirror tiers.ts access
  IF v_visibility IS NOT NULL AND v_visibility <> 'all' THEN
    SELECT COALESCE(p.subscription_tier, 'free') INTO v_user_tier
    FROM public.profiles p
    WHERE p.id = v_user_id;

    IF v_visibility = 'premium' AND COALESCE(v_user_tier, 'free') NOT IN ('premium', 'vip') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'This event requires a Premium subscription'
      );
    END IF;

    IF v_visibility = 'vip' AND COALESCE(v_user_tier, 'free') <> 'vip' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'This event requires a VIP subscription'
      );
    END IF;
  END IF;

  INSERT INTO public.event_registrations (event_id, profile_id)
  VALUES (p_event_id, v_user_id);

  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already registered');
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_for_event(uuid) TO authenticated;

DROP POLICY IF EXISTS "Users can register for events" ON public.event_registrations;

CREATE POLICY "Users cannot insert event_registrations directly"
  ON public.event_registrations
  FOR INSERT
  TO authenticated
  WITH CHECK (false);
