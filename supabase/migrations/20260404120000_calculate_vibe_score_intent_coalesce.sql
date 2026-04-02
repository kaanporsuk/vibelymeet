-- Authoritative fix for persisted `profiles.vibe_score` / `vibe_score_label`.
-- Replaces `public.calculate_vibe_score(uuid)` with the same body as
-- `20260327120000_vibe_score_prompts_max_10.sql`, except the intent +5 block uses
-- COALESCE(relationship_intent, looking_for) with trim/non-empty checks.
--
-- Note: `20260404100000_vibe_score_intent_coalesce_bunny_uid.sql` updates
-- `calculate_vibe_score_from_row` only (legacy helper; not what drives the
-- Iconic/Fire tier scorer below).

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

  -- Photos: 5 each, max 30
  v_score := v_score + LEAST(v_photo_count * 5, 30);

  -- Vibe Video: 15 points if uid EXISTS (not just ready)
  IF v_profile.bunny_video_uid IS NOT NULL
     AND length(trim(v_profile.bunny_video_uid)) > 0 THEN
    v_score := v_score + 15;
  END IF;

  -- Prompts: 4 + 3 + 3 = max 10
  IF v_prompt_count >= 1 THEN v_score := v_score + 4; END IF;
  IF v_prompt_count >= 2 THEN v_score := v_score + 3; END IF;
  IF v_prompt_count >= 3 THEN v_score := v_score + 3; END IF;

  -- Bio: 10 points if >10 chars
  IF v_bio_length > 10 THEN
    v_score := v_score + 10;
  END IF;

  -- Tagline: 5 points
  IF v_profile.tagline IS NOT NULL
     AND length(trim(v_profile.tagline)) > 0 THEN
    v_score := v_score + 5;
  END IF;

  -- Looking for: 5 points (canonical column + legacy mirror)
  IF COALESCE(v_profile.relationship_intent, v_profile.looking_for) IS NOT NULL
     AND length(trim(COALESCE(v_profile.relationship_intent, v_profile.looking_for))) > 0 THEN
    v_score := v_score + 5;
  END IF;

  -- Job: 3 points
  IF v_profile.job IS NOT NULL
     AND length(trim(v_profile.job)) > 0 THEN
    v_score := v_score + 3;
  END IF;

  -- Height: 2 points
  IF v_profile.height_cm IS NOT NULL THEN
    v_score := v_score + 2;
  END IF;

  -- Phone verified: 5 points
  IF v_profile.phone_verified = true THEN
    v_score := v_score + 5;
  END IF;

  -- Email verified: 3 points
  IF v_profile.email_verified = true THEN
    v_score := v_score + 3;
  END IF;

  -- Photo verified: 5 points
  IF v_profile.photo_verified = true THEN
    v_score := v_score + 5;
  END IF;

  -- Lifestyle: 2 points if any data
  IF v_profile.lifestyle IS NOT NULL
     AND v_profile.lifestyle <> '{}'::jsonb
     AND v_profile.lifestyle <> 'null'::jsonb
     AND jsonb_typeof(v_profile.lifestyle) = 'object'
     AND (SELECT count(*)::integer FROM jsonb_object_keys(v_profile.lifestyle) AS k) > 0 THEN
    v_score := v_score + 2;
  END IF;

  -- Name: 5 points
  IF v_profile.name IS NOT NULL
     AND length(trim(v_profile.name)) > 0 THEN
    v_score := v_score + 5;
  END IF;

  v_score := LEAST(v_score, 100);

  v_label := CASE
    WHEN v_score >= 90 THEN 'Iconic'
    WHEN v_score >= 75 THEN 'Fire'
    WHEN v_score >= 60 THEN 'Excellent'
    WHEN v_score >= 45 THEN 'Rising'
    WHEN v_score >= 25 THEN 'Getting Started'
    ELSE 'New'
  END;

  RETURN jsonb_build_object('score', v_score, 'label', v_label);
END;
$$;
