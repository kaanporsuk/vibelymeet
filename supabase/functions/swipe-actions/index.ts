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
  success?: boolean;
  result?: string;
  outcome?: string;
  error?: string;
  reason?: string;
  match_id?: string;
  video_session_id?: string;
  event_id?: string;
  immediate?: boolean;
  duplicate?: boolean;
  idempotent?: boolean;
  replay?: boolean;
  notification_suppressed?: boolean;
  dedupe_reason?: string;
  existing_swipe_type?: string;
  requested_swipe_type?: string;
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

function logLifecycle(payload: {
  event_id: string | null;
  session_id: string | null;
  user_id: string | null;
  target_id?: string | null;
  event_name?: string;
  platform?: "edge";
  admission_status?: string | null;
  queue_id?: string | null;
  category: string;
  result: string;
  outcome?: string | null;
  reason?: string | null;
  swipe_type?: string | null;
  duplicate?: boolean;
  session_id_present?: boolean;
  notification_attempted?: boolean;
  notification_suppressed?: boolean;
  notification_suppressed_reason?: string | null;
  dedupe_reason?: string | null;
  error_reason?: string | null;
}) {
  const {
    user_id,
    target_id,
    error_reason,
    dedupe_reason,
    notification_suppressed_reason,
    reason,
    ...rest
  } = payload;
  console.log("lifecycle.swipe_actions", JSON.stringify({
    platform: "edge",
    actor_present: Boolean(user_id),
    target_present: Boolean(target_id),
    reason: sanitizeReasonCode(reason ?? error_reason ?? dedupe_reason ?? rest.result),
    notification_suppressed_reason: notification_suppressed_reason == null
      ? null
      : sanitizeReasonCode(notification_suppressed_reason),
    dedupe_reason: dedupe_reason == null ? null : sanitizeReasonCode(dedupe_reason),
    ...rest,
  }));
}

