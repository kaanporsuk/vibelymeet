import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import {
  corsHeadersForRequest,
  isBrowserOriginRejected,
  preflightResponse,
} from "../_shared/cors.ts";

type VerdictRpcResult = {
  success?: boolean;
  ok?: boolean;
  error?: string;
  code?: string;
  message?: string;
  mutual?: boolean;
  match_id?: string;
  already_matched?: boolean;
  verdict_recorded?: boolean;
  persistent_match_created?: boolean | null;
  awaiting_partner_verdict?: boolean;
  partner_verdict_recorded?: boolean;
  safety_report_recorded?: boolean;
  report_id?: string;
  committed?: boolean;
  session_seq?: number;
  verdict_state?: "awaiting_partner" | "resolved_mutual" | "resolved_not_mutual" | "safety_reported";
  next_surface?: Record<string, unknown> | null;
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

async function stableUuidFromParts(parts: string[]): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(parts.join(":")),
  ));
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

serve(async (req) => {
  const corsHeaders = corsHeadersForRequest(req);

  if (req.method === "OPTIONS") {
    return preflightResponse(req);
  }

  if (isBrowserOriginRejected(req)) {
    return new Response(JSON.stringify({ success: false, error: "origin_not_allowed" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => null) as {
      action?: "verdict" | "report";
      session_id?: string;
      liked?: boolean;
      idempotency_key?: string;
      safety_report?: unknown;
      transition_version?: string;
    } | null;
    const action = body?.action ?? "verdict";
    const sessionId = body?.session_id;
    const liked = body?.liked;
    const idempotencyKey = typeof body?.idempotency_key === "string" ? body.idempotency_key.trim() : "";
    if (!sessionId || (action === "verdict" && typeof liked !== "boolean")) {
      return new Response(JSON.stringify({ success: false, error: "invalid_request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "verdict" && body?.transition_version !== "v3") {
      logLifecycle({
        session_id: sessionId,
        user_id: null,
        category: "post_date_verdict",
        result: "unsupported_transition_version",
        error_reason: body?.transition_version ?? "missing_version",
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: "unsupported_transition_version",
          code: "unsupported_transition_version",
          message: "Post-date verdict persistence is v3-only.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (action === "verdict" && !idempotencyKey) {
      logLifecycle({
        session_id: sessionId,
        user_id: null,
        category: "post_date_verdict",
        result: "missing_idempotency_key",
        error_reason: "missing_idempotency_key",
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: "missing_idempotency_key",
          code: "missing_idempotency_key",
          message: "Post-date verdict persistence requires an idempotency key.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const effectiveLiked = action === "verdict" && body?.safety_report != null ? false : liked;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: authUser } = await userClient.auth.getUser();
    const actorUserId = authUser?.user?.id ?? null;

    const { data, error } = action === "report"
      ? await userClient.rpc("submit_post_date_safety_report_v1", {
          p_session_id: sessionId,
          p_idempotency_key: idempotencyKey,
          p_safety_report: body?.safety_report ?? null,
        })
      : await userClient.rpc("submit_post_date_verdict_v3", {
          p_session_id: sessionId,
          p_liked: effectiveLiked as boolean,
          p_idempotency_key: idempotencyKey,
          p_safety_report: body?.safety_report ?? null,
        });

    if (error) {
      console.error("post-date-verdict RPC error:", error);
      logLifecycle({
        session_id: sessionId,
        user_id: actorUserId,
        category: action === "report" ? "post_date_safety_report" : "post_date_verdict",
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
        category: action === "report" ? "post_date_safety_report" : "post_date_verdict",
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
      category: action === "report" ? "post_date_safety_report" : "post_date_verdict",
      result: action === "report"
        ? "recorded"
        : payload?.awaiting_partner_verdict
          ? "pending_partner"
          : payload?.mutual
            ? "mutual"
            : "recorded",
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
        const matchId = payload.match_id;
        const immediateBody = {
          category: "new_match" as const,
          title: "It's a match! 🎉",
          body: "You both vibed — start chatting now!",
          data: {
            url: "/matches",
            match_id: matchId,
          },
        };
        const matchNotificationBodyFor = async (recipientUserId: string, otherUserId: string) => ({
          ...immediateBody,
          dedupe_key: `post_date_match:${matchId}:${recipientUserId}`,
          provider_idempotency_key: await stableUuidFromParts([
            "post_date_match",
            matchId,
            recipientUserId,
          ]),
          data: {
            ...immediateBody.data,
            other_user_id: otherUserId,
            partner_id: otherUserId,
          },
        });
        const participant1Notification = await matchNotificationBodyFor(
          sess.participant_1_id,
          sess.participant_2_id,
        );
        const participant2Notification = await matchNotificationBodyFor(
          sess.participant_2_id,
          sess.participant_1_id,
        );
        try {
          await serviceClient.functions.invoke("send-notification", {
            body: { user_id: sess.participant_1_id, ...participant1Notification },
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
            body: { user_id: sess.participant_2_id, ...participant2Notification },
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
