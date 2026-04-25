-- Cloud validation probes for event_attendance_visibility enforcement.
--
-- Run against the linked Supabase project only:
--   supabase db query --linked -o table -f supabase/validation/event_attendance_visibility_enforcement.sql
--
-- This script opens an explicit transaction, creates deterministic fixture
-- rows, switches into anon/authenticated/service_role with JWT settings for
-- RLS probes, and leaves the transaction uncommitted. The Supabase query
-- connection rolls the transaction back after returning the final result set.

BEGIN;

CREATE TEMP TABLE validation_results (
  category text NOT NULL,
  check_name text NOT NULL,
  pass boolean NOT NULL,
  details text
);

GRANT INSERT, SELECT ON validation_results TO anon, authenticated, service_role;

CREATE TEMP TABLE validation_context AS
SELECT (
  SELECT user_id
  FROM public.user_roles
  WHERE role = 'admin'::public.app_role
  ORDER BY created_at ASC
  LIMIT 1
) AS admin_id;

GRANT SELECT ON validation_context TO anon, authenticated, service_role;

-- Fixture ids. These should never collide with real users; all rows are
-- uncommitted and are rolled back when the query connection closes.
INSERT INTO validation_results
SELECT
  'preflight',
  'existing admin role is available for admin RLS probe',
  admin_id IS NOT NULL,
  COALESCE(admin_id::text, 'missing admin user_roles row')
FROM validation_context;

SET LOCAL session_replication_role = replica;

INSERT INTO public.profiles (
  id,
  name,
  age,
  gender,
  interested_in,
  photos,
  avatar_url,
  events_attended,
  event_attendance_visibility,
  discovery_audience,
  discovery_mode,
  discoverable,
  onboarding_complete
) VALUES
  ('9f4e0000-0000-4000-8000-000000000001', 'Validation A Viewer', 30, 'woman', NULL, ARRAY[]::text[], NULL, 1, 'attendees', 'everyone', 'visible', true, true),
  ('9f4e0000-0000-4000-8000-000000000002', 'Validation T Attendees', 31, 'man', NULL, ARRAY[]::text[], NULL, 2, 'attendees', 'everyone', 'visible', true, true),
  ('9f4e0000-0000-4000-8000-000000000003', 'Validation U Unmatched', 32, 'man', NULL, ARRAY[]::text[], NULL, 9, 'matches_only', 'everyone', 'visible', true, true),
  ('9f4e0000-0000-4000-8000-000000000004', 'Validation C Matched', 33, 'man', NULL, ARRAY[]::text[], NULL, 7, 'matches_only', 'everyone', 'visible', true, true),
  ('9f4e0000-0000-4000-8000-000000000005', 'Validation B Hidden Matched', 34, 'man', NULL, ARRAY[]::text[], NULL, 5, 'hidden', 'everyone', 'visible', true, true),
  ('9f4e0000-0000-4000-8000-000000000006', 'Validation D Hidden Deck', 35, 'man', NULL, ARRAY[]::text[], NULL, 11, 'hidden', 'everyone', 'visible', true, true),
  ('9f4e0000-0000-4000-8000-000000000007', 'Validation W Waitlisted', 36, 'woman', NULL, ARRAY[]::text[], NULL, 0, 'attendees', 'everyone', 'visible', true, true);

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
  '9f4e0000-0000-4000-8000-000000000100',
  'Validation Event Attendance Visibility',
  'Rollback-only validation fixture',
  'validation-cover.jpg',
  now() + interval '1 hour',
  60,
  'live',
  20,
  7,
  true,
  'global'
);

INSERT INTO public.event_registrations (event_id, profile_id, admission_status, payment_status, queue_status)
VALUES
  ('9f4e0000-0000-4000-8000-000000000100', '9f4e0000-0000-4000-8000-000000000001', 'confirmed', 'free', 'idle'),
  ('9f4e0000-0000-4000-8000-000000000100', '9f4e0000-0000-4000-8000-000000000002', 'confirmed', 'free', 'idle'),
  ('9f4e0000-0000-4000-8000-000000000100', '9f4e0000-0000-4000-8000-000000000003', 'confirmed', 'free', 'idle'),
  ('9f4e0000-0000-4000-8000-000000000100', '9f4e0000-0000-4000-8000-000000000004', 'confirmed', 'free', 'idle'),
  ('9f4e0000-0000-4000-8000-000000000100', '9f4e0000-0000-4000-8000-000000000005', 'confirmed', 'free', 'idle'),
  ('9f4e0000-0000-4000-8000-000000000100', '9f4e0000-0000-4000-8000-000000000006', 'confirmed', 'free', 'idle'),
  ('9f4e0000-0000-4000-8000-000000000100', '9f4e0000-0000-4000-8000-000000000007', 'waitlisted', 'free', 'idle');

