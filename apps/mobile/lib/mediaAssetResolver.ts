import { supabase } from '@/lib/supabase';
import { getFreshCachedAccessToken } from '@/lib/nativeAuthSession';
import { isNetworkInvokeError, type FunctionInvokeErrorShape } from '@clientShared/supabaseFunctionInvokeErrors';
import {
  formatChatImageMessageContent,
  extractChatImageMediaRef,
} from '@/lib/chatMessageContent';

export type MediaAssetKind = 'image' | 'voice' | 'video' | 'vibe_clip' | 'thumbnail' | 'profile_vibe_video';
export type MediaAssetResolveResult = {
  url: string;
  posterUrl: string | null;
  playbackKind: 'hls' | 'progressive';
  provider: 'bunny_stream' | 'bunny_storage' | 'local' | 'remote';
  expiresAtMs: number;
};
export type ChatVibeClipProcessingStatus = 'uploading' | 'processing' | 'ready' | 'failed';
export type ChatVibeClipStatusSyncResult = {
  status: ChatVibeClipProcessingStatus;
  messageId: string | null;
  providerObjectId: string | null;
};

type ResolverResponse = {
  success?: boolean;
  url?: string;
  posterUrl?: string | null;
  playbackKind?: 'hls' | 'progressive';
  provider?: 'bunny_stream' | 'bunny_storage';
  expiresInSeconds?: number;
  error?: string;
};

type CachedMediaUrl = MediaAssetResolveResult;

type MediaUrlIssueResult =
  | { kind: 'response'; payload: ResolverResponse | null }
  | { kind: 'transient_failure' };

export type MediaAssetRefreshOptions = {
  bypassFailureCooldown?: boolean;
};

const DEFAULT_SIGNED_MEDIA_TTL_MS = 4 * 60 * 1000;
const SIGNED_MEDIA_TTL_SAFETY_MS = 15 * 1000;
const SIGNED_MEDIA_FAILURE_COOLDOWN_MS = 8_000;
const mediaUrlCache = new Map<string, CachedMediaUrl>();
const mediaUrlFailureCache = new Map<string, { expiresAtMs: number }>();
const mediaUrlInFlightRequests = new Map<string, Promise<MediaAssetResolveResult | null>>();

export function isLocalMediaAssetRef(value: string): boolean {
  return value.startsWith('blob:') || value.startsWith('file:') || value.startsWith('data:');
}

export function isResolvedMediaAssetUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function isPlayableMediaAssetUrl(value: string | null | undefined): value is string {
  return !!value && (isLocalMediaAssetRef(value) || isResolvedMediaAssetUrl(value));
}

export function isResolvableMediaAssetRef(value: string | null | undefined): value is string {
  return !!value && !isPlayableMediaAssetUrl(value);
}

