import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  constantTimeCompare,
  hasAnyBunnyStreamSignatureHeader,
  verifyBunnyStreamWebhookSignature,
} from "../_shared/bunny-stream-webhook.ts";
import { logVibeVideo } from "../_shared/vibe-video-logs.ts";

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

async function authenticateWebhook(
  req: Request,
  rawBody: string,
  webhookToken: string,
  streamApiKey: string,
): Promise<WebhookAuthResult> {
  const hasSignatureHeaders = hasAnyBunnyStreamSignatureHeader(req.headers);
  const signatureKeyConfigured = streamApiKey.length > 0;
  const bearerToken = getBearerToken(req.headers);
  const url = new URL(req.url);
  const legacyToken = url.searchParams.get("token");
  const hasWebhookTokenConfigured = webhookToken.trim().length > 0;

  if (hasSignatureHeaders && signatureKeyConfigured) {
    const signatureResult = await verifyBunnyStreamWebhookSignature(
      req.headers,
      rawBody,
      streamApiKey,
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
  const projectRef = getProjectRef(Deno.env.get("SUPABASE_URL"));
  logVibeVideo("info", "video_webhook_received", {
    project_ref: projectRef,
    method: req.method,
  });
  if (req.method !== "POST") {
    logVibeVideo("warn", "video_webhook_rejected", {
      project_ref: projectRef,
      reason: "method_not_allowed",
      method: req.method,
    });
    return new Response("Method not allowed", { status: 405 });
  }

  const webhookToken = Deno.env.get("BUNNY_VIDEO_WEBHOOK_TOKEN")?.trim() ?? "";
  const streamApiKey = Deno.env.get("BUNNY_STREAM_API_KEY")?.trim() ?? "";

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch (err) {
    logVibeVideo("error", "video_webhook_rejected", {
      project_ref: projectRef,
      reason: "body_read_failed",
      error_code: err instanceof Error ? err.name : "unknown",
    });
    return new Response("Bad request", { status: 400 });
  }

  const authResult = await authenticateWebhook(
    req,
    rawBody,
    webhookToken,
    streamApiKey,
  );
  if (!authResult.ok) {
    logVibeVideo("warn", "video_webhook_rejected", {
      project_ref: projectRef,
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
    logVibeVideo("warn", "video_webhook_auth_validated", {
      project_ref: projectRef,
      auth_mode: authResult.authMode,
      signature_key_configured: authResult.signatureKeyConfigured,
      legacy_query_token_fallback: true,
    });
  } else {
    logVibeVideo("info", "video_webhook_auth_validated", {
      project_ref: projectRef,
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
    logVibeVideo("warn", "video_webhook_rejected", {
      project_ref: projectRef,
      reason: "invalid_json",
      auth_mode: authResult.authMode,
      error_code: err instanceof Error ? err.name : "unknown",
    });
    return new Response("Bad request", { status: 400 });
  }

  try {
    const { VideoGuid, Status, VideoLibraryId } = body;
    const expectedLibraryId = Deno.env.get("BUNNY_STREAM_LIBRARY_ID");
    logVibeVideo("info", "video_webhook_payload_parsed", {
      project_ref: projectRef,
      bunny_status: typeof Status === "number" ? Status : null,
      library_id: VideoLibraryId == null ? null : String(VideoLibraryId),
      video_guid: isValidVideoGuid(VideoGuid) ? VideoGuid : null,
      has_video_guid: typeof VideoGuid === "string" && VideoGuid.trim().length > 0,
    });

    if (!isValidVideoGuid(VideoGuid)) {
      logVibeVideo("warn", "video_webhook_rejected", {
        project_ref: projectRef,
        reason: "invalid_video_guid",
      });
      return new Response("ok", { status: 200 });
    }

    if (
      expectedLibraryId &&
      VideoLibraryId != null &&
      String(VideoLibraryId).trim() !== expectedLibraryId.trim()
    ) {
      logVibeVideo("warn", "video_webhook_rejected", {
        project_ref: projectRef,
        reason: "library_mismatch",
        video_guid: VideoGuid,
        library_id: String(VideoLibraryId),
      });
      return new Response("Forbidden", { status: 403 });
    }
    logVibeVideo("info", "video_webhook_library_validated", {
      project_ref: projectRef,
      video_guid: VideoGuid,
      library_id: VideoLibraryId == null ? null : String(VideoLibraryId),
      library_validation: expectedLibraryId ? "matched_or_absent" : "not_configured",
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let mappedStatus = "processing";
    if (Status === 3) mappedStatus = "ready";
    if (Status === 4) mappedStatus = "ready";
    if (Status === 5) mappedStatus = "failed";
    logVibeVideo("info", "video_webhook_status_mapped", {
      project_ref: projectRef,
      video_guid: VideoGuid,
      bunny_status: typeof Status === "number" ? Status : null,
      mapped_status: mappedStatus,
    });

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
      logVibeVideo("info", "video_webhook_media_session_update_succeeded", {
        project_ref: projectRef,
        video_guid: VideoGuid,
        media_session_id: typeof sr.session_id === "string" ? sr.session_id : null,
        previous_status: typeof sr.previous_status === "string" ? sr.previous_status : null,
        mapped_status: mappedStatus,
      });
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

    logVibeVideo("info", "video_webhook_legacy_profile_update_succeeded", {
      project_ref: projectRef,
      video_guid: VideoGuid,
      rows: n,
      mapped_status: mappedStatus,
    });
    return new Response("ok", { status: 200 });
  } catch (err) {
    logVibeVideo("error", "video_webhook_unexpected_error", {
      project_ref: projectRef,
      error_code: err instanceof Error ? err.name : "unknown",
    });
    return new Response("error", { status: 500 });
  }
});
