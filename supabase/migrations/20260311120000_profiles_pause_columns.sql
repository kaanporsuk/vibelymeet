-- Stream 1B: Backend-authoritative account pause/resume
-- Add pause state to profiles so DB is source of truth (not local auth/entitlement state).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_until timestamptz,
  ADD COLUMN IF NOT EXISTS pause_reason text;

COMMENT ON COLUMN public.profiles.is_paused IS 'True when profile is paused (hidden from deck/drops; notifications suppressed)';
COMMENT ON COLUMN public.profiles.paused_at IS 'When the current pause started';
COMMENT ON COLUMN public.profiles.paused_until IS 'When pause ends (null = indefinite)';
COMMENT ON COLUMN public.profiles.pause_reason IS 'Optional reason/category for pause';
