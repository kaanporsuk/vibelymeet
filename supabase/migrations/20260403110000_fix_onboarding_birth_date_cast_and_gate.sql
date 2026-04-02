-- Production-safe onboarding DOB persistence fix.
-- Root cause: finalize_onboarding assigned v_birth_date (text) directly to
-- profiles.birth_date (date), which Postgres rejects with a type mismatch.
--
-- This migration:
-- - normalizes DOB to strict YYYY-MM-DD before persistence
-- - casts DOB explicitly when writing to profiles.birth_date
-- - keeps complete_onboarding() as the final completion gate
--   (finalize_onboarding writes fields + then calls complete_onboarding)

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
  v_birth_date_norm text;
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

  v_complete_result jsonb;

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
        'success', true,
        'error', NULL,
        'errors', '[]'::jsonb,
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
      -- Normalize to strict YYYY-MM-DD (date-only, no timezone/ISO issues)
      v_birth_date_norm := to_char(v_birth_date::date, 'YYYY-MM-DD');
      v_age := EXTRACT(YEAR FROM age(v_birth_date_norm::date));
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
    -- Persist onboarding-critical fields; completion flags are intentionally
    -- NOT set here. complete_onboarding() is the final authoritative gate.
    UPDATE public.profiles SET
      name               = v_name,
      birth_date         = NULLIF(v_birth_date_norm, '')::date,
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

  -- Final authoritative completion gate
  SELECT public.complete_onboarding(p_user_id) INTO v_complete_result;

  IF COALESCE((v_complete_result->>'success')::boolean, false) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'validation_failed',
      'errors', COALESCE(v_complete_result->'errors', '[]'::jsonb),
      'already_completed', false
    );
  END IF;

  -- Side effects only after completion gate succeeds
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

