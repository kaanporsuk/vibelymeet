-- Reset database: Delete all data from events, profiles, and registrations
-- Using DELETE instead of TRUNCATE to respect foreign key relationships

-- First delete registrations (depends on events and profiles)
DELETE FROM public.event_registrations;

-- Delete matches and messages (depends on profiles)
DELETE FROM public.messages;
DELETE FROM public.matches;

-- Delete profile vibes (depends on profiles)
DELETE FROM public.profile_vibes;

-- Delete video sessions (depends on profiles and events)
DELETE FROM public.video_sessions;

-- Delete events
DELETE FROM public.events;

-- Delete profiles
DELETE FROM public.profiles;