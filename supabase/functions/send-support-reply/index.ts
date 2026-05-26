import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  adminJsonResponse,
  authenticateAdminRequest,
  sanitizeErrorMessage,
  statusForAdminError,
} from "../_shared/adminAuth.ts";
import {
  isBrowserOriginRejected,
  preflightResponse,
} from "../_shared/cors.ts";

type DeliveryJob = {
  id?: string;
  channel?: "push" | "email";
  state?: string;
  attempts?: number;
  next_retry_at?: string | null;
  last_error?: string | null;
  error_code?: string | null;
  provider_id?: string | null;
};

type AdminCreateSupportReplyPayload = {
  success?: boolean;
  error?: string;
  message?: string;
  idempotent_replay?: boolean;
  ticket_id?: string;
  notification_warning?: string | null;
  email_warning?: string | null;
  delivery_jobs?: DeliveryJob[];
  reply?: {
    id?: string;
  };
};

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  return adminJsonResponse(req, body, status);
}

function statusForRpcError(error: string | undefined) {
  return statusForAdminError(error, 400);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return preflightResponse(req);
  }
  if (isBrowserOriginRejected(req)) {
    return jsonResponse(req, { success: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { success: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }

  try {
    const auth = await authenticateAdminRequest(req, {
      requireAdmin: false,
      requiredPermission: "support.manage",
    });
    if (!auth.ok) return auth.response;

    const requestBody = await req.json().catch(() => ({}));
    const ticketId = typeof requestBody.ticket_id === "string" ? requestBody.ticket_id : "";
    const replyMessage = typeof requestBody.reply_message === "string" ? requestBody.reply_message.trim() : "";
    const sendEmail = requestBody.send_email !== false;
    const idempotencyKey = typeof requestBody.idempotency_key === "string" ? requestBody.idempotency_key : null;

    if (!ticketId || !replyMessage) {
      return jsonResponse(req, { success: false, error: "ticket_id and reply_message required" }, 400);
    }

    const { data: replyPayloadRaw, error: replyRpcError } = await auth.context.userClient.rpc("admin_create_support_reply", {
      p_ticket_id: ticketId,
      p_message: replyMessage,
      p_idempotency_key: idempotencyKey,
      p_send_email: sendEmail,
    });

    if (replyRpcError) {
      return jsonResponse(
        req,
        {
          success: false,
          error: "RPC_ERROR",
          message: sanitizeErrorMessage(replyRpcError.message || "Failed to save support reply."),
        },
        400,
      );
    }

    const replyPayload = replyPayloadRaw as AdminCreateSupportReplyPayload | null;
    if (!replyPayload?.success) {
      return jsonResponse(
        req,
        {
          success: false,
          error: replyPayload?.error ?? "SAVE_FAILED",
          message: sanitizeErrorMessage(replyPayload?.message ?? "Failed to save support reply."),
        },
        statusForRpcError(replyPayload?.error),
      );
    }

    const deliveryJobs = Array.isArray(replyPayload.delivery_jobs) ? replyPayload.delivery_jobs : [];
    const pushJob = deliveryJobs.find((job) => job.channel === "push");
    const emailJob = deliveryJobs.find((job) => job.channel === "email");

    return jsonResponse(req, {
      success: true,
      idempotent_replay: replyPayload.idempotent_replay === true,
      ticket_id: replyPayload.ticket_id ?? ticketId,
      reply_id: replyPayload.reply?.id ?? null,
      delivery_jobs: deliveryJobs,
      notification_job_id: pushJob?.id ?? null,
      email_job_id: emailJob?.id ?? null,
      notification_warning: replyPayload.notification_warning ?? null,
      email_warning: replyPayload.email_warning ?? null,
    });
  } catch (e) {
    console.error("send-support-reply:", sanitizeErrorMessage(e));
    return jsonResponse(req, { success: false, error: "INTERNAL_ERROR", message: sanitizeErrorMessage(e) }, 500);
  }
});
