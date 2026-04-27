-- Rollback-only validation for Vibe Video backend contract repair hardening.
--
-- Run after applying:
--   20260501101000_vibe_video_contract_hardening.sql
--   20260501120000_vibe_video_backend_owned_field_guardrails.sql
--   20260501123000_vibe_video_backend_contract_repair.sql
--
-- Example:
--   supabase db query --linked -o table -f supabase/validation/vibe_video_backend_contract_repair.sql

BEGIN;

CREATE TEMP TABLE vibe_video_backend_contract_results (
  check_name text PRIMARY KEY,
  passed boolean NOT NULL,
  detail text
) ON COMMIT DROP;

SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
SELECT
  fixture_user_id,
  'authenticated',
  'authenticated',
  'vibe-video-backend-contract-' || replace(fixture_user_id::text, '-', '') || '@example.invalid',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
FROM (
  VALUES
    ('9f510000-0000-4000-8000-000000000101'::uuid),
    ('9f510000-0000-4000-8000-000000000102'::uuid),
    ('9f510000-0000-4000-8000-000000000103'::uuid),
    ('9f510000-0000-4000-8000-000000000104'::uuid),
    ('9f510000-0000-4000-8000-000000000105'::uuid),
    ('9f510000-0000-4000-8000-000000000106'::uuid),
    ('9f510000-0000-4000-8000-000000000107'::uuid),
    ('9f510000-0000-4000-8000-000000000201'::uuid),
    ('9f510000-0000-4000-8000-000000000202'::uuid),
    ('9f510000-0000-4000-8000-000000000203'::uuid)
) AS fixtures(fixture_user_id)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (
  id,
  name,
  age,
  gender,
  photos,
  bunny_video_uid,
  bunny_video_status,
  vibe_caption,
  updated_at
) VALUES
  ('9f510000-0000-4000-8000-000000000101', 'Score Null', 31, 'woman', ARRAY[]::text[], NULL, 'none', NULL, now()),
  ('9f510000-0000-4000-8000-000000000102', 'Score Empty', 31, 'woman', ARRAY[]::text[], '', 'ready', NULL, now()),
  ('9f510000-0000-4000-8000-000000000103', 'Score Uploading', 31, 'woman', ARRAY[]::text[], '11111111-1111-4111-8111-111111111111', 'uploading', NULL, now()),
  ('9f510000-0000-4000-8000-000000000104', 'Score Processing', 31, 'woman', ARRAY[]::text[], '22222222-2222-4222-8222-222222222222', 'processing', NULL, now()),
  ('9f510000-0000-4000-8000-000000000105', 'Score Ready', 31, 'woman', ARRAY[]::text[], '33333333-3333-4333-8333-333333333333', 'ready', NULL, now()),
  ('9f510000-0000-4000-8000-000000000106', 'Score Failed', 31, 'woman', ARRAY[]::text[], '44444444-4444-4444-8444-444444444444', 'failed', NULL, now()),
  ('9f510000-0000-4000-8000-000000000107', 'Score Delete', 31, 'woman', ARRAY[]::text[], '55555555-5555-4555-8555-555555555555', 'ready', 'delete me', now()),
  ('9f510000-0000-4000-8000-000000000201', 'Stale Uploading', 31, 'woman', ARRAY[]::text[], '66666666-6666-4666-8666-666666666666', 'uploading', NULL, now() - interval '90 minutes'),
  ('9f510000-0000-4000-8000-000000000202', 'Stale Processing No Session', 31, 'woman', ARRAY[]::text[], '77777777-7777-4777-8777-777777777777', 'processing', NULL, now() - interval '90 minutes'),
  ('9f510000-0000-4000-8000-000000000203', 'Fresh Processing', 31, 'woman', ARRAY[]::text[], '88888888-8888-4888-8888-888888888888', 'processing', NULL, now());

INSERT INTO public.draft_media_sessions (
  user_id,
  media_type,
  status,
  provider,
  provider_id,
  context,
  created_at,
  updated_at,
  expires_at
) VALUES
  ('9f510000-0000-4000-8000-000000000201', 'vibe_video', 'uploading', 'bunny', '66666666-6666-4666-8666-666666666666', 'profile_studio', now() - interval '90 minutes', now() - interval '90 minutes', now() + interval '24 hours'),
  ('9f510000-0000-4000-8000-000000000203', 'vibe_video', 'processing', 'bunny', '88888888-8888-4888-8888-888888888888', 'profile_studio', now(), now(), now() + interval '24 hours');

SET LOCAL session_replication_role = origin;

WITH scores AS (
  SELECT
    id,
    (public.calculate_vibe_score(id)->>'score')::int AS score
  FROM public.profiles
  WHERE id BETWEEN '9f510000-0000-4000-8000-000000000101'::uuid
    AND '9f510000-0000-4000-8000-000000000106'::uuid
),
baseline AS (
  SELECT score FROM scores WHERE id = '9f510000-0000-4000-8000-000000000101'
)
INSERT INTO vibe_video_backend_contract_results(check_name, passed, detail)
SELECT
  'score_uploading_processing_ready_failed_uid_each_earns_15',
  NOT EXISTS (
    SELECT 1
    FROM scores s
    CROSS JOIN baseline b
    WHERE s.id IN (
      '9f510000-0000-4000-8000-000000000103',
      '9f510000-0000-4000-8000-000000000104',
      '9f510000-0000-4000-8000-000000000105',
      '9f510000-0000-4000-8000-000000000106'
    )
    AND s.score <> b.score + 15
  ),
  (SELECT jsonb_object_agg(id, score)::text FROM scores);

