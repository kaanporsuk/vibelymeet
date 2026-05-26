import { createClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import {
  corsHeadersForRequest,
  isBrowserOriginRejected,
  jsonResponse,
} from "../_shared/cors.ts";
import { sanitizeErrorMessage } from "../_shared/adminAuth.ts";

type WorkerRequest = {
  action?: "all" | "account_deletions" | "support_delivery";
  batch_size?: number;
  lease_seconds?: number;
  dry_run?: boolean;
};

type DeletionJob = {
  id: string;
  deletion_request_id: string;
  user_id: string;
  state: string;
  attempts: number;
  provider_cleanup_completed_at: string | null;
  media_cleanup_completed_at: string | null;
  pii_scrub_completed_at: string | null;
  auth_delete_completed_at: string | null;
};

type SupportDeliveryJob = {
  id: string;
  ticket_id: string;
  reply_id: string;
  channel: "push" | "email";
  recipient_user_id: string | null;
  recipient_email: string | null;
  attempts: number;
  metadata: Record<string, unknown> | null;
};

type SupportTicket = {
  id: string;
  reference_id: string;
  user_id: string;
  user_email: string | null;
};

type SupportReply = {
  id: string;
  message: string;
};

const WORKER_NAME = "process-admin-durable-jobs";

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

async function parseBody(req: Request): Promise<WorkerRequest> {
  if (req.method === "GET") return {};
  const text = await req.text().catch(() => "");
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const rawAction = typeof parsed.action === "string" ? parsed.action : "all";
    const action =
      rawAction === "account_deletions" || rawAction === "support_delivery" || rawAction === "all"
        ? rawAction
        : "all";
    return {
      action,
      batch_size: typeof parsed.batch_size === "number" ? parsed.batch_size : undefined,
      lease_seconds: typeof parsed.lease_seconds === "number" ? parsed.lease_seconds : undefined,
      dry_run: parsed.dry_run === true,
    };
  } catch {
    return {};
  }
}

function boundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value as number)));
}

function response(req: Request, body: Record<string, unknown>, status = 200): Response {
  return jsonResponse(req, body, {
    status,
    headers: corsHeadersForRequest(req, {
      allowedHeaders: "authorization, x-client-info, apikey, content-type, x-cron-secret",
    }),
  });
}

async function recordWorkerRunStart(
  supabase: any,
  workerId: string,
  action: WorkerRequest["action"],
  batchSize: number,
): Promise<void> {
  const { error } = await supabase
    .from("admin_durable_worker_runs")
    .upsert(
      {
        worker_name: WORKER_NAME,
        worker_id: workerId,
        status: "running",
        action: action ?? "all",
        batch_size: batchSize,
        started_at: new Date().toISOString(),
        finished_at: null,
        last_heartbeat_at: new Date().toISOString(),
        last_error: null,
        result: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "worker_name" },
    );
  if (error) {
    console.warn("admin durable worker start health record skipped:", sanitizeErrorMessage(error.message));
  }
}

