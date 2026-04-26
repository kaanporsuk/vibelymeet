-- Rollback-only validation for removing legacy profiles.show_distance.
--
-- Run after 20260430195000_remove_legacy_show_distance.sql is deployed:
--   supabase db query --linked -o table -f supabase/validation/distance_visibility_show_distance_cleanup.sql

BEGIN;

CREATE TEMP TABLE validation_results (
  category text NOT NULL,
  check_name text NOT NULL,
  pass boolean NOT NULL,
  details text
);

GRANT INSERT, SELECT ON validation_results TO anon, authenticated, service_role;

INSERT INTO validation_results
SELECT
  'schema',
  'profiles.show_distance column is removed',
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'show_distance'
  ),
  'profiles.show_distance should not exist';

INSERT INTO validation_results
SELECT
  'schema',
  'distance helper no longer references show_distance',
  pg_get_functiondef('public.get_profile_distance_label_for_viewer(uuid)'::regprocedure) NOT ILIKE '%show_distance%',
  'get_profile_distance_label_for_viewer should use distance_visibility only';

INSERT INTO validation_results
SELECT
  'schema',
  'shared privacy sync trigger no longer references show_distance',
  pg_get_functiondef('public.sync_legacy_to_privacy_columns()'::regprocedure) NOT ILIKE '%show_distance%',
  'sync_legacy_to_privacy_columns should keep other legacy sync paths but not show_distance';

INSERT INTO validation_results
SELECT
  'profile grants',
  'authenticated lacks direct profiles.location_data column privilege',
  NOT has_column_privilege('authenticated', 'public.profiles', 'location_data', 'SELECT'),
  'has_column_privilege(authenticated, profiles.location_data, SELECT) should be false';

INSERT INTO validation_results
SELECT
  'profile grants',
  'anon lacks direct profiles.location_data column privilege',
  NOT has_column_privilege('anon', 'public.profiles', 'location_data', 'SELECT'),
  'has_column_privilege(anon, profiles.location_data, SELECT) should be false';

INSERT INTO validation_results
SELECT
  'profile grants',
  'service_role keeps profiles.location_data column privilege',
  has_column_privilege('service_role', 'public.profiles', 'location_data', 'SELECT'),
  'service_role should retain privileged operational access';

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
  onboarding_complete
) VALUES
  (
    '9f4d2000-0000-4000-8000-000000000001',
    'Distance Cleanup Viewer',
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
    true
  ),
  (
    '9f4d2000-0000-4000-8000-000000000002',
    'Distance Cleanup Approx',
    31,
    'man',
    NULL,
    ARRAY[]::text[],
    NULL,
    'Besiktas',
    'Turkey',
    '{"lat": 41.0438, "lng": 29.0094}'::jsonb,
    'approximate',
    'attendees',
    'everyone',
    'visible',
    true,
    true
  ),
  (
    '9f4d2000-0000-4000-8000-000000000003',
    'Distance Cleanup Hidden',
    32,
    'man',
    NULL,
    ARRAY[]::text[],
    NULL,
    'Kadikoy',
    'Turkey',
    '{"lat": 40.9919, "lng": 29.0278}'::jsonb,
    'hidden',
    'attendees',
    'everyone',
    'visible',
    true,
    true
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
  scope
) VALUES (
  '9f4d2000-0000-4000-8000-000000000100',
  'Distance Cleanup Validation Event',
  'Rollback-only validation fixture',
  'validation-cover.jpg',
  now() + interval '1 hour',
  60,
  'live',
  20,
  2,
  true,
  'global'
);

INSERT INTO public.matches (profile_id_1, profile_id_2, event_id)
VALUES
  ('9f4d2000-0000-4000-8000-000000000001', '9f4d2000-0000-4000-8000-000000000002', '9f4d2000-0000-4000-8000-000000000100'),
  ('9f4d2000-0000-4000-8000-000000000001', '9f4d2000-0000-4000-8000-000000000003', '9f4d2000-0000-4000-8000-000000000100');

SET LOCAL session_replication_role = origin;

DO $$
DECLARE
  v_denied boolean := false;
  v_details text := NULL;
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM set_config('request.jwt.claim.role', 'anon', true);
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
    EXECUTE 'SELECT location_data FROM public.profiles WHERE id = ''9f4d2000-0000-4000-8000-000000000002''::uuid';
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_denied := true;
      v_details := SQLERRM;
    WHEN others THEN
      v_details := SQLSTATE || ': ' || SQLERRM;
  END;
  EXECUTE 'RESET ROLE';

  INSERT INTO validation_results
  VALUES (
    'profile grants',
    'anon direct SELECT profiles.location_data is denied',
    v_denied,
    COALESCE(v_details, 'unexpectedly allowed')
  );
END $$;

