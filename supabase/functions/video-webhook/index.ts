import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import * as Sentry from "https://deno.land/x/sentry@8.55.0/index.mjs";
import {
  constantTimeCompare,
  hasAnyBunnyStreamSignatureHeader,
  verifyBunnyStreamWebhookSignature,
} from "../_shared/bunny-stream-webhook.ts";
import {
  mapBunnyStatusToChatClipStatus,
  updateChatVibeClipStatusByProvider,
} from "../_shared/chat-vibe-clips.ts";
import { createImagePlaceholderMetadata, type MediaPlaceholderMetadata } from "../_shared/media-placeholders.ts";
import { signBunnyStreamDirectoryUrl } from "../_shared/bunny-stream-tokens.ts";
import { logVibeVideo } from "../_shared/vibe-video-logs.ts";

type SafeTraceValue = string | number | boolean | null | undefined;
type SafeTraceFields = Record<string, SafeTraceValue>;
type AdminSupabaseClient = SupabaseClient<any, "public", any>;
type CallbackOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };
type VibeVideoUploadAttemptStatus = "processing" | "ready" | "failed";
type StreamPlaceholderKind = "chat" | "profile";

function numericEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const SENTRY_DSN = Deno.env.get("SENTRY_DSN")?.trim() ?? "";
const SENTRY_TRACES_SAMPLE_RATE = Math.min(1, Math.max(0, numericEnv("SENTRY_TRACES_SAMPLE_RATE", 0.2)));
const SENTRY_FLUSH_TIMEOUT_MS = Math.max(0, numericEnv("SENTRY_FLUSH_TIMEOUT_MS", 500));
let SENTRY_ENABLED = false;

function toSentryAttributes(fields: SafeTraceFields): Record<string, string | number | boolean> {
  const attributes: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      attributes[key] = value;
    }
  }
  return attributes;
}

function unwrapCallbackOutcome<T>(outcome: CallbackOutcome<T> | null): T {
  if (!outcome) throw new Error("webhook_callback_missing_outcome");
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

if (SENTRY_DSN) {
  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      defaultIntegrations: false,
      environment: Deno.env.get("SENTRY_ENVIRONMENT")?.trim() || Deno.env.get("ENVIRONMENT")?.trim() || "production",
      tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    });
    Sentry.setTag("region", Deno.env.get("SB_REGION") ?? "unknown");
    Sentry.setTag("execution_id", Deno.env.get("SB_EXECUTION_ID") ?? "unknown");
    SENTRY_ENABLED = true;
  } catch (error) {
    console.warn(JSON.stringify({
      scope: "video_webhook_sentry",
      function: "video-webhook",
      event: "sentry_init_failed",
      error_code: error instanceof Error ? error.name : "unknown",
    }));
  }
}

async function withSentryWebhookTransaction<T>(fields: SafeTraceFields, callback: () => Promise<T>): Promise<T> {
  if (!SENTRY_ENABLED || typeof Sentry.startSpan !== "function") return await callback();
  let callbackStarted = false;
  let callbackOutcome: CallbackOutcome<T> | null = null;
  try {
    await Sentry.startSpan(
      {
        name: "video-webhook",
        op: "supabase.edge.webhook",
        forceTransaction: true,
        attributes: {
          "supabase.function": "video-webhook",
          ...toSentryAttributes(fields),
        },
      },
      async () => {
        callbackStarted = true;
        try {
          callbackOutcome = { ok: true, value: await callback() };
        } catch (error) {
          callbackOutcome = { ok: false, error };
        }
      },
    );
  } catch (error) {
    console.warn(JSON.stringify({
      scope: "video_webhook_sentry",
      function: "video-webhook",
      event: "sentry_start_span_failed",
      error_code: error instanceof Error ? error.name : "unknown",
    }));
    if (!callbackStarted) return await callback();
    if (!callbackOutcome) throw error;
  }
  if (!callbackStarted) return await callback();
  return unwrapCallbackOutcome(callbackOutcome);
}

