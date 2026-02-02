-- Fix the find_video_date_match function to handle singular/plural gender mismatch
-- The gender field uses singular (man, woman) but interested_in uses plural (men, women)

CREATE OR REPLACE FUNCTION public.find_video_date_match(p_event_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_gender text;
  v_user_interested_in text[];
  v_partner_id uuid;
  v_partner_gender text;
  v_session_id uuid;
  v_result jsonb;
  
  -- Helper function to normalize gender for comparison
  -- Converts plural to singular: 'women' -> 'woman', 'men' -> 'man'
BEGIN
  -- Get current user's preferences
  SELECT gender, interested_in INTO v_user_gender, v_user_interested_in
  FROM public.profiles WHERE id = p_user_id;
  
  IF v_user_gender IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User profile not found');
  END IF;

  -- Find a compatible partner who is also searching
  -- Handle both singular (man/woman) and plural (men/women) in interested_in
  SELECT er.profile_id, p.gender INTO v_partner_id, v_partner_gender
  FROM public.event_registrations er
  JOIN public.profiles p ON p.id = er.profile_id
  WHERE er.event_id = p_event_id
    AND er.queue_status = 'searching'
    AND er.profile_id != p_user_id
    -- Check gender compatibility (bidirectional) with singular/plural handling
    -- User is interested in partner's gender
    AND (
      v_user_interested_in IS NULL 
      OR cardinality(v_user_interested_in) = 0 
      OR p.gender = ANY(v_user_interested_in)
      -- Handle plural -> singular conversion: 'women' matches 'woman', 'men' matches 'man'
      OR (p.gender = 'woman' AND 'women' = ANY(v_user_interested_in))
      OR (p.gender = 'man' AND 'men' = ANY(v_user_interested_in))
      OR (p.gender = 'non-binary' AND 'non-binary' = ANY(v_user_interested_in))
    )
    -- Partner is interested in user's gender
    AND (
      p.interested_in IS NULL 
      OR cardinality(p.interested_in) = 0 
      OR v_user_gender = ANY(p.interested_in)
      -- Handle plural -> singular conversion
      OR (v_user_gender = 'woman' AND 'women' = ANY(p.interested_in))
      OR (v_user_gender = 'man' AND 'men' = ANY(p.interested_in))
      OR (v_user_gender = 'non-binary' AND 'non-binary' = ANY(p.interested_in))
    )
    -- Not blocked
    AND NOT is_blocked(p_user_id, er.profile_id)
    -- Haven't already dated in this event
    AND NOT EXISTS (
      SELECT 1 FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND ((vs.participant_1_id = p_user_id AND vs.participant_2_id = er.profile_id)
          OR (vs.participant_2_id = p_user_id AND vs.participant_1_id = er.profile_id))
    )
  ORDER BY er.joined_queue_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_partner_id IS NULL THEN
    -- No match found, user stays in queue
    RETURN jsonb_build_object('success', false, 'waiting', true, 'message', 'Searching for a match...');
  END IF;

  -- Create video session record FIRST and get its ID
  INSERT INTO public.video_sessions (event_id, participant_1_id, participant_2_id)
  VALUES (p_event_id, p_user_id, v_partner_id)
  RETURNING id INTO v_session_id;

  -- Update both users to matched status using the video_session ID as room_id
  UPDATE public.event_registrations
  SET queue_status = 'matched',
      current_room_id = v_session_id,
      current_partner_id = v_partner_id,
      last_matched_at = now()
  WHERE event_id = p_event_id AND profile_id = p_user_id;

  UPDATE public.event_registrations
  SET queue_status = 'matched',
      current_room_id = v_session_id,
      current_partner_id = p_user_id,
      last_matched_at = now()
  WHERE event_id = p_event_id AND profile_id = v_partner_id;

  RETURN jsonb_build_object(
    'success', true,
    'matched', true,
    'room_id', v_session_id,
    'partner_id', v_partner_id
  );
END;
$function$;

-- Also fix the check_gender_compatibility function with the same logic
CREATE OR REPLACE FUNCTION public.check_gender_compatibility(_viewer_id uuid, _target_gender text, _target_interested_in text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (
    -- Check if viewer is interested in target's gender (with singular/plural handling)
    EXISTS (
      SELECT 1 FROM public.profiles AS viewer
      WHERE viewer.id = _viewer_id
      AND (
        viewer.interested_in IS NULL 
        OR cardinality(viewer.interested_in) = 0
        OR _target_gender = ANY(viewer.interested_in)
        -- Handle plural -> singular: 'women' matches 'woman', 'men' matches 'man'
        OR (_target_gender = 'woman' AND 'women' = ANY(viewer.interested_in))
        OR (_target_gender = 'man' AND 'men' = ANY(viewer.interested_in))
        OR (_target_gender = 'non-binary' AND 'non-binary' = ANY(viewer.interested_in))
      )
    )
    -- AND target is interested in viewer's gender (bidirectional) with singular/plural handling
    AND (
      _target_interested_in IS NULL 
      OR cardinality(_target_interested_in) = 0
      OR EXISTS (
        SELECT 1 FROM public.profiles AS viewer
        WHERE viewer.id = _viewer_id
        AND (
          viewer.gender = ANY(_target_interested_in)
          -- Handle plural -> singular
          OR (viewer.gender = 'woman' AND 'women' = ANY(_target_interested_in))
          OR (viewer.gender = 'man' AND 'men' = ANY(_target_interested_in))
          OR (viewer.gender = 'non-binary' AND 'non-binary' = ANY(_target_interested_in))
        )
      )
    )
  )
$function$;