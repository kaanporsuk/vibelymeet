-- Record when user agreed to community standards during onboarding
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS community_agreed_at timestamptz;

COMMENT ON COLUMN public.profiles.community_agreed_at IS 'Timestamp when user agreed to community standards during onboarding. Legal safeguard.';
