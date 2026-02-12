-- Create a deck-building function with all filtering rules
CREATE OR REPLACE FUNCTION public.get_event_deck(
  p_event_id uuid,
  p_user_id uuid,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  profile_id uuid,
  name text,
  age int,
  gender text,
  avatar_url text,
  photos text[],
  bio text,
  job text,
  location text,
  height_cm int,
  tagline text,
  looking_for text,
  video_intro_url text,
  queue_status text,
  has_met_before boolean,
  is_already_connected boolean,
  has_super_vibed boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS profile_id,
    p.name,
    p.age,
    p.gender,
    p.avatar_url,
    p.photos,
    p.bio,
    p.job,
    p.location,
    p.height_cm,
    p.tagline,
    p.looking_for,
    p.video_intro_url,
    er.queue_status,
    -- RULE 4: Met before in a different event
    EXISTS (
      SELECT 1 FROM public.video_sessions vs
      WHERE vs.event_id != p_event_id
        AND ((vs.participant_1_id = p_user_id AND vs.participant_2_id = p.id)
          OR (vs.participant_2_id = p_user_id AND vs.participant_1_id = p.id))
    ) AS has_met_before,
    -- Already connected (persistent match)
    EXISTS (
      SELECT 1 FROM public.matches m
      WHERE ((m.profile_id_1 = p_user_id AND m.profile_id_2 = p.id)
          OR (m.profile_id_2 = p_user_id AND m.profile_id_1 = p.id))
    ) AS is_already_connected,
    -- Super vibe received (placeholder for future swipe table)
    false AS has_super_vibed
  FROM public.event_registrations er
  JOIN public.profiles p ON p.id = er.profile_id
  WHERE er.event_id = p_event_id
    AND er.profile_id != p_user_id
    -- RULE 1: Same event only (inherent from WHERE)
    -- RULE 2: Gender compatibility (bidirectional)
    AND (
      EXISTS (
        SELECT 1 FROM public.profiles viewer
        WHERE viewer.id = p_user_id
        AND (
          viewer.interested_in IS NULL
          OR cardinality(viewer.interested_in) = 0
          OR p.gender = ANY(viewer.interested_in)
          OR (p.gender = 'woman' AND 'women' = ANY(viewer.interested_in))
          OR (p.gender = 'man' AND 'men' = ANY(viewer.interested_in))
          OR (p.gender = 'non-binary' AND 'non-binary' = ANY(viewer.interested_in))
        )
      )
    )
    AND (
      p.interested_in IS NULL
      OR cardinality(p.interested_in) = 0
      OR EXISTS (
        SELECT 1 FROM public.profiles viewer
        WHERE viewer.id = p_user_id
        AND (
          viewer.gender = ANY(p.interested_in)
          OR (viewer.gender = 'woman' AND 'women' = ANY(p.interested_in))
          OR (viewer.gender = 'man' AND 'men' = ANY(p.interested_in))
          OR (viewer.gender = 'non-binary' AND 'non-binary' = ANY(p.interested_in))
        )
      )
    )
    -- RULE 4: Exclude already-dated in THIS event
    AND NOT EXISTS (
      SELECT 1 FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND ((vs.participant_1_id = p_user_id AND vs.participant_2_id = p.id)
          OR (vs.participant_2_id = p_user_id AND vs.participant_1_id = p.id))
    )
    -- RULE 5: Exclude persistent matches (filter them out; frontend can also show "already connected" cards)
    AND NOT EXISTS (
      SELECT 1 FROM public.matches m
      WHERE ((m.profile_id_1 = p_user_id AND m.profile_id_2 = p.id)
          OR (m.profile_id_2 = p_user_id AND m.profile_id_1 = p.id))
    )
    -- RULE 6: Exclude blocked (both directions)
    AND NOT is_blocked(p_user_id, p.id)
    -- RULE 6: Exclude reported by current user
    AND NOT EXISTS (
      SELECT 1 FROM public.user_reports ur
      WHERE ur.reporter_id = p_user_id AND ur.reported_id = p.id
    )
    -- Don't show suspended users
    AND (p.is_suspended = false OR p.is_suspended IS NULL)
  ORDER BY
    -- Freshness: most recently joined event first
    er.registered_at DESC
  LIMIT p_limit;
END;
$$;
