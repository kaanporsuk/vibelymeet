import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { jsonResponse, preflightResponse } from "../_shared/cors.ts";
import {
  ChatVibeClipUploadRow,
  getAdminClient,
  getChatStreamConfig,
  isUuid,
  mapBunnyStatusToChatClipStatus,
  updateChatVibeClipStatusByProvider,
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

async function userCanReadMessage(admin: ReturnType<typeof createClient>, userId: string, messageId: string): Promise<boolean> {
  const { data: message } = await admin
    .from("messages")
    .select("id, match_id")
    .eq("id", messageId)
    .maybeSingle();
  if (!message?.match_id) return false;
  const { data: match } = await admin
    .from("matches")
    .select("id, profile_id_1, profile_id_2")
    .eq("id", message.match_id)
    .maybeSingle();
  return Boolean(match && (match.profile_id_1 === userId || match.profile_id_2 === userId));
}

async function readBunnyStatus(videoId: string): Promise<{ status: "processing" | "ready" | "failed"; rawStatus: unknown }> {
  const config = getChatStreamConfig();
  if (!config) return { status: "processing", rawStatus: null };
  const res = await fetch(`https://video.bunnycdn.com/library/${config.libraryId}/videos/${videoId}`, {
    headers: { AccessKey: config.apiKey },
  }).catch(() => null);
  if (!res?.ok) return { status: "processing", rawStatus: null };
  const data = await res.json().catch(() => null) as { status?: unknown } | null;
  const status = mapBunnyStatusToChatClipStatus(data?.status);
  return {
    status: status === "ready" || status === "failed" ? status : "processing",
    rawStatus: data?.status ?? null,
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

    const admin = getAdminClient();
    let query = admin.from("chat_vibe_clip_uploads").select("*").limit(1);
    if (isUuid(uploadId)) query = query.eq("id", uploadId);
    else if (isUuid(messageId)) query = query.eq("published_message_id", messageId);
    else query = query.eq("sender_id", user.id).eq("client_request_id", clientRequestId);

    const { data, error } = await query.maybeSingle();
    if (error) return jsonResponse(req, { success: false, error: error.message }, { status: 500 });
    if (!data) return jsonResponse(req, { success: false, error: "upload_not_found" }, { status: 404 });
    const upload = data as ChatVibeClipUploadRow;

    const canRead = upload.sender_id === user.id ||
      (upload.published_message_id ? await userCanReadMessage(admin, user.id, upload.published_message_id) : false);
    if (!canRead) return jsonResponse(req, { success: false, error: "not_found" }, { status: 404 });

    const bunny = await readBunnyStatus(upload.provider_object_id);
    const update = await updateChatVibeClipStatusByProvider(
      admin,
      upload.provider_object_id,
      bunny.status,
      bunny.status === "failed" ? `bunny_status_${bunny.rawStatus ?? "unknown"}` : null,
      { publishIfProcessing: bunny.rawStatus === 7 && upload.sender_id === user.id },
    );
    if (update.error) return jsonResponse(req, { success: false, error: update.error }, { status: 500 });

    return jsonResponse(req, {
      success: true,
      status: bunny.status,
      raw_status: bunny.rawStatus,
      message_id: update.messageId ?? upload.published_message_id,
      provider_object_id: upload.provider_object_id,
    });
  } catch (error) {
    console.error("sync-chat-vibe-clip-status unexpected:", error);
    return jsonResponse(req, { success: false, error: "internal" }, { status: 500 });
  }
});
