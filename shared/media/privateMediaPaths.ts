// Single source of truth (web + native) for deciding whether a Bunny Storage ref is private,
// chat-scoped media that must NEVER be turned into a public CDN URL.
//
// Public families: profile photos `photos/{user_id}/…`, event covers `events/{event_id}/…`.
// Private (chat) families: chat photos `photos/match-{matchId}/{userId}/…`, voice `voice/…`,
// legacy chat videos `chat-videos/…`, and the deprecated `media/…` chat namespace. These must
// resolve only through the authorized `get-chat-media-url` resolver. `{user_id}`/`{event_id}`
// are UUIDs, so a public path can never contain `/match-` — the guard is exact and cannot
// misclassify public media as private.
//
// `media/` is currently produced by no uploader and there is no public `media` storage bucket,
// so guarding it has zero functional impact today; it is kept private-by-default so that if a
// chat `media/…` producer is ever reintroduced it is covered without a second code change.

export function isPrivateChatScopedStoragePath(path: string): boolean {
  if (!path) return false;
  return (
    path.startsWith("voice/") ||
    path.startsWith("media/") ||
    path.startsWith("chat-videos/") ||
    path.startsWith("photos/match-") ||
    path.includes("/match-")
  );
}
