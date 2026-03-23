/**
 * Humanized partner activity for chat header (no "Active 312h").
 */

export type ChatActivityVariant = 'typing' | 'online' | 'soft';

export type ChatActivityLine = {
  text: string;
  variant: ChatActivityVariant;
};

const ONLINE_MIN = 5;
const RECENT_MIN = 30;
const DAY_MIN = 24 * 60;
const WEEK_MIN = 7 * 24 * 60;

/**
 * @param lastSeenAtMs - `last_seen_at` from profile, or null if unknown
 */
export function getChatPartnerActivityLine(args: {
  partnerTyping: boolean;
  lastSeenAtMs: number | null;
  nowMs?: number;
}): ChatActivityLine | null {
  if (args.partnerTyping) {
    return { text: 'Vibing…', variant: 'typing' };
  }

  const now = args.nowMs ?? Date.now();

  if (args.lastSeenAtMs == null) {
    return { text: 'Recently active', variant: 'soft' };
  }

  const diffMin = (now - args.lastSeenAtMs) / 60000;

  if (diffMin <= ONLINE_MIN) {
    return { text: 'Active now', variant: 'online' };
  }
  if (diffMin <= RECENT_MIN) {
    return { text: 'Active recently', variant: 'soft' };
  }
  if (diffMin <= DAY_MIN) {
    return { text: 'Active today', variant: 'soft' };
  }
  if (diffMin <= WEEK_MIN) {
    return { text: 'Active this week', variant: 'soft' };
  }

  return { text: 'Recently active', variant: 'soft' };
}