async function recordWorkerRunFinish(
  supabase: any,
  workerId: string,
  status: "completed" | "completed_with_failures" | "failed",
  result: Record<string, unknown> | null,
  errorMessage: string | null = null,
): Promise<void> {
  const { error } = await supabase
    .from("admin_durable_worker_runs")
    .update({
      worker_id: workerId,
      status,
      finished_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
      last_error: errorMessage ? sanitizeErrorMessage(errorMessage) : null,
      result,
      updated_at: new Date().toISOString(),
    })
    .eq("worker_name", WORKER_NAME);
  if (error) {
    console.warn("admin durable worker finish health record skipped:", sanitizeErrorMessage(error.message));
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function retryAfterForStatus(status: number | null): number {
  if (status === 429) return 60;
  if (status == null || status >= 500) return 120;
  return 600;
}

function permanentHttpFailure(status: number | null): boolean {
  return status != null && status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429;
}

async function cancelStripeSubscription(stripeKey: string, subscriptionId: string): Promise<{
  ok: boolean;
  error?: string;
  status?: number;
}> {
  const providerRes = await fetch(
    `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    },
  );
  const providerBody = await providerRes.text();

  if (!providerRes.ok && !providerBody.toLowerCase().includes("no such subscription")) {
    return {
      ok: false,
      error: providerBody || `Stripe subscription cancellation failed with ${providerRes.status}.`,
      status: providerRes.status,
    };
  }

  return { ok: true };
}

async function activeStripeSubscriptionsForCustomer(stripeKey: string, customerId: string): Promise<{
  ok: boolean;
  ids?: string[];
  error?: string;
  status?: number;
}> {
  const ids: string[] = [];
  let startingAfter: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const url = new URL("https://api.stripe.com/v1/subscriptions");
    url.searchParams.set("customer", customerId);
    url.searchParams.set("status", "all");
    url.searchParams.set("limit", "100");
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);

    const providerRes = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${stripeKey}`,
      },
    });
    const providerBody = await providerRes.text();
    if (!providerRes.ok) {
      return {
        ok: false,
        error: providerBody || `Stripe subscription lookup failed with ${providerRes.status}.`,
        status: providerRes.status,
      };
    }

    let parsed: { data?: Array<{ id?: unknown; status?: unknown }>; has_more?: unknown };
    try {
      parsed = JSON.parse(providerBody) as { data?: Array<{ id?: unknown; status?: unknown }>; has_more?: unknown };
    } catch {
      return { ok: false, error: "Stripe subscription lookup returned invalid JSON.", status: 502 };
    }

    const activeStatuses = new Set(["active", "trialing", "past_due", "unpaid"]);
    const pageIds = (parsed.data ?? [])
      .filter((entry) => typeof entry.id === "string" && activeStatuses.has(String(entry.status ?? "")))
      .map((entry) => entry.id as string);
    ids.push(...pageIds);

    const last = parsed.data?.at(-1);
    if (parsed.has_more !== true || typeof last?.id !== "string") break;
    startingAfter = last.id;
  }
  return { ok: true, ids: Array.from(new Set(ids)) };
}

