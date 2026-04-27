-- Rollback-only validation for Vibe Video contract hardening.
--
-- Run after migration 20260501101000_vibe_video_contract_hardening.sql is applied:
--   supabase db query --linked -o table -f supabase/validation/vibe_video_contract_hardening.sql

BEGIN;

CREATE TEMP TABLE validation_results (
  category text NOT NULL,
  check_name text NOT NULL,
  pass boolean NOT NULL,
  details text
);

GRANT INSERT, SELECT ON validation_results TO anon, authenticated, service_role;

CREATE TEMP TABLE validation_context (
  user_id uuid PRIMARY KEY,
  payload jsonb NOT NULL,
  expected_uid text
);

GRANT SELECT ON validation_context TO anon, authenticated, service_role;

SET LOCAL session_replication_role = replica;

INSERT INTO public.profiles (
  id,
  name,
  birth_date,
  age,
  gender,
  interested_in,
  relationship_intent,
  looking_for,
  photos,
  avatar_url,
  about_me,
  location,
  country,
  location_data,
  bunny_video_uid,
  bunny_video_status,
  onboarding_complete
) VALUES
  ('9f500000-0000-4000-8000-000000000001', 'VV Existing Missing', '1995-01-01', 31, 'woman', ARRAY['men'], 'relationship', 'relationship', ARRAY['photos/9f500000-0000-4000-8000-000000000001/a.jpg','photos/9f500000-0000-4000-8000-000000000001/b.jpg'], 'photos/9f500000-0000-4000-8000-000000000001/a.jpg', 'A complete test profile.', 'Istanbul', 'Turkey', '{"lat":41.0082,"lng":28.9784}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'processing', false),
  ('9f500000-0000-4000-8000-000000000002', 'VV Existing Empty', '1995-01-01', 31, 'woman', ARRAY['men'], 'relationship', 'relationship', ARRAY['photos/9f500000-0000-4000-8000-000000000002/a.jpg','photos/9f500000-0000-4000-8000-000000000002/b.jpg'], 'photos/9f500000-0000-4000-8000-000000000002/a.jpg', 'A complete test profile.', 'Istanbul', 'Turkey', '{"lat":41.0082,"lng":28.9784}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'uploading', false),
  ('9f500000-0000-4000-8000-000000000003', 'VV Existing Pending Payload', '1995-01-01', 31, 'woman', ARRAY['men'], 'relationship', 'relationship', ARRAY['photos/9f500000-0000-4000-8000-000000000003/a.jpg','photos/9f500000-0000-4000-8000-000000000003/b.jpg'], 'photos/9f500000-0000-4000-8000-000000000003/a.jpg', 'A complete test profile.', 'Istanbul', 'Turkey', '{"lat":41.0082,"lng":28.9784}', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'ready', false),
  ('9f500000-0000-4000-8000-000000000004', 'VV Pending Ignored', '1995-01-01', 31, 'woman', ARRAY['men'], 'relationship', 'relationship', ARRAY['photos/9f500000-0000-4000-8000-000000000004/a.jpg','photos/9f500000-0000-4000-8000-000000000004/b.jpg'], 'photos/9f500000-0000-4000-8000-000000000004/a.jpg', 'A complete test profile.', 'Istanbul', 'Turkey', '{"lat":41.0082,"lng":28.9784}', NULL, 'none', false),
  ('9f500000-0000-4000-8000-000000000005', 'VV Valid Accepted', '1995-01-01', 31, 'woman', ARRAY['men'], 'relationship', 'relationship', ARRAY['photos/9f500000-0000-4000-8000-000000000005/a.jpg','photos/9f500000-0000-4000-8000-000000000005/b.jpg'], 'photos/9f500000-0000-4000-8000-000000000005/a.jpg', 'A complete test profile.', 'Istanbul', 'Turkey', '{"lat":41.0082,"lng":28.9784}', NULL, 'none', false);

INSERT INTO public.draft_media_sessions (
  user_id,
  media_type,
  status,
  provider,
  provider_id,
  context
) VALUES (
  '9f500000-0000-4000-8000-000000000005',
  'vibe_video',
  'created',
  'bunny',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'onboarding'
);

SET LOCAL session_replication_role = origin;

INSERT INTO validation_context (user_id, payload, expected_uid)
VALUES
  (
    '9f500000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'name', 'VV Existing Missing',
      'birthDate', '1995-01-01',
      'gender', 'woman',
      'genderCustom', '',
      'interestedIn', 'men',
      'relationshipIntent', 'relationship',
      'heightCm', 170,
      'job', '',
      'photos', jsonb_build_array('photos/9f500000-0000-4000-8000-000000000001/a.jpg','photos/9f500000-0000-4000-8000-000000000001/b.jpg'),
      'aboutMe', 'A complete test profile.',
      'location', 'Istanbul',
      'locationData', jsonb_build_object('lat', 41.0082, 'lng', 28.9784),
      'country', 'Turkey',
      'vibeVideoRecorded', true,
      'communityAgreed', true
    ),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  (
    '9f500000-0000-4000-8000-000000000002',
    jsonb_build_object(
      'name', 'VV Existing Empty',
      'birthDate', '1995-01-01',
      'gender', 'woman',
      'genderCustom', '',
      'interestedIn', 'men',
      'relationshipIntent', 'relationship',
      'heightCm', 170,
      'job', '',
      'photos', jsonb_build_array('photos/9f500000-0000-4000-8000-000000000002/a.jpg','photos/9f500000-0000-4000-8000-000000000002/b.jpg'),
      'aboutMe', 'A complete test profile.',
      'location', 'Istanbul',
      'locationData', jsonb_build_object('lat', 41.0082, 'lng', 28.9784),
      'country', 'Turkey',
      'vibeVideoRecorded', true,
      'bunnyVideoUid', '',
      'communityAgreed', true
    ),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ),
  (
    '9f500000-0000-4000-8000-000000000003',
    jsonb_build_object(
      'name', 'VV Existing Pending Payload',
      'birthDate', '1995-01-01',
      'gender', 'woman',
      'genderCustom', '',
      'interestedIn', 'men',
      'relationshipIntent', 'relationship',
      'heightCm', 170,
      'job', '',
      'photos', jsonb_build_array('photos/9f500000-0000-4000-8000-000000000003/a.jpg','photos/9f500000-0000-4000-8000-000000000003/b.jpg'),
      'aboutMe', 'A complete test profile.',
      'location', 'Istanbul',
      'locationData', jsonb_build_object('lat', 41.0082, 'lng', 28.9784),
      'country', 'Turkey',
      'vibeVideoRecorded', true,
      'bunnyVideoUid', 'pending',
      'communityAgreed', true
    ),
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ),
  (
    '9f500000-0000-4000-8000-000000000004',
    jsonb_build_object(
      'name', 'VV Pending Ignored',
      'birthDate', '1995-01-01',
      'gender', 'woman',
      'genderCustom', '',
      'interestedIn', 'men',
      'relationshipIntent', 'relationship',
      'heightCm', 170,
      'job', '',
      'photos', jsonb_build_array('photos/9f500000-0000-4000-8000-000000000004/a.jpg','photos/9f500000-0000-4000-8000-000000000004/b.jpg'),
      'aboutMe', 'A complete test profile.',
      'location', 'Istanbul',
      'locationData', jsonb_build_object('lat', 41.0082, 'lng', 28.9784),
      'country', 'Turkey',
      'vibeVideoRecorded', true,
      'bunnyVideoUid', 'pending',
      'communityAgreed', true
    ),
    NULL
  ),
  (
    '9f500000-0000-4000-8000-000000000005',
    jsonb_build_object(
      'name', 'VV Valid Accepted',
      'birthDate', '1995-01-01',
      'gender', 'woman',
      'genderCustom', '',
      'interestedIn', 'men',
      'relationshipIntent', 'relationship',
      'heightCm', 170,
      'job', '',
      'photos', jsonb_build_array('photos/9f500000-0000-4000-8000-000000000005/a.jpg','photos/9f500000-0000-4000-8000-000000000005/b.jpg'),
      'aboutMe', 'A complete test profile.',
      'location', 'Istanbul',
      'locationData', jsonb_build_object('lat', 41.0082, 'lng', 28.9784),
      'country', 'Turkey',
      'vibeVideoRecorded', true,
      'bunnyVideoUid', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'communityAgreed', true
    ),
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  );

DO $$
DECLARE
  r record;
  v_result jsonb;
  v_actual_uid text;
BEGIN
  FOR r IN SELECT * FROM validation_context LOOP
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', r.user_id::text, true);

    v_result := public.finalize_onboarding(r.user_id, r.payload);

    SELECT bunny_video_uid
    INTO v_actual_uid
    FROM public.profiles
    WHERE id = r.user_id;

    INSERT INTO validation_results
    SELECT
      'onboarding',
      'finalize_onboarding preserves/rejects/accepts uid for ' || r.user_id::text,
      COALESCE((v_result->>'success')::boolean, false) = true
        AND v_actual_uid IS NOT DISTINCT FROM r.expected_uid,
      jsonb_build_object(
        'result', v_result,
        'actual_uid', v_actual_uid,
        'expected_uid', r.expected_uid
      )::text;
  END LOOP;
END $$;

SET LOCAL session_replication_role = replica;

INSERT INTO public.profiles (
  id,
  name,
  age,
  gender,
  photos,
  bunny_video_uid,
  bunny_video_status
) VALUES
  ('9f500000-0000-4000-8000-000000000101', 'Score Null', 31, 'woman', ARRAY[]::text[], NULL, 'none'),
  ('9f500000-0000-4000-8000-000000000102', 'Score Empty', 31, 'woman', ARRAY[]::text[], '', 'ready'),
  ('9f500000-0000-4000-8000-000000000103', 'Score Uploading', 31, 'woman', ARRAY[]::text[], 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'uploading'),
  ('9f500000-0000-4000-8000-000000000104', 'Score Processing', 31, 'woman', ARRAY[]::text[], 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', 'processing'),
  ('9f500000-0000-4000-8000-000000000105', 'Score Ready', 31, 'woman', ARRAY[]::text[], 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3', 'ready'),
  ('9f500000-0000-4000-8000-000000000106', 'Score Failed', 31, 'woman', ARRAY[]::text[], 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4', 'failed');

SET LOCAL session_replication_role = origin;

WITH scores AS (
  SELECT
    id,
    (public.calculate_vibe_score(id)->>'score')::int AS score
  FROM public.profiles
  WHERE id BETWEEN '9f500000-0000-4000-8000-000000000101'::uuid
    AND '9f500000-0000-4000-8000-000000000106'::uuid
),
baseline AS (
  SELECT score FROM scores WHERE id = '9f500000-0000-4000-8000-000000000101'
)
INSERT INTO validation_results
SELECT
  'score',
  'empty uid earns no Vibe Video points',
  (SELECT score FROM scores WHERE id = '9f500000-0000-4000-8000-000000000102') = (SELECT score FROM baseline),
  (SELECT jsonb_object_agg(id, score)::text FROM scores);

WITH scores AS (
  SELECT
    id,
    (public.calculate_vibe_score(id)->>'score')::int AS score
  FROM public.profiles
  WHERE id BETWEEN '9f500000-0000-4000-8000-000000000101'::uuid
    AND '9f500000-0000-4000-8000-000000000106'::uuid
),
baseline AS (
  SELECT score FROM scores WHERE id = '9f500000-0000-4000-8000-000000000101'
)
INSERT INTO validation_results
SELECT
  'score',
  'uploading/processing/ready/failed uid each earns exactly 15 video points',
  NOT EXISTS (
    SELECT 1
    FROM scores, baseline
    WHERE id IN (
      '9f500000-0000-4000-8000-000000000103',
      '9f500000-0000-4000-8000-000000000104',
      '9f500000-0000-4000-8000-000000000105',
      '9f500000-0000-4000-8000-000000000106'
    )
    AND score <> baseline.score + 15
  ),
  (SELECT jsonb_object_agg(id, score)::text FROM scores);

SELECT * FROM validation_results ORDER BY category, check_name;

ROLLBACK;
