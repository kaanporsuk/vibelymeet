import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * `handle_swipe` JSON when mutual vibe creates a video date session.
 * - `video_session_id` / `event_id` — canonical (session stage, not persistent chat).
 * - `match_id` — legacy alias equal to `video_session_id` (still NOT `matches.id`).
 * Super Vibe is capped per event (`limit_reached`, etc.); there is no `no_credits` branch in current SQL.
 */
type HandleSwipeSessionPayload = {
  result: string;
  match_id?: string;
  video_session_id?: string;
  event_id?: string;
  immediate?: boolean;
};

/** Deep link + OneSignal `data` for session-stage notifications (ready gate / video date entry). */
function sessionStageNotificationData(eventId: string, videoSessionId: string): Record<string, string> {
  const q = `pendingVideoSession=${encodeURIComponent(videoSessionId)}&pendingMatch=${encodeURIComponent(videoSessionId)}`;
  const path = `/event/${eventId}/lobby?${q}`;
  return {
    url: path,
    deep_link: path,
    video_session_id: videoSessionId,
    event_id: eventId,
    /** @deprecated Same as video_session_id — historical name; not matches.id */
    match_id: videoSessionId,
  };
}

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

    const raw = data as HandleSwipeSessionPayload;
    const result: HandleSwipeSessionPayload = { ...raw };
    if (result.result === "match" || result.result === "match_queued") {
      if (result.match_id && !result.video_session_id) {
        result.video_session_id = result.match_id;
      }
      result.event_id = result.event_id ?? String(event_id);
    }

    const sessionId = result.video_session_id ?? result.match_id;
    const eventIdStr = typeof result.event_id === "string" ? result.event_id : String(event_id);

    try {
      if (result.result === "match" && sessionId) {
        const dataPayload = sessionStageNotificationData(eventIdStr, sessionId);
        const immediateBody = {
          category: "ready_gate" as const,
          title: "You're synced up! 💚",
          body: "Open the event lobby for your ready gate and video date.",
          data: dataPayload,
        };
        try {
          await serviceClient.functions.invoke("send-notification", {
            body: { user_id: target_id, ...immediateBody },
          });
        } catch (e) {
          console.error("swipe-actions ready_gate notify target:", e);
        }
        try {
          await serviceClient.functions.invoke("send-notification", {
            body: { user_id: actorId, ...immediateBody },
          });
        } catch (e) {
          console.error("swipe-actions ready_gate notify actor:", e);
        }
        // No email: legacy `new_match` template implied persistent chat + /matches — incorrect for session stage.
      } else if (result.result === "match_queued" && sessionId) {
        await serviceClient.functions.invoke("send-notification", {
          body: {
            user_id: target_id,
            category: "ready_gate",
            title: "Your video date is ready 📹",
            body: "Someone mutual-vibed with you — open the event lobby to join the ready gate.",
            data: sessionStageNotificationData(eventIdStr, sessionId),
          },
        });
      } else if (
        result.result === "super_vibe_sent" ||
        result.result === "vibe_recorded" ||
        result.result === "swipe_recorded"
      ) {
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
