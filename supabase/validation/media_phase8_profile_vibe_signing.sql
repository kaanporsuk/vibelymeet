-- Rollback-only validation for Phase 8 private profile Vibe Video signing.
--
-- Run after applying:
--   20260520210000_media_phase8_bulletproof_closure.sql
--
-- Example:
--   supabase db query --linked -f supabase/validation/media_phase8_profile_vibe_signing.sql

BEGIN;

CREATE TEMP TABLE media_phase8_profile_vibe_signing_results (
  check_name text PRIMARY KEY,
  ok boolean NOT NULL,
  details text
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
  'media-phase8-' || replace(fixture_user_id::text, '-', '') || '@example.invalid',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
FROM (
  VALUES
    ('9f580000-0000-4000-8000-000000000001'::uuid),
    ('9f580000-0000-4000-8000-000000000002'::uuid),
    ('9f580000-0000-4000-8000-000000000003'::uuid),
    ('9f580000-0000-4000-8000-000000000004'::uuid),
    ('9f580000-0000-4000-8000-000000000005'::uuid),
    ('9f580000-0000-4000-8000-000000000006'::uuid),
    ('9f580000-0000-4000-8000-000000000007'::uuid)
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
  discoverable,
  discovery_mode,
  discovery_audience,
  account_paused,
  account_paused_until,
  onboarding_complete,
  updated_at
) VALUES
  (
    '9f580000-0000-4000-8000-000000000001',
    'Phase8 Viewer',
    31,
    'woman',
    ARRAY[]::text[],
    NULL,
    'none',
    true,
    'visible',
    'everyone',
    false,
    NULL,
    true,
    now()
  ),
  (
    '9f580000-0000-4000-8000-000000000002',
    'Phase8 Hidden',
    32,
    'man',
    ARRAY[]::text[],
    '11111111-1111-4111-8111-111111111111',
    'ready',
    true,
    'hidden',
    'everyone',
    false,
    NULL,
    true,
    now()
  ),
  (
    '9f580000-0000-4000-8000-000000000003',
    'Phase8 Paused',
    33,
    'man',
    ARRAY[]::text[],
    '22222222-2222-4222-8222-222222222222',
    'ready',
    true,
    'visible',
    'everyone',
    true,
    NULL,
    true,
    now()
  ),
  (
    '9f580000-0000-4000-8000-000000000004',
    'Phase8 Discoverable',
    34,
    'man',
    ARRAY[]::text[],
    '33333333-3333-4333-8333-333333333333',
    'ready',
    true,
    'visible',
    'everyone',
    false,
    NULL,
    true,
    now()
  ),
  (
    '9f580000-0000-4000-8000-000000000005',
    'Phase8 No Access',
    35,
    'man',
    ARRAY[]::text[],
    '44444444-4444-4444-8444-444444444444',
    'ready',
    true,
    'hidden',
    'everyone',
    false,
    NULL,
    true,
    now()
  ),
  (
    '9f580000-0000-4000-8000-000000000006',
    'Phase8 Admin',
    36,
    'woman',
    ARRAY[]::text[],
    NULL,
    'none',
    true,
    'visible',
    'everyone',
    false,
    NULL,
    true,
    now()
  ),
  (
    '9f580000-0000-4000-8000-000000000007',
    'Phase8 Undiscoverable',
    37,
    'man',
    ARRAY[]::text[],
    '55555555-5555-4555-8555-555555555555',
    'ready',
    false,
    'visible',
    'everyone',
    false,
    NULL,
    true,
    now()
  )
ON CONFLICT (id) DO UPDATE SET
  bunny_video_uid = EXCLUDED.bunny_video_uid,
  bunny_video_status = EXCLUDED.bunny_video_status,
  discoverable = EXCLUDED.discoverable,
  discovery_mode = EXCLUDED.discovery_mode,
  discovery_audience = EXCLUDED.discovery_audience,
  account_paused = EXCLUDED.account_paused,
  account_paused_until = EXCLUDED.account_paused_until,
  updated_at = EXCLUDED.updated_at;

INSERT INTO public.matches (profile_id_1, profile_id_2)
VALUES
  ('9f580000-0000-4000-8000-000000000001', '9f580000-0000-4000-8000-000000000002'),
  ('9f580000-0000-4000-8000-000000000001', '9f580000-0000-4000-8000-000000000003'),
  ('9f580000-0000-4000-8000-000000000001', '9f580000-0000-4000-8000-000000000004'),
  ('9f580000-0000-4000-8000-000000000001', '9f580000-0000-4000-8000-000000000007')
ON CONFLICT DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
VALUES ('9f580000-0000-4000-8000-000000000006', 'admin'::public.app_role)
ON CONFLICT DO NOTHING;

SET LOCAL session_replication_role = origin;

DO $$
DECLARE
  v_body jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', '9f580000-0000-4000-8000-000000000001', true);

  v_body := public.get_profile_for_viewer('9f580000-0000-4000-8000-000000000002');
  INSERT INTO media_phase8_profile_vibe_signing_results
  SELECT
    'hidden_matched_profile_masks_raw_video_and_returns_ref',
    v_body IS NOT NULL
      AND (v_body->>'vibe_video_signed_playback_required')::boolean IS TRUE
      AND v_body->>'bunny_video_uid' IS NULL
      AND v_body->>'bunny_video_status' IS NULL
      AND v_body->>'vibe_video_playback_ref' = 'profile_vibe_video:9f580000-0000-4000-8000-000000000002:11111111-1111-4111-8111-111111111111',
    COALESCE(v_body::text, 'null');

  v_body := public.get_profile_for_viewer('9f580000-0000-4000-8000-000000000003');
  INSERT INTO media_phase8_profile_vibe_signing_results
  SELECT
    'account_paused_matched_profile_masks_raw_video_and_returns_ref',
    v_body IS NOT NULL
      AND (v_body->>'vibe_video_signed_playback_required')::boolean IS TRUE
      AND v_body->>'bunny_video_uid' IS NULL
      AND v_body->>'bunny_video_status' IS NULL
      AND v_body->>'vibe_video_playback_ref' = 'profile_vibe_video:9f580000-0000-4000-8000-000000000003:22222222-2222-4222-8222-222222222222',
    COALESCE(v_body::text, 'null');

  v_body := public.get_profile_for_viewer('9f580000-0000-4000-8000-000000000007');
  INSERT INTO media_phase8_profile_vibe_signing_results
  SELECT
    'undiscoverable_matched_profile_masks_raw_video_and_returns_ref',
    v_body IS NOT NULL
      AND (v_body->>'vibe_video_signed_playback_required')::boolean IS TRUE
      AND v_body->>'bunny_video_uid' IS NULL
      AND v_body->>'bunny_video_status' IS NULL
      AND v_body->>'vibe_video_playback_ref' = 'profile_vibe_video:9f580000-0000-4000-8000-000000000007:55555555-5555-4555-8555-555555555555',
    COALESCE(v_body::text, 'null');

  v_body := public.get_profile_for_viewer('9f580000-0000-4000-8000-000000000004');
  INSERT INTO media_phase8_profile_vibe_signing_results
  SELECT
    'discoverable_matched_profile_keeps_public_video_contract',
    v_body IS NOT NULL
      AND COALESCE((v_body->>'vibe_video_signed_playback_required')::boolean, false) IS FALSE
      AND v_body->>'bunny_video_uid' = '33333333-3333-4333-8333-333333333333'
      AND v_body->>'bunny_video_status' = 'ready'
      AND v_body->>'vibe_video_playback_ref' = 'profile_vibe_video:9f580000-0000-4000-8000-000000000004:33333333-3333-4333-8333-333333333333',
    COALESCE(v_body::text, 'null');

  v_body := public.get_profile_for_viewer('9f580000-0000-4000-8000-000000000005');
  INSERT INTO media_phase8_profile_vibe_signing_results
  SELECT
    'no_established_access_profile_is_denied',
    v_body IS NULL,
    COALESCE(v_body::text, 'null');

  PERFORM set_config('request.jwt.claim.sub', '9f580000-0000-4000-8000-000000000002', true);
  v_body := public.get_profile_for_viewer('9f580000-0000-4000-8000-000000000002');
  INSERT INTO media_phase8_profile_vibe_signing_results
  SELECT
    'self_view_keeps_raw_video_contract',
    v_body IS NOT NULL
      AND COALESCE((v_body->>'vibe_video_signed_playback_required')::boolean, false) IS FALSE
      AND v_body->>'bunny_video_uid' = '11111111-1111-4111-8111-111111111111'
      AND v_body->>'bunny_video_status' = 'ready'
      AND v_body->>'vibe_video_playback_ref' = 'profile_vibe_video:9f580000-0000-4000-8000-000000000002:11111111-1111-4111-8111-111111111111',
    COALESCE(v_body::text, 'null');

  PERFORM set_config('request.jwt.claim.sub', '9f580000-0000-4000-8000-000000000006', true);
  v_body := public.get_profile_for_viewer('9f580000-0000-4000-8000-000000000002');
  INSERT INTO media_phase8_profile_vibe_signing_results
  SELECT
    'admin_view_keeps_raw_video_contract',
    v_body IS NOT NULL
      AND COALESCE((v_body->>'vibe_video_signed_playback_required')::boolean, false) IS FALSE
      AND v_body->>'bunny_video_uid' = '11111111-1111-4111-8111-111111111111'
      AND v_body->>'bunny_video_status' = 'ready'
      AND v_body->>'vibe_video_playback_ref' = 'profile_vibe_video:9f580000-0000-4000-8000-000000000002:11111111-1111-4111-8111-111111111111',
    COALESCE(v_body::text, 'null');
END $$;

SELECT check_name, ok, details
FROM media_phase8_profile_vibe_signing_results
ORDER BY check_name;

DO $$
DECLARE
  v_failed text;
BEGIN
  SELECT string_agg(check_name || ': ' || COALESCE(details, 'null'), E'\n' ORDER BY check_name)
  INTO v_failed
  FROM media_phase8_profile_vibe_signing_results
  WHERE NOT ok;

  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 8 profile Vibe signing validation failed:%', E'\n' || v_failed;
  END IF;
END $$;

ROLLBACK;
