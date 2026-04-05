/**
 * @deprecated Profile completeness is computed server-side and stored on `profiles.vibe_score`
 * (see Supabase migrations under `supabase/migrations/*vibe_score*`). Do not use this in UI —
 * read `vibe_score` / `vibe_score_label` from the profile row instead.
 *
 * Not related to `vibeScoreUtils.ts` → `calculateVibeScore` (match/event compatibility %).
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
  relationshipIntent?: string | null;
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
  const relationshipIntent = profile.relationshipIntent ?? profile.lookingFor;

  // Base fields (up to 59 points max)
  if (profile.name) score += 8;
  if (profile.birthDate) score += 5;
  if (profile.job) score += 8;
  if (profile.heightCm) score += 5;
  if (profile.location) score += 5;
  if (profile.aboutMe && profile.aboutMe.length > 20) score += 12;
  if (relationshipIntent) score += 5;
  if (profile.lifestyle && Object.keys(profile.lifestyle).length > 0) score += 5;
  if (profile.verified) score += 4;
  if (profile.tagline) score += 2;

  // Photos: up to 24 points (8 points per photo, max 3)
  const photos = profile.photos || [];
  score += Math.min(photos.filter(p => p && p !== "").length * 8, 24);

  // Vibes: 3 points each (max 12)
  const vibes = profile.vibes || [];
  score += Math.min(vibes.length * 3, 12);

  // Prompts: 4 + 3 + 3 = max 10 (aligned with server calculate_vibe_score)
  const promptAnswers = (profile.prompts || []).filter((p) => p.answer && p.answer.trim()).length;
  if (promptAnswers >= 1) score += 4;
  if (promptAnswers >= 2) score += 3;
  if (promptAnswers >= 3) score += 3;

  // Vibe video: parity with server — credit when a uid exists (upload/processing counts).
  if (profile.hasVibeVideo) score += 15;

  return Math.min(score, 100);
}
