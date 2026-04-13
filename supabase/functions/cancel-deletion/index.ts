import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { cancelAccountDeletionMediaHold } from "../_shared/media-lifecycle.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(
        JSON.stringify({ success: false, error: "Unauthorized" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = claimsData.claims.sub as string;

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Cancel any live pending deletion request(s).
    const { data, error } = await supabaseAdmin
      .from("account_deletion_requests")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("status", "pending")
      .select();

    if (error) {
      console.error("Error cancelling deletion:", error.message);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to cancel deletion" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!data || data.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "No pending deletion request found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const holdResult = await cancelAccountDeletionMediaHold(supabaseAdmin, userId);
    if (!holdResult.success) {
      console.error("Error restoring deletion media hold:", holdResult.error);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to restore media retention state" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: activeSuspensionRows, error: activeSuspensionError } = await supabaseAdmin
      .from("user_suspensions")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(1);

    if (activeSuspensionError) {
      console.error("Error checking active suspensions:", activeSuspensionError.message);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to verify account restriction state" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Only reverse legacy deletion-induced suspension holds.
    if (!activeSuspensionRows || activeSuspensionRows.length === 0) {
      await supabaseAdmin
        .from("profiles")
        .update({ is_suspended: false, suspension_reason: null })
        .eq("id", userId)
        .eq("suspension_reason", "Account deletion requested");
    }

    console.log(`Deletion cancelled for user: ${userId}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Account deletion cancelled",
        media_hold_restored: true,
        media_hold_matches_touched: holdResult.matchesTouched ?? 0,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unexpected error in cancel-deletion:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
