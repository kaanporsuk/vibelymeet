/**
 * Incoming chat message sound — intentionally not wired yet.
 *
 * Defer reasons:
 * - Needs a user-controlled preference (many users mute chat apps).
 * - Requires hosted audio asset + preloading; autoplay is blocked without gesture on web.
 * - Realtime INSERT fires for all rows in the match; distinguishing “partner only” needs
 *   payload inspection and dedupe against optimistic sends to avoid false positives.
 *
 * Safe future hook: call from a deduped handler after cache merge when a new row is
 * attributed to the other participant and the thread is foregrounded.
 */
export function playIncomingChatMessageSound(): void {
  // no-op placeholder
}
