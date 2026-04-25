-- Cloud validation probes for distance_visibility privacy enforcement Stage 2.
--
-- Run after the pending Stage 2 revoke/drop migration is deployed:
--   supabase db query --linked -o table -f supabase/validation/distance_visibility_privacy_stage2.sql
--
-- This script opens an explicit transaction, creates deterministic fixture
-- rows, switches into authenticated/service_role with JWT settings for RLS
-- probes, and leaves the transaction uncommitted. The Supabase query
-- connection rolls the transaction back after returning the final result set.

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
  show_distance,
  event_attendance_visibility,
  discovery_audience,
  discovery_mode,
  discoverable,
  onboarding_complete
) VALUES
  (
    '9f4d1000-0000-4000-8000-000000000001',
    'Distance Stage2 Viewer',
    30,
    'woman',
    NULL,
    ARRAY[]::text[],
    NULL,
    'Istanbul',
    'Turkey',
    '{"lat": 41.0082, "lng": 28.9784}'::jsonb,
    'approximate',
    true,
    'attendees',
    'everyone',
    'visible',
    true,
    true
  ),
  (
    '9f4d1000-0000-4000-8000-000000000002',
    'Distance Stage2 Approx',
    31,
    'man',
    NULL,
    ARRAY[]::text[],
    NULL,
    'Besiktas',
    'Turkey',
    '{"lat": 41.0438, "lng": 29.0094}'::jsonb,
    'approximate',
    true,
    'attendees',
    'everyone',
    'visible',
    true,
    true
  ),
  (
    '9f4d1000-0000-4000-8000-000000000003',
    'Distance Stage2 Hidden',
    32,
    'man',
    NULL,
    ARRAY[]::text[],
    NULL,
    'Kadikoy',
    'Turkey',
    '{"lat": 40.9919, "lng": 29.0278}'::jsonb,
    'hidden',
    false,
    'attendees',
    'everyone',
    'visible',
    true,
    true
  ),
  (
    '9f4d1000-0000-4000-8000-000000000004',
    'Distance Stage2 Event',
    33,
    'man',
    NULL,
    ARRAY[]::text[],
    NULL,
    'Sisli',
    'Turkey',
    '{"lat": 41.0602, "lng": 28.9877}'::jsonb,
    'approximate',
    true,
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
  '9f4d1000-0000-4000-8000-000000000100',
  'Distance Stage2 Validation Event',
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

INSERT INTO public.event_registrations (event_id, profile_id, admission_status, payment_status, queue_status)
VALUES
  ('9f4d1000-0000-4000-8000-000000000100', '9f4d1000-0000-4000-8000-000000000001', 'confirmed', 'free', 'idle'),
  ('9f4d1000-0000-4000-8000-000000000100', '9f4d1000-0000-4000-8000-000000000004', 'confirmed', 'free', 'idle');

INSERT INTO public.matches (profile_id_1, profile_id_2, event_id)
VALUES
  ('9f4d1000-0000-4000-8000-000000000001', '9f4d1000-0000-4000-8000-000000000002', '9f4d1000-0000-4000-8000-000000000100'),
  ('9f4d1000-0000-4000-8000-000000000001', '9f4d1000-0000-4000-8000-000000000003', '9f4d1000-0000-4000-8000-000000000100');

SET LOCAL session_replication_role = origin;

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

DO $$
DECLARE
  v_denied boolean := false;
  v_details text := NULL;
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '9f4d1000-0000-4000-8000-000000000001', true);
    EXECUTE 'SELECT location_data FROM public.profiles WHERE id = ''9f4d1000-0000-4000-8000-000000000002''::uuid';
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_denied := true;
      v_details := SQLERRM;
    WHEN others THEN
      v_details := SQLERRM;
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

DO $$
DECLARE
  v_denied boolean := false;
  v_details text := NULL;
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '9f4d1000-0000-4000-8000-000000000001', true);
    EXECUTE 'SELECT location_data FROM public.profiles WHERE id = ''9f4d1000-0000-4000-8000-000000000004''::uuid';
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_denied := true;
      v_details := SQLERRM;
    WHEN others THEN
      v_details := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';

  INSERT INTO validation_results
  VALUES (
    'profile grants',
    'authenticated co-attendee direct SELECT profiles.location_data is denied',
    v_denied,
    COALESCE(v_details, 'unexpectedly allowed')
  );
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '9f4d1000-0000-4000-8000-000000000001', true);

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
  SELECT public.get_profile_for_viewer('9f4d1000-0000-4000-8000-000000000002') AS payload
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
  SELECT public.get_profile_for_viewer('9f4d1000-0000-4000-8000-000000000002') AS payload
)
INSERT INTO validation_results
SELECT
  'profile rpc',
  'approximate distance_visibility returns only an allowed bucket',
  payload->>'distance_label' IN ('<5 km', '5-10 km', '10-25 km', '25-50 km', '50+ km'),
  COALESCE(payload->>'distance_label', 'null')
FROM profile_payload;

WITH profile_payload AS (
  SELECT public.get_profile_for_viewer('9f4d1000-0000-4000-8000-000000000003') AS payload
)
INSERT INTO validation_results
SELECT
  'profile rpc',
  'hidden distance_visibility returns null distance_label',
  payload IS NOT NULL AND payload->>'distance_label' IS NULL,
  COALESCE(payload::text, 'null')
FROM profile_payload;

RESET ROLE;

SELECT
  category,
  check_name,
  pass,
  details
FROM validation_results
ORDER BY category, check_name;
