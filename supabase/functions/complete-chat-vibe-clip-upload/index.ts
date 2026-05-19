import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { jsonResponse, preflightResponse } from "../_shared/cors.ts";
import {
  ChatVibeClipStatus,
  ChatVibeClipUploadRow,
  ensureChatVibeClipMessage,
  getAdminClient,
  getChatStreamConfig,
  isUuid,
  mapBunnyStatusToChatClipStatus,
} from "../_shared/chat-vibe-clips.ts";

function logCompleteTransition(event: string, fields: Record<string, unknown> = {}) {
  console.info(JSON.stringify({
    scope: "chat_vibe_clip_upload",
    function: "complete-chat-vibe-clip-upload",
    event,
    ...fields,
  }));
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

async function getBunnyStatus(videoId: string): Promise<"processing" | "ready" | "failed"> {
  const config = getChatStreamConfig();
  if (!config) return "processing";
  const res = await fetch(`https://video.bunnycdn.com/library/${config.libraryId}/videos/${videoId}`, {
    headers: { AccessKey: config.apiKey },
  }).catch(() => null);
  if (!res?.ok) return "processing";
  const data = await res.json().catch(() => null) as { status?: unknown } | null;
  const status = mapBunnyStatusToChatClipStatus(data?.status);
  return status === "ready" || status === "failed" ? status : "processing";
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
    const clientRequestId = typeof body?.client_request_id === "string" ? body.client_request_id.trim() : "";
    if (!isUuid(uploadId) && !isUuid(clientRequestId)) {
      return jsonResponse(req, { success: false, error: "invalid_request" }, { status: 400 });
    }
    logCompleteTransition("request_validated", {
      upload_id: isUuid(uploadId) ? uploadId : null,
      client_request_id: isUuid(clientRequestId) ? clientRequestId : null,
      sender_id: user.id,
    });

    const admin = getAdminClient();
    let query = admin
      .from("chat_vibe_clip_uploads")
      .select("*")
      .eq("sender_id", user.id)
      .limit(1);
    query = isUuid(uploadId)
      ? query.eq("id", uploadId)
      : query.eq("client_request_id", clientRequestId);
    const { data, error } = await query.maybeSingle();
    if (error) {
      logCompleteTransition("upload_lookup_failed", {
        upload_id: isUuid(uploadId) ? uploadId : null,
        client_request_id: isUuid(clientRequestId) ? clientRequestId : null,
        sender_id: user.id,
        error: error.message,
      });
      return jsonResponse(req, { success: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      logCompleteTransition("upload_not_found", {
        upload_id: isUuid(uploadId) ? uploadId : null,
        client_request_id: isUuid(clientRequestId) ? clientRequestId : null,
        sender_id: user.id,
      });
      return jsonResponse(req, { success: false, error: "upload_not_found" }, { status: 404 });
    }
    if (isUuid(clientRequestId) && data.client_request_id !== clientRequestId) {
      logCompleteTransition("client_request_id_conflict", {
        upload_id: data.id,
        requested_client_request_id: clientRequestId,
        existing_client_request_id: data.client_request_id,
        provider_object_id: data.provider_object_id,
        media_asset_id: data.media_asset_id ?? null,
        status: data.status ?? null,
      });
      return jsonResponse(req, { success: false, error: "client_request_id_conflict" }, { status: 409 });
    }

    const upload = data as ChatVibeClipUploadRow;
    logCompleteTransition("upload_loaded", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      provider_object_id: upload.provider_object_id,
      media_asset_id: upload.media_asset_id ?? null,
      status: upload.status,
      published_message_id: upload.published_message_id ?? null,
    });
    const bunnyStatus = await getBunnyStatus(upload.provider_object_id);
    let status: ChatVibeClipStatus = bunnyStatus === "ready" ? "ready" : bunnyStatus === "failed" ? "failed" : "processing";
    if (upload.status === "ready" && status !== "ready") status = "ready";
    if (upload.status === "failed" && status === "processing") status = "failed";
    logCompleteTransition("bunny_status_checked", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      provider_object_id: upload.provider_object_id,
      media_asset_id: upload.media_asset_id ?? null,
      bunny_status: bunnyStatus,
      previous_status: upload.status,
      mapped_status: status,
    });

    if (status === "failed") {
      const { error: failedStatusUpdateError } = await admin
        .from("chat_vibe_clip_uploads")
        .update({ status: "failed", error_detail: "bunny_processing_failed" })
        .eq("id", upload.id);
      if (failedStatusUpdateError) {
        logCompleteTransition("bunny_processing_failed_status_update_failed", {
          upload_id: upload.id,
          client_request_id: upload.client_request_id,
          match_id: upload.match_id,
          sender_id: upload.sender_id,
          provider_object_id: upload.provider_object_id,
          media_asset_id: upload.media_asset_id ?? null,
          status: "failed",
          error: failedStatusUpdateError.message,
        });
        return jsonResponse(req, { success: false, error: failedStatusUpdateError.message }, { status: 500 });
      }
      logCompleteTransition("bunny_processing_failed", {
        upload_id: upload.id,
        client_request_id: upload.client_request_id,
        match_id: upload.match_id,
        sender_id: upload.sender_id,
        provider_object_id: upload.provider_object_id,
        media_asset_id: upload.media_asset_id ?? null,
        status: "failed",
      });
      return jsonResponse(req, { success: false, error: "processing_failed", status: "failed" }, { status: 409 });
    }

    logCompleteTransition("message_finalize_requested", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      provider_object_id: upload.provider_object_id,
      media_asset_id: upload.media_asset_id ?? null,
      status,
    });
    const ensured = await ensureChatVibeClipMessage(admin, upload, status);
    if (!ensured.success) {
      logCompleteTransition("message_finalize_failed", {
        upload_id: upload.id,
        client_request_id: upload.client_request_id,
        match_id: upload.match_id,
        sender_id: upload.sender_id,
        provider_object_id: upload.provider_object_id,
        media_asset_id: upload.media_asset_id ?? null,
        status,
        error: ensured.error,
      });
      return jsonResponse(req, { success: false, error: ensured.error }, { status: 400 });
    }
    logCompleteTransition("message_finalized", {
      upload_id: upload.id,
      client_request_id: upload.client_request_id,
      match_id: upload.match_id,
      sender_id: upload.sender_id,
      provider_object_id: upload.provider_object_id,
      media_asset_id: upload.media_asset_id ?? null,
      status,
      message_id: ensured.messageId,
    });

    return jsonResponse(req, {
      success: true,
      status,
      message: ensured.message,
      message_id: ensured.messageId,
      provider_object_id: upload.provider_object_id,
    });
  } catch (error) {
    console.error("complete-chat-vibe-clip-upload unexpected:", error);
    return jsonResponse(req, { success: false, error: "internal" }, { status: 500 });
  }
});
