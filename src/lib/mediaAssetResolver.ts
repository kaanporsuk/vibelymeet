import { supabase } from "@/integrations/supabase/client";
import {
  formatChatImageMessageContent,
  extractChatImageMediaRef,
} from "@/lib/chatMessageContent";
import { isNetworkInvokeError, type FunctionInvokeErrorShape } from "@/lib/supabaseFunctionInvokeErrors";

export type MediaAssetKind = "image" | "voice" | "video" | "vibe_clip" | "thumbnail" | "profile_vibe_video";
export type MediaAssetResolveResult = {
  url: string;
  posterUrl: string | null;
  playbackKind: "hls" | "progressive";
  provider: "bunny_stream" | "bunny_storage" | "local" | "remote";
  expiresAtMs: number;
  placeholderKind: "dominant_color" | null;
  placeholderHash: string | null;
  dominantColor: string | null;
};
export type MediaAssetResolveErrorCode =
  | "network_error"
  | "auth_expired"
  | "asset_deleted"
  | "provider_unreachable"
  | "resolver_error";
export type ChatVibeClipProcessingStatus = "uploading" | "processing" | "ready" | "failed";
export type ChatVibeClipStatusSyncResult = {
  uploadId: string | null;
  matchId: string | null;
  clientRequestId: string | null;
  status: ChatVibeClipProcessingStatus;
  messageId: string | null;
  providerObjectId: string | null;
  expiresAt: string | null;
  updatedAt: string | null;
  providerReachable: boolean;
  providerError: string | null;
};

type ResolverResponse = {
  success?: boolean;
  url?: string;
  posterUrl?: string | null;
  playbackKind?: "hls" | "progressive";
  provider?: "bunny_stream" | "bunny_storage";
  expiresInSeconds?: number;
  placeholderKind?: "dominant_color" | null;
  placeholderHash?: string | null;
  dominantColor?: string | null;
  error?: string;
};

type CachedMediaUrl = MediaAssetResolveResult & { lastAccessedMs: number };
type CachedMediaFailure = {
  expiresAtMs: number;
  attempts: number;
  errorCode: MediaAssetResolveErrorCode;
};

type MediaUrlIssueResult =
  | { kind: "response"; payload: ResolverResponse | null }
  | { kind: "transient_failure"; errorCode: MediaAssetResolveErrorCode };

export type MediaAssetRefreshOptions = {
  bypassFailureCooldown?: boolean;
  variant?: "display" | "original";
};

export type MediaAssetPrewarmInput = {
  messageId?: string | null;
  kind: MediaAssetKind;
  sourceRef?: string | null;
};

export type MediaAssetPrewarmOptions = {
  concurrency?: number;
  forceRefresh?: boolean;
};

const DEFAULT_SIGNED_MEDIA_TTL_MS = 4 * 60 * 1000;
const SIGNED_MEDIA_TTL_SAFETY_MS = 15 * 1000;
const SIGNED_MEDIA_FAILURE_COOLDOWN_MS = 8_000;
const SIGNED_MEDIA_FAILURE_COOLDOWN_MAX_MS = 5 * 60 * 1000;
const MEDIA_URL_CACHE_MAX_ENTRIES = 200;
const MEDIA_URL_CACHE_STORAGE_KEY = "vibely.media-url-cache.v1";
const mediaUrlCache = new Map<string, CachedMediaUrl>();
const mediaUrlFailureCache = new Map<string, CachedMediaFailure>();
const mediaUrlInFlightRequests = new Map<string, Promise<MediaAssetResolveResult | null>>();
let testMediaUrlIssuer: ((messageId: string, mediaKind: MediaAssetKind) => Promise<ResolverResponse | null>) | null = null;
let activePersistentMediaUrlCacheKey: string | null = null;

export function isLocalMediaAssetRef(value: string): boolean {
  return value.startsWith("blob:") || value.startsWith("file:") || value.startsWith("data:");
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
  return value.startsWith("bunny_stream:");
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
    typeof value === "object" &&
    value !== null &&
    typeof (value as Response).clone === "function" &&
    typeof (value as Response).text === "function"
  );
}

