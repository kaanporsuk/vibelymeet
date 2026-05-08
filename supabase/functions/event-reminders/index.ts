/**
 * Event reminders: process event_reminder_queue (30min + 5min before event).
 * Invoke every minute via external cron or Supabase scheduled invocations (CRON_SECRET).
 *
 * Crash-recovery contract (definitive, paired with migration 20260508141000):
 *   - claim_due_event_reminder_queue_rows() does an atomic SKIP LOCKED claim and
 *     ALWAYS sweeps stale claims first, so a worker that crashed mid-batch
 *     cannot strand reminders.
 *   - mark_event_reminder_queue_row_delivered() is the only success terminal.
 *   - release_event_reminder_queue_row_on_failure() unclaims immediately on
 *     any upstream failure so the row is eligible for the next worker tick
 *     without waiting for the sweeper threshold.
 *   - All three RPCs are SECURITY DEFINER + service_role-only.
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

const STALE_CLAIM_THRESHOLD_SECONDS = 120;
const CLAIM_BATCH_SIZE = 100;

type ClaimedRow = {
  id: string;
  profile_id: string;
  event_id: string;
  event_title: string;
  reminder_type: string;
  delivery_attempts: number | null;
  last_error_reason: string | null;
};

function logLifecycle(payload: {
  event_id: string | null;
  session_id?: string | null;
  user_id: string | null;
  admission_status: string | null;
  queue_id: string | null;
  category: string;
  result: string;
  error_reason?: string | null;
  delivery_attempts?: number | null;
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
    const { data: claimedData, error: claimError } = await supabase.rpc(
      "claim_due_event_reminder_queue_rows",
      {
        p_limit: CLAIM_BATCH_SIZE,
        p_stale_after_seconds: STALE_CLAIM_THRESHOLD_SECONDS,
      },
    );

    if (claimError) {
      console.error("event-reminders claim error:", claimError);
      logLifecycle({
        event_id: null,
        user_id: null,
        admission_status: null,
        queue_id: null,
        category: "event_reminder",
        result: "claim_error",
        error_reason: claimError.message,
      });
      return new Response(
        JSON.stringify({ success: false, error: claimError.message }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const rows = (Array.isArray(claimedData) ? claimedData : []) as ClaimedRow[];

    let processed = 0;
    let failed = 0;
    for (const row of rows) {
      const attemptCount = typeof row.delivery_attempts === "number"
        ? row.delivery_attempts
        : null;

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

        const { data: notifyResult, error: invokeError } = await supabase.functions.invoke(
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
            delivery_attempts: attemptCount,
          });
          await releaseClaim(supabase, row.id, invokeError.message ?? "transport_error");
          failed++;
          continue;
        }

        const notifyOk =
          notifyResult &&
          typeof notifyResult === "object" &&
          (notifyResult as { success?: boolean }).success !== false;
        if (!notifyOk) {
          const reason =
            notifyResult &&
            typeof notifyResult === "object" &&
            typeof (notifyResult as { reason?: string }).reason === "string"
              ? (notifyResult as { reason: string }).reason
              : "send_notification_failed";
          console.error(
            "send-notification logical failure for",
            row.id,
            notifyResult,
          );
          logLifecycle({
            event_id: row.event_id,
            user_id: row.profile_id,
            admission_status: admissionStatus,
            queue_id: row.id,
            category: row.reminder_type,
            result: "delivery_error",
            error_reason: reason,
            delivery_attempts: attemptCount,
          });
          await releaseClaim(supabase, row.id, reason);
          failed++;
          continue;
        }

        const { error: deliverError } = await supabase.rpc(
          "mark_event_reminder_queue_row_delivered",
          { p_id: row.id },
        );

        if (deliverError) {
          // The notification did go out upstream but we could not mark
          // delivery. Release the claim so the next tick can re-check; the
          // upstream provider is responsible for de-duping repeat sends, and
          // the alternative (silently leaving claimed_at set) is worse.
          console.error(
            "mark_delivered failed for",
            row.id,
            deliverError,
          );
          logLifecycle({
            event_id: row.event_id,
            user_id: row.profile_id,
            admission_status: admissionStatus,
            queue_id: row.id,
            category: row.reminder_type,
            result: "delivery_persist_error",
            error_reason: deliverError.message,
            delivery_attempts: attemptCount,
          });
          await releaseClaim(supabase, row.id, `mark_delivered_error:${deliverError.message}`);
          failed++;
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
          delivery_attempts: attemptCount,
        });
        processed++;
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.error("send-notification threw for", row.id, e);
        logLifecycle({
          event_id: row.event_id,
          user_id: row.profile_id,
          admission_status: null,
          queue_id: row.id,
          category: row.reminder_type,
          result: "delivery_error",
          error_reason: errorMessage,
          delivery_attempts: attemptCount,
        });
        await releaseClaim(supabase, row.id, errorMessage);
        failed++;
        continue;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        failed,
        claimed: rows.length,
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

async function releaseClaim(
  supabase: ReturnType<typeof createClient>,
  rowId: string,
  reason: string,
) {
  try {
    const { error } = await supabase.rpc(
      "release_event_reminder_queue_row_on_failure",
      { p_id: rowId, p_error_reason: reason },
    );
    if (error) {
      console.error("release_claim failed for", rowId, error);
    }
  } catch (releaseError) {
    console.error("release_claim threw for", rowId, releaseError);
  }
}
