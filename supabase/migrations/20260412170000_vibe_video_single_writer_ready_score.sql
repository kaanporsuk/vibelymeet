-- PR 4: make vibe-video state backend-owned end to end for active flows and
-- align score credit with actual ready state.
--
-- Changes:
-- 1. `update_media_session_status` now syncs the profile snapshot for
--    processing/ready/failed while guarding on the current `bunny_video_uid`.
-- 2. `calculate_vibe_score(uuid)` grants vibe-video credit only when the
--    backend-owned snapshot is both present and `ready`.
-- 3. The legacy `calculate_vibe_score_from_row` helper mirrors the same
--    ready-only video rule to avoid split score semantics in old callers.

CREATE OR REPLACE FUNCTION public.update_media_session_status(
  p_provider_id  text,
  p_new_status   text,
  p_error_detail text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_session    public.draft_media_sessions%ROWTYPE;
  v_allowed    boolean;
  v_old_status text;
BEGIN
  IF p_new_status NOT IN ('uploading', 'processing', 'ready', 'failed') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'invalid_transition',
      'detail', format('Status %L is not settable via webhook', p_new_status)
    );
  END IF;

  SELECT * INTO v_session
  FROM public.draft_media_sessions
  WHERE provider_id = p_provider_id
    AND status NOT IN ('published', 'deleted', 'abandoned', 'failed')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
  END IF;

  v_old_status := v_session.status;

  IF v_old_status = p_new_status THEN
    RETURN jsonb_build_object(
      'success', true,
      'session_id', v_session.id,
      'user_id', v_session.user_id,
      'previous_status', v_old_status,
      'new_status', p_new_status,
      'idempotent', true
    );
  END IF;

  v_allowed := false;
  IF p_new_status = 'failed' THEN
    v_allowed := true;
  ELSIF p_new_status = 'uploading' AND v_old_status = 'created' THEN
    v_allowed := true;
  ELSIF p_new_status = 'processing' AND v_old_status IN ('created', 'uploading') THEN
    v_allowed := true;
  ELSIF p_new_status = 'ready' AND v_old_status IN ('created', 'uploading', 'processing') THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'invalid_transition',
      'detail', format('Cannot transition from %L to %L', v_old_status, p_new_status)
    );
  END IF;

  UPDATE public.draft_media_sessions
  SET status       = p_new_status,
      error_detail = COALESCE(p_error_detail, error_detail)
  WHERE id = v_session.id;

  -- Keep the profile snapshot coherent for the currently-active provider only.
  -- This prevents stale webhook events from regressing a replaced video.
  IF v_session.media_type = 'vibe_video' AND p_new_status IN ('processing', 'ready', 'failed') THEN
    UPDATE public.profiles
    SET bunny_video_status = p_new_status
    WHERE id = v_session.user_id
      AND bunny_video_uid = p_provider_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session.id,
    'user_id', v_session.user_id,
    'previous_status', v_old_status,
    'new_status', p_new_status
  );
END;
$$;

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

  -- Vibe Video: 15 points only when the backend snapshot is truly ready.
  IF v_profile.bunny_video_uid IS NOT NULL
     AND length(trim(v_profile.bunny_video_uid)) > 0
     AND v_profile.bunny_video_status = 'ready' THEN
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
       AND btrim(p.bunny_video_uid) <> ''
       AND p.bunny_video_status = 'ready' THEN
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
