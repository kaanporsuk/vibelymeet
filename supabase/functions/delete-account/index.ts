import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { checkRateLimit, createRateLimitResponse } from "../_shared/rate-limiter.ts";

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

    // Rate limiting: 1 delete request per hour
    const rateLimitResult = await checkRateLimit(userId, {
      functionName: "delete-account",
      maxRequests: 1,
      windowMs: 60 * 60 * 1000,
    });

    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult, corsHeaders);
    }

    // Parse optional reason from body
    let reason: string | null = null;
    try {
      const body = await req.json();
      reason = body?.reason || null;
    } catch {
      // No body or invalid JSON — that's fine
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. Insert deletion request if none is already pending.
    const { data: existingPending, error: existingPendingError } = await supabaseAdmin
      .from("account_deletion_requests")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();

    if (existingPendingError) {
      console.error("Error checking existing deletion request:", existingPendingError.message);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to check deletion status" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!existingPending) {
      const { error: insertError } = await supabaseAdmin
        .from("account_deletion_requests")
        .insert({
          user_id: userId,
          reason,
          status: "pending",
        });

      if (insertError) {
        console.error("Error inserting deletion request:", insertError.message);
        return new Response(
          JSON.stringify({ success: false, error: "Failed to create deletion request" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // 2. Cancel any active Stripe subscription
    try {
      const { data: subscription } = await supabaseAdmin
        .from("subscriptions")
        .select("stripe_subscription_id, stripe_customer_id, status")
        .eq("user_id", userId)
        .eq("provider", "stripe")
        .maybeSingle();

      if (subscription?.stripe_subscription_id && ["active", "trialing"].includes(subscription.status)) {
        const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
        if (stripeSecretKey) {
          const cancelRes = await fetch(
            `https://api.stripe.com/v1/subscriptions/${subscription.stripe_subscription_id}`,
            {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${stripeSecretKey}`,
                "Content-Type": "application/x-www-form-urlencoded",
              },
            }
          );
          const cancelBody = await cancelRes.text();
          if (cancelRes.ok) {
            // Update local subscription status
            await supabaseAdmin
              .from("subscriptions")
              .update({ status: "canceled" })
              .eq("user_id", userId)
              .eq("provider", "stripe");
            await supabaseAdmin
              .from("profiles")
              .update({ is_premium: false, subscription_tier: "free" })
              .eq("id", userId);
          } else {
            console.error("Failed to cancel Stripe subscription:", cancelBody);
          }
        }
      }
    } catch (stripeErr) {
      console.error("Stripe cancellation error:", stripeErr);
      // Don't fail the deletion request if Stripe fails
    }

    // 3. Sign the user out
    const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(userId);
    if (signOutError) {
      console.error("Error signing out user:", signOutError.message);
    }

    return new Response(
      JSON.stringify({ success: true, message: "Account scheduled for deletion" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unexpected error in delete-account:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
