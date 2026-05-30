import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { isBlurhashValid } from "https://esm.sh/blurhash@2.0.5";
import * as Sentry from "https://deno.land/x/sentry@8.55.0/index.mjs";
import { bunnyStorageConfigForTier, type BunnyStorageZoneTier } from "../_shared/bunny-media.ts";
import { signBunnyStorageUrl, signBunnyStreamDirectoryUrl } from "../_shared/bunny-stream-tokens.ts";
import { corsHeadersForRequest, jsonResponse, preflightResponse } from "../_shared/cors.ts";
import { syncChatMessageMedia } from "../_shared/media-lifecycle.ts";
import { captureMediaTelemetry, sanitizeMediaTelemetryProperties } from "../_shared/media-telemetry.ts";

type MediaKind = "image" | "voice" | "video" | "vibe_clip" | "thumbnail" | "profile_vibe_video";
type MediaResolveVariant = "display" | "original";

const TOKEN_TTL_SECONDS = 15 * 60;
// Safety margin so a cached proxy response never outlives the signed token in its URL.
const PROXY_CACHE_SAFETY_SECONDS = 15;
const SENTRY_FLUSH_TIMEOUT_MS = 1000;
const encoder = new TextEncoder();
let sentryInitialized = false;

if (!Deno.env.get("BUNNY_STREAM_TOKEN_SECURITY_KEY")?.trim()) {
  console.warn(JSON.stringify({
    scope: "chat_media_url",
    function: "get-chat-media-url",
    event: "profile_stream_token_config_missing_at_init",
    profile_stream_token_security_key_configured: false,
  }));
}

type MessageScopeRow = {
  id: string;
  match_id: string | null;
  structured_payload?: unknown;
  client_request_id?: string | null;
};

type MatchScopeRow = {
  id: string;
  profile_id_1: string | null;
  profile_id_2: string | null;
};

type MediaAssetRow = {
  id: string;
  provider: string | null;
  provider_object_id: string | null;
  provider_path: string | null;
  derivative_thumb_path?: string | null;
  derivative_display_path?: string | null;
  derivative_hero_path?: string | null;
  placeholder_kind?: string | null;
  placeholder_hash?: string | null;
  dominant_color?: string | null;
  mime_type: string | null;
  status: string | null;
  media_family: string | null;
  storage_zone: string | null;
};

type ProfileVibeVideoRpcPayload = {
  id?: unknown;
  vibe_video_playback_ref?: unknown;
  vibe_video_signed_playback_required?: unknown;
};

type ProfileVideoRef = {
  profileId: string;
  videoId: string;
};

type ChatMediaUrlLogLevel = "info" | "warn" | "error";
type SafeLogValue = string | number | boolean | null | undefined;
type SafeLogFields = Record<string, SafeLogValue>;
const MEDIA_ASSET_RESOLVE_SELECT =
  "id, provider, provider_object_id, provider_path, derivative_thumb_path, derivative_display_path, derivative_hero_path, placeholder_kind, placeholder_hash, dominant_color, mime_type, status, media_family, storage_zone";
const MEDIA_ASSET_LEGACY_RESOLVE_SELECT =
  "id, provider, provider_object_id, provider_path, derivative_thumb_path, derivative_hero_path, placeholder_kind, placeholder_hash, dominant_color, mime_type, status, media_family, storage_zone";

const SENSITIVE_LOG_KEY_PATTERN =
  /(auth|authorization|bearer|token|secret|signature|apikey|accesskey|headers?|url|uri|path|(?:^|_)(?:file|filename)(?:$|_))/i;

function sanitizeLogFields(fields: SafeLogFields = {}): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (SENSITIVE_LOG_KEY_PATTERN.test(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      out[key] = value;
    }
  }
  return out;
}

function logChatMediaUrl(level: ChatMediaUrlLogLevel, event: string, fields: SafeLogFields = {}): void {
  const payload = JSON.stringify({
    scope: "chat_media_url",
    function: "get-chat-media-url",
    event,
    ...sanitizeLogFields(fields),
  });

  if (level === "error") {
    console.error(payload);
  } else if (level === "warn") {
    console.warn(payload);
  } else {
    console.info(payload);
  }
}

function isMissingDisplayDerivativeColumn(error: unknown): boolean {
  const message = typeof (error as { message?: unknown } | null)?.message === "string"
    ? (error as { message: string }).message
    : "";
  return /derivative_display_path/i.test(message);
}

function normalizeStoragePathForProxy(value: string): string {
  return value.trim().replace(/^\/+/, "");
}

function encodeStoragePathForProxy(value: string): string {
  return normalizeStoragePathForProxy(value).split("/").map(encodeURIComponent).join("/");
}

