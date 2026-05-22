-- Rollback-only validation for Profile Studio live counter read model.
--
-- Run after applying:
--   20260522190000_profile_live_counter_read_model.sql
--
-- Example:
--   supabase db query --linked -o table -f supabase/validation/profile_live_counter_read_model.sql

BEGIN;

CREATE TEMP TABLE profile_live_counter_results (
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
  'profile-live-counter-' || replace(fixture_user_id::text, '-', '') || '@example.invalid',
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
FROM (
  VALUES
    ('9f520000-0000-4000-8000-000000000101'::uuid),
    ('9f520000-0000-4000-8000-000000000102'::uuid),
    ('9f520000-0000-4000-8000-000000000103'::uuid),
    ('9f520000-0000-4000-8000-000000000104'::uuid)
) AS fixtures(fixture_user_id)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (
  id,
  name,
  age,
  gender,
  photos,
  events_attended,
  total_matches,
  total_conversations
) VALUES
  ('9f520000-0000-4000-8000-000000000101', 'Live Counter One', 31, 'woman', ARRAY[]::text[], 0, 0, 0),
  ('9f520000-0000-4000-8000-000000000102', 'Live Counter Two', 32, 'man', ARRAY[]::text[], 0, 0, 0),
  ('9f520000-0000-4000-8000-000000000103', 'Live Counter Three', 33, 'woman', ARRAY[]::text[], 0, 0, 0),
  ('9f520000-0000-4000-8000-000000000104', 'Live Counter Four', 34, 'man', ARRAY[]::text[], 99, 99, 99)
ON CONFLICT (id) DO UPDATE SET
  events_attended = EXCLUDED.events_attended,
  total_matches = EXCLUDED.total_matches,
  total_conversations = EXCLUDED.total_conversations;

INSERT INTO public.events (
  id,
  title,
  description,
  cover_image,
  event_date,
  duration_minutes,
  max_attendees,
  current_attendees,
  tags,
  status
) VALUES
  ('9f520000-0000-4000-8000-000000000201', 'Live Counter Event One', 'fixture', 'fixture.jpg', now() + interval '1 day', 60, 20, 0, ARRAY[]::text[], 'upcoming'),
  ('9f520000-0000-4000-8000-000000000202', 'Live Counter Event Two', 'fixture', 'fixture.jpg', now() + interval '2 days', 60, 20, 0, ARRAY[]::text[], 'upcoming'),
  ('9f520000-0000-4000-8000-000000000203', 'Live Counter Event Three', 'fixture', 'fixture.jpg', now() + interval '3 days', 60, 20, 0, ARRAY[]::text[], 'upcoming')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_registrations (event_id, profile_id)
VALUES
  ('9f520000-0000-4000-8000-000000000201', '9f520000-0000-4000-8000-000000000101'),
  ('9f520000-0000-4000-8000-000000000202', '9f520000-0000-4000-8000-000000000101'),
  ('9f520000-0000-4000-8000-000000000201', '9f520000-0000-4000-8000-000000000102')
ON CONFLICT (event_id, profile_id) DO NOTHING;

INSERT INTO public.matches (
  id,
  profile_id_1,
  profile_id_2,
  matched_at,
  last_message_at
) VALUES
  ('9f520000-0000-4000-8000-000000000301', '9f520000-0000-4000-8000-000000000101', '9f520000-0000-4000-8000-000000000102', now(), now()),
  ('9f520000-0000-4000-8000-000000000302', '9f520000-0000-4000-8000-000000000101', '9f520000-0000-4000-8000-000000000103', now(), NULL)
ON CONFLICT (id) DO UPDATE SET
  last_message_at = EXCLUDED.last_message_at;

SET LOCAL session_replication_role = origin;

SELECT public.recompute_profile_live_counts('9f520000-0000-4000-8000-000000000101');
SELECT public.recompute_profile_live_counts('9f520000-0000-4000-8000-000000000102');
SELECT public.recompute_profile_live_counts('9f520000-0000-4000-8000-000000000103');
SELECT public.recompute_profile_live_counts('9f520000-0000-4000-8000-000000000104');

INSERT INTO profile_live_counter_results(check_name, passed, detail)
SELECT
  'helper_recomputes_existing_rows',
  bool_and(
    CASE p.id
      WHEN '9f520000-0000-4000-8000-000000000101'::uuid THEN p.events_attended = 2 AND p.total_matches = 2 AND p.total_conversations = 1
      WHEN '9f520000-0000-4000-8000-000000000102'::uuid THEN p.events_attended = 1 AND p.total_matches = 1 AND p.total_conversations = 1
      WHEN '9f520000-0000-4000-8000-000000000103'::uuid THEN p.events_attended = 0 AND p.total_matches = 1 AND p.total_conversations = 0
      WHEN '9f520000-0000-4000-8000-000000000104'::uuid THEN p.events_attended = 0 AND p.total_matches = 0 AND p.total_conversations = 0
      ELSE false
    END
  ),
  jsonb_object_agg(p.id, jsonb_build_object(
    'events', p.events_attended,
    'matches', p.total_matches,
    'convos', p.total_conversations
  ))::text
FROM public.profiles p
WHERE p.id IN (
  '9f520000-0000-4000-8000-000000000101',
  '9f520000-0000-4000-8000-000000000102',
  '9f520000-0000-4000-8000-000000000103',
  '9f520000-0000-4000-8000-000000000104'
);

INSERT INTO public.event_registrations (event_id, profile_id)
VALUES ('9f520000-0000-4000-8000-000000000203', '9f520000-0000-4000-8000-000000000101');

INSERT INTO profile_live_counter_results(check_name, passed, detail)
SELECT
  'event_registration_insert_updates_events',
  p.events_attended = 3 AND p.total_matches = 2 AND p.total_conversations = 1,
  jsonb_build_object('events', p.events_attended, 'matches', p.total_matches, 'convos', p.total_conversations)::text
FROM public.profiles p
WHERE p.id = '9f520000-0000-4000-8000-000000000101';

DELETE FROM public.event_registrations
WHERE event_id = '9f520000-0000-4000-8000-000000000203'
  AND profile_id = '9f520000-0000-4000-8000-000000000101';

INSERT INTO profile_live_counter_results(check_name, passed, detail)
SELECT
  'event_registration_delete_updates_events',
  p.events_attended = 2 AND p.total_matches = 2 AND p.total_conversations = 1,
  jsonb_build_object('events', p.events_attended, 'matches', p.total_matches, 'convos', p.total_conversations)::text
FROM public.profiles p
WHERE p.id = '9f520000-0000-4000-8000-000000000101';

UPDATE public.event_registrations
SET profile_id = '9f520000-0000-4000-8000-000000000104'
WHERE event_id = '9f520000-0000-4000-8000-000000000202'
  AND profile_id = '9f520000-0000-4000-8000-000000000101';

INSERT INTO profile_live_counter_results(check_name, passed, detail)
SELECT
  'event_registration_profile_transfer_updates_both_profiles',
  bool_and(
    CASE p.id
      WHEN '9f520000-0000-4000-8000-000000000101'::uuid THEN p.events_attended = 1
      WHEN '9f520000-0000-4000-8000-000000000104'::uuid THEN p.events_attended = 1
      ELSE false
    END
  ),
  jsonb_object_agg(p.id, jsonb_build_object('events', p.events_attended))::text
FROM public.profiles p
WHERE p.id IN (
  '9f520000-0000-4000-8000-000000000101',
  '9f520000-0000-4000-8000-000000000104'
);

UPDATE public.event_registrations
SET profile_id = '9f520000-0000-4000-8000-000000000101'
WHERE event_id = '9f520000-0000-4000-8000-000000000202'
  AND profile_id = '9f520000-0000-4000-8000-000000000104';

INSERT INTO public.matches (
  id,
  profile_id_1,
  profile_id_2,
  matched_at,
  last_message_at
) VALUES (
  '9f520000-0000-4000-8000-000000000303',
  '9f520000-0000-4000-8000-000000000102',
  '9f520000-0000-4000-8000-000000000103',
  now(),
  NULL
);

INSERT INTO profile_live_counter_results(check_name, passed, detail)
SELECT
  'match_insert_updates_both_profiles',
  bool_and(
    CASE p.id
      WHEN '9f520000-0000-4000-8000-000000000102'::uuid THEN p.total_matches = 2 AND p.total_conversations = 1
      WHEN '9f520000-0000-4000-8000-000000000103'::uuid THEN p.total_matches = 2 AND p.total_conversations = 0
      ELSE false
    END
  ),
  jsonb_object_agg(p.id, jsonb_build_object('matches', p.total_matches, 'convos', p.total_conversations))::text
FROM public.profiles p
WHERE p.id IN (
  '9f520000-0000-4000-8000-000000000102',
  '9f520000-0000-4000-8000-000000000103'
);

DELETE FROM public.matches
WHERE id = '9f520000-0000-4000-8000-000000000303';

INSERT INTO profile_live_counter_results(check_name, passed, detail)
SELECT
  'match_delete_updates_both_profiles',
  bool_and(
    CASE p.id
      WHEN '9f520000-0000-4000-8000-000000000102'::uuid THEN p.total_matches = 1 AND p.total_conversations = 1
      WHEN '9f520000-0000-4000-8000-000000000103'::uuid THEN p.total_matches = 1 AND p.total_conversations = 0
      ELSE false
    END
  ),
  jsonb_object_agg(p.id, jsonb_build_object('matches', p.total_matches, 'convos', p.total_conversations))::text
FROM public.profiles p
WHERE p.id IN (
  '9f520000-0000-4000-8000-000000000102',
  '9f520000-0000-4000-8000-000000000103'
);

UPDATE public.matches
SET last_message_at = now()
WHERE id = '9f520000-0000-4000-8000-000000000302';

INSERT INTO profile_live_counter_results(check_name, passed, detail)
SELECT
  'last_message_at_set_updates_convos',
  bool_and(
    CASE p.id
      WHEN '9f520000-0000-4000-8000-000000000101'::uuid THEN p.total_matches = 2 AND p.total_conversations = 2
      WHEN '9f520000-0000-4000-8000-000000000103'::uuid THEN p.total_matches = 1 AND p.total_conversations = 1
      ELSE false
    END
  ),
  jsonb_object_agg(p.id, jsonb_build_object('matches', p.total_matches, 'convos', p.total_conversations))::text
FROM public.profiles p
WHERE p.id IN (
  '9f520000-0000-4000-8000-000000000101',
  '9f520000-0000-4000-8000-000000000103'
);

UPDATE public.matches
SET last_message_at = NULL
WHERE id = '9f520000-0000-4000-8000-000000000302';

INSERT INTO profile_live_counter_results(check_name, passed, detail)
SELECT
  'last_message_at_null_updates_convos',
  bool_and(
    CASE p.id
      WHEN '9f520000-0000-4000-8000-000000000101'::uuid THEN p.total_matches = 2 AND p.total_conversations = 1
      WHEN '9f520000-0000-4000-8000-000000000103'::uuid THEN p.total_matches = 1 AND p.total_conversations = 0
      ELSE false
    END
  ),
  jsonb_object_agg(p.id, jsonb_build_object('matches', p.total_matches, 'convos', p.total_conversations))::text
FROM public.profiles p
WHERE p.id IN (
  '9f520000-0000-4000-8000-000000000101',
  '9f520000-0000-4000-8000-000000000103'
);

SELECT check_name, passed, detail
FROM profile_live_counter_results
ORDER BY check_name;

DO $$
DECLARE
  v_failed jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'check_name', check_name,
    'detail', detail
  ) ORDER BY check_name)
  INTO v_failed
  FROM profile_live_counter_results
  WHERE NOT passed;

  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'profile live counter validation failed: %', v_failed;
  END IF;
END;
$$;

ROLLBACK;
