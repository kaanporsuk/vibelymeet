import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.88.0";
import { checkRateLimit, createRateLimitResponse } from "../_shared/rate-limiter.ts";
import { applyAccountDeletionMediaHold } from "../_shared/media-lifecycle.ts";
import { recordPaymentObservability } from "../_shared/paymentObservability.ts";
import { normalizeEmailAddress, resolveCanonicalAuthEmail } from "../_shared/verificationSemantics.ts";
import {
  corsHeadersForRequest,
  isBrowserOriginRejected,
  jsonResponse,
  preflightResponse,
} from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const EMAIL_FROM = Deno.env.get("EMAIL_VERIFICATION_FROM_EMAIL") || "Vibely <hello@vibelymeet.com>";
const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const TWILIO_VERIFY_SID = Deno.env.get("TWILIO_VERIFY_SERVICE_SID");
const REAUTH_TTL_MS = 10 * 60 * 1000;
const MAX_REAUTH_VERIFY_ATTEMPTS = 7;
const OTP_HASH_PREFIX = "h1:";

type ReauthChannel = "email" | "phone";
type DeleteAccountAction = "request_reauth" | "schedule_deletion";
type AdminSupabaseClient = SupabaseClient<any, "public", any>;

type AdminUserLike = {
  email?: string | null;
  phone?: string | null;
  identities?: Array<{
    provider?: string | null;
    identity_data?: Record<string, unknown> | null;
  }> | null;
};

type ReauthTarget = {
  channel: ReauthChannel;
  destination: string;
  maskedDestination: string;
};

type PendingDeletionRequest = {
  id: string;
  scheduled_deletion_at: string | null;
};

type DeletionRequestEnsureResult =
  | { ok: true; request: PendingDeletionRequest; created: boolean }
  | { ok: false; error: string };

type StripeSubscriptionRow = {
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  status: string | null;
};

type DeletionCleanupWarning = {
  code: string;
  message: string;
  retryable: boolean;
};

type StripeCancellationResult = {
  attempted: boolean;
  warning: DeletionCleanupWarning | null;
};

function response(req: Request, body: Record<string, unknown>, status = 200): Response {
  return jsonResponse(req, body, { status });
}

function parseAction(input: unknown): DeleteAccountAction {
  return input === "request_reauth" ? "request_reauth" : "schedule_deletion";
}

function parseChannel(input: unknown): ReauthChannel | null {
  return input === "email" || input === "phone" ? input : null;
}

function parseCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.replace(/\D/g, "").slice(0, 6);
  return code.length === 6 ? code : null;
}

function normalizeReason(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const reason = input.trim();
  return reason.length > 0 ? reason.slice(0, 200) : null;
}

function userSafeStripeCleanupWarning(): DeletionCleanupWarning {
  return {
    code: "stripe_subscription_cleanup_pending",
    message:
      "Your deletion request is saved, but we could not finish subscription cancellation automatically. Try again later or contact support if billing still appears.",
    retryable: true,
  };
}

function shouldCancelStripeSubscription(status: string | null): boolean {
  const normalizedStatus = typeof status === "string" ? status.trim().toLowerCase() : "";
  return !["canceled", "incomplete_expired"].includes(normalizedStatus);
}

function isIdempotentStripeCancellationStatus(status: number): boolean {
  // Stripe 404 can mean a stale subscription id or wrong Stripe account/mode,
  // so keep it retryable instead of marking local billing state as canceled.
  return status === 410;
}

async function findPendingDeletionRequest(
  supabaseAdmin: AdminSupabaseClient,
  userId: string,
): Promise<DeletionRequestEnsureResult | { ok: true; request: null; created: false }> {
  const { data, error } = await supabaseAdmin
    .from("account_deletion_requests")
    .select("id, scheduled_deletion_at")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("requested_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Error checking existing deletion request:", error.message);
    return { ok: false, error: "Failed to check deletion status" };
  }

  return {
    ok: true,
    request: data ? data as PendingDeletionRequest : null,
    created: false,
  };
}

