-- Make about_me optional for onboarding completion.
-- If provided, still enforce minimum length of 10 chars.

CREATE OR REPLACE FUNCTION public.complete_onboarding(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_errors text[] := ARRAY[]::text[];
  v_photo_count int;
  v_vibe_score int;
  v_vibe_score_label text;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object(
      'success', false,
      'errors', jsonb_build_array('Forbidden')
    );
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'errors', jsonb_build_array('Profile not found')
    );
  END IF;

  IF v_profile.name IS NULL OR v_profile.name = '' THEN
    v_errors := array_append(v_errors, 'Name is required');
  END IF;

  IF v_profile.birth_date IS NULL THEN
    v_errors := array_append(v_errors, 'Birthday is required');
  END IF;

  IF v_profile.age IS NOT NULL AND v_profile.age < 18 THEN
    v_errors := array_append(v_errors, 'Must be 18 or older');
  END IF;

  IF v_profile.gender IS NULL OR v_profile.gender = '' OR v_profile.gender = 'prefer_not_to_say' THEN
    v_errors := array_append(v_errors, 'Gender is required');
  END IF;

  v_photo_count := COALESCE(array_length(v_profile.photos, 1), 0);
  IF v_photo_count < 2 THEN
    v_errors := array_append(v_errors, 'At least 2 photos required');
  END IF;

  IF v_profile.about_me IS NOT NULL
     AND length(trim(v_profile.about_me)) > 0
     AND length(trim(v_profile.about_me)) < 10 THEN
    v_errors := array_append(v_errors, 'About me must be at least 10 characters');
  END IF;

  IF array_length(v_errors, 1) IS NOT NULL AND array_length(v_errors, 1) > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'errors', to_jsonb(v_errors)
    );
  END IF;

  SET LOCAL ROLE postgres;

  UPDATE public.profiles
  SET onboarding_complete = true,
      onboarding_stage = 'complete',
      updated_at = now()
  WHERE id = p_user_id;

  SELECT vibe_score, vibe_score_label
  INTO v_vibe_score, v_vibe_score_label
  FROM public.profiles
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'errors', '[]'::jsonb,
    'vibe_score', v_vibe_score,
    'vibe_score_label', v_vibe_score_label
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_onboarding(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(uuid) TO authenticated;

COMMENT ON FUNCTION public.complete_onboarding IS 'Validates required onboarding fields and marks the profile as onboarding-complete. About me is optional, but must be >=10 chars when provided.';
