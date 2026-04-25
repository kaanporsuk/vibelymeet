import { supabase } from '@/lib/supabase';
import { assertNoDirectProfileLocationWrites, normalizeRelationshipIntent } from '@shared/profileContracts';
import type { EventDiscoveryPrefs } from '@shared/eventDiscoveryContracts';
import { parseEventDiscoveryPrefs, serializeEventDiscoveryPrefs } from '@shared/eventDiscoveryContracts';

export type ProfileRow = {
  id: string;
  name: string | null;
  birth_date: string | null;
  age: number | null;
  gender: string | null;
  interested_in: string[] | null;
  tagline: string | null;
  height_cm: number | null;
  location: string | null;
  location_data: { lat: number; lng: number } | null;
  job: string | null;
  about_me: string | null;
  /** @deprecated Prefer relationship_intent for new reads */
  looking_for: string | null;
  relationship_intent: string | null;
  onboarding_complete: boolean | null;
  photos: string[] | null;
  avatar_url: string | null;
  bunny_video_uid: string | null;
  bunny_video_status: string | null;
  events_attended?: number | null;
  total_matches: number | null;
  total_conversations: number | null;
  // Phase 3B: parity with web profile
  prompts: { question: string; answer: string }[] | null;
  vibes: string[];
  lifestyle: Record<string, string> | null;
  vibe_caption: string | null;
  photo_verified: boolean | null;
  phone_number: string | null;
  phone_verified: boolean | null;
  email_verified: boolean | null;
  verified_email: string | null;
  is_premium: boolean | null;
  premium_until: string | null;
  /** Server-computed profile completeness (0–100). */
  vibe_score?: number | null;
  vibe_score_label?: string | null;
  preferred_age_min?: number | null;
  preferred_age_max?: number | null;
  event_discovery_prefs?: EventDiscoveryPrefs | null;
};

/** Zodiac sign from birth date (web parity). */
export function getZodiacSign(birthDate: Date): string {
  const month = birthDate.getMonth() + 1;
  const day = birthDate.getDate();
  if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) return 'Aries';
  if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) return 'Taurus';
  if ((month === 5 && day >= 21) || (month === 6 && day <= 20)) return 'Gemini';
  if ((month === 6 && day >= 21) || (month === 7 && day <= 22)) return 'Cancer';
  if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) return 'Leo';
  if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) return 'Virgo';
  if ((month === 9 && day >= 23) || (month === 10 && day <= 22)) return 'Libra';
  if ((month === 10 && day >= 23) || (month === 11 && day <= 21)) return 'Scorpio';
  if ((month === 11 && day >= 22) || (month === 12 && day <= 21)) return 'Sagittarius';
  if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) return 'Capricorn';
  if ((month === 1 && day >= 20) || (month === 2 && day <= 18)) return 'Aquarius';
  return 'Pisces';
}

/** Zodiac emoji for display (web parity). */
export const ZODIAC_EMOJI: Record<string, string> = {
  Aries: '♈', Taurus: '♉', Gemini: '♊', Cancer: '♋', Leo: '♌', Virgo: '♍',
  Libra: '♎', Scorpio: '♏', Sagittarius: '♐', Capricorn: '♑', Aquarius: '♒', Pisces: '♓',
};
export function getZodiacEmoji(sign: string): string {
  return ZODIAC_EMOJI[sign] ?? '⭐';
}

function parseBirthDate(dateStr: string): Date {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (Number.isInteger(year) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(year, month - 1, day);
    }
  }
  return new Date(dateStr);
}

/** US-style M/D/YYYY + zodiac name — web Profile.tsx Basics. */
export function formatBirthdayUsWithZodiac(birth_date: string | null | undefined): string {
  if (!birth_date) return 'Not set';
  const d = parseBirthDate(birth_date);
  if (Number.isNaN(d.getTime())) return 'Not set';
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const y = d.getFullYear();
  const sign = getZodiacSign(d);
  return `${m}/${day}/${y} (${sign})`;
}

function calculateAge(birthDate: Date): number {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  return age;
}

/** Live stats — mirrors web `src/services/profileService.ts` fetchMyProfile counts. */
export async function fetchProfileLiveCounts(userId: string): Promise<{
  events: number;
  matches: number;
  convos: number;
}> {
  const [eventsCountRes, matchesCountRes, convosCountRes] = await Promise.all([
    supabase
      .from('event_registrations')
      .select('*', { count: 'exact', head: true })
      .eq('profile_id', userId),
    supabase
      .from('matches')
      .select('*', { count: 'exact', head: true })
      .or(`profile_id_1.eq.${userId},profile_id_2.eq.${userId}`),
    supabase
      .from('matches')
      .select('*', { count: 'exact', head: true })
      .or(`profile_id_1.eq.${userId},profile_id_2.eq.${userId}`)
      .not('last_message_at', 'is', null),
  ]);

  if (eventsCountRes.error && __DEV__) {
    console.warn('[profileApi] events count:', eventsCountRes.error.message);
  }
  if (matchesCountRes.error && __DEV__) {
    console.warn('[profileApi] matches count:', matchesCountRes.error.message);
  }
  if (convosCountRes.error && __DEV__) {
    console.warn('[profileApi] convos count:', convosCountRes.error.message);
  }

  return {
    events: eventsCountRes.error ? 0 : (eventsCountRes.count ?? 0),
    matches: matchesCountRes.error ? 0 : (matchesCountRes.count ?? 0),
    convos: convosCountRes.error ? 0 : (convosCountRes.count ?? 0),
  };
}