WITH scores AS (
  SELECT
    id,
    (public.calculate_vibe_score(id)->>'score')::int AS score
  FROM public.profiles
  WHERE id IN (
    '9f510000-0000-4000-8000-000000000101',
    '9f510000-0000-4000-8000-000000000102'
  )
),
baseline AS (
  SELECT score FROM scores WHERE id = '9f510000-0000-4000-8000-000000000101'
)
INSERT INTO vibe_video_backend_contract_results(check_name, passed, detail)
SELECT
  'score_empty_uid_earns_no_video_points',
  (SELECT score FROM scores WHERE id = '9f510000-0000-4000-8000-000000000102') = (SELECT score FROM baseline),
  (SELECT jsonb_object_agg(id, score)::text FROM scores);

DO $$
DECLARE
  v_delete_result jsonb;
  v_delete_score int;
  v_baseline_score int;
BEGIN
  v_delete_result := public.clear_profile_vibe_video(
    '9f510000-0000-4000-8000-000000000107',
    true,
    'validation_delete'
  );

  SELECT (public.calculate_vibe_score('9f510000-0000-4000-8000-000000000107')->>'score')::int
  INTO v_delete_score;
  SELECT (public.calculate_vibe_score('9f510000-0000-4000-8000-000000000101')->>'score')::int
  INTO v_baseline_score;

  INSERT INTO vibe_video_backend_contract_results(check_name, passed, detail)
  SELECT
    'delete_clears_uid_and_removes_video_score_credit',
    COALESCE((v_delete_result->>'success')::boolean, false) = true
      AND p.bunny_video_uid IS NULL
      AND p.bunny_video_status = 'none'
      AND p.vibe_caption IS NULL
      AND v_delete_score = v_baseline_score,
    jsonb_build_object(
      'delete_result', v_delete_result,
      'uid', p.bunny_video_uid,
      'status', p.bunny_video_status,
      'delete_score', v_delete_score,
      'baseline_score', v_baseline_score
    )::text
  FROM public.profiles p
  WHERE p.id = '9f510000-0000-4000-8000-000000000107';
END $$;

DO $$
DECLARE
  v_classify jsonb;
  v_repair jsonb;
  v_stale_uploading_status text;
  v_stale_processing_status text;
  v_fresh_status text;
  v_stale_uploading_score int;
  v_stale_processing_score int;
  v_baseline_score int;
BEGIN
  v_classify := public.classify_stale_vibe_video_uploads(45, 100);
  v_repair := public.mark_stale_vibe_video_uploads_failed(45, 100);

  SELECT bunny_video_status
  INTO v_stale_uploading_status
  FROM public.profiles
  WHERE id = '9f510000-0000-4000-8000-000000000201';

  SELECT bunny_video_status
  INTO v_stale_processing_status
  FROM public.profiles
  WHERE id = '9f510000-0000-4000-8000-000000000202';

  SELECT bunny_video_status
  INTO v_fresh_status
  FROM public.profiles
  WHERE id = '9f510000-0000-4000-8000-000000000203';

  SELECT (public.calculate_vibe_score('9f510000-0000-4000-8000-000000000101')->>'score')::int
  INTO v_baseline_score;
  SELECT (public.calculate_vibe_score('9f510000-0000-4000-8000-000000000201')->>'score')::int
  INTO v_stale_uploading_score;
  SELECT (public.calculate_vibe_score('9f510000-0000-4000-8000-000000000202')->>'score')::int
  INTO v_stale_processing_score;

  INSERT INTO vibe_video_backend_contract_results(check_name, passed, detail)
  VALUES (
    'stale_classifier_finds_only_stale_current_profile_uids',
    COALESCE((v_classify->>'candidate_count')::int, 0) = 2
      AND (v_classify->'classifications' ? 'session_uploading_stale')
      AND (v_classify->'classifications' ? 'profile_processing_without_active_session'),
    v_classify::text
  );

  INSERT INTO vibe_video_backend_contract_results(check_name, passed, detail)
  VALUES (
    'stale_repair_marks_stale_failed_preserves_uid_and_skips_fresh',
    COALESCE((v_repair->>'candidate_count')::int, 0) = 2
      AND v_stale_uploading_status = 'failed'
      AND v_stale_processing_status = 'failed'
      AND v_fresh_status = 'processing'
      AND v_stale_uploading_score = v_baseline_score + 15
      AND v_stale_processing_score = v_baseline_score + 15,
    jsonb_build_object(
      'repair', v_repair,
      'stale_uploading_status', v_stale_uploading_status,
      'stale_processing_status', v_stale_processing_status,
      'fresh_status', v_fresh_status,
      'stale_uploading_score', v_stale_uploading_score,
      'stale_processing_score', v_stale_processing_score,
      'baseline_score', v_baseline_score
    )::text
  );
END $$;

SELECT * FROM vibe_video_backend_contract_results ORDER BY check_name;

DO $$
DECLARE
  v_failed text;
BEGIN
  SELECT string_agg(check_name || COALESCE(': ' || detail, ''), E'\n')
  INTO v_failed
  FROM vibe_video_backend_contract_results
  WHERE NOT passed;

  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'Vibe Video backend contract repair validation failed:%', E'\n' || v_failed;
  END IF;
END $$;

ROLLBACK;
