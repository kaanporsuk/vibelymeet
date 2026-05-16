import { supabase } from '@/lib/supabase';
import {
  formatChatImageMessageContent,
  parseChatImageMessageContent,
} from '@/lib/chatMessageContent';

export type ChatMediaKind = 'image' | 'voice' | 'video' | 'vibe_clip' | 'thumbnail';

type ResolverResponse = {
  success?: boolean;
  url?: string;
  expiresInSeconds?: number;
  error?: string;
};

type CachedMediaUrl = {
  url: string;
  expiresAtMs: number;
};

const DEFAULT_SIGNED_MEDIA_TTL_MS = 4 * 60 * 1000;
const SIGNED_MEDIA_TTL_SAFETY_MS = 15 * 1000;
const mediaUrlCache = new Map<string, CachedMediaUrl>();

function isLocalPreviewRef(value: string): boolean {
  return value.startsWith('blob:') || value.startsWith('file:') || value.startsWith('data:');
}

function isAlreadyResolvedMediaUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
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
  if (isLocalPreviewRef(rawRef) || isAlreadyResolvedMediaUrl(rawRef) || !isUuid(messageId)) return rawRef;

  return getCachedChatMediaUrl(messageId, mediaKind, rawRef);
}

export async function getCachedChatMediaUrl(
  messageId: string,
  mediaKind: ChatMediaKind,
  rawRef: string | null | undefined,
): Promise<string | null> {
  if (!rawRef) return null;
  if (isLocalPreviewRef(rawRef) || isAlreadyResolvedMediaUrl(rawRef) || !isUuid(messageId)) return rawRef;

  return issueAndCacheChatMediaUrl(messageId, mediaKind, rawRef, false);
}

export async function refreshCachedChatMediaUrl(
  messageId: string,
  mediaKind: ChatMediaKind,
  rawRef: string | null | undefined,
): Promise<string | null> {
  if (!rawRef) return null;
  if (isLocalPreviewRef(rawRef) || !isUuid(messageId)) return rawRef;

  return issueAndCacheChatMediaUrl(messageId, mediaKind, rawRef, true);
}

async function issueAndCacheChatMediaUrl(
  messageId: string,
  mediaKind: ChatMediaKind,
  rawRef: string,
  forceRefresh: boolean,
): Promise<string | null> {
  const cacheKey = `${messageId}:${mediaKind}:${rawRef}`;
  const cached = mediaUrlCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAtMs > Date.now()) return cached.url;
  mediaUrlCache.delete(cacheKey);

  const { data, error } = await supabase.functions.invoke('get-chat-media-url', {
    body: { messageId, mediaKind },
  });
  if (error) return null;
  const payload = data as ResolverResponse | null;
  if (!payload?.success || typeof payload.url !== 'string' || !payload.url) return null;

  const expiresInMs =
    typeof payload.expiresInSeconds === 'number' &&
    Number.isFinite(payload.expiresInSeconds) &&
    payload.expiresInSeconds > 0
      ? Math.max(1_000, payload.expiresInSeconds * 1000 - SIGNED_MEDIA_TTL_SAFETY_MS)
      : DEFAULT_SIGNED_MEDIA_TTL_MS;
  mediaUrlCache.set(cacheKey, {
    url: payload.url,
    expiresAtMs: Date.now() + expiresInMs,
  });
  return payload.url;
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
    resolved.audio_url = await resolveChatMediaUrl(row.id, 'voice', row.audio_url);
  }

  if (row.video_url) {
    const kind = row.message_kind === 'vibe_clip' ? 'vibe_clip' : 'video';
    resolved.video_url = await resolveChatMediaUrl(row.id, kind, row.video_url);
  }

  const payload =
    row.structured_payload && typeof row.structured_payload === 'object' && !Array.isArray(row.structured_payload)
      ? { ...(row.structured_payload as Record<string, unknown>) }
      : null;
  const thumbnailRef = typeof payload?.thumbnail_url === 'string' ? payload.thumbnail_url : null;
  if (payload && thumbnailRef) {
    payload.thumbnail_url = await resolveChatMediaUrl(row.id, 'thumbnail', thumbnailRef);
    resolved.structured_payload = payload;
  }

  const imageRef = parseChatImageMessageContent(row.content, { allowPrivateMediaRefs: true });
  if (imageRef) {
    const imageUrl = await resolveChatMediaUrl(row.id, 'image', imageRef);
    resolved.content = imageUrl ? formatChatImageMessageContent(imageUrl) : formatChatImageMessageContent('');
  }

  return resolved;
}
