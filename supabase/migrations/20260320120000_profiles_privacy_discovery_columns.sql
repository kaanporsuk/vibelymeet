-- Profiles: legacy discovery flags (web + native) and Privacy & Visibility Center columns.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discoverable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_distance boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_online_status boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.discoverable IS 'When false, user is hidden from discovery and matching';
COMMENT ON COLUMN public.profiles.show_distance IS 'When false, distance is hidden from other users';
COMMENT ON COLUMN public.profiles.show_online_status IS 'When false, active/online status is hidden from matches';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discovery_mode text DEFAULT 'visible'
    CHECK (discovery_mode IN ('visible', 'snoozed', 'hidden')),
  ADD COLUMN IF NOT EXISTS discovery_snooze_until timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS discovery_audience text DEFAULT 'everyone'
    CHECK (discovery_audience IN ('everyone', 'event_based', 'hidden')),
  ADD COLUMN IF NOT EXISTS activity_status_visibility text DEFAULT 'matches'
    CHECK (activity_status_visibility IN ('matches', 'event_connections', 'nobody')),
  ADD COLUMN IF NOT EXISTS distance_visibility text DEFAULT 'approximate'
    CHECK (distance_visibility IN ('approximate', 'hidden')),
  ADD COLUMN IF NOT EXISTS event_attendance_visibility text DEFAULT 'attendees'
    CHECK (event_attendance_visibility IN ('attendees', 'matches_only', 'hidden'));
