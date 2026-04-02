-- PostgreSQL forbids SET LOCAL ROLE / set_config('role', ...) inside SECURITY DEFINER
-- functions (error: cannot set parameter "role" within security-definer function).
-- Onboarding RPCs used SET LOCAL ROLE postgres so protect_sensitive_profile_columns
-- would see current_user = postgres. Replace that with a transaction-local custom GUC
-- set only from trusted RPCs after auth.uid() checks.

CREATE OR REPLACE FUNCTION public.protect_sensitive_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.onboarding_complete := false;
    NEW.onboarding_stage := 'none';
    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE'
  IF NEW.onboarding_complete IS DISTINCT FROM OLD.onboarding_complete
     OR NEW.onboarding_stage IS DISTINCT FROM OLD.onboarding_stage THEN
    IF current_user::regrole::text IN ('postgres', 'supabase_admin') THEN
      NULL;
    ELSIF current_setting('vibely.onboarding_server_update', true) = '1' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Cannot modify onboarding_complete or onboarding_stage';
    END IF;
  END IF;

  IF NEW.is_premium IS DISTINCT FROM OLD.is_premium THEN
    RAISE EXCEPTION 'Cannot modify is_premium';
  END IF;
  IF NEW.premium_until IS DISTINCT FROM OLD.premium_until THEN
    RAISE EXCEPTION 'Cannot modify premium_until';
  END IF;
  IF NEW.premium_granted_at IS DISTINCT FROM OLD.premium_granted_at THEN
    RAISE EXCEPTION 'Cannot modify premium_granted_at';
  END IF;
  IF NEW.premium_granted_by IS DISTINCT FROM OLD.premium_granted_by THEN
    RAISE EXCEPTION 'Cannot modify premium_granted_by';
  END IF;
  IF NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier THEN
    RAISE EXCEPTION 'Cannot modify subscription_tier';
  END IF;
  IF NEW.is_suspended IS DISTINCT FROM OLD.is_suspended THEN
    RAISE EXCEPTION 'Cannot modify is_suspended';
  END IF;
  IF NEW.suspension_reason IS DISTINCT FROM OLD.suspension_reason THEN
    RAISE EXCEPTION 'Cannot modify suspension_reason';
  END IF;
  IF NEW.phone_verified IS DISTINCT FROM OLD.phone_verified THEN
    RAISE EXCEPTION 'Cannot modify phone_verified';
  END IF;
  IF NEW.phone_verified_at IS DISTINCT FROM OLD.phone_verified_at THEN
    RAISE EXCEPTION 'Cannot modify phone_verified_at';
  END IF;
  IF NEW.email_verified IS DISTINCT FROM OLD.email_verified THEN
    RAISE EXCEPTION 'Cannot modify email_verified';
  END IF;
  IF NEW.photo_verified IS DISTINCT FROM OLD.photo_verified THEN
    RAISE EXCEPTION 'Cannot modify photo_verified';
  END IF;
  IF NEW.photo_verified_at IS DISTINCT FROM OLD.photo_verified_at THEN
    RAISE EXCEPTION 'Cannot modify photo_verified_at';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.protect_sensitive_profile_columns IS 'Blocks self-service edits to premium, verification, subscription, suspension, and onboarding columns. Onboarding columns may change from trusted finalize_onboarding / complete_onboarding / update_onboarding_stage RPCs (transaction-local vibely.onboarding_server_update) or when current_user is postgres/supabase_admin.';


CREATE OR REPLACE FUNCTION public.update_onboarding_stage(
  p_user_id uuid,
  p_stage text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF p_stage NOT IN ('none', 'auth_complete', 'identity', 'details', 'media', 'complete') THEN
    RAISE EXCEPTION 'Invalid onboarding stage: %', p_stage;
  END IF;

  IF p_stage = 'complete' THEN
    RAISE EXCEPTION 'Use complete_onboarding() to set stage to complete';
  END IF;

  PERFORM set_config('vibely.onboarding_server_update', '1', true);

  BEGIN
    UPDATE public.profiles
    SET onboarding_stage = p_stage,
        updated_at = now()
    WHERE id = p_user_id
      AND (
        CASE onboarding_stage
          WHEN 'none' THEN 0
          WHEN 'auth_complete' THEN 1
          WHEN 'identity' THEN 2
          WHEN 'details' THEN 3
          WHEN 'media' THEN 4
          WHEN 'complete' THEN 5
          ELSE 0
        END
      ) < (
        CASE p_stage
          WHEN 'none' THEN 0
          WHEN 'auth_complete' THEN 1
          WHEN 'identity' THEN 2
          WHEN 'details' THEN 3
          WHEN 'media' THEN 4
          WHEN 'complete' THEN 5
          ELSE 0
        END
      );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('vibely.onboarding_server_update', NULL, true);
    RAISE;
  END;

  PERFORM set_config('vibely.onboarding_server_update', NULL, true);
END;
$$;

COMMENT ON FUNCTION public.update_onboarding_stage(uuid, text) IS 'Advances onboarding_stage monotonically for analytics/resume. Does not set onboarding_complete; use complete_onboarding() for completion.';


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

  PERFORM set_config('vibely.onboarding_server_update', '1', true);

  BEGIN
    UPDATE public.profiles
    SET onboarding_complete = true,
        onboarding_stage = 'complete',
        updated_at = now()
    WHERE id = p_user_id;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('vibely.onboarding_server_update', NULL, true);
    RAISE;
  END;

  PERFORM set_config('vibely.onboarding_server_update', NULL, true);

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

COMMENT ON FUNCTION public.complete_onboarding IS 'Validates required onboarding fields and marks the profile as onboarding-complete. About me is optional, but must be >=10 chars when provided.';


CREATE OR REPLACE FUNCTION public.finalize_onboarding(
  p_user_id   uuid,
  p_final_data jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_draft  public.onboarding_drafts%ROWTYPE;
  v_data   jsonb;
  v_errors text[] := ARRAY[]::text[];

  v_name            text;
  v_birth_date      text;
  v_age             int;
  v_gender          text;
  v_gender_custom   text;
  v_interested_in   text;
  v_rel_intent      text;
  v_height_cm       int;
  v_job             text;
  v_photos          text[];
  v_about_me        text;
  v_location        text;
  v_location_data   jsonb;
  v_country         text;
  v_bunny_video_uid text;
  v_community_agreed boolean;

  v_photo_count     int;
  v_normalized_intent text;
  v_normalized_gender text;

  v_vibe_score       int;
  v_vibe_score_label text;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'errors', jsonb_build_array('Forbidden'));
  END IF;

  PERFORM 1 FROM public.profiles
  WHERE id = p_user_id AND onboarding_complete = true
  FOR UPDATE;

  IF FOUND THEN
    SELECT vibe_score, vibe_score_label INTO v_vibe_score, v_vibe_score_label
    FROM public.profiles WHERE id = p_user_id;

    RETURN jsonb_build_object(
      'success', true,
      'error', NULL,
      'errors', '[]'::jsonb,
      'already_completed', true,
      'vibe_score', v_vibe_score,
      'vibe_score_label', v_vibe_score_label
    );
  END IF;

  SELECT * INTO v_draft
  FROM public.onboarding_drafts
  WHERE user_id = p_user_id AND completed_at IS NULL AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id AND onboarding_complete = true) THEN
      SELECT vibe_score, vibe_score_label INTO v_vibe_score, v_vibe_score_label
      FROM public.profiles WHERE id = p_user_id;
      RETURN jsonb_build_object(
        'success', true, 'error', NULL, 'errors', '[]'::jsonb,
        'already_completed', true,
        'vibe_score', v_vibe_score, 'vibe_score_label', v_vibe_score_label
      );
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'no_draft',
      'errors', jsonb_build_array('No onboarding draft found')
    );
  END IF;

  IF p_final_data IS NOT NULL AND p_final_data != 'null'::jsonb AND p_final_data != '{}'::jsonb THEN
    v_data := p_final_data;
    UPDATE public.onboarding_drafts
    SET onboarding_data = p_final_data, updated_at = now()
    WHERE user_id = p_user_id;
  ELSE
    v_data := v_draft.onboarding_data;
  END IF;

  v_name          := trim(COALESCE(v_data->>'name', ''));
  v_birth_date    := COALESCE(v_data->>'birthDate', '');
  v_gender        := COALESCE(v_data->>'gender', '');
  v_gender_custom := trim(COALESCE(v_data->>'genderCustom', ''));
  v_interested_in := COALESCE(v_data->>'interestedIn', '');
  v_rel_intent    := COALESCE(v_data->>'relationshipIntent', '');
  v_job           := trim(COALESCE(v_data->>'job', ''));
  v_about_me      := trim(COALESCE(v_data->>'aboutMe', ''));
  v_location      := COALESCE(v_data->>'location', '');
  v_location_data := v_data->'locationData';
  v_country       := COALESCE(v_data->>'country', '');
  v_bunny_video_uid := v_data->>'bunnyVideoUid';
  v_community_agreed := COALESCE((v_data->>'communityAgreed')::boolean, false);

  BEGIN
    v_height_cm := (v_data->>'heightCm')::int;
  EXCEPTION WHEN OTHERS THEN
    v_height_cm := NULL;
  END;

  SELECT COALESCE(array_agg(elem::text), ARRAY[]::text[])
  INTO v_photos
  FROM jsonb_array_elements_text(COALESCE(v_data->'photos', '[]'::jsonb)) AS elem;

  IF v_birth_date != '' THEN
    BEGIN
      v_age := EXTRACT(YEAR FROM age(v_birth_date::date));
    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, 'Invalid birth date format');
    END;
  END IF;

  IF v_gender = 'other' AND v_gender_custom != '' THEN
    v_normalized_gender := v_gender_custom;
  ELSE
    v_normalized_gender := v_gender;
  END IF;

  IF v_rel_intent = 'open' THEN
    v_normalized_intent := 'figuring-out';
  ELSE
    v_normalized_intent := v_rel_intent;
  END IF;

  IF v_name = '' THEN
    v_errors := array_append(v_errors, 'Name is required');
  END IF;

  IF v_birth_date = '' THEN
    v_errors := array_append(v_errors, 'Birthday is required');
  END IF;

  IF v_age IS NOT NULL AND v_age < 18 THEN
    v_errors := array_append(v_errors, 'Must be 18 or older');
  END IF;

  IF v_normalized_gender = '' OR v_normalized_gender = 'prefer_not_to_say' THEN
    v_errors := array_append(v_errors, 'Gender is required');
  END IF;

  v_photo_count := COALESCE(array_length(v_photos, 1), 0);
  IF v_photo_count < 2 THEN
    v_errors := array_append(v_errors, 'At least 2 photos required');
  END IF;

  IF v_about_me != '' AND length(v_about_me) < 10 THEN
    v_errors := array_append(v_errors, 'About me must be at least 10 characters');
  END IF;

  IF array_length(v_errors, 1) IS NOT NULL AND array_length(v_errors, 1) > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'validation_failed',
      'errors', to_jsonb(v_errors)
    );
  END IF;

  PERFORM set_config('vibely.onboarding_server_update', '1', true);

  BEGIN
    UPDATE public.profiles SET
      name               = v_name,
      birth_date         = v_birth_date,
      age                = v_age,
      gender             = v_normalized_gender,
      interested_in      = ARRAY[v_interested_in],
      relationship_intent = v_normalized_intent,
      looking_for        = v_normalized_intent,
      height_cm          = v_height_cm,
      job                = NULLIF(v_job, ''),
      photos             = v_photos,
      avatar_url         = NULLIF(v_photos[1], ''),
      about_me           = NULLIF(v_about_me, ''),
      location           = NULLIF(v_location, ''),
      location_data      = CASE WHEN v_location_data IS NOT NULL AND v_location_data != 'null'::jsonb
                                THEN v_location_data ELSE NULL END,
      country            = NULLIF(v_country, ''),
      bunny_video_uid    = NULLIF(v_bunny_video_uid, ''),
      community_agreed_at = CASE WHEN v_community_agreed THEN now() ELSE NULL END,
      onboarding_complete = true,
      onboarding_stage    = 'complete',
      updated_at          = now()
    WHERE id = p_user_id;

    IF NOT FOUND THEN
      PERFORM set_config('vibely.onboarding_server_update', NULL, true);
      RETURN jsonb_build_object(
        'success', false,
        'error', 'profile_not_found',
        'errors', jsonb_build_array('User profile row does not exist')
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('vibely.onboarding_server_update', NULL, true);
    RAISE;
  END;

  PERFORM set_config('vibely.onboarding_server_update', NULL, true);

  IF v_photo_count > 0 THEN
    UPDATE public.draft_media_sessions
    SET status       = 'published',
        published_at = now()
    WHERE user_id    = p_user_id
      AND media_type = 'photo'
      AND status IN ('created', 'ready')
      AND storage_path = ANY(v_photos);
  END IF;

  UPDATE public.draft_media_sessions
  SET status = 'abandoned'
  WHERE user_id    = p_user_id
    AND media_type = 'photo'
    AND status IN ('published', 'ready', 'created')
    AND (storage_path IS NULL OR NOT (storage_path = ANY(v_photos)));

  INSERT INTO public.user_credits (user_id, extra_time_credits, extended_vibe_credits)
  VALUES (p_user_id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.onboarding_drafts
  SET completed_at = now(), current_stage = 'complete', updated_at = now()
  WHERE user_id = p_user_id;

  SELECT vibe_score, vibe_score_label
  INTO v_vibe_score, v_vibe_score_label
  FROM public.profiles
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'error', NULL,
    'errors', '[]'::jsonb,
    'already_completed', false,
    'vibe_score', v_vibe_score,
    'vibe_score_label', v_vibe_score_label
  );
END;
$$;