async function ensurePendingDeletionRequest(
  supabaseAdmin: AdminSupabaseClient,
  userId: string,
  reason: string | null,
): Promise<DeletionRequestEnsureResult> {
  const existing = await findPendingDeletionRequest(supabaseAdmin, userId);
  if (!existing.ok) return existing;
  if (existing.request) return { ok: true, request: existing.request, created: false };

  const { data: insertedRequest, error: insertError } = await supabaseAdmin
    .from("account_deletion_requests")
    .insert({
      user_id: userId,
      reason,
      status: "pending",
    })
    .select("id, scheduled_deletion_at")
    .maybeSingle();

  if (!insertError && insertedRequest?.id) {
    return { ok: true, request: insertedRequest as PendingDeletionRequest, created: true };
  }

  if (insertError?.code === "23505") {
    const raced = await findPendingDeletionRequest(supabaseAdmin, userId);
    if (raced.ok && raced.request) {
      return { ok: true, request: raced.request, created: false };
    }
  }

  if (insertError) console.error("Error inserting deletion request:", insertError.message);
  return { ok: false, error: "Failed to create deletion request" };
}

async function recordDeletionStripeCancellation(
  supabaseAdmin: AdminSupabaseClient,
  params: {
    userId: string;
    deletionRequestId: string;
    status: "succeeded" | "failed";
    result: string;
    errorCode?: string | null;
    subscription?: StripeSubscriptionRow | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await recordPaymentObservability(supabaseAdmin, {
    category: "account_deletion_stripe_cancellation",
    status: params.status,
    result: params.result,
    error_code: params.errorCode ?? null,
    stripe_customer_id: params.subscription?.stripe_customer_id ?? null,
    stripe_subscription_id: params.subscription?.stripe_subscription_id ?? null,
    user_id: params.userId,
    metadata_summary: {
      deletion_request_id: params.deletionRequestId,
      subscription_status: params.subscription?.status ?? null,
      ...params.metadata,
    },
  });
}

async function cancelStripeSubscriptionForDeletion(
  supabaseAdmin: AdminSupabaseClient,
  userId: string,
  deletionRequestId: string,
): Promise<StripeCancellationResult> {
  const { data: subscription, error: subscriptionError } = await supabaseAdmin
    .from("subscriptions")
    .select("stripe_subscription_id, stripe_customer_id, status")
    .eq("user_id", userId)
    .eq("provider", "stripe")
    .maybeSingle();

  if (subscriptionError) {
    console.error("delete-account Stripe subscription lookup failed:", subscriptionError.message);
    await recordDeletionStripeCancellation(supabaseAdmin, {
      userId,
      deletionRequestId,
      status: "failed",
      result: "stripe_subscription_lookup_failed",
      errorCode: "subscription_lookup_failed",
    });
    return { attempted: false, warning: userSafeStripeCleanupWarning() };
  }

  const stripeSubscription = subscription as StripeSubscriptionRow | null;
  if (!stripeSubscription?.stripe_subscription_id) {
    return { attempted: false, warning: null };
  }

  if (!shouldCancelStripeSubscription(stripeSubscription.status)) {
    const { error: recomputeError } = await supabaseAdmin.rpc(
      "recompute_profile_subscription_entitlement",
      { p_user_id: userId },
    );
    if (recomputeError) {
      console.error("delete-account inactive Stripe entitlement recompute failed:", recomputeError.message);
      await recordDeletionStripeCancellation(supabaseAdmin, {
        userId,
        deletionRequestId,
        status: "failed",
        result: "stripe_subscription_inactive_entitlement_recompute_failed",
        errorCode: "local_entitlement_recompute_failed",
        subscription: stripeSubscription,
      });
      return { attempted: false, warning: userSafeStripeCleanupWarning() };
    }
    return { attempted: false, warning: null };
  }

  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeSecretKey) {
    await recordDeletionStripeCancellation(supabaseAdmin, {
      userId,
      deletionRequestId,
      status: "failed",
      result: "stripe_subscription_cancel_skipped_missing_secret",
      errorCode: "stripe_secret_missing",
      subscription: stripeSubscription,
    });
    return { attempted: true, warning: userSafeStripeCleanupWarning() };
  }

  let cancelRes: Response;
  try {
    cancelRes = await fetch(
      `https://api.stripe.com/v1/subscriptions/${stripeSubscription.stripe_subscription_id}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );
  } catch {
    console.error("delete-account Stripe cancellation failed: request_error");
    await recordDeletionStripeCancellation(supabaseAdmin, {
      userId,
      deletionRequestId,
      status: "failed",
      result: "stripe_subscription_cancel_request_failed",
      errorCode: "stripe_request_error",
      subscription: stripeSubscription,
    });
    return { attempted: true, warning: userSafeStripeCleanupWarning() };
  }

  const stripeCancellationAlreadySettled = isIdempotentStripeCancellationStatus(cancelRes.status);
  if (!cancelRes.ok && !stripeCancellationAlreadySettled) {
    console.error("delete-account Stripe cancellation failed:", cancelRes.status);
    await recordDeletionStripeCancellation(supabaseAdmin, {
      userId,
      deletionRequestId,
      status: "failed",
      result: "stripe_subscription_cancel_provider_failed",
      errorCode: `stripe_http_${cancelRes.status}`,
      subscription: stripeSubscription,
      metadata: { http_status: cancelRes.status },
    });
    return { attempted: true, warning: userSafeStripeCleanupWarning() };
  }

  if (stripeCancellationAlreadySettled) {
    console.info("delete-account Stripe cancellation already settled:", cancelRes.status);
  }

  const { error: updateError } = await supabaseAdmin
    .from("subscriptions")
    .update({ status: "canceled" })
    .eq("user_id", userId)
    .eq("provider", "stripe")
    .eq("stripe_subscription_id", stripeSubscription.stripe_subscription_id);

  if (updateError) {
    console.error("delete-account local subscription update failed:", updateError.message);
    await recordDeletionStripeCancellation(supabaseAdmin, {
      userId,
      deletionRequestId,
      status: "failed",
      result: "stripe_subscription_cancel_local_update_failed",
      errorCode: "local_subscription_update_failed",
      subscription: stripeSubscription,
    });
    return { attempted: true, warning: userSafeStripeCleanupWarning() };
  }

  const { error: recomputeError } = await supabaseAdmin.rpc(
    "recompute_profile_subscription_entitlement",
    { p_user_id: userId },
  );
  if (recomputeError) {
    console.error("Failed to recompute profile entitlement after Stripe cancellation:", recomputeError.message);
    await recordDeletionStripeCancellation(supabaseAdmin, {
      userId,
      deletionRequestId,
      status: "failed",
      result: "stripe_subscription_cancel_entitlement_recompute_failed",
      errorCode: "local_entitlement_recompute_failed",
      subscription: stripeSubscription,
    });
    return { attempted: true, warning: userSafeStripeCleanupWarning() };
  }

  await recordDeletionStripeCancellation(supabaseAdmin, {
    userId,
    deletionRequestId,
    status: "succeeded",
    result: stripeCancellationAlreadySettled
      ? "stripe_subscription_cancel_already_settled_for_account_deletion"
      : "stripe_subscription_canceled_for_account_deletion",
    subscription: stripeSubscription,
    metadata: stripeCancellationAlreadySettled ? { http_status: cancelRes.status } : undefined,
  });

  return { attempted: true, warning: null };
}

async function finalizeDeletionSchedule(
  req: Request,
  supabaseAdmin: AdminSupabaseClient,
  userId: string,
  deletionRequest: PendingDeletionRequest,
  idempotent: boolean,
): Promise<Response> {
  const mediaHoldResult = await applyAccountDeletionMediaHold(supabaseAdmin, userId);
  if (!mediaHoldResult.success) {
    console.error("Error applying deletion media hold:", mediaHoldResult.error);
    return response(req, {
      success: false,
      code: "media_cleanup_prepare_failed",
      error:
        "Your deletion request is saved, but cleanup preparation could not finish. Please try again or contact support.",
      deletion_request_pending: true,
      deletion_request_id: deletionRequest.id,
      scheduled_deletion_at: deletionRequest.scheduled_deletion_at,
      idempotent,
    });
  }

  const stripeCancellation = await cancelStripeSubscriptionForDeletion(
    supabaseAdmin,
    userId,
    deletionRequest.id,
  );

  const body: Record<string, unknown> = {
    success: true,
    code: idempotent ? "deletion_already_pending" : "deletion_scheduled",
    message: "Account scheduled for deletion",
    deletion_request_pending: true,
    deletion_request_id: deletionRequest.id,
    scheduled_deletion_at: deletionRequest.scheduled_deletion_at,
    idempotent,
    media_hold_applied: true,
    media_hold_matches_touched: mediaHoldResult.matchesTouched ?? 0,
    stripe_cancellation_attempted: stripeCancellation.attempted,
  };

  if (stripeCancellation.warning) {
    body.warning_code = stripeCancellation.warning.code;
    body.warning = stripeCancellation.warning.message;
    body.warning_retryable = stripeCancellation.warning.retryable;
    body.subscription_cleanup_pending = true;
  }

  return response(req, body);
}

function phoneFromIdentity(user: AdminUserLike): string | null {
  const direct = typeof user.phone === "string" && user.phone.trim() ? user.phone.trim() : null;
  if (direct) return direct;
  for (const identity of user.identities ?? []) {
    const raw = identity.identity_data?.phone;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return null;
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const first = local.slice(0, 1) || "*";
  return `${first}${"*".repeat(Math.max(3, Math.min(local.length - 1, 6)))}@${domain || "email"}`;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `•••• ${digits.slice(-4)}`;
}

function generateOtp(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String((array[0] % 900000) + 100000);
}

function getDeletionProofSecret(): string {
  return (
    Deno.env.get("ACCOUNT_DELETION_RATE_LIMIT_PEPPER") ??
    Deno.env.get("EMAIL_VERIFICATION_OTP_SECRET") ??
    supabaseServiceRoleKey
  );
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i]!.toString(16).padStart(2, "0");
  }
  return s;
}

function timingSafeEqualUtf8(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) {
    diff |= ea[i]! ^ eb[i]!;
  }
  return diff === 0;
}

async function hmacStoredForm(value: string, purpose: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getDeletionProofSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${purpose}:${value}`)),
  );
  return `${OTP_HASH_PREFIX}${bytesToHex(sig)}`;
}

