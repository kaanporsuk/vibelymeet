-- Add queue management columns to event_registrations for video matching
ALTER TABLE public.event_registrations 
ADD COLUMN IF NOT EXISTS queue_status text DEFAULT 'idle',
ADD COLUMN IF NOT EXISTS current_room_id uuid,
ADD COLUMN IF NOT EXISTS current_partner_id uuid,
ADD COLUMN IF NOT EXISTS dates_completed integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_matched_at timestamptz,
ADD COLUMN IF NOT EXISTS joined_queue_at timestamptz;

-- Add check constraint for valid queue statuses
ALTER TABLE public.event_registrations 
ADD CONSTRAINT valid_queue_status 
CHECK (queue_status IN ('idle', 'searching', 'matched', 'in_date', 'completed'));

-- Create index for efficient queue matching
CREATE INDEX IF NOT EXISTS idx_event_registrations_queue 
ON public.event_registrations (event_id, queue_status, joined_queue_at)
WHERE queue_status = 'searching';

-- Create index for finding user's current match status
CREATE INDEX IF NOT EXISTS idx_event_registrations_partner
ON public.event_registrations (profile_id, current_partner_id)
WHERE current_partner_id IS NOT NULL;

-- Update RLS policy to allow users to update their own queue status
DROP POLICY IF EXISTS "Users can update own queue status" ON public.event_registrations;
CREATE POLICY "Users can update own queue status"
ON public.event_registrations
FOR UPDATE
USING (auth.uid() = profile_id)
WITH CHECK (auth.uid() = profile_id);

-- Function to find and create a match for video dating
CREATE OR REPLACE FUNCTION public.find_video_date_match(
  p_event_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_gender text;
  v_user_interested_in text[];
  v_partner_id uuid;
  v_partner_gender text;
  v_room_id uuid;
  v_result jsonb;
BEGIN
  -- Get current user's preferences
  SELECT gender, interested_in INTO v_user_gender, v_user_interested_in
  FROM public.profiles WHERE id = p_user_id;
  
  IF v_user_gender IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User profile not found');
  END IF;

  -- Find a compatible partner who is also searching
  SELECT er.profile_id, p.gender INTO v_partner_id, v_partner_gender
  FROM public.event_registrations er
  JOIN public.profiles p ON p.id = er.profile_id
  WHERE er.event_id = p_event_id
    AND er.queue_status = 'searching'
    AND er.profile_id != p_user_id
    -- Check gender compatibility (bidirectional)
    AND (v_user_interested_in IS NULL OR cardinality(v_user_interested_in) = 0 OR p.gender = ANY(v_user_interested_in))
    AND (p.interested_in IS NULL OR cardinality(p.interested_in) = 0 OR v_user_gender = ANY(p.interested_in))
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

  -- Generate room ID
  v_room_id := gen_random_uuid();

  -- Update both users to matched status
  UPDATE public.event_registrations
  SET queue_status = 'matched',
      current_room_id = v_room_id,
      current_partner_id = v_partner_id,
      last_matched_at = now()
  WHERE event_id = p_event_id AND profile_id = p_user_id;

  UPDATE public.event_registrations
  SET queue_status = 'matched',
      current_room_id = v_room_id,
      current_partner_id = p_user_id,
      last_matched_at = now()
  WHERE event_id = p_event_id AND profile_id = v_partner_id;

  -- Create video session record
  INSERT INTO public.video_sessions (event_id, participant_1_id, participant_2_id)
  VALUES (p_event_id, p_user_id, v_partner_id);

  RETURN jsonb_build_object(
    'success', true,
    'matched', true,
    'room_id', v_room_id,
    'partner_id', v_partner_id
  );
END;
$$;

-- Function to join the matching queue
CREATE OR REPLACE FUNCTION public.join_matching_queue(
  p_event_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_registered boolean;
  v_current_status text;
  v_event_start timestamptz;
  v_event_end timestamptz;
BEGIN
  -- Check if user is registered for event
  SELECT EXISTS (
    SELECT 1 FROM public.event_registrations
    WHERE event_id = p_event_id AND profile_id = p_user_id
  ) INTO v_is_registered;

  IF NOT v_is_registered THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not registered for this event');
  END IF;

  -- Check if event is live
  SELECT event_date, event_date + (duration_minutes || ' minutes')::interval
  INTO v_event_start, v_event_end
  FROM public.events WHERE id = p_event_id;

  IF now() < v_event_start THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event has not started yet');
  END IF;

  IF now() > v_event_end THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event has ended');
  END IF;

  -- Get current queue status
  SELECT queue_status INTO v_current_status
  FROM public.event_registrations
  WHERE event_id = p_event_id AND profile_id = p_user_id;

  IF v_current_status IN ('matched', 'in_date') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already in a date or matched');
  END IF;

  -- Update to searching status
  UPDATE public.event_registrations
  SET queue_status = 'searching',
      joined_queue_at = now(),
      current_room_id = NULL,
      current_partner_id = NULL
  WHERE event_id = p_event_id AND profile_id = p_user_id;

  -- Try to find a match immediately
  RETURN find_video_date_match(p_event_id, p_user_id);
END;
$$;

-- Function to leave the queue or end a date
CREATE OR REPLACE FUNCTION public.leave_matching_queue(
  p_event_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_partner_id uuid;
  v_room_id uuid;
BEGIN
  -- Get current partner if any
  SELECT current_partner_id, current_room_id INTO v_partner_id, v_room_id
  FROM public.event_registrations
  WHERE event_id = p_event_id AND profile_id = p_user_id;

  -- Reset user's queue status
  UPDATE public.event_registrations
  SET queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      dates_completed = dates_completed + CASE WHEN v_partner_id IS NOT NULL THEN 1 ELSE 0 END
  WHERE event_id = p_event_id AND profile_id = p_user_id;

  -- If there was a partner, reset their status too
  IF v_partner_id IS NOT NULL THEN
    UPDATE public.event_registrations
    SET queue_status = 'idle',
        current_room_id = NULL,
        current_partner_id = NULL,
        dates_completed = dates_completed + 1
    WHERE event_id = p_event_id AND profile_id = v_partner_id;

    -- Update the video session end time
    UPDATE public.video_sessions
    SET ended_at = now(),
        duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))::integer
    WHERE event_id = p_event_id
      AND ((participant_1_id = p_user_id AND participant_2_id = v_partner_id)
        OR (participant_2_id = p_user_id AND participant_1_id = v_partner_id))
      AND ended_at IS NULL;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Enable realtime for queue status changes
ALTER PUBLICATION supabase_realtime ADD TABLE event_registrations;