/**
 * Shared reaction model for chat (web + native). Kept in shared/ for one source of truth.
 */

export type ReactionEmoji = "❤️" | "🔥" | "🤣" | "😮" | "👎";

const ALLOWED = new Set<string>(["❤️", "🔥", "🤣", "😮", "👎"]);

export function isReactionEmoji(s: string): s is ReactionEmoji {
  return ALLOWED.has(s);
}

export type ReactionPair = {
  mine: ReactionEmoji | null;
  partner: ReactionEmoji | null;
};

export type MessageReactionRow = {
  message_id: string;
  profile_id: string;
  emoji: string;
};

/** Build per-message pair view for a 1:1 thread. */
export function reactionPairFromRows(
  rows: MessageReactionRow[],
  currentUserId: string,
  partnerUserId: string,
): ReactionPair {
  let mine: ReactionEmoji | null = null;
  let partner: ReactionEmoji | null = null;
  for (const r of rows) {
    if (!isReactionEmoji(r.emoji)) continue;
    if (r.profile_id === currentUserId) mine = r.emoji;
    else if (r.profile_id === partnerUserId) partner = r.emoji;
  }
  return { mine, partner };
}

/** Compact label for thread UI (two slots max in 1:1). */
export function compactReactionLabel(pair: ReactionPair | null | undefined): string {
  if (!pair) return "";
  const parts = [pair.mine, pair.partner].filter((e): e is ReactionEmoji => !!e);
  return parts.join(" ");
}
