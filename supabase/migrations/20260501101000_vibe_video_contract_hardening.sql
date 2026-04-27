-- Vibe Video contract hardening:
-- 1. Onboarding finalization must never clear a real Bunny UID with null/empty/pending payloads.
-- 2. New onboarding payload UIDs are accepted only when they are Bunny GUID-shaped and backed by
--    the user's current media-session history.
-- 3. Vibe Score video credit is UID-only, independent of processing/readiness status.

CREATE OR REPLACE FUNCTION public.is_valid_bunny_video_uid(p_uid text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    NULLIF(btrim(COALESCE(p_uid, '')), '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND lower(btrim(COALESCE(p_uid, ''))) <> 'pending',
    false
  );
$$;

COMMENT ON FUNCTION public.is_valid_bunny_video_uid(text) IS
  'Returns true only for Bunny Stream GUID-shaped video ids. Rejects empty and sentinel values such as pending.';

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
  v_payload_bunny_video_uid text;
  v_existing_bunny_video_uid text;
  v_bunny_video_uid text;
  v_community_agreed boolean;

  v_photo_count int;
  v_normalized_intent text;
  v_normalized_gender text;
  v_location_lat double precision;
  v_location_lng double precision;
  v_has_confirmed_location boolean := false;

  v_complete_result jsonb;
  v_photo_publish_result jsonb;
  v_video_sync_result jsonb;

  v_vibe_score int;
  v_vibe_score_label text;
  v_has_final_data boolean := false;
  v_auth_email text;
  v_completion_step smallint;
  v_video_status text;
  v_owner_prefix text;
  v_photo text;
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
  v_location := trim(COALESCE(v_data->>'location', ''));
  v_location_data := v_data->'locationData';
  v_country := trim(COALESCE(v_data->>'country', ''));
  v_payload_bunny_video_uid := NULLIF(trim(COALESCE(v_data->>'bunnyVideoUid', '')), '');
  v_existing_bunny_video_uid := NULLIF(trim(COALESCE(v_profile.bunny_video_uid, '')), '');
  v_bunny_video_uid := NULL;
  v_community_agreed := COALESCE((v_data->>'communityAgreed')::boolean, false);

  IF public.is_valid_bunny_video_uid(v_existing_bunny_video_uid) THEN
    v_bunny_video_uid := v_existing_bunny_video_uid;
  ELSIF public.is_valid_bunny_video_uid(v_payload_bunny_video_uid) THEN
    SELECT dms.provider_id
    INTO v_bunny_video_uid
    FROM public.draft_media_sessions dms
    WHERE dms.user_id = p_user_id
      AND dms.media_type = 'vibe_video'
      AND dms.provider_id = v_payload_bunny_video_uid
      AND dms.status NOT IN ('deleted', 'abandoned')
    ORDER BY dms.created_at DESC
    LIMIT 1;
  END IF;

  v_data := jsonb_set(
    COALESCE(v_data, '{}'::jsonb),
    '{bunnyVideoUid}',
    COALESCE(to_jsonb(v_bunny_video_uid), 'null'::jsonb),
    true
  );

  BEGIN
    v_height_cm := (v_data->>'heightCm')::int;
  EXCEPTION WHEN OTHERS THEN
    v_height_cm := NULL;
  END;

  SELECT COALESCE(array_agg(elem::text), ARRAY[]::text[])
  INTO v_photos
  FROM jsonb_array_elements_text(COALESCE(v_data->'photos', '[]'::jsonb)) AS elem;

  BEGIN
    IF v_location_data IS NOT NULL AND v_location_data != 'null'::jsonb THEN
      v_location_lat := NULLIF(trim(COALESCE(v_location_data->>'lat', '')), '')::double precision;
      v_location_lng := NULLIF(trim(COALESCE(v_location_data->>'lng', '')), '')::double precision;
      v_has_confirmed_location :=
        v_location_lat IS NOT NULL
        AND v_location_lng IS NOT NULL
        AND v_location_lat BETWEEN -90 AND 90
        AND v_location_lng BETWEEN -180 AND 180;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_location_lat := NULL;
    v_location_lng := NULL;
    v_has_confirmed_location := false;
  END;

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

  v_owner_prefix := 'photos/' || p_user_id::text || '/';
  FOREACH v_photo IN ARRAY v_photos LOOP
    IF v_photo IS NULL OR length(trim(v_photo)) = 0 THEN
      v_errors := array_append(v_errors, 'Photo path is invalid');
      CONTINUE;
    END IF;
    IF strpos(v_photo, '..') > 0 THEN
      v_errors := array_append(v_errors, 'Photo path is invalid');
      CONTINUE;
    END IF;
    IF NOT v_photo LIKE v_owner_prefix || '%' THEN
      v_errors := array_append(v_errors, 'Photo path is forbidden');
    END IF;
  END LOOP;

  IF v_photo_count > 0 AND (
    SELECT COUNT(DISTINCT u) FROM unnest(v_photos) AS u
  ) <> v_photo_count THEN
    v_errors := array_append(v_errors, 'Duplicate photos are not allowed');
  END IF;

  IF v_about_me != '' AND length(v_about_me) < 10 THEN
    v_errors := array_append(v_errors, 'About me must be at least 10 characters');
  END IF;

  IF v_interested_in = '' THEN
    v_errors := array_append(v_errors, 'Interested in is required');
  END IF;

  IF v_rel_intent IS NULL OR trim(v_rel_intent) = '' THEN
    v_errors := array_append(v_errors, 'Relationship intent is required');
  END IF;

  IF v_location = '' OR v_country = '' OR NOT v_has_confirmed_location THEN
    v_errors := array_append(v_errors, 'Confirmed location is required');
  END IF;

  IF NOT v_community_agreed THEN
    v_errors := array_append(v_errors, 'Community standards agreement is required');
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
          WHEN v_has_confirmed_location THEN jsonb_build_object('lat', v_location_lat, 'lng', v_location_lng)
          ELSE NULL
        END,
        country = NULLIF(v_country, ''),
        bunny_video_uid = v_bunny_video_uid,
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

  v_photo_publish_result := public.publish_photo_set(
    p_user_id,
    v_photos,
    'onboarding'
  );
  IF COALESCE((v_photo_publish_result->>'success')::boolean, false) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'photo_publish_failed',
      'errors', jsonb_build_array(COALESCE(v_photo_publish_result->>'error', 'Photo publish failed'))
    );
  END IF;

  IF v_bunny_video_uid IS NOT NULL THEN
    SELECT COALESCE(
      (
        SELECT CASE
          WHEN dms.status = 'published' THEN 'ready'
          ELSE dms.status
        END
        FROM public.draft_media_sessions dms
        WHERE dms.user_id = p_user_id
          AND dms.media_type = 'vibe_video'
          AND dms.provider_id = v_bunny_video_uid
        ORDER BY dms.created_at DESC
        LIMIT 1
      ),
      COALESCE(NULLIF(trim(COALESCE(v_profile.bunny_video_status, '')), ''), 'uploading')
    )
    INTO v_video_status;

    v_video_sync_result := public.activate_profile_vibe_video(
      p_user_id,
      v_bunny_video_uid,
      v_video_status
    );

    IF COALESCE((v_video_sync_result->>'success')::boolean, false) IS DISTINCT FROM true THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'video_sync_failed',
        'errors', jsonb_build_array(COALESCE(v_video_sync_result->>'error', 'Video sync failed'))
      );
    END IF;
  END IF;

  SELECT public.complete_onboarding(p_user_id) INTO v_complete_result;

  IF COALESCE((v_complete_result->>'success')::boolean, false) IS DISTINCT FROM true THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'validation_failed',
      'errors', COALESCE(v_complete_result->'errors', '[]'::jsonb),
      'already_completed', false
    );
  END IF;

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
  'Atomic server-owned onboarding finalization. Preserves existing real Vibe Video UIDs and accepts only GUID-shaped media-session-backed onboarding video UIDs.';

