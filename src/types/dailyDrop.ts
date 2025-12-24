// Daily Drop Types - Backend Ready

export interface MatchCandidate {
  id: string;
  name: string;
  age: number;
  lastActiveAt: string; // ISO Date
  avatarUrl: string;
  vibeVideoUrl?: string;
  vibeTags: string[];
  bio: string;
  location?: string;
}

export interface DailyDrop {
  id: string;
  candidate: MatchCandidate;
  droppedAt: string; // ISO Date - when the drop was made available
  expiresAt: string; // ISO Date - 24h after drop
  status: 'ready' | 'viewed' | 'replied' | 'passed' | 'expired';
  replySentAt?: string;
}

export type DropZoneState = 
  | 'locked'      // Already viewed today's drop
  | 'ready'       // Drop available, not yet viewed
  | 'empty'       // No candidates available (High Standards)
  | 'pending'     // User sent reply, waiting for response
  | 'reveal';     // Currently viewing the drop

export interface DropHistory {
  seenUserIds: string[];
  lastDropDate: string; // ISO Date
  todayDropId?: string;
}

// Mock data generator helper
export const ACTIVITY_THRESHOLD_HOURS = 48;
export const DROP_HOUR = 18; // 6 PM

export function getDailyDropCandidate(
  allUsers: MatchCandidate[], 
  currentUserHistory: string[]
): MatchCandidate | null {
  const now = new Date();
  const fortyEightHoursAgo = new Date(now.getTime() - (ACTIVITY_THRESHOLD_HOURS * 60 * 60 * 1000));

  // 1. FILTER: Must be active recently
  const activeCandidates = allUsers.filter(user => {
    return new Date(user.lastActiveAt) > fortyEightHoursAgo;
  });

  // 2. EXCLUDE: Must not be in user's history (Seen/Passed/Liked)
  const freshCandidates = activeCandidates.filter(user => {
    return !currentUserHistory.includes(user.id);
  });

  // 3. RETURN: The first match or null
  return freshCandidates.length > 0 ? freshCandidates[0] : null;
}