async function resolveAvailableReauthTargets(
  supabaseAdmin: AdminSupabaseClient,
  userId: string,
  requestedChannel: ReauthChannel | null,
): Promise<ReauthTarget[]> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !data?.user) return [];

  const user = data.user as AdminUserLike;
  const email = resolveCanonicalAuthEmail(user);
  const phone = phoneFromIdentity(user);
  const emailTarget = email
    ? { channel: "email" as const, destination: email, maskedDestination: maskEmail(email) }
    : null;
  const phoneTarget = phone
    ? { channel: "phone" as const, destination: phone, maskedDestination: maskPhone(phone) }
    : null;

  if (requestedChannel === "phone") {
    return phoneTarget ? [phoneTarget] : [];
  }
  if (requestedChannel === "email") {
    return emailTarget ? [emailTarget] : [];
  }

  return [emailTarget, phoneTarget].filter((target): target is ReauthTarget => target !== null);
}

async function resolveReauthTarget(
  supabaseAdmin: AdminSupabaseClient,
  userId: string,
  requestedChannel: ReauthChannel | null,
): Promise<ReauthTarget | null> {
  const [target] = await resolveAvailableReauthTargets(supabaseAdmin, userId, requestedChannel);
  return target ?? null;
}

async function consumeReauthChallenge(
  supabaseAdmin: AdminSupabaseClient,
  challengeId: string,
): Promise<void> {
  await supabaseAdmin
    .from("account_deletion_reauth_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", challengeId)
    .is("consumed_at", null);
}

