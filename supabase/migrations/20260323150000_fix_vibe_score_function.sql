-- Replace vibe score algorithm with column-accurate scoring + safe trigger + backfill.
-- Drops legacy helpers/triggers from earlier migrations.

DROP TRIGGER IF EXISTS trg_update_vibe_score ON public.profiles;
DROP TRIGGER IF EXISTS trg_profiles_set_vibe_score ON public.profiles;
DROP TRIGGER IF EXISTS trg_profile_vibes_refresh_vibe_score ON public.profile_vibes;

DROP FUNCTION IF EXISTS public.refresh_my_vibe_score();
DROP FUNCTION IF EXISTS public.trg_profile_vibes_refresh_vibe_score();
DROP FUNCTION IF EXISTS public.trg_profiles_set_vibe_score();
DROP FUNCTION IF EXISTS public.update_profile_vibe_score();
DROP FUNCTION IF EXISTS public.calculate_vibe_score(uuid);
DROP FUNCTION IF EXISTS public.calculate_vibe_score_from_row(public.profiles);

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
     AND v_profile.bunny_video_status = 'ready' THEN
    v_score := v_score + 15;
  END IF;

  v_score := v_score + LEAST(v_prompt_count * 5, 15);

  IF v_bio_length > 10 THEN
    v_score := v_score + 10;
  END IF;

  IF v_profile.tagline IS NOT NULL
     AND length(trim(v_profile.tagline)) > 0 THEN
    v_score := v_score + 5;
  END IF;

  IF v_profile.looking_for IS NOT NULL
     AND length(trim(v_profile.looking_for)) > 0 THEN
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

CREATE OR REPLACE FUNCTION public.update_profile_vibe_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  BEGIN
    v_result := public.calculate_vibe_score(NEW.id);
    NEW.vibe_score := COALESCE((v_result->>'score')::integer, 0);
    NEW.vibe_score_label := COALESCE(v_result->>'label', 'New');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Vibe score calculation failed for %: %', NEW.id, SQLERRM;
      NEW.vibe_score := COALESCE(NEW.vibe_score, 0);
      NEW.vibe_score_label := COALESCE(NEW.vibe_score_label, 'New');
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_vibe_score
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_profile_vibe_score();

DO $$
DECLARE
  r RECORD;
  v_result jsonb;
BEGIN
  FOR r IN SELECT id FROM public.profiles
  LOOP
    BEGIN
      v_result := public.calculate_vibe_score(r.id);
      UPDATE public.profiles
      SET
        vibe_score = (v_result->>'score')::integer,
        vibe_score_label = v_result->>'label'
      WHERE id = r.id;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'Backfill failed for %: %', r.id, SQLERRM;
    END;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_my_vibe_score()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_result jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_result := public.calculate_vibe_score(v_uid);

  UPDATE public.profiles
  SET
    vibe_score = (v_result->>'score')::integer,
    vibe_score_label = v_result->>'label'
  WHERE id = v_uid;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_my_vibe_score() TO authenticated;
