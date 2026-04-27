-- Vibe Video backend contract repair hardening.
--
-- Canonical contract:
-- - non-empty profiles.bunny_video_uid means the user has uploaded Vibe Video and
--   earns Vibe Score video credit, independent of bunny_video_status.
-- - playback still requires ready status plus a usable client CDN URL.
-- - uploading/processing are durable, repairable states, never "no video".
-- Stale classifications include session_created_without_upload_progress,
-- session_uploading_stale, session_processing_stale, and
-- profile_processing_without_active_session/profile_uploading_without_active_session.

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

COMMENT ON FUNCTION public.calculate_vibe_score(uuid) IS
  'Authoritative Vibe Score calculator. Vibe Video credit is +15 for any non-empty profiles.bunny_video_uid, regardless of readiness/playback status.';

DO $$
DECLARE
  r record;
  v_result jsonb;
BEGIN
  FOR r IN
    SELECT id
    FROM public.profiles
    WHERE bunny_video_uid IS NOT NULL
      AND btrim(bunny_video_uid) <> ''
  LOOP
    v_result := public.calculate_vibe_score(r.id);
    UPDATE public.profiles
    SET vibe_score = (v_result->>'score')::integer,
        vibe_score_label = v_result->>'label'
    WHERE id = r.id;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.classify_stale_vibe_video_uploads(
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
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  WITH candidates AS (
    SELECT
      p.id AS user_id,
      btrim(p.bunny_video_uid) AS provider_id,
      COALESCE(NULLIF(btrim(COALESCE(p.bunny_video_status, '')), ''), 'processing') AS profile_status,
      p.updated_at AS profile_updated_at,
      dms.id AS session_id,
      dms.status AS session_status,
      dms.created_at AS session_created_at,
      dms.updated_at AS session_updated_at,
      COALESCE(dms.updated_at, p.updated_at) AS last_activity_at
    FROM public.profiles p
    LEFT JOIN LATERAL (
      SELECT id, status, created_at, updated_at
      FROM public.draft_media_sessions dms
      WHERE dms.user_id = p.id
        AND dms.media_type = 'vibe_video'
        AND dms.provider_id = btrim(p.bunny_video_uid)
        AND dms.status IN ('created', 'uploading', 'processing')
      ORDER BY dms.updated_at DESC, dms.created_at DESC
      LIMIT 1
    ) dms ON true
    WHERE p.bunny_video_uid IS NOT NULL
      AND btrim(p.bunny_video_uid) <> ''
      AND COALESCE(NULLIF(btrim(COALESCE(p.bunny_video_status, '')), ''), 'processing') IN ('uploading', 'processing')
      AND COALESCE(dms.updated_at, p.updated_at) < now() - make_interval(mins => v_stale_minutes)
    ORDER BY COALESCE(dms.updated_at, p.updated_at) ASC
    LIMIT v_limit
  ),
  classified AS (
    SELECT
      *,
      CASE
        WHEN session_id IS NULL THEN 'profile_' || profile_status || '_without_active_session'
        WHEN session_status = 'created' THEN 'session_created_without_upload_progress'
        WHEN session_status = 'uploading' THEN 'session_uploading_stale'
        WHEN session_status = 'processing' THEN 'session_processing_stale'
        ELSE 'profile_' || profile_status || '_stale'
      END AS classification
    FROM candidates
  )
  SELECT jsonb_build_object(
    'success', true,
    'stale_minutes', v_stale_minutes,
    'limit', v_limit,
    'candidate_count', (SELECT count(*) FROM classified),
    'classifications', COALESCE(
      (
        SELECT jsonb_object_agg(classification, n)
        FROM (
          SELECT classification, count(*) AS n
          FROM classified
          GROUP BY classification
        ) grouped
      ),
      '{}'::jsonb
    ),
    'candidates', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'user_id', user_id,
            'provider_id', provider_id,
            'profile_status', profile_status,
            'session_id', session_id,
            'session_status', session_status,
            'classification', classification,
            'last_activity_at', last_activity_at,
            'profile_updated_at', profile_updated_at,
            'session_updated_at', session_updated_at
          )
          ORDER BY last_activity_at ASC
        )
        FROM classified
      ),
      '[]'::jsonb
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.classify_stale_vibe_video_uploads(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.classify_stale_vibe_video_uploads(int, int) TO service_role;

COMMENT ON FUNCTION public.classify_stale_vibe_video_uploads(int, int) IS
  'Service-role read-only classifier for Vibe Video rows stuck in uploading/processing. It never deletes media and only returns stale current profile UID candidates.';

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
  v_profile_video_count int := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.stale_vibe_video_repair_candidates (
    user_id uuid PRIMARY KEY,
    provider_id text NOT NULL,
    profile_status text NOT NULL,
    session_id uuid,
    session_status text,
    classification text NOT NULL,
    last_activity_at timestamptz NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE TABLE pg_temp.stale_vibe_video_repair_candidates;

  INSERT INTO pg_temp.stale_vibe_video_repair_candidates (
    user_id,
    provider_id,
    profile_status,
    session_id,
    session_status,
    classification,
    last_activity_at
  )
  SELECT
    c.user_id,
    c.provider_id,
    c.profile_status,
    c.session_id,
    c.session_status,
    CASE
      WHEN c.session_id IS NULL THEN 'profile_' || c.profile_status || '_without_active_session'
      WHEN c.session_status = 'created' THEN 'session_created_without_upload_progress'
      WHEN c.session_status = 'uploading' THEN 'session_uploading_stale'
      WHEN c.session_status = 'processing' THEN 'session_processing_stale'
      ELSE 'profile_' || c.profile_status || '_stale'
    END AS classification,
    c.last_activity_at
  FROM (
    SELECT
      p.id AS user_id,
      btrim(p.bunny_video_uid) AS provider_id,
      COALESCE(NULLIF(btrim(COALESCE(p.bunny_video_status, '')), ''), 'processing') AS profile_status,
      dms.id AS session_id,
      dms.status AS session_status,
      COALESCE(dms.updated_at, p.updated_at) AS last_activity_at
    FROM public.profiles p
    LEFT JOIN LATERAL (
      SELECT id, status, created_at, updated_at
      FROM public.draft_media_sessions dms
      WHERE dms.user_id = p.id
        AND dms.media_type = 'vibe_video'
        AND dms.provider_id = btrim(p.bunny_video_uid)
        AND dms.status IN ('created', 'uploading', 'processing')
      ORDER BY dms.updated_at DESC, dms.created_at DESC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    ) dms ON true
    WHERE p.bunny_video_uid IS NOT NULL
      AND btrim(p.bunny_video_uid) <> ''
      AND COALESCE(NULLIF(btrim(COALESCE(p.bunny_video_status, '')), ''), 'processing') IN ('uploading', 'processing')
      AND COALESCE(dms.updated_at, p.updated_at) < now() - make_interval(mins => v_stale_minutes)
    ORDER BY COALESCE(dms.updated_at, p.updated_at) ASC
    LIMIT v_limit
    FOR UPDATE OF p SKIP LOCKED
  ) c;

  UPDATE public.draft_media_sessions dms
  SET status = 'failed',
      error_detail = COALESCE(dms.error_detail, 'stale_vibe_video_upload_watchdog')
  FROM pg_temp.stale_vibe_video_repair_candidates c
  WHERE dms.id = c.session_id
    AND dms.user_id = c.user_id
    AND dms.media_type = 'vibe_video'
    AND dms.provider_id = c.provider_id
    AND dms.status IN ('created', 'uploading', 'processing');

  GET DIAGNOSTICS v_session_count = ROW_COUNT;

  UPDATE public.profile_vibe_videos pvv
  SET video_status = 'failed'
  FROM public.media_assets ma, pg_temp.stale_vibe_video_repair_candidates c
  WHERE pvv.user_id = c.user_id
    AND pvv.asset_id = ma.id
    AND pvv.is_active = true
    AND ma.provider = 'bunny_stream'
    AND ma.provider_object_id = c.provider_id
    AND pvv.video_status IN ('uploading', 'processing');

  GET DIAGNOSTICS v_profile_video_count = ROW_COUNT;

  UPDATE public.profiles p
  SET bunny_video_status = 'failed',
      updated_at = now()
  FROM pg_temp.stale_vibe_video_repair_candidates c
  WHERE p.id = c.user_id
    AND btrim(p.bunny_video_uid) = c.provider_id
    AND COALESCE(NULLIF(btrim(COALESCE(p.bunny_video_status, '')), ''), 'processing') IN ('uploading', 'processing');

  GET DIAGNOSTICS v_profile_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'stale_minutes', v_stale_minutes,
    'limit', v_limit,
    'candidate_count', (SELECT count(*) FROM pg_temp.stale_vibe_video_repair_candidates),
    'profile_rows_marked_failed', v_profile_count,
    'session_rows_marked_failed', v_session_count,
    'profile_vibe_video_rows_marked_failed', v_profile_video_count,
    'classifications', COALESCE(
      (
        SELECT jsonb_object_agg(classification, n)
        FROM (
          SELECT classification, count(*) AS n
          FROM pg_temp.stale_vibe_video_repair_candidates
          GROUP BY classification
        ) grouped
      ),
      '{}'::jsonb
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_stale_vibe_video_uploads_failed(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_stale_vibe_video_uploads_failed(int, int) TO service_role;

COMMENT ON FUNCTION public.mark_stale_vibe_video_uploads_failed(int, int) IS
  'Service-role repair helper for stale Vibe Video current profile UIDs. Marks stale uploading/processing rows failed, preserves bunny_video_uid for score/history, and never deletes provider media.';
