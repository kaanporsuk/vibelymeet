// Single source of truth (web + native) for deciding whether a Bunny Storage ref is private,
// chat-scoped media that must NEVER be turned into a public CDN URL.
//
// Public families: profile photos `photos/{user_id}/…`, event covers `events/{event_id}/…`.
// Private (chat) families: chat photos `photos/match-{matchId}/{userId}/…`, voice `voice/…`,
// legacy chat videos `chat-videos/…`. These must resolve only through the authorized
// `get-chat-media-url` resolver. `{user_id}`/`{event_id}` are UUIDs, so a public path can never
// contain `/match-` — the guard is exact and cannot misclassify public media as private.

export function isPrivateChatScopedStoragePath(path: string): boolean {
  if (!path) return false;
  return (
    path.startsWith("voice/") ||
    path.startsWith("chat-videos/") ||
    path.startsWith("photos/match-") ||
    path.includes("/match-")
  );
}
