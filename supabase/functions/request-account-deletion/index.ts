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

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Look up user by email
    const { data: users } = await supabaseAdmin.auth.admin.listUsers();
    const user = users?.users?.find(
      (u: any) => u.email?.toLowerCase() === email.toLowerCase()
    );

    if (user) {
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

        // Suspend profile immediately
        await supabaseAdmin
          .from("profiles")
          .update({ is_suspended: true })
          .eq("id", user.id);
      }
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
