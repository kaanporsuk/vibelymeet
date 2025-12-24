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
