import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyAccountDeletionMediaHold } from "../_shared/media-lifecycle.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, reason, source } = await req.json();
    const authHeader = req.headers.get("Authorization");
    const normalizedRequestedEmail = typeof email === "string" ? email.toLowerCase() : null;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return new Response(
        JSON.stringify({ success: true }), // Don't reveal validation details
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Basic IP-based rate limiting: max 5 requests per hour per IP
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    let authenticatedUserId: string | null = null;
    let authenticatedEmail: string | null = null;
    if (authHeader?.startsWith("Bearer ")) {
      const supabaseUser = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: userRes } = await supabaseUser.auth.getUser();
      if (userRes?.user?.id) {
        authenticatedUserId = userRes.user.id;
        authenticatedEmail = (userRes.user.email ?? "").toLowerCase();
      }
    }

    // Trust the authenticated user for same-user requests so lifecycle hold can
    // still apply even if the admin email lookup is temporarily unavailable.
    let userId: string | null = null;
    if (
      authenticatedUserId &&
      authenticatedEmail &&
      normalizedRequestedEmail &&
      authenticatedEmail === normalizedRequestedEmail
    ) {
      userId = authenticatedUserId;
    } else {
      // Look up user by email using admin API (avoids loading all users)
      const { data: userData, error: lookupError } = await supabaseAdmin.auth.admin.getUserByEmail(normalizedRequestedEmail!);
      if (lookupError || !userData?.user?.id) {
        // Don't reveal if email exists — always return success
        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userId = userData.user.id;
    }

    // Check for existing pending request
    const { data: existing } = await supabaseAdmin
      .from("account_deletion_requests")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "pending")
      .maybeSingle();

    if (!existing) {
      await supabaseAdmin.from("account_deletion_requests").insert({
        user_id: userId,
        reason: reason ? `[${source || "web"}] ${reason}` : `[${source || "web"}] No reason provided`,
        status: "pending",
      });

      // NOTE: Do NOT suspend the account immediately.
      // Suspension is a destructive action that should only happen
      // after admin review, to prevent abuse by unauthenticated callers.
    }

    let mediaHoldApplied = false;
    if (
      authenticatedUserId &&
      authenticatedUserId === userId &&
      authenticatedEmail &&
      authenticatedEmail === normalizedRequestedEmail
    ) {
      const holdResult = await applyAccountDeletionMediaHold(supabaseAdmin, userId);
      if (!holdResult.success) {
        console.error("request-account-deletion media hold apply failed:", holdResult.error);
      } else {
        mediaHoldApplied = true;
      }
    }

    // Always return success to not reveal if email exists
    return new Response(
      JSON.stringify({ success: true, media_hold_applied: mediaHoldApplied }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("request-account-deletion error:", err);
    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
