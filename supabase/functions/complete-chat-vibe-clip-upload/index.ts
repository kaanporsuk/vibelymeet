import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { jsonResponse, preflightResponse } from "../_shared/cors.ts";
import {
  ChatVibeClipUploadRow,
  ensureChatVibeClipMessage,
  getAdminClient,
  getChatStreamConfig,
  isUuid,
  mapBunnyStatusToChatClipStatus,
} from "../_shared/chat-vibe-clips.ts";

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
    if (error) return jsonResponse(req, { success: false, error: error.message }, { status: 500 });
    if (!data) return jsonResponse(req, { success: false, error: "upload_not_found" }, { status: 404 });
    if (isUuid(clientRequestId) && data.client_request_id !== clientRequestId) {
      return jsonResponse(req, { success: false, error: "client_request_id_conflict" }, { status: 409 });
    }

    const upload = data as ChatVibeClipUploadRow;
    const bunnyStatus = await getBunnyStatus(upload.provider_object_id);
    const status = bunnyStatus === "ready" ? "ready" : bunnyStatus === "failed" ? "failed" : "processing";

    if (status === "failed") {
      await admin
        .from("chat_vibe_clip_uploads")
        .update({ status: "failed", error_detail: "bunny_processing_failed" })
        .eq("id", upload.id);
      return jsonResponse(req, { success: false, error: "processing_failed", status: "failed" }, { status: 409 });
    }

    const ensured = await ensureChatVibeClipMessage(admin, upload, status);
    if (!ensured.success) {
      return jsonResponse(req, { success: false, error: ensured.error }, { status: 400 });
    }

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
