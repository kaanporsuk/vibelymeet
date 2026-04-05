-- Align the backend completion contract with the UI-required onboarding steps.
--
-- Previously the backend only required: name, birth_date, age>=18, gender, 2+ photos,
-- and about_me (optional, but >=10 chars if provided).
--
-- The UI on both web and native blocks users on these additional steps, but the backend
-- did not enforce them. This migration adds server-side enforcement for:
--   - interested_in (non-empty array)
--   - relationship_intent (non-empty string)
--   - community_agreed_at (non-null, i.e. user agreed)
--
-- Location is intentionally NOT added here because the location step has silent failure
-- paths that need UX hardening first.
--
-- Changes:
-- 1. complete_onboarding: adds 3 new validation checks on the profiles row
-- 2. finalize_onboarding: adds 3 new validation checks on p_final_data before writing
--    to profiles, so the user gets clear errors rather than a partial write + later gate

-- ─── 1. complete_onboarding ─────────────────────────────────────────────────────

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

  -- ── existing required fields ──────────────────────────────────────────────

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

  -- ── newly required fields (aligned with UI-blocking steps) ────────────────

  IF v_profile.interested_in IS NULL OR array_length(v_profile.interested_in, 1) IS NULL
     OR array_length(v_profile.interested_in, 1) = 0
     OR (array_length(v_profile.interested_in, 1) = 1 AND v_profile.interested_in[1] = '') THEN
    v_errors := array_append(v_errors, 'Interested in is required');
  END IF;

  IF v_profile.relationship_intent IS NULL OR v_profile.relationship_intent = '' THEN
    v_errors := array_append(v_errors, 'Relationship intent is required');
  END IF;

  IF v_profile.community_agreed_at IS NULL THEN
    v_errors := array_append(v_errors, 'Community standards agreement is required');
  END IF;

  -- ── gate ──────────────────────────────────────────────────────────────────

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

COMMENT ON FUNCTION public.complete_onboarding IS
  'Validates required onboarding fields and marks the profile as onboarding-complete. '
  'Required: name, birth_date, age>=18, gender, 2+ photos, interested_in, relationship_intent, community_agreed_at. '
  'About me is optional but must be >=10 chars when provided.';


-- ─── 2. finalize_onboarding ─────────────────────────────────────────────────────
-- Add early validation for the three new required fields so the user gets clear
-- errors before the profile UPDATE, rather than a partial write + later gate.