async function consumeOtherReauthChallenges(
  supabaseAdmin: AdminSupabaseClient,
  userId: string,
  activeChallengeId: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("account_deletion_reauth_challenges")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("consumed_at", null)
    .neq("id", activeChallengeId);
  if (error) {
    console.error("delete-account reauth old challenge consume failed:", error.message);
  }
}

async function sendDeletionReauthEmail(destination: string, otp: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false;

  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [destination],
        subject: "Confirm your Vibely account deletion request",
        html: `
          <!DOCTYPE html>
          <html>
          <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;color:#ffffff;padding:40px 20px;margin:0;">
            <div style="max-width:420px;margin:0 auto;background:#151520;border:1px solid rgba(239,68,68,0.35);border-radius:20px;padding:32px;">
              <h2 style="font-size:20px;margin:0 0 12px;">Confirm account deletion</h2>
              <p style="color:#a1a1aa;font-size:14px;line-height:1.5;margin:0 0 24px;">
                Enter this code in Vibely to schedule your account deletion request.
              </p>
              <div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);border-radius:14px;padding:20px;text-align:center;margin-bottom:24px;">
                <p style="font-size:34px;font-weight:700;letter-spacing:8px;color:#f87171;margin:0;font-family:monospace;">${otp}</p>
              </div>
              <p style="color:#71717a;font-size:12px;line-height:1.5;margin:0;">
                This code expires in 10 minutes. Ignore this email if you did not request account deletion.
              </p>
            </div>
          </body>
          </html>
        `,
      }),
    });
  } catch {
    console.error("delete-account reauth email send failed: request_error");
    return false;
  }

  if (!res.ok) {
    console.error("delete-account reauth email send failed:", res.status);
    return false;
  }
  return true;
}

