-- Profiles: discovery & visibility toggles for native (and web) privacy settings.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discoverable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_distance boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_online_status boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.discoverable IS 'When false, user is hidden from discovery and matching';
COMMENT ON COLUMN public.profiles.show_distance IS 'When false, distance is hidden from other users';
COMMENT ON COLUMN public.profiles.show_online_status IS 'When false, active/online status is hidden from matches';
