import { supabase } from '@/lib/supabase';

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
  looking_for: string | null;
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

function calculateAge(birthDate: Date): number {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
  return age;
}

export async function fetchMyProfile(): Promise<ProfileRow | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const [profileRes, vibesRes] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, name, birth_date, age, gender, interested_in, tagline, height_cm, location, job, about_me, looking_for, photos, avatar_url, bunny_video_uid, bunny_video_status, events_attended, total_matches, total_conversations, lifestyle, prompts, vibe_caption, photo_verified, phone_verified, email_verified, is_premium, premium_until'
      )
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('profile_vibes')
      .select('vibe_tags(label)')
      .eq('profile_id', user.id),
  ]);

  if (profileRes.error) throw profileRes.error;
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

  return {
    ...row,
    prompts: (row.prompts as ProfileRow['prompts']) ?? null,
    vibes,
    lifestyle: (row.lifestyle as ProfileRow['lifestyle']) ?? null,
    vibe_caption: (row.vibe_caption as string) ?? null,
    photo_verified: (row.photo_verified as boolean | null) ?? null,
    phone_verified: (row.phone_verified as boolean | null) ?? null,
    email_verified: ((row as Record<string, unknown>).email_verified as boolean | null) ?? null,
    is_premium: (row.is_premium as boolean | null) ?? null,
    premium_until: (row.premium_until as string) ?? null,
  } as ProfileRow;
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
  if (updates.looking_for !== undefined) db.looking_for = updates.looking_for;
  if (updates.photos !== undefined) db.photos = updates.photos;
  if (updates.avatar_url !== undefined) db.avatar_url = updates.avatar_url;
  if (updates.prompts !== undefined) db.prompts = updates.prompts;
  if (updates.lifestyle !== undefined) db.lifestyle = updates.lifestyle;
  if (updates.vibe_caption !== undefined) db.vibe_caption = updates.vibe_caption;
  if (updates.birth_date !== undefined) {
    db.birth_date = updates.birth_date;
    if (updates.birth_date) {
      const d = new Date(updates.birth_date);
      db.age = calculateAge(d);
    }
  }
  if (updates.height_cm !== undefined) db.height_cm = updates.height_cm;
  if (updates.location_data !== undefined) db.location_data = updates.location_data;
  if (Object.keys(db).length === 0) return;
  const { error } = await supabase.from('profiles').update(db).eq('id', user.id);
  if (error) throw error;
}

/** Create/upsert profile during onboarding. Same contract as web createProfile. */
export async function createProfile(data: {
  name: string;
  gender: string;
  tagline?: string | null;
  location?: string | null;
  job?: string | null;
  about_me?: string | null;
  looking_for?: string | null;
  birth_date?: string | null;
}): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const age = data.birth_date ? calculateAge(new Date(data.birth_date)) : 18;
  if (age < 18) throw new Error('Must be 18 or older');
  const { error } = await supabase.from('profiles').upsert({
    id: user.id,
    name: data.name || '',
    gender: data.gender || '',
    age,
    birth_date: data.birth_date || null,
    tagline: data.tagline ?? null,
    location: data.location ?? null,
    job: data.job ?? null,
    about_me: data.about_me ?? null,
    looking_for: data.looking_for ?? null,
  });
  if (error) throw error;
  // Initialize user_credits like web onboarding
  await supabase.from('user_credits').upsert(
    { user_id: user.id, extra_time_credits: 0, extended_vibe_credits: 0, super_vibe_credits: 0 },
    { onConflict: 'user_id' }
  );
}
