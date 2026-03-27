export type ChatDbMessageKind =
  | "text"
  | "date_suggestion"
  | "date_suggestion_event"
  | "vibe_game"
  | "vibe_game_session"
  | "vibe_clip";

export type ChatRenderableMessageKind =
  | "text"
  | "date_suggestion"
  | "date_suggestion_event"
  | "vibe_game_session"
  | "vibe_clip";

export type ChatMediaRenderKind = "text" | "image" | "voice" | "video" | "vibe_clip";

export const CHAT_IMAGE_MESSAGE_PREFIX = "__IMAGE__|";

/**
 * Canonical structured_payload shape for vibe_clip messages (v2).
 * Stored in `messages.structured_payload` when `message_kind = 'vibe_clip'`.
 */
export interface VibeClipPayload {
  v: 2;
  kind: "vibe_clip";
  client_request_id: string;
  duration_ms: number;
  thumbnail_url: string | null;
  processing_status: "ready";
  upload_provider: "bunny";
}

export const VIBE_CLIP_CONTENT_LABEL = "🎬 Vibe Clip";

/** Returns image URL when this text should render as a photo bubble. */
export function parseChatImageMessageContent(content: string): string | null {
  const t = content.trim();
  if (t.startsWith(CHAT_IMAGE_MESSAGE_PREFIX)) {
    const u = t.slice(CHAT_IMAGE_MESSAGE_PREFIX.length).trim();
    if (/^https?:\/\//i.test(u)) return u;
    return null;
  }
  // Legacy / plain URL-only photo sends (Supabase storage or CDN)
  if (/^https?:\/\/\S+$/i.test(t) && /\.(jpe?g|png|gif|webp)(\?|#|$)/i.test(t)) {
    return t;
  }
  return null;
}

export function formatChatImageMessageContent(publicUrl: string): string {
  return `${CHAT_IMAGE_MESSAGE_PREFIX}${publicUrl}`;
}

/**
 * Canonical DB `message_kind` normalization used by both web + native.
 * Unknown values intentionally degrade to `text` instead of throwing.
 */
export function normalizeChatDbMessageKind(messageKind: string | null | undefined): ChatDbMessageKind {
  if (
    messageKind === "date_suggestion" ||
    messageKind === "date_suggestion_event" ||
    messageKind === "vibe_game" ||
    messageKind === "vibe_game_session" ||
    messageKind === "vibe_clip"
  ) {
    return messageKind;
  }
  return "text";
}

/**
 * Canonical UI kind mapping for regular message rows.
 * Raw `vibe_game` rows are folded/collapsed upstream, so direct rendering falls back to `text`.
 */
export function toRenderableMessageKind(messageKind: string | null | undefined): ChatRenderableMessageKind {
  const normalized = normalizeChatDbMessageKind(messageKind);
  if (
    normalized === "date_suggestion" ||
    normalized === "date_suggestion_event" ||
    normalized === "vibe_game_session" ||
    normalized === "vibe_clip"
  ) {
    return normalized;
  }
  return "text";
}

/**
 * Canonical media routing precedence:
 * vibe_clip kind > video field > audio field > image marker/plain URL > text.
 *
 * When `messageKind` is `vibe_clip`, returns `"vibe_clip"` regardless of other
 * fields so the UI can render the clip-specific bubble. Legacy video messages
 * (kind=text + video_url) continue to return `"video"`.
 */
export function inferChatMediaRenderKind(params: {
  content: string;
  audioUrl?: string | null;
  videoUrl?: string | null;
  messageKind?: string | null;
}): ChatMediaRenderKind {
  if (params.messageKind === "vibe_clip") return "vibe_clip";
  if (params.videoUrl) return "video";
  if (params.audioUrl) return "voice";
  if (parseChatImageMessageContent(params.content)) return "image";
  return "text";
}
