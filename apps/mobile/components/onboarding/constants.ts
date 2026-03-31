// Keep this file aligned with src/pages/onboarding.constants.ts.
// Web and native bundles cannot currently share one runtime module safely.
export const ONBOARDING_STEP_NAMES = [
  'value_prop',
  'name',
  'birthday',
  'gender',
  'interested_in',
  'relationship_intent',
  'basics',
  'photos',
  'about_me',
  'location',
  'notifications',
  'community_standards',
  'email_collection',
  'vibe_video',
  'celebration',
] as const;

export type OnboardingStepName = (typeof ONBOARDING_STEP_NAMES)[number];

export const TOTAL_STEPS_WITH_EMAIL = 15;
export const TOTAL_STEPS_NO_EMAIL = 14;

export function getOnboardingStageForStep(step: number): string | null {
  if (step <= 0) return 'auth_complete';
  if (step <= 4) return 'identity';
  if (step <= 8) return 'details';
  if (step <= 12) return 'media';
  return null;
}