function sanitizeReasonCode(value: unknown, fallback = "unknown"): string {
  if (typeof value !== "string") return fallback;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function getSwipeOutcome(result: HandleSwipeSessionPayload): string {
  return sanitizeReasonCode(result.outcome ?? result.result ?? result.error ?? "ok");
}

function isDuplicateSwipeResult(result: HandleSwipeSessionPayload): boolean {
  const outcome = getSwipeOutcome(result);
  return result.duplicate === true ||
    result.idempotent === true ||
    result.replay === true ||
    outcome === "already_swiped" ||
    outcome === "swipe_already_recorded";
}

function shouldSuppressSwipeNotification(result: HandleSwipeSessionPayload): boolean {
  const outcome = getSwipeOutcome(result);
  const explicitNoNotifyOutcomes = new Set([
    "already_swiped",
    "swipe_already_recorded",
    "event_not_active",
    "blocked",
    "reported",
    "account_paused",
    "target_unavailable",
    "participant_has_active_session_conflict",
  ]);
  return result.notification_suppressed === true ||
    isDuplicateSwipeResult(result) ||
    explicitNoNotifyOutcomes.has(outcome);
}

function notificationSuppressionReason(
  result: HandleSwipeSessionPayload,
  suppressNotifications: boolean,
): string | null {
  if (!suppressNotifications) return null;
  return sanitizeReasonCode(
    result.dedupe_reason ?? result.reason ?? result.error ?? result.outcome ?? result.result ?? "suppressed",
    "suppressed",
  );
}

function shouldAttemptSwipeNotification(
  result: HandleSwipeSessionPayload,
  suppressNotifications: boolean,
): boolean {
  if (suppressNotifications) return false;
  const outcome = getSwipeOutcome(result);
  return outcome === "match" ||
    outcome === "match_queued" ||
    outcome === "vibe_recorded" ||
    outcome === "super_vibe_sent";
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
      logLifecycle({
        event_id: String(event_id),
        session_id: null,
        user_id: actorId,
        event_name: "lobby_swipe_result",
        category: "swipe_action",
        result: "rpc_error",
        outcome: "rpc_error",
        reason: error.code ?? "rpc_error",
        session_id_present: false,
        notification_attempted: false,
        notification_suppressed: true,
        notification_suppressed_reason: "rpc_error",
        error_reason: error.code ?? "rpc_error",
      });
      return new Response(
        JSON.stringify({ success: false, error: "swipe_failed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const raw = data as HandleSwipeSessionPayload;
    const result: HandleSwipeSessionPayload = {
      ...raw,
      // Canonicalize historical alias at the edge boundary.
      result: raw.result === "swipe_recorded" ? "vibe_recorded" : raw.result,
      outcome: raw.outcome ?? (raw.result === "swipe_recorded" ? "vibe_recorded" : raw.result),
    };
    if (result.result === "match" || result.result === "match_queued") {
      if (result.match_id && !result.video_session_id) {
        result.video_session_id = result.match_id;
      }
      result.event_id = result.event_id ?? String(event_id);
    }

    const sessionId = result.video_session_id ?? result.match_id;
    const eventIdStr = typeof result.event_id === "string" ? result.event_id : String(event_id);
    const suppressNotifications = shouldSuppressSwipeNotification(result);
    const duplicate = isDuplicateSwipeResult(result);
    const outcome = getSwipeOutcome(result);
    const suppressedReason = notificationSuppressionReason(result, suppressNotifications);
    const notificationAttempted = shouldAttemptSwipeNotification(result, suppressNotifications);

    logLifecycle({
      event_id: eventIdStr,
      session_id: sessionId ?? null,
      user_id: actorId,
      target_id: String(target_id),
      event_name: "lobby_swipe_result",
      category: "swipe_action",
      result: outcome,
      outcome,
      reason: result.reason ?? result.dedupe_reason ?? outcome,
      swipe_type: String(swipe_type),
      duplicate,
      session_id_present: Boolean(sessionId),
      notification_attempted: notificationAttempted,
      notification_suppressed: suppressNotifications,
      notification_suppressed_reason: suppressedReason,
      dedupe_reason: result.dedupe_reason ?? suppressedReason,
      error_reason: null,
    });
    if (duplicate) {
      logLifecycle({
        event_id: eventIdStr,
        session_id: sessionId ?? null,
        user_id: actorId,
        target_id: String(target_id),
        event_name: "lobby_swipe_duplicate_suppressed",
        category: "swipe_action",
        result: "duplicate_suppressed",
        outcome,
        reason: suppressedReason ?? "already_swiped",
        swipe_type: String(swipe_type),
        duplicate: true,
        session_id_present: Boolean(sessionId),
        notification_attempted: false,
        notification_suppressed: true,
        notification_suppressed_reason: suppressedReason ?? "already_swiped",
        dedupe_reason: suppressedReason ?? "already_swiped",
        error_reason: null,
      });
    }

    try {
      if (suppressNotifications) {
        logLifecycle({
          event_id: eventIdStr,
          session_id: sessionId ?? null,
          user_id: actorId,
          target_id: String(target_id),
          event_name: "notification_suppressed",
          category: "swipe_notification_dedupe",
          result: "notification_suppressed",
          outcome,
          reason: suppressedReason ?? "suppressed",
          swipe_type: String(swipe_type),
          duplicate,
          session_id_present: Boolean(sessionId),
          notification_attempted: false,
          notification_suppressed: true,
          notification_suppressed_reason: suppressedReason ?? "suppressed",
          dedupe_reason: suppressedReason ?? "suppressed",
          error_reason: null,
        });
      } else if (result.result === "match" && sessionId) {
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
          logLifecycle({
            event_id: eventIdStr,
            session_id: sessionId,
            user_id: String(target_id),
            target_id: String(target_id),
            event_name: "notification_sent",
            category: "ready_gate",
            result: "notify_sent",
            outcome: "notification_sent",
            reason: "match",
            swipe_type: String(swipe_type),
            session_id_present: true,
            notification_attempted: true,
            notification_suppressed: false,
            notification_suppressed_reason: null,
            error_reason: null,
          });
        } catch (e) {
          console.error("swipe-actions ready_gate notify target:", e);
          logLifecycle({
            event_id: eventIdStr,
            session_id: sessionId,
            user_id: String(target_id),
            target_id: String(target_id),
            event_name: "notification_suppressed",
            category: "ready_gate",
            result: "notify_error",
            outcome: "notify_error",
            reason: "notify_error",
            swipe_type: String(swipe_type),
            session_id_present: true,
            notification_attempted: true,
            notification_suppressed: true,
            notification_suppressed_reason: "notify_error",
            error_reason: "notify_error",
          });
        }
        try {
          await serviceClient.functions.invoke("send-notification", {
            body: { user_id: actorId, ...immediateBody },
          });
          logLifecycle({
            event_id: eventIdStr,
            session_id: sessionId,
            user_id: actorId,
            target_id: String(target_id),
            event_name: "notification_sent",
            category: "ready_gate",
            result: "notify_sent",
            outcome: "notification_sent",
            reason: "match",
            swipe_type: String(swipe_type),
            session_id_present: true,
            notification_attempted: true,
            notification_suppressed: false,
            notification_suppressed_reason: null,
            error_reason: null,
          });
        } catch (e) {
          console.error("swipe-actions ready_gate notify actor:", e);
          logLifecycle({
            event_id: eventIdStr,
            session_id: sessionId,
            user_id: actorId,
            target_id: String(target_id),
            event_name: "notification_suppressed",
            category: "ready_gate",
            result: "notify_error",
            outcome: "notify_error",
            reason: "notify_error",
            swipe_type: String(swipe_type),
            session_id_present: true,
            notification_attempted: true,
            notification_suppressed: true,
            notification_suppressed_reason: "notify_error",
            error_reason: "notify_error",
          });
        }
        // No email: legacy `new_match` template implied persistent chat + /matches — incorrect for session stage.
      } else if (result.result === "match_queued" && sessionId) {
        const queuedPayload = sessionStageNotificationData(eventIdStr, sessionId);
        const queuedBody = {
          category: "ready_gate" as const,
          data: queuedPayload,
        };
        try {
          await serviceClient.functions.invoke("send-notification", {
            body: {
              user_id: target_id,
              ...queuedBody,
              title: "Your video date is ready 📹",
              body: "Someone mutual-vibed with you — open the event lobby to join the ready gate.",
            },
          });
          logLifecycle({
            event_id: eventIdStr,
            session_id: sessionId,
            user_id: String(target_id),
            target_id: String(target_id),
            event_name: "notification_sent",
            category: "ready_gate",
            result: "notify_sent",
            outcome: "notification_sent",
            reason: "match_queued",
            swipe_type: String(swipe_type),
            session_id_present: true,
            notification_attempted: true,
            notification_suppressed: false,
            notification_suppressed_reason: null,
            error_reason: null,
          });
        } catch (e) {
          console.error("swipe-actions match_queued notify target:", e);
          logLifecycle({
            event_id: eventIdStr,
            session_id: sessionId,
            user_id: String(target_id),
            target_id: String(target_id),
            event_name: "notification_suppressed",
            category: "ready_gate",
            result: "notify_error",
            outcome: "notify_error",
            reason: "notify_error",
            swipe_type: String(swipe_type),
            session_id_present: true,
            notification_attempted: true,
            notification_suppressed: true,
            notification_suppressed_reason: "notify_error",
            error_reason: "notify_error",
          });
        }
        try {
          await serviceClient.functions.invoke("send-notification", {
            body: {
              user_id: actorId,
              ...queuedBody,
              title: "Stay in the lobby 💚",
              body: "You’re matched — we’ll open Ready Gate when you’re both free in this event.",
            },
          });
          logLifecycle({
            event_id: eventIdStr,
            session_id: sessionId,
            user_id: actorId,
            target_id: String(target_id),
            event_name: "notification_sent",
            category: "ready_gate",
            result: "notify_sent",
            outcome: "notification_sent",
            reason: "match_queued",
            swipe_type: String(swipe_type),
            session_id_present: true,
            notification_attempted: true,
            notification_suppressed: false,
            notification_suppressed_reason: null,
            error_reason: null,
          });
        } catch (e) {
          console.error("swipe-actions match_queued notify actor:", e);
          logLifecycle({
            event_id: eventIdStr,
            session_id: sessionId,
            user_id: actorId,
            target_id: String(target_id),
            event_name: "notification_suppressed",
            category: "ready_gate",
            result: "notify_error",
            outcome: "notify_error",
            reason: "notify_error",
            swipe_type: String(swipe_type),
            session_id_present: true,
            notification_attempted: true,
            notification_suppressed: true,
            notification_suppressed_reason: "notify_error",
            error_reason: "notify_error",
          });
        }
      } else if (
        result.result === "super_vibe_sent" ||
        result.result === "vibe_recorded"
      ) {
        await serviceClient.functions.invoke("send-notification", {
          body: {
            user_id: target_id,
            category: "someone_vibed_you",
            title: "Someone vibed you! 💜",
            body: "Join the event to find out who",
            data: { url: "/events", event_id: eventIdStr, actor_id: actorId },
          },
        });
        logLifecycle({
          event_id: eventIdStr,
          session_id: null,
          user_id: String(target_id),
          target_id: String(target_id),
          event_name: "notification_sent",
          category: "someone_vibed_you",
          result: "notify_sent",
          outcome: "notification_sent",
          reason: result.result ?? result.outcome ?? "vibe_recorded",
          swipe_type: String(swipe_type),
          session_id_present: false,
          notification_attempted: true,
          notification_suppressed: false,
          notification_suppressed_reason: null,
          error_reason: null,
        });
      }
    } catch (notifyError) {
      console.error("swipe-actions notification error:", notifyError);
      logLifecycle({
        event_id: eventIdStr,
        session_id: sessionId ?? null,
        user_id: actorId,
        target_id: String(target_id),
        event_name: "notification_suppressed",
        category: "swipe_action",
        result: "notify_error",
        outcome: "notify_error",
        reason: "notify_error",
        swipe_type: String(swipe_type),
        session_id_present: Boolean(sessionId),
        notification_attempted: true,
        notification_suppressed: true,
        notification_suppressed_reason: "notify_error",
        error_reason: "notify_error",
      });
    }

    return new Response(
      JSON.stringify({ success: true, ...result }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("swipe-actions unexpected error:", err);
    logLifecycle({
      event_id: null,
      session_id: null,
      user_id: null,
      event_name: "lobby_swipe_result",
      category: "swipe_action",
      result: "error",
      outcome: "error",
      reason: "internal_error",
      session_id_present: false,
      notification_attempted: false,
      notification_suppressed: true,
      notification_suppressed_reason: "internal_error",
      error_reason: "internal_error",
    });
    return new Response(
      JSON.stringify({ success: false, error: "internal_error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
