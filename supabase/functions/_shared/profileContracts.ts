import type { AuthUserId } from "./identity";

export const DEFAULT_BOOTSTRAP_AGE = 18;
export const DEFAULT_BOOTSTRAP_GENDER = "prefer_not_to_say";

export type LocationData = { lat: number; lng: number } | null;

export const RELATIONSHIP_INTENT_OPTIONS = [
  {
    id: "long-term",
    label: "Long-term partner",
    description: "Ready to settle down",
    emoji: "💍",
  },
  {
    id: "relationship",
    label: "Relationship",
    description: "Open to something real",
    emoji: "💕",
  },
  {
    id: "something-casual",
    label: "Something casual",
    description: "Let's see where it goes",
    emoji: "✨",
  },
  {
    id: "new-friends",
    label: "New friends",
    description: "Expanding the squad",
    emoji: "👋",
  },
  {
    id: "figuring-out",
    label: "Figuring it out",
    description: "Still exploring",
    emoji: "🤷",
  },
  {
    id: "rather-not",
    label: "Rather not say",
    description: "Prefer not to share",
    emoji: "🤐",
  },
] as const;

export type RelationshipIntentId = (typeof RELATIONSHIP_INTENT_OPTIONS)[number]["id"];

const INTENT_BY_ID: Record<string, (typeof RELATIONSHIP_INTENT_OPTIONS)[number]> = RELATIONSHIP_INTENT_OPTIONS.reduce(
  (acc, opt) => {
    acc[opt.id] = opt;
    return acc;
  },
  {} as Record<string, (typeof RELATIONSHIP_INTENT_OPTIONS)[number]>,
);

/**
 * Normalize any known legacy/native/web variants into the canonical vocabulary.
 *
 * Canonical source of truth:
 * - `profiles.relationship_intent`
 *
 * Notes:
 * - `open` is treated as an "open-ended" / exploring choice historically.
 *   We normalize it to `figuring-out` (not `rather-not`).
 * - snake_case ids from native onboarding are normalized to kebab-case.
 */
export function normalizeRelationshipIntentId(input: unknown): RelationshipIntentId | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  const dashed = lower.replace(/_/g, "-");

  // Explicit legacy aliases that don't 1:1 map kebab-case conversion.
  const explicitAliases: Record<string, RelationshipIntentId> = {
    open: "figuring-out",
    "short-term": "something-casual",
    short_term: "something-casual",
    "not-sure": "figuring-out",
    not_sure: "figuring-out",
    long_term: "long-term",
    "long-term": "long-term",
    friends: "new-friends",
    // Keep canonical ids as-is.
    relationship: "relationship",
    "something-casual": "something-casual",
    "new-friends": "new-friends",
    "figuring-out": "figuring-out",
    "rather-not": "rather-not",
    rather_not: "rather-not",
  };

  // First try explicit alias mapping on both raw and dashed forms.
  const explicit = explicitAliases[lower] ?? explicitAliases[dashed];
  if (explicit) return explicit;

  // If it's already canonical, accept it (after underscore->dash conversion).
  if (INTENT_BY_ID[dashed]) return dashed as RelationshipIntentId;

  return null;
}

export function getRelationshipIntentDisplay(id: unknown): {
  id: RelationshipIntentId;
  label: string;
  emoji: string;
} | null {
  const canonical = normalizeRelationshipIntentId(id);
  if (!canonical) return null;
  const opt = INTENT_BY_ID[canonical];
  return opt ? { id: opt.id, label: opt.label, emoji: opt.emoji } : null;
}

export function getRelationshipIntentDisplaySafe(id: unknown): {
  id: RelationshipIntentId;
  label: string;
  emoji: string;
} {
  // Never leak raw internal ids to the user. Unknown values collapse to a safe generic label.
  return (
    getRelationshipIntentDisplay(id) ?? {
      id: "figuring-out",
      label: "Figuring it out",
      emoji: "🤷",
    }
  );
}

export function getRelationshipIntentAliases(canonicalId: RelationshipIntentId): string[] {
  // Used for backward-compatible admin filters/search during rollout.
  switch (canonicalId) {
    case "long-term":
      return ["long-term", "long_term"];
    case "something-casual":
      return ["something-casual", "short_term", "short-term"];
    case "new-friends":
      return ["new-friends", "friends"];
    case "figuring-out":
      return ["figuring-out", "not_sure", "not-sure", "open"];
    case "relationship":
      return ["relationship"];
    case "rather-not":
      return ["rather-not", "rather_not"];
    default:
      return [canonicalId];
  }
}

type BootstrapProfileInsertInput = {
  userId: AuthUserId;
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
    // Identity invariant: profiles.id must exactly match auth.users.id.
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
  userId: AuthUserId;
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

/**
 * Backward-compatible helper used by existing onboarding/ProfileStudio writers.
 * Returns a canonical relationship intent id (never returns legacy ids).
 */
export function normalizeRelationshipIntent(relationshipIntent: string): string {
  return normalizeRelationshipIntentId(relationshipIntent) ?? "figuring-out";
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
