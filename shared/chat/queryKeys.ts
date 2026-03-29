/**
 * Canonical TanStack Query keys for a 1:1 chat thread (web + native).
 * Always use `exact: true` when invalidating to avoid refetching every open thread.
 */
export function threadMessagesQueryKey(otherUserId: string, currentUserId: string) {
  return ["messages", otherUserId, currentUserId] as const;
}

/** Narrow invalidation to one thread + optional per-match date suggestions */
export type ThreadInvalidateScope = {
  otherUserId: string;
  currentUserId: string;
  matchId?: string | null;
};
