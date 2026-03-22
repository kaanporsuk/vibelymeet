-- Cached profile completeness score (single source of truth for web + native).
-- Algorithm mirrors legacy client `src/utils/calculateVibeScore.ts` / `apps/mobile/lib/calculateVibeScore.ts`.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vibe_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vibe_score_label text NOT NULL DEFAULT 'Getting started';

COMMENT ON COLUMN public.profiles.vibe_score IS '0–100 profile completeness score; computed server-side.';
COMMENT ON COLUMN public.profiles.vibe_score_label IS 'Short label for UI; computed server-side.';

-- Core calculation from a profiles row (+ profile_vibes count).
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
  SELECT count(*)::integer INTO v_vibe_count
  FROM public.profile_vibes pv
  WHERE pv.profile_id = p.id;

  SELECT count(*)::integer INTO v_photo_count
  FROM unnest(COALESCE(p.photos, ARRAY[]::text[])) AS ph(photo)
  WHERE ph.photo IS NOT NULL AND btrim(ph.photo) <> '';

  SELECT count(*)::integer INTO v_prompt_answer_count
  FROM jsonb_array_elements(COALESCE(p.prompts, '[]'::jsonb)) AS elem
  WHERE length(btrim(COALESCE(elem->>'answer', ''))) > 0;

  v_lifestyle_key_count := 0;
  IF p.lifestyle IS NOT NULL AND jsonb_typeof(p.lifestyle) = 'object' THEN
    SELECT count(*)::integer INTO v_lifestyle_key_count
    FROM jsonb_object_keys(COALESCE(p.lifestyle, '{}'::jsonb)) AS k(key);
  END IF;

  -- Base fields (matches TS calculateVibeScore; verified always false in legacy clients → +0)
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

  -- Photos: up to 24 (8 each, max 3)
  v_score := v_score + LEAST(v_photo_count * 8, 24);

  -- Vibes: 3 each, max 12
  v_score := v_score + LEAST(v_vibe_count * 3, 12);

  -- Prompts: 7 per answered prompt
  v_score := v_score + (v_prompt_answer_count * 7);

  -- Vibe video
  IF p.bunny_video_uid IS NOT NULL AND p.bunny_video_status = 'ready' THEN
    v_score := v_score + 10;
  END IF;

  v_score := LEAST(v_score, 100);

  -- Profile Studio copy: subtitle under the ring
  v_label := CASE
    WHEN v_score >= 75 THEN 'Excellent'
    WHEN v_score >= 50 THEN 'Good'
    ELSE 'Getting started'
  END;

  RETURN jsonb_build_object('score', v_score, 'label', v_label);
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_vibe_score(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('score', 0, 'label', 'Getting started');
  END IF;
  RETURN public.calculate_vibe_score_from_row(r);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_profiles_set_vibe_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.calculate_vibe_score_from_row(NEW);
  NEW.vibe_score := (v_result->>'score')::integer;
  NEW.vibe_score_label := v_result->>'label';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_set_vibe_score ON public.profiles;
CREATE TRIGGER trg_profiles_set_vibe_score
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_profiles_set_vibe_score();

-- Vibes live in profile_vibes; updating them does not touch profiles unless we recalc here.
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
  SELECT * INTO r FROM public.profiles WHERE id = pid;
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  v_result := public.calculate_vibe_score_from_row(r);
  UPDATE public.profiles
  SET
    vibe_score = (v_result->>'score')::integer,
    vibe_score_label = v_result->>'label'
  WHERE id = pid;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_vibes_refresh_vibe_score ON public.profile_vibes;
CREATE TRIGGER trg_profile_vibes_refresh_vibe_score
  AFTER INSERT OR UPDATE OR DELETE ON public.profile_vibes
  FOR EACH ROW
  EXECUTE PROCEDURE public.trg_profile_vibes_refresh_vibe_score();

-- Backfill existing rows
DO $$
DECLARE
  r public.profiles%ROWTYPE;
  v_result jsonb;
BEGIN
  FOR r IN SELECT * FROM public.profiles
  LOOP
    v_result := public.calculate_vibe_score_from_row(r);
    UPDATE public.profiles
    SET
      vibe_score = (v_result->>'score')::integer,
      vibe_score_label = v_result->>'label'
    WHERE id = r.id;
  END LOOP;
END;
$$;

-- Optional: client-callable refresh (e.g. after edge functions that skip triggers)
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
