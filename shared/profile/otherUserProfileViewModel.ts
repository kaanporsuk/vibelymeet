export type OtherUserPrompt = {
  question: string;
  answer: string;
};

export type OtherUserVibe = {
  id?: string;
  label: string;
  emoji?: string;
  category?: string;
};

export type OtherUserLifestyleDetail = {
  key: string;
  label: string;
  value: string;
};

export type OtherUserFullProfileSource = {
  id: string;
  updated_at?: string | null;
  name?: string | null;
  age?: number | null;
  birth_date?: string | null;
  zodiac?: string | null;
  tagline?: string | null;
  about_me?: string | null;
  bio?: string | null;
  looking_for?: string | null;
  relationship_intent?: string | null;
  location?: string | null;
  display_location?: string | null;
  distance_label?: string | null;
  job?: string | null;
  company?: string | null;
  height_cm?: number | null;
  lifestyle?: Record<string, unknown> | null;
  prompts?: unknown;
  photos?: unknown;
  avatar_url?: string | null;
  bunny_video_uid?: string | null;
  bunny_video_status?: string | null;
  vibe_caption?: string | null;
  photo_verified?: boolean | null;
  phone_verified?: boolean | null;
  email_verified?: boolean | null;
  vibe_score?: number | null;
  vibe_score_label?: string | null;
  is_premium?: boolean | null;
  events_attended?: number | null;
  vibes?: unknown;
  vibe_tags?: unknown;
};

export type OtherUserFullProfileViewModel = {
  id: string;
  updatedAt: string | null;
  name: string | null;
  age: number | null;
  tagline: string | null;
  aboutMe: string | null;
  lookingFor: string | null;
  relationshipIntent: string | null;
  location: string | null;
  distanceLabel: string | null;
  job: string | null;
  company: string | null;
  workLabel: string | null;
  heightCm: number | null;
  zodiac: string | null;
  lifestyleDetails: OtherUserLifestyleDetail[];
  prompts: OtherUserPrompt[];
  vibes: OtherUserVibe[];
  photos: string[];
  avatarUrl: string | null;
  vibeVideo: {
    uid: string | null;
    status: string | null;
    caption: string | null;
  };
  verification: {
    email: boolean;
    phone: boolean;
    photo: boolean;
  };
  vibeScore: number | null;
  vibeScoreLabel: string | null;
  isPremium: boolean;
  eventsAttended: number | null;
};

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const out = value.trim();
  return out.length > 0 ? out : null;
}

function cleanPhoto(value: unknown): string | null {
  const raw = cleanString(value);
  if (!raw) return null;
  let out = raw;
  while (
    out.length >= 2 &&
    ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'")))
  ) {
    out = out.slice(1, -1).trim();
  }
  return out.length > 0 ? out : null;
}

function photoDedupeKey(value: string): string {
  const withoutHash = value.split("#")[0] ?? value;
  const withoutQuery = withoutHash.split("?")[0] ?? withoutHash;
  return withoutQuery.toLowerCase();
}

export function normalizeOtherUserPrompts(raw: unknown): OtherUserPrompt[] {
  if (!Array.isArray(raw)) return [];
  const out: OtherUserPrompt[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const question =
      cleanString(row.question) ??
      cleanString(row.prompt) ??
      cleanString(row.title) ??
      cleanString(row.label);
    const answer =
      cleanString(row.answer) ??
      cleanString(row.response) ??
      cleanString(row.value) ??
      cleanString(row.text);

    if (question && answer) {
      out.push({ question, answer });
    }
  }

  return out;
}

export function dedupeOtherUserPhotos(photos: unknown, avatarUrl?: string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const candidates = [
    ...(Array.isArray(photos) ? photos : []),
    avatarUrl,
  ];

  for (const candidate of candidates) {
    const photo = cleanPhoto(candidate);
    if (!photo) continue;
    const key = photoDedupeKey(photo);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(photo);
  }

  return out;
}

function parseBirthDate(value: string | null | undefined): Date | null {
  const raw = cleanString(value);
  if (!raw) return null;
  const parts = raw.slice(0, 10).split("-");
  if (parts.length === 3) {
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (Number.isInteger(year) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month - 1, day);
      if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function calculateAgeFromBirthDate(birthDate: string | null | undefined, now = new Date()): number | null {
  const d = parseBirthDate(birthDate);
  if (!d) return null;
  let age = now.getFullYear() - d.getFullYear();
  const monthDiff = now.getMonth() - d.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < d.getDate())) {
    age -= 1;
  }
  return age >= 0 && age < 130 ? age : null;
}

export function getZodiacFromBirthDate(birthDate: string | null | undefined): string | null {
  const d = parseBirthDate(birthDate);
  if (!d) return null;
  const month = d.getMonth() + 1;
  const day = d.getDate();

  if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) return "Aries";
  if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) return "Taurus";
  if ((month === 5 && day >= 21) || (month === 6 && day <= 20)) return "Gemini";
  if ((month === 6 && day >= 21) || (month === 7 && day <= 22)) return "Cancer";
  if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) return "Leo";
  if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) return "Virgo";
  if ((month === 9 && day >= 23) || (month === 10 && day <= 22)) return "Libra";
  if ((month === 10 && day >= 23) || (month === 11 && day <= 21)) return "Scorpio";
  if ((month === 11 && day >= 22) || (month === 12 && day <= 21)) return "Sagittarius";
  if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) return "Capricorn";
  if ((month === 1 && day >= 20) || (month === 2 && day <= 18)) return "Aquarius";
  return "Pisces";
}