DO $$
DECLARE
  v_denied boolean := false;
  v_details text := NULL;
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '9f4d2000-0000-4000-8000-000000000001', true);
    EXECUTE 'SELECT location_data FROM public.profiles WHERE id = ''9f4d2000-0000-4000-8000-000000000002''::uuid';
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_denied := true;
      v_details := SQLERRM;
    WHEN others THEN
      v_details := SQLSTATE || ': ' || SQLERRM;
  END;
  EXECUTE 'RESET ROLE';

  INSERT INTO validation_results
  VALUES (
    'profile grants',
    'authenticated matched viewer direct SELECT profiles.location_data is denied',
    v_denied,
    COALESCE(v_details, 'unexpectedly allowed')
  );
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '9f4d2000-0000-4000-8000-000000000001', true);

INSERT INTO validation_results
SELECT
  'self exact location rpc',
  'get_my_location_data still returns only the authenticated viewer location',
  COUNT(*) = 1
    AND bool_and(location_data = '{"lat": 41.0082, "lng": 28.9784}'::jsonb)
    AND bool_and(location = 'Istanbul')
    AND bool_and(country = 'Turkey')
    AND bool_and(lat = 41.0082)
    AND bool_and(lng = 28.9784),
  COALESCE(jsonb_agg(to_jsonb(self_location))::text, '[]')
FROM public.get_my_location_data() AS self_location;

WITH profile_payload AS (
  SELECT public.get_profile_for_viewer('9f4d2000-0000-4000-8000-000000000002') AS payload
)
INSERT INTO validation_results
SELECT
  'profile rpc',
  'get_profile_for_viewer never returns location_data or raw coordinates',
  payload IS NOT NULL
    AND NOT (payload ? 'location_data')
    AND NOT (payload ? 'lat')
    AND NOT (payload ? 'lng'),
  COALESCE(payload::text, 'null')
FROM profile_payload;

WITH profile_payload AS (
  SELECT public.get_profile_for_viewer('9f4d2000-0000-4000-8000-000000000002') AS payload
)
INSERT INTO validation_results
SELECT
  'profile rpc',
  'approximate distance_visibility still returns only an allowed bucket',
  payload->>'distance_label' IN ('<5 km', '5-10 km', '10-25 km', '25-50 km', '50+ km'),
  COALESCE(payload->>'distance_label', 'null')
FROM profile_payload;

WITH profile_payload AS (
  SELECT public.get_profile_for_viewer('9f4d2000-0000-4000-8000-000000000003') AS payload
)
INSERT INTO validation_results
SELECT
  'profile rpc',
  'hidden distance_visibility still returns null distance_label',
  payload IS NOT NULL AND payload->>'distance_label' IS NULL,
  COALESCE(payload::text, 'null')
FROM profile_payload;

RESET ROLE;

SET LOCAL session_replication_role = replica;

DELETE FROM public.matches
WHERE event_id = '9f4d2000-0000-4000-8000-000000000100'
   OR profile_id_1 IN (
    '9f4d2000-0000-4000-8000-000000000001',
    '9f4d2000-0000-4000-8000-000000000002',
    '9f4d2000-0000-4000-8000-000000000003'
   )
   OR profile_id_2 IN (
    '9f4d2000-0000-4000-8000-000000000001',
    '9f4d2000-0000-4000-8000-000000000002',
    '9f4d2000-0000-4000-8000-000000000003'
   );

DELETE FROM public.events
WHERE id = '9f4d2000-0000-4000-8000-000000000100';

DELETE FROM public.profiles
WHERE id IN (
  '9f4d2000-0000-4000-8000-000000000001',
  '9f4d2000-0000-4000-8000-000000000002',
  '9f4d2000-0000-4000-8000-000000000003'
);

SET LOCAL session_replication_role = origin;

INSERT INTO validation_results
SELECT
  'cleanup',
  'rollback-only validation fixtures are removed before result set',
  NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id IN (
      '9f4d2000-0000-4000-8000-000000000001',
      '9f4d2000-0000-4000-8000-000000000002',
      '9f4d2000-0000-4000-8000-000000000003'
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.events
    WHERE id = '9f4d2000-0000-4000-8000-000000000100'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.matches
    WHERE event_id = '9f4d2000-0000-4000-8000-000000000100'
       OR profile_id_1 IN (
        '9f4d2000-0000-4000-8000-000000000001',
        '9f4d2000-0000-4000-8000-000000000002',
        '9f4d2000-0000-4000-8000-000000000003'
       )
       OR profile_id_2 IN (
        '9f4d2000-0000-4000-8000-000000000001',
        '9f4d2000-0000-4000-8000-000000000002',
        '9f4d2000-0000-4000-8000-000000000003'
       )
  ),
  'deterministic profile/event/match validation fixture ids should not remain visible in this transaction';

SELECT
  category,
  check_name,
  pass,
  details
FROM validation_results
ORDER BY category, check_name;
