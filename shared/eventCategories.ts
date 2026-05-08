export type EventCategory = {
  key: string;
  label: string;
  emoji: string;
  active?: boolean;
  sort_order?: number | null;
};

export const DEFAULT_EVENT_CATEGORIES: EventCategory[] = [
  { key: "music_nightlife", label: "Music & Nightlife", emoji: "🎵", sort_order: 10 },
  { key: "tech_startups", label: "Tech & Startups", emoji: "💻", sort_order: 20 },
  { key: "art_creative", label: "Art & Creative", emoji: "🎨", sort_order: 30 },
  { key: "gaming", label: "Gaming", emoji: "🎮", sort_order: 40 },
  { key: "food_drink", label: "Food & Drink", emoji: "🍷", sort_order: 50 },
  { key: "wellness_fitness", label: "Wellness & Fitness", emoji: "💪", sort_order: 60 },
  { key: "outdoor_adventure", label: "Outdoor & Adventure", emoji: "🌿", sort_order: 70 },
  { key: "travel", label: "Travel", emoji: "✈️", sort_order: 80 },
  { key: "books_film", label: "Books & Film", emoji: "📚", sort_order: 90 },
  { key: "social_mixer", label: "Social Mixer", emoji: "🦋", sort_order: 100 },
  { key: "dating", label: "Dating", emoji: "💕", sort_order: 110 },
  { key: "professional_networking", label: "Professional Networking", emoji: "🤝", sort_order: 120 },
];

export function slugifyEventCategoryLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
}

export function normalizeEventCategoryKey(key: string | null | undefined): string | null {
  const normalized = slugifyEventCategoryLabel(key ?? "");
  return normalized.length > 0 ? normalized : null;
}

const LEGACY_CATEGORY_ALIASES: Record<string, string> = {
  music: "music_nightlife",
  nightlife: "music_nightlife",
  techno: "music_nightlife",
  live_music: "music_nightlife",
  music_nightlife: "music_nightlife",

  tech: "tech_startups",
  technology: "tech_startups",
  startups: "tech_startups",
  founders: "tech_startups",
  networking: "professional_networking",
  young_professionals: "professional_networking",
  professional_networking: "professional_networking",

  art: "art_creative",
  artsy: "art_creative",
  creative: "art_creative",
  creatives: "art_creative",

  gaming: "gaming",
  games: "gaming",

  food: "food_drink",
  foodie: "food_drink",
  foodies: "food_drink",
  brunch: "food_drink",
  wine: "food_drink",
  drink: "food_drink",
  drinks: "food_drink",

  fitness: "wellness_fitness",
  wellness: "wellness_fitness",
  wellness_fitness: "wellness_fitness",

  outdoor: "outdoor_adventure",
  outdoors: "outdoor_adventure",
  outdoorsy: "outdoor_adventure",
  adventure: "outdoor_adventure",

  travel: "travel",
  traveler: "travel",
  travelers: "travel",

  books: "books_film",
  book: "books_film",
  bookworm: "books_film",
  film: "books_film",
  movies: "books_film",

  social: "social_mixer",
  social_mixer: "social_mixer",
  social_butterfly: "social_mixer",
  casual: "social_mixer",
  chill: "social_mixer",

  dating: "dating",
  speed_dating: "dating",
  speed_date: "dating",
};

export function inferEventCategoryKeysFromLegacyTags(tags: Array<string | null | undefined>): string[] {
  const keys = new Set<string>();
  for (const tag of tags) {
    const normalized = normalizeEventCategoryKey(tag);
    if (!normalized) continue;
    const mapped = LEGACY_CATEGORY_ALIASES[normalized] ?? normalized;
    if (DEFAULT_EVENT_CATEGORIES.some((category) => category.key === mapped)) {
      keys.add(mapped);
    }
  }
  return [...keys];
}

export function categoryDisplayText(category: Pick<EventCategory, "emoji" | "label">): string {
  return `${category.emoji} ${category.label}`.trim();
}
