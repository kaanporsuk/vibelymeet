import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { jsonResponse, preflightResponse } from "../_shared/cors.ts";
import { getAdminClient, isUuid } from "../_shared/chat-vibe-clips.ts";

function logDismissTransition(event: string, fields: Record<string, unknown> = {}) {
  console.info(JSON.stringify({
    scope: "chat_vibe_clip_upload",
    function: "dismiss-chat-vibe-clip-upload",
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

function reasonFromInput(value: unknown): string {
  if (typeof value !== "string") return "user_discard_send_again";
  const trimmed = value.trim().replace(/[^a-z0-9_:-]/gi, "").slice(0, 80);
  return trimmed || "user_discard_send_again";
}

type DismissUploadRow = {
  id: string;
  match_id: string;
  sender_id: string;
  client_request_id: string;
  status: string | null;
  published_message_id: string | null;
  recovery_dismissed_at: string | null;
};

async function findExistingMessageForUpload(
  admin: ReturnType<typeof getAdminClient>,
  upload: DismissUploadRow,
): Promise<{ messageId: string | null; error?: string }> {
  const { data, error } = await admin
    .from("messages")
    .select("id")
    .eq("match_id", upload.match_id)
    .eq("sender_id", upload.sender_id)
    .eq("message_kind", "vibe_clip")
    .contains("structured_payload", { client_request_id: upload.client_request_id })
    .maybeSingle();
  if (error) return { messageId: null, error: error.message };
  return { messageId: data?.id ? String(data.id) : null };
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
    const reason = reasonFromInput(body?.reason);
    if (!isUuid(uploadId) && !isUuid(clientRequestId)) {
      return jsonResponse(req, { success: false, error: "invalid_request" }, { status: 400 });
    }

    logDismissTransition("request_validated", {
      upload_id: isUuid(uploadId) ? uploadId : null,
      client_request_id: isUuid(clientRequestId) ? clientRequestId : null,
      sender_id: user.id,
      reason,
    });

    const admin = getAdminClient();
    let query = admin
      .from("chat_vibe_clip_uploads")
      .select("id, match_id, sender_id, client_request_id, status, published_message_id, recovery_dismissed_at")
      .eq("sender_id", user.id)
      .limit(1);
    query = isUuid(uploadId)
      ? query.eq("id", uploadId)
      : query.eq("client_request_id", clientRequestId);

    const { data, error } = await query.maybeSingle();
    if (error) {
      logDismissTransition("upload_lookup_failed", {
        upload_id: isUuid(uploadId) ? uploadId : null,
        client_request_id: isUuid(clientRequestId) ? clientRequestId : null,
        sender_id: user.id,
        error: error.message,
      });
      return jsonResponse(req, { success: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      logDismissTransition("upload_not_found", {
        upload_id: isUuid(uploadId) ? uploadId : null,
        client_request_id: isUuid(clientRequestId) ? clientRequestId : null,
        sender_id: user.id,
      });
      return jsonResponse(req, { success: false, error: "upload_not_found" }, { status: 404 });
    }

    if (data.published_message_id) {
      logDismissTransition("already_published", {
        upload_id: data.id,
        client_request_id: data.client_request_id,
        match_id: data.match_id,
        sender_id: user.id,
        message_id: data.published_message_id,
      });
      return jsonResponse(req, {
        success: true,
        dismissed: false,
        already_published: true,
        upload_id: data.id,
        match_id: data.match_id,
        client_request_id: data.client_request_id,
        message_id: data.published_message_id,
      });
    }

    const existingMessage = await findExistingMessageForUpload(admin, data as DismissUploadRow);
    if (existingMessage.error) {
      logDismissTransition("idempotent_message_lookup_failed", {
        upload_id: data.id,
        client_request_id: data.client_request_id,
        match_id: data.match_id,
        sender_id: user.id,
        error: existingMessage.error,
      });
      return jsonResponse(req, { success: false, error: existingMessage.error }, { status: 500 });
    }
    if (existingMessage.messageId) {
      const { error: repairError } = await admin
        .from("chat_vibe_clip_uploads")
        .update({ published_message_id: existingMessage.messageId })
        .eq("id", data.id)
        .is("published_message_id", null);
      if (repairError) {
        logDismissTransition("published_message_repair_failed", {
          upload_id: data.id,
          client_request_id: data.client_request_id,
          match_id: data.match_id,
          sender_id: user.id,
          message_id: existingMessage.messageId,
          error: repairError.message,
        });
        return jsonResponse(req, { success: false, error: repairError.message }, { status: 500 });
      }
      logDismissTransition("already_published_message_found", {
        upload_id: data.id,
        client_request_id: data.client_request_id,
        match_id: data.match_id,
        sender_id: user.id,
        message_id: existingMessage.messageId,
      });
      return jsonResponse(req, {
        success: true,
        dismissed: false,
        already_published: true,
        upload_id: data.id,
        match_id: data.match_id,
        client_request_id: data.client_request_id,
        message_id: existingMessage.messageId,
      });
    }

    if (data.recovery_dismissed_at) {
      logDismissTransition("already_dismissed", {
        upload_id: data.id,
        client_request_id: data.client_request_id,
        match_id: data.match_id,
        sender_id: user.id,
      });
      return jsonResponse(req, {
        success: true,
        dismissed: true,
        idempotent_replay: true,
        upload_id: data.id,
        match_id: data.match_id,
        client_request_id: data.client_request_id,
      });
    }

    const dismissedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await admin
      .from("chat_vibe_clip_uploads")
      .update({
        recovery_dismissed_at: dismissedAt,
        recovery_dismissed_by: user.id,
        recovery_dismissed_reason: reason,
      })
      .eq("id", data.id)
      .eq("sender_id", user.id)
      .is("published_message_id", null)
      .is("recovery_dismissed_at", null)
      .select("id, match_id, sender_id, client_request_id, status, published_message_id, recovery_dismissed_at")
      .maybeSingle();
    if (updateError) {
      logDismissTransition("dismiss_update_failed", {
        upload_id: data.id,
        client_request_id: data.client_request_id,
        match_id: data.match_id,
        sender_id: user.id,
        error: updateError.message,
      });
      return jsonResponse(req, { success: false, error: updateError.message }, { status: 500 });
    }
    if (!updated) {
      const { data: latest, error: latestError } = await admin
        .from("chat_vibe_clip_uploads")
        .select("id, match_id, sender_id, client_request_id, status, published_message_id, recovery_dismissed_at")
        .eq("id", data.id)
        .eq("sender_id", user.id)
        .maybeSingle();
      if (latestError) {
        logDismissTransition("dismiss_post_update_lookup_failed", {
          upload_id: data.id,
          client_request_id: data.client_request_id,
          match_id: data.match_id,
          sender_id: user.id,
          error: latestError.message,
        });
        return jsonResponse(req, { success: false, error: latestError.message }, { status: 500 });
      }
      if (latest?.published_message_id) {
        logDismissTransition("concurrent_publish_won", {
          upload_id: latest.id,
          client_request_id: latest.client_request_id,
          match_id: latest.match_id,
          sender_id: user.id,
          message_id: latest.published_message_id,
        });
        return jsonResponse(req, {
          success: true,
          dismissed: false,
          already_published: true,
          upload_id: latest.id,
          match_id: latest.match_id,
          client_request_id: latest.client_request_id,
          message_id: latest.published_message_id,
        });
      }
      if (latest) {
        const latestMessage = await findExistingMessageForUpload(admin, latest as DismissUploadRow);
        if (latestMessage.error) {
          logDismissTransition("post_update_message_lookup_failed", {
            upload_id: latest.id,
            client_request_id: latest.client_request_id,
            match_id: latest.match_id,
            sender_id: user.id,
            error: latestMessage.error,
          });
          return jsonResponse(req, { success: false, error: latestMessage.error }, { status: 500 });
        }
        if (latestMessage.messageId) {
          const { error: repairError } = await admin
            .from("chat_vibe_clip_uploads")
            .update({ published_message_id: latestMessage.messageId })
            .eq("id", latest.id)
            .is("published_message_id", null);
          if (repairError) {
            logDismissTransition("concurrent_publish_message_repair_failed", {
              upload_id: latest.id,
              client_request_id: latest.client_request_id,
              match_id: latest.match_id,
              sender_id: user.id,
              message_id: latestMessage.messageId,
              error: repairError.message,
            });
            return jsonResponse(req, { success: false, error: repairError.message }, { status: 500 });
          }
          logDismissTransition("concurrent_publish_message_found", {
            upload_id: latest.id,
            client_request_id: latest.client_request_id,
            match_id: latest.match_id,
            sender_id: user.id,
            message_id: latestMessage.messageId,
          });
          return jsonResponse(req, {
            success: true,
            dismissed: false,
            already_published: true,
            upload_id: latest.id,
            match_id: latest.match_id,
            client_request_id: latest.client_request_id,
            message_id: latestMessage.messageId,
          });
        }
      }
      if (latest?.recovery_dismissed_at) {
        logDismissTransition("concurrent_dismiss_won", {
          upload_id: latest.id,
          client_request_id: latest.client_request_id,
          match_id: latest.match_id,
          sender_id: user.id,
        });
        return jsonResponse(req, {
          success: true,
          dismissed: true,
          idempotent_replay: true,
          upload_id: latest.id,
          match_id: latest.match_id,
          client_request_id: latest.client_request_id,
          recovery_dismissed_at: latest.recovery_dismissed_at,
        });
      }
      logDismissTransition("dismiss_update_noop", {
        upload_id: data.id,
        client_request_id: data.client_request_id,
        match_id: data.match_id,
        sender_id: user.id,
      });
      return jsonResponse(req, { success: false, error: "dismiss_not_applied" }, { status: 409 });
    }

    logDismissTransition("dismissed", {
      upload_id: updated.id,
      client_request_id: updated.client_request_id,
      match_id: updated.match_id,
      sender_id: user.id,
      status: updated.status,
      reason,
    });
    return jsonResponse(req, {
      success: true,
      dismissed: true,
      upload_id: updated.id,
      match_id: updated.match_id,
      client_request_id: updated.client_request_id,
      recovery_dismissed_at: updated.recovery_dismissed_at ?? dismissedAt,
    });
  } catch (error) {
    console.error("dismiss-chat-vibe-clip-upload unexpected:", error);
    return jsonResponse(req, { success: false, error: "internal" }, { status: 500 });
  }
});
