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
