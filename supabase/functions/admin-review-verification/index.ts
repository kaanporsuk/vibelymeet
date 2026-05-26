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

function jsonResponse(req: Request, body: Record<string, unknown>, status = 200) {
  return adminJsonResponse(req, body, status);
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
    const auth = await authenticateAdminRequest(req);
    if (!auth.ok) return auth.response;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonResponse(req, { success: false, error: "Invalid JSON body" }, 400);
    }
    const { verification_id, action, rejection_reason, idempotency_key } = body;

    if (!verification_id || !action) {
      return jsonResponse(req, { success: false, error: "Missing verification_id or action" }, 400);
    }

    if (action !== "approve" && action !== "reject") {
      return jsonResponse(req, { success: false, error: "Invalid action" }, 400);
    }

    const { data, error } = await auth.context.userClient.rpc("admin_review_photo_verification", {
      p_verification_id: verification_id,
      p_action: action,
      p_rejection_reason: rejection_reason ?? null,
      p_idempotency_key: idempotency_key ?? null,
    });

    if (error) {
      console.error("admin_review_photo_verification RPC error:", sanitizeErrorMessage(error.message));
      return jsonResponse(
        req,
        { success: false, error: "RPC_ERROR", message: sanitizeErrorMessage(error.message) },
        statusForAdminError(error),
      );
    }

    const payload = data as { success?: boolean; error?: string; message?: string } | null;
    if (!payload?.success) {
      return jsonResponse(
        req,
        {
          success: false,
          error: payload?.error ?? "review_failed",
          message: sanitizeErrorMessage(payload?.message ?? payload?.error ?? "Photo verification review failed."),
        },
        statusForAdminError(payload?.error, 400),
      );
    }

    return jsonResponse(req, payload);
  } catch (err) {
    console.error("Crash:", sanitizeErrorMessage(err));
    return jsonResponse(req, { success: false, error: "Server error" }, 500);
  }
});