CREATE OR REPLACE FUNCTION public.calculate_vibe_score(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_photo_count integer;
  v_prompt_count integer;
  v_score integer := 0;
  v_label text;
  v_bio_length integer;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('score', 0, 'label', 'New');
  END IF;

  v_photo_count := COALESCE(array_length(v_profile.photos, 1), 0);

  v_prompt_count := 0;
  IF v_profile.prompts IS NOT NULL
     AND jsonb_typeof(v_profile.prompts) = 'array' THEN
    SELECT count(*)::integer INTO v_prompt_count
    FROM jsonb_array_elements(v_profile.prompts) AS p
    WHERE (p->>'answer') IS NOT NULL
      AND length(trim(p->>'answer')) > 0;
  END IF;

  v_bio_length := GREATEST(
    COALESCE(length(trim(COALESCE(v_profile.bio, ''))), 0),
    COALESCE(length(trim(COALESCE(v_profile.about_me, ''))), 0)
  );

  v_score := v_score + LEAST(v_photo_count * 5, 30);

  IF v_profile.bunny_video_uid IS NOT NULL
     AND length(trim(v_profile.bunny_video_uid)) > 0 THEN
    v_score := v_score + 15;
  END IF;

  IF v_prompt_count >= 1 THEN v_score := v_score + 4; END IF;
  IF v_prompt_count >= 2 THEN v_score := v_score + 3; END IF;
  IF v_prompt_count >= 3 THEN v_score := v_score + 3; END IF;

  IF v_bio_length > 10 THEN
    v_score := v_score + 10;
  END IF;

  IF v_profile.tagline IS NOT NULL
     AND length(trim(v_profile.tagline)) > 0 THEN
    v_score := v_score + 5;
  END IF;

  IF COALESCE(v_profile.relationship_intent, v_profile.looking_for) IS NOT NULL
     AND length(trim(COALESCE(v_profile.relationship_intent, v_profile.looking_for))) > 0 THEN
    v_score := v_score + 5;
  END IF;

  IF v_profile.job IS NOT NULL
     AND length(trim(v_profile.job)) > 0 THEN
    v_score := v_score + 3;
  END IF;

  IF v_profile.height_cm IS NOT NULL THEN
    v_score := v_score + 2;
  END IF;

  IF v_profile.phone_verified = true THEN
    v_score := v_score + 5;
  END IF;

  IF v_profile.email_verified = true THEN
    v_score := v_score + 3;
  END IF;

  IF v_profile.photo_verified = true THEN
    v_score := v_score + 5;
  END IF;

  IF v_profile.lifestyle IS NOT NULL
     AND v_profile.lifestyle <> '{}'::jsonb
     AND v_profile.lifestyle <> 'null'::jsonb
     AND jsonb_typeof(v_profile.lifestyle) = 'object'
     AND (SELECT count(*)::integer FROM jsonb_object_keys(v_profile.lifestyle) AS k) > 0 THEN
    v_score := v_score + 2;
  END IF;

  IF v_profile.name IS NOT NULL AND length(trim(v_profile.name)) > 0 THEN
    v_score := v_score + 5;
  END IF;

  IF v_score >= 90 THEN
    v_label := 'Iconic';
  ELSIF v_score >= 75 THEN
    v_label := 'Fire';
  ELSIF v_score >= 60 THEN
    v_label := 'Excellent';
  ELSIF v_score >= 45 THEN
    v_label := 'Rising';
  ELSIF v_score >= 25 THEN
    v_label := 'Getting Started';
  ELSE
    v_label := 'New';
  END IF;

  RETURN jsonb_build_object('score', LEAST(v_score, 100), 'label', v_label);
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_vibe_score_from_row(p public.profiles)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vibe_count integer;
  v_photo_count integer;
  v_prompt_answer_count integer;
  v_lifestyle_key_count integer;
  v_score integer := 0;
  v_label text;
BEGIN
  BEGIN
    SELECT count(*)::integer INTO v_vibe_count
    FROM public.profile_vibes pv
    WHERE pv.profile_id = p.id;

    SELECT count(*)::integer INTO v_photo_count
    FROM unnest(COALESCE(p.photos, ARRAY[]::text[])) AS ph(photo)
    WHERE ph.photo IS NOT NULL AND btrim(ph.photo) <> '';

    v_prompt_answer_count := 0;
    IF p.prompts IS NOT NULL AND jsonb_typeof(p.prompts) = 'array' THEN
      SELECT count(*)::integer INTO v_prompt_answer_count
      FROM jsonb_array_elements(p.prompts) AS elem
      WHERE length(btrim(COALESCE(elem->>'answer', ''))) > 0;
    END IF;

    v_lifestyle_key_count := 0;
    IF p.lifestyle IS NOT NULL AND jsonb_typeof(p.lifestyle) = 'object' THEN
      SELECT count(*)::integer INTO v_lifestyle_key_count
      FROM jsonb_object_keys(COALESCE(p.lifestyle, '{}'::jsonb)) AS k(key);
    END IF;

    IF p.name IS NOT NULL AND btrim(p.name) <> '' THEN
      v_score := v_score + 8;
    END IF;

    IF p.birth_date IS NOT NULL THEN
      v_score := v_score + 5;
    END IF;

    IF p.job IS NOT NULL AND btrim(p.job) <> '' THEN
      v_score := v_score + 8;
    END IF;

    IF p.height_cm IS NOT NULL THEN
      v_score := v_score + 5;
    END IF;

    IF p.location IS NOT NULL AND btrim(p.location) <> '' THEN
      v_score := v_score + 5;
    END IF;

    IF p.about_me IS NOT NULL AND length(btrim(p.about_me)) > 20 THEN
      v_score := v_score + 12;
    END IF;

    IF COALESCE(p.relationship_intent, p.looking_for) IS NOT NULL
       AND btrim(COALESCE(p.relationship_intent, p.looking_for)) <> '' THEN
      v_score := v_score + 5;
    END IF;

    IF v_lifestyle_key_count > 0 THEN
      v_score := v_score + 5;
    END IF;

    IF p.tagline IS NOT NULL AND btrim(p.tagline) <> '' THEN
      v_score := v_score + 2;
    END IF;

    v_score := v_score + LEAST(v_photo_count * 8, 24);
    v_score := v_score + LEAST(v_vibe_count * 3, 12);
    v_score := v_score + (v_prompt_answer_count * 7);

    IF p.bunny_video_uid IS NOT NULL
       AND btrim(p.bunny_video_uid) <> '' THEN
      v_score := v_score + 15;
    END IF;

    v_score := LEAST(v_score, 100);

    v_label := CASE
      WHEN v_score >= 75 THEN 'Excellent'
      WHEN v_score >= 50 THEN 'Good'
      ELSE 'Getting started'
    END;

    RETURN jsonb_build_object('score', v_score, 'label', v_label);
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'calculate_vibe_score_from_row failed for profile %: %', p.id, SQLERRM;
      RETURN jsonb_build_object('score', 0, 'label', 'Getting started');
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_stale_vibe_video_uploads_failed(
  p_stale_minutes int DEFAULT 45,
  p_limit int DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_stale_minutes int := GREATEST(COALESCE(p_stale_minutes, 45), 10);
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_profile_count int := 0;
  v_session_count int := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.stale_vibe_video_candidates (
    user_id uuid PRIMARY KEY,
    provider_id text NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE pg_temp.stale_vibe_video_candidates;

  INSERT INTO pg_temp.stale_vibe_video_candidates (user_id, provider_id)
  SELECT p.id, btrim(p.bunny_video_uid)
  FROM public.profiles p
  LEFT JOIN LATERAL (
    SELECT dms.updated_at
    FROM public.draft_media_sessions dms
    WHERE dms.user_id = p.id
      AND dms.media_type = 'vibe_video'
      AND dms.provider_id = btrim(p.bunny_video_uid)
      AND dms.status NOT IN ('deleted', 'abandoned', 'failed', 'published')
    ORDER BY dms.updated_at DESC
    LIMIT 1
  ) active_session ON true
  WHERE p.bunny_video_uid IS NOT NULL
    AND btrim(p.bunny_video_uid) <> ''
    AND COALESCE(NULLIF(btrim(p.bunny_video_status), ''), 'processing') IN ('uploading', 'processing')
    AND COALESCE(active_session.updated_at, p.updated_at) < now() - make_interval(mins => v_stale_minutes)
  ORDER BY COALESCE(active_session.updated_at, p.updated_at) ASC
  LIMIT v_limit
  FOR UPDATE OF p SKIP LOCKED;

  UPDATE public.draft_media_sessions dms
  SET status = 'failed',
      error_detail = COALESCE(dms.error_detail, 'stale_vibe_video_upload_watchdog')
  FROM pg_temp.stale_vibe_video_candidates c
  WHERE dms.user_id = c.user_id
    AND dms.media_type = 'vibe_video'
    AND dms.provider_id = c.provider_id
    AND dms.status NOT IN ('deleted', 'abandoned', 'failed', 'published');

  GET DIAGNOSTICS v_session_count = ROW_COUNT;

  UPDATE public.profiles p
  SET bunny_video_status = 'failed',
      updated_at = now()
  FROM pg_temp.stale_vibe_video_candidates c
  WHERE p.id = c.user_id
    AND btrim(p.bunny_video_uid) = c.provider_id
    AND COALESCE(NULLIF(btrim(p.bunny_video_status), ''), 'processing') IN ('uploading', 'processing');

  GET DIAGNOSTICS v_profile_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'stale_minutes', v_stale_minutes,
    'profile_rows_marked_failed', v_profile_count,
    'session_rows_marked_failed', v_session_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_stale_vibe_video_uploads_failed(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stale_vibe_video_uploads_failed(int, int) TO service_role;

COMMENT ON FUNCTION public.mark_stale_vibe_video_uploads_failed(int, int) IS
  'Service-role repair helper for Vibe Video rows stuck in uploading/processing beyond a bounded age. Preserves bunny_video_uid for score/history and marks readiness as failed.';
