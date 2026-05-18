import { supabase } from "@/integrations/supabase/client";
import {
  formatChatImageMessageContent,
  parseChatImageMessageContent,
} from "@/lib/chatMessageContent";

export type ChatMediaKind = "image" | "voice" | "video" | "vibe_clip" | "thumbnail";
export type ChatVibeClipProcessingStatus = "uploading" | "processing" | "ready" | "failed";

type ResolverResponse = {
  success?: boolean;
  url?: string;
  posterUrl?: string | null;
  playbackKind?: "hls" | "progressive";
  provider?: "bunny_stream" | "bunny_storage";
  expiresInSeconds?: number;
  error?: string;
};

type CachedMediaUrl = {
  url: string;
  expiresAtMs: number;
};

type MediaUrlIssueResult =
  | { kind: "response"; payload: ResolverResponse | null }
  | { kind: "transient_failure" };

type ChatMediaRefreshOptions = {
  bypassFailureCooldown?: boolean;
};

const DEFAULT_SIGNED_MEDIA_TTL_MS = 4 * 60 * 1000;
const SIGNED_MEDIA_TTL_SAFETY_MS = 15 * 1000;
const SIGNED_MEDIA_FAILURE_COOLDOWN_MS = 8_000;
const mediaUrlCache = new Map<string, CachedMediaUrl>();
const mediaUrlFailureCache = new Map<string, { expiresAtMs: number }>();
const mediaUrlInFlightRequests = new Map<string, Promise<string | null>>();
let testMediaUrlIssuer: ((messageId: string, mediaKind: ChatMediaKind) => Promise<ResolverResponse | null>) | null = null;

function isLocalPreviewRef(value: string): boolean {
  return value.startsWith("blob:") || value.startsWith("file:") || value.startsWith("data:");
}

function isAlreadyResolvedMediaUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isBunnyStreamRef(value: string): boolean {
  return value.startsWith("bunny_stream:");
}

function bunnyStreamThumbnailRefFor(rawRef: string): string | null {
  const match = /^bunny_stream:([0-9a-f-]{32,36})$/i.exec(rawRef.trim());
  return match ? `bunny_stream:${match[1]}:thumbnail` : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function resolveChatMediaUrl(
  messageId: string,
  mediaKind: ChatMediaKind,
  rawRef: string | null | undefined,
): Promise<string | null> {
  if (!rawRef) return null;
  if ((mediaKind === "vibe_clip" || mediaKind === "video") && isBunnyStreamRef(rawRef)) return rawRef;
  if (isLocalPreviewRef(rawRef) || isAlreadyResolvedMediaUrl(rawRef) || !isUuid(messageId)) return rawRef;

  return getCachedChatMediaUrl(messageId, mediaKind, rawRef);
}

export async function getCachedChatMediaUrl(
  messageId: string,
  mediaKind: ChatMediaKind,
  rawRef: string | null | undefined,
): Promise<string | null> {
  if (!rawRef) return null;
  if ((mediaKind === "vibe_clip" || mediaKind === "video") && isBunnyStreamRef(rawRef)) return rawRef;
  if (isLocalPreviewRef(rawRef) || isAlreadyResolvedMediaUrl(rawRef) || !isUuid(messageId)) return rawRef;

  return issueAndCacheChatMediaUrl(messageId, mediaKind, rawRef, false);
}

export async function refreshCachedChatMediaUrl(
  messageId: string,
  mediaKind: ChatMediaKind,
  rawRef: string | null | undefined,
  options: ChatMediaRefreshOptions = {},
): Promise<string | null> {
  if (!rawRef) return null;
  if (isLocalPreviewRef(rawRef) || !isUuid(messageId)) return rawRef;

  return issueAndCacheChatMediaUrl(messageId, mediaKind, rawRef, true, options);
}

export async function syncChatVibeClipStatus(messageId: string): Promise<ChatVibeClipProcessingStatus | null> {
  if (!isUuid(messageId)) return null;
  try {
    const { data, error } = await supabase.functions.invoke("sync-chat-vibe-clip-status", {
      body: { message_id: messageId },
    });
    if (error) return null;
    const status = (data as { status?: unknown } | null)?.status;
    return status === "uploading" || status === "processing" || status === "ready" || status === "failed"
      ? status
      : null;
  } catch {
    return null;
  }
}

async function issueAndCacheChatMediaUrl(
  messageId: string,
  mediaKind: ChatMediaKind,
  rawRef: string,
  forceRefresh: boolean,
  options: ChatMediaRefreshOptions = {},
): Promise<string | null> {
  const cacheKey = `${messageId}:${mediaKind}:${rawRef}`;
  const now = Date.now();
  const cached = mediaUrlCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAtMs > now) return cached.url;
  const recentFailure = mediaUrlFailureCache.get(cacheKey);
  if (!options.bypassFailureCooldown && recentFailure && recentFailure.expiresAtMs > now) return null;
  mediaUrlFailureCache.delete(cacheKey);

  const inFlight = mediaUrlInFlightRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async (): Promise<MediaUrlIssueResult> => {
    try {
      if (testMediaUrlIssuer) {
        return { kind: "response", payload: await testMediaUrlIssuer(messageId, mediaKind) };
      }
      const { data, error } = await supabase.functions.invoke("get-chat-media-url", {
        body: { messageId, mediaKind },
      });
      if (error) return { kind: "transient_failure" };
      return { kind: "response", payload: data as ResolverResponse | null };
    } catch {
      return { kind: "transient_failure" };
    }
  })();

  const resolved = request.then((result) => {
    if (result.kind === "transient_failure") return null;
    const { payload } = result;
    if (!payload?.success || typeof payload.url !== "string" || !payload.url) {
      mediaUrlFailureCache.set(cacheKey, { expiresAtMs: Date.now() + SIGNED_MEDIA_FAILURE_COOLDOWN_MS });
      return null;
    }

    mediaUrlFailureCache.delete(cacheKey);
    const expiresInMs =
      typeof payload.expiresInSeconds === "number" &&
      Number.isFinite(payload.expiresInSeconds) &&
      payload.expiresInSeconds > 0
        ? Math.max(1_000, payload.expiresInSeconds * 1000 - SIGNED_MEDIA_TTL_SAFETY_MS)
        : DEFAULT_SIGNED_MEDIA_TTL_MS;
    const expiresAtMs = Date.now() + expiresInMs;
    mediaUrlCache.set(cacheKey, {
      url: payload.url,
      expiresAtMs,
    });
    const thumbnailRef =
      payload.provider === "bunny_stream" && (mediaKind === "vibe_clip" || mediaKind === "video")
        ? bunnyStreamThumbnailRefFor(rawRef)
        : null;
    if (thumbnailRef && typeof payload.posterUrl === "string" && payload.posterUrl) {
      mediaUrlCache.set(`${messageId}:thumbnail:${thumbnailRef}`, {
        url: payload.posterUrl,
        expiresAtMs,
      });
    }
    return payload.url;
  });

  mediaUrlInFlightRequests.set(cacheKey, resolved);
  try {
    return await resolved;
  } finally {
    if (mediaUrlInFlightRequests.get(cacheKey) === resolved) {
      mediaUrlInFlightRequests.delete(cacheKey);
    }
  }
}

