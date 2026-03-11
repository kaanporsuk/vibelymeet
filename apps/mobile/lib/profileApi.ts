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
  events_attended: number | null;
  total_matches: number | null;
  total_conversations: number | null;
};

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
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, birth_date, age, gender, interested_in, tagline, height_cm, location, job, about_me, looking_for, photos, avatar_url, events_attended, total_matches, total_conversations')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data as ProfileRow | null;
}

export async function updateMyProfile(updates: Partial<{
  name: string;
  gender: string;
  tagline: string;
  location: string;
  job: string;
  about_me: string;
  looking_for: string;
}>): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const db: Record<string, unknown> = {};
  if (updates.name !== undefined) db.name = updates.name;
  if (updates.gender !== undefined) db.gender = updates.gender;
  if (updates.tagline !== undefined) db.tagline = updates.tagline;
  if (updates.location !== undefined) db.location = updates.location;
  if (updates.job !== undefined) db.job = updates.job;
  if (updates.about_me !== undefined) db.about_me = updates.about_me;
  if (updates.looking_for !== undefined) db.looking_for = updates.looking_for;
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
