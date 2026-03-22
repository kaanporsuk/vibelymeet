/**
 * Single source of truth for vibe tags — aligned with web `src/components/VibeTagSelector.tsx`
 * fallback list + `vibe_tags.category` in Supabase.
 *
 * Profile Studio / web profile-edit: only Energy + Social Style (no Shared Scenes).
 * Onboarding: all categories.
 */

export type VibeCategoryKey = 'energy' | 'social_style' | 'shared_scenes';

export type VibeTaxonomyOption = {
  label: string;
  emoji: string;
  category: VibeCategoryKey;
};

export type VibeTaxonomyCategory = {
  key: VibeCategoryKey;
  title: string;
  subtitle: string;
  options: VibeTaxonomyOption[];
};

/** Full taxonomy (web `fallbackVibes` order within each category). */
export const VIBE_TAXONOMY: VibeTaxonomyCategory[] = [
  {
    key: 'energy',
    title: 'Energy',
    subtitle: 'How you feel in interaction',
    options: [
      { label: 'Playful', emoji: '😄', category: 'energy' },
      { label: 'Deep Talker', emoji: '💬', category: 'energy' },
      { label: 'Witty', emoji: '⚡', category: 'energy' },
      { label: 'Warm', emoji: '🤗', category: 'energy' },
      { label: 'Bold', emoji: '🔥', category: 'energy' },
      { label: 'Calm', emoji: '🌊', category: 'energy' },
      { label: 'Flirty', emoji: '😏', category: 'energy' },
      { label: 'Curious', emoji: '🔍', category: 'energy' },
    ],
  },
  {
    key: 'social_style',
    title: 'Social Style',
    subtitle: 'How you connect',
    options: [
      { label: 'Spontaneous', emoji: '🎲', category: 'social_style' },
      { label: 'Planner', emoji: '📅', category: 'social_style' },
      { label: 'One-on-One', emoji: '🫂', category: 'social_style' },
      { label: 'Social Butterfly', emoji: '🦋', category: 'social_style' },
      { label: 'Night Owl', emoji: '🦉', category: 'social_style' },
      { label: 'Slow Burner', emoji: '🕯️', category: 'social_style' },
      { label: 'Voice-Note Person', emoji: '🎙️', category: 'social_style' },
      { label: 'Comfortable on Video', emoji: '📹', category: 'social_style' },
    ],
  },
  {
    key: 'shared_scenes',
    title: 'Shared Scenes',
    subtitle: 'What you enjoy doing',
    options: [
      { label: 'Live Music', emoji: '🎵', category: 'shared_scenes' },
      { label: 'Foodie', emoji: '🍜', category: 'shared_scenes' },
      { label: 'Artsy', emoji: '🎨', category: 'shared_scenes' },
      { label: 'Outdoorsy', emoji: '🌿', category: 'shared_scenes' },
      { label: 'Fitness', emoji: '💪', category: 'shared_scenes' },
      { label: 'Bookworm', emoji: '📚', category: 'shared_scenes' },
      { label: 'Film Buff', emoji: '🎬', category: 'shared_scenes' },
      { label: 'Traveler', emoji: '✈️', category: 'shared_scenes' },
    ],
  },
];

/** Profile Studio / web profile-edit drawer: Energy + Social Style only. */
export const PROFILE_VIBE_CATEGORY_KEYS: VibeCategoryKey[] = ['energy', 'social_style'];

export const PROFILE_VIBE_CATEGORIES: VibeTaxonomyCategory[] = VIBE_TAXONOMY.filter((c) =>
  PROFILE_VIBE_CATEGORY_KEYS.includes(c.key)
);

export const ALL_VIBE_LABELS: string[] = VIBE_TAXONOMY.flatMap((c) => c.options.map((o) => o.label));

export const PROFILE_VIBE_LABELS: string[] = PROFILE_VIBE_CATEGORIES.flatMap((c) =>
  c.options.map((o) => o.label)
);

export function getEmojiForVibeLabel(label: string): string | undefined {
  for (const cat of VIBE_TAXONOMY) {
    const found = cat.options.find((o) => o.label === label);
    if (found) return found.emoji;
  }
  return undefined;
}
