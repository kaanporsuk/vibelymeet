-- Owner profile reads need the same signed Vibe Video playback handle that
-- get_profile_for_viewer() already emits. Without this, /profile and
-- /vibe-studio can fall back to raw Bunny playlist/thumbnail URLs.

CREATE OR REPLACE FUNCTION public.get_my_profile_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
  v_referrer_name text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT p.*
  INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_profile.referred_by IS NOT NULL THEN
    SELECT NULLIF(btrim(p.name), '')
    INTO v_referrer_name
    FROM public.profiles p
    WHERE p.id = v_profile.referred_by;
  END IF;

  RETURN to_jsonb(v_profile)
    || jsonb_build_object(
      'age', CASE
        WHEN v_profile.birth_date IS NOT NULL THEN EXTRACT(YEAR FROM age(v_profile.birth_date))::integer
        ELSE v_profile.age
      END,
      'about_me', COALESCE(v_profile.about_me, v_profile.bio),
      'photo_verified', COALESCE(v_profile.photo_verified, false),
      'phone_verified', COALESCE(v_profile.phone_verified, false),
      'email_verified', COALESCE(v_profile.email_verified, false),
      'is_premium', COALESCE(v_profile.is_premium, false),
      'account_paused', COALESCE(v_profile.account_paused, false),
      'is_paused', COALESCE(v_profile.is_paused, false),
      'is_suspended', COALESCE(v_profile.is_suspended, false),
      'vibe_video_playback_ref', CASE
        WHEN v_profile.bunny_video_uid IS NOT NULL
          AND btrim(v_profile.bunny_video_uid) <> ''
          AND COALESCE(v_profile.bunny_video_status, '') = 'ready'
        THEN concat('profile_vibe_video:', v_profile.id::text, ':', btrim(v_profile.bunny_video_uid))
        ELSE NULL
      END,
      'referrer_name', v_referrer_name
    );
END;
$$;

COMMENT ON FUNCTION public.get_my_profile_settings() IS
  'Owner-only profile/settings read path. Includes owner-safe Vibe Video signed playback refs for ready videos.';

REVOKE ALL ON FUNCTION public.get_my_profile_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_profile_settings() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile_settings() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
