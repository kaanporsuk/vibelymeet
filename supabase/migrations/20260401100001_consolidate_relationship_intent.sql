-- Canonical relationship_intent column; looking_for kept for backwards compatibility.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS relationship_intent text;

-- Backfill relationship_intent from looking_for for existing users where relationship_intent is null
UPDATE public.profiles
SET relationship_intent = looking_for
WHERE relationship_intent IS NULL
  AND looking_for IS NOT NULL
  AND looking_for <> '';

COMMENT ON COLUMN public.profiles.relationship_intent IS 'Canonical relationship intent field. Both web and native write here. looking_for is legacy and should not be used for new reads.';
COMMENT ON COLUMN public.profiles.looking_for IS 'LEGACY — replaced by relationship_intent. Kept for backwards compat. Do not use for new features.';
