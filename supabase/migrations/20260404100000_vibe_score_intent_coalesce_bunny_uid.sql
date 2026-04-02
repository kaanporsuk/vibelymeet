-- Updates `calculate_vibe_score_from_row` only (legacy / alternate helper).
-- Persisted `profiles.vibe_score` is computed by `public.calculate_vibe_score(uuid)`;
-- the authoritative COALESCE(intent) fix for that path is
-- `20260404120000_calculate_vibe_score_intent_coalesce.sql`.
--
-- This file still: intent +5 via COALESCE on the row helper; vibe video +15 on non-empty uid (no `ready`).
-- Body otherwise matches `20260323141000_emergency_drop_vibe_score_triggers.sql` (exception-safe).

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

    IF p.bunny_video_uid IS NOT NULL AND btrim(p.bunny_video_uid) <> '' THEN
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
