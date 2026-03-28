/**
 * Human-readable last-message preview for match / conversation list rows.
 * Never surfaces transport encodings like `__IMAGE__|…` or raw media URLs as the preview.
 */

import {
  inferChatMediaRenderKind,
  normalizeChatDbMessageKind,
  parseChatImageMessageContent,
} from "./messageRouting";

const PREVIEW_MAX_LEN = 80;

export type ConversationListPreviewRowInput = {
  content: string | null | undefined;
  message_kind?: string | null;
  audio_url?: string | null;
  video_url?: string | null;
};

function truncatePreview(s: string): string {
  if (s.length <= PREVIEW_MAX_LEN) return s;
  return `${s.slice(0, PREVIEW_MAX_LEN)}…`;
}

/**
 * Derives a single line of preview text for a `messages` row (latest-per-match).
 * Returns `null` only when there is no displayable text (caller may show "New match", etc.).
 */
export function getConversationListPreviewText(row: ConversationListPreviewRowInput): string | null {
  const raw = typeof row.content === "string" ? row.content : "";
  const trimmed = raw.trim();
  const kind = row.message_kind ?? null;
  const audioUrl =
    typeof row.audio_url === "string" && row.audio_url.trim() ? row.audio_url.trim() : null;
  const videoUrl =
    typeof row.video_url === "string" && row.video_url.trim() ? row.video_url.trim() : null;

  const mediaKind = inferChatMediaRenderKind({
    content: trimmed,
    audioUrl,
    videoUrl,
    messageKind: kind,
  });

  if (mediaKind === "image") return "Photo";
  if (mediaKind === "voice") return "Voice message";
  if (mediaKind === "vibe_clip") return "Vibe Clip";
  if (mediaKind === "video") return "Video";

  const dbKind = normalizeChatDbMessageKind(kind);
  if (dbKind === "date_suggestion" || dbKind === "date_suggestion_event") {
    return trimmed.length > 0 ? truncatePreview(trimmed) : "Date update";
  }
  if (dbKind === "vibe_game" || dbKind === "vibe_game_session") {
    return trimmed.length > 0 ? truncatePreview(trimmed) : "Game";
  }

  if (parseChatImageMessageContent(trimmed)) return "Photo";

  if (!trimmed) {
    if (audioUrl) return "Voice message";
    if (videoUrl) return "Video";
    return null;
  }

  return truncatePreview(trimmed);
}