async function sendDeletionReauthSms(destination: string): Promise<boolean> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_VERIFY_SID) return false;
  const twilioAuth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
  let res: Response;
  try {
    res = await fetch(`https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SID}/Verifications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${twilioAuth}`,
      },
      body: new URLSearchParams({ To: destination, Channel: "sms" }).toString(),
    });
  } catch {
    console.error("delete-account reauth sms send failed: request_error");
    return false;
  }
  if (!res.ok) {
    console.error("delete-account reauth sms send failed:", res.status);
    return false;
  }
  return true;
}

async function requestReauthChallenge(
  req: Request,
  supabaseAdmin: AdminSupabaseClient,
  userId: string,
  requestedChannel: ReauthChannel | null,
): Promise<Response> {
  const rateLimitResult = await checkRateLimit(userId, {
    functionName: "delete-account-reauth-request",
    maxRequests: 3,
    windowMs: 15 * 60 * 1000,
  });
  if (!rateLimitResult.allowed) {
    return createRateLimitResponse(rateLimitResult, corsHeadersForRequest(req));
  }

  const allTargets = await resolveAvailableReauthTargets(supabaseAdmin, userId, null);
  const availableChannels = allTargets.map((target) => target.channel);
  const targets = requestedChannel
    ? allTargets.filter((target) => target.channel === requestedChannel)
    : allTargets;
  if (targets.length === 0) {
    return response(req, {
      success: false,
      code: requestedChannel ? "reauth_channel_unavailable" : "reauth_unavailable",
      error: requestedChannel
        ? "That verification method is not available for this account."
        : "Add an email or phone number to your account before scheduling deletion.",
      availableChannels,
    });
  }

  for (const target of targets) {
    const destinationHash = await hmacStoredForm(
      normalizeEmailAddress(target.destination) ?? target.destination,
      "destination",
    );
    const expiresAt = new Date(Date.now() + REAUTH_TTL_MS).toISOString();
    const otp = target.channel === "email" ? generateOtp() : null;
    const codeHash = otp ? await hmacStoredForm(otp, "account-deletion-code") : null;

    const { data: insertedChallenge, error: insertError } = await supabaseAdmin
      .from("account_deletion_reauth_challenges")
      .insert({
        user_id: userId,
        channel: target.channel,
        destination_hash: destinationHash,
        code_hash: codeHash,
        expires_at: expiresAt,
      })
      .select("id")
      .maybeSingle();
    if (insertError || !insertedChallenge?.id) {
      if (insertError) console.error("delete-account reauth challenge insert failed:", insertError.message);
      return response(req, {
        success: false,
        code: "reauth_prepare_failed",
        error: "Verification could not be prepared. Please try again later.",
      });
    }

    const providerAccepted = target.channel === "email"
      ? await sendDeletionReauthEmail(target.destination, otp!)
      : await sendDeletionReauthSms(target.destination);

    if (!providerAccepted) {
      await consumeReauthChallenge(supabaseAdmin, insertedChallenge.id);
      continue;
    }

    await consumeOtherReauthChallenges(supabaseAdmin, userId, insertedChallenge.id);

    return response(req, {
      success: true,
      action: "request_reauth",
      reauth: {
        channel: target.channel,
        maskedDestination: target.maskedDestination,
        availableChannels,
      },
    });
  }

  return response(req, {
    success: false,
    code: "reauth_provider_unavailable",
    error: "We could not send a verification code. Please try again later.",
  });
}

