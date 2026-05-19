export type ChatDbMessageKind =
  | "text"
  | "date_suggestion"
  | "date_suggestion_event"
  | "vibe_game"
  | "vibe_game_session"
  | "vibe_clip"
  | "voice";

export type ChatRenderableMessageKind =
  | "text"
  | "date_suggestion"
  | "date_suggestion_event"
  | "vibe_game_session"
  | "vibe_clip";

export type ChatMediaRenderKind = "text" | "image" | "voice" | "video" | "vibe_clip";

export const CHAT_IMAGE_MESSAGE_PREFIX = "__IMAGE__|";

/**
 * Forward-compatible structured payload for chat photo messages.
 * New rows keep the legacy `content = "__IMAGE__|<ref>"` marker for old clients,
 * while modern renderers prefer this top-level media reference.
 */
export interface ChatImagePayload {
  v: 2;
  kind: "chat_image";
  client_request_id?: string;
  media_ref: string;
  provider: "bunny_storage";
}

/**
 * Canonical structured_payload shape for vibe_clip messages.
 * Stored in `messages.structured_payload` when `message_kind = 'vibe_clip'`.
 *
 * Thumbnail reality: chat upload pipeline may include a caller-generated
 * thumbnail uploaded to Bunny (`poster_source: "uploaded_thumbnail"`).
 * Older rows can still have `thumbnail_url = null`, where renderers should
 * fall back to first-frame poster extraction (`poster_source: "first_frame"`).
 */
export interface VibeClipPayload {
  v: 2 | 3;
  kind: "vibe_clip";
  client_request_id: string;
  duration_ms: number;
  thumbnail_url: string | null;
  poster_ref?: string | null;
  poster_source: "uploaded_thumbnail" | "first_frame" | "bunny_stream_thumbnail";
  aspect_ratio: number | null;
  processing_status: VibeClipProcessingStatus;
  upload_provider: "bunny" | "bunny_stream";
  provider?: "bunny_stream" | "bunny_storage";
  provider_object_id?: string | null;
  playback_ref?: string | null;
}

export const VIBE_CLIP_CONTENT_LABEL = "🎬 Vibe Clip";

export type VibeClipProcessingStatus = "uploading" | "processing" | "ready" | "failed";

/** Display-level metadata extracted from a vibe_clip message row. */
export interface VibeClipDisplayMeta {
  videoUrl: string;
  durationSec: number;
  durationMs: number;
  durationLabel: string;
  thumbnailUrl: string | null;
  posterSource: "uploaded_thumbnail" | "first_frame" | "bunny_stream_thumbnail";
  aspectRatio: number | null;
  processingStatus: VibeClipProcessingStatus;
  provider?: "bunny_stream" | "bunny_storage";
  providerObjectId?: string | null;
  playbackRef?: string | null;
  posterRef?: string | null;
}

/**
 * Extract canonical Vibe Clip display metadata from a message row.
 * Returns null if the row does not represent a valid vibe_clip.
 */
