/**
 * Event reminders: process event_reminder_queue (30min + 5min before event).
 * Invoke every minute via external cron or Supabase scheduled invocations (CRON_SECRET).
 * Claims rows atomically (sent_at) then sends; unclaims on failure for retry.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const TITLES: Record<string, string> = {
  event_reminder_30m: "Event in 30 minutes ⏰",
  event_reminder_5m: "Starting in 5 minutes! 🎉",
};

const BODY = (eventTitle: string, type: string): string =>
  type === "event_reminder_30m"
    ? `${eventTitle} starts soon. Get ready to join the lobby.`
    : `${eventTitle} is about to begin. Tap through to the lobby.`;

function logLifecycle(payload: {
  event_id: string | null;
  session_id?: string | null;
  user_id: string | null;
  admission_status: string | null;
  queue_id: string | null;
  category: string;
  result: string;
  error_reason?: string | null;
}) {
  console.log("lifecycle.event_reminders", JSON.stringify(payload));
}

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

  try {
    const claimTime = new Date().toISOString();
    const { data: rows, error } = await supabase
      .from("event_reminder_queue")
      .update({ sent_at: claimTime })
      .is("sent_at", null)
      .order("created_at", { ascending: true })
      .limit(100)
      .select("id, profile_id, event_id, event_title, reminder_type");

    if (error) {
      console.error("event-reminders claim error:", error);
      logLifecycle({
        event_id: null,
        user_id: null,
        admission_status: null,
        queue_id: null,
        category: "event_reminder",
        result: "claim_error",
        error_reason: error.message,
      });
      return new Response(
        JSON.stringify({ success: false, error: error.message }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let processed = 0;
    for (const row of rows || []) {
      try {
        const { data: reg } = await supabase
          .from("event_registrations")
          .select("admission_status")
          .eq("event_id", row.event_id)
          .eq("profile_id", row.profile_id)
          .maybeSingle();

        const admissionStatus = (reg?.admission_status as string | undefined) ?? "confirmed";
        const isConfirmed = admissionStatus === "confirmed";
        const body = isConfirmed
          ? BODY(row.event_title, row.reminder_type)
          : row.reminder_type === "event_reminder_30m"
            ? `${row.event_title} starts soon. You’re still on the waitlist, so keep an eye on the event page for status updates.`
            : `${row.event_title} is about to begin. You’re still on the waitlist, so keep an eye on the event page for status updates.`;

        const { error: invokeError } = await supabase.functions.invoke(
          "send-notification",
          {
            body: {
              user_id: row.profile_id,
              category: row.reminder_type,
              title: TITLES[row.reminder_type] ?? "Event reminder",
              body,
              data: {
                event_id: row.event_id,
                event_title: row.event_title,
                admission_status: admissionStatus,
              },
            },
          },
        );

        if (invokeError) {
          console.error(
            "send-notification transport error for",
            row.id,
            invokeError,
          );
          logLifecycle({
            event_id: row.event_id,
            user_id: row.profile_id,
            admission_status: admissionStatus,
            queue_id: row.id,
            category: row.reminder_type,
            result: "delivery_error",
            error_reason: invokeError.message,
          });
          await supabase
            .from("event_reminder_queue")
            .update({ sent_at: null })
            .eq("id", row.id);
          continue;
        }

        logLifecycle({
          event_id: row.event_id,
          user_id: row.profile_id,
          admission_status: admissionStatus,
          queue_id: row.id,
          category: row.reminder_type,
          result: "sent",
          error_reason: null,
        });
        processed++;
      } catch (e) {
        console.error("send-notification threw for", row.id, e);
        logLifecycle({
          event_id: row.event_id,
          user_id: row.profile_id,
          admission_status: null,
          queue_id: row.id,
          category: row.reminder_type,
          result: "delivery_error",
          error_reason: e instanceof Error ? e.message : String(e),
        });
        await supabase
          .from("event_reminder_queue")
          .update({ sent_at: null })
          .eq("id", row.id);
        continue;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        claimed: (rows ?? []).length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("event-reminders error:", err);
    logLifecycle({
      event_id: null,
      user_id: null,
      admission_status: null,
      queue_id: null,
      category: "event_reminder",
      result: "error",
      error_reason: err instanceof Error ? err.message : String(err),
    });
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