async function verifyDeletionReauthEmail(
  supabaseAdmin: AdminSupabaseClient,
  userId: string,
  target: ReauthTarget,
  code: string,
): Promise<boolean> {
  const destinationHash = await hmacStoredForm(normalizeEmailAddress(target.destination) ?? target.destination, "destination");
  const { data: challenge, error } = await supabaseAdmin
    .from("account_deletion_reauth_challenges")
    .select("id, code_hash, failed_attempts")
    .eq("user_id", userId)
    .eq("channel", "email")
    .eq("destination_hash", destinationHash)
    .is("verified_at", null)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !challenge?.code_hash) {
    if (error) console.error("delete-account reauth email lookup failed:", error.message);
    return false;
  }
  if ((challenge.failed_attempts ?? 0) >= MAX_REAUTH_VERIFY_ATTEMPTS) return false;

  const expected = await hmacStoredForm(code, "account-deletion-code");
  if (!timingSafeEqualUtf8(expected, challenge.code_hash)) {
    await supabaseAdmin
      .from("account_deletion_reauth_challenges")
      .update({ failed_attempts: (challenge.failed_attempts ?? 0) + 1 })
      .eq("id", challenge.id);
    return false;
  }

  const now = new Date().toISOString();
  const { data: consumedChallenge, error: updateError } = await supabaseAdmin
    .from("account_deletion_reauth_challenges")
    .update({ verified_at: now, consumed_at: now })
    .eq("id", challenge.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  if (updateError || !consumedChallenge?.id) {
    if (updateError) console.error("delete-account reauth email consume failed:", updateError.message);
    return false;
  }
  return true;
}