INSERT INTO public.matches (profile_id_1, profile_id_2, event_id)
VALUES
  ('9f4e0000-0000-4000-8000-000000000001', '9f4e0000-0000-4000-8000-000000000004', '9f4e0000-0000-4000-8000-000000000100'),
  ('9f4e0000-0000-4000-8000-000000000001', '9f4e0000-0000-4000-8000-000000000005', '9f4e0000-0000-4000-8000-000000000100');

SET LOCAL session_replication_role = origin;

INSERT INTO validation_results
SELECT
  'profile grants',
  'authenticated lacks direct profiles.events_attended column privilege',
  NOT has_column_privilege('authenticated', 'public.profiles', 'events_attended', 'SELECT'),
  'has_column_privilege(authenticated, profiles.events_attended, SELECT) should be false';

INSERT INTO validation_results
SELECT
  'profile grants',
  'anon lacks direct profiles.events_attended column privilege',
  NOT has_column_privilege('anon', 'public.profiles', 'events_attended', 'SELECT'),
  'has_column_privilege(anon, profiles.events_attended, SELECT) should be false';

INSERT INTO validation_results
SELECT
  'profile grants',
  'service_role keeps profiles.events_attended column privilege',
  has_column_privilege('service_role', 'public.profiles', 'events_attended', 'SELECT'),
  'service_role should retain privileged operational access';

DO $$
DECLARE
  v_denied boolean := false;
  v_details text := NULL;
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', '9f4e0000-0000-4000-8000-000000000001', true);
    EXECUTE 'SELECT events_attended FROM public.profiles WHERE id = ''9f4e0000-0000-4000-8000-000000000005''::uuid';
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
    'authenticated direct SELECT profiles.events_attended is denied',
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
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM set_config('request.jwt.claim.role', 'anon', true);
    PERFORM set_config('request.jwt.claim.sub', '', true);
    EXECUTE 'SELECT events_attended FROM public.profiles WHERE id = ''9f4e0000-0000-4000-8000-000000000005''::uuid';
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
    'anon direct SELECT profiles.events_attended is denied',
    v_denied,
    COALESCE(v_details, 'unexpectedly allowed')
  );
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '9f4e0000-0000-4000-8000-000000000001', true);

INSERT INTO validation_results
SELECT
  'profile grants',
  'authenticated allowed-column self profile load works',
  COUNT(*) = 1,
  'self profile select without events_attended should still work'
FROM public.profiles
WHERE id = '9f4e0000-0000-4000-8000-000000000001';

UPDATE public.profiles
SET tagline = 'validation updated'
WHERE id = '9f4e0000-0000-4000-8000-000000000001';

INSERT INTO validation_results
SELECT
  'profile grants',
  'authenticated onboarding-style own profile update/load works',
  EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = '9f4e0000-0000-4000-8000-000000000001'
      AND tagline = 'validation updated'
  ),
  'own profile update should still satisfy profile UPDATE RLS';

WITH preview AS (
  SELECT public.get_event_attendee_preview(
    '9f4e0000-0000-4000-8000-000000000100',
    '9f4e0000-0000-4000-8000-000000000001'
  ) AS payload
)
INSERT INTO validation_results
SELECT
  'attendee preview',
  'visible count includes attendees and matched matches_only only',
  (payload->>'viewer_admission') = 'confirmed'
    AND (payload->>'visible_other_count')::int = 2
    AND (payload->>'total_other_confirmed')::int = 2
    AND (payload->>'visible_cohort_count')::int = 2
    AND (payload->>'obscured_remaining')::int = 0,
  payload::text
FROM preview;

WITH preview AS (
  SELECT public.get_event_attendee_preview(
    '9f4e0000-0000-4000-8000-000000000100',
    '9f4e0000-0000-4000-8000-000000000001'
  ) AS payload
)
INSERT INTO validation_results
SELECT
  'attendee preview',
  'revealed set excludes hidden and unmatched matches_only',
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload->'revealed') elem
    WHERE elem->>'profile_id' = '9f4e0000-0000-4000-8000-000000000002'
  )
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload->'revealed') elem
    WHERE elem->>'profile_id' = '9f4e0000-0000-4000-8000-000000000004'
  )
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload->'revealed') elem
    WHERE elem->>'profile_id' IN (
      '9f4e0000-0000-4000-8000-000000000003',
      '9f4e0000-0000-4000-8000-000000000005',
      '9f4e0000-0000-4000-8000-000000000006'
    )
  ),
  payload::text
FROM preview;

INSERT INTO validation_results
SELECT
  'visible attendees',
  'get_event_visible_attendees uses same visibility predicate',
  array_agg(attendee ORDER BY attendee) = ARRAY[
    '9f4e0000-0000-4000-8000-000000000002'::uuid,
    '9f4e0000-0000-4000-8000-000000000004'::uuid
  ],
  COALESCE(array_agg(attendee ORDER BY attendee)::text, '{}')