/** Full profile row for PostgREST. */
const PROFILE_SELECT_WITH_VIBE =
  'id, name, birth_date, age, gender, interested_in, tagline, height_cm, location, location_data, job, about_me, looking_for, relationship_intent, onboarding_complete, photos, avatar_url, bunny_video_uid, bunny_video_status, total_matches, total_conversations, lifestyle, prompts, vibe_caption, photo_verified, phone_number, phone_verified, email_verified, verified_email, is_premium, premium_until, vibe_score, vibe_score_label, preferred_age_min, preferred_age_max, event_discovery_prefs';

/**
 * Minimal `profiles` projection when the first select fails (missing vibe columns, discovery
 * columns, or stale schema cache). Must not reference columns that may not exist yet — retrying
 * with the same missing fields would always fail and break `fetchMyProfile`.
 */
const PROFILE_SELECT_BASE =
  'id, name, birth_date, age, gender, interested_in, tagline, height_cm, location, location_data, job, about_me, looking_for, relationship_intent, onboarding_complete, photos, avatar_url, bunny_video_uid, bunny_video_status, total_matches, total_conversations, lifestyle, prompts, vibe_caption, photo_verified, phone_number, phone_verified, email_verified, verified_email, is_premium, premium_until';

export async function fetchMyProfile(): Promise<ProfileRow | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const uid = user.id;
    let profileRes = await supabase
      .from('profiles')
      .select(PROFILE_SELECT_WITH_VIBE)
      .eq('id', uid)
      .maybeSingle();
    const vibeColMissing =
      profileRes.error &&
      /vibe_score|vibe_score_label|preferred_age|event_discovery_prefs|column .* does not exist|schema cache/i.test(
        profileRes.error.message ?? ''
      );
    if (vibeColMissing) {
      profileRes = await supabase
        .from('profiles')
        .select(PROFILE_SELECT_BASE)
        .eq('id', uid)
        .maybeSingle();
    }

    const [vibesRes, counts] = await Promise.all([
      supabase
        .from('profile_vibes')
        .select('vibe_tags(label)')
        .eq('profile_id', uid),
      fetchProfileLiveCounts(uid),
    ]);

    if (profileRes.error) {
      if (__DEV__) console.warn('[profileApi] profiles row:', profileRes.error.message);
      return null;
    }
    const row = profileRes.data as Record<string, unknown> | null;
    if (!row) return null;
    if (vibesRes.error) {
      if (__DEV__) console.warn('[profileApi] failed to load vibes:', vibesRes.error.message);
    }

    type VibeRow = { vibe_tags: { label: string } | { label: string }[] | null };
    const vibeRows: VibeRow[] = (vibesRes.data as VibeRow[] | null) ?? [];
    const vibes: string[] = vibeRows
      .flatMap((v) => {
        const vt = v.vibe_tags;
        if (!vt) return [];
        if (Array.isArray(vt)) {
          return vt.map((tag) => tag.label).filter(Boolean) as string[];
        }
        return [vt.label].filter(Boolean) as string[];
      });

    const vibeScore = (row.vibe_score as number | null | undefined) ?? 0;
    const vibeScoreLabel = (row.vibe_score_label as string | null | undefined) ?? 'New';

    return {
      ...row,
      relationship_intent: (row.relationship_intent as string | null) ?? null,
      location_data: (row.location_data as { lat: number; lng: number } | null) ?? null,
      onboarding_complete: (row.onboarding_complete as boolean | null) ?? null,
      events_attended: counts.events,
      total_matches: counts.matches,
      total_conversations: counts.convos,
      prompts: (row.prompts as ProfileRow['prompts']) ?? null,
      vibes,
      lifestyle: (row.lifestyle as ProfileRow['lifestyle']) ?? null,
      vibe_caption: (row.vibe_caption as string) ?? null,
      photo_verified: (row.photo_verified as boolean | null) ?? null,
      phone_number: (row.phone_number as string | null) ?? null,
      phone_verified: (row.phone_verified as boolean | null) ?? null,
      email_verified: ((row as Record<string, unknown>).email_verified as boolean | null) ?? null,
      verified_email: ((row as Record<string, unknown>).verified_email as string | null) ?? null,
      is_premium: (row.is_premium as boolean | null) ?? null,
      premium_until: (row.premium_until as string) ?? null,
      vibe_score: vibeScore,
      vibe_score_label: vibeScoreLabel,
      preferred_age_min: (row.preferred_age_min as number | null | undefined) ?? null,
      preferred_age_max: (row.preferred_age_max as number | null | undefined) ?? null,
      event_discovery_prefs: parseEventDiscoveryPrefs(row.event_discovery_prefs),
    } as ProfileRow;
  } catch (e) {
    if (__DEV__) console.warn('[profileApi] fetchMyProfile failed:', e);
    return null;
  }
}

