/**
 * Fetch public profile by user id (same contract as web UserProfile).
 * Used for /user/:userId screen.
 */
import { supabase } from '@/lib/supabase';

export type PublicProfile = {
  id: string;
  name: string | null;
  age: number | null;
  tagline: string | null;
  about_me: string | null;
  job: string | null;
  location: string | null;
  photos: string[] | null;
  avatar_url: string | null;
  looking_for: string | null;
};

export type PublicProfileWithVibes = PublicProfile & { vibeLabels: string[] };

export async function fetchPublicProfile(userId: string): Promise<PublicProfileWithVibes | null> {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, name, age, tagline, about_me, job, location, photos, avatar_url, looking_for')
    .eq('id', userId)
    .maybeSingle();
  if (profileError || !profile) return null;

  const { data: vibes } = await supabase
    .from('profile_vibes')
    .select('vibe_tags(label)')
    .eq('profile_id', userId);
  const vibeLabels: string[] = [];
  for (const row of vibes ?? []) {
    const vt = (row as { vibe_tags?: { label?: string } | null }).vibe_tags;
    if (vt && typeof vt === 'object' && typeof (vt as { label?: string }).label === 'string') {
      vibeLabels.push((vt as { label: string }).label);
    }
  }

  return {
    ...(profile as PublicProfile),
    vibeLabels,
  };
}