export function isHlsMediaAssetUrl(value: string | null | undefined): boolean {
  return !!value && /\.m3u8(?:[?#]|$)/i.test(value);
}

function isBunnyStreamRef(value: string): boolean {
  return value.startsWith('bunny_stream:');
}

function bunnyStreamThumbnailRefFor(rawRef: string): string | null {
  const match = /^bunny_stream:([0-9a-f-]{32,36})$/i.exec(rawRef.trim());
  return match ? `bunny_stream:${match[1]}:thumbnail` : null;
}

export type ProfileVibeVideoRef = {
  profileId: string;
  videoId: string;
};

export function parseProfileVibeVideoRef(value: string | null | undefined): ProfileVibeVideoRef | null {
  if (!value) return null;
  const match =
    /^profile_vibe_video:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([0-9a-f-]{32,36})$/i
      .exec(value.trim());
  return match ? { profileId: match[1], videoId: match[2] } : null;
}

export function isProfileVibeVideoRef(value: string | null | undefined): value is string {
  return !!parseProfileVibeVideoRef(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isResponseLike(value: unknown): value is Response {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Response).clone === 'function' &&
    typeof (value as Response).text === 'function'
  );
}

async function readResolverPayloadFromResponse(response: Response | null | undefined): Promise<ResolverResponse | null> {
  if (!response) return null;
  try {
    const text = await response.clone().text();
    if (!text) return null;
    const parsed = JSON.parse(text) as ResolverResponse;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function issueResultForFunctionInvokeError(
  error: unknown,
  response: Response | null | undefined,
): Promise<MediaUrlIssueResult> {
  const invokeError = error as FunctionInvokeErrorShape | null;
  if (!invokeError || isNetworkInvokeError(invokeError) || invokeError.name === 'FunctionsRelayError') {
    return { kind: 'transient_failure' };
  }

  if (invokeError.name === 'FunctionsHttpError') {
    const contextResponse = isResponseLike(invokeError.context) ? invokeError.context : null;
    return {
      kind: 'response',
      payload: await readResolverPayloadFromResponse(response ?? contextResponse),
    };
  }

  return { kind: 'transient_failure' };
}

async function resolveChatMediaUrl(
  messageId: string,
  mediaKind: MediaAssetKind,
  rawRef: string | null | undefined,
): Promise<string | null> {
  if (!rawRef) return null;
  if ((mediaKind === 'vibe_clip' || mediaKind === 'video') && isBunnyStreamRef(rawRef)) return rawRef;
  if (isLocalMediaAssetRef(rawRef) || isResolvedMediaAssetUrl(rawRef) || !isUuid(messageId)) return rawRef;

  return getCachedMediaAssetUrl(messageId, mediaKind, rawRef);
}

function passthroughMediaAsset(rawRef: string): MediaAssetResolveResult {
  return {
    url: rawRef,
    posterUrl: null,
    playbackKind: isHlsMediaAssetUrl(rawRef) ? 'hls' : 'progressive',
    provider: isResolvedMediaAssetUrl(rawRef) ? 'remote' : 'local',
    expiresAtMs: Number.POSITIVE_INFINITY,
  };
}

export async function getCachedMediaAsset(
  messageId: string,
  mediaKind: MediaAssetKind,
  rawRef: string | null | undefined,
): Promise<MediaAssetResolveResult | null> {
  if (!rawRef) return null;
  const profileRef = mediaKind === 'profile_vibe_video' ? parseProfileVibeVideoRef(rawRef) : null;
  if (profileRef) return issueAndCacheMediaAsset(profileRef.profileId, mediaKind, rawRef, false);
  if (isLocalMediaAssetRef(rawRef) || isResolvedMediaAssetUrl(rawRef) || !isUuid(messageId)) return passthroughMediaAsset(rawRef);

  return issueAndCacheMediaAsset(messageId, mediaKind, rawRef, false);
}

export async function getCachedMediaAssetUrl(
  messageId: string,
  mediaKind: MediaAssetKind,
  rawRef: string | null | undefined,
): Promise<string | null> {
  return (await getCachedMediaAsset(messageId, mediaKind, rawRef))?.url ?? null;
}

export async function refreshMediaAsset(
  messageId: string,
  mediaKind: MediaAssetKind,
  rawRef: string | null | undefined,
  options: MediaAssetRefreshOptions = {},
): Promise<MediaAssetResolveResult | null> {
  if (!rawRef) return null;
  const profileRef = mediaKind === 'profile_vibe_video' ? parseProfileVibeVideoRef(rawRef) : null;
  if (profileRef) return issueAndCacheMediaAsset(profileRef.profileId, mediaKind, rawRef, true, options);
  if (isLocalMediaAssetRef(rawRef) || !isUuid(messageId)) return passthroughMediaAsset(rawRef);

  return issueAndCacheMediaAsset(messageId, mediaKind, rawRef, true, options);
}

export async function refreshMediaAssetUrl(
  messageId: string,
  mediaKind: MediaAssetKind,
  rawRef: string | null | undefined,
  options: MediaAssetRefreshOptions = {},
): Promise<string | null> {
  return (await refreshMediaAsset(messageId, mediaKind, rawRef, options))?.url ?? null;
}

export async function syncChatVibeClipUploadStatus(input: {
  messageId?: string | null;
  uploadId?: string | null;
  clientRequestId?: string | null;
}): Promise<ChatVibeClipStatusSyncResult | null> {
  const messageId = input.messageId?.trim() ?? '';
  const uploadId = input.uploadId?.trim() ?? '';
  const clientRequestId = input.clientRequestId?.trim() ?? '';
  if (!isUuid(messageId) && !isUuid(uploadId) && !isUuid(clientRequestId)) return null;
  try {
    const accessToken = await getFreshCachedAccessToken();
    if (!accessToken) return null;
    const body: Record<string, string> = {};
    if (isUuid(messageId)) body.message_id = messageId;
    if (isUuid(uploadId)) body.upload_id = uploadId;
    if (isUuid(clientRequestId)) body.client_request_id = clientRequestId;
    const { data, error } = await supabase.functions.invoke('sync-chat-vibe-clip-status', {
      body,
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (error) return null;
    const payload = data as { status?: unknown; message_id?: unknown; provider_object_id?: unknown } | null;
    const status = payload?.status;
    if (status !== 'uploading' && status !== 'processing' && status !== 'ready' && status !== 'failed') {
      return null;
    }
    return {
      status,
      messageId: typeof payload?.message_id === 'string' && isUuid(payload.message_id) ? payload.message_id : null,
      providerObjectId: typeof payload?.provider_object_id === 'string' && payload.provider_object_id.trim()
        ? payload.provider_object_id.trim()
        : null,
    };
  } catch {
    return null;
  }
}

export async function syncChatVibeClipStatus(messageId: string): Promise<ChatVibeClipProcessingStatus | null> {
  const result = await syncChatVibeClipUploadStatus({ messageId });
  return result?.status ?? null;
}

async function issueAndCacheMediaAsset(
  messageId: string,
  mediaKind: MediaAssetKind,
  rawRef: string,
  forceRefresh: boolean,
  options: MediaAssetRefreshOptions = {},
): Promise<MediaAssetResolveResult | null> {
  const cacheKey = `${messageId}:${mediaKind}:${rawRef}`;
  const now = Date.now();
  const cached = mediaUrlCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAtMs > now) return cached;
  const recentFailure = mediaUrlFailureCache.get(cacheKey);
  if (!options.bypassFailureCooldown && recentFailure && recentFailure.expiresAtMs > now) return null;
  mediaUrlFailureCache.delete(cacheKey);

  const inFlight = mediaUrlInFlightRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async (): Promise<MediaUrlIssueResult> => {
    try {
      const accessToken = await getFreshCachedAccessToken();
      if (!accessToken) return { kind: 'transient_failure' };
      const profileRef = mediaKind === 'profile_vibe_video' ? parseProfileVibeVideoRef(rawRef) : null;
      const { data, error, response } = await supabase.functions.invoke('get-chat-media-url', {
        body: profileRef
          ? { profileId: profileRef.profileId, mediaKind, sourceRef: rawRef }
          : { messageId, mediaKind },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (error) return issueResultForFunctionInvokeError(error, response);
      return { kind: 'response', payload: data as ResolverResponse | null };
    } catch {
      return { kind: 'transient_failure' };
    }
  })();

  const resolved = request.then((result) => {
    if (result.kind === 'transient_failure') return null;
    const { payload } = result;
    if (!payload?.success || typeof payload.url !== 'string' || !payload.url) {
      mediaUrlFailureCache.set(cacheKey, { expiresAtMs: Date.now() + SIGNED_MEDIA_FAILURE_COOLDOWN_MS });
      return null;
    }

    mediaUrlFailureCache.delete(cacheKey);
    const expiresInMs =
      typeof payload.expiresInSeconds === 'number' &&
      Number.isFinite(payload.expiresInSeconds) &&
      payload.expiresInSeconds > 0
        ? Math.max(1_000, payload.expiresInSeconds * 1000 - SIGNED_MEDIA_TTL_SAFETY_MS)
        : DEFAULT_SIGNED_MEDIA_TTL_MS;
    const expiresAtMs = Date.now() + expiresInMs;
    const resolvedAsset: MediaAssetResolveResult = {
      url: payload.url,
      posterUrl: typeof payload.posterUrl === 'string' && payload.posterUrl ? payload.posterUrl : null,
      playbackKind: payload.playbackKind === 'hls' ? 'hls' : 'progressive',
      provider: payload.provider === 'bunny_stream' || payload.provider === 'bunny_storage' ? payload.provider : 'remote',
      expiresAtMs,
    };
    mediaUrlCache.set(cacheKey, resolvedAsset);
    const thumbnailRef =
      payload.provider === 'bunny_stream' && (mediaKind === 'vibe_clip' || mediaKind === 'video')
        ? bunnyStreamThumbnailRefFor(rawRef)
        : null;
    if (thumbnailRef && typeof payload.posterUrl === 'string' && payload.posterUrl) {
      mediaUrlCache.set(`${messageId}:thumbnail:${thumbnailRef}`, {
        url: payload.posterUrl,
        posterUrl: null,
        playbackKind: 'progressive',
        provider: 'bunny_stream',
        expiresAtMs,
      });
    }
    return resolvedAsset;
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

export async function resolveMessageMediaForDisplay<
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

  const imageRef = extractChatImageMediaRef(row, { allowPrivateMediaRefs: true });
  if (imageRef) {
    const imageUrl = await resolveChatMediaUrl(row.id, 'image', imageRef);
    resolved.content = imageUrl ? formatChatImageMessageContent(imageUrl) : formatChatImageMessageContent('');
    if (payload?.kind === 'chat_image' && payload.v === 2 && payload.provider === 'bunny_storage') {
      payload.media_ref = imageUrl ?? '';
      resolved.structured_payload = payload;
    }
  }

  return resolved;
}