async function deleteRevenueCatSubscriber(revenueCatKey: string, appUserId: string): Promise<{
  ok: boolean;
  error?: string;
  status?: number;
}> {
  const providerRes = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${revenueCatKey}`,
      },
    },
  );
  const providerBody = await providerRes.text();

  if (!providerRes.ok && providerRes.status !== 404) {
    return {
      ok: false,
      error: providerBody || `RevenueCat subscriber deletion failed with ${providerRes.status}.`,
      status: providerRes.status,
    };
  }

  return { ok: true };
}

async function completeDeletionStep(
  supabase: any,
  job: DeletionJob,
  workerId: string,
  step: string,
  details: Record<string, unknown> = {},
  providerId: string | null = null,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("complete_account_deletion_completion_step_v1", {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_step: step,
    p_provider_id: providerId,
    p_details: details,
  });
  if (error) {
    console.error("complete_account_deletion_completion_step_v1 error:", sanitizeErrorMessage(error.message));
    return false;
  }
  return asRecord(data).success === true;
}

async function failDeletionJob(
  supabase: any,
  job: DeletionJob,
  workerId: string,
  error: string,
  errorCode: string,
  options: { retryAfterSeconds?: number; permanent?: boolean; blocked?: boolean } = {},
): Promise<void> {
  const { error: rpcError } = await supabase.rpc("fail_account_deletion_completion_job_v1", {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_error: sanitizeErrorMessage(error),
    p_error_code: errorCode,
    p_retry_after_seconds: options.retryAfterSeconds ?? null,
    p_permanent: options.permanent === true,
    p_blocked: options.blocked === true,
  });
  if (rpcError) {
    console.error("fail_account_deletion_completion_job_v1 error:", sanitizeErrorMessage(rpcError.message));
  }
}

async function cleanupProviderSubscriptions(supabase: any, job: DeletionJob): Promise<{
  ok: boolean;
  providerId?: string | null;
  details?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
  retryAfterSeconds?: number;
  permanent?: boolean;
  blocked?: boolean;
}> {
  const { data: subscriptions, error } = await supabase
    .from("subscriptions")
    .select("id, stripe_subscription_id, stripe_customer_id, rc_original_app_user_id, status, provider")
    .eq("user_id", job.user_id)
    .in("status", ["active", "trialing", "past_due", "unpaid"]);

  if (error) {
    return { ok: false, error: error.message, errorCode: "subscription_lookup_failed", retryAfterSeconds: 120 };
  }

  const activeSubscriptions = Array.isArray(subscriptions) ? subscriptions : [];
  if (activeSubscriptions.length === 0) {
    return { ok: true, details: { active_subscriptions_checked: 0 } };
  }

  const unsupportedProviders = activeSubscriptions
    .map((subscription) => typeof subscription.provider === "string" ? subscription.provider : "stripe")
    .filter((provider) => provider !== "stripe" && provider !== "revenuecat");
  if (unsupportedProviders.length > 0) {
    return {
      ok: false,
      error: `Unsupported active subscription provider(s): ${Array.from(new Set(unsupportedProviders)).join(", ")}.`,
      errorCode: "unsupported_subscription_provider",
      blocked: true,
    };
  }

  const stripeSubscriptions = activeSubscriptions.filter((subscription) => {
    const provider = typeof subscription.provider === "string" ? subscription.provider : "stripe";
    return provider === "stripe";
  });
  const revenueCatSubscriptions = activeSubscriptions.filter((subscription) => subscription.provider === "revenuecat");
  const stripeProviderIds: string[] = [];
  const revenueCatProviderIds: string[] = [];
  const localCancellationIds: string[] = [];
  let stripeRowsMissingSubscriptionId = 0;
  let stripeRowsWithoutActiveProviderMatch = 0;
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY")?.trim();
  const revenueCatKey = Deno.env.get("REVENUECAT_SECRET_API_KEY")?.trim();

  if (stripeSubscriptions.length > 0 && !stripeKey) {
    return {
      ok: false,
      error: "STRIPE_SECRET_KEY is not configured for account deletion provider cleanup.",
      errorCode: "stripe_not_configured",
      blocked: true,
    };
  }
  const requiredStripeKey = stripeKey ?? "";

  if (revenueCatSubscriptions.length > 0 && !revenueCatKey) {
    return {
      ok: false,
      error: "REVENUECAT_SECRET_API_KEY is not configured for account deletion provider cleanup.",
      errorCode: "revenuecat_not_configured",
      blocked: true,
    };
  }
  const requiredRevenueCatKey = revenueCatKey ?? "";

  for (const subscription of stripeSubscriptions) {
    const subscriptionId = typeof subscription.stripe_subscription_id === "string"
      ? subscription.stripe_subscription_id
      : "";
    const customerId = typeof subscription.stripe_customer_id === "string" ? subscription.stripe_customer_id : "";
    let subscriptionIds = subscriptionId ? [subscriptionId] : [];

    if (!subscriptionId) {
      stripeRowsMissingSubscriptionId += 1;
      if (!customerId) {
        return {
          ok: false,
          error: "Active Stripe subscription row is missing both stripe_subscription_id and stripe_customer_id.",
          errorCode: "stripe_provider_identity_missing",
          blocked: true,
        };
      }
      const discovered = await activeStripeSubscriptionsForCustomer(requiredStripeKey, customerId);
      if (!discovered.ok) {
        return {
          ok: false,
          error: discovered.error,
          errorCode: `stripe_lookup_${discovered.status ?? "failed"}`,
          retryAfterSeconds: retryAfterForStatus(discovered.status ?? null),
          permanent: permanentHttpFailure(discovered.status ?? null),
        };
      }
      subscriptionIds = discovered.ids ?? [];
      if (subscriptionIds.length === 0) stripeRowsWithoutActiveProviderMatch += 1;
    }

    for (const providerSubscriptionId of Array.from(new Set(subscriptionIds))) {
      const cancelled = await cancelStripeSubscription(requiredStripeKey, providerSubscriptionId);
      if (!cancelled.ok) {
        return {
          ok: false,
          error: cancelled.error,
          errorCode: `stripe_${cancelled.status ?? "failed"}`,
          retryAfterSeconds: retryAfterForStatus(cancelled.status ?? null),
          permanent: permanentHttpFailure(cancelled.status ?? null),
        };
      }
      stripeProviderIds.push(providerSubscriptionId);
    }

    if (typeof subscription.id === "string") localCancellationIds.push(subscription.id);
  }

  for (const subscription of revenueCatSubscriptions) {
    const appUserIds = Array.from(
      new Set([
        job.user_id,
        typeof subscription.rc_original_app_user_id === "string" ? subscription.rc_original_app_user_id : "",
      ].map((value) => value.trim()).filter(Boolean)),
    );

    if (appUserIds.length === 0) {
      return {
        ok: false,
        error: "Active RevenueCat subscription row is missing a provider app user id.",
        errorCode: "revenuecat_provider_identity_missing",
        blocked: true,
      };
    }

    for (const appUserId of appUserIds) {
      const deleted = await deleteRevenueCatSubscriber(requiredRevenueCatKey, appUserId);
      if (!deleted.ok) {
        return {
          ok: false,
          error: deleted.error,
          errorCode: `revenuecat_${deleted.status ?? "failed"}`,
          retryAfterSeconds: retryAfterForStatus(deleted.status ?? null),
          permanent: permanentHttpFailure(deleted.status ?? null),
        };
      }
      revenueCatProviderIds.push(appUserId);
    }

    if (typeof subscription.id === "string") localCancellationIds.push(subscription.id);
  }

  const uniqueLocalCancellationIds = Array.from(new Set(localCancellationIds));
  const uniqueStripeProviderIds = Array.from(new Set(stripeProviderIds));
  const uniqueRevenueCatProviderIds = Array.from(new Set(revenueCatProviderIds));
  if (uniqueLocalCancellationIds.length > 0) {
    const { error: updateError } = await supabase
      .from("subscriptions")
      .update({ status: "canceled", current_period_end: new Date().toISOString() })
      .eq("user_id", job.user_id)
      .in("id", uniqueLocalCancellationIds);

    if (updateError) {
      return { ok: false, error: updateError.message, errorCode: "subscription_status_update_failed" };
    }
  }

  const { data: recomputeData, error: recomputeError } = await supabase.rpc(
    "recompute_profile_subscription_entitlement",
    { p_user_id: job.user_id },
  );
  if (recomputeError || asRecord(recomputeData).success === false) {
    return {
      ok: false,
      error: recomputeError?.message ?? "Subscription entitlement recompute failed after provider cleanup.",
      errorCode: "subscription_entitlement_recompute_failed",
      retryAfterSeconds: 120,
    };
  }

  return {
    ok: true,
    providerId: uniqueStripeProviderIds[0] ?? null,
    details: {
      active_subscriptions_checked: activeSubscriptions.length,
      stripe_subscriptions_checked: stripeSubscriptions.length,
      stripe_subscriptions_cancelled: uniqueStripeProviderIds.length,
      stripe_rows_missing_subscription_id: stripeRowsMissingSubscriptionId,
      stripe_rows_without_active_provider_match: stripeRowsWithoutActiveProviderMatch,
      revenuecat_subscriptions_checked: revenueCatSubscriptions.length,
      revenuecat_cleanup_mode: revenueCatSubscriptions.length > 0 ? "delete_subscriber_gdpr" : "none",
      revenuecat_subscribers_deleted: uniqueRevenueCatProviderIds.length,
      revenuecat_provider_ids: uniqueRevenueCatProviderIds,
      local_subscription_rows_cancelled: uniqueLocalCancellationIds.length,
    },
  };
}

async function processDeletionJob(supabase: any, job: DeletionJob, workerId: string): Promise<{
  ok: boolean;
  completed?: boolean;
  error?: string;
}> {
  if (!job.provider_cleanup_completed_at) {
    const provider = await cleanupProviderSubscriptions(supabase, job);
    if (!provider.ok) {
      await failDeletionJob(supabase, job, workerId, provider.error ?? "Provider cleanup failed.", provider.errorCode ?? "provider_cleanup_failed", {
        retryAfterSeconds: provider.retryAfterSeconds,
        permanent: provider.permanent,
        blocked: provider.blocked,
      });
      return { ok: false, error: provider.error };
    }
    if (!await completeDeletionStep(supabase, job, workerId, "provider_cleanup", provider.details, provider.providerId ?? null)) {
      return { ok: false, error: "provider_step_completion_failed" };
    }
  }

  if (!job.media_cleanup_completed_at) {
    const { data, error } = await supabase.rpc("complete_account_deletion_media_cleanup", { p_user_id: job.user_id });
    if (error || asRecord(data).success !== true) {
      await failDeletionJob(
        supabase,
        job,
        workerId,
        error?.message ?? "Media cleanup failed.",
        "media_cleanup_failed",
        { retryAfterSeconds: 120 },
      );
      return { ok: false, error: error?.message ?? "media_cleanup_failed" };
    }
    if (!await completeDeletionStep(supabase, job, workerId, "media_cleanup", asRecord(data))) {
      return { ok: false, error: "media_step_completion_failed" };
    }
  }

  if (!job.pii_scrub_completed_at) {
    const { data, error } = await supabase.rpc("scrub_account_deletion_profile_pii_v1", { p_user_id: job.user_id });
    if (error || asRecord(data).success !== true) {
      await failDeletionJob(
        supabase,
        job,
        workerId,
        error?.message ?? "PII scrub failed.",
        "pii_scrub_failed",
        { retryAfterSeconds: 120 },
      );
      return { ok: false, error: error?.message ?? "pii_scrub_failed" };
    }
    if (!await completeDeletionStep(supabase, job, workerId, "pii_scrub", asRecord(data))) {
      return { ok: false, error: "pii_step_completion_failed" };
    }
  }

  if (!job.auth_delete_completed_at) {
    const { error } = await supabase.auth.admin.deleteUser(job.user_id);
    if (error && !String(error.message || "").toLowerCase().includes("user not found")) {
      await failDeletionJob(supabase, job, workerId, error.message, "auth_delete_failed", {
        retryAfterSeconds: 300,
        permanent: false,
      });
      return { ok: false, error: error.message };
    }
    if (!await completeDeletionStep(supabase, job, workerId, "auth_delete", { auth_user_missing: Boolean(error) })) {
      return { ok: false, error: "auth_delete_step_completion_failed" };
    }
  }

  return { ok: true, completed: true };
}

async function completeSupportJob(
  supabase: any,
  job: SupportDeliveryJob,
  workerId: string,
  args: {
    success: boolean;
    providerId?: string | null;
    error?: string | null;
    errorCode?: string | null;
    retryAfterSeconds?: number | null;
    permanent?: boolean;
    blocked?: boolean;
  },
): Promise<boolean> {
  const { data, error } = await supabase.rpc("complete_support_reply_delivery_job_v1", {
    p_job_id: job.id,
    p_worker_id: workerId,
    p_success: args.success,
    p_provider_id: args.providerId ?? null,
    p_error: args.error ? sanitizeErrorMessage(args.error) : null,
    p_error_code: args.errorCode ?? null,
    p_retry_after_seconds: args.retryAfterSeconds ?? null,
    p_permanent: args.permanent === true,
    p_blocked: args.blocked === true,
  });
  if (error) {
    console.error("complete_support_reply_delivery_job_v1 error:", sanitizeErrorMessage(error.message));
    return false;
  }
  const payload = asRecord(data);
  if (payload.success !== true) {
    console.error(
      "complete_support_reply_delivery_job_v1 rejected:",
      sanitizeErrorMessage(payload.error ?? "unknown completion failure"),
    );
    return false;
  }
  return true;
}

async function loadSupportContext(supabase: any, job: SupportDeliveryJob): Promise<{
  ticket: SupportTicket | null;
  reply: SupportReply | null;
  displayName: string;
  readError: string | null;
}> {
  const [{ data: ticket, error: ticketError }, { data: reply, error: replyError }] = await Promise.all([
    supabase
      .from("support_tickets")
      .select("id, reference_id, user_id, user_email")
      .eq("id", job.ticket_id)
      .maybeSingle(),
    supabase
      .from("support_ticket_replies")
      .select("id, message")
      .eq("id", job.reply_id)
      .maybeSingle(),
  ]);
  const readError = ticketError?.message ?? replyError?.message ?? null;
  if (readError) {
    return {
      ticket: null,
      reply: null,
      displayName: "there",
      readError: sanitizeErrorMessage(readError),
    };
  }

  let displayName = "there";
  if (ticket?.user_id) {
    const { data: profile } = await supabase.from("profiles").select("name").eq("id", ticket.user_id).maybeSingle();
    if (profile?.name) displayName = profile.name;
  }

  return {
    ticket: (ticket ?? null) as SupportTicket | null,
    reply: (reply ?? null) as SupportReply | null,
    displayName,
    readError: null,
  };
}

async function deliverPush(
  supabaseUrl: string,
  serviceKey: string,
  ticket: SupportTicket,
  job: SupportDeliveryJob,
): Promise<{
  ok: boolean;
  providerId?: string | null;
  error?: string;
  status?: number;
  blocked?: boolean;
  errorCode?: string;
}> {
  const metadata = job.metadata ?? {};
  const title = typeof metadata.title === "string" ? metadata.title : "Vibely Support";
  const body = typeof metadata.body === "string"
    ? metadata.body
    : `We've replied to your request ${ticket.reference_id}`;
  const url = typeof metadata.url === "string" ? metadata.url : `/settings/ticket/${ticket.id}`;

  const notifyRes = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_id: ticket.user_id,
      category: "support_reply",
      title,
      body,
      dedupe_key: job.id,
      provider_idempotency_key: job.id,
      data: {
        type: "support_reply",
        ticket_id: ticket.id,
        reference_id: ticket.reference_id,
        delivery_job_id: job.id,
        url,
      },
      bypass_preferences: true,
    }),
  });

  const text = await notifyRes.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  if (!notifyRes.ok) {
    return { ok: false, error: text, status: notifyRes.status };
  }

  if (parsed.success === false) {
    const reason = stringOrNull(parsed.reason) ?? stringOrNull(parsed.error) ?? "send_notification_suppressed";
    const providerStatus = typeof parsed.status === "number" ? parsed.status : notifyRes.status;
    return {
      ok: false,
      error: `send-notification did not deliver push: ${reason}`,
      status: providerStatus,
      blocked: ["no_player_id", "no_preferences", "user_disabled"].includes(reason),
      errorCode: `push_${reason}`,
    };
  }

  if (parsed.push_skipped === true) {
    const reason = stringOrNull(parsed.reason) ?? "push_skipped";
    return {
      ok: false,
      error: `send-notification skipped push delivery: ${reason}`,
      status: notifyRes.status,
      blocked: true,
      errorCode: `push_${reason}`,
    };
  }

  const providerId = stringOrNull(parsed.onesignal_id) ?? stringOrNull(parsed.notification_id);
  if (!providerId) {
    return {
      ok: false,
      error: "send-notification accepted the request but did not return a push provider id.",
      status: notifyRes.status,
      errorCode: "push_provider_id_missing",
    };
  }

  return { ok: true, providerId };
}