async function captureSentryWebhookException(error: unknown, fields: SafeTraceFields): Promise<void> {
  if (!SENTRY_ENABLED || typeof Sentry.captureException !== "function") return;
  try {
    Sentry.captureException(error, {
      tags: {
        "supabase.function": "video-webhook",
        project_ref: typeof fields.project_ref === "string" ? fields.project_ref : "unknown",
        webhook_trace_id: typeof fields.webhook_trace_id === "string" ? fields.webhook_trace_id : "unknown",
      },
      extra: fields,
    });
    if (typeof Sentry.flush === "function") {
      void Sentry.flush(SENTRY_FLUSH_TIMEOUT_MS).catch((sentryError) => {
        console.warn(JSON.stringify({
          scope: "video_webhook_sentry",
          function: "video-webhook",
          event: "sentry_flush_failed",
          error_code: sentryError instanceof Error ? sentryError.name : "unknown",
        }));
      });
    }
  } catch (sentryError) {
    console.warn(JSON.stringify({
      scope: "video_webhook_sentry",
      function: "video-webhook",
      event: "sentry_capture_failed",
      error_code: sentryError instanceof Error ? sentryError.name : "unknown",
    }));
  }
}

function getProjectRef(url: string | undefined): string {
  if (!url) return "unknown";
  try {
    const host = new URL(url).hostname;
    return host.split(".")[0] || "unknown";
  } catch {
    return "unknown";
  }
}

function isValidVideoGuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

async function syncVibeVideoUploadAttemptFromWebhook(
  supabase: AdminSupabaseClient,
  params: {
    providerObjectId: string;
    status: VibeVideoUploadAttemptStatus;
    errorDetail: string | null;
    draftMediaSessionId?: string | null;
  },
): Promise<{ ok: true; attemptId: string | null } | { ok: false; errorCode: string }> {
  const patch: Record<string, string | null> = {
    status: params.status,
    error_detail: params.errorDetail,
  };
  if (params.draftMediaSessionId) {
    patch.draft_media_session_id = params.draftMediaSessionId;
  }
  const { data, error } = await supabase
    .from("vibe_video_uploads")
    .update(patch)
    .eq("provider_object_id", params.providerObjectId)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, errorCode: error.code ?? "attempt_update_failed" };
  return { ok: true, attemptId: typeof data?.id === "string" ? data.id : null };
}

type WebhookAuthMode = "signature" | "bearer" | "legacy_query_token";

type WebhookAuthResult =
  | {
    ok: true;
    authMode: WebhookAuthMode;
    signatureKeyConfigured: boolean;
  }
  | {
    ok: false;
    reason: "invalid_signature" | "invalid_auth";
    signatureFailureReason?: string;
    signatureKeyConfigured: boolean;
    hasSignatureHeaders: boolean;
    hasBearerToken: boolean;
    hasLegacyQueryToken: boolean;
    hasWebhookTokenConfigured: boolean;
  };

