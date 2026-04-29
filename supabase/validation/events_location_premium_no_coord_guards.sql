-- Rollback-only validation for get_visible_events location entitlement guards.
--
-- Run against linked Supabase after the migration is applied:
--   supabase db query --linked -o table -f supabase/validation/events_location_premium_no_coord_guards.sql

BEGIN;

CREATE TEMP TABLE validation_results (
  category text NOT NULL,
  check_name text NOT NULL,
  pass boolean NOT NULL,
  details text
);

GRANT INSERT, SELECT ON validation_results TO anon, authenticated, service_role;

SET LOCAL session_replication_role = replica;

INSERT INTO public.profiles (
  id,
  name,
  age,
  gender,
  interested_in,
  photos,
  avatar_url,
  location,
  country,
  location_data,
  distance_visibility,
  event_attendance_visibility,
  discovery_audience,
  discovery_mode,
  discoverable,
  onboarding_complete,
  is_premium,
  premium_until,
  subscription_tier
) VALUES
  (
    '8e7a0000-0000-4000-8000-000000000001',
    'Events Location Free Viewer',
    30,
    'woman',
    NULL,
    ARRAY[]::text[],
    NULL,
    'Istanbul',
    'Turkey',
    '{"lat": 41.0082, "lng": 28.9784}'::jsonb,
    'approximate',
    'attendees',
    'everyone',
    'visible',
    true,
    true,
    false,
    NULL,
    'free'
  ),
  (
    '8e7a0000-0000-4000-8000-000000000002',
    'Events Location Premium Viewer',
    31,
    'man',
    NULL,
    ARRAY[]::text[],
    NULL,
    'Istanbul',
    'Turkey',
    '{"lat": 41.0082, "lng": 28.9784}'::jsonb,
    'approximate',
    'attendees',
    'everyone',
    'visible',
    true,
    true,
    false,
    NULL,
    'free'
  );

INSERT INTO public.subscriptions (
  id,
  user_id,
  stripe_subscription_id,
  status,
  plan,
  current_period_end,
  provider
) VALUES (
  '8e7a0000-0000-4000-8000-000000000050',
  '8e7a0000-0000-4000-8000-000000000002',
  'sub_events_location_validation',
  'active',
  'premium_monthly',
  now() + interval '30 days',
  'stripe'
);

INSERT INTO public.events (
  id,
  title,
  description,
  cover_image,
  event_date,
  duration_minutes,
  status,
  max_attendees,
  current_attendees,
  is_free,
  scope,
  city,
  country,
  latitude,
  longitude,
  radius_km,
  is_location_specific
) VALUES
  (
    '8e7a0000-0000-4000-8000-000000000100',
    'Events Location Istanbul Local',
    'Rollback-only validation fixture',
    'validation-cover.jpg',
    now() + interval '1 hour',
    60,
    'upcoming',
    20,
    0,
    true,
    'local',
    'Istanbul',
    'Turkey',
    41.0082,
    28.9784,
    50,
    true
  ),
  (
    '8e7a0000-0000-4000-8000-000000000101',
    'Events Location London Local',
    'Rollback-only validation fixture',
    'validation-cover.jpg',
    now() + interval '1 hour',
    60,
    'upcoming',
    20,
    0,
    true,
    'local',
    'London',
    'United Kingdom',
    51.5074,
    -0.1278,
    50,
    true
  ),
  (
    '8e7a0000-0000-4000-8000-000000000102',
    'Events Location Null Local',
    'Rollback-only validation fixture',
    'validation-cover.jpg',
    now() + interval '1 hour',
    60,
    'upcoming',
    20,
    0,
    true,
    'local',
    'Istanbul',
    'Turkey',
    NULL,
    NULL,
    50,
    true
  ),
  (
    '8e7a0000-0000-4000-8000-000000000103',
    'Events Location Legacy Specific Null',
    'Rollback-only validation fixture',
    'validation-cover.jpg',
    now() + interval '1 hour',
    60,
    'upcoming',
    20,
    0,
    true,
    NULL,
    'Istanbul',
    'Turkey',
    NULL,
    NULL,
    50,
    true
  ),
  (
    '8e7a0000-0000-4000-8000-000000000104',
    'Events Location Global',
    'Rollback-only validation fixture',
    'validation-cover.jpg',
    now() + interval '1 hour',
    60,
    'upcoming',
    20,
    0,
    true,
    'global',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    false
  ),
  (
    '8e7a0000-0000-4000-8000-000000000105',
    'Events Location Regional Turkey',
    'Rollback-only validation fixture',
    'validation-cover.jpg',
    now() + interval '1 hour',
    60,
    'upcoming',
    20,
    0,
    true,
    'regional',
    NULL,
    'Turkey',
    NULL,
    NULL,
    NULL,
    false
  );

SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '8e7a0000-0000-4000-8000-000000000001', true);

WITH remote_local AS (
  SELECT id
  FROM public.get_visible_events(
    '8e7a0000-0000-4000-8000-000000000001',
    51.5074,
    -0.1278,
    true,
    51.5074,
    -0.1278,
    50
  )
  WHERE id = '8e7a0000-0000-4000-8000-000000000101'
)
INSERT INTO validation_results
SELECT
  'premium city browse',
  'free caller cannot spoof premium or browse coordinates to see remote local event',
  COUNT(*) = 0,
  COALESCE(jsonb_agg(to_jsonb(remote_local))::text, '[]')
FROM remote_local;

DO $$
DECLARE
  v_denied boolean := false;
  v_details text := NULL;
BEGIN
  BEGIN
    PERFORM 1
    FROM public.get_visible_events(
      '8e7a0000-0000-4000-8000-000000000002',
      51.5074,
      -0.1278,
      true,
      51.5074,
      -0.1278,
      50
    )
    WHERE id = '8e7a0000-0000-4000-8000-000000000101';
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_denied := true;
      v_details := SQLERRM;
    WHEN others THEN
      v_details := SQLSTATE || ': ' || SQLERRM;
  END;

  INSERT INTO validation_results
  VALUES (
    'auth binding',
    'free caller cannot borrow a premium p_user_id',
    v_denied,
    COALESCE(v_details, 'unexpectedly allowed')
  );
END $$;

WITH no_coord AS (
  SELECT id
  FROM public.get_visible_events(
    '8e7a0000-0000-4000-8000-000000000001',
    41.0082,
    28.9784,
    false,
    NULL,
    NULL,
    50
  )
  WHERE id IN (
    '8e7a0000-0000-4000-8000-000000000102',
    '8e7a0000-0000-4000-8000-000000000103'
  )
)
INSERT INTO validation_results
SELECT
  'no-coordinate local',
  'local and location-specific rows with null coordinates are excluded under active radius filtering',
  COUNT(*) = 0,
  COALESCE(jsonb_agg(to_jsonb(no_coord))::text, '[]')
FROM no_coord;

WITH local_nearby AS (
  SELECT id, distance_km
  FROM public.get_visible_events(
    '8e7a0000-0000-4000-8000-000000000001',
    41.0082,
    28.9784,
    false,
    NULL,
    NULL,
    50
  )
  WHERE id = '8e7a0000-0000-4000-8000-000000000100'
)
INSERT INTO validation_results
SELECT
  'nearby local',
  'nearby mode with valid user coordinates returns local events inside radius',
  COUNT(*) = 1 AND bool_and(distance_km IS NOT NULL AND distance_km <= 50),
  COALESCE(jsonb_agg(to_jsonb(local_nearby))::text, '[]')
FROM local_nearby;

WITH scoped_exceptions AS (
  SELECT id
  FROM public.get_visible_events(
    '8e7a0000-0000-4000-8000-000000000001',
    41.0082,
    28.9784,
    false,
    NULL,
    NULL,
    1
  )
  WHERE id IN (
    '8e7a0000-0000-4000-8000-000000000104',
    '8e7a0000-0000-4000-8000-000000000105'
  )
)
INSERT INTO validation_results
SELECT
  'scoped exceptions',
  'explicit global and regional rows remain visible outside strict local radius',
  COUNT(*) = 2,
  COALESCE(jsonb_agg(to_jsonb(scoped_exceptions) ORDER BY id)::text, '[]')
FROM scoped_exceptions;

RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '8e7a0000-0000-4000-8000-000000000002', true);

WITH premium_remote AS (
  SELECT id, distance_km
  FROM public.get_visible_events(
    '8e7a0000-0000-4000-8000-000000000002',
    41.0082,
    28.9784,
    false,
    51.5074,
    -0.1278,
    50
  )
  WHERE id = '8e7a0000-0000-4000-8000-000000000101'
)
INSERT INTO validation_results
SELECT
  'premium city browse',
  'premium caller can see remote local event within chosen city radius',
  COUNT(*) = 1 AND bool_and(distance_km IS NOT NULL AND distance_km <= 50),
  COALESCE(jsonb_agg(to_jsonb(premium_remote))::text, '[]')
FROM premium_remote;

RESET ROLE;

SELECT
  category,
  check_name,
  pass,
  details
FROM validation_results
ORDER BY category, check_name;

ROLLBACK;
