/**
 * Same algorithm as web `src/utils/calculateVibeScore.ts` — Profile + wizard parity.
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

export function calculateVibeScore(profile: VibeScoreProfile): number {
  let score = 0;

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

  const photos = profile.photos || [];
  score += Math.min(photos.filter((p) => p && p !== '').length * 8, 24);

  const vibes = profile.vibes || [];
  score += Math.min(vibes.length * 3, 12);

  const prompts = profile.prompts || [];
  score += prompts.filter((p) => p.answer && p.answer.trim()).length * 7;

  if (profile.hasVibeVideo) score += 10;

  return Math.min(score, 100);
}
