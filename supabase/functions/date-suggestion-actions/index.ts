/**
 * Server-owned Date Suggestion transitions: calls date_suggestion_apply RPC (auth.uid()),
 * then fans out OneSignal via send-notification for allowed events.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

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
};

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
    const p_payload = body.payload && typeof body.payload === "object"
      ? body.payload
      : {};

    if (!p_action) {
      return new Response(
        JSON.stringify({ ok: false, error: "action_required" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: rpcResult, error: rpcError } = await userClient.rpc(
      "date_suggestion_apply_v2",
      { p_action, p_payload },
    );

    if (rpcError) {
      console.error("date_suggestion_apply error:", rpcError);
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

      return new Response(
        JSON.stringify({ ok: false, error: rpcError.message }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = rpcResult as Record<string, unknown>;
    if (result?.ok !== true) {
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