function captureProfileVibeVideoConfigMissingWithSentry(fields: Record<string, unknown>) {
  const dsn = Deno.env.get("SENTRY_DSN")?.trim();
  if (!dsn) return;
  try {
    if (!sentryInitialized) {
      Sentry.init({ dsn, tracesSampleRate: 0 });
      sentryInitialized = true;
    }
    Sentry.captureMessage("profile_vibe_video_token_config_missing", {
      level: "error",
      tags: {
        function: "get-chat-media-url",
        media_kind: "profile_vibe_video",
        provider: "bunny_stream",
      },
      extra: sanitizeMediaTelemetryProperties(fields),
    });
    void Sentry.flush(SENTRY_FLUSH_TIMEOUT_MS).catch(() => {});
  } catch {
    // Observability must never break media URL issuance.
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlJson(value: unknown): string {
  return base64Url(encoder.encode(JSON.stringify(value)));
}

function decodeBase64UrlJson<T>(value: string): T | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

async function signPayload(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64Url(new Uint8Array(signature));
}

async function createToken(secret: string, claims: Record<string, unknown>): Promise<string> {
  const payload = base64UrlJson(claims);
  const signature = await signPayload(secret, payload);
  return `${payload}.${signature}`;
}

async function verifyToken(secret: string, token: string): Promise<Record<string, unknown> | null> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = await signPayload(secret, payload);
  if (expected.length !== signature.length) return null;

  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  if (diff !== 0) return null;

  const claims = decodeBase64UrlJson<Record<string, unknown>>(payload);
  const exp = typeof claims?.exp === "number" ? claims.exp : 0;
  if (!claims || exp <= Math.floor(Date.now() / 1000)) return null;
  return claims;
}

async function sha256TelemetryHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return base64Url(new Uint8Array(digest)).slice(0, 24);
}

function normalizeMediaKind(value: unknown): MediaKind | null {
  return value === "image" ||
    value === "voice" ||
    value === "video" ||
    value === "vibe_clip" ||
    value === "thumbnail" ||
    value === "profile_vibe_video"
    ? value
    : null;
}

function mediaFamilyForKind(kind: MediaKind): string {
  if (kind === "image") return "chat_image";
  if (kind === "voice") return "voice_message";
  if (kind === "profile_vibe_video") return "vibe_video";
  if (kind === "thumbnail") return "chat_video_thumbnail";
  return "chat_video";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseProfileVibeVideoRef(value: unknown): ProfileVideoRef | null {
  if (typeof value !== "string") return null;
  const match =
    /^profile_vibe_video:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([0-9a-f-]{32,36})$/i
      .exec(value.trim());
  return match ? { profileId: match[1], videoId: match[2] } : null;
}

function profileVibeVideoRef(profileId: string, videoId: string): string {
  return `profile_vibe_video:${profileId}:${videoId}`;
}

function extractClientRequestId(message: MessageScopeRow | null): string | null {
  const payload = message?.structured_payload;
  if (!payload || typeof payload !== "object") return null;
  const clientRequestId = (payload as Record<string, unknown>).client_request_id;
  return typeof clientRequestId === "string" && clientRequestId.trim() ? clientRequestId.trim() : null;
}

function normalizedAssetPath(value: string | null | undefined): string | null {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("://")) return null;
  return path;
}

