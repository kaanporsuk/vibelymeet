import { supabase } from '@/lib/supabase';

export type OnboardingStage =
  | 'none'
  | 'auth_complete'
  | 'identity'
  | 'details'
  | 'media'
  | 'complete';

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
  job: string | null;
  about_me: string | null;
  /** @deprecated Prefer relationship_intent for new reads */
  looking_for: string | null;
  relationship_intent: string | null;
  onboarding_complete: boolean | null;
  onboarding_stage: OnboardingStage | null;
  photos: string[] | null;
  avatar_url: string | null;
  bunny_video_uid: string | null;
  bunny_video_status: string | null;
  events_attended: number | null;
  total_matches: number | null;
  total_conversations: number | null;
  // Phase 3B: parity with web profile
  prompts: { question: string; answer: string }[] | null;
  vibes: string[];
  lifestyle: Record<string, string> | null;
  vibe_caption: string | null;
  photo_verified: boolean | null;
  phone_verified: boolean | null;
  email_verified: boolean | null;
  is_premium: boolean | null;
  premium_until: string | null;
  /** Server-computed profile completeness (0–100). */
  vibe_score?: number | null;
  vibe_score_label?: string | null;
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

/** Full profile row for PostgREST; vibe columns omitted on retry if schema lags migration. */
const PROFILE_SELECT_WITH_VIBE =
  'id, name, birth_date, age, gender, interested_in, tagline, height_cm, location, job, about_me, looking_for, relationship_intent, onboarding_complete, onboarding_stage, photos, avatar_url, bunny_video_uid, bunny_video_status, events_attended, total_matches, total_conversations, lifestyle, prompts, vibe_caption, photo_verified, phone_verified, email_verified, is_premium, premium_until, vibe_score, vibe_score_label';

const PROFILE_SELECT_BASE =
  'id, name, birth_date, age, gender, interested_in, tagline, height_cm, location, job, about_me, looking_for, relationship_intent, onboarding_complete, onboarding_stage, photos, avatar_url, bunny_video_uid, bunny_video_status, events_attended, total_matches, total_conversations, lifestyle, prompts, vibe_caption, photo_verified, phone_verified, email_verified, is_premium, premium_until';

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
      /vibe_score|vibe_score_label|column .* does not exist|schema cache/i.test(
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
      onboarding_complete: (row.onboarding_complete as boolean | null) ?? null,
      onboarding_stage: (row.onboarding_stage as OnboardingStage | null) ?? null,
      events_attended: counts.events,
      total_matches: counts.matches,
      total_conversations: counts.convos,
      prompts: (row.prompts as ProfileRow['prompts']) ?? null,
      vibes,
      lifestyle: (row.lifestyle as ProfileRow['lifestyle']) ?? null,
      vibe_caption: (row.vibe_caption as string) ?? null,
      photo_verified: (row.photo_verified as boolean | null) ?? null,
      phone_verified: (row.phone_verified as boolean | null) ?? null,
      email_verified: ((row as Record<string, unknown>).email_verified as boolean | null) ?? null,
      is_premium: (row.is_premium as boolean | null) ?? null,
      premium_until: (row.premium_until as string) ?? null,
      vibe_score: vibeScore,
      vibe_score_label: vibeScoreLabel,
    } as ProfileRow;
  } catch (e) {
    if (__DEV__) console.warn('[profileApi] fetchMyProfile failed:', e);
    return null;
  }
}

export async function updateMyProfile(updates: Partial<{
  name: string;
  gender: string;
  interested_in: string[];
  tagline: string;
  location: string;
  job: string;
  company: string;
  about_me: string;
  looking_for: string;
  photos: string[];
  avatar_url: string | null;
  prompts: { question: string; answer: string }[] | null;
  lifestyle: Record<string, string> | null;
  vibe_caption: string | null;
  birth_date: string | null;
  height_cm: number | null;
  location_data: { lat: number; lng: number } | null;
  /** Vibe tag labels — persisted via `profile_vibes` + `vibe_tags` (not a column on `profiles`). */
  vibes: string[];
}>): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const db: Record<string, unknown> = {};
  if (updates.name !== undefined) db.name = updates.name;
  if (updates.gender !== undefined) db.gender = updates.gender;
  if (updates.interested_in !== undefined) db.interested_in = updates.interested_in;
  if (updates.tagline !== undefined) db.tagline = updates.tagline;
  if (updates.location !== undefined) db.location = updates.location;
  if (updates.job !== undefined) db.job = updates.job;
  if (updates.company !== undefined) db.company = updates.company;
  if (updates.about_me !== undefined) db.about_me = updates.about_me;
  if (updates.looking_for !== undefined) {
    db.looking_for = updates.looking_for;
    db.relationship_intent = updates.looking_for;
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
  if (updates.location_data !== undefined) db.location_data = updates.location_data;
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

/** Create/upsert profile during onboarding. Same contract as web createProfile. */
function formatLocationFromCityCountry(city?: string | null, country?: string | null): string | null {
  const c = (city ?? '').trim();
  const co = (country ?? '').trim();
  if (c && co) return `${c}, ${co}`;
  if (c) return c;
  if (co) return co;
  return null;
}

/** Onboarding intent keys → profiles.looking_for (web RelationshipIntent ids). */
const RELATIONSHIP_INTENT_TO_LOOKING_FOR: Record<string, string> = {
  long_term: 'long-term',
  short_term: 'something-casual',
  friends: 'new-friends',
  not_sure: 'figuring-out',
};

export async function createProfile(data: {
  name: string;
  gender: string;
  tagline?: string | null;
  location?: string | null;
  city?: string | null;
  country?: string | null;
  job?: string | null;
  about_me?: string | null;
  height_cm?: number | null;
  looking_for?: string | null;
  /** Onboarding Step 6 values; stored as looking_for. */
  relationship_intent?: string;
  birth_date?: string | null;
  photos?: string[] | null;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const age = data.birth_date ? calculateAge(parseBirthDate(data.birth_date)) : 18;
  if (age < 18) throw new Error('Must be 18 or older');
  const location =
    data.location?.trim() || formatLocationFromCityCountry(data.city, data.country);
  const countryVal = (data.country ?? '').trim() || null;
  const lookingFor =
    (data.relationship_intent && RELATIONSHIP_INTENT_TO_LOOKING_FOR[data.relationship_intent]) ||
    data.looking_for ||
    null;
  const { error } = await supabase.from('profiles').upsert({
    id: user.id,
    name: data.name || '',
    gender: data.gender || '',
    age,
    birth_date: data.birth_date || null,
    tagline: data.tagline ?? null,
    location,
    country: countryVal,
    job: data.job ?? null,
    about_me: data.about_me ?? null,
    height_cm:
      typeof data.height_cm === 'number' &&
      Number.isInteger(data.height_cm) &&
      data.height_cm >= 100 &&
      data.height_cm <= 250
        ? data.height_cm
        : null,
    looking_for: lookingFor,
    relationship_intent: lookingFor,
    photos: data.photos?.length ? data.photos : null,
    avatar_url: data.photos?.[0] ?? null,
  });
  if (error) throw error;
  // Initialize user_credits like web onboarding
  await supabase.from('user_credits').upsert(
    { user_id: user.id, extra_time_credits: 0, extended_vibe_credits: 0 },
    { onConflict: 'user_id' }
  );
}
