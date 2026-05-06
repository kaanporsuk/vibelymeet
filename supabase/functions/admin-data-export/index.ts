import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse(req, { success: false, error: "unauthenticated" }, { status: 401 });
  }

  try {
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: authHeader } },
      },
    );

    const { data, error } = await supabase.rpc("admin_create_data_export_job", {
      p_scope_type: scopeType,
      p_scope: body.scope && typeof body.scope === "object" && !Array.isArray(body.scope) ? body.scope : {},
      p_reason: reason,
      p_pii_classification: asText(body.pii_classification) ?? "sensitive",
    });

    if (error) {
      console.error("admin-data-export RPC failed", error.message);
      return jsonResponse(req, { success: false, error: error.message }, { status: 200 });
    }

    return jsonResponse(req, data ?? { success: false, error: "empty_response" }, { status: 200 });
  } catch (error) {
    console.error("admin-data-export error", error);
    return jsonResponse(req, { success: false, error: "server_error" }, { status: 500 });
  }
});
