/**
 * Canonical fetch for viewing ANY user's profile (self or other).
 * Every surface that displays a full or partial profile to any viewer
 * MUST use this function so all sections have data available.
 *
 * Returns null if user not found.
 */
import type { ProfileRow } from '@/lib/profileApi';
import { supabase } from '@/lib/supabase';

/**
 * All columns needed to render a complete profile view.
 * Matches the superset of what Profile Preview renders.
 */
const USER_PROFILE_SELECT_WITH_VIBE = [
  'id',
  'name',
  'age',
  'birth_date',
  'gender',
  'tagline',
  'location',
  'job',
  'height_cm',
  'about_me',
  'looking_for',
  'relationship_intent',
  'photos',
  'avatar_url',
  'bunny_video_uid',
  'bunny_video_status',
  'vibe_caption',
  'lifestyle',
  'prompts',
  'photo_verified',
  'phone_verified',
  'email_verified',
  'vibe_score',
  'vibe_score_label',
  'is_premium',
].join(', ');

/** Same select without score columns when schema lags migration (parity with profileApi). */
const USER_PROFILE_SELECT_BASE = [
  'id',
  'name',
  'age',
  'birth_date',
  'gender',
  'tagline',
  'location',
  'job',
  'height_cm',
  'about_me',
  'looking_for',
  'relationship_intent',
  'photos',
  'avatar_url',
  'bunny_video_uid',
  'bunny_video_status',
  'vibe_caption',
  'lifestyle',
  'prompts',
  'photo_verified',
  'phone_verified',
  'email_verified',
  'is_premium',
].join(', ');

export type UserProfileView = {
  id: string;
  name: string | null;
  age: number | null;
  birth_date: string | null;
  gender: string | null;
  tagline: string | null;
  location: string | null;
  job: string | null;
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
  phone_verified: boolean | null;
  email_verified: boolean | null;
  vibe_score: number | null;
  vibe_score_label: string | null;
  is_premium: boolean | null;
  vibes: string[];
};

function flattenVibeLabels(vibeRows: unknown): string[] {
  type VibeRow = { vibe_tags: { label?: string } | { label?: string }[] | null };
  const rows: VibeRow[] = (vibeRows as VibeRow[] | null) ?? [];
  return rows
    .flatMap((v) => {
      const vt = v.vibe_tags;
      if (!vt) return [];
      if (Array.isArray(vt)) {
        return vt.map((t) => t?.label).filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
      }
      const label = (vt as { label?: string }).label;
      return typeof label === 'string' && label.trim().length > 0 ? [label] : [];
    });
}

function normalizePrompts(raw: unknown): Array<{ question: string; answer: string }> | null {
  if (!raw || !Array.isArray(raw)) return null;
  const out: Array<{ question: string; answer: string }> = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const q = (p as { question?: unknown }).question;
    const a = (p as { answer?: unknown }).answer;
    out.push({
      question: typeof q === 'string' ? q : '',
      answer: typeof a === 'string' ? a : '',
    });
  }
  return out.length > 0 ? out : null;
}

export async function fetchUserProfile(userId: string): Promise<UserProfileView | null> {
  let profileRes = await supabase
    .from('profiles')
    .select(USER_PROFILE_SELECT_WITH_VIBE)
    .eq('id', userId)
    .maybeSingle();

  const vibeColMissing =
    profileRes.error &&
    /vibe_score|vibe_score_label|column .* does not exist|schema cache/i.test(profileRes.error.message ?? '');
  if (vibeColMissing) {
    profileRes = await supabase
      .from('profiles')
      .select(USER_PROFILE_SELECT_BASE)
      .eq('id', userId)
      .maybeSingle();
  }

  if (profileRes.error) {
    if (__DEV__) console.warn('[fetchUserProfile] profiles row:', profileRes.error.message);
    return null;
  }

  const row = profileRes.data as Record<string, unknown> | null;
  if (!row || typeof row.id !== 'string') return null;

  const { data: vibeRows, error: vibesError } = await supabase
    .from('profile_vibes')
    .select('vibe_tags(label)')
    .eq('profile_id', userId);

  if (vibesError && __DEV__) {
    console.warn('[fetchUserProfile] failed to load vibes:', vibesError.message);
  }

  const vibes = flattenVibeLabels(vibeRows);

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

  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : row.name === null ? null : null,
    age: typeof row.age === 'number' ? row.age : row.age === null ? null : null,
    birth_date: typeof row.birth_date === 'string' ? row.birth_date : row.birth_date === null ? null : null,
    gender: typeof row.gender === 'string' ? row.gender : row.gender === null ? null : null,
    tagline: typeof row.tagline === 'string' ? row.tagline : row.tagline === null ? null : null,
    location: typeof row.location === 'string' ? row.location : row.location === null ? null : null,
    job: typeof row.job === 'string' ? row.job : row.job === null ? null : null,
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
    phone_verified: typeof row.phone_verified === 'boolean' ? row.phone_verified : row.phone_verified === null ? null : null,
    email_verified: typeof row.email_verified === 'boolean' ? row.email_verified : row.email_verified === null ? null : null,
    vibe_score: vibeScore,
    vibe_score_label: vibeScoreLabel,
    is_premium: typeof row.is_premium === 'boolean' ? row.is_premium : row.is_premium === null ? null : null,
    vibes,
  };
}

/** Map `fetchMyProfile` row → `UserProfileView` (extra ProfileRow fields ignored at runtime). */
export function profileRowToUserProfileView(row: ProfileRow): UserProfileView {
  return {
    ...row,
    vibe_score: row.vibe_score ?? null,
    vibe_score_label: row.vibe_score_label ?? null,
    vibes: row.vibes ?? [],
  } as UserProfileView;
}