async function readResolverPayloadFromResponse(response: Response | null | undefined): Promise<ResolverResponse | null> {
  if (!response) return null;
  try {
    const text = await response.clone().text();
    if (!text) return null;
    const parsed = JSON.parse(text) as ResolverResponse;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function resolverPayloadForHttpFailure(response: Response | null | undefined): Promise<ResolverResponse | null> {
  if (!response) return null;
  const payload = await readResolverPayloadFromResponse(response);
  if (payload) return payload;
  if (response.status === 401 || response.status === 403) return { success: false, error: "auth_expired" };
  if (response.status === 404 || response.status === 410) return { success: false, error: "asset_deleted" };
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    return { success: false, error: "provider_unreachable" };
  }
  return { success: false, error: `http_${response.status}` };
}

async function issueResultForFunctionInvokeError(
  error: unknown,
  response: Response | null | undefined,
): Promise<MediaUrlIssueResult> {
  const invokeError = error as FunctionInvokeErrorShape | null;
  if (!invokeError || isNetworkInvokeError(invokeError) || invokeError.name === "FunctionsRelayError") {
    return { kind: "transient_failure", errorCode: "network_error" };
  }

  if (invokeError.name === "FunctionsHttpError") {
    const contextResponse = isResponseLike(invokeError.context) ? invokeError.context : null;
    return {
      kind: "response",
      payload: await resolverPayloadForHttpFailure(response ?? contextResponse),
    };
  }

  return { kind: "transient_failure", errorCode: "resolver_error" };
}

async function resolveChatMediaUrl(
  messageId: string,
  mediaKind: MediaAssetKind,
  rawRef: string | null | undefined,
): Promise<string | null> {
  if (!rawRef) return null;
  if ((mediaKind === "vibe_clip" || mediaKind === "video") && isBunnyStreamRef(rawRef)) return rawRef;
  if (isLocalMediaAssetRef(rawRef) || isResolvedMediaAssetUrl(rawRef) || !isUuid(messageId)) return rawRef;

  return getCachedMediaAssetUrl(messageId, mediaKind, rawRef);
}

function passthroughMediaAsset(rawRef: string): MediaAssetResolveResult {
  return {
    url: rawRef,
    posterUrl: null,
    playbackKind: isHlsMediaAssetUrl(rawRef) ? "hls" : "progressive",
    provider: isResolvedMediaAssetUrl(rawRef) ? "remote" : "local",
    expiresAtMs: Number.POSITIVE_INFINITY,
    placeholderKind: null,
    placeholderHash: null,
    dominantColor: null,
  };
}

export async function getCachedMediaAsset(
  messageId: string,
  mediaKind: MediaAssetKind,
  rawRef: string | null | undefined,
): Promise<MediaAssetResolveResult | null> {
  if (!rawRef) return null;
  const profileRef = mediaKind === "profile_vibe_video" ? parseProfileVibeVideoRef(rawRef) : null;
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
  const profileRef = mediaKind === "profile_vibe_video" ? parseProfileVibeVideoRef(rawRef) : null;
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

function resolveVariantKey(options?: Pick<MediaAssetRefreshOptions, "variant">): "display" | "original" {
  return options?.variant === "original" ? "original" : "display";
}

function cacheKeyForMediaAsset(
  messageId: string,
  mediaKind: MediaAssetKind,
  rawRef: string,
  variant: "display" | "original" = "display",
): string {
  const profileRef = mediaKind === "profile_vibe_video" ? parseProfileVibeVideoRef(rawRef) : null;
  return `${profileRef?.profileId ?? messageId}:${mediaKind}:${variant}:${rawRef}`;
}

function classifyResolverFailure(payload: ResolverResponse | null): MediaAssetResolveErrorCode {
  const error = typeof payload?.error === "string" ? payload.error : "";
  if (/auth|token|jwt|unauthori[sz]ed|forbidden|permission/i.test(error)) return "auth_expired";
  if (/not[_ -]?found|missing|deleted|asset_deleted/i.test(error)) return "asset_deleted";
  if (/provider|bunny|cdn|unreachable|timeout/i.test(error)) return "provider_unreachable";
  return "resolver_error";
}

function sweepExpiredMediaUrlEntries(nowMs = Date.now()) {
  let changed = false;
  for (const [key, value] of mediaUrlCache.entries()) {
    if (value.expiresAtMs <= nowMs) {
      mediaUrlCache.delete(key);
      changed = true;
    }
  }
  for (const [key, value] of mediaUrlFailureCache.entries()) {
    if (value.expiresAtMs + SIGNED_MEDIA_FAILURE_COOLDOWN_MAX_MS <= nowMs) mediaUrlFailureCache.delete(key);
  }
  if (changed) persistMediaUrlCache();
}

function pruneMediaUrlCache() {
  if (mediaUrlCache.size <= MEDIA_URL_CACHE_MAX_ENTRIES) return;
  const entries = [...mediaUrlCache.entries()].sort((a, b) => a[1].lastAccessedMs - b[1].lastAccessedMs);
  for (const [key] of entries.slice(0, mediaUrlCache.size - MEDIA_URL_CACHE_MAX_ENTRIES)) {
    mediaUrlCache.delete(key);
  }
}

function cacheMediaUrl(cacheKey: string, asset: MediaAssetResolveResult, nowMs = Date.now()) {
  mediaUrlCache.set(cacheKey, { ...asset, lastAccessedMs: nowMs });
  pruneMediaUrlCache();
  persistMediaUrlCache();
}

function canUseSessionStorage(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function isPersistableCachedMediaUrl(value: CachedMediaUrl, nowMs = Date.now()): boolean {
  return (
    typeof value.url === "string" &&
    value.url.length > 0 &&
    Number.isFinite(value.expiresAtMs) &&
    value.expiresAtMs > nowMs
  );
}

function readCachedMediaUrl(value: unknown): CachedMediaUrl | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<CachedMediaUrl>;
  if (typeof record.url !== "string" || !record.url) return null;
  const playbackKind = record.playbackKind === "hls" ? "hls" : "progressive";
  const provider =
    record.provider === "bunny_stream" ||
    record.provider === "bunny_storage" ||
    record.provider === "local" ||
    record.provider === "remote"
      ? record.provider
      : "remote";
  const expiresAtMs =
    typeof record.expiresAtMs === "number" && Number.isFinite(record.expiresAtMs)
      ? record.expiresAtMs
      : 0;
  const lastAccessedMs =
    typeof record.lastAccessedMs === "number" && Number.isFinite(record.lastAccessedMs)
      ? record.lastAccessedMs
      : 0;
  return {
    url: record.url,
    posterUrl: typeof record.posterUrl === "string" && record.posterUrl ? record.posterUrl : null,
    playbackKind,
    provider,
    expiresAtMs,
    placeholderKind: record.placeholderKind === "dominant_color" ? "dominant_color" : null,
    placeholderHash: typeof record.placeholderHash === "string" && record.placeholderHash ? record.placeholderHash : null,
    dominantColor: typeof record.dominantColor === "string" && /^#[0-9a-f]{6}$/i.test(record.dominantColor)
      ? record.dominantColor.toLowerCase()
      : null,
    lastAccessedMs,
  };
}

async function currentPersistentMediaUrlCacheKey(): Promise<string | null> {
  if (!canUseSessionStorage()) return null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    return userId ? `${MEDIA_URL_CACHE_STORAGE_KEY}:${userId}` : null;
  } catch {
    return null;
  }
}

async function hydratePersistentMediaUrlCache(nowMs = Date.now()) {
  const storageKey = await currentPersistentMediaUrlCacheKey();
  if (activePersistentMediaUrlCacheKey === storageKey) return;
  mediaUrlCache.clear();
  mediaUrlFailureCache.clear();
  mediaUrlInFlightRequests.clear();
  activePersistentMediaUrlCacheKey = storageKey;
  if (!storageKey || !canUseSessionStorage()) return;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") continue;
      const cached = readCachedMediaUrl(entry[1]);
      if (cached && isPersistableCachedMediaUrl(cached, nowMs)) {
        mediaUrlCache.set(entry[0], cached);
      }
    }
    pruneMediaUrlCache();
  } catch {
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      // Ignore storage failures; media can always be re-issued.
    }
  }
}

