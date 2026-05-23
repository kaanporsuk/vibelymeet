import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import * as Sentry from "https://deno.land/x/sentry@8.55.0/index.mjs";
import { jsonResponse, preflightResponse } from "../_shared/cors.ts";
import { captureMediaTelemetry, sanitizeMediaTelemetryProperties } from "../_shared/media-telemetry.ts";
import {
  ChatVibeClipUploadRow,
  getAdminClient,
  getChatStreamConfig,
  isUuid,
  mapBunnyStatusToChatClipStatus,
  updateChatVibeClipStatusByProvider,
} from "../_shared/chat-vibe-clips.ts";

const SENTRY_FLUSH_TIMEOUT_MS = 1000;
let sentryInitialized = false;

function logSyncTransition(event: string, fields: Record<string, unknown> = {}) {
  console.info(JSON.stringify({
    scope: "chat_vibe_clip_upload",
    function: "sync-chat-vibe-clip-status",
    event,
    ...fields,
  }));
}

type BunnyStatusRead = {
  status: "processing" | "ready" | "failed";
  rawStatus: unknown;
  providerReachable: boolean;
  providerError: string | null;
  providerHttpStatus: number | null;
};

function captureProviderUnavailableWithSentry(fields: Record<string, unknown>) {
  const dsn = Deno.env.get("SENTRY_DSN")?.trim();
  if (!dsn) return;
  try {
    if (!sentryInitialized) {
      Sentry.init({ dsn, tracesSampleRate: 0 });
      sentryInitialized = true;
    }
    Sentry.captureMessage("chat_vibe_clip_provider_unreachable", {
      level: "warning",
      tags: {
        function: "sync-chat-vibe-clip-status",
        media_kind: "chat_vibe_clip",
        provider: "bunny_stream",
      },
      extra: fields,
    });
    void Sentry.flush(SENTRY_FLUSH_TIMEOUT_MS).catch(() => {});
  } catch {
    // Observability must never break recovery.
  }
}

function recordProviderUnavailable(fields: Record<string, unknown> & { distinct_id?: string }) {
  logSyncTransition("media_provider_unreachable", fields);
  captureProviderUnavailableWithSentry(sanitizeMediaTelemetryProperties(fields));
  void captureMediaTelemetry({
    event: "media_provider_unreachable",
    distinct_id: fields.distinct_id ?? "server",
    properties: {
      function: "sync-chat-vibe-clip-status",
      media_kind: "chat_vibe_clip",
      provider: "bunny_stream",
      ...fields,
    },
  });
}

async function getAuthedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}

type MessageScopeRow = {
  id: string;
  match_id: string | null;
};

type MatchScopeRow = {
  id: string;
  profile_id_1: string | null;
  profile_id_2: string | null;
};

async function userCanReadMessage(admin: SupabaseClient, userId: string, messageId: string): Promise<boolean> {
  const { data: messageData } = await admin
    .from("messages")
    .select("id, match_id")
    .eq("id", messageId)
    .maybeSingle();
  const message = messageData as MessageScopeRow | null;
  if (!message?.match_id) return false;
  const { data: matchData } = await admin
    .from("matches")
    .select("id, profile_id_1, profile_id_2")
    .eq("id", message.match_id)
    .maybeSingle();
  const match = matchData as MatchScopeRow | null;
  return Boolean(match && (match.profile_id_1 === userId || match.profile_id_2 === userId));
}

