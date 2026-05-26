import {
  authenticateAdminRequest,
  sanitizeErrorMessage,
  statusForAdminError,
} from "../_shared/adminAuth.ts";
import {
  isBrowserOriginRejected,
  jsonResponse,
  preflightResponse,
} from "../_shared/cors.ts";

type AdminDataExportBody = {
  scope_type?: unknown;
  scope?: unknown;
  reason?: unknown;
  pii_classification?: unknown;
};

type AdminExportPayload = {
  success?: boolean;
  ok?: boolean;
  error?: string;
  message?: string;
  [key: string]: unknown;
};

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return preflightResponse(req);
  }
  if (isBrowserOriginRejected(req)) {
    return jsonResponse(req, { success: false, error: "origin_not_allowed" }, { status: 403 });
  }
  if (req.method !== "POST") {
    return jsonResponse(req, { success: false, error: "method_not_allowed" }, { status: 405 });
  }

  try {
    const auth = await authenticateAdminRequest(req);
    if (!auth.ok) return auth.response;

    const body = (await req.json().catch(() => ({}))) as AdminDataExportBody;
    const scopeType = asText(body.scope_type);
    const reason = asText(body.reason);
    if (!scopeType || !reason) {
      return jsonResponse(
        req,
        { success: false, error: "scope_type_and_reason_required" },
        { status: 400 },
      );
    }

    const { data, error } = await auth.context.userClient.rpc("admin_create_data_export_job", {
      p_scope_type: scopeType,
      p_scope: body.scope && typeof body.scope === "object" && !Array.isArray(body.scope) ? body.scope : {},
      p_reason: reason,
      p_pii_classification: asText(body.pii_classification) ?? "sensitive",
    });

    if (error) {
      console.error("admin-data-export RPC failed", sanitizeErrorMessage(error.message));
      return jsonResponse(
        req,
        {
          success: false,
          ok: false,
          error: "EXPORT_QUEUE_FAILED",
          message: sanitizeErrorMessage(error.message || "Governed export queue failed."),
        },
        { status: statusForAdminError(error) },
      );
    }

    const payload = data as AdminExportPayload | null;
    if (!payload) {
      return jsonResponse(
        req,
        { success: false, ok: false, error: "EMPTY_RESPONSE", message: "Export queue returned no response." },
        { status: 502 },
      );
    }
    if (payload.success === false || payload.ok === false) {
      return jsonResponse(
        req,
        {
          ...payload,
          success: false,
          ok: false,
          message: sanitizeErrorMessage(payload.message ?? payload.error ?? "Governed export queue failed."),
        },
        { status: statusForAdminError(payload.error ?? payload.message, 400) },
      );
    }

    return jsonResponse(req, payload, { status: 200 });
  } catch (error) {
    console.error("admin-data-export error", sanitizeErrorMessage(error));
    return jsonResponse(req, { success: false, error: "server_error" }, { status: 500 });
  }
});
