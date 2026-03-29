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
    AND NOT public.is_profile_hidden(p.id)
    AND p.id != p_user_id
    AND check_gender_compatibility(p_user_id, p.gender, p.interested_in)
    AND NOT is_blocked(p_user_id, p.id)
  ORDER BY random()
  LIMIT p_limit;
END;
$function$;
