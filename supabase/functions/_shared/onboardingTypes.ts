/**
 * Canonical onboarding data shape, shared across web, native, and backend.
 *
 * The server (onboarding_drafts table + finalize_onboarding RPC) is the
 * source of truth. These types are shared so both platforms and the backend
 * speak the same shape.
 */

import type { LocationData } from "./profileContracts";

// ─── Step / stage constants ──────────────────────────────────────────────────

export const ONBOARDING_STEP_NAMES = [
  "value_prop",
  "name",
  "birthday",
  "gender",
  "interested_in",
  "relationship_intent",
  "basics",
  "photos",
  "about_me",
  "location",
  "notifications",
  "community_standards",
  "email_collection",
  "vibe_video",
  "celebration",
] as const;

export type OnboardingStepName = (typeof ONBOARDING_STEP_NAMES)[number];

export const TOTAL_STEPS_WITH_EMAIL = 15;
export const TOTAL_STEPS_NO_EMAIL = 14;

export const ONBOARDING_STAGES = [
  "none",
  "auth_complete",
  "identity",
  "details",
  "media",
  "complete",
] as const;

export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];

// `profiles.onboarding_stage` / `update_onboarding_stage` remain in the schema
// for backwards-compatible analytics history, but the active web/native flows
// now persist in-progress onboarding state through `onboarding_drafts`.

export function getOnboardingStageForStep(step: number): OnboardingStage {
  if (step <= 0) return "auth_complete";
  if (step <= 4) return "identity";
  if (step <= 8) return "details";
  return "media";
}

// ─── Draft data shape ────────────────────────────────────────────────────────

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
  locationData: LocationData;
  country: string;
  vibeVideoRecorded: boolean;
  bunnyVideoUid: string | null;
  communityAgreed: boolean;
}

export const DEFAULT_ONBOARDING_DATA: Readonly<OnboardingData> = {
  name: "",
  birthDate: "",
  gender: "",
  genderCustom: "",
  interestedIn: "",
  relationshipIntent: "",
  heightCm: null,
  job: "",
  photos: [],
  aboutMe: "",
  location: "",
  locationData: null,
  country: "",
  vibeVideoRecorded: false,
  bunnyVideoUid: null,
  communityAgreed: false,
};

// ─── Local cache helpers (non-authoritative) ─────────────────────────────────
// Local storage / AsyncStorage is used only as an optimistic cache to reduce
// latency on the current device. The server draft is always the source of truth.

export const ONBOARDING_STORAGE_KEY = "vibely_onboarding_v3";
export const ONBOARDING_LEGACY_STORAGE_KEYS = [
  "vibely_onboarding_v2",
  "vibely_onboarding_progress",
];

export interface LocalDraftCache {
  userId: string;
  step: number;
  data: OnboardingData;
  ts: number;
}

export function writeLocalDraftCache(
  storage: { setItem(key: string, value: string): void | Promise<void> },
  userId: string,
  step: number,
  data: OnboardingData,
): void {
  try {
    const cache: LocalDraftCache = { userId, step, data, ts: Date.now() };
    void storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Best-effort
  }
}

export function readLocalDraftCache(
  raw: string | null,
  currentUserId: string,
): { step: number; data: OnboardingData } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.userId !== currentUserId) return null;
    if (Date.now() - (parsed.ts ?? 0) > 7 * 24 * 60 * 60 * 1000) return null;
    if (typeof parsed.step !== "number" || !parsed.data) return null;

    const data: OnboardingData = { ...DEFAULT_ONBOARDING_DATA };
    const d = parsed.data;
    if (typeof d.name === "string") data.name = d.name;
    if (typeof d.birthDate === "string") data.birthDate = d.birthDate;
    if (typeof d.gender === "string") data.gender = d.gender;
    if (typeof d.genderCustom === "string") data.genderCustom = d.genderCustom;
    if (typeof d.interestedIn === "string") data.interestedIn = d.interestedIn;
    if (typeof d.relationshipIntent === "string") data.relationshipIntent = d.relationshipIntent;
    if (typeof d.heightCm === "number" || d.heightCm === null) data.heightCm = d.heightCm;
    if (typeof d.job === "string") data.job = d.job;
    if (Array.isArray(d.photos)) data.photos = d.photos.filter((p: unknown) => typeof p === "string");
    if (typeof d.aboutMe === "string") data.aboutMe = d.aboutMe;
    if (typeof d.location === "string") data.location = d.location;
    if (d.locationData && typeof d.locationData.lat === "number" && typeof d.locationData.lng === "number") {
      data.locationData = { lat: d.locationData.lat, lng: d.locationData.lng };
    }
    if (typeof d.country === "string") data.country = d.country;
    if (typeof d.vibeVideoRecorded === "boolean") data.vibeVideoRecorded = d.vibeVideoRecorded;
    if (typeof d.bunnyVideoUid === "string" || d.bunnyVideoUid === null) data.bunnyVideoUid = d.bunnyVideoUid;
    if (typeof d.communityAgreed === "boolean") data.communityAgreed = d.communityAgreed;

    return { step: parsed.step, data };
  } catch {
    return null;
  }
}

// ─── Client-side pre-validation (mirrors server RPC checks) ─────────────────
// Used for immediate UI feedback. Server is still the final authority.

export interface OnboardingValidationResult {
  valid: boolean;
  errors: string[];
}

export function calculateAge(iso: string): number {
  const birth = new Date(iso);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

export function validateOnboardingData(data: OnboardingData): OnboardingValidationResult {
  const errors: string[] = [];

  if (!data.name.trim()) {
    errors.push("Name is required");
  }

  if (!data.birthDate) {
    errors.push("Birthday is required");
  } else {
    const age = calculateAge(data.birthDate);
    if (age < 18) errors.push("Must be 18 or older");
  }

  const effectiveGender =
    data.gender === "other" && data.genderCustom?.trim()
      ? data.genderCustom.trim()
      : data.gender;
  if (!effectiveGender || effectiveGender === "prefer_not_to_say") {
    errors.push("Gender is required");
  }

  if (data.photos.length < 2) {
    errors.push("At least 2 photos required");
  }

  const trimmedAboutMe = data.aboutMe.trim();
  if (trimmedAboutMe.length > 0 && trimmedAboutMe.length < 10) {
    errors.push("About me must be at least 10 characters");
  }

  if (!data.interestedIn) {
    errors.push("Interested in is required");
  }

  if (!data.relationshipIntent?.trim()) {
    errors.push("Relationship intent is required");
  }

  if (!data.location?.trim()) {
    errors.push("Location is required");
  }

  if (!data.communityAgreed) {
    errors.push("Community standards agreement is required");
  }

  return { valid: errors.length === 0, errors };
}