async function readBunnyStatus(videoId: string): Promise<BunnyStatusRead> {
  const config = getChatStreamConfig();
  if (!config) {
    return {
      status: "processing",
      rawStatus: null,
      providerReachable: false,
      providerError: "missing_bunny_stream_config",
      providerHttpStatus: null,
    };
  }
  const res = await fetch(`https://video.bunnycdn.com/library/${config.libraryId}/videos/${videoId}`, {
    headers: { AccessKey: config.apiKey },
  }).catch(() => null);
  if (!res) {
    return {
      status: "processing",
      rawStatus: null,
      providerReachable: false,
      providerError: "bunny_status_fetch_failed",
      providerHttpStatus: null,
    };
  }
  if (!res.ok) {
    return {
      status: "processing",
      rawStatus: null,
      providerReachable: false,
      providerError: `bunny_status_http_${res.status}`,
      providerHttpStatus: res.status,
    };
  }
  const data = await res.json().catch(() => null) as { status?: unknown } | null;
  const status = mapBunnyStatusToChatClipStatus(data?.status);
  return {
    status: status === "ready" || status === "failed" ? status : "processing",
    rawStatus: data?.status ?? null,
    providerReachable: true,
    providerError: null,
    providerHttpStatus: res.status,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return preflightResponse(req);
  if (req.method !== "POST") {
    return jsonResponse(req, { success: false, error: "method_not_allowed" }, { status: 405 });
  }

  try {
    const user = await getAuthedUser(req);
    if (!user) return jsonResponse(req, { success: false, error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const uploadId = typeof body?.upload_id === "string" ? body.upload_id.trim() : "";
    const messageId = typeof body?.message_id === "string" ? body.message_id.trim() : "";
    const clientRequestId = typeof body?.client_request_id === "string" ? body.client_request_id.trim() : "";
    if (!isUuid(uploadId) && !isUuid(messageId) && !isUuid(clientRequestId)) {
      return jsonResponse(req, { success: false, error: "invalid_request" }, { status: 400 });
    }
    logSyncTransition("request_validated", {
      upload_id: isUuid(uploadId) ? uploadId : null,
      message_id: isUuid(messageId) ? messageId : null,
      client_request_id: isUuid(clientRequestId) ? clientRequestId : null,
      requester_id: user.id,
    });

    const admin = getAdminClient();
    let query = admin.from("chat_vibe_clip_uploads").select("*").limit(1);
    if (isUuid(uploadId)) query = query.eq("id", uploadId);
    else if (isUuid(messageId)) query = query.eq("published_message_id", messageId);
    else query = query.eq("sender_id", user.id).eq("client_request_id", clientRequestId);

    const { data, error } = await query.maybeSingle();
    if (error) {
      logSyncTransition("upload_lookup_failed", {
        upload_id: isUuid(uploadId) ? uploadId : null,
        message_id: isUuid(messageId) ? messageId : null,
        client_request_id: isUuid(clientRequestId) ? clientRequestId : null,
        requester_id: user.id,
        error: error.message,
      });
      return jsonResponse(req, { success: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      logSyncTransition("upload_not_found", {
        upload_id: isUuid(uploadId) ? uploadId : null,
        message_id: isUuid(messageId) ? messageId : null,
        client_request_id: isUuid(clientRequestId) ? clientRequestId : null,
        requester_id: user.id,
      });
      return jsonResponse(req, { success: false, error: "upload_not_found" }, { status: 404 });
    }
    const upload = data as ChatVibeClipUploadRow;
    logSyncTransition("upload_loaded", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      requester_id: user.id,
      provider_object_id: upload.provider_object_id,
      media_asset_id: upload.media_asset_id ?? null,
      status: upload.status,
      published_message_id: upload.published_message_id ?? null,
    });

    const canRead = upload.sender_id === user.id ||
      (upload.published_message_id ? await userCanReadMessage(admin, user.id, upload.published_message_id) : false);
    if (!canRead) {
      logSyncTransition("read_scope_rejected", {
        upload_id: upload.id,
        client_request_id: upload.client_request_id,
        match_id: upload.match_id,
        sender_id: upload.sender_id,
        requester_id: user.id,
        provider_object_id: upload.provider_object_id,
        media_asset_id: upload.media_asset_id ?? null,
        status: upload.status,
      });
      return jsonResponse(req, { success: false, error: "not_found" }, { status: 404 });
    }
    logSyncTransition("read_scope_verified", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      requester_id: user.id,
      provider_object_id: upload.provider_object_id,
      media_asset_id: upload.media_asset_id ?? null,
      status: upload.status,
    });

    const bunny = await readBunnyStatus(upload.provider_object_id);
    if (!bunny.providerReachable) {
      recordProviderUnavailable({
        distinct_id: upload.sender_id,
        upload_id: upload.id,
        client_request_id: upload.client_request_id,
        match_id: upload.match_id,
        sender_id: upload.sender_id,
        requester_id: user.id,
        provider_object_id: upload.provider_object_id,
        provider_error: bunny.providerError,
        provider_http_status: bunny.providerHttpStatus,
        previous_status: upload.status,
      });
      return jsonResponse(req, {
        success: true,
        status: upload.status,
        raw_status: null,
        upload_id: upload.id,
        match_id: upload.match_id,
        client_request_id: upload.client_request_id,
        message_id: upload.published_message_id ?? null,
        provider_object_id: upload.provider_object_id,
        expires_at: upload.expires_at,
        updated_at: upload.updated_at,
        provider_reachable: false,
        provider_error: bunny.providerError,
        provider_http_status: bunny.providerHttpStatus,
      });
    }
    logSyncTransition("bunny_status_read", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      requester_id: user.id,
      provider_object_id: upload.provider_object_id,
      media_asset_id: upload.media_asset_id ?? null,
      previous_status: upload.status,
      mapped_status: bunny.status,
      raw_status: typeof bunny.rawStatus === "number" ? bunny.rawStatus : null,
      provider_reachable: bunny.providerReachable,
    });
    const update = await updateChatVibeClipStatusByProvider(
      admin,
      upload.provider_object_id,
      bunny.status,
      bunny.status === "failed" ? `bunny_status_${bunny.rawStatus ?? "unknown"}` : null,
      { publishIfProcessing: bunny.rawStatus === 7 && upload.sender_id === user.id },
    );
    if (update.error) {
      logSyncTransition("status_update_failed", {
        upload_id: upload.id,
        client_request_id: upload.client_request_id,
        match_id: upload.match_id,
        sender_id: upload.sender_id,
        requester_id: user.id,
        provider_object_id: upload.provider_object_id,
        media_asset_id: upload.media_asset_id ?? null,
        mapped_status: bunny.status,
        raw_status: typeof bunny.rawStatus === "number" ? bunny.rawStatus : null,
        error: update.error,
      });
      return jsonResponse(req, { success: false, error: update.error }, { status: 500 });
    }
    logSyncTransition("status_update_succeeded", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      requester_id: user.id,
      provider_object_id: upload.provider_object_id,
      media_asset_id: upload.media_asset_id ?? null,
      mapped_status: bunny.status,
      raw_status: typeof bunny.rawStatus === "number" ? bunny.rawStatus : null,
      message_id: update.messageId ?? upload.published_message_id ?? null,
    });

    return jsonResponse(req, {
      success: true,
      status: bunny.status,
      raw_status: bunny.rawStatus,
      upload_id: upload.id,
      match_id: upload.match_id,
      client_request_id: upload.client_request_id,
      message_id: update.messageId ?? upload.published_message_id,
      provider_object_id: upload.provider_object_id,
      expires_at: upload.expires_at,
      updated_at: upload.updated_at,
      provider_reachable: true,
      provider_error: null,
    });
  } catch (error) {
    console.error("sync-chat-vibe-clip-status unexpected:", error);
    return jsonResponse(req, { success: false, error: "internal" }, { status: 500 });
  }
});