function mimeTypeForStoragePath(path: string, fallback: string | null | undefined): string {
  const ext = path.split(/[?#]/, 1)[0]?.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "aac") return "audio/aac";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  return fallback ?? "application/octet-stream";
}

function normalizedPlaceholderKind(value: unknown): "dominant_color" | "blurhash" | null {
  return value === "dominant_color" || value === "blurhash" ? value : null;
}

function normalizedPlaceholderHash(kind: "dominant_color" | "blurhash" | null, value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const hash = value.trim();
  if (kind === "dominant_color") return /^#[0-9a-f]{6}$/i.test(hash) ? hash.toLowerCase() : null;
  if (kind === "blurhash") {
    if (!/^[0-9A-Za-z#$%*+,\-.:;=?@[\]^_{|}~]{6,120}$/.test(hash)) return null;
    const validation = isBlurhashValid(hash);
    return validation.result ? hash : null;
  }
  return null;
}

function storageObjectForAssetKind(
  asset: MediaAssetRow,
  kind: MediaKind,
  variant: MediaResolveVariant,
): { path: string; mimeType: string } | null {
  if (kind === "image" && variant !== "original") {
    const derivativePath = normalizedAssetPath(asset.derivative_display_path)
      ?? normalizedAssetPath(asset.derivative_hero_path)
      ?? normalizedAssetPath(asset.derivative_thumb_path);
    if (derivativePath) return { path: derivativePath, mimeType: mimeTypeForStoragePath(derivativePath, "image/jpeg") };
  }
  const providerPath = normalizedAssetPath(asset.provider_path);
  return providerPath ? { path: providerPath, mimeType: mimeTypeForStoragePath(providerPath, asset.mime_type) } : null;
}

function assetPresentationPayload(asset: MediaAssetRow | null | undefined): Record<string, string | null> {
  const placeholderKind = normalizedPlaceholderKind(asset?.placeholder_kind);
  const placeholderHash = normalizedPlaceholderHash(placeholderKind, asset?.placeholder_hash);
  const effectivePlaceholderKind = placeholderHash ? placeholderKind : null;
  const dominantColor = typeof asset?.dominant_color === "string" && /^#[0-9a-f]{6}$/i.test(asset.dominant_color)
    ? asset.dominant_color.toLowerCase()
    : null;
  return {
    placeholderKind: effectivePlaceholderKind,
    placeholderHash,
    dominantColor,
  };
}

async function userCanReadMessage(
  serviceClient: SupabaseClient,
  userId: string,
  messageId: string,
): Promise<MessageScopeRow | null> {
  const { data: messageData, error: messageError } = await serviceClient
    .from("messages")
    .select("id, match_id, structured_payload")
    .eq("id", messageId)
    .maybeSingle();
  const message = messageData as MessageScopeRow | null;

  if (messageError || !message?.match_id) return null;

  const { data: matchData, error: matchError } = await serviceClient
    .from("matches")
    .select("id, profile_id_1, profile_id_2")
    .eq("id", message.match_id)
    .maybeSingle();
  const match = matchData as MatchScopeRow | null;

  if (matchError || !match) return null;
  if (match.profile_id_1 !== userId && match.profile_id_2 !== userId) return null;
  return {
    ...message,
    client_request_id: extractClientRequestId(message),
  };
}

async function resolveMessageAsset(
  serviceClient: SupabaseClient,
  messageId: string,
  kind: MediaKind,
): Promise<MediaAssetRow | null> {
  const queryAssets = (selectColumns: string) =>
    serviceClient
      .from("media_assets")
      .select(selectColumns)
      .eq("legacy_table", "messages")
      .eq("legacy_id", messageId)
      .in("media_family", kind === "thumbnail" ? ["chat_video", "chat_video_thumbnail"] : [mediaFamilyForKind(kind)])
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(5);

  let { data, error } = await queryAssets(MEDIA_ASSET_RESOLVE_SELECT);
  if (error && isMissingDisplayDerivativeColumn(error)) {
    ({ data, error } = await queryAssets(MEDIA_ASSET_LEGACY_RESOLVE_SELECT));
  }

  if (error || !Array.isArray(data)) return null;

  const assets = data as unknown as MediaAssetRow[];
  return assets
    .find((asset) => {
      const objectId = typeof asset?.provider_object_id === "string" ? asset.provider_object_id : "";
      if (
        asset?.provider === "bunny_stream" &&
        asset.status !== "purged" &&
        objectId &&
        asset.media_family === "chat_video" &&
        (kind === "vibe_clip" || kind === "video" || kind === "thumbnail")
      ) {
        return true;
      }
      const path = typeof asset?.provider_path === "string" ? asset.provider_path : "";
      if (asset?.provider !== "bunny_storage" || asset.status === "purged" || !path) return false;
      if (kind === "image") return path.startsWith("photos/");
      if (kind === "voice") return path.startsWith("voice/");
      if (kind === "thumbnail") return path.includes("_thumb.");
      return path.startsWith("chat-videos/") && !path.includes("_thumb.");
    }) ?? null;
}

async function handleProfileVibeVideoIssue(params: {
  req: Request;
  corsHeaders: Record<string, string>;
  userClient: SupabaseClient;
  serviceClient: SupabaseClient;
  requesterId: string;
  profileId: string;
  sourceRef?: unknown;
}): Promise<Response> {
  const expectedRef = parseProfileVibeVideoRef(params.sourceRef);
  if (!expectedRef) {
    logChatMediaUrl("warn", "profile_vibe_video_ref_rejected", {
      reason: "missing_or_invalid_profile_ref",
      requester_id: params.requesterId,
      profile_id: params.profileId,
    });
    return jsonResponse(
      params.req,
      { success: false, error: "invalid_request" },
      { status: 400, headers: params.corsHeaders },
    );
  }

  if (expectedRef.profileId !== params.profileId) {
    logChatMediaUrl("warn", "profile_vibe_video_ref_rejected", {
      reason: "profile_ref_mismatch",
      requester_id: params.requesterId,
      profile_id: params.profileId,
    });
    return jsonResponse(
      params.req,
      { success: false, error: "stale_profile_vibe_video_ref" },
      { status: 409, headers: params.corsHeaders },
    );
  }

  const { data: safeProfile, error: profileRpcError } = await params.userClient.rpc("get_profile_for_viewer", {
    p_target_id: params.profileId,
  });
  const profilePayload =
    safeProfile && typeof safeProfile === "object" && !Array.isArray(safeProfile)
      ? safeProfile as ProfileVibeVideoRpcPayload
      : null;
  if (profileRpcError || !profilePayload || profilePayload.id !== params.profileId) {
    logChatMediaUrl("warn", "profile_scope_rejected", {
      requester_id: params.requesterId,
      profile_id: params.profileId,
      media_kind: "profile_vibe_video",
      error_code: profileRpcError ? "profile_rpc_failed" : "profile_not_visible",
    });
    return jsonResponse(
      params.req,
      { success: false, error: "not_found" },
      { status: 404, headers: params.corsHeaders },
    );
  }

  const { data: profileRow, error: profileLookupError } = await params.serviceClient
    .from("profiles")
    .select("id, bunny_video_uid, bunny_video_status")
    .eq("id", params.profileId)
    .maybeSingle();
  const profile = profileRow as { id?: string; bunny_video_uid?: string | null; bunny_video_status?: string | null } | null;
  const streamVideoId = typeof profile?.bunny_video_uid === "string" ? profile.bunny_video_uid.trim() : "";
  if (profileLookupError || !streamVideoId) {
    logChatMediaUrl("warn", "profile_vibe_video_missing", {
      requester_id: params.requesterId,
      profile_id: params.profileId,
      media_kind: "profile_vibe_video",
      error_code: profileLookupError ? "profile_lookup_failed" : "profile_video_missing",
    });
    return jsonResponse(
      params.req,
      { success: false, error: "media_not_found" },
      { status: 404, headers: params.corsHeaders },
    );
  }

  if (expectedRef.videoId !== streamVideoId) {
    logChatMediaUrl("warn", "profile_vibe_video_ref_rejected", {
      reason: "video_ref_mismatch",
      requester_id: params.requesterId,
      profile_id: params.profileId,
    });
    return jsonResponse(
      params.req,
      { success: false, error: "stale_profile_vibe_video_ref" },
      { status: 409, headers: params.corsHeaders },
    );
  }

  const profilePlaybackRef =
    typeof profilePayload.vibe_video_playback_ref === "string"
      ? profilePayload.vibe_video_playback_ref.trim()
      : "";
  if (profilePlaybackRef && profilePlaybackRef !== profileVibeVideoRef(params.profileId, streamVideoId)) {
    logChatMediaUrl("warn", "profile_vibe_video_ref_rejected", {
      reason: "rpc_ref_mismatch",
      requester_id: params.requesterId,
      profile_id: params.profileId,
    });
    return jsonResponse(
      params.req,
      { success: false, error: "stale_profile_vibe_video_ref" },
      { status: 409, headers: params.corsHeaders },
    );
  }

  if (!profile || profile.bunny_video_status !== "ready") {
    logChatMediaUrl("warn", "profile_vibe_video_not_ready", {
      requester_id: params.requesterId,
      profile_id: params.profileId,
      media_kind: "profile_vibe_video",
    });
    return jsonResponse(
      params.req,
      { success: false, error: "media_not_found" },
      { status: 404, headers: params.corsHeaders },
    );
  }

  const queryProfileAsset = (selectColumns: string) =>
    params.serviceClient
      .from("media_assets")
      .select(selectColumns)
      .eq("provider", "bunny_stream")
      .eq("provider_object_id", streamVideoId)
      .eq("media_family", "vibe_video")
      .neq("status", "purged")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  const profileAssetResult = await queryProfileAsset(MEDIA_ASSET_RESOLVE_SELECT);
  let assetRow = profileAssetResult.data;
  if (profileAssetResult.error && isMissingDisplayDerivativeColumn(profileAssetResult.error)) {
    assetRow = (await queryProfileAsset(MEDIA_ASSET_LEGACY_RESOLVE_SELECT)).data;
  }
  const profileAsset = assetRow as MediaAssetRow | null;

  const hostname = Deno.env.get("BUNNY_STREAM_CDN_HOSTNAME")?.trim();
  const securityKey = Deno.env.get("BUNNY_STREAM_TOKEN_SECURITY_KEY")?.trim();
  if (!hostname || !securityKey) {
    const [viewerIdHash, targetProfileIdHash] = await Promise.all([
      sha256TelemetryHash(params.requesterId),
      sha256TelemetryHash(params.profileId),
    ]);
    const configFields = {
      requester_id_hash: viewerIdHash,
      target_profile_id_hash: targetProfileIdHash,
      media_kind: "profile_vibe_video",
      hostname_configured: Boolean(hostname),
      token_security_key_configured: Boolean(securityKey),
    };
    logChatMediaUrl("error", "profile_stream_token_config_missing", {
      ...configFields,
    });
    captureProfileVibeVideoConfigMissingWithSentry(configFields);
    void captureMediaTelemetry({
      event: "profile_vibe_video_token_config_missing",
      distinct_id: viewerIdHash,
      properties: {
        function: "get-chat-media-url",
        provider: "bunny_stream",
        ...configFields,
      },
    });
    return jsonResponse(
      params.req,
      { success: false, error: "missing_bunny_profile_stream_token_config" },
      { status: 503, headers: params.corsHeaders },
    );
  }

  const expires = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const url = await signBunnyStreamDirectoryUrl({
    hostname,
    securityKey,
    videoId: streamVideoId,
    fileName: "playlist.m3u8",
    expires,
  });
  const posterUrl = await signBunnyStreamDirectoryUrl({
    hostname,
    securityKey,
    videoId: streamVideoId,
    fileName: "thumbnail.jpg",
    expires,
  });
  const [viewerIdHash, targetProfileIdHash] = await Promise.all([
    sha256TelemetryHash(params.requesterId),
    sha256TelemetryHash(params.profileId),
  ]);
  const issuedTelemetry = {
    viewer_id_hash: viewerIdHash,
    target_profile_id_hash: targetProfileIdHash,
    media_kind: "profile_vibe_video",
    playback_kind: "hls",
    expires_in_seconds: TOKEN_TTL_SECONDS,
    signed_required: profilePayload.vibe_video_signed_playback_required === true,
    security_key_configured: true,
  };

  logChatMediaUrl("info", "profile_stream_url_issued", {
    ...issuedTelemetry,
  });
  void captureMediaTelemetry({
    event: "profile_vibe_video_signed_url_issued",
    distinct_id: viewerIdHash,
    properties: {
      function: "get-chat-media-url",
      provider: "bunny_stream",
      ...issuedTelemetry,
    },
  });
  if (profileAsset?.id) {
    void params.serviceClient.rpc("mark_media_asset_accessed", { p_asset_id: profileAsset.id });
  }
  return jsonResponse(
    params.req,
    {
      success: true,
      url,
      posterUrl,
      playbackKind: "hls",
      provider: "bunny_stream",
      expiresInSeconds: TOKEN_TTL_SECONDS,
      ...assetPresentationPayload(profileAsset),
    },
    { headers: params.corsHeaders },
  );
}

async function handleHealth(req: Request): Promise<Response> {
  const corsHeaders = corsHeadersForRequest(req);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse(req, { success: false, error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const bearer = authHeader.slice("Bearer ".length).trim();
  const serviceRoleRequest = bearer === serviceRoleKey;

  if (!serviceRoleRequest) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse(req, { success: false, error: "Unauthorized" }, { status: 401, headers: corsHeaders });
    }
    const { data: roleRow, error: roleError } = await serviceClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (roleError || !roleRow) {
      return jsonResponse(req, { success: false, error: "forbidden" }, { status: 403, headers: corsHeaders });
    }
  }

  return jsonResponse(
    req,
    {
      success: true,
      function: "get-chat-media-url",
      token_ttl_seconds: TOKEN_TTL_SECONDS,
      chat_stream_hostname_configured: Boolean(Deno.env.get("BUNNY_CHAT_STREAM_CDN_HOSTNAME")?.trim()),
      chat_stream_token_security_key_configured: Boolean(Deno.env.get("BUNNY_CHAT_STREAM_TOKEN_SECURITY_KEY")?.trim()),
      profile_stream_hostname_configured: Boolean(Deno.env.get("BUNNY_STREAM_CDN_HOSTNAME")?.trim()),
      profile_stream_token_security_key_configured: Boolean(Deno.env.get("BUNNY_STREAM_TOKEN_SECURITY_KEY")?.trim()),
      storage_zone_configured: Boolean(Deno.env.get("BUNNY_STORAGE_ZONE")?.trim()),
      storage_api_key_configured: Boolean(Deno.env.get("BUNNY_STORAGE_API_KEY")?.trim()),
      archive_storage_zone_configured: Boolean(
        Deno.env.get("BUNNY_ARCHIVE_STORAGE_ZONE")?.trim() ||
          Deno.env.get("BUNNY_STORAGE_ARCHIVE_ZONE")?.trim(),
      ),
      archive_storage_api_key_configured: Boolean(
        Deno.env.get("BUNNY_ARCHIVE_STORAGE_API_KEY")?.trim() ||
          Deno.env.get("BUNNY_STORAGE_ARCHIVE_API_KEY")?.trim(),
      ),
    },
    { headers: corsHeaders },
  );
}

async function handleIssueUrl(req: Request): Promise<Response> {
  const corsHeaders = corsHeadersForRequest(req);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    logChatMediaUrl("warn", "issue_request_rejected", {
      reason: "missing_auth_header",
    });
    return jsonResponse(req, { success: false, error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const body = await req.json().catch(() => null) as {
    messageId?: unknown;
    profileId?: unknown;
    mediaKind?: unknown;
    sourceRef?: unknown;
    variant?: unknown;
  } | null;
  const messageId = body?.messageId;
  const profileId = body?.profileId;
  const mediaKind = normalizeMediaKind(body?.mediaKind);
  const resolveVariant: MediaResolveVariant = body?.variant === "original" ? "original" : "display";
  const isProfileVibeVideoRequest = mediaKind === "profile_vibe_video";
  if (
    !mediaKind ||
    (isProfileVibeVideoRequest ? !isUuid(profileId) : !isUuid(messageId))
  ) {
    logChatMediaUrl("warn", "issue_request_rejected", {
      reason: "invalid_request",
      has_message_id: typeof messageId === "string" && messageId.trim().length > 0,
      has_profile_id: typeof profileId === "string" && profileId.trim().length > 0,
      media_kind: typeof body?.mediaKind === "string" ? body.mediaKind : null,
    });
    return jsonResponse(req, { success: false, error: "invalid_request" }, { status: 400, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const tokenSecret = Deno.env.get("CHAT_MEDIA_PROXY_SECRET") || serviceRoleKey;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    logChatMediaUrl("warn", "issue_request_rejected", {
      reason: "auth_user_missing",
      message_id: isProfileVibeVideoRequest ? null : messageId as string,
      profile_id: isProfileVibeVideoRequest ? profileId as string : null,
      media_kind: mediaKind,
      error_code: userError ? "auth_user_lookup_failed" : null,
    });
    return jsonResponse(req, { success: false, error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }
  logChatMediaUrl("info", "issue_request_validated", {
    message_id: isProfileVibeVideoRequest ? null : messageId as string,
    profile_id: isProfileVibeVideoRequest ? profileId as string : null,
    media_kind: mediaKind,
    requester_id: user.id,
  });

  if (isProfileVibeVideoRequest) {
    return handleProfileVibeVideoIssue({
      req,
      corsHeaders,
      userClient,
      serviceClient,
      requesterId: user.id,
      profileId: profileId as string,
      sourceRef: body?.sourceRef,
    });
  }

  const scopedMessageId = messageId as string;
  const message = await userCanReadMessage(serviceClient, user.id, scopedMessageId);
  if (!message) {
    logChatMediaUrl("warn", "message_scope_rejected", {
      message_id: scopedMessageId,
      media_kind: mediaKind,
      requester_id: user.id,
    });
    return jsonResponse(req, { success: false, error: "not_found" }, { status: 404, headers: corsHeaders });
  }
  const clientRequestId = message.client_request_id ?? null;
  logChatMediaUrl("info", "message_scope_verified", {
    message_id: scopedMessageId,
    media_kind: mediaKind,
    requester_id: user.id,
    match_id: message.match_id,
    client_request_id: clientRequestId,
  });

  let asset = await resolveMessageAsset(serviceClient, scopedMessageId, mediaKind);
  if (!asset?.provider_path && !asset?.provider_object_id) {
    logChatMediaUrl("info", "asset_missing_sync_requested", {
      message_id: scopedMessageId,
      media_kind: mediaKind,
      requester_id: user.id,
      client_request_id: clientRequestId,
    });
    const syncResult = await syncChatMessageMedia(serviceClient, scopedMessageId);
    if (!syncResult.success) {
      logChatMediaUrl("error", "asset_sync_failed", {
        message_id: scopedMessageId,
        media_kind: mediaKind,
        requester_id: user.id,
        client_request_id: clientRequestId,
        error_code: "sync_chat_message_media_failed",
      });
    }
    asset = await resolveMessageAsset(serviceClient, scopedMessageId, mediaKind);
  }

  const streamVideoId = typeof asset?.provider_object_id === "string" ? asset.provider_object_id.trim() : "";
  if (
    asset?.provider === "bunny_stream" &&
    streamVideoId &&
    (mediaKind === "vibe_clip" || mediaKind === "video" || mediaKind === "thumbnail")
  ) {
    const hostname = Deno.env.get("BUNNY_CHAT_STREAM_CDN_HOSTNAME")?.trim();
    const securityKey = Deno.env.get("BUNNY_CHAT_STREAM_TOKEN_SECURITY_KEY")?.trim();
    if (!hostname || !securityKey) {
      logChatMediaUrl("error", "stream_token_config_missing", {
        message_id: scopedMessageId,
        media_kind: mediaKind,
        requester_id: user.id,
        client_request_id: clientRequestId,
        provider_object_id: streamVideoId,
        asset_id: asset.id,
      });
      return jsonResponse(
        req,
        { success: false, error: "missing_bunny_chat_stream_token_config" },
        { status: 503, headers: corsHeaders },
      );
    }

    const expires = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const url = await signBunnyStreamDirectoryUrl({
      hostname,
      securityKey,
      videoId: streamVideoId,
      fileName: mediaKind === "thumbnail" ? "thumbnail.jpg" : "playlist.m3u8",
      expires,
    });
    const posterUrl = mediaKind === "thumbnail"
      ? null
      : await signBunnyStreamDirectoryUrl({
        hostname,
        securityKey,
        videoId: streamVideoId,
        fileName: "thumbnail.jpg",
        expires,
      });

    void serviceClient.rpc("mark_media_asset_accessed", { p_asset_id: asset.id });

    logChatMediaUrl("info", "stream_url_issued", {
      message_id: scopedMessageId,
      media_kind: mediaKind,
      requester_id: user.id,
      client_request_id: clientRequestId,
      provider_object_id: streamVideoId,
      asset_id: asset.id,
      playback_kind: mediaKind === "thumbnail" ? "progressive" : "hls",
      expires_in_seconds: TOKEN_TTL_SECONDS,
    });
    return jsonResponse(
      req,
      {
        success: true,
        url,
        posterUrl,
        playbackKind: mediaKind === "thumbnail" ? "progressive" : "hls",
        provider: "bunny_stream",
        expiresInSeconds: TOKEN_TTL_SECONDS,
        ...assetPresentationPayload(asset),
      },
      { headers: corsHeaders },
    );
  }

  if (!asset?.provider_path) {
    logChatMediaUrl("warn", "asset_not_found", {
      message_id: scopedMessageId,
      media_kind: mediaKind,
      requester_id: user.id,
      client_request_id: clientRequestId,
    });
    return jsonResponse(req, { success: false, error: "media_not_found" }, { status: 404, headers: corsHeaders });
  }

  const storageZone: BunnyStorageZoneTier = asset.storage_zone === "archive" ? "archive" : "hot";
  void serviceClient.rpc("mark_media_asset_accessed", { p_asset_id: asset.id });

  const storageObject = storageObjectForAssetKind(asset, mediaKind, resolveVariant);
  if (!storageObject) {
    logChatMediaUrl("warn", "asset_not_found", {
      message_id: scopedMessageId,
      media_kind: mediaKind,
      requester_id: user.id,
      client_request_id: clientRequestId,
    });
    return jsonResponse(req, { success: false, error: "media_not_found" }, { status: 404, headers: corsHeaders });
  }

  // Tier 2: prefer signed direct Bunny CDN delivery when configured + flag-enabled.
  // Eliminates the Supabase Edge bandwidth + Bunny origin egress of the proxy and serves
  // from Bunny's edge. Falls through to the proxy below when not configured (default).
  const directCdn = directChatStorageCdnConfigForTier(storageZone);
  if (directCdn) {
    const directExpires = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const directUrl = await signBunnyStorageUrl({
      hostname: directCdn.hostname,
      securityKey: directCdn.securityKey,
      path: storageObject.path,
      expires: directExpires,
    });
    logChatMediaUrl("info", "storage_direct_cdn_url_issued", {
      message_id: scopedMessageId,
      media_kind: mediaKind,
      requester_id: user.id,
      client_request_id: clientRequestId,
      asset_id: asset.id,
      provider: asset.provider,
      storage_zone: storageZone,
      expires_in_seconds: TOKEN_TTL_SECONDS,
      variant: resolveVariant,
      delivery: "direct_cdn",
    });
    return jsonResponse(
      req,
      {
        success: true,
        url: directUrl,
        playbackKind: "progressive",
        provider: "bunny_storage",
        expiresInSeconds: TOKEN_TTL_SECONDS,
        ...assetPresentationPayload(asset),
      },
      { headers: corsHeaders },
    );
  }

  const token = await createToken(tokenSecret, {
    sub: user.id,
    mid: scopedMessageId,
    kind: mediaKind,
    path: storageObject.path,
    zone: storageZone,
    mime: storageObject.mimeType,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  });

  logChatMediaUrl("info", "storage_proxy_token_issued", {
    message_id: scopedMessageId,
    media_kind: mediaKind,
    requester_id: user.id,
    client_request_id: clientRequestId,
    asset_id: asset.id,
    provider: asset.provider,
    storage_zone: storageZone,
    expires_in_seconds: TOKEN_TTL_SECONDS,
    variant: resolveVariant,
  });
  return jsonResponse(
    req,
    {
      success: true,
      url: `${supabaseUrl.replace(/\/$/, "")}/functions/v1/get-chat-media-url?token=${encodeURIComponent(token)}`,
      playbackKind: "progressive",
      provider: "bunny_storage",
      expiresInSeconds: TOKEN_TTL_SECONDS,
      ...assetPresentationPayload(asset),
    },
    { headers: corsHeaders },
  );
}

/**
 * Tier-2 signed direct-CDN delivery for private chat Storage media. Returns null
 * (→ Edge proxy fallback) unless `CHAT_MEDIA_DIRECT_CDN_ENABLED` is on AND a
 * token-auth pull-zone hostname + security key are configured for the tier. Default
 * off, so behavior is identical to the proxy path until explicitly enabled. Never
 * reuses the public `BUNNY_CDN_HOSTNAME` (profile/event media) — chat media stays
 * access-controlled via a dedicated token-auth zone.
 */
function directChatStorageCdnConfigForTier(
  tier: BunnyStorageZoneTier,
): { hostname: string; securityKey: string } | null {
  const enabled = (Deno.env.get("CHAT_MEDIA_DIRECT_CDN_ENABLED") ?? "").trim().toLowerCase();
  if (enabled !== "true" && enabled !== "1") return null;
  const hostEnv = tier === "archive"
    ? "BUNNY_CHAT_STORAGE_ARCHIVE_CDN_HOSTNAME"
    : "BUNNY_CHAT_STORAGE_CDN_HOSTNAME";
  const keyEnv = tier === "archive"
    ? "BUNNY_CHAT_STORAGE_ARCHIVE_TOKEN_SECURITY_KEY"
    : "BUNNY_CHAT_STORAGE_TOKEN_SECURITY_KEY";
  const hostname = (Deno.env.get(hostEnv) ?? "").trim();
  const securityKey = (Deno.env.get(keyEnv) ?? "").trim();
  if (!hostname || !securityKey) return null;
  return { hostname, securityKey };
}

async function handleProxy(req: Request): Promise<Response> {
  const corsHeaders = corsHeadersForRequest(req);
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const tokenSecret = Deno.env.get("CHAT_MEDIA_PROXY_SECRET") || serviceRoleKey;
  const claims = await verifyToken(tokenSecret, token);
  const path = typeof claims?.path === "string" ? normalizeStoragePathForProxy(claims.path) : "";
  const storageTier: BunnyStorageZoneTier = claims?.zone === "archive" ? "archive" : "hot";
  const mime = typeof claims?.mime === "string" ? claims.mime : "application/octet-stream";
  if (!claims || !path || path.includes("..")) {
    logChatMediaUrl("warn", "proxy_request_rejected", {
      reason: "invalid_token",
      has_claims: Boolean(claims),
      has_media_reference: path.length > 0,
    });
    return jsonResponse(req, { success: false, error: "invalid_token" }, { status: 401, headers: corsHeaders });
  }

  let storageConfig: ReturnType<typeof bunnyStorageConfigForTier>;
  try {
    storageConfig = bunnyStorageConfigForTier(storageTier);
  } catch (err) {
    logChatMediaUrl("error", "storage_proxy_config_missing", {
      message_id: typeof claims.mid === "string" ? claims.mid : null,
      media_kind: typeof claims.kind === "string" ? claims.kind : null,
      requester_id: typeof claims.sub === "string" ? claims.sub : null,
      storage_zone: storageTier,
      error_code: String(err).slice(0, 120),
    });
    return jsonResponse(req, { success: false, error: "storage_config_missing" }, { status: 503, headers: corsHeaders });
  }
  const upstreamHeaders: Record<string, string> = { AccessKey: storageConfig.apiKey };
  const range = req.headers.get("Range");
  if (range) upstreamHeaders.Range = range;

  const upstream = await fetch(`https://storage.bunnycdn.com/${storageConfig.zone}/${encodeStoragePathForProxy(path)}`, {
    headers: upstreamHeaders,
  });

  if (!upstream.ok || !upstream.body) {
    logChatMediaUrl("error", "storage_proxy_fetch_failed", {
      message_id: typeof claims.mid === "string" ? claims.mid : null,
      media_kind: typeof claims.kind === "string" ? claims.kind : null,
      requester_id: typeof claims.sub === "string" ? claims.sub : null,
      storage_zone: storageTier,
      upstream_status: upstream.status,
      has_range: Boolean(range),
    });
    return jsonResponse(req, { success: false, error: "media_fetch_failed" }, { status: 502, headers: corsHeaders });
  }

  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", upstream.headers.get("Content-Type") || mime);
  // Token-aligned client caching. Storage objects are content-addressed (req-{hash}) and
  // therefore immutable, so the same signed URL can be reused for the full life of its
  // token. Cap at the token TTL and subtract a safety margin so a cached response never
  // outlives the token embedded in its URL. `private` keeps the per-user URL out of any
  // shared/CDN cache. Replaces the previous fixed max-age=60, which forced repeat views
  // within the token window to re-stream through Supabase + Bunny origin.
  const nowSeconds = Math.floor(Date.now() / 1000);
  const tokenExpSeconds = typeof claims.exp === "number" ? claims.exp : nowSeconds;
  const proxyMaxAgeSeconds = Math.max(
    0,
    Math.min(TOKEN_TTL_SECONDS, tokenExpSeconds - nowSeconds - PROXY_CACHE_SAFETY_SECONDS),
  );
  headers.set("Cache-Control", `private, max-age=${proxyMaxAgeSeconds}, immutable`);
  headers.set("Accept-Ranges", upstream.headers.get("Accept-Ranges") || "bytes");
  for (const key of ["Content-Length", "Content-Range"]) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }

  logChatMediaUrl("info", "storage_proxy_stream_started", {
    message_id: typeof claims.mid === "string" ? claims.mid : null,
    media_kind: typeof claims.kind === "string" ? claims.kind : null,
    requester_id: typeof claims.sub === "string" ? claims.sub : null,
    storage_zone: storageTier,
    upstream_status: upstream.status,
    has_range: Boolean(range),
  });
  return new Response(upstream.body, { status: upstream.status, headers });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return preflightResponse(req);
  if (req.method === "GET" && new URL(req.url).searchParams.get("health") === "1") return handleHealth(req);
  if (req.method === "GET") return handleProxy(req);
  if (req.method === "POST") return handleIssueUrl(req);
  return jsonResponse(req, { success: false, error: "method_not_allowed" }, { status: 405, headers: corsHeadersForRequest(req) });
});