FROM public.get_event_visible_attendees(
  '9f4e0000-0000-4000-8000-000000000100',
  '9f4e0000-0000-4000-8000-000000000001'
) attendee;

WITH hidden_profile AS (
  SELECT public.get_profile_for_viewer('9f4e0000-0000-4000-8000-000000000005') AS payload
)
INSERT INTO validation_results
SELECT
  'profile rpc',
  'hidden matched profile masks events_attended',
  payload IS NOT NULL AND payload->'events_attended' = 'null'::jsonb,
  COALESCE(payload::text, 'null')
FROM hidden_profile;

WITH unmatched_profile AS (
  SELECT public.get_profile_for_viewer('9f4e0000-0000-4000-8000-000000000003') AS payload
)
INSERT INTO validation_results
SELECT
  'profile rpc',
  'unmatched matches_only profile does not leak events_attended',
  payload IS NULL OR payload->'events_attended' = 'null'::jsonb,
  COALESCE(payload::text, 'null')
FROM unmatched_profile;

WITH matched_profile AS (
  SELECT public.get_profile_for_viewer('9f4e0000-0000-4000-8000-000000000004') AS payload
)
INSERT INTO validation_results
SELECT
  'profile rpc',
  'matched matches_only profile can show events_attended',
  payload->>'events_attended' = '7',
  COALESCE(payload::text, 'null')
FROM matched_profile;

INSERT INTO validation_results
SELECT
  'event_registrations rls',
  'normal viewer direct event_registrations roster select returns only own row',
  COUNT(*) = 1
    AND bool_and(profile_id = '9f4e0000-0000-4000-8000-000000000001'::uuid),
  COALESCE(array_agg(profile_id ORDER BY profile_id)::text, '{}')
FROM public.event_registrations
WHERE event_id = '9f4e0000-0000-4000-8000-000000000100';

INSERT INTO validation_results
SELECT
  'deck',
  'hidden participant remains eligible for live lobby deck when otherwise qualified',
  EXISTS (
    SELECT 1
    FROM public.get_event_deck(
      '9f4e0000-0000-4000-8000-000000000100',
      '9f4e0000-0000-4000-8000-000000000001',
      50
    ) deck
    WHERE deck.profile_id = '9f4e0000-0000-4000-8000-000000000006'
  ),
  'get_event_deck is active lobby discovery and intentionally not filtered by event_attendance_visibility';

RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '9f4e0000-0000-4000-8000-000000000007', true);

WITH preview AS (
  SELECT public.get_event_attendee_preview(
    '9f4e0000-0000-4000-8000-000000000100',
    '9f4e0000-0000-4000-8000-000000000007'
  ) AS payload
)
INSERT INTO validation_results
SELECT
  'attendee preview',
  'waitlisted viewer sees no roster or counts',
  (payload->>'viewer_admission') = 'waitlisted'
    AND (payload->>'visible_other_count')::int = 0
    AND (payload->>'total_other_confirmed')::int = 0
    AND (payload->>'visible_cohort_count')::int = 0
    AND jsonb_array_length(payload->'revealed') = 0,
  payload::text
FROM preview;

RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', (SELECT admin_id::text FROM validation_context), true);

INSERT INTO validation_results
SELECT
  'admin',
  'admin authenticated client can still inspect event_registrations roster',
  COUNT(*) = 7,
  COUNT(*)::text
FROM public.event_registrations
WHERE event_id = '9f4e0000-0000-4000-8000-000000000100';

INSERT INTO validation_results
SELECT
  'admin',
  'admin user-list style profile select works without events_attended column',
  COUNT(*) >= 7,
  COUNT(*)::text
FROM public.profiles
WHERE id IN (
  '9f4e0000-0000-4000-8000-000000000001',
  '9f4e0000-0000-4000-8000-000000000002',
  '9f4e0000-0000-4000-8000-000000000003',
  '9f4e0000-0000-4000-8000-000000000004',
  '9f4e0000-0000-4000-8000-000000000005',
  '9f4e0000-0000-4000-8000-000000000006',
  '9f4e0000-0000-4000-8000-000000000007'
);

RESET ROLE;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', COALESCE((SELECT admin_id::text FROM validation_context), '9f4e0000-0000-4000-8000-000000000001'), true);

INSERT INTO validation_results
SELECT
  'service_role',
  'service_role can inspect full event_registrations roster',
  COUNT(*) = 7,
  COUNT(*)::text
FROM public.event_registrations
WHERE event_id = '9f4e0000-0000-4000-8000-000000000100';

INSERT INTO validation_results
SELECT
  'service_role',
  'service_role can read privileged profiles.events_attended',
  events_attended = 5,
  COALESCE(events_attended::text, 'null')
FROM public.profiles
WHERE id = '9f4e0000-0000-4000-8000-000000000005';

RESET ROLE;

SELECT
  category,
  check_name,
  pass,
  details
FROM validation_results
ORDER BY category, check_name;
