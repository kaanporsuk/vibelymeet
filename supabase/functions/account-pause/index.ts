import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = claimsData.claims.sub as string;
    const body = await req.json().catch(() => ({}));
    const duration = body.duration as string | undefined; // 'day' | 'week' | 'indefinite'
    const reason = (body.reason as string) || null;

    const now = new Date();
    let pausedUntil: string | null = null;
    if (duration === "day") {
      const d = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      pausedUntil = d.toISOString();
    } else if (duration === "week") {
      const d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      pausedUntil = d.toISOString();
    }
    // 'indefinite' or missing => pausedUntil stays null

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({
        is_paused: true,
        paused_at: now.toISOString(),
        paused_until: pausedUntil,
        pause_reason: reason,
        updated_at: now.toISOString(),
      })
      .eq("id", userId);

    if (updateError) {
      console.error("account-pause update error:", updateError.message);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to pause account" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, is_paused: true, paused_until: pausedUntil }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("account-pause error:", err);
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
