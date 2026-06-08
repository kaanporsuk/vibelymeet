/**
 * Cron worker: sends one neutral reminder for one-sided post-date verdicts
 * and marks long-pending rows stale. Auth: Authorization: Bearer ${CRON_SECRET}.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REMINDER_LIMIT = 100;
const STALE_AGE = "24 hours";

type ClaimedReminder = {
  session_id: string;
  event_id: string | null;
  submitted_by: string;
  missing_user_id: string;
  first_detected_at: string;
  reminder_sent_at: string;
};

type ClaimedZeroFeedbackReminder = {
  session_id: string;
  event_id: string | null;
  missing_user_id: string;
  participant_role: "participant_1" | "participant_2";
  first_detected_at: string;
  reminder_sent_at: string;
};

function logLifecycle(payload: {
  event_id?: string | null;
  session_id?: string | null;
  user_id?: string | null;
  category: string;
  result: string;
  error_reason?: string | null;
}) {
  console.log("lifecycle.post_date_verdict_reminders", JSON.stringify(payload));
}

function safeErrorReason(value: unknown): string {
  if (value instanceof Error) return value.message.slice(0, 180);
  if (typeof value === "string") return value.slice(0, 180);
  try {
    return JSON.stringify(value).slice(0, 180);
  } catch {
    return "unknown_error";
  }
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
    const { data: staleCount, error: staleError } = await supabase.rpc(
      "mark_post_date_pending_verdicts_stale",
      { p_older_than: STALE_AGE, p_limit: REMINDER_LIMIT },
    );

    if (staleError) {
      console.error("post-date-verdict-reminders stale rpc:", staleError.message);
      logLifecycle({
        category: "post_date_pending_verdict_stale",
        result: "error",
        error_reason: staleError.message,
      });
    }

    const { data: zeroFeedbackStaleCount, error: zeroFeedbackStaleError } = await supabase.rpc(
      "mark_post_date_zero_feedback_reminders_stale_v1",
      { p_older_than: STALE_AGE, p_limit: REMINDER_LIMIT },
    );

    if (zeroFeedbackStaleError) {
      console.error("post-date-verdict-reminders zero-feedback stale rpc:", zeroFeedbackStaleError.message);
      logLifecycle({
        category: "post_date_zero_feedback_stale",
        result: "error",
        error_reason: zeroFeedbackStaleError.message,
      });
    }

    const { data: claimedRows, error: claimError } = await supabase.rpc(
      "claim_post_date_pending_verdict_reminders",
      { p_limit: REMINDER_LIMIT },
    );

    if (claimError) {
      console.error("post-date-verdict-reminders claim rpc:", claimError.message);
      logLifecycle({
        category: "post_date_pending_verdict_reminder",
        result: "claim_error",
        error_reason: claimError.message,
      });
      return new Response(
        JSON.stringify({ success: false, error: "claim_failed", message: claimError.message }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: zeroFeedbackRows, error: zeroFeedbackClaimError } = await supabase.rpc(
      "claim_post_date_zero_feedback_reminders_v1",
      { p_limit: REMINDER_LIMIT },
    );

    if (zeroFeedbackClaimError) {
      console.error("post-date-verdict-reminders zero-feedback claim rpc:", zeroFeedbackClaimError.message);
      logLifecycle({
        category: "post_date_zero_feedback_reminder",
        result: "claim_error",
        error_reason: zeroFeedbackClaimError.message,
      });
    }

    let sent = 0;
    let failed = 0;
    const rows = (claimedRows ?? []) as ClaimedReminder[];
    const zeroFeedback = zeroFeedbackClaimError ? [] : (zeroFeedbackRows ?? []) as ClaimedZeroFeedbackReminder[];

    for (const row of rows) {
      const deepLink = `/date/${row.session_id}`;
      const dedupeKey = `post_date_feedback:${row.session_id}:${row.missing_user_id}`;
      try {
        const { data: notifyResult, error: notifyError } = await supabase.functions.invoke(
          "send-notification",
          {
            body: {
              user_id: row.missing_user_id,
              category: "post_date_feedback_reminder",
              title: "Your video date is waiting for your feedback.",
              body: "Share your post-date vibe to finish the flow.",
              dedupe_key: dedupeKey,
              data: {
                session_id: row.session_id,
                video_session_id: row.session_id,
                event_id: row.event_id,
                dedupe_key: dedupeKey,
                url: deepLink,
                deep_link: deepLink,
              },
            },
          },
        );

        const notifyOk =
          !notifyError &&
          notifyResult &&
          typeof notifyResult === "object" &&
          (notifyResult as { success?: boolean }).success !== false;

        if (!notifyOk) {
          const reason = notifyError?.message ??
            ((notifyResult && typeof notifyResult === "object" &&
              typeof (notifyResult as { reason?: string }).reason === "string")
              ? (notifyResult as { reason: string }).reason
              : "send_notification_failed");
          failed += 1;
          await supabase.rpc("record_post_date_pending_verdict_reminder_result", {
            p_session_id: row.session_id,
            p_success: false,
            p_error: reason,
          });
          logLifecycle({
            event_id: row.event_id,
            session_id: row.session_id,
            user_id: row.missing_user_id,
            category: "post_date_feedback_reminder",
            result: "delivery_error",
            error_reason: reason,
          });
          continue;
        }

        sent += 1;
        await supabase.rpc("record_post_date_pending_verdict_reminder_result", {
          p_session_id: row.session_id,
          p_success: true,
          p_error: null,
        });
        logLifecycle({
          event_id: row.event_id,
          session_id: row.session_id,
          user_id: row.missing_user_id,
          category: "post_date_feedback_reminder",
          result: "sent",
          error_reason: null,
        });
      } catch (error) {
        const reason = safeErrorReason(error);
        failed += 1;
        await supabase.rpc("record_post_date_pending_verdict_reminder_result", {
          p_session_id: row.session_id,
          p_success: false,
          p_error: reason,
        });
        logLifecycle({
          event_id: row.event_id,
          session_id: row.session_id,
          user_id: row.missing_user_id,
          category: "post_date_feedback_reminder",
          result: "error",
          error_reason: reason,
        });
      }
    }

    for (const row of zeroFeedback) {
      const deepLink = `/date/${row.session_id}`;
      const dedupeKey = `post_date_feedback:${row.session_id}:${row.missing_user_id}`;
      try {
        const { data: notifyResult, error: notifyError } = await supabase.functions.invoke(
          "send-notification",
          {
            body: {
              user_id: row.missing_user_id,
              category: "post_date_feedback_reminder",
              title: "Your video date is waiting for your feedback.",
              body: "Share your post-date vibe to finish the flow.",
              dedupe_key: dedupeKey,
              data: {
                session_id: row.session_id,
                video_session_id: row.session_id,
                event_id: row.event_id,
                dedupe_key: dedupeKey,
                url: deepLink,
                deep_link: deepLink,
                reminder_source: "zero_feedback_survey",
                participant_role: row.participant_role,
              },
            },
          },
        );

        const notifyOk =
          !notifyError &&
          notifyResult &&
          typeof notifyResult === "object" &&
          (notifyResult as { success?: boolean }).success !== false;

        if (!notifyOk) {
          const reason = notifyError?.message ??
            ((notifyResult && typeof notifyResult === "object" &&
              typeof (notifyResult as { reason?: string }).reason === "string")
              ? (notifyResult as { reason: string }).reason
              : "send_notification_failed");
          failed += 1;
          await supabase.rpc("record_post_date_zero_feedback_reminder_result_v1", {
            p_session_id: row.session_id,
            p_missing_user_id: row.missing_user_id,
            p_success: false,
            p_error: reason,
          });
          logLifecycle({
            event_id: row.event_id,
            session_id: row.session_id,
            user_id: row.missing_user_id,
            category: "post_date_zero_feedback_reminder",
            result: "delivery_error",
            error_reason: reason,
          });
          continue;
        }

        sent += 1;
        await supabase.rpc("record_post_date_zero_feedback_reminder_result_v1", {
          p_session_id: row.session_id,
          p_missing_user_id: row.missing_user_id,
          p_success: true,
          p_error: null,
        });
        logLifecycle({
          event_id: row.event_id,
          session_id: row.session_id,
          user_id: row.missing_user_id,
          category: "post_date_zero_feedback_reminder",
          result: "sent",
          error_reason: null,
        });
      } catch (error) {
        const reason = safeErrorReason(error);
        failed += 1;
        await supabase.rpc("record_post_date_zero_feedback_reminder_result_v1", {
          p_session_id: row.session_id,
          p_missing_user_id: row.missing_user_id,
          p_success: false,
          p_error: reason,
        });
        logLifecycle({
          event_id: row.event_id,
          session_id: row.session_id,
          user_id: row.missing_user_id,
          category: "post_date_zero_feedback_reminder",
          result: "error",
          error_reason: reason,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        claimed: rows.length,
        zero_feedback_claimed: zeroFeedback.length,
        sent,
        failed,
        stale_marked: typeof staleCount === "number" ? staleCount : 0,
        zero_feedback_stale_marked: typeof zeroFeedbackStaleCount === "number" ? zeroFeedbackStaleCount : 0,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const reason = safeErrorReason(error);
    console.error("post-date-verdict-reminders:", reason);
    logLifecycle({
      category: "post_date_pending_verdict_reminder",
      result: "error",
      error_reason: reason,
    });
    return new Response(
      JSON.stringify({ success: false, error: "internal_error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
