// video-date-recovery-alert-dispatcher: cron-invoked service-role monitor for
// Phase 2 queue/deadline/webhook recovery alerts. Auth: Bearer CRON_SECRET.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import * as Sentry from "https://deno.land/x/sentry@8.55.0/index.mjs";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type JsonObject = Record<string, unknown>;
type RecoveryHealthPayload = {
  ok?: boolean;
  severity?: string | null;
  alerts?: JsonObject[] | null;
};
type DispatchRow = {
  id: number;
  sentry_sent_at: string | null;
  slack_sent_at: string | null;
  sentry_claimed_at: string | null;
  slack_claimed_at: string | null;
};
type DispatchChannel = "sentry" | "slack";
type DispatchClaimGuard = {
  sentColumn: "sentry_sent_at" | "slack_sent_at";
  claimedColumn: "sentry_claimed_at" | "slack_claimed_at";
  claimedAt: string;
};

const DISPATCH_CLAIM_STALE_MS = 15 * 60 * 1000;

let sentryInitialized = false;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function authOk(req: Request): boolean {
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim();
  if (!cronSecret) return false;
  const authHeader = req.headers.get("Authorization") || "";
  const cronHeader = req.headers.get("x-cron-secret") || "";
  return safeEqual(authHeader, `Bearer ${cronSecret}`) || safeEqual(cronHeader, cronSecret);
}

function serviceClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !serviceKey) throw new Error("supabase_service_env_missing");
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function asSeverity(value: unknown): "page" | "watch" | "ok" {
  return value === "page" || value === "watch" ? value : "ok";
}

function stringField(source: JsonObject, key: string): string {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value.trim() : "unknown";
}

function hourBucketIso(nowMs = Date.now()): string {
  return new Date(Math.floor(nowMs / 3_600_000) * 3_600_000).toISOString();
}

function alertFingerprint(alert: JsonObject): string {
  const queue = stringField(alert, "queue_name");
  const kind = stringField(alert, "kind");
  const state = stringField(alert, "state");
  return `${queue}:${kind}:${state}`.slice(0, 240);
}

function scrubAlertPayload(alert: JsonObject): JsonObject {
  return {
    queue_name: typeof alert.queue_name === "string" ? alert.queue_name : null,
    kind: typeof alert.kind === "string" ? alert.kind : null,
    state: typeof alert.state === "string" ? alert.state : null,
    severity: asSeverity(alert.severity),
    details: alert.details && typeof alert.details === "object" && !Array.isArray(alert.details)
      ? alert.details
      : {},
    generated_at: typeof alert.generated_at === "string" ? alert.generated_at : null,
  };
}

function isStaleDispatchClaim(claimedAt: string | null, nowMs = Date.now()): boolean {
  if (!claimedAt) return false;
  const claimedAtMs = Date.parse(claimedAt);
  return Number.isFinite(claimedAtMs) && nowMs - claimedAtMs >= DISPATCH_CLAIM_STALE_MS;
}

async function captureSentryPage(alert: JsonObject, fingerprint: string): Promise<boolean> {
  const dsn = Deno.env.get("SENTRY_DSN")?.trim();
  if (!dsn) return false;
  try {
    if (!sentryInitialized) {
      Sentry.init({ dsn, tracesSampleRate: 0 });
      sentryInitialized = true;
    }
    Sentry.captureMessage("video_date_recovery_alert_page", {
      level: "error",
      tags: {
        function: "video-date-recovery-alert-dispatcher",
        fingerprint,
        queue: stringField(alert, "queue_name"),
        kind: stringField(alert, "kind"),
        state: stringField(alert, "state"),
      },
      extra: scrubAlertPayload(alert),
    });
    await Sentry.flush(1000).catch(() => false);
    return true;
  } catch {
    return false;
  }
}

