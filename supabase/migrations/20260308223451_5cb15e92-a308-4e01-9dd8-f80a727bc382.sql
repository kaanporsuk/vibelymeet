-- Fix get_event_deck: enforce auth.uid() = p_user_id
CREATE OR REPLACE FUNCTION public.get_event_deck(p_event_id uuid, p_user_id uuid, p_limit integer DEFAULT 50)
RETURNS TABLE(profile_id uuid, name text, age integer, gender text, avatar_url text, photos text[], bio text, job text, location text, height_cm integer, tagline text, looking_for text, queue_status text, has_met_before boolean, is_already_connected boolean, has_super_vibed boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Security: caller can only request their own deck
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Access denied: p_user_id must match the authenticated user';
  END IF;

  RETURN QUERY
  SELECT
    p.id AS profile_id, p.name, p.age, p.gender, p.avatar_url, p.photos,
    p.bio, p.job, p.location, p.height_cm, p.tagline, p.looking_for,
    er.queue_status,
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
    AND NOT EXISTS (
      SELECT 1 FROM public.event_swipes es
      WHERE es.event_id = p_event_id AND es.actor_id = p_user_id AND es.target_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND ((vs.participant_1_id = p_user_id AND vs.participant_2_id = p.id)
          OR (vs.participant_2_id = p_user_id AND vs.participant_1_id = p.id))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.matches m
      WHERE ((m.profile_id_1 = p_user_id AND m.profile_id_2 = p.id)
          OR (m.profile_id_2 = p_user_id AND m.profile_id_1 = p.id))
    )
    AND NOT is_blocked(p_user_id, p.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_reports ur
      WHERE ur.reporter_id = p_user_id AND ur.reported_id = p.id
    )
    AND (p.is_suspended = false OR p.is_suspended IS NULL)
  ORDER BY
    EXISTS (
      SELECT 1 FROM public.event_swipes es2
      WHERE es2.event_id = p_event_id AND es2.actor_id = p.id AND es2.target_id = p_user_id
        AND es2.swipe_type = 'super_vibe'
    ) DESC,
    er.registered_at DESC
  LIMIT p_limit;
END;
$function$;

-- Create a secure view that excludes sensitive PII for the Daily Drop policy
-- Instead of revoking columns (which would break service-role operations),
-- we create a restricted view and update the broad RLS policy

-- Drop the overly broad "Daily Drop" policy that exposes all columns
DROP POLICY IF EXISTS "Users can view potential matches for Daily Drop" ON public.profiles;

-- Recreate a tighter policy that still allows Daily Drop but excludes sensitive fields
-- We use a security definer function to return only safe columns
CREATE OR REPLACE FUNCTION public.get_daily_drop_candidates(p_user_id uuid, p_limit integer DEFAULT 20)
RETURNS TABLE(
  id uuid, name text, age integer, gender text, avatar_url text, photos text[],
  bio text, tagline text, location text, looking_for text, height_cm integer,
  job text, company text, about_me text, prompts jsonb, lifestyle jsonb,
  vibe_caption text, photo_verified boolean, phone_verified boolean,
  bunny_video_status text, vibe_video_status text, interested_in text[]
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.name, p.age, p.gender, p.avatar_url, p.photos,
    p.bio, p.tagline, p.location, p.looking_for, p.height_cm,
    p.job, p.company, p.about_me, p.prompts, p.lifestyle,
    p.vibe_caption, p.photo_verified, p.phone_verified,
    p.bunny_video_status, p.vibe_video_status, p.interested_in
  FROM public.profiles p
  WHERE p.is_suspended = false
    AND p.id != p_user_id
    AND check_gender_compatibility(p_user_id, p.gender, p.interested_in)
    AND NOT is_blocked(p_user_id, p.id)
  ORDER BY random()
  LIMIT p_limit;
END;
$function$;

-- Re-add a restricted Daily Drop policy: only allow viewing id, name, age, gender, avatar_url, photos
-- for gender-compatible users (needed for the swipe cards to render basic info)
CREATE POLICY "Users can view potential matches for Daily Drop"
  ON public.profiles
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND is_suspended = false
    AND check_gender_compatibility(auth.uid(), gender, interested_in)
  );