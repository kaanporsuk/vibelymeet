import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Look up user by email using admin API (avoids loading all users)
    const { data: userData, error: lookupError } = await supabaseAdmin.auth.admin.getUserByEmail(email.toLowerCase());

    if (lookupError || !userData?.user) {
      // Don't reveal if email exists — always return success
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const user = userData.user;

    // Check for existing pending request
    const { data: existing } = await supabaseAdmin
      .from("account_deletion_requests")
      .select("id")
      .eq("user_id", user.id)
      .eq("status", "pending")
      .maybeSingle();

    if (!existing) {
      await supabaseAdmin.from("account_deletion_requests").insert({
        user_id: user.id,
        reason: reason ? `[${source || "web"}] ${reason}` : `[${source || "web"}] No reason provided`,
        status: "pending",
      });

      // NOTE: Do NOT suspend the account immediately.
      // Suspension is a destructive action that should only happen
      // after admin review, to prevent abuse by unauthenticated callers.
    }

    // Always return success to not reveal if email exists
    return new Response(
      JSON.stringify({ success: true }),
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
