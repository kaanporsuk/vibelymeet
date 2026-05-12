/**
 * Canonical fetch for viewing ANY user's profile (self or other).
 * Every surface that displays a full or partial profile to any viewer
 * MUST use this function so all sections have data available.
 *
 * Returns null if user not found.
 */
import type { ProfileRow } from '@/lib/profileApi';
import { supabase } from '@/lib/supabase';

export type UserProfileView = {
  id: string;
  updated_at: string | null;
  name: string | null;
  age: number | null;
  birth_date: string | null;
  gender: string | null;
  tagline: string | null;
  location: string | null;
  display_location: string | null;
  distance_label: string | null;
  job: string | null;
  company: string | null;
  height_cm: number | null;
  about_me: string | null;
  /** @deprecated Compatibility-only fallback. Prefer relationship_intent. */
  looking_for: string | null;
  relationship_intent: string | null;
  photos: string[] | null;
  avatar_url: string | null;
  bunny_video_uid: string | null;
  bunny_video_status: string | null;
  vibe_caption: string | null;
  lifestyle: Record<string, string> | null;
  prompts: Array<{ question: string; answer: string }> | null;
  photo_verified: boolean | null;
  email_verified: boolean | null;
  phone_verified: boolean | null;
  vibe_score: number | null;
  vibe_score_label: string | null;
  is_premium: boolean | null;
  events_attended: number | null;
  vibes: string[];
  vibe_tags: Array<{ id?: string; label: string; emoji?: string; category?: string }>;
};

function normalizePrompts(raw: unknown): Array<{ question: string; answer: string }> | null {
  if (!raw || !Array.isArray(raw)) return null;
  const out: Array<{ question: string; answer: string }> = [];
  const pickString = (value: unknown) => (typeof value === 'string' ? value : '');
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const row = p as Record<string, unknown>;
    const q = pickString(row.question) || pickString(row.prompt) || pickString(row.title) || pickString(row.label);
    const a = pickString(row.answer) || pickString(row.response) || pickString(row.value) || pickString(row.text);
    out.push({
      question: q,
      answer: a,
    });
  }
  return out.length > 0 ? out : null;
}

function normalizeVibeTags(raw: unknown): UserProfileView['vibe_tags'] {
  if (!Array.isArray(raw)) return [];
  const out: UserProfileView['vibe_tags'] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: typeof row.id === 'string' && row.id.trim() ? row.id.trim() : undefined,
      label,
      emoji: typeof row.emoji === 'string' && row.emoji.trim() ? row.emoji.trim() : undefined,
      category: typeof row.category === 'string' && row.category.trim() ? row.category.trim() : undefined,
    });
  }

  return out;
}

export async function fetchUserProfile(profileId: string): Promise<UserProfileView | null> {
  const { data, error } = await supabase.rpc('get_profile_for_viewer', {
    p_target_id: profileId,
  });

  if (error) {
    if (__DEV__) console.warn('[fetchUserProfile] get_profile_for_viewer:', error.message);
    return null;
  }

  const row = data as Record<string, unknown> | null;
  if (!row || typeof row.id !== 'string') return null;

  const photosRaw = row.photos;
  const photos = Array.isArray(photosRaw)
    ? photosRaw.filter((p): p is string => typeof p === 'string')
    : null;

  const vibeScore =
    row.vibe_score === null || row.vibe_score === undefined
      ? null
      : typeof row.vibe_score === 'number'
        ? row.vibe_score
        : null;
  const vibeScoreLabel = typeof row.vibe_score_label === 'string' ? row.vibe_score_label : null;
  const vibes = Array.isArray(row.vibes)
    ? row.vibes.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : [];
  const vibeTags = normalizeVibeTags(row.vibe_tags);

  return {
    id: row.id,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
    name: typeof row.name === 'string' ? row.name : row.name === null ? null : null,
    age: typeof row.age === 'number' ? row.age : row.age === null ? null : null,
    birth_date: typeof row.birth_date === 'string' ? row.birth_date : row.birth_date === null ? null : null,
    gender: typeof row.gender === 'string' ? row.gender : row.gender === null ? null : null,
    tagline: typeof row.tagline === 'string' ? row.tagline : row.tagline === null ? null : null,
    location: typeof row.location === 'string' ? row.location : row.location === null ? null : null,
    display_location:
      typeof row.display_location === 'string'
        ? row.display_location
        : typeof row.location === 'string'
          ? row.location
          : null,
    distance_label: typeof row.distance_label === 'string' ? row.distance_label : null,
    job: typeof row.job === 'string' ? row.job : row.job === null ? null : null,
    company: typeof row.company === 'string' ? row.company : row.company === null ? null : null,
    height_cm: typeof row.height_cm === 'number' ? row.height_cm : row.height_cm === null ? null : null,
    about_me: typeof row.about_me === 'string' ? row.about_me : row.about_me === null ? null : null,
    looking_for: typeof row.looking_for === 'string' ? row.looking_for : row.looking_for === null ? null : null,
    relationship_intent:
      typeof row.relationship_intent === 'string'
        ? row.relationship_intent
        : row.relationship_intent === null
          ? null
          : null,
    photos,
    avatar_url: typeof row.avatar_url === 'string' ? row.avatar_url : row.avatar_url === null ? null : null,
    bunny_video_uid:
      typeof row.bunny_video_uid === 'string' ? row.bunny_video_uid : row.bunny_video_uid === null ? null : null,
    bunny_video_status:
      typeof row.bunny_video_status === 'string'
        ? row.bunny_video_status
        : row.bunny_video_status === null
          ? null
          : null,
    vibe_caption: typeof row.vibe_caption === 'string' ? row.vibe_caption : row.vibe_caption === null ? null : null,
    lifestyle:
      row.lifestyle && typeof row.lifestyle === 'object' && !Array.isArray(row.lifestyle)
        ? (row.lifestyle as Record<string, string>)
        : row.lifestyle === null
          ? null
          : null,
    prompts: normalizePrompts(row.prompts),
    photo_verified: typeof row.photo_verified === 'boolean' ? row.photo_verified : row.photo_verified === null ? null : null,
    email_verified:
      typeof row.email_verified === 'boolean' ? row.email_verified : row.email_verified === null ? null : null,
    phone_verified:
      typeof row.phone_verified === 'boolean' ? row.phone_verified : row.phone_verified === null ? null : null,
    vibe_score: vibeScore,
    vibe_score_label: vibeScoreLabel,
    is_premium: typeof row.is_premium === 'boolean' ? row.is_premium : row.is_premium === null ? null : null,
    events_attended: typeof row.events_attended === 'number' ? row.events_attended : null,
    vibes,
    vibe_tags: vibeTags,
  };
}

/** Map `fetchMyProfile` row → `UserProfileView` (extra ProfileRow fields ignored at runtime). */
export function profileRowToUserProfileView(row: ProfileRow): UserProfileView {
  return {
    ...row,
    display_location: row.location,
    distance_label: null,
    vibe_score: row.vibe_score ?? null,
    vibe_score_label: row.vibe_score_label ?? null,
    vibes: row.vibes ?? [],
    vibe_tags: [],
  } as UserProfileView;
}