async function postSlackAlert(alert: JsonObject, fingerprint: string): Promise<boolean> {
  const webhookUrl =
    Deno.env.get("VIDEO_DATE_RECOVERY_SLACK_WEBHOOK_URL")?.trim() ||
    Deno.env.get("SLACK_WEBHOOK_URL")?.trim();
  if (!webhookUrl) return false;

  const sanitized = scrubAlertPayload(alert);
  const severity = asSeverity(alert.severity);
  const text = `[${severity.toUpperCase()}] Vibely video date recovery alert: ${fingerprint}`;
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `*${text}*` },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "```" + JSON.stringify(sanitized, null, 2).slice(0, 2500) + "```",
            },
          },
        ],
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function claimDispatchChannel(
  supabase: ReturnType<typeof serviceClient>,
  dispatchId: number,
  channel: DispatchChannel,
): Promise<boolean> {
  const sentColumn = channel === "sentry" ? "sentry_sent_at" : "slack_sent_at";
  const claimedColumn = channel === "sentry" ? "sentry_claimed_at" : "slack_claimed_at";
  const claim = await supabase
    .from("video_date_recovery_alert_dispatches")
    .update({ [claimedColumn]: new Date().toISOString() })
    .eq("id", dispatchId)
    .is(sentColumn, null)
    .is(claimedColumn, null)
    .select("id")
    .maybeSingle();

  if (claim.error) {
    console.error(`video-date-recovery-alert-dispatcher ${channel}_claim_error`, claim.error.message);
    return false;
  }
  return Boolean(claim.data?.id);
}

async function reclaimStaleDispatchClaims(
  supabase: ReturnType<typeof serviceClient>,
  dispatch: DispatchRow,
): Promise<DispatchRow> {
  const update: Partial<Pick<DispatchRow, "sentry_claimed_at" | "slack_claimed_at">> = {};
  const guards: DispatchClaimGuard[] = [];
  const sentryClaimedAt = dispatch.sentry_claimed_at;
  if (!dispatch.sentry_sent_at && sentryClaimedAt && isStaleDispatchClaim(sentryClaimedAt)) {
    update.sentry_claimed_at = null;
    guards.push({
      sentColumn: "sentry_sent_at",
      claimedColumn: "sentry_claimed_at",
      claimedAt: sentryClaimedAt,
    });
  }
  const slackClaimedAt = dispatch.slack_claimed_at;
  if (!dispatch.slack_sent_at && slackClaimedAt && isStaleDispatchClaim(slackClaimedAt)) {
    update.slack_claimed_at = null;
    guards.push({
      sentColumn: "slack_sent_at",
      claimedColumn: "slack_claimed_at",
      claimedAt: slackClaimedAt,
    });
  }
  if (!Object.prototype.hasOwnProperty.call(update, "sentry_claimed_at") &&
      !Object.prototype.hasOwnProperty.call(update, "slack_claimed_at")) {
    return dispatch;
  }

  let reclaim = supabase
    .from("video_date_recovery_alert_dispatches")
    .update(update)
    .eq("id", dispatch.id);
  for (const guard of guards) {
    reclaim = reclaim
      .is(guard.sentColumn, null)
      .eq(guard.claimedColumn, guard.claimedAt);
  }

  const reclaimed = await reclaim
    .select("id,sentry_sent_at,slack_sent_at,sentry_claimed_at,slack_claimed_at")
    .maybeSingle();

  if (reclaimed.error) {
    console.error(
      "video-date-recovery-alert-dispatcher stale_claim_reclaim_error",
      reclaimed.error.message,
    );
    return dispatch;
  }
  if (!reclaimed.data?.id) return dispatch;
  return reclaimed.data as DispatchRow;
}

