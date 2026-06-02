// check-daily-drop-health: cron-invoked Edge Function that fires a Resend
// email alert when no successful Daily Drop generation run has landed for the
// current UTC day after the scheduled batch hour, or when the latest run
// finished in a failed/partial state.
//
// Auth: same Bearer CRON_SECRET pattern as generate-daily-drops.
// Admin JWT (with user_roles role='admin') is also accepted for manual checks.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { fetchWithProviderTimeout, providerFetchTimeoutMs } from "../_shared/provider-fetch.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_HOUR_UTC = 18;          // matches DAILY_DROP_BATCH_HOUR_UTC client-side
const ALERT_GRACE_MINUTES = 30;     // alert window: 18:30 UTC onward

const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "Vibely Ops <ops@vibelymeet.com>";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const ALERT_EMAILS = (Deno.env.get("DAILY_DROP_ALERT_EMAILS") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

type Json = Record<string, unknown>;

function jsonResponse(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function authorize(req: Request): Promise<{ ok: true; source: "cron" | "admin"; adminId: string | null } | { ok: false; status: number; error: string }> {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const incoming = req.headers.get("Authorization");
  if (!cronSecret || cronSecret.trim() === "") {
    return { ok: false, status: 503, error: "Service unavailable: CRON_SECRET not configured" };
  }
  if (!incoming) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (incoming === `Bearer ${cronSecret}`) {
    return { ok: true, source: "cron", adminId: null };
  }
  // Admin JWT path
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: incoming } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return { ok: false, status: 401, error: "Unauthorized" };

  const adminClient = createClient(supabaseUrl, supabaseServiceKey);
  const { data: roleRow } = await adminClient
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!roleRow) return { ok: false, status: 403, error: "Forbidden" };
  return { ok: true, source: "admin", adminId: user.id };
}

function buildAlertBodyHtml(args: {
  reason: string;
  todayUtc: string;
  lastRun: Json | null;
  todayPairs: number;
}): string {
  const lr = args.lastRun;
  const lrJson = lr ? JSON.stringify(lr, null, 2) : "(none recorded)";
  return `
    <h2>Daily Drop generation health alert</h2>
    <p><strong>Reason:</strong> ${args.reason}</p>
    <ul>
      <li><strong>Today (UTC):</strong> ${args.todayUtc}</li>
      <li><strong>Pairs generated today:</strong> ${args.todayPairs}</li>
    </ul>
    <h3>Last recorded run</h3>
    <pre style="background:#f4f4f5;padding:12px;border-radius:6px;font-family:monospace;font-size:12px;white-space:pre-wrap;">${lrJson}</pre>
    <p>Investigate via the Supabase dashboard cron history and Edge Function logs for <code>generate-daily-drops</code>.</p>
  `;
}

async function sendAlertEmail(reason: string, body: Json, todayUtc: string, todayPairs: number): Promise<{ delivered: boolean; reason?: string }> {
  if (!RESEND_API_KEY) return { delivered: false, reason: "RESEND_API_KEY not set" };
  if (ALERT_EMAILS.length === 0) return { delivered: false, reason: "DAILY_DROP_ALERT_EMAILS not set" };

  const html = buildAlertBodyHtml({ reason, todayUtc, lastRun: body, todayPairs });

  const res = await fetchWithProviderTimeout("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: ALERT_EMAILS,
      subject: `[Vibely Ops] Daily Drop alert: ${reason}`,
      html,
    }),
  }, {
    provider: "resend",
    operation: "daily_drop_health_alert",
    timeoutMs: providerFetchTimeoutMs("resend", "daily_drop_health_alert"),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { delivered: false, reason: `resend ${res.status}: ${text.slice(0, 200)}` };
  }
  return { delivered: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await authorize(req);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const now = new Date();
  const todayUtc = now.toISOString().split("T")[0];
  const batchCutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), BATCH_HOUR_UTC, ALERT_GRACE_MINUTES, 0, 0));
  const isAfterBatchWindow = now.getTime() >= batchCutoff.getTime();

  // Latest run
  const { data: lastRun, error: lastRunError } = await supabase
    .from("daily_drop_generation_runs")
    .select("id, run_started_at, run_finished_at, status, source, force, pairs_created, users_notified, unpaired_users, reason, error")
    .order("run_started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastRunError) {
    return jsonResponse({ ok: false, error: "ledger_read_failed", details: lastRunError.message }, 500);
  }

  // Today pair count
  const { count: todayPairs, error: pairsError } = await supabase
    .from("daily_drops")
    .select("id", { count: "exact", head: true })
    .eq("drop_date", todayUtc);
  if (pairsError) {
    return jsonResponse({ ok: false, error: "drops_count_failed", details: pairsError.message }, 500);
  }
  const pairs = todayPairs ?? 0;

  const lastRunStartedAt = lastRun?.run_started_at ? new Date(lastRun.run_started_at) : null;
  const lastRunDayUtc = lastRunStartedAt ? lastRunStartedAt.toISOString().split("T")[0] : null;
  const ranToday = lastRunDayUtc === todayUtc;
  const lastStatus = lastRun?.status ?? null;
  const failed = lastStatus === "failed" || lastStatus === "partial";
  const stillStartedTooLong = lastStatus === "started" && lastRunStartedAt
    ? (now.getTime() - lastRunStartedAt.getTime()) > 15 * 60 * 1000
    : false;

  let alertReason: string | null = null;
  if (isAfterBatchWindow && !ranToday) {
    alertReason = `No generation run recorded for ${todayUtc} UTC after 18:30 UTC`;
  } else if (failed) {
    alertReason = `Latest run status=${lastStatus} (${lastRun?.reason ?? lastRun?.error ?? "no reason"})`;
  } else if (stillStartedTooLong) {
    alertReason = `Latest run still in 'started' state for >15 minutes`;
  }

  if (!alertReason) {
    return jsonResponse({
      ok: true,
      healthy: true,
      today_utc: todayUtc,
      today_pairs: pairs,
      last_run: lastRun,
      ran_today: ranToday,
    });
  }

  const delivery = await sendAlertEmail(alertReason, lastRun ?? {}, todayUtc, pairs);
  return jsonResponse({
    ok: true,
    healthy: false,
    alert: alertReason,
    today_utc: todayUtc,
    today_pairs: pairs,
    last_run: lastRun,
    delivery,
  });
});
