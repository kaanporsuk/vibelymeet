/**
 * @deprecated Profile completeness is computed server-side and stored on `profiles.vibe_score`
 * (see Supabase migration `vibe_score_backend`). Do not use this in UI — read `vibe_score` /
 * `vibe_score_label` from the profile row instead.
 *
 * Kept for reference/tests only.
 */

export interface VibeScoreProfile {
  name?: string | null;
  birthDate?: Date | null;
  job?: string | null;
  heightCm?: number | null;
  location?: string | null;
  aboutMe?: string | null;
  photos?: string[];
  vibes?: string[];
  prompts?: { question?: string; answer?: string }[];
  lookingFor?: string | null;
  lifestyle?: Record<string, string>;
  verified?: boolean;
  tagline?: string | null;
  hasVibeVideo?: boolean;
}

/**
 * Calculate the Vibe Score (0-100) for a profile.
 * Used consistently across Profile page and Complete Profile wizard.
 */
export function calculateVibeScore(profile: VibeScoreProfile): number {
  let score = 0;

  // Base fields (up to 59 points max)
  if (profile.name) score += 8;
  if (profile.birthDate) score += 5;
  if (profile.job) score += 8;
  if (profile.heightCm) score += 5;
  if (profile.location) score += 5;
  if (profile.aboutMe && profile.aboutMe.length > 20) score += 12;
  if (profile.lookingFor) score += 5;
  if (profile.lifestyle && Object.keys(profile.lifestyle).length > 0) score += 5;
  if (profile.verified) score += 4;
  if (profile.tagline) score += 2;

  // Photos: up to 24 points (8 points per photo, max 3)
  const photos = profile.photos || [];
  score += Math.min(photos.filter(p => p && p !== "").length * 8, 24);

  // Vibes: 3 points each (max 12)
  const vibes = profile.vibes || [];
  score += Math.min(vibes.length * 3, 12);

  // Prompts: 7 points each (up to 21 for 3 prompts)
  const prompts = profile.prompts || [];
  score += prompts.filter(p => p.answer && p.answer.trim()).length * 7;

  // Vibe Video: 10 points
  if (profile.hasVibeVideo) score += 10;

  return Math.min(score, 100);
}
