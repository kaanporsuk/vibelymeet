
-- PROMPT 5: Add vibe_questions field to video_sessions for synchronized questions
ALTER TABLE public.video_sessions 
ADD COLUMN vibe_questions jsonb DEFAULT '[]'::jsonb;

-- PROMPT 6: Fix find_video_date_match to exclude ALL past sessions (not just active ones)
-- and exclude users with existing persistent matches
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
BEGIN
  SELECT gender, interested_in INTO v_user_gender, v_user_interested_in
  FROM public.profiles WHERE id = p_user_id;
  
  IF v_user_gender IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User profile not found');
  END IF;

  SELECT er.profile_id, p.gender INTO v_partner_id, v_partner_gender
  FROM public.event_registrations er
  JOIN public.profiles p ON p.id = er.profile_id
  WHERE er.event_id = p_event_id
    AND er.queue_status = 'searching'
    AND er.profile_id != p_user_id
    -- Gender compatibility (bidirectional)
    AND (
      v_user_interested_in IS NULL 
      OR cardinality(v_user_interested_in) = 0 
      OR p.gender = ANY(v_user_interested_in)
      OR (p.gender = 'woman' AND 'women' = ANY(v_user_interested_in))
      OR (p.gender = 'man' AND 'men' = ANY(v_user_interested_in))
      OR (p.gender = 'non-binary' AND 'non-binary' = ANY(v_user_interested_in))
    )
    AND (
      p.interested_in IS NULL 
      OR cardinality(p.interested_in) = 0 
      OR v_user_gender = ANY(p.interested_in)
      OR (v_user_gender = 'woman' AND 'women' = ANY(p.interested_in))
      OR (v_user_gender = 'man' AND 'men' = ANY(p.interested_in))
      OR (v_user_gender = 'non-binary' AND 'non-binary' = ANY(p.interested_in))
    )
    -- Not blocked
    AND NOT is_blocked(p_user_id, er.profile_id)
    -- RULE 1: No re-matching within same event (ANY past session, not just active)
    AND NOT EXISTS (
      SELECT 1 FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND ((vs.participant_1_id = p_user_id AND vs.participant_2_id = er.profile_id)
          OR (vs.participant_2_id = p_user_id AND vs.participant_1_id = er.profile_id))
    )
    -- RULE 2: No re-matching for existing persistent matches
    AND NOT EXISTS (
      SELECT 1 FROM public.matches m
      WHERE ((m.profile_id_1 = p_user_id AND m.profile_id_2 = er.profile_id)
          OR (m.profile_id_2 = p_user_id AND m.profile_id_1 = er.profile_id))
    )
    -- RULE 4: Reported users excluded
    AND NOT EXISTS (
      SELECT 1 FROM public.user_reports ur
      WHERE ur.reporter_id = p_user_id AND ur.reported_id = er.profile_id
    )
  ORDER BY er.joined_queue_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_partner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'waiting', true, 'message', 'Searching for a match...');
  END IF;

  INSERT INTO public.video_sessions (event_id, participant_1_id, participant_2_id)
  VALUES (p_event_id, p_user_id, v_partner_id)
  RETURNING id INTO v_session_id;

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

-- PROMPT 7: Create date_feedback table
CREATE TABLE public.date_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  target_id uuid NOT NULL,
  liked boolean NOT NULL DEFAULT false,
  tag_chemistry boolean DEFAULT false,
  tag_fun boolean DEFAULT false,
  tag_smart boolean DEFAULT false,
  tag_respectful boolean DEFAULT false,
  energy text CHECK (energy IN ('calm', 'energetic', 'intense')),
  conversation_flow text CHECK (conversation_flow IN ('natural', 'effort', 'one_sided')),
  photo_accurate text CHECK (photo_accurate IN ('yes', 'not_sure', 'no')),
  honest_representation text CHECK (honest_representation IN ('yes', 'not_sure', 'no')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(session_id, user_id)
);

-- Enable RLS
ALTER TABLE public.date_feedback ENABLE ROW LEVEL SECURITY;

-- RLS policies for date_feedback
CREATE POLICY "Users can create own feedback"
ON public.date_feedback
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own feedback"
ON public.date_feedback
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update own feedback"
ON public.date_feedback
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all feedback"
ON public.date_feedback
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Function to check mutual vibe and create match
CREATE OR REPLACE FUNCTION public.check_mutual_vibe_and_match(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session record;
  v_user1_liked boolean;
  v_user2_liked boolean;
  v_match_id uuid;
  v_existing_match uuid;
BEGIN
  -- Get session details
  SELECT * INTO v_session FROM public.video_sessions WHERE id = p_session_id;
  IF v_session IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Session not found');
  END IF;

  -- Get feedback from both users
  SELECT liked INTO v_user1_liked FROM public.date_feedback 
  WHERE session_id = p_session_id AND user_id = v_session.participant_1_id;
  
  SELECT liked INTO v_user2_liked FROM public.date_feedback 
  WHERE session_id = p_session_id AND user_id = v_session.participant_2_id;

  -- Check if both have submitted and both liked
  IF v_user1_liked IS TRUE AND v_user2_liked IS TRUE THEN
    -- Check if match already exists
    SELECT id INTO v_existing_match FROM public.matches
    WHERE (profile_id_1 = v_session.participant_1_id AND profile_id_2 = v_session.participant_2_id)
       OR (profile_id_2 = v_session.participant_1_id AND profile_id_1 = v_session.participant_2_id);

    IF v_existing_match IS NULL THEN
      -- Create persistent match
      INSERT INTO public.matches (profile_id_1, profile_id_2, event_id)
      VALUES (v_session.participant_1_id, v_session.participant_2_id, v_session.event_id)
      RETURNING id INTO v_match_id;

      RETURN jsonb_build_object('success', true, 'mutual', true, 'match_id', v_match_id);
    ELSE
      RETURN jsonb_build_object('success', true, 'mutual', true, 'match_id', v_existing_match, 'already_matched', true);
    END IF;
  END IF;

  -- Not mutual yet (or one passed)
  RETURN jsonb_build_object('success', true, 'mutual', false);
END;
$function$;
