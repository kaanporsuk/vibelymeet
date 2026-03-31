-- Mark existing users who have completed onboarding as complete.
-- Criteria: has a name, has gender set (not empty, not 'prefer_not_to_say'), has at least 1 photo.
-- Also: anyone with vibe_score > 0 has clearly used the app.

UPDATE public.profiles
SET onboarding_complete = true,
    onboarding_stage = 'complete'
WHERE name IS NOT NULL
  AND name <> ''
  AND gender IS NOT NULL
  AND gender <> ''
  AND gender <> 'prefer_not_to_say'
  AND array_length(photos, 1) IS NOT NULL
  AND array_length(photos, 1) >= 1;

UPDATE public.profiles
SET onboarding_complete = true,
    onboarding_stage = 'complete'
WHERE onboarding_complete = false
  AND vibe_score > 0;