export function extractVibeClipMeta(row: {
  video_url?: string | null;
  video_duration_seconds?: number | null;
  structured_payload?: Record<string, unknown> | null;
  message_kind?: string | null;
}): VibeClipDisplayMeta | null {
  if (row.message_kind !== "vibe_clip" || !row.video_url) return null;

  const sp = row.structured_payload as Partial<VibeClipPayload> | null | undefined;
  const durationMs = typeof sp?.duration_ms === "number" ? sp.duration_ms : (row.video_duration_seconds ?? 0) * 1000;
  const durationSec = Math.max(0, Math.round(durationMs / 1000));
  const mins = Math.floor(durationSec / 60);
  const secs = durationSec % 60;

  return {
    videoUrl: row.video_url,
    durationMs,
    durationSec,
    durationLabel: `${mins}:${secs.toString().padStart(2, "0")}`,
    thumbnailUrl:
      typeof sp?.thumbnail_url === "string" && sp.thumbnail_url
        ? sp.thumbnail_url
        : typeof sp?.poster_ref === "string" && sp.poster_ref
          ? sp.poster_ref
          : null,
    posterSource:
      sp?.poster_source === "uploaded_thumbnail" || sp?.poster_source === "bunny_stream_thumbnail"
        ? sp.poster_source
        : "first_frame",
    aspectRatio:
      typeof sp?.aspect_ratio === "number" && Number.isFinite(sp.aspect_ratio) && sp.aspect_ratio > 0
        ? sp.aspect_ratio
        : null,
    processingStatus:
      sp?.processing_status === "uploading" ||
      sp?.processing_status === "processing" ||
      sp?.processing_status === "failed" ||
      sp?.processing_status === "ready"
        ? sp.processing_status
        : "ready",
    provider: sp?.provider,
    providerObjectId: typeof sp?.provider_object_id === "string" ? sp.provider_object_id : null,
    playbackRef: typeof sp?.playback_ref === "string" ? sp.playback_ref : null,
    posterRef: typeof sp?.poster_ref === "string" ? sp.poster_ref : null,
  };
}

export type ParseChatImageMessageOptions = {
  /**
   * Allow local preview URLs for optimistic UI only. Server rows and preview
   * labels should keep the default strict http(s)-only behavior.
   */
  allowLocalPreviewUrls?: boolean;
  /** Server/client DB rows may store a private provider path instead of a public URL. */
  allowPrivateMediaRefs?: boolean;
};

function isLocalPreviewImageUrl(url: string): boolean {
  return url.startsWith("blob:") || url.startsWith("file:") || url.startsWith("data:image/");
}

function isPrivateChatImageRef(url: string): boolean {
  return /^photos\/[^?#\s]+/i.test(url);
}

function structuredPayloadObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validChatImageRef(value: unknown, options?: ParseChatImageMessageOptions): string | null {
  if (typeof value !== "string") return null;
  const ref = value.trim();
  if (/^https?:\/\//i.test(ref)) return ref;
  if (options?.allowLocalPreviewUrls && isLocalPreviewImageUrl(ref)) return ref;
  if (options?.allowPrivateMediaRefs && isPrivateChatImageRef(ref)) return ref;
  return null;
}

/** Returns the canonical chat image ref from `structured_payload`, when present. */
export function parseChatImageStructuredPayload(
  structuredPayload: unknown,
  options?: ParseChatImageMessageOptions,
): string | null {
  const payload = structuredPayloadObject(structuredPayload);
  if (!payload || payload.kind !== "chat_image") return null;
  if (payload.v !== 2 || payload.provider !== "bunny_storage") return null;
  return validChatImageRef(payload.media_ref, options);
}

/** Prefer structured chat-image payloads, then fall back to the legacy text marker. */
export function extractChatImageMediaRef(
  row: { content?: string | null; structured_payload?: unknown },
  options?: ParseChatImageMessageOptions,
): string | null {
  return parseChatImageStructuredPayload(row.structured_payload, options)
    ?? parseChatImageMessageContent(row.content ?? "", options);
}

/** Returns image URL when this text should render as a photo bubble. */
export function parseChatImageMessageContent(
  content: string,
  options?: ParseChatImageMessageOptions,
): string | null {
  const t = content.trim();
  if (t.startsWith(CHAT_IMAGE_MESSAGE_PREFIX)) {
    return validChatImageRef(t.slice(CHAT_IMAGE_MESSAGE_PREFIX.length), options);
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
    messageKind === "vibe_clip" ||
    messageKind === "voice"
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
  if (normalized === "voice") {
    return "text";
  }
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
  structuredPayload?: unknown;
}): ChatMediaRenderKind {
  if (params.messageKind === "vibe_clip") return "vibe_clip";
  if (params.videoUrl) return "video";
  if (params.audioUrl) return "voice";
  if (extractChatImageMediaRef({
    content: params.content,
    structured_payload: params.structuredPayload,
  }, { allowPrivateMediaRefs: true })) return "image";
  return "text";
}
