-- Emergency: vibe score triggers were failing on profile writes/reads that touch profiles,
-- breaking native profile load. Drop all related triggers immediately (both legacy and current names).
-- Functions are replaced with error-safe versions; triggers are NOT re-attached (follow-up).

DROP TRIGGER IF EXISTS trg_update_vibe_score ON public.profiles;
DROP TRIGGER IF EXISTS trg_profiles_set_vibe_score ON public.profiles;
DROP TRIGGER IF EXISTS trg_profile_vibes_refresh_vibe_score ON public.profile_vibes;

-- Harden calculation: prompts must be a JSON array; outer EXCEPTION catches any remaining edge cases.
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

    IF p.looking_for IS NOT NULL AND btrim(p.looking_for) <> '' THEN
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

    IF p.bunny_video_uid IS NOT NULL AND p.bunny_video_status = 'ready' THEN
      v_score := v_score + 10;
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

-- Safe trigger body for when we re-enable the trigger later.
CREATE OR REPLACE FUNCTION public.trg_profiles_set_vibe_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  BEGIN
    v_result := public.calculate_vibe_score_from_row(NEW);
    NEW.vibe_score := COALESCE((v_result->>'score')::integer, 0);
    NEW.vibe_score_label := COALESCE(v_result->>'label', 'Getting started');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Vibe score calc failed for %: %', NEW.id, SQLERRM;
      NEW.vibe_score := COALESCE(NEW.vibe_score, 0);
      NEW.vibe_score_label := COALESCE(NEW.vibe_score_label, 'Getting started');
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_profile_vibes_refresh_vibe_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
  r public.profiles%ROWTYPE;
  v_result jsonb;
BEGIN
  pid := COALESCE(NEW.profile_id, OLD.profile_id);
  BEGIN
    SELECT * INTO r FROM public.profiles WHERE id = pid;
    IF NOT FOUND THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
    v_result := public.calculate_vibe_score_from_row(r);
    UPDATE public.profiles
    SET
      vibe_score = COALESCE((v_result->>'score')::integer, 0),
      vibe_score_label = COALESCE(v_result->>'label', 'Getting started')
    WHERE id = pid;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'trg_profile_vibes_refresh_vibe_score failed for %: %', pid, SQLERRM;
  END;
  RETURN COALESCE(NEW, OLD);
END;
$$;
