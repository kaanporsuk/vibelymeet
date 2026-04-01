// Re-export canonical onboarding constants from the shared module.
// This file exists for backwards compatibility with existing native imports.
export {
  ONBOARDING_STEP_NAMES,
  type OnboardingStepName,
  TOTAL_STEPS_WITH_EMAIL,
  TOTAL_STEPS_NO_EMAIL,
  getOnboardingStageForStep,
} from '@shared/onboardingTypes';