const LIFESTYLE_ALIASES = [
  { key: "smoking", label: "Smoking", aliases: ["smoking", "smoke"] },
  { key: "drinking", label: "Drinking", aliases: ["drinking", "alcohol"] },
  { key: "exercise", label: "Workout", aliases: ["exercise", "workout", "gym", "fitness"] },
  { key: "diet", label: "Diet", aliases: ["diet"] },
  { key: "pets", label: "Animals", aliases: ["pets", "animals"] },
  { key: "children", label: "Kids", aliases: ["children", "kids"] },
] as const;

const LIFESTYLE_VALUE_LABELS: Record<string, string> = {
  never: "Never",
  sometimes: "Sometimes",
  socially: "Socially",
  often: "Often",
  regularly: "Regularly",
  active: "Active",
  daily: "Daily",
  omnivore: "Omnivore",
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  halal: "Halal",
  kosher: "Kosher",
  other: "Other",
  none: "None",
  dog: "Dog",
  cat: "Cat",
  both: "Both",
  have: "Have kids",
  want: "Want someday",
  "dont-want": "Do not want",
  "not-sure": "Not sure",
  "no-preference": "No preference",
};

function humanizeValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const mapped = LIFESTYLE_VALUE_LABELS[trimmed.toLowerCase()];
  if (mapped) return mapped;
  return trimmed
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeLifestyleValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const labels = value
      .map((entry) => normalizeLifestyleValue(entry))
      .filter((entry): entry is string => !!entry);
    return labels.length > 0 ? labels.join(", ") : null;
  }

  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;

  const label = humanizeValue(value);
  return label || null;
}

export function getOtherUserLifestyleDetails(raw: Record<string, unknown> | null | undefined): OtherUserLifestyleDetail[] {
  if (!raw || typeof raw !== "object") return [];
  const out: OtherUserLifestyleDetail[] = [];

  for (const field of LIFESTYLE_ALIASES) {
    const alias = field.aliases.find((candidate) => normalizeLifestyleValue(raw[candidate]) != null);
    if (!alias) continue;
    const value = normalizeLifestyleValue(raw[alias]);
    if (!value) continue;
    out.push({ key: field.key, label: field.label, value });
  }

  return out;
}

export function normalizeOtherUserVibes(raw: unknown): OtherUserVibe[] {
  if (!Array.isArray(raw)) return [];
  const out: OtherUserVibe[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item === "string") {
      const label = cleanString(item);
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ label });
      continue;
    }

    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      const label = cleanString(row.label) ?? cleanString(row.name);
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: cleanString(row.id) ?? undefined,
        label,
        emoji: cleanString(row.emoji) ?? undefined,
        category: cleanString(row.category) ?? undefined,
      });
    }
  }

  return out;
}

function normalizeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeOtherUserFullProfile(
  source: OtherUserFullProfileSource,
  now = new Date(),
): OtherUserFullProfileViewModel {
  const computedAge = calculateAgeFromBirthDate(source.birth_date, now);
  const storedAge = normalizeNumber(source.age);
  const job = cleanString(source.job);
  const company = cleanString(source.company);
  const workLabel = job && company ? `${job} at ${company}` : job ?? company;
  const vibeTags = normalizeOtherUserVibes(source.vibe_tags);

  return {
    id: source.id,
    updatedAt: cleanString(source.updated_at),
    name: cleanString(source.name),
    age: computedAge ?? storedAge,
    tagline: cleanString(source.tagline),
    aboutMe: cleanString(source.about_me) ?? cleanString(source.bio),
    lookingFor: cleanString(source.looking_for),
    relationshipIntent: cleanString(source.relationship_intent),
    location: cleanString(source.display_location) ?? cleanString(source.location),
    distanceLabel: cleanString(source.distance_label),
    job,
    company,
    workLabel,
    heightCm: normalizeNumber(source.height_cm),
    zodiac: cleanString(source.zodiac) ?? getZodiacFromBirthDate(source.birth_date),
    lifestyleDetails: getOtherUserLifestyleDetails(source.lifestyle),
    prompts: normalizeOtherUserPrompts(source.prompts),
    vibes: vibeTags.length > 0 ? vibeTags : normalizeOtherUserVibes(source.vibes),
    photos: dedupeOtherUserPhotos(source.photos, source.avatar_url),
    avatarUrl: cleanString(source.avatar_url),
    vibeVideo: {
      uid: cleanString(source.bunny_video_uid),
      status: cleanString(source.bunny_video_status),
      caption: cleanString(source.vibe_caption),
    },
    verification: {
      email: source.email_verified === true,
      phone: source.phone_verified === true,
      photo: source.photo_verified === true,
    },
    vibeScore: normalizeNumber(source.vibe_score),
    vibeScoreLabel: cleanString(source.vibe_score_label),
    isPremium: source.is_premium === true,
    eventsAttended: normalizeNumber(source.events_attended),
  };
}