async function finishDispatchChannel(
  supabase: ReturnType<typeof serviceClient>,
  dispatchId: number,
  channel: DispatchChannel,
  sent: boolean,
): Promise<void> {
  const sentColumn = channel === "sentry" ? "sentry_sent_at" : "slack_sent_at";
  const claimedColumn = channel === "sentry" ? "sentry_claimed_at" : "slack_claimed_at";
  const values = sent
    ? { [sentColumn]: new Date().toISOString(), [claimedColumn]: null }
    : { [claimedColumn]: null };
  const update = await supabase
    .from("video_date_recovery_alert_dispatches")
    .update(values)
    .eq("id", dispatchId);
  if (update.error) {
    console.error(`video-date-recovery-alert-dispatcher ${channel}_finish_error`, update.error.message);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!authOk(req)) return json({ ok: false, error: "Unauthorized" }, 401);

  let supabase: ReturnType<typeof serviceClient>;
  try {
    supabase = serviceClient();
  } catch {
    return json({ ok: false, error: "supabase_service_env_missing" }, 500);
  }

  const { data, error } = await supabase.rpc("get_video_date_phase2_recovery_health");
  if (error) {
    return json({ ok: false, error: "recovery_health_failed", message: error.message }, 500);
  }

  const health = (data ?? {}) as RecoveryHealthPayload;
  const alerts = Array.isArray(health.alerts) ? health.alerts : [];
  const bucket = hourBucketIso();
  let claimed = 0;
  let retried = 0;
  let sentrySent = 0;
  let slackSent = 0;

  for (const alert of alerts) {
    const severity = asSeverity(alert.severity);
    if (severity === "ok") continue;

    const fingerprint = alertFingerprint(alert);
    const sanitized = scrubAlertPayload(alert);
    const insert = await supabase
      .from("video_date_recovery_alert_dispatches")
      .insert({
        severity,
        fingerprint,
        hour_bucket: bucket,
        alert_payload: sanitized,
      })
      .select("id,sentry_sent_at,slack_sent_at,sentry_claimed_at,slack_claimed_at")
      .maybeSingle();

    let dispatch = insert.data as DispatchRow | null;
    if (insert.error) {
      if (insert.error.code === "23505") {
        const existing = await supabase
          .from("video_date_recovery_alert_dispatches")
          .select("id,sentry_sent_at,slack_sent_at,sentry_claimed_at,slack_claimed_at")
          .eq("severity", severity)
          .eq("fingerprint", fingerprint)
          .eq("hour_bucket", bucket)
          .maybeSingle();
        if (existing.error || !existing.data?.id) {
          console.error("video-date-recovery-alert-dispatcher lookup_error", existing.error?.message ?? "missing_row");
          continue;
        }
        dispatch = existing.data as DispatchRow;
        retried += 1;
      } else {
        console.error("video-date-recovery-alert-dispatcher insert_error", insert.error.message);
        continue;
      }
    }
    if (!dispatch?.id) continue;

    const isNewDispatch = insert.error == null;
    if (isNewDispatch) claimed += 1;
    dispatch = await reclaimStaleDispatchClaims(supabase, dispatch);

    const shouldSendSentry = severity === "page" && !dispatch.sentry_sent_at && !dispatch.sentry_claimed_at;
    const shouldSendSlack =
      (severity === "page" || severity === "watch") && !dispatch.slack_sent_at && !dispatch.slack_claimed_at;
    if (!shouldSendSentry && !shouldSendSlack) continue;

    const claimedSentry = shouldSendSentry
      ? await claimDispatchChannel(supabase, dispatch.id, "sentry")
      : false;
    const claimedSlack = shouldSendSlack
      ? await claimDispatchChannel(supabase, dispatch.id, "slack")
      : false;
    if (!claimedSentry && !claimedSlack) continue;

    const sentryOk = claimedSentry ? await captureSentryPage(alert, fingerprint) : false;
    const slackOk = claimedSlack ? await postSlackAlert(alert, fingerprint) : false;

    if (sentryOk) sentrySent += 1;
    if (slackOk) slackSent += 1;

    if (claimedSentry) await finishDispatchChannel(supabase, dispatch.id, "sentry", sentryOk);
    if (claimedSlack) await finishDispatchChannel(supabase, dispatch.id, "slack", slackOk);
  }

  return json({
    ok: true,
    severity: asSeverity(health.severity),
    alerts: alerts.length,
    claimed,
    retried,
    sentry_sent: sentrySent,
    slack_sent: slackSent,
  });
});