function getBearerToken(headers: Headers): string | null {
  const authorization = headers.get("Authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const token = match?.[1]?.trim() ?? "";
  return token.length > 0 ? token : null;
}

function streamPlaceholderConfig(kind: StreamPlaceholderKind): { hostname: string; securityKey: string } | null {
  const hostname = Deno.env.get(kind === "chat" ? "BUNNY_CHAT_STREAM_CDN_HOSTNAME" : "BUNNY_STREAM_CDN_HOSTNAME")?.trim() ?? "";
  const securityKey = Deno.env.get(kind === "chat" ? "BUNNY_CHAT_STREAM_TOKEN_SECURITY_KEY" : "BUNNY_STREAM_TOKEN_SECURITY_KEY")?.trim() ?? "";
  return hostname && securityKey ? { hostname, securityKey } : null;
}

async function fetchStreamThumbnailPlaceholder(
  videoId: string,
  kind: StreamPlaceholderKind,
): Promise<MediaPlaceholderMetadata | null> {
  const config = streamPlaceholderConfig(kind);
  if (!config) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const url = await signBunnyStreamDirectoryUrl({
      hostname: config.hostname,
      securityKey: config.securityKey,
      videoId,
      fileName: "thumbnail.jpg",
      expires: Math.floor(Date.now() / 1000) + 120,
    });
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    return await createImagePlaceholderMetadata(buffer);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function updateStreamVideoPlaceholder(
  supabase: AdminSupabaseClient,
  params: {
    providerObjectId: string;
    kind: StreamPlaceholderKind;
    log: (level: "info" | "warn" | "error", event: string, fields?: Record<string, string | number | boolean | null | undefined>) => void;
  },
): Promise<void> {
  const placeholder = await fetchStreamThumbnailPlaceholder(params.providerObjectId, params.kind);
  if (!placeholder) {
    params.log("warn", "video_webhook_thumbnail_placeholder_unavailable", {
      video_guid: params.providerObjectId,
      stream_kind: params.kind,
    });
    return;
  }
  const { data, error } = await supabase
    .from("media_assets")
    .update({
      placeholder_kind: placeholder.placeholder_kind,
      placeholder_hash: placeholder.placeholder_hash,
      dominant_color: placeholder.dominant_color,
      placeholder_updated_at: new Date().toISOString(),
    })
    .eq("provider", "bunny_stream")
    .eq("provider_object_id", params.providerObjectId)
    .neq("status", "purged")
    .select("id")
    .maybeSingle();
  if (error) {
    params.log("warn", "video_webhook_thumbnail_placeholder_update_failed", {
      video_guid: params.providerObjectId,
      stream_kind: params.kind,
      error_code: error.code ?? "placeholder_update_failed",
    });
    return;
  }
  params.log("info", "video_webhook_thumbnail_placeholder_updated", {
    video_guid: params.providerObjectId,
    stream_kind: params.kind,
    media_asset_id: typeof data?.id === "string" ? data.id : null,
  });
}

async function authenticateWebhook(
  req: Request,
  rawBody: string,
  webhookToken: string,
  webhookSigningKey: string,
): Promise<WebhookAuthResult> {
  const hasSignatureHeaders = hasAnyBunnyStreamSignatureHeader(req.headers);
  const signatureKeyConfigured = webhookSigningKey.length > 0;
  const bearerToken = getBearerToken(req.headers);
  const url = new URL(req.url);
  const legacyToken = url.searchParams.get("token");
  const hasWebhookTokenConfigured = webhookToken.trim().length > 0;

  if (hasSignatureHeaders && signatureKeyConfigured) {
    const signatureResult = await verifyBunnyStreamWebhookSignature(
      req.headers,
      rawBody,
      webhookSigningKey,
    );
    if (signatureResult.ok) {
      return {
        ok: true,
        authMode: "signature",
        signatureKeyConfigured,
      };
    }
    return {
      ok: false,
      reason: "invalid_signature",
      signatureFailureReason: signatureResult.reason,
      signatureKeyConfigured,
      hasSignatureHeaders,
      hasBearerToken: !!bearerToken,
      hasLegacyQueryToken: !!legacyToken,
      hasWebhookTokenConfigured,
    };
  }

  if (
    bearerToken &&
    hasWebhookTokenConfigured &&
    constantTimeCompare(bearerToken, webhookToken)
  ) {
    return {
      ok: true,
      authMode: "bearer",
      signatureKeyConfigured,
    };
  }

  if (
    legacyToken &&
    hasWebhookTokenConfigured &&
    constantTimeCompare(legacyToken, webhookToken)
  ) {
    return {
      ok: true,
      authMode: "legacy_query_token",
      signatureKeyConfigured,
    };
  }

  return {
    ok: false,
    reason: "invalid_auth",
    signatureKeyConfigured,
    hasSignatureHeaders,
    hasBearerToken: !!bearerToken,
    hasLegacyQueryToken: !!legacyToken,
    hasWebhookTokenConfigured,
  };
}

serve(async (req) => {
  const startedAt = Date.now();
  const webhookTraceId = crypto.randomUUID();
  const projectRef = getProjectRef(Deno.env.get("SUPABASE_URL"));
  const logWebhook = (
    level: "info" | "warn" | "error",
    event: string,
    fields: Record<string, string | number | boolean | null | undefined> = {},
  ) => {
    logVibeVideo(level, event, {
      project_ref: projectRef,
      webhook_trace_id: webhookTraceId,
      elapsed_ms: Date.now() - startedAt,
      ...fields,
    });
  };
  const sentryTraceFields = {
    project_ref: projectRef,
    webhook_trace_id: webhookTraceId,
    method: req.method,
  };

  return await withSentryWebhookTransaction(sentryTraceFields, async () => {
  logWebhook("info", "video_webhook_received", { method: req.method });
  if (req.method !== "POST") {
    logWebhook("warn", "video_webhook_rejected", {
      reason: "method_not_allowed",
      method: req.method,
    });
    return new Response("Method not allowed", { status: 405 });
  }

  const webhookToken = Deno.env.get("BUNNY_VIDEO_WEBHOOK_TOKEN")?.trim() ?? "";
  const webhookSigningKey = Deno.env.get("BUNNY_WEBHOOK_SIGNING_KEY")?.trim() ?? "";

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (err) {
    logWebhook("error", "video_webhook_rejected", {
      reason: "body_read_failed",
      error_code: err instanceof Error ? err.name : "unknown",
    });
    return new Response("Bad request", { status: 400 });
  }

  const authResult = await authenticateWebhook(
    req,
    rawBody,
    webhookToken,
    webhookSigningKey,
  );
  if (!authResult.ok) {
    logWebhook("warn", "video_webhook_rejected", {
      reason: authResult.reason,
      signature_failure_reason: authResult.signatureFailureReason ?? null,
      signature_key_configured: authResult.signatureKeyConfigured,
      has_signature_headers: authResult.hasSignatureHeaders,
      has_bearer_token: authResult.hasBearerToken,
      has_legacy_query_token: authResult.hasLegacyQueryToken,
      has_webhook_token_configured: authResult.hasWebhookTokenConfigured,
    });
    return new Response("Unauthorized", { status: 401 });
  }

  if (authResult.authMode === "legacy_query_token") {
    logWebhook("warn", "video_webhook_auth_validated", {
      auth_mode: authResult.authMode,
      signature_key_configured: authResult.signatureKeyConfigured,
      legacy_query_token_fallback: true,
    });
  } else {
    logWebhook("info", "video_webhook_auth_validated", {
      auth_mode: authResult.authMode,
      signature_key_configured: authResult.signatureKeyConfigured,
    });
  }

  let body: {
    VideoGuid?: string;
    Status?: number;
    VideoLibraryId?: number | string;
  };
  try {
    body = JSON.parse(rawBody) as {
      VideoGuid?: string;
      Status?: number;
      VideoLibraryId?: number | string;
    };
  } catch (err) {
    logWebhook("warn", "video_webhook_rejected", {
      reason: "invalid_json",
      auth_mode: authResult.authMode,
      error_code: err instanceof Error ? err.name : "unknown",
    });
    return new Response("Bad request", { status: 400 });
  }

  try {
    const { VideoGuid, Status, VideoLibraryId } = body;
    const allowedLibraryIds = [
      Deno.env.get("BUNNY_STREAM_LIBRARY_ID")?.trim(),
      Deno.env.get("BUNNY_CHAT_STREAM_LIBRARY_ID")?.trim(),
    ].filter((value): value is string => !!value);
    const libraryIdRaw = VideoLibraryId == null ? null : String(VideoLibraryId);
    const libraryIdTrimmed = libraryIdRaw == null ? null : libraryIdRaw.trim();
    logWebhook("info", "video_webhook_payload_parsed", {
      bunny_status: typeof Status === "number" ? Status : null,
      library_id: libraryIdTrimmed,
      library_id_raw: libraryIdRaw,
      video_guid: isValidVideoGuid(VideoGuid) ? VideoGuid : null,
      has_video_guid: typeof VideoGuid === "string" && VideoGuid.trim().length > 0,
    });

    if (!isValidVideoGuid(VideoGuid)) {
      logWebhook("warn", "video_webhook_rejected", {
        reason: "invalid_video_guid",
      });
      return new Response("ok", { status: 200 });
    }

    if (
      allowedLibraryIds.length > 0 &&
      libraryIdTrimmed != null &&
      !allowedLibraryIds.includes(libraryIdTrimmed)
    ) {
      logWebhook("warn", "video_webhook_rejected", {
        reason: "library_mismatch",
        video_guid: VideoGuid,
        library_id: libraryIdTrimmed,
        library_id_raw: libraryIdRaw,
        allowed_library_ids: allowedLibraryIds.join(","),
      });
      return new Response("Forbidden", { status: 403 });
    }
    logWebhook("info", "video_webhook_library_validated", {
      video_guid: VideoGuid,
      library_id: libraryIdTrimmed,
      library_id_raw: libraryIdRaw,
      library_validation: allowedLibraryIds.length > 0 ? "matched_or_absent" : "not_configured",
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let mappedStatus: VibeVideoUploadAttemptStatus = "processing";
    if (Status === 3) mappedStatus = "ready";
    if (Status === 4) mappedStatus = "ready";
    if (Status === 5) mappedStatus = "failed";
    if (Status === 8) mappedStatus = "failed";
    logWebhook("info", "video_webhook_status_mapped", {
      video_guid: VideoGuid,
      bunny_status: typeof Status === "number" ? Status : null,
      mapped_status: mappedStatus,
    });

    const chatClipStatus = mapBunnyStatusToChatClipStatus(Status);
    const { data: chatClipUploadForLog, error: chatClipLookupError } = await supabase
      .from("chat_vibe_clip_uploads")
      .select("id,client_request_id,match_id,sender_id,media_asset_id,status,published_message_id")
      .eq("provider_object_id", VideoGuid)
      .maybeSingle();
    if (chatClipLookupError) {
      logWebhook("error", "video_webhook_chat_vibe_clip_lookup_failed", {
        video_guid: VideoGuid,
        provider_object_id: VideoGuid,
        bunny_status: typeof Status === "number" ? Status : null,
        mapped_status: chatClipStatus,
        error_code: chatClipLookupError.message,
      });
    } else if (chatClipUploadForLog) {
      logWebhook("info", "video_webhook_chat_vibe_clip_matched", {
        video_guid: VideoGuid,
        provider_object_id: VideoGuid,
        upload_id: typeof chatClipUploadForLog.id === "string" ? chatClipUploadForLog.id : null,
        client_request_id: typeof chatClipUploadForLog.client_request_id === "string" ? chatClipUploadForLog.client_request_id : null,
        match_id: typeof chatClipUploadForLog.match_id === "string" ? chatClipUploadForLog.match_id : null,
        sender_id: typeof chatClipUploadForLog.sender_id === "string" ? chatClipUploadForLog.sender_id : null,
        media_asset_id: typeof chatClipUploadForLog.media_asset_id === "string" ? chatClipUploadForLog.media_asset_id : null,
        previous_status: typeof chatClipUploadForLog.status === "string" ? chatClipUploadForLog.status : null,
        published_message_id: typeof chatClipUploadForLog.published_message_id === "string"
          ? chatClipUploadForLog.published_message_id
          : null,
        bunny_status: typeof Status === "number" ? Status : null,
        mapped_status: chatClipStatus,
      });
    }
    const chatClipResult = await updateChatVibeClipStatusByProvider(
      supabase,
      VideoGuid,
      chatClipStatus,
      chatClipStatus === "failed" ? `bunny_status_${Status}` : null,
      { publishIfProcessing: Status === 7 },
    );
    if (chatClipResult.handled) {
      if (!chatClipResult.error && chatClipStatus === "ready") {
        await updateStreamVideoPlaceholder(supabase, {
          providerObjectId: VideoGuid,
          kind: "chat",
          log: logWebhook,
        });
      }
      logWebhook(chatClipResult.error ? "error" : "info", "video_webhook_chat_vibe_clip_update", {
        video_guid: VideoGuid,
        provider_object_id: VideoGuid,
        upload_id: typeof chatClipUploadForLog?.id === "string" ? chatClipUploadForLog.id : null,
        client_request_id: typeof chatClipUploadForLog?.client_request_id === "string"
          ? chatClipUploadForLog.client_request_id
          : null,
        match_id: typeof chatClipUploadForLog?.match_id === "string" ? chatClipUploadForLog.match_id : null,
        sender_id: typeof chatClipUploadForLog?.sender_id === "string" ? chatClipUploadForLog.sender_id : null,
        media_asset_id: typeof chatClipUploadForLog?.media_asset_id === "string" ? chatClipUploadForLog.media_asset_id : null,
        previous_status: typeof chatClipUploadForLog?.status === "string" ? chatClipUploadForLog.status : null,
        bunny_status: typeof Status === "number" ? Status : null,
        mapped_status: chatClipStatus,
        message_id: chatClipResult.messageId ?? null,
        ignored_provider_status: chatClipResult.ignoredProviderStatus === true,
        error_code: chatClipResult.error ?? null,
      });
      return new Response(chatClipResult.error ? "error" : "ok", { status: chatClipResult.error ? 500 : 200 });
    }

    // ── Update draft_media_sessions (new session model) ──────────────────────
    // The RPC also updates profiles.bunny_video_status for processing/ready/failed
    // when profiles.bunny_video_uid still matches this provider.
    const { data: sessionResult, error: sessionError } = await supabase.rpc(
      "update_media_session_status",
      {
        p_provider_id: VideoGuid,
        p_new_status: mappedStatus,
        p_error_detail: mappedStatus === "failed" ? `bunny_status_${Status}` : null,
      },
    );

    const sr = sessionResult as Record<string, unknown> | null;
    const sessionRpcError = typeof sr?.error === "string" ? sr.error : null;

    if (sessionError) {
      logVibeVideo("error", "video_webhook_media_session_update_failed", {
        project_ref: projectRef,
        video_guid: VideoGuid,
        mapped_status: mappedStatus,
        error_code: sessionError.code ?? "session_update_error",
      });
      return new Response("error", { status: 500 });
    }

    if (sr?.success) {
      const attemptSync = await syncVibeVideoUploadAttemptFromWebhook(supabase, {
        providerObjectId: VideoGuid,
        status: mappedStatus,
        errorDetail: mappedStatus === "failed" ? `bunny_status_${Status}` : null,
        draftMediaSessionId: typeof sr.session_id === "string" ? sr.session_id : null,
      });
      if (!attemptSync.ok) {
        logVibeVideo("error", "video_webhook_vibe_video_upload_attempt_update_failed", {
          project_ref: projectRef,
          video_guid: VideoGuid,
          mapped_status: mappedStatus,
          media_session_id: typeof sr.session_id === "string" ? sr.session_id : null,
          error_code: attemptSync.errorCode,
        });
        return new Response("error", { status: 500 });
      }
      logVibeVideo("info", "video_webhook_media_session_update_succeeded", {
        project_ref: projectRef,
        video_guid: VideoGuid,
        media_session_id: typeof sr.session_id === "string" ? sr.session_id : null,
        previous_status: typeof sr.previous_status === "string" ? sr.previous_status : null,
        mapped_status: mappedStatus,
        upload_attempt_id: attemptSync.attemptId,
      });
      if (mappedStatus === "ready") {
        await updateStreamVideoPlaceholder(supabase, {
          providerObjectId: VideoGuid,
          kind: "profile",
          log: logWebhook,
        });
      }
      // The RPC is authoritative for active sessions and now keeps the profile
      // snapshot in sync for processing/ready/failed with a UID guard.
      return new Response("ok", { status: 200 });
    }

    if (sessionRpcError === "invalid_transition") {
      logVibeVideo("warn", "video_webhook_stale_or_out_of_order_ignored", {
        project_ref: projectRef,
        video_guid: VideoGuid,
        mapped_status: mappedStatus,
        reason: sessionRpcError,
      });
      return new Response("ok", { status: 200 });
    }

    if (sessionRpcError !== "session_not_found") {
      logVibeVideo("error", "video_webhook_media_session_update_rejected", {
        project_ref: projectRef,
        video_guid: VideoGuid,
        mapped_status: mappedStatus,
        error_code: sessionRpcError ?? "unknown",
      });
      return new Response("error", { status: 500 });
    }

    const { data: existingSessions, error: sessionLookupError } = await supabase
      .from("draft_media_sessions")
      .select("id,status,user_id,created_at")
      .eq("media_type", "vibe_video")
      .eq("provider_id", VideoGuid)
      .limit(1);

    if (sessionLookupError) {
      logVibeVideo("error", "video_webhook_session_lookup_failed", {
        project_ref: projectRef,
        video_guid: VideoGuid,
        mapped_status: mappedStatus,
        error_code: sessionLookupError.code ?? "session_lookup_error",
      });
      return new Response("error", { status: 500 });
    }

    if ((existingSessions?.length ?? 0) > 0) {
      logVibeVideo("warn", "video_webhook_session_not_found_modern_asset_ignored", {
        project_ref: projectRef,
        video_guid: VideoGuid,
        mapped_status: mappedStatus,
        reason: "existing_session_not_active",
        session_status: existingSessions?.[0]?.status ?? null,
      });
      return new Response("ok", { status: 200 });
    }

    // ── Narrow legacy fallback: only for pre-session uploads ──────────────────
    const { data: updated, error } = await supabase
      .from("profiles")
      .update({ bunny_video_status: mappedStatus })
      .eq("bunny_video_uid", VideoGuid)
      .select("id");

    if (error) {
      logVibeVideo("error", "video_webhook_legacy_profile_update_failed", {
        project_ref: projectRef,
        video_guid: VideoGuid,
        mapped_status: mappedStatus,
        error_code: error.code ?? "legacy_profile_update_error",
      });
      return new Response("error", { status: 500 });
    }

    const n = updated?.length ?? 0;
    if (n === 0) {
      logVibeVideo("info", "video_webhook_stale_legacy_profile_ignored", {
        project_ref: projectRef,
        video_guid: VideoGuid,
        mapped_status: mappedStatus,
        reason: "no_current_profile_row",
      });
      return new Response("ok", { status: 200 });
    }

    const legacyAttemptSync = await syncVibeVideoUploadAttemptFromWebhook(supabase, {
      providerObjectId: VideoGuid,
      status: mappedStatus,
      errorDetail: mappedStatus === "failed" ? `bunny_status_${Status}` : null,
    });
    if (!legacyAttemptSync.ok) {
      logVibeVideo("error", "video_webhook_vibe_video_upload_attempt_update_failed", {
        project_ref: projectRef,
        video_guid: VideoGuid,
        mapped_status: mappedStatus,
        error_code: legacyAttemptSync.errorCode,
      });
      return new Response("error", { status: 500 });
    }

    logVibeVideo("info", "video_webhook_legacy_profile_update_succeeded", {
      project_ref: projectRef,
      video_guid: VideoGuid,
      rows: n,
      mapped_status: mappedStatus,
      upload_attempt_id: legacyAttemptSync.attemptId,
    });
    if (mappedStatus === "ready") {
      await updateStreamVideoPlaceholder(supabase, {
        providerObjectId: VideoGuid,
        kind: "profile",
        log: logWebhook,
      });
    }
    return new Response("ok", { status: 200 });
  } catch (err) {
    logWebhook("error", "video_webhook_unexpected_error", {
      error_code: err instanceof Error ? err.name : "unknown",
    });
    await captureSentryWebhookException(err, {
      ...sentryTraceFields,
      elapsed_ms: Date.now() - startedAt,
    });
    return new Response("error", { status: 500 });
  }
  });
});
