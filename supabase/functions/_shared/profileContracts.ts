export const DEFAULT_BOOTSTRAP_AGE = 18;
export const DEFAULT_BOOTSTRAP_GENDER = "prefer_not_to_say";

export type LocationData = { lat: number; lng: number } | null;

type BootstrapProfileInsertInput = {
  userId: string;
  name: string;
  phoneNumber: string | null;
  referredBy?: string | null;
};

export function pickBootstrapName(userMetadata: Record<string, unknown> | null | undefined): string {
  const md = userMetadata ?? {};
  const rawName =
    (typeof md.full_name === "string" && md.full_name) ||
    (typeof md.name === "string" && md.name) ||
    "";
  return rawName.trim();
}

export function buildBootstrapProfileInsert(input: BootstrapProfileInsertInput) {
  const isPhoneAuth = !!input.phoneNumber;
  return {
    id: input.userId,
    name: input.name.trim(),
    age: DEFAULT_BOOTSTRAP_AGE,
    gender: DEFAULT_BOOTSTRAP_GENDER,
    birth_date: null as string | null,
    referred_by: input.referredBy ?? null,
    phone_number: isPhoneAuth ? input.phoneNumber : null,
    phone_verified: isPhoneAuth,
    phone_verified_at: isPhoneAuth ? new Date().toISOString() : null,
  };
}

export type OnboardingProfileUpsertInput = {
  userId: string;
  name: string;
  birthDate: string;
  age: number;
  gender: string;
  genderCustom?: string;
  interestedIn: string;
  relationshipIntent: string;
  heightCm: number | null;
  job: string;
  photos: string[];
  aboutMe: string;
  location: string;
  locationData: LocationData;
  country: string;
  bunnyVideoUid: string | null;
  communityAgreed: boolean;
};

export function normalizeRelationshipIntent(relationshipIntent: string): string {
  return relationshipIntent === "open" ? "figuring-out" : relationshipIntent;
}

export function buildOnboardingProfileUpsert(input: OnboardingProfileUpsertInput) {
  const normalizedIntent = normalizeRelationshipIntent(input.relationshipIntent);
  const normalizedGender =
    input.gender === "other" && input.genderCustom?.trim()
      ? input.genderCustom.trim()
      : input.gender;

  return {
    id: input.userId,
    name: input.name.trim(),
    birth_date: input.birthDate,
    age: input.age,
    gender: normalizedGender,
    interested_in: [input.interestedIn],
    relationship_intent: normalizedIntent,
    // Keep legacy mirror while reads migrate to relationship_intent everywhere.
    looking_for: normalizedIntent,
    height_cm: input.heightCm ?? null,
    job: input.job.trim() || null,
    photos: input.photos,
    avatar_url: input.photos[0] || null,
    about_me: input.aboutMe.trim() || null,
    location: input.location || null,
    location_data: input.locationData || null,
    country: input.country || null,
    bunny_video_uid: input.bunnyVideoUid || null,
    community_agreed_at: input.communityAgreed ? new Date().toISOString() : null,
  };
}