async function verifyDeletionReauthSms(
  supabaseAdmin: AdminSupabaseClient,
  userId: string,
  target: ReauthTarget,
  code: string,
): Promise<boolean> {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_VERIFY_SID) return false;
  const destinationHash = await hmacStoredForm(normalizeEmailAddress(target.destination) ?? target.destination, "destination");
  const { data: challenge, error } = await supabaseAdmin
    .from("account_deletion_reauth_challenges")
    .select("id, failed_attempts")
    .eq("user_id", userId)
    .eq("channel", "phone")
    .eq("destination_hash", destinationHash)
    .is("verified_at", null)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !challenge) {
    if (error) console.error("delete-account reauth sms lookup failed:", error.message);
    return false;
  }
  if ((challenge.failed_attempts ?? 0) >= MAX_REAUTH_VERIFY_ATTEMPTS) return false;

  const recordSmsFailure = async () => {
    await supabaseAdmin
      .from("account_deletion_reauth_challenges")
      .update({ failed_attempts: (challenge.failed_attempts ?? 0) + 1 })
      .eq("id", challenge.id);
  };

  const twilioAuth = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
  let res: Response;
  try {
    res = await fetch(`https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SID}/VerificationCheck`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${twilioAuth}`,
      },
      body: new URLSearchParams({ To: target.destination, Code: code }).toString(),
    });
  } catch {
    console.error("delete-account reauth sms verify failed: request_error");
    return false;
  }
  if (!res.ok) {
    await recordSmsFailure();
    return false;
  }
  const body = await res.json().catch(() => null);
  if (body?.status !== "approved") {
    await recordSmsFailure();
    return false;
  }

  const now = new Date().toISOString();
  const { data: consumedChallenge, error: updateError } = await supabaseAdmin
    .from("account_deletion_reauth_challenges")
    .update({ verified_at: now, consumed_at: now })
    .eq("id", challenge.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  if (updateError || !consumedChallenge?.id) {
    if (updateError) console.error("delete-account reauth sms consume failed:", updateError.message);
    return false;
  }
  return true;
}

async function verifyDeletionReauth(
  req: Request,
  supabaseAdmin: AdminSupabaseClient,
  userId: string,
  channel: ReauthChannel | null,
  code: string | null,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (!channel || !code) {
    return {
      ok: false,
      response: response(req, {
        success: false,
        code: "reauth_required",
        error: "Verify your account before scheduling deletion.",
      }),
    };
  }

  const verifyRateLimit = await checkRateLimit(userId, {
    functionName: "delete-account-reauth-verify",
    maxRequests: 10,
    windowMs: 60 * 60 * 1000,
  });
  if (!verifyRateLimit.allowed) {
    return { ok: false, response: createRateLimitResponse(verifyRateLimit, corsHeadersForRequest(req)) };
  }

  const target = await resolveReauthTarget(supabaseAdmin, userId, channel);
  if (!target || target.channel !== channel) {
    return {
      ok: false,
      response: response(req, {
        success: false,
        code: "reauth_unavailable",
        error: "Verification is unavailable for this account. Add an email or phone number and try again.",
      }),
    };
  }

  const verified = channel === "email"
    ? await verifyDeletionReauthEmail(supabaseAdmin, userId, target, code)
    : await verifyDeletionReauthSms(supabaseAdmin, userId, target, code);

  if (!verified) {
    return {
      ok: false,
      response: response(req, {
        success: false,
        code: "reauth_invalid",
        error: "Verification failed. Enter the latest 6-digit code or request a new one.",
      }),
    };
  }
  return { ok: true };
}

async function hasRecentVerifiedReauthChallenge(
  supabaseAdmin: AdminSupabaseClient,
  userId: string,
  channel: ReauthChannel | null,
  code: string | null,
): Promise<boolean> {
  if (!channel || !code) return false;
  if (channel !== "email") return false;

  const target = await resolveReauthTarget(supabaseAdmin, userId, channel);
  if (!target || target.channel !== channel) return false;

  const destinationHash = await hmacStoredForm(
    normalizeEmailAddress(target.destination) ?? target.destination,
    "destination",
  );
  const verifiedAfter = new Date(Date.now() - REAUTH_TTL_MS).toISOString();
  const { data: challenge, error } = await supabaseAdmin
    .from("account_deletion_reauth_challenges")
    .select("id, code_hash")
    .eq("user_id", userId)
    .eq("channel", channel)
    .eq("destination_hash", destinationHash)
    .not("verified_at", "is", null)
    .not("consumed_at", "is", null)
    .gt("verified_at", verifiedAfter)
    .order("verified_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !challenge?.id) {
    if (error) console.error("delete-account recent reauth lookup failed:", error.message);
    return false;
  }

  if (!challenge.code_hash) return false;
  const expected = await hmacStoredForm(code, "account-deletion-code");
  return timingSafeEqualUtf8(expected, challenge.code_hash);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return preflightResponse(req);
  }
  if (isBrowserOriginRejected(req)) {
    return jsonResponse(req, { success: false, error: "origin_not_allowed" }, { status: 403 });
  }
  const corsHeaders = corsHeadersForRequest(req);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return response(req, { success: false, error: "Unauthorized" });
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return response(req, { success: false, error: "Unauthorized" });
    }

    const userId = claimsData.claims.sub as string;

    let reason: string | null = null;
    let action: DeleteAccountAction = "schedule_deletion";
    let reauthChannel: ReauthChannel | null = null;
    let reauthCode: string | null = null;
    try {
      const body = await req.json();
      action = parseAction(body?.action);
      reason = normalizeReason(body?.reason);
      reauthChannel = parseChannel(body?.reauthChannel);
      reauthCode = parseCode(body?.reauthCode);
    } catch {
      // Missing/invalid body falls through to the default schedule path, which requires reauth.
    }

    const supabaseAdmin = createClient<any>(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as AdminSupabaseClient;

    if (action === "request_reauth") {
      return await requestReauthChallenge(req, supabaseAdmin, userId, reauthChannel);
    }

    const existingPending = await findPendingDeletionRequest(supabaseAdmin, userId);
    if (!existingPending.ok) {
      return response(req, { success: false, error: existingPending.error });
    }
    if (existingPending.request) {
      // Existing pending rows are idempotent only after fresh proof; email can
      // reuse the same recently verified code hash, while SMS re-checks Twilio.
      const recentlyVerified = await hasRecentVerifiedReauthChallenge(
        supabaseAdmin,
        userId,
        reauthChannel,
        reauthCode,
      );
      if (!recentlyVerified) {
        const reauthResult = await verifyDeletionReauth(req, supabaseAdmin, userId, reauthChannel, reauthCode);
        if (!reauthResult.ok) return reauthResult.response;
      }

      return await finalizeDeletionSchedule(
        req,
        supabaseAdmin,
        userId,
        existingPending.request,
        true,
      );
    }

    const reauthResult = await verifyDeletionReauth(req, supabaseAdmin, userId, reauthChannel, reauthCode);
    if (!reauthResult.ok) return reauthResult.response;

    // Rate limiting only applies to the first durable deletion request. Retries
    // against an existing pending request are idempotent and handled above.
    const rateLimitResult = await checkRateLimit(userId, {
      functionName: "delete-account",
      maxRequests: 1,
      windowMs: 60 * 60 * 1000,
    });

    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult, corsHeaders);
    }

    const deletionRequest = await ensurePendingDeletionRequest(supabaseAdmin, userId, reason);
    if (!deletionRequest.ok) {
      return response(req, { success: false, error: deletionRequest.error });
    }

    return await finalizeDeletionSchedule(
      req,
      supabaseAdmin,
      userId,
      deletionRequest.request,
      !deletionRequest.created,
    );
  } catch (error) {
    console.error("Unexpected error in delete-account:", error);
    return response(req, { success: false, error: "Internal server error" });
  }
});
