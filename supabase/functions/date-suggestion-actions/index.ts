/**
 * Server-owned Date Suggestion transitions: calls date_suggestion_apply_v2 RPC (auth.uid()),
 * then fans out OneSignal via send-notification for allowed events.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import {
  dateSuggestionRpcErrorCode,
  normalizeDateSuggestionActionPayload,
} from "../_shared/dateSuggestionActionContract.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type NotifyPayload = {
  kind: string;
  recipient_id: string;
  match_id: string;
  suggestion_id: string;
  from_user_id: string;
};

const CATEGORY_BY_KIND: Record<string, string> = {
  proposed: "date_suggestion_proposed",
  countered: "date_suggestion_countered",
  accepted: "date_suggestion_accepted",
  declined: "date_suggestion_declined",
  cancelled: "date_suggestion_cancelled",
  schedule_share_updated: "date_suggestion_schedule_share_updated",
  // Emitted when an accepted date_plan is cancelled via the new cancel_plan
  // action — partner gets the same category as a regular cancellation so
  // existing notification templates continue to work.
  plan_cancelled: "date_suggestion_cancelled",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function truthyFlag(value: unknown): boolean {
  return ["true", "t", "1", "yes"].includes(String(value ?? "false").toLowerCase());
}

function domainErrorResponse(error: string) {
  return new Response(
    JSON.stringify({ ok: false, error, error_code: error }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

async function sendNotify(
  serviceClient: ReturnType<typeof createClient>,
  n: NotifyPayload,
): Promise<void> {
  const category = CATEGORY_BY_KIND[n.kind];
  if (!category) return;

  const { data: senderProfile } = await serviceClient
    .from("profiles")
    .select("name")
    .eq("id", n.from_user_id)
    .maybeSingle();

  const senderName = senderProfile?.name?.split(/\s+/)[0] ?? "Someone";

  await serviceClient.functions.invoke("send-notification", {
    body: {
      user_id: n.recipient_id,
      category,
      data: {
        match_id: n.match_id,
        sender_id: n.from_user_id,
        other_user_id: n.from_user_id,
        date_suggestion_id: n.suggestion_id,
        url: `/chat/${n.from_user_id}`,
        deep_link: `/chat/${n.from_user_id}`,
        senderName,
      },
    },
  });
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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const p_action = typeof body.action === "string" ? body.action : "";
    const rawPayload = isRecord(body.payload)
      ? body.payload
      : {};

    if (!p_action) {
      return domainErrorResponse("action_required");
    }

    const normalized = normalizeDateSuggestionActionPayload(p_action, rawPayload);
    if (normalized.ok !== true) {
      return domainErrorResponse(normalized.error);
    }
    const p_payload = normalized.payload;

    const requiresDateSuggestionCapability = [
      "create_draft",
      "update_draft",
      "send_proposal",
    ].includes(p_action);
    const revision = isRecord(p_payload.revision) ? p_payload.revision : {};
    const shareRequested =
      normalized.shareRequested ||
      (["send_proposal", "counter"].includes(p_action) &&
        truthyFlag(revision.schedule_share_enabled)) ||
      p_action === "edit_schedule_share_slots";

    if (requiresDateSuggestionCapability || shareRequested) {
      const { data: authData, error: authError } = await userClient.auth.getUser();
      if (authError || !authData.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: capabilities, error: capabilityError } = await userClient.rpc(
        "get_user_tier_capabilities",
        { p_user_id: authData.user.id },
      );

      if (capabilityError) {
        return domainErrorResponse("entitlements_unavailable");
      }

      const caps = capabilities && typeof capabilities === "object" && !Array.isArray(capabilities)
        ? capabilities as Record<string, unknown>
        : {};

      if (requiresDateSuggestionCapability && caps.canSuggestDate !== true) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "tier_capability_disabled",
            error_code: "tier_capability_disabled",
            capability: "canSuggestDate",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (shareRequested && caps.canUseVibeSchedule !== true) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "tier_capability_disabled",
            error_code: "tier_capability_disabled",
            capability: "canUseVibeSchedule",
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const rpcName = p_action === "plan_mark_complete"
      ? "date_plan_mark_complete_v2"
      : "date_suggestion_apply_v2";

    const rpcCall =
      rpcName === "date_plan_mark_complete_v2"
        ? userClient.rpc(rpcName, {
          p_plan_id: typeof p_payload.plan_id === "string" ? p_payload.plan_id : null,
        })
        : userClient.rpc(
          rpcName,
          { p_action, p_payload },
        );

    const { data: rpcResult, error: rpcError } = await rpcCall;

    if (rpcError) {
      console.error(`${rpcName} error:`, rpcError);
      const rpcMessage = String(rpcError.message || "");
      const isActiveConflict =
        p_action === "send_proposal" &&
        (rpcMessage.includes("date_suggestions_one_open_per_match") ||
          rpcMessage.toLowerCase().includes("duplicate key"));

      if (isActiveConflict) {
        const payloadMatchId = typeof p_payload?.match_id === "string"
          ? p_payload.match_id
          : null;
        let existingSuggestionId: string | null = null;
        let existingStatus: string | null = null;

        if (payloadMatchId) {
          const { data: existing } = await userClient
            .from("date_suggestions")
            .select("id, status")
            .eq("match_id", payloadMatchId)
            .in("status", ["draft", "proposed", "viewed", "countered"])
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          existingSuggestionId = existing?.id ?? null;
          existingStatus = existing?.status ?? null;
        }

        return new Response(
          JSON.stringify({
            ok: false,
            error: "active_suggestion_exists",
            error_code: "active_suggestion_exists",
            suggestion_id: existingSuggestionId,
            status: existingStatus,
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const mappedError = dateSuggestionRpcErrorCode(rpcError.message);
      if (mappedError) return domainErrorResponse(mappedError);

      return domainErrorResponse("date_suggestion_action_failed");
    }

    const result = rpcResult as Record<string, unknown>;
    if (result?.ok !== true) {
      const mappedError = dateSuggestionRpcErrorCode(result?.error);
      if (mappedError) return domainErrorResponse(mappedError);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const notify = result.notify as NotifyPayload | undefined;
    if (notify?.recipient_id && notify?.from_user_id) {
      try {
        await sendNotify(serviceClient, notify);
      } catch (e) {
        console.error("date-suggestion-actions notify error:", e);
      }
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("date-suggestion-actions:", err);
    return new Response(
      JSON.stringify({ ok: false, error: "internal_error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
