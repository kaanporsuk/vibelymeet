-- Add explicit onboarding completion tracking
-- Previously derived from field presence (inconsistent between web and native)

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS onboarding_complete boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS onboarding_stage text NOT NULL DEFAULT 'none'
CHECK (onboarding_stage IN ('none', 'auth_complete', 'identity', 'details', 'media', 'complete'));

COMMENT ON COLUMN public.profiles.onboarding_complete IS 'Explicit flag set by complete_onboarding RPC when user finishes all required onboarding steps. Single source of truth for both web and native.';
COMMENT ON COLUMN public.profiles.onboarding_stage IS 'Tracks the furthest onboarding stage reached. Used for analytics funnels and resume-from-where-you-left-off.';

-- Partial index for queries that filter incomplete onboarding (optional optimization)
CREATE INDEX IF NOT EXISTS idx_profiles_onboarding_complete
  ON public.profiles (id)
  WHERE onboarding_complete = false;
