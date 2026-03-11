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
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // User-scoped client for calling RPC so that auth.uid() inside daily_drop_transition matches the caller
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Service-role client for invoking send-notification
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const { drop_id, action, text } = await req.json();

    if (!drop_id || (action !== "send_opener" && action !== "send_reply")) {
      return new Response(
        JSON.stringify({ success: false, error: "invalid_request" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data, error } = await userClient.rpc("daily_drop_transition", {
      p_drop_id: drop_id,
      p_action: action,
      p_text: text ?? null,
    });

    if (error) {
      console.error("daily_drop_transition error:", error);
      return new Response(
        JSON.stringify({ success: false, error: "transition_failed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const payload = data as any;
    const drop = payload?.drop as any | undefined;
    const status: string | undefined = payload?.status;
    const idempotent: boolean = Boolean(payload?.idempotent);
    const terminal: boolean = Boolean(payload?.terminal);
    const matchId: string | undefined = payload?.match_id;

    // Only send notifications on non-terminal, non-idempotent, successful transitions
    if (drop && status && !idempotent && !terminal && payload?.success !== false) {
      try {
        if (action === "send_opener") {
          // Notify partner that an opener was sent
          let recipientId: string | null = null;
          if (drop.opener_sender_id === drop.user_a_id) {
            recipientId = drop.user_b_id;
          } else if (drop.opener_sender_id === drop.user_b_id) {
            recipientId = drop.user_a_id;
          }

          if (recipientId) {
            await serviceClient.functions.invoke("send-notification", {
              body: {
                user_id: recipientId,
                category: "daily_drop",
                title: "💧 Your Daily Drop sent you a message",
                body: "Reply before 6 PM tomorrow to unlock chat",
                data: { url: "/matches" },
              },
            });
          }
        } else if (action === "send_reply") {
          // Notify opener sender about the match / unlocked chat
          const openerId: string | null = drop.opener_sender_id || null;
          if (openerId) {
            // Fetch partner name for nicer title
            const { data: partnerProfile } = await serviceClient
              .from("profiles")
              .select("name")
              .eq("id", drop.reply_sender_id)
              .maybeSingle();

            const title = "You're connected! 🎉";
            const body =
              `You and ${partnerProfile?.name ?? "someone"} matched through Daily Drop`;

            const url = matchId ? `/chat/${matchId}` : "/matches";

            await serviceClient.functions.invoke("send-notification", {
              body: {
                user_id: openerId,
                category: "new_match",
                title,
                body,
                data: { url, match_id: matchId },
              },
            });
          }
        }
      } catch (notifyError) {
        console.error("daily-drop-actions notification error:", notifyError);
        // Intentionally do not fail the transition if notification send fails
      }
    }

    return new Response(
      JSON.stringify({ success: true, ...payload }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("daily-drop-actions unexpected error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "internal_error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

