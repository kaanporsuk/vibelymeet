export interface OnboardingData {
  name: string;
  birthDate: string;
  gender: string;
  genderCustom: string;
  interestedIn: string;
  relationshipIntent: string;
  heightCm: number | null;
  job: string;
  photos: string[];
  aboutMe: string;
  location: string;
  locationData: { lat: number; lng: number } | null;
  city: string;
  country: string;
  vibeVideoRecorded: boolean;
  bunnyVideoUid: string | null;
  communityAgreed: boolean;
}

export const DEFAULT_ONBOARDING_DATA: OnboardingData = {
  name: '',
  birthDate: '',
  gender: '',
  genderCustom: '',
  interestedIn: '',
  relationshipIntent: '',
  heightCm: null,
  job: '',
  photos: [],
  aboutMe: '',
  location: '',
  locationData: null,
  city: '',
  country: '',
  vibeVideoRecorded: false,
  bunnyVideoUid: null,
  communityAgreed: false,
};