CREATE OR REPLACE FUNCTION public.finalize_onboarding(
  p_user_id uuid,
  p_final_data jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_draft public.onboarding_drafts%ROWTYPE;
  v_data jsonb;
  v_errors text[] := ARRAY[]::text[];

  v_name text;
  v_birth_date text;
  v_birth_date_norm text;
  v_age int;
  v_gender text;
  v_gender_custom text;
  v_interested_in text;
  v_rel_intent text;
  v_height_cm int;
  v_job text;
  v_photos text[];
  v_about_me text;
  v_location text;
  v_location_data jsonb;
  v_country text;
  v_bunny_video_uid text;
  v_community_agreed boolean;

  v_photo_count int;
  v_normalized_intent text;
  v_normalized_gender text;

  v_complete_result jsonb;

  v_vibe_score int;
  v_vibe_score_label text;
  v_has_final_data boolean := false;
  v_auth_email text;
  v_completion_step smallint;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'forbidden',
      'errors', jsonb_build_array('Forbidden')
    );
  END IF;

  SELECT *
  INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'profile_not_found',
      'errors', jsonb_build_array('User profile row does not exist')
    );
  END IF;

  IF v_profile.onboarding_complete = true THEN
    RETURN jsonb_build_object(
      'success', true,
      'error', NULL,
      'errors', '[]'::jsonb,
      'already_completed', true,
      'vibe_score', COALESCE(v_profile.vibe_score, 0),
      'vibe_score_label', COALESCE(v_profile.vibe_score_label, 'New')
    );
  END IF;

  v_has_final_data := p_final_data IS NOT NULL
    AND p_final_data != 'null'::jsonb
    AND p_final_data != '{}'::jsonb;

  SELECT NULLIF(trim(COALESCE(au.email, '')), '')
  INTO v_auth_email
  FROM auth.users au
  WHERE au.id = p_user_id;

  v_completion_step := CASE
    WHEN v_auth_email IS NULL THEN 14
    ELSE 13
  END;

  SELECT *
  INTO v_draft
  FROM public.onboarding_drafts
  WHERE user_id = p_user_id
    AND completed_at IS NULL
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    IF NOT v_has_final_data THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'no_draft',
        'errors', jsonb_build_array('No onboarding draft found and no final payload was provided')
      );
    END IF;

    INSERT INTO public.onboarding_drafts (
      user_id,
      schema_version,
      current_step,
      current_stage,
      onboarding_data,
      last_client_platform,
      completed_at,
      updated_at,
      expires_at
    )
    VALUES (
      p_user_id,
      2,
      v_completion_step,
      'media',
      p_final_data,
      NULL,
      NULL,
      now(),
      now() + interval '30 days'
    )
    ON CONFLICT (user_id) DO UPDATE
    SET schema_version = EXCLUDED.schema_version,
        current_step = EXCLUDED.current_step,
        current_stage = EXCLUDED.current_stage,
        onboarding_data = EXCLUDED.onboarding_data,
        last_client_platform = COALESCE(public.onboarding_drafts.last_client_platform, EXCLUDED.last_client_platform),
        completed_at = NULL,
        updated_at = now(),
        expires_at = now() + interval '30 days';

    SELECT *
    INTO v_draft
    FROM public.onboarding_drafts
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'draft_materialization_failed',
        'errors', jsonb_build_array('Could not materialize onboarding draft for finalization')
      );
    END IF;
  END IF;

  IF v_has_final_data THEN
    v_data := p_final_data;

    UPDATE public.onboarding_drafts
    SET onboarding_data = p_final_data,
        updated_at = now(),
        expires_at = GREATEST(expires_at, now() + interval '30 days')
    WHERE user_id = p_user_id;
  ELSE
    v_data := v_draft.onboarding_data;
  END IF;

  v_name := trim(COALESCE(v_data->>'name', ''));
  v_birth_date := COALESCE(v_data->>'birthDate', '');
  v_gender := COALESCE(v_data->>'gender', '');
  v_gender_custom := trim(COALESCE(v_data->>'genderCustom', ''));
  v_interested_in := COALESCE(v_data->>'interestedIn', '');
  v_rel_intent := COALESCE(v_data->>'relationshipIntent', '');
  v_job := trim(COALESCE(v_data->>'job', ''));
  v_about_me := trim(COALESCE(v_data->>'aboutMe', ''));
  v_location := COALESCE(v_data->>'location', '');
  v_location_data := v_data->'locationData';
  v_country := COALESCE(v_data->>'country', '');
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

  IF v_rel_intent IS NULL OR trim(v_rel_intent) = '' THEN
    v_normalized_intent := NULL;
  ELSE
    v_normalized_intent := public.normalize_relationship_intent(v_rel_intent);
    IF v_normalized_intent IS NULL THEN
      v_normalized_intent := 'figuring-out';
    END IF;
  END IF;

  -- ── existing validation ───────────────────────────────────────────────────

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

  -- ── newly required fields (aligned with UI-blocking steps) ────────────────

  IF v_interested_in = '' THEN
    v_errors := array_append(v_errors, 'Interested in is required');
  END IF;

  IF v_rel_intent IS NULL OR trim(v_rel_intent) = '' THEN
    v_errors := array_append(v_errors, 'Relationship intent is required');
  END IF;

  IF NOT v_community_agreed THEN
    v_errors := array_append(v_errors, 'Community standards agreement is required');
  END IF;

  -- ── gate ──────────────────────────────────────────────────────────────────

  IF array_length(v_errors, 1) IS NOT NULL AND array_length(v_errors, 1) > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'validation_failed',
      'errors', to_jsonb(v_errors)
    );
  END IF;

  PERFORM set_config('vibely.onboarding_server_update', '1', true);

  BEGIN
    UPDATE public.profiles
    SET name = v_name,
        birth_date = NULLIF(v_birth_date_norm, '')::date,
        age = v_age,
        gender = v_normalized_gender,
        interested_in = ARRAY[v_interested_in],
        relationship_intent = v_normalized_intent,
        looking_for = v_normalized_intent,
        height_cm = v_height_cm,
        job = NULLIF(v_job, ''),
        photos = v_photos,
        avatar_url = NULLIF(v_photos[1], ''),
        about_me = NULLIF(v_about_me, ''),
        location = NULLIF(v_location, ''),
        location_data = CASE
          WHEN v_location_data IS NOT NULL AND v_location_data != 'null'::jsonb THEN v_location_data
          ELSE NULL
        END,
        country = NULLIF(v_country, ''),
        bunny_video_uid = NULLIF(v_bunny_video_uid, ''),
        community_agreed_at = CASE WHEN v_community_agreed THEN now() ELSE NULL END,
        updated_at = now()
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

  SELECT public.complete_onboarding(p_user_id) INTO v_complete_result;

  IF COALESCE((v_complete_result->>'success')::boolean, false) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'validation_failed',
      'errors', COALESCE(v_complete_result->'errors', '[]'::jsonb),
      'already_completed', false
    );
  END IF;

  IF v_photo_count > 0 THEN
    UPDATE public.draft_media_sessions
    SET status = 'published',
        published_at = now()
    WHERE user_id = p_user_id
      AND media_type = 'photo'
      AND status IN ('created', 'ready')
      AND storage_path = ANY(v_photos);
  END IF;

  UPDATE public.draft_media_sessions
  SET status = 'abandoned'
  WHERE user_id = p_user_id
    AND media_type = 'photo'
    AND status IN ('published', 'ready', 'created')
    AND (storage_path IS NULL OR NOT (storage_path = ANY(v_photos)));

  INSERT INTO public.user_credits (user_id, extra_time_credits, extended_vibe_credits)
  VALUES (p_user_id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.onboarding_drafts
  SET completed_at = now(),
      current_step = GREATEST(COALESCE(current_step, 0), v_completion_step)::smallint,
      current_stage = 'complete',
      onboarding_data = v_data,
      updated_at = now(),
      expires_at = GREATEST(expires_at, now() + interval '30 days')
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

COMMENT ON FUNCTION public.finalize_onboarding(uuid, jsonb) IS
  'Atomic server-owned onboarding finalization. Idempotent. If p_final_data is supplied and no active draft exists, materializes a coherent draft row before validation so dropped client draft saves cannot cause a last-step failure. '
  'Required fields: name, birthDate, age>=18, gender, 2+ photos, interestedIn, relationshipIntent, communityAgreed. About me optional but >=10 chars when provided.';