function persistMediaUrlCache(nowMs = Date.now()) {
  const storageKey = activePersistentMediaUrlCacheKey;
  if (!storageKey || !canUseSessionStorage()) return;
  try {
    const entries = [...mediaUrlCache.entries()]
      .filter(([, value]) => isPersistableCachedMediaUrl(value, nowMs))
      .sort((a, b) => b[1].lastAccessedMs - a[1].lastAccessedMs)
      .slice(0, MEDIA_URL_CACHE_MAX_ENTRIES);
    window.sessionStorage.setItem(storageKey, JSON.stringify(entries));
  } catch {
    // Storage quota/private mode should not affect playback.
  }
}

function recordMediaUrlFailure(cacheKey: string, errorCode: MediaAssetResolveErrorCode) {
  const previous = mediaUrlFailureCache.get(cacheKey);
  const attempts = Math.min((previous?.attempts ?? 0) + 1, 7);
  const cooldownMs = Math.min(
    SIGNED_MEDIA_FAILURE_COOLDOWN_MS * 2 ** Math.max(0, attempts - 1),
    SIGNED_MEDIA_FAILURE_COOLDOWN_MAX_MS,
  );
  mediaUrlFailureCache.set(cacheKey, {
    attempts,
    errorCode,
    expiresAtMs: Date.now() + cooldownMs,
  });
}

