/**
 * Vibe Score Compatibility Calculator
 * 
 * Calculates a compatibility percentage based on:
 * - Shared vibe tags (primary factor)
 * - Activity recency (bonus)
 * - Profile completeness (minor factor)
 */

export interface VibeScoreInput {
  userTags: string[];
  candidateTags: string[];
  candidateLastActiveAt?: string;
  candidateHasVideo?: boolean;
  candidateBioLength?: number;
}

/**
 * Calculate vibe score between 0-100
 */
export function calculateVibeScore(input: VibeScoreInput): number {
  const { 
    userTags, 
    candidateTags, 
    candidateLastActiveAt,
    candidateHasVideo = false,
    candidateBioLength = 0
  } = input;

  // Base score from shared tags (max 60 points)
  const sharedTags = userTags.filter(tag => 
    candidateTags.some(ct => ct.toLowerCase() === tag.toLowerCase())
  );
  
  const tagOverlapRatio = candidateTags.length > 0 
    ? sharedTags.length / Math.max(userTags.length, candidateTags.length)
    : 0;
  
  const tagScore = Math.round(tagOverlapRatio * 60);

  // Activity bonus (max 20 points)
  let activityScore = 10; // Base activity
  if (candidateLastActiveAt) {
    const hoursSinceActive = (Date.now() - new Date(candidateLastActiveAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceActive < 1) activityScore = 20;
    else if (hoursSinceActive < 6) activityScore = 18;
    else if (hoursSinceActive < 24) activityScore = 15;
    else if (hoursSinceActive < 48) activityScore = 12;
    else activityScore = 8;
  }

  // Profile completeness bonus (max 20 points)
  let completenessScore = 5; // Base
  if (candidateHasVideo) completenessScore += 8;
  if (candidateBioLength > 50) completenessScore += 4;
  else if (candidateBioLength > 20) completenessScore += 2;
  if (candidateTags.length >= 3) completenessScore += 3;

  const totalScore = Math.min(100, tagScore + activityScore + completenessScore);
  
  // Add slight randomization for demo purposes (±5 points)
  const variance = Math.floor(Math.random() * 11) - 5;
  
  return Math.max(25, Math.min(100, totalScore + variance));
}

/**
 * Calculate a STABLE vibe score that doesn't change across page reloads.
 * Uses deterministic hashing based on user IDs to create consistent results.
 * 
 * @param userId - Current user's ID
 * @param candidateId - Candidate's ID  
 * @param userTags - Current user's vibe tags
 * @param candidateTags - Candidate's vibe tags
 * @param eventId - Optional event ID for event-specific consistency
 */
export function calculateVibeScoreStable(
  userId: string,
  candidateId: string,
  userTags: string[],
  candidateTags: string[],
  eventId?: string
): number {
  // Calculate base score from shared tags (max 70 points)
  const normalizedUserTags = userTags.map(t => t.toLowerCase().trim());
  const normalizedCandidateTags = candidateTags.map(t => t.toLowerCase().trim());
  
  const sharedTags = normalizedUserTags.filter(tag => 
    normalizedCandidateTags.includes(tag)
  );
  
  const maxTags = Math.max(normalizedUserTags.length, normalizedCandidateTags.length, 1);
  const tagOverlapRatio = sharedTags.length / maxTags;
  const tagScore = Math.round(tagOverlapRatio * 70);

  // Generate a deterministic "pseudo-random" bonus based on user pair
  // This creates consistent scores for the same pair of users
  const hashInput = [userId, candidateId, eventId || ""].sort().join("-");
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Use hash to generate a stable variance between 0-30
  const stableVariance = Math.abs(hash % 31);
  
  // Final score: tag-based (0-70) + stable variance (0-30)
  // Minimum score is 50 to avoid showing very low matches
  const finalScore = Math.max(50, Math.min(100, tagScore + stableVariance));
  
  return finalScore;
}

/**
 * Get the shared tags between two users
 */
export function getSharedTags(userTags: string[], candidateTags: string[]): string[] {
  return userTags.filter(tag => 
    candidateTags.some(ct => ct.toLowerCase() === tag.toLowerCase())
  );
}

/**
 * Get score label for display
 */
export function getVibeScoreLabel(score: number): string {
  if (score >= 90) return "Iconic Match";
  if (score >= 75) return "Fire";
  if (score >= 60) return "Strong Vibe";
  if (score >= 45) return "Rising";
  if (score >= 30) return "Warming Up";
  return "Explore";
}

/**
 * Get score color class
 */
export function getVibeScoreColor(score: number): string {
  if (score >= 75) return "text-neon-pink";
  if (score >= 50) return "text-neon-violet";
  return "text-neon-cyan";
}
