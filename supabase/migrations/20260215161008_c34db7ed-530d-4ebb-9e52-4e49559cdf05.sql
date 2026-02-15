-- Update check_mutual_vibe_and_match to use LEAST/GREATEST for match insertion
-- to align with the unique index on matches
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
    -- Check if match already exists (using normalized order)
    SELECT id INTO v_existing_match FROM public.matches
    WHERE profile_id_1 = LEAST(v_session.participant_1_id, v_session.participant_2_id)
      AND profile_id_2 = GREATEST(v_session.participant_1_id, v_session.participant_2_id);

    IF v_existing_match IS NULL THEN
      -- Also check reverse order for legacy data
      SELECT id INTO v_existing_match FROM public.matches
      WHERE (profile_id_1 = v_session.participant_1_id AND profile_id_2 = v_session.participant_2_id)
         OR (profile_id_2 = v_session.participant_1_id AND profile_id_1 = v_session.participant_2_id);
    END IF;

    IF v_existing_match IS NULL THEN
      -- Create persistent match with normalized order
      INSERT INTO public.matches (profile_id_1, profile_id_2, event_id)
      VALUES (
        LEAST(v_session.participant_1_id, v_session.participant_2_id),
        GREATEST(v_session.participant_1_id, v_session.participant_2_id),
        v_session.event_id
      )
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_match_id;

      IF v_match_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'mutual', true, 'match_id', v_match_id);
      ELSE
        -- Race condition: match was created between check and insert
        SELECT id INTO v_existing_match FROM public.matches
        WHERE profile_id_1 = LEAST(v_session.participant_1_id, v_session.participant_2_id)
          AND profile_id_2 = GREATEST(v_session.participant_1_id, v_session.participant_2_id);
        RETURN jsonb_build_object('success', true, 'mutual', true, 'match_id', v_existing_match, 'already_matched', true);
      END IF;
    ELSE
      RETURN jsonb_build_object('success', true, 'mutual', true, 'match_id', v_existing_match, 'already_matched', true);
    END IF;
  END IF;

  -- Not mutual yet (or one passed)
  RETURN jsonb_build_object('success', true, 'mutual', false);
END;
$function$;