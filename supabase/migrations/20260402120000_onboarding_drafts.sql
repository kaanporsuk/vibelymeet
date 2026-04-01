-- Backend-owned onboarding draft table.
-- One active draft per user. Server is the source of truth for onboarding
-- state; client local storage is a non-authoritative cache only.

CREATE TABLE IF NOT EXISTS public.onboarding_drafts (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  schema_version smallint NOT NULL DEFAULT 2,
  current_step   smallint NOT NULL DEFAULT 0,
  current_stage  text NOT NULL DEFAULT 'none'
    CHECK (current_stage IN ('none','auth_complete','identity','details','media','complete')),
  onboarding_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_client_platform text CHECK (last_client_platform IN ('web','native')),
  completed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE INDEX IF NOT EXISTS idx_onboarding_drafts_expires
  ON public.onboarding_drafts (expires_at)
  WHERE completed_at IS NULL;

ALTER TABLE public.onboarding_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own onboarding draft"
  ON public.onboarding_drafts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own onboarding draft"
  ON public.onboarding_drafts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own onboarding draft"
  ON public.onboarding_drafts FOR UPDATE
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.onboarding_drafts IS
  'Server-owned onboarding draft. One per user. Source of truth for in-progress onboarding.';


-- ─── get_onboarding_draft ────────────────────────────────────────────────────
-- Returns the active (non-expired, non-completed) draft for the calling user,
-- or null if none exists.

CREATE OR REPLACE FUNCTION public.get_onboarding_draft(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_draft public.onboarding_drafts%ROWTYPE;
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT * INTO v_draft
  FROM public.onboarding_drafts
  WHERE user_id = p_user_id
    AND completed_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('draft', NULL);
  END IF;

  RETURN jsonb_build_object(
    'draft', jsonb_build_object(
      'schema_version', v_draft.schema_version,
      'current_step',   v_draft.current_step,
      'current_stage',  v_draft.current_stage,
      'onboarding_data', v_draft.onboarding_data,
      'updated_at',     v_draft.updated_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_onboarding_draft(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_onboarding_draft(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_onboarding_draft IS
  'Returns the active onboarding draft for the authenticated user, or null.';


-- ─── save_onboarding_draft ───────────────────────────────────────────────────
-- Upserts the onboarding draft. Idempotent. Step/stage are explicitly set by
-- the client (not monotonic-only) so the user can go back.

CREATE OR REPLACE FUNCTION public.save_onboarding_draft(
  p_user_id        uuid,
  p_step           smallint,
  p_stage          text,
  p_data           jsonb,
  p_schema_version smallint DEFAULT 2,
  p_platform       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF p_stage NOT IN ('none','auth_complete','identity','details','media') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_stage');
  END IF;

  IF p_step < 0 OR p_step > 15 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_step');
  END IF;

  INSERT INTO public.onboarding_drafts (
    user_id, schema_version, current_step, current_stage,
    onboarding_data, last_client_platform, updated_at, expires_at
  ) VALUES (
    p_user_id, p_schema_version, p_step, p_stage,
    p_data, p_platform, now(), now() + interval '30 days'
  )
  ON CONFLICT (user_id) DO UPDATE SET
    schema_version       = EXCLUDED.schema_version,
    current_step         = EXCLUDED.current_step,
    current_stage        = EXCLUDED.current_stage,
    onboarding_data      = EXCLUDED.onboarding_data,
    last_client_platform = EXCLUDED.last_client_platform,
    updated_at           = now(),
    expires_at           = now() + interval '30 days'
  WHERE onboarding_drafts.completed_at IS NULL;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.save_onboarding_draft(uuid, smallint, text, jsonb, smallint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_onboarding_draft(uuid, smallint, text, jsonb, smallint, text) TO authenticated;

COMMENT ON FUNCTION public.save_onboarding_draft IS
  'Upserts the onboarding draft. Idempotent. Rejects writes to completed drafts.';


-- ─── finalize_onboarding ─────────────────────────────────────────────────────
-- Atomic finalization: reads draft → validates → writes to profiles → marks
-- onboarding_complete → creates credits → marks draft completed.
-- Fully server-side. Idempotent (re-calling on completed user returns success).

CREATE OR REPLACE FUNCTION public.finalize_onboarding(p_user_id uuid)
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

  -- Idempotent: if already onboarded, return success
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_user_id AND onboarding_complete = true
  ) THEN
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

  -- Load draft
  SELECT * INTO v_draft
  FROM public.onboarding_drafts
  WHERE user_id = p_user_id AND completed_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'no_draft',
      'errors', jsonb_build_array('No onboarding draft found')
    );
  END IF;

  v_data := v_draft.onboarding_data;

  -- Extract fields from JSONB
  v_name          := trim(COALESCE(v_data->>'name', ''));
  v_birth_date    := COALESCE(v_data->>'birthDate', '');
  v_gender        := COALESCE(v_data->>'gender', '');
  v_gender_custom := trim(COALESCE(v_data->>'genderCustom', ''));
  v_interested_in := COALESCE(v_data->>'interestedIn', '');
  v_rel_intent    := COALESCE(v_data->>'relationshipIntent', '');
  v_height_cm     := (v_data->>'heightCm')::int;
  v_job           := trim(COALESCE(v_data->>'job', ''));
  v_about_me      := trim(COALESCE(v_data->>'aboutMe', ''));
  v_location      := COALESCE(v_data->>'location', '');
  v_location_data := v_data->'locationData';
  v_country       := COALESCE(v_data->>'country', '');
  v_bunny_video_uid := v_data->>'bunnyVideoUid';
  v_community_agreed := COALESCE((v_data->>'communityAgreed')::boolean, false);

  -- Parse photos array from JSONB
  SELECT COALESCE(array_agg(elem::text), ARRAY[]::text[])
  INTO v_photos
  FROM jsonb_array_elements_text(COALESCE(v_data->'photos', '[]'::jsonb)) AS elem;

  -- Compute derived fields
  IF v_birth_date != '' THEN
    v_age := EXTRACT(YEAR FROM age(v_birth_date::date));
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

  -- ─── Validate (mirrors complete_onboarding rules exactly) ──────────────

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

  -- ─── Write to profiles (server-side, replaces client upsert) ───────────

  SET LOCAL ROLE postgres;

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

  -- Baseline credits (idempotent)
  INSERT INTO public.user_credits (user_id, extra_time_credits, extended_vibe_credits)
  VALUES (p_user_id, 0, 0)
  ON CONFLICT (user_id) DO NOTHING;

  -- Mark draft as completed
  UPDATE public.onboarding_drafts
  SET completed_at = now(), updated_at = now()
  WHERE user_id = p_user_id;

  -- Read back vibe score (computed by trigger)
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

REVOKE ALL ON FUNCTION public.finalize_onboarding(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_onboarding(uuid) TO authenticated;

COMMENT ON FUNCTION public.finalize_onboarding IS
  'Atomic onboarding finalization: reads draft, validates, writes to profiles, sets onboarding_complete, creates baseline credits. Idempotent.';
