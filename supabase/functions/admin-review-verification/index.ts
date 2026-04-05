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

    // Verify admin role
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: roleData } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return jsonResponse({ success: false, error: "Unauthorized — admin only" }, 403);
    }

    const body = await req.json();
    const { verification_id, action, admin_id, rejection_reason } = body;

    if (!verification_id || !action) {
      return jsonResponse({ success: false, error: "Missing verification_id or action" });
    }

    // Fetch the verification record
    const { data: verification, error: fetchErr } = await admin
      .from("photo_verifications")
      .select("*")
      .eq("id", verification_id)
      .maybeSingle();

    if (fetchErr || !verification) {
      return jsonResponse({ success: false, error: "Verification not found" });
    }

    if (action === "approve") {
      // Update verification record
      const { error: updateErr } = await admin
        .from("photo_verifications")
        .update({
          status: "approved",
          reviewed_by: admin_id || user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", verification_id);

      if (updateErr) {
        console.error("Update error:", updateErr);
        return jsonResponse({ success: false, error: "Failed to update verification" });
      }

      // Update user profile
      const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
      const { error: profileErr } = await admin
        .from("profiles")
        .update({
          photo_verified: true,
          photo_verified_at: new Date().toISOString(),
          photo_verification_expires_at: expiresAt,
        })
        .eq("id", verification.user_id);

      if (profileErr) {
        console.error("Profile update error:", profileErr);
        return jsonResponse({ success: false, error: "Failed to update profile" });
      }

      // Log admin action
      await admin.from("admin_activity_logs").insert({
        admin_id: admin_id || user.id,
        action_type: "photo_verification_approved",
        target_type: "user",
        target_id: verification.user_id,
        details: { verification_id },
      });

      return jsonResponse({ success: true, action: "approved" });
    }

    if (action === "reject") {
      const { error: updateErr } = await admin
        .from("photo_verifications")
        .update({
          status: "rejected",
          reviewed_by: admin_id || user.id,
          reviewed_at: new Date().toISOString(),
          rejection_reason: rejection_reason || "Not specified",
        })
        .eq("id", verification_id);

      if (updateErr) {
        console.error("Update error:", updateErr);
        return jsonResponse({ success: false, error: "Failed to update verification" });
      }

      // Ensure photo_verified stays false
      await admin
        .from("profiles")
        .update({
          photo_verified: false,
          photo_verified_at: null,
          photo_verification_expires_at: null,
        })
        .eq("id", verification.user_id);

      // Log admin action
      await admin.from("admin_activity_logs").insert({
        admin_id: admin_id || user.id,
        action_type: "photo_verification_rejected",
        target_type: "user",
        target_id: verification.user_id,
        details: { verification_id, rejection_reason },
      });

      return jsonResponse({ success: true, action: "rejected" });
    }

    return jsonResponse({ success: false, error: "Invalid action" });
  } catch (err) {
    console.error("Crash:", err);
    return jsonResponse({ success: false, error: "Server error" }, 500);
  }
});