/** Generic profile patch fields — excludes location columns (use `update_profile_location` RPC). */
export type NativeProfileUpdatePayload = Partial<{
  name: string;
  gender: string;
  interested_in: string[];
  tagline: string;
  job: string;
  company: string;
  about_me: string;
  relationship_intent: string;
  looking_for: string;
  photos: string[];
  avatar_url: string | null;
  prompts: { question: string; answer: string }[] | null;
  lifestyle: Record<string, string> | null;
  vibe_caption: string | null;
  birth_date: string | null;
  height_cm: number | null;
  /** Vibe tag labels — persisted via `profile_vibes` + `vibe_tags` (not a column on `profiles`). */
  vibes: string[];
  preferred_age_min: number | null;
  preferred_age_max: number | null;
  event_discovery_prefs: EventDiscoveryPrefs;
}>;

export async function updateMyProfile(updates: NativeProfileUpdatePayload): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  assertNoDirectProfileLocationWrites(updates as Record<string, unknown>);
  const db: Record<string, unknown> = {};
  if (updates.name !== undefined) db.name = updates.name;
  if (updates.gender !== undefined) db.gender = updates.gender;
  if (updates.interested_in !== undefined) db.interested_in = updates.interested_in;
  if (updates.tagline !== undefined) db.tagline = updates.tagline;
  if (updates.job !== undefined) db.job = updates.job;
  if (updates.company !== undefined) db.company = updates.company;
  if (updates.about_me !== undefined) db.about_me = updates.about_me;
  if (updates.relationship_intent !== undefined || updates.looking_for !== undefined) {
    const rawIntent = updates.relationship_intent ?? updates.looking_for ?? null;
    const normalizedIntent =
      typeof rawIntent === 'string' && rawIntent.trim().length > 0
        ? normalizeRelationshipIntent(rawIntent)
        : null;
    db.relationship_intent = normalizedIntent;
    // Compatibility mirror until all reads migrate to relationship_intent.
    db.looking_for = normalizedIntent;
  }
  if (updates.photos !== undefined) db.photos = updates.photos;
  if (updates.avatar_url !== undefined) db.avatar_url = updates.avatar_url;
  if (updates.prompts !== undefined) db.prompts = updates.prompts;
  if (updates.lifestyle !== undefined) db.lifestyle = updates.lifestyle;
  if (updates.vibe_caption !== undefined) db.vibe_caption = updates.vibe_caption;
  if (updates.birth_date !== undefined) {
    db.birth_date = updates.birth_date;
    if (updates.birth_date) {
      db.age = calculateAge(parseBirthDate(updates.birth_date));
    }
  }
  if (updates.height_cm !== undefined) db.height_cm = updates.height_cm;
  if (updates.preferred_age_min !== undefined) db.preferred_age_min = updates.preferred_age_min;
  if (updates.preferred_age_max !== undefined) db.preferred_age_max = updates.preferred_age_max;
  if (updates.event_discovery_prefs !== undefined) {
    db.event_discovery_prefs = serializeEventDiscoveryPrefs(updates.event_discovery_prefs);
  }
  if (Object.keys(db).length > 0) {
    const { error } = await supabase.from('profiles').update(db).eq('id', user.id);
    if (error) throw error;
  }
  if (updates.vibes !== undefined) {
    await syncProfileVibes(user.id, updates.vibes);
  }
}

/** Sync `profile_vibes` junction from vibe tag labels — same as web `profileService.syncProfileVibes`. */
export async function syncProfileVibes(profileId: string, vibeLabels: string[]): Promise<void> {
  const { error: deleteError } = await supabase.from('profile_vibes').delete().eq('profile_id', profileId);
  if (deleteError) throw deleteError;
  if (vibeLabels.length === 0) return;

  const { data: vibeTags, error: fetchError } = await supabase
    .from('vibe_tags')
    .select('id, label')
    .in('label', vibeLabels);

  if (fetchError) throw fetchError;
  if (!vibeTags?.length) return;

  const inserts = vibeTags.map((tag) => ({
    profile_id: profileId,
    vibe_tag_id: tag.id,
  }));

  const { error: insertError } = await supabase.from('profile_vibes').insert(inserts);
  if (insertError) throw insertError;
}
