import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { corsHeadersForRequest, jsonResponse, preflightResponse } from "../_shared/cors.ts";
import { syncChatMessageMedia } from "../_shared/media-lifecycle.ts";

type MediaKind = "image" | "voice" | "video" | "vibe_clip" | "thumbnail";
type ChatMediaUrlLogLevel = "info" | "warn" | "error";
type SafeLogValue = string | number | boolean | null | undefined;
type SafeLogFields = Record<string, SafeLogValue>;
type MessageScopeRow = {
  id: string;
  match_id: string;
  structured_payload?: Record<string, unknown> | null;
};
type MatchScopeRow = {
  id: string;
  profile_id_1: string;
  profile_id_2: string;
};
type MediaAssetRow = {
  id: string | null;
  provider: string | null;
  provider_object_id: string | null;
  provider_path: string | null;
  mime_type: string | null;
  status: string | null;
  media_family: string | null;
};

const TOKEN_TTL_SECONDS = 15 * 60;
const encoder = new TextEncoder();
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
    const padded = value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

async function signPayload(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64Url(new Uint8Array(signature));
}

function sortedSigningData(params: Record<string, string>): string {
  return Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function normalizeHostname(value: string): string {
  return value
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .toLowerCase();
}

async function signBunnyStreamDirectoryUrl(params: {
  hostname: string;
  securityKey: string;
  videoId: string;
  fileName: string;
  expires: number;
}): Promise<string> {
  const tokenPath = `/${params.videoId}/`;
  const signingData = sortedSigningData({ token_path: tokenPath });
  const token = `HS256-${await signPayload(params.securityKey, `${tokenPath}${params.expires}${signingData}`)}`;
  const tokenSegment = `bcdn_token=${token}&expires=${params.expires}&token_path=${encodeURIComponent(tokenPath)}`;
  return `https://${normalizeHostname(params.hostname)}/${tokenSegment}/${params.videoId}/${params.fileName}`;
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

function normalizeMediaKind(value: unknown): MediaKind | null {
  return value === "image" || value === "voice" || value === "video" || value === "vibe_clip" || value === "thumbnail"
    ? value
    : null;
}

function mediaFamilyForKind(kind: MediaKind): string {
  if (kind === "image") return "chat_image";
  if (kind === "voice") return "voice_message";
  if (kind === "thumbnail") return "chat_video_thumbnail";
  return "chat_video";
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

async function userCanReadMessage(serviceClient: any, userId: string, messageId: string): Promise<MessageScopeRow | null> {
  const { data: message, error: messageError } = await serviceClient
    .from("messages")
    .select("id, match_id, structured_payload")
    .eq("id", messageId)
    .maybeSingle();

  const messageRow = message as MessageScopeRow | null;
  if (messageError || !messageRow?.match_id) return null;

  const { data: match, error: matchError } = await serviceClient
    .from("matches")
    .select("id, profile_id_1, profile_id_2")
    .eq("id", messageRow.match_id)
    .maybeSingle();

  const matchRow = match as MatchScopeRow | null;
  if (matchError || !matchRow) return null;
  if (matchRow.profile_id_1 !== userId && matchRow.profile_id_2 !== userId) return null;
  return messageRow;
}

function clientRequestIdFromMessage(message: Record<string, unknown> | null | undefined): string | null {
  const payload = message?.structured_payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const clientRequestId = (payload as Record<string, unknown>).client_request_id;
  return typeof clientRequestId === "string" && clientRequestId.trim() ? clientRequestId.trim() : null;
}

async function resolveMessageAsset(serviceClient: any, messageId: string, kind: MediaKind): Promise<MediaAssetRow | null> {
  const { data, error } = await serviceClient
    .from("media_assets")
    .select("id, provider, provider_object_id, provider_path, mime_type, status, media_family")
    .eq("legacy_table", "messages")
    .eq("legacy_id", messageId)
    .in("media_family", kind === "thumbnail" ? ["chat_video", "chat_video_thumbnail"] : [mediaFamilyForKind(kind)])
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error || !Array.isArray(data)) return null;
  const rows = data as MediaAssetRow[];

  return (
    rows.find((asset) => {
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
    }) ?? null
  );
}

async function handleIssueUrl(req: Request): Promise<Response> {
  const corsHeaders = corsHeadersForRequest(req);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    logChatMediaUrl("warn", "issue_request_rejected", {
      reason: "unauthorized",
    });
    return jsonResponse(req, { success: false, error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const body = (await req.json().catch(() => null)) as {
    messageId?: unknown;
    mediaKind?: unknown;
  } | null;
  const messageId = body?.messageId;
  const mediaKind = normalizeMediaKind(body?.mediaKind);
  if (!isUuid(messageId) || !mediaKind) {
    logChatMediaUrl("warn", "issue_request_rejected", {
      reason: "invalid_request",
      message_id: typeof messageId === "string" ? messageId : null,
      media_kind: mediaKind,
    });
    return jsonResponse(req, { success: false, error: "invalid_request" }, { status: 400, headers: corsHeaders });
  }
  logChatMediaUrl("info", "issue_request_validated", {
    message_id: messageId,
    media_kind: mediaKind,
  });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const tokenSecret = Deno.env.get("CHAT_MEDIA_PROXY_SECRET") || serviceRoleKey;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) {
    logChatMediaUrl("warn", "issue_request_rejected", {
      reason: "unauthorized",
      message_id: messageId,
      media_kind: mediaKind,
    });
    return jsonResponse(req, { success: false, error: "Unauthorized" }, { status: 401, headers: corsHeaders });
  }

  const message = await userCanReadMessage(serviceClient, user.id, messageId);
  if (!message) {
    logChatMediaUrl("warn", "message_scope_rejected", {
      requester_id: user.id,
      message_id: messageId,
      media_kind: mediaKind,
    });
    return jsonResponse(req, { success: false, error: "not_found" }, { status: 404, headers: corsHeaders });
  }
  const clientRequestId = clientRequestIdFromMessage(message as Record<string, unknown>);
  logChatMediaUrl("info", "message_scope_verified", {
    requester_id: user.id,
    message_id: messageId,
    match_id: typeof message.match_id === "string" ? message.match_id : null,
    media_kind: mediaKind,
    client_request_id: clientRequestId,
  });

  let asset = await resolveMessageAsset(serviceClient, messageId, mediaKind);
  if (!asset?.provider_path && !asset?.provider_object_id) {
    logChatMediaUrl("info", "asset_missing_sync_requested", {
      requester_id: user.id,
      message_id: messageId,
      media_kind: mediaKind,
      client_request_id: clientRequestId,
    });
    const syncResult = await syncChatMessageMedia(serviceClient, messageId);
    if (!syncResult.success) {
      logChatMediaUrl("error", "asset_sync_failed", {
        requester_id: user.id,
        message_id: messageId,
        media_kind: mediaKind,
        client_request_id: clientRequestId,
        error_code: syncResult.error,
      });
    }
    asset = await resolveMessageAsset(serviceClient, messageId, mediaKind);
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
        requester_id: user.id,
        message_id: messageId,
        media_kind: mediaKind,
        client_request_id: clientRequestId,
        asset_id: typeof asset.id === "string" ? asset.id : null,
        provider_object_id: streamVideoId,
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
    const posterUrl =
      mediaKind === "thumbnail"
        ? null
        : await signBunnyStreamDirectoryUrl({
            hostname,
            securityKey,
            videoId: streamVideoId,
            fileName: "thumbnail.jpg",
            expires,
          });

    logChatMediaUrl("info", "stream_url_issued", {
      requester_id: user.id,
      message_id: messageId,
      media_kind: mediaKind,
      client_request_id: clientRequestId,
      asset_id: typeof asset.id === "string" ? asset.id : null,
      provider_object_id: streamVideoId,
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
      },
      { headers: corsHeaders },
    );
  }

  if (!asset?.provider_path) {
    logChatMediaUrl("warn", "asset_not_found", {
      requester_id: user.id,
      message_id: messageId,
      media_kind: mediaKind,
      client_request_id: clientRequestId,
    });
    return jsonResponse(req, { success: false, error: "media_not_found" }, { status: 404, headers: corsHeaders });
  }

  const token = await createToken(tokenSecret, {
    sub: user.id,
    mid: messageId,
    kind: mediaKind,
    path: asset.provider_path,
    mime: asset.mime_type ?? "application/octet-stream",
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  });

  logChatMediaUrl("info", "storage_proxy_token_issued", {
    requester_id: user.id,
    message_id: messageId,
    media_kind: mediaKind,
    client_request_id: clientRequestId,
    asset_id: typeof asset.id === "string" ? asset.id : null,
    provider: "bunny_storage",
    playback_kind: "progressive",
    expires_in_seconds: TOKEN_TTL_SECONDS,
  });
  return jsonResponse(
    req,
    {
      success: true,
      url: `${supabaseUrl.replace(/\/$/, "")}/functions/v1/get-chat-media-url?token=${encodeURIComponent(token)}`,
      playbackKind: "progressive",
      provider: "bunny_storage",
      expiresInSeconds: TOKEN_TTL_SECONDS,
    },
    { headers: corsHeaders },
  );
}

async function handleProxy(req: Request): Promise<Response> {
  const corsHeaders = corsHeadersForRequest(req);
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const tokenSecret = Deno.env.get("CHAT_MEDIA_PROXY_SECRET") || serviceRoleKey;
  const claims = await verifyToken(tokenSecret, token);
  const path = typeof claims?.path === "string" ? claims.path : "";
  const mime = typeof claims?.mime === "string" ? claims.mime : "application/octet-stream";
  if (!claims || !path || path.includes("..")) {
    logChatMediaUrl("warn", "proxy_request_rejected", {
      reason: "invalid_token",
      message_id: typeof claims?.mid === "string" ? claims.mid : null,
      media_kind: normalizeMediaKind(claims?.kind),
    });
    return jsonResponse(req, { success: false, error: "invalid_token" }, { status: 401, headers: corsHeaders });
  }

  const storageZone = Deno.env.get("BUNNY_STORAGE_ZONE")!;
  const apiKey = Deno.env.get("BUNNY_STORAGE_API_KEY")!;
  const upstreamHeaders: Record<string, string> = { AccessKey: apiKey };
  const range = req.headers.get("Range");
  if (range) upstreamHeaders.Range = range;

  const upstream = await fetch(`https://storage.bunnycdn.com/${storageZone}/${path}`, {
    headers: upstreamHeaders,
  });

  if (!upstream.ok || !upstream.body) {
    logChatMediaUrl("error", "storage_proxy_fetch_failed", {
      message_id: typeof claims.mid === "string" ? claims.mid : null,
      media_kind: normalizeMediaKind(claims.kind),
      provider_status: upstream.status,
      has_range: Boolean(range),
    });
    return jsonResponse(req, { success: false, error: "media_fetch_failed" }, { status: 502, headers: corsHeaders });
  }

  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", upstream.headers.get("Content-Type") || mime);
  headers.set("Cache-Control", "private, max-age=60");
  headers.set("Accept-Ranges", upstream.headers.get("Accept-Ranges") || "bytes");
  for (const key of ["Content-Length", "Content-Range"]) {
    const value = upstream.headers.get(key);
    if (value) headers.set(key, value);
  }

  logChatMediaUrl("info", "storage_proxy_stream_started", {
    message_id: typeof claims.mid === "string" ? claims.mid : null,
    media_kind: normalizeMediaKind(claims.kind),
    provider_status: upstream.status,
    has_range: Boolean(range),
  });
  return new Response(upstream.body, { status: upstream.status, headers });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return preflightResponse(req);
  if (req.method === "GET") return handleProxy(req);
  if (req.method === "POST") return handleIssueUrl(req);
  return jsonResponse(
    req,
    { success: false, error: "method_not_allowed" },
    { status: 405, headers: corsHeadersForRequest(req) },
  );
});
