import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type VerdictRpcResult = {
  success?: boolean;
  error?: string;
  mutual?: boolean;
  match_id?: string;
  already_matched?: boolean;
  verdict_recorded?: boolean;
  persistent_match_created?: boolean | null;
};

function logLifecycle(payload: {
  event_id?: string | null;
  session_id: string | null;
  user_id: string | null;
  admission_status?: string | null;
  queue_id?: string | null;
  category: string;
  result: string;
  error_reason?: string | null;
}) {
  console.log("lifecycle.post_date_verdict", JSON.stringify(payload));
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

    const body = await req.json().catch(() => null) as { session_id?: string; liked?: boolean } | null;
    const sessionId = body?.session_id;
    const liked = body?.liked;
    if (!sessionId || typeof liked !== "boolean") {
      return new Response(JSON.stringify({ success: false, error: "invalid_request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authUser } = await userClient.auth.getUser();
    const actorUserId = authUser?.user?.id ?? null;

    const { data, error } = await userClient.rpc("submit_post_date_verdict", {
      p_session_id: sessionId,
      p_liked: liked,
    });

    if (error) {
      console.error("post-date-verdict RPC error:", error);
      logLifecycle({
        session_id: sessionId,
        user_id: actorUserId,
        category: "post_date_verdict",
        result: "rpc_error",
        error_reason: error.message,
      });
      return new Response(JSON.stringify({ success: false, error: "rpc_failed", message: error.message }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = data as VerdictRpcResult;
    if (payload?.success === false) {
      logLifecycle({
        session_id: sessionId,
        user_id: actorUserId,
        category: "post_date_verdict",
        result: "rejected",
        error_reason: payload.error ?? "rpc_rejected",
      });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    logLifecycle({
      session_id: sessionId,
      user_id: actorUserId,
      category: "post_date_verdict",
      result: payload?.mutual ? "mutual" : "recorded",
      error_reason: null,
    });

    // Server-owned push: only when this resolution created a new persistent matches row (avoid duplicate toasts).
    if (
      payload?.mutual === true &&
      payload?.persistent_match_created === true &&
      typeof payload?.match_id === "string"
    ) {
      const serviceClient = createClient(supabaseUrl, serviceRoleKey);
      const { data: sess } = await serviceClient
        .from("video_sessions")
        .select("participant_1_id, participant_2_id")
        .eq("id", sessionId)
        .maybeSingle();

      if (sess?.participant_1_id && sess?.participant_2_id) {
        const immediateBody = {
          category: "new_match" as const,
          title: "It's a match! 🎉",
          body: "You both vibed — start chatting now!",
          data: {
            url: "/matches",
            match_id: payload.match_id,
          },
        };
        try {
          await serviceClient.functions.invoke("send-notification", {
            body: { user_id: sess.participant_1_id, ...immediateBody },
          });
          logLifecycle({
            session_id: sessionId,
            user_id: sess.participant_1_id,
            category: "new_match",
            result: "notify_sent",
            error_reason: null,
          });
        } catch (e) {
          console.error("post-date-verdict notify p1:", e);
          logLifecycle({
            session_id: sessionId,
            user_id: sess.participant_1_id,
            category: "new_match",
            result: "notify_error",
            error_reason: e instanceof Error ? e.message : String(e),
          });
        }
        try {
          await serviceClient.functions.invoke("send-notification", {
            body: { user_id: sess.participant_2_id, ...immediateBody },
          });
          logLifecycle({
            session_id: sessionId,
            user_id: sess.participant_2_id,
            category: "new_match",
            result: "notify_sent",
            error_reason: null,
          });
        } catch (e) {
          console.error("post-date-verdict notify p2:", e);
          logLifecycle({
            session_id: sessionId,
            user_id: sess.participant_2_id,
            category: "new_match",
            result: "notify_error",
            error_reason: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    return new Response(JSON.stringify(payload ?? {}), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("post-date-verdict unexpected error:", err);
    logLifecycle({
      session_id: null,
      user_id: null,
      category: "post_date_verdict",
      result: "error",
      error_reason: err instanceof Error ? err.message : String(err),
    });
    return new Response(JSON.stringify({ success: false, error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
