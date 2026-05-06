import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return jsonResponse({ success: false, error: "Not authenticated" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ success: false, error: "Authentication failed" }, 401);
    }

    const body = await req.json();
    const { verification_id, action, rejection_reason, idempotency_key } = body;

    if (!verification_id || !action) {
      return jsonResponse({ success: false, error: "Missing verification_id or action" });
    }

    if (action !== "approve" && action !== "reject") {
      return jsonResponse({ success: false, error: "Invalid action" });
    }

    const { data, error } = await supabase.rpc("admin_review_photo_verification", {
      p_verification_id: verification_id,
      p_action: action,
      p_rejection_reason: rejection_reason ?? null,
      p_idempotency_key: idempotency_key ?? null,
    });

    if (error) {
      console.error("admin_review_photo_verification RPC error:", error);
      return jsonResponse({ success: false, error: error.message }, 500);
    }

    const payload = data as { success?: boolean; error?: string; message?: string } | null;
    if (!payload?.success) {
      return jsonResponse(
        { success: false, error: payload?.error ?? "review_failed", message: payload?.message },
        payload?.error === "FORBIDDEN" ? 403 : payload?.error === "UNAUTHENTICATED" ? 401 : 400,
      );
    }

    return jsonResponse(payload);
  } catch (err) {
    console.error("Crash:", err);
    return jsonResponse({ success: false, error: "Server error" }, 500);
  }
});
