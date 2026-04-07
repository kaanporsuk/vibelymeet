-- Sprint 2: discovery preferences — profile columns for age range + persisted event filter defaults.
-- get_event_deck change ships in 20260415100000 (must run after 20260412120000_event_cancel_truth_capacity).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_age_min smallint,
  ADD COLUMN IF NOT EXISTS preferred_age_max smallint,
  ADD COLUMN IF NOT EXISTS event_discovery_prefs jsonb;

COMMENT ON COLUMN public.profiles.preferred_age_min IS 'Optional minimum age for people shown in event deck (18–99); NULL = no lower bound';
COMMENT ON COLUMN public.profiles.preferred_age_max IS 'Optional maximum age for people shown in event deck (18–99); NULL = no upper bound';
COMMENT ON COLUMN public.profiles.event_discovery_prefs IS 'Client-owned JSON: locationMode, distanceKm, selectedCity (lat/lng/name/country) — server does not trust for premium; get_visible_events unchanged';

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_preferred_age_min_bounds;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_age_min_bounds CHECK (
    preferred_age_min IS NULL OR (preferred_age_min >= 18 AND preferred_age_min <= 99)
  );

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_preferred_age_max_bounds;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_age_max_bounds CHECK (
    preferred_age_max IS NULL OR (preferred_age_max >= 18 AND preferred_age_max <= 99)
  );

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_preferred_age_order;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_preferred_age_order CHECK (
    preferred_age_min IS NULL
    OR preferred_age_max IS NULL
    OR preferred_age_min <= preferred_age_max
  );

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_event_discovery_prefs_object;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_event_discovery_prefs_object CHECK (
    event_discovery_prefs IS NULL OR jsonb_typeof(event_discovery_prefs) = 'object'
  );
