export type ChatDbMessageKind =
  | "text"
  | "date_suggestion"
  | "date_suggestion_event"
  | "vibe_game"
  | "vibe_game_session";

export type ChatRenderableMessageKind =
  | "text"
  | "date_suggestion"
  | "date_suggestion_event"
  | "vibe_game_session";

export type ChatMediaRenderKind = "text" | "image" | "voice" | "video";

export const CHAT_IMAGE_MESSAGE_PREFIX = "__IMAGE__|";

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
    messageKind === "vibe_game_session"
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
  if (normalized === "date_suggestion" || normalized === "date_suggestion_event" || normalized === "vibe_game_session") {
    return normalized;
  }
  return "text";
}

/**
 * Canonical media routing precedence:
 * video field > audio field > image marker/plain URL > text.
 */
export function inferChatMediaRenderKind(params: {
  content: string;
  audioUrl?: string | null;
  videoUrl?: string | null;
}): ChatMediaRenderKind {
  if (params.videoUrl) return "video";
  if (params.audioUrl) return "voice";
  if (parseChatImageMessageContent(params.content)) return "image";
  return "text";
}