export function getCachedMediaAssetFailureCode(
  messageId: string,
  mediaKind: MediaAssetKind,
  rawRef: string | null | undefined,
): MediaAssetResolveErrorCode | null {
  if (!rawRef) return null;
  const failure = mediaUrlFailureCache.get(cacheKeyForMediaAsset(messageId, mediaKind, rawRef));
  return failure?.errorCode ?? null;
}

export async function syncChatVibeClipUploadStatus(input: {
  messageId?: string | null;
  uploadId?: string | null;
  clientRequestId?: string | null;
}): Promise<ChatVibeClipStatusSyncResult | null> {
  const messageId = input.messageId?.trim() ?? "";
  const uploadId = input.uploadId?.trim() ?? "";
  const clientRequestId = input.clientRequestId?.trim() ?? "";
  if (!isUuid(messageId) && !isUuid(uploadId) && !isUuid(clientRequestId)) return null;
  try {
    const body: Record<string, string> = {};
    if (isUuid(messageId)) body.message_id = messageId;
    if (isUuid(uploadId)) body.upload_id = uploadId;
    if (isUuid(clientRequestId)) body.client_request_id = clientRequestId;
    const { data, error } = await supabase.functions.invoke("sync-chat-vibe-clip-status", {
      body,
    });
    if (error) return null;
    const payload = data as {
      upload_id?: unknown;
      match_id?: unknown;
      client_request_id?: unknown;
      status?: unknown;
      message_id?: unknown;
      provider_object_id?: unknown;
      expires_at?: unknown;
      updated_at?: unknown;
      provider_reachable?: unknown;
      provider_error?: unknown;
    } | null;
    const status = payload?.status;
    if (status !== "uploading" && status !== "processing" && status !== "ready" && status !== "failed") {
      return null;
    }
    return {
      uploadId: typeof payload?.upload_id === "string" && isUuid(payload.upload_id) ? payload.upload_id : null,
      matchId: typeof payload?.match_id === "string" && isUuid(payload.match_id) ? payload.match_id : null,
      clientRequestId: typeof payload?.client_request_id === "string" && isUuid(payload.client_request_id)
        ? payload.client_request_id
        : null,
      status,
      messageId: typeof payload?.message_id === "string" && isUuid(payload.message_id) ? payload.message_id : null,
      providerObjectId: typeof payload?.provider_object_id === "string" && payload.provider_object_id.trim()
        ? payload.provider_object_id.trim()
        : null,
      expiresAt: typeof payload?.expires_at === "string" && payload.expires_at.trim() ? payload.expires_at.trim() : null,
      updatedAt: typeof payload?.updated_at === "string" && payload.updated_at.trim() ? payload.updated_at.trim() : null,
      providerReachable: payload?.provider_reachable !== false,
      providerError: typeof payload?.provider_error === "string" && payload.provider_error.trim()
        ? payload.provider_error.trim()
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
  await hydratePersistentMediaUrlCache();
  const variant = resolveVariantKey(options);
  const cacheKey = cacheKeyForMediaAsset(messageId, mediaKind, rawRef, variant);
  const now = Date.now();
  sweepExpiredMediaUrlEntries(now);
  const cached = mediaUrlCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAtMs > now) {
    cached.lastAccessedMs = now;
    return cached;
  }
  const recentFailure = mediaUrlFailureCache.get(cacheKey);
  if (!options.bypassFailureCooldown && recentFailure && recentFailure.expiresAtMs > now) return null;

  const inFlight = mediaUrlInFlightRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async (): Promise<MediaUrlIssueResult> => {
    try {
      if (testMediaUrlIssuer) {
        return { kind: "response", payload: await testMediaUrlIssuer(messageId, mediaKind) };
      }
      const profileRef = mediaKind === "profile_vibe_video" ? parseProfileVibeVideoRef(rawRef) : null;
      const { data, error, response } = await supabase.functions.invoke("get-chat-media-url", {
        body: profileRef
          ? { profileId: profileRef.profileId, mediaKind, sourceRef: rawRef }
          : { messageId, mediaKind, ...(variant === "original" ? { variant } : {}) },
      });
      if (error) return issueResultForFunctionInvokeError(error, response);
      return { kind: "response", payload: data as ResolverResponse | null };
    } catch {
      return { kind: "transient_failure", errorCode: "network_error" };
    }
  })();

  const resolved = request.then((result) => {
    if (result.kind === "transient_failure") {
      recordMediaUrlFailure(cacheKey, result.errorCode);
      return null;
    }
    const { payload } = result;
    if (!payload?.success || typeof payload.url !== "string" || !payload.url) {
      recordMediaUrlFailure(cacheKey, classifyResolverFailure(payload));
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
    const resolvedAsset: MediaAssetResolveResult = {
      url: payload.url,
      posterUrl: typeof payload.posterUrl === "string" && payload.posterUrl ? payload.posterUrl : null,
      playbackKind: payload.playbackKind === "hls" ? "hls" : "progressive",
      provider: payload.provider === "bunny_stream" || payload.provider === "bunny_storage" ? payload.provider : "remote",
      expiresAtMs,
      placeholderKind: payload.placeholderKind === "dominant_color" ? "dominant_color" : null,
      placeholderHash: typeof payload.placeholderHash === "string" && payload.placeholderHash ? payload.placeholderHash : null,
      dominantColor: typeof payload.dominantColor === "string" && /^#[0-9a-f]{6}$/i.test(payload.dominantColor)
        ? payload.dominantColor.toLowerCase()
        : null,
    };
    cacheMediaUrl(cacheKey, resolvedAsset);
    const thumbnailRef =
      payload.provider === "bunny_stream" && (mediaKind === "vibe_clip" || mediaKind === "video")
        ? bunnyStreamThumbnailRefFor(rawRef)
        : null;
    if (thumbnailRef && typeof payload.posterUrl === "string" && payload.posterUrl) {
      cacheMediaUrl(cacheKeyForMediaAsset(messageId, "thumbnail", thumbnailRef), {
        url: payload.posterUrl,
        posterUrl: null,
        playbackKind: "progressive",
        provider: "bunny_stream",
        expiresAtMs,
        placeholderKind: resolvedAsset.placeholderKind,
        placeholderHash: resolvedAsset.placeholderHash,
        dominantColor: resolvedAsset.dominantColor,
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

function prewarmKeyForInput(input: MediaAssetPrewarmInput): string | null {
  const sourceRef = input.sourceRef?.trim();
  if (!sourceRef) return null;
  const messageId = input.messageId?.trim() ?? "";
  return cacheKeyForMediaAsset(messageId, input.kind, sourceRef);
}

function prefetchRenderableAsset(input: MediaAssetPrewarmInput, result: MediaAssetResolveResult): void {
  if (typeof window === "undefined" || typeof window.Image === "undefined") return;
  const url =
    input.kind === "image" || input.kind === "thumbnail"
      ? result.url
      : result.posterUrl;
  if (!url || !/^https?:\/\//i.test(url)) return;
  try {
    const image = new window.Image();
    image.decoding = "async";
    image.src = url;
  } catch {
    // Decode prefetch is opportunistic; signed URL cache remains the source of truth.
  }
}

export async function prewarmMediaAssets(
  inputs: readonly MediaAssetPrewarmInput[],
  options: MediaAssetPrewarmOptions = {},
): Promise<MediaAssetResolveResult[]> {
  if (!inputs.length) return [];
  const uniqueInputs = new Map<string, MediaAssetPrewarmInput>();
  for (const input of inputs) {
    const key = prewarmKeyForInput(input);
    if (!key || uniqueInputs.has(key)) continue;
    uniqueInputs.set(key, input);
  }
  const queue = [...uniqueInputs.values()];
  if (!queue.length) return [];

  const concurrency = Math.max(1, Math.min(8, Math.floor(options.concurrency ?? 4)));
  const results: MediaAssetResolveResult[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const input = queue[cursor++];
      const sourceRef = input.sourceRef?.trim();
      if (!sourceRef) continue;
      const messageId = input.messageId?.trim() ?? "";
      const result = options.forceRefresh
        ? await refreshMediaAsset(messageId, input.kind, sourceRef, { bypassFailureCooldown: true })
        : await getCachedMediaAsset(messageId, input.kind, sourceRef);
      if (result?.url) {
        results.push(result);
        prefetchRenderableAsset(input, result);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
  return results;
}

export function __clearChatMediaUrlCacheForTests() {
  mediaUrlCache.clear();
  mediaUrlFailureCache.clear();
  mediaUrlInFlightRequests.clear();
  if (canUseSessionStorage()) {
    try {
      if (activePersistentMediaUrlCacheKey) {
        window.sessionStorage.removeItem(activePersistentMediaUrlCacheKey);
      }
    } catch {
      // Ignore storage failures in test/locked-down runtimes.
    }
  }
  activePersistentMediaUrlCacheKey = null;
}

export function __chatMediaUrlCacheSizeForTests() {
  return mediaUrlCache.size;
}

export function __setChatMediaUrlIssuerForTests(
  issuer: ((messageId: string, mediaKind: MediaAssetKind) => Promise<ResolverResponse | null>) | null,
) {
  testMediaUrlIssuer = issuer;
}

function mediaPlaceholderPayload(result: MediaAssetResolveResult | null): Record<string, string> | null {
  if (result?.placeholderKind === "dominant_color" && result.dominantColor) {
    return {
      kind: "dominant_color",
      hash: result.placeholderHash ?? result.dominantColor,
      dominant_color: result.dominantColor,
    };
  }
  return null;
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
    const thumbnailAsset = await getCachedMediaAsset(row.id, "thumbnail", thumbnailRef);
    payload.thumbnail_url = thumbnailAsset?.url ?? "";
    const placeholder = mediaPlaceholderPayload(thumbnailAsset);
    if (placeholder) payload.thumbnail_placeholder = placeholder;
    resolved.structured_payload = payload;
  }

  const imageRef = extractChatImageMediaRef(row, { allowPrivateMediaRefs: true });
  if (imageRef) {
    const imageAsset = await getCachedMediaAsset(row.id, "image", imageRef);
    const imageUrl = imageAsset?.url ?? null;
    if (imageUrl) {
      resolved.content = formatChatImageMessageContent(imageUrl);
      if (payload?.kind === "chat_image" && payload.v === 2 && payload.provider === "bunny_storage") {
        payload.media_ref = imageUrl;
        const placeholder = mediaPlaceholderPayload(imageAsset);
        if (placeholder) payload.media_placeholder = placeholder;
        resolved.structured_payload = payload;
      }
    }
  }

  return resolved;
}
