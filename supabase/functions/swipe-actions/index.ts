import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type SwipeResult = {
  result: string;
  match_id?: string;
  immediate?: boolean;
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

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const { event_id, target_id, swipe_type } = await req.json();

    if (!event_id || !target_id || !swipe_type) {
      return new Response(
        JSON.stringify({ success: false, error: "invalid_request" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: userRes, error: userError } = await userClient.auth.getUser();
    if (userError || !userRes?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const actorId = userRes.user.id;

    const { data, error } = await userClient.rpc("handle_swipe", {
      p_event_id: event_id,
      p_actor_id: actorId,
      p_target_id: target_id,
      p_swipe_type: swipe_type,
    });

    if (error) {
      console.error("swipe-actions handle_swipe error:", error);
      return new Response(
        JSON.stringify({ success: false, error: "swipe_failed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = data as SwipeResult;

    // Only send notifications for specific results; rely on handle_swipe's own idempotency (e.g. already_matched / already_super_vibed_recently)
    try {
      if (result.result === "match" && result.match_id) {
        const matchBody = {
          category: "new_match" as const,
          title: "It's a match! 🎉",
          body: "You both vibed — start chatting now!",
          data: { url: "/matches", match_id: result.match_id },
        };
        try {
          await serviceClient.functions.invoke("send-notification", {
            body: { user_id: target_id, ...matchBody },
          });
        } catch (e) {
          console.error("swipe-actions new_match notify target:", e);
        }
        try {
          await serviceClient.functions.invoke("send-notification", {
            body: { user_id: actorId, ...matchBody },
          });
        } catch (e) {
          console.error("swipe-actions new_match notify actor:", e);
        }
      } else if (result.result === "match_queued" && result.match_id) {
        // Notify partner about queued match / ready gate
        await serviceClient.functions.invoke("send-notification", {
          body: {
            user_id: target_id,
            category: "ready_gate",
            title: "Video date ready! 📹",
            body: "Someone is waiting — tap to join your video date",
            data: { url: "/matches", match_id: result.match_id },
          },
        });
      } else if (result.result === "super_vibe_sent" || result.result === "vibe_recorded") {
        // Notify target that someone vibed them (do not reveal who)
        await serviceClient.functions.invoke("send-notification", {
          body: {
            user_id: target_id,
            category: "someone_vibed_you",
            title: "Someone vibed you! 💜",
            body: "Join the event to find out who",
            data: { url: "/events" },
          },
        });
      }
    } catch (notifyError) {
      console.error("swipe-actions notification error:", notifyError);
    }

    return new Response(
      JSON.stringify({ success: true, ...result }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("swipe-actions unexpected error:", err);
    return new Response(
      JSON.stringify({ success: false, error: "internal_error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

