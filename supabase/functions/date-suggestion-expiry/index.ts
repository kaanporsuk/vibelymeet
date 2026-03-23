/**
 * Cron: expire negotiations past expires_at; send expiring-soon once per suggestion.
 * Auth: Authorization: Bearer ${CRON_SECRET} (same pattern as event-reminders).
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const cronSecret = Deno.env.get("CRON_SECRET");
  const incoming = req.headers.get("Authorization");
  if (!cronSecret || incoming !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const now = new Date().toISOString();
  const soon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data: soonRows, error: soonErr } = await supabase
      .from("date_suggestions")
      .select("id, match_id, proposer_id, recipient_id, status, expires_at")
      .in("status", ["proposed", "viewed", "countered"])
      .not("expires_at", "is", null)
      .lte("expires_at", soon)
      .gt("expires_at", now)
      .is("expiring_soon_sent_at", null);

    if (soonErr) {
      console.error("date-suggestion-expiry soon query:", soonErr);
      return new Response(
        JSON.stringify({ success: false, error: soonErr.message }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let soonCount = 0;
    for (const row of soonRows || []) {
      const notifyPeer = async (recipientId: string, peerId: string) => {
        await supabase.functions.invoke("send-notification", {
          body: {
            user_id: recipientId,
            category: "date_suggestion_expiring_soon",
            data: {
              match_id: row.match_id,
              sender_id: peerId,
              other_user_id: peerId,
              date_suggestion_id: row.id,
              url: `/chat/${peerId}`,
              deep_link: `/chat/${peerId}`,
            },
          },
        });
      };

      try {
        await notifyPeer(row.proposer_id, row.recipient_id);
        await notifyPeer(row.recipient_id, row.proposer_id);
        await supabase
          .from("date_suggestions")
          .update({ expiring_soon_sent_at: now })
          .eq("id", row.id);

        await supabase.from("date_suggestion_transition_log").insert({
          date_suggestion_id: row.id,
          actor_id: null,
          action: "expiring_soon_notify",
          from_status: row.status,
          to_status: row.status,
          success: true,
          payload: { phase: "expiring_soon" },
        });
        soonCount += 1;
      } catch (e) {
        console.error("expiring soon row error:", row.id, e);
      }
    }

    const { data: toExpire, error: expSelErr } = await supabase
      .from("date_suggestions")
      .select("id, match_id, status")
      .in("status", ["proposed", "viewed", "countered"])
      .lt("expires_at", now);

    if (expSelErr) {
      console.error("date-suggestion-expiry expire select:", expSelErr);
      return new Response(
        JSON.stringify({ success: false, error: expSelErr.message }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let expiredCount = 0;
    for (const row of toExpire || []) {
      const { error: upErr } = await supabase
        .from("date_suggestions")
        .update({ status: "expired", updated_at: now })
        .eq("id", row.id);
      if (upErr) {
        console.error("expire update", row.id, upErr);
        continue;
      }
      await supabase.from("date_suggestion_transition_log").insert({
        date_suggestion_id: row.id,
        actor_id: null,
        action: "expire",
        from_status: row.status,
        to_status: "expired",
        success: true,
        payload: {},
      });
      expiredCount += 1;
    }

    return new Response(
      JSON.stringify({
        success: true,
        expiring_soon_processed: soonCount,
        expired: expiredCount,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("date-suggestion-expiry:", err);
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