async function deliverEmail(
  ticket: SupportTicket,
  reply: SupportReply,
  job: SupportDeliveryJob,
  displayName: string,
): Promise<{
  ok: boolean;
  providerId?: string | null;
  error?: string;
  status?: number | null;
  blocked?: boolean;
  permanent?: boolean;
  errorCode?: string;
}> {
  const resendKey = Deno.env.get("RESEND_API_KEY")?.trim();
  if (!job.recipient_email) {
    return {
      ok: false,
      error: "Email delivery job has no recipient email.",
      status: null,
      blocked: true,
    };
  }
  if (!resendKey) {
    return {
      ok: false,
      error: "RESEND_API_KEY is not configured.",
      status: null,
      blocked: true,
    };
  }

  const safeBody = escapeHtml(reply.message).replace(/\n/g, "<br/>");
  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendKey}`,
      "Idempotency-Key": `support-reply-email/${job.id}`,
    },
    body: JSON.stringify({
      from: "Vibely Support <support@vibelymeet.com>",
      to: job.recipient_email,
      subject: `Re: Your request ${ticket.reference_id}`,
      html: `
        <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto;">
          <h2 style="color: #8B5CF6;">Vibely Support</h2>
          <p>Hi ${escapeHtml(displayName)},</p>
          <p>We've replied to your request <strong>${escapeHtml(ticket.reference_id)}</strong>.</p>
          <div style="background: #f9f9f9; border-left: 3px solid #8B5CF6; padding: 12px 16px; margin: 16px 0; border-radius: 4px;">
            ${safeBody}
          </div>
          <p>You can view the full conversation in the Vibely app under Settings -> Support & Feedback -> Your Requests.</p>
          <p style="color: #888; font-size: 12px;">Ref: ${escapeHtml(ticket.reference_id)} - vibelymeet.com</p>
        </div>
      `,
    }),
  });

  const text = await emailRes.text();
  if (!emailRes.ok) return { ok: false, error: text, status: emailRes.status };

  let providerId: string | null = null;
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    providerId = typeof parsed.id === "string" ? parsed.id : null;
  } catch {
    providerId = null;
  }
  if (!providerId) {
    return {
      ok: false,
      error: "Resend accepted the support reply email request but did not return a provider id.",
      status: emailRes.status,
      permanent: true,
      errorCode: "email_provider_id_missing",
    };
  }
  return { ok: true, providerId };
}

async function processSupportJob(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  job: SupportDeliveryJob,
  workerId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { ticket, reply, displayName, readError } = await loadSupportContext(supabase, job);
  if (readError) {
    const stateSaved = await completeSupportJob(supabase, job, workerId, {
      success: false,
      error: readError,
      errorCode: "support_context_read_failed",
      retryAfterSeconds: retryAfterForStatus(null),
      permanent: false,
    });
    if (!stateSaved) return { ok: false, error: "support_delivery_state_update_failed" };
    return { ok: false, error: "support_context_read_failed" };
  }

  if (!ticket || !reply) {
    const stateSaved = await completeSupportJob(supabase, job, workerId, {
      success: false,
      error: "Support ticket or reply was not found.",
      errorCode: "support_context_missing",
      permanent: true,
    });
    if (!stateSaved) return { ok: false, error: "support_delivery_state_update_failed" };
    return { ok: false, error: "support_context_missing" };
  }

  if (job.channel === "push") {
    const result = await deliverPush(supabaseUrl, serviceKey, ticket, job);
    const stateSaved = await completeSupportJob(supabase, job, workerId, {
      success: result.ok,
      providerId: result.providerId,
      error: result.error,
      errorCode: result.ok ? null : result.errorCode ?? `push_${result.status ?? "failed"}`,
      retryAfterSeconds: result.ok ? null : retryAfterForStatus(result.status ?? null),
      permanent: !result.ok && permanentHttpFailure(result.status ?? null),
      blocked: result.blocked === true,
    });
    if (!stateSaved) return { ok: false, error: "support_delivery_state_update_failed" };
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }

  const result = await deliverEmail(ticket, reply, job, displayName);
  const stateSaved = await completeSupportJob(supabase, job, workerId, {
    success: result.ok,
    providerId: result.providerId,
    error: result.error,
    errorCode: result.ok ? null : result.errorCode ?? (result.blocked ? "email_blocked" : `email_${result.status ?? "failed"}`),
    retryAfterSeconds: result.ok || result.blocked ? null : retryAfterForStatus(result.status ?? null),
    permanent: result.permanent === true || (!result.ok && !result.blocked && permanentHttpFailure(result.status ?? null)),
    blocked: result.blocked === true,
  });
  if (!stateSaved) return { ok: false, error: "support_delivery_state_update_failed" };
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: isBrowserOriginRejected(req) ? 403 : 204,
      headers: corsHeadersForRequest(req, {
        allowedHeaders: "authorization, x-client-info, apikey, content-type, x-cron-secret",
      }),
    });
  }
  if (isBrowserOriginRejected(req)) return response(req, { ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
  if (req.method !== "GET" && req.method !== "POST") {
    return response(req, { ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }
  if (!authOk(req)) return response(req, { ok: false, error: "Unauthorized" }, 401);

  const startedAt = Date.now();
  const body = await parseBody(req);
  const action = body.action ?? "all";
  const batchSize = boundedInt(body.batch_size, 25, 1, 100);
  const leaseSeconds = boundedInt(body.lease_seconds, 120, 15, 900);
  const workerId = `${WORKER_NAME}-${crypto.randomUUID()}`;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();

  if (!supabaseUrl || !serviceKey) return response(req, { ok: false, error: "missing_supabase_env" }, 500);
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (body.dry_run) {
    const preview: Record<string, unknown> = {};
    if (action === "all" || action === "account_deletions") {
      const { data, error } = await supabase
        .from("account_deletion_completion_jobs")
        .select("id,deletion_request_id,user_id,state,attempts,next_retry_at,last_error,error_code")
        .in("state", ["queued", "retryable_failed", "processing", "blocked", "permanent_failed"])
        .order("next_retry_at", { ascending: true })
        .limit(batchSize);
      if (error) return response(req, { ok: false, dry_run: true, error: error.message }, 500);
      preview.account_deletions = data ?? [];
    }
    if (action === "all" || action === "support_delivery") {
      const { data, error } = await supabase
        .from("support_reply_delivery_jobs")
        .select("id,ticket_id,reply_id,channel,state,attempts,next_retry_at,last_error,error_code")
        .in("state", ["queued", "retryable_failed", "processing", "blocked", "permanent_failed"])
        .order("next_retry_at", { ascending: true })
        .limit(batchSize);
      if (error) return response(req, { ok: false, dry_run: true, error: error.message }, 500);
      preview.support_delivery = data ?? [];
    }
    return response(req, {
      ok: true,
      dry_run: true,
      worker_id: workerId,
      preview,
      latency_ms: Date.now() - startedAt,
    });
  }

  await recordWorkerRunStart(supabase, workerId, action, batchSize);

  const result = {
    account_deletions: { claimed: 0, completed: 0, failed: 0 },
    support_delivery: { claimed: 0, completed: 0, failed: 0 },
    failures: [] as Array<{ type: string; id: string; reason: string }>,
  };

  if (action === "all" || action === "account_deletions") {
    const { error: enqueueError } = await supabase.rpc("enqueue_due_account_deletion_completion_jobs_v1", {
      p_limit: batchSize,
    });
    if (enqueueError) {
      await recordWorkerRunFinish(supabase, workerId, "failed", result, enqueueError.message);
      return response(req, { ok: false, error: enqueueError.message }, 500);
    }

    const { data, error } = await supabase.rpc("claim_account_deletion_completion_jobs_v1", {
      p_worker_id: workerId,
      p_limit: batchSize,
      p_lease_seconds: leaseSeconds,
    });
    if (error) {
      await recordWorkerRunFinish(supabase, workerId, "failed", result, error.message);
      return response(req, { ok: false, error: error.message }, 500);
    }

    const jobs = (data ?? []) as DeletionJob[];
    result.account_deletions.claimed = jobs.length;
    for (const job of jobs) {
      const processed = await processDeletionJob(supabase, job, workerId);
      if (processed.ok) {
        result.account_deletions.completed += 1;
      } else {
        result.account_deletions.failed += 1;
        result.failures.push({ type: "account_deletion", id: job.id, reason: processed.error ?? "unknown" });
      }
    }
  }

  if (action === "all" || action === "support_delivery") {
    const { data, error } = await supabase.rpc("claim_support_reply_delivery_jobs_v1", {
      p_worker_id: workerId,
      p_limit: batchSize,
      p_lease_seconds: leaseSeconds,
    });
    if (error) {
      await recordWorkerRunFinish(supabase, workerId, "failed", result, error.message);
      return response(req, { ok: false, error: error.message }, 500);
    }

    const jobs = (data ?? []) as SupportDeliveryJob[];
    result.support_delivery.claimed = jobs.length;
    for (const job of jobs) {
      const processed = await processSupportJob(supabase, supabaseUrl, serviceKey, job, workerId);
      if (processed.ok) {
        result.support_delivery.completed += 1;
      } else {
        result.support_delivery.failed += 1;
        result.failures.push({ type: "support_delivery", id: job.id, reason: processed.error ?? "unknown" });
      }
    }
  }

  const finalStatus = result.failures.length > 0 ? "completed_with_failures" : "completed";
  await recordWorkerRunFinish(supabase, workerId, finalStatus, {
    ...result,
    latency_ms: Date.now() - startedAt,
  });

  return response(req, {
    ok: true,
    worker_id: workerId,
    result,
    latency_ms: Date.now() - startedAt,
  });
});
