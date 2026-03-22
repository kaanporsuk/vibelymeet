-- Ensure vibe score columns exist (idempotent). Some environments may have missed them if an earlier migration partially failed.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vibe_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vibe_score_label text NOT NULL DEFAULT 'Getting started';

COMMENT ON COLUMN public.profiles.vibe_score IS '0–100 profile completeness score; computed server-side.';
COMMENT ON COLUMN public.profiles.vibe_score_label IS 'Short label for UI; computed server-side.';