export function __clearChatMediaUrlCacheForTests() {
  mediaUrlCache.clear();
  mediaUrlFailureCache.clear();
  mediaUrlInFlightRequests.clear();
}

export function __chatMediaUrlCacheSizeForTests() {
  return mediaUrlCache.size;
}

export function __setChatMediaUrlIssuerForTests(
  issuer: ((messageId: string, mediaKind: ChatMediaKind) => Promise<ResolverResponse | null>) | null,
) {
  testMediaUrlIssuer = issuer;
}

export async function resolveChatMessageMediaForDisplay<
  T extends {
    id: string;
    content: string;
    audio_url?: string | null;
    video_url?: string | null;
    message_kind?: string | null;
    structured_payload?: unknown;
  },
>(row: T): Promise<T> {
  const resolved = { ...row } as T & {
    audio_url?: string | null;
    video_url?: string | null;
    structured_payload?: unknown;
  };

  if (row.audio_url) {
    resolved.audio_url = await resolveChatMediaUrl(row.id, "voice", row.audio_url);
  }

  if (row.video_url) {
    const kind = row.message_kind === "vibe_clip" ? "vibe_clip" : "video";
    resolved.video_url = await resolveChatMediaUrl(row.id, kind, row.video_url);
  }

  const payload =
    row.structured_payload && typeof row.structured_payload === "object" && !Array.isArray(row.structured_payload)
      ? { ...(row.structured_payload as Record<string, unknown>) }
      : null;
  const thumbnailRef = typeof payload?.thumbnail_url === "string" ? payload.thumbnail_url : null;
  if (payload && thumbnailRef) {
    payload.thumbnail_url = await resolveChatMediaUrl(row.id, "thumbnail", thumbnailRef);
    resolved.structured_payload = payload;
  }

  const imageRef = parseChatImageMessageContent(row.content, { allowPrivateMediaRefs: true });
  if (imageRef) {
    const imageUrl = await resolveChatMediaUrl(row.id, "image", imageRef);
    resolved.content = imageUrl ? formatChatImageMessageContent(imageUrl) : formatChatImageMessageContent("");
  }

  return resolved;
}
