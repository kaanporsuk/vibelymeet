import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const edgeFunction = read("supabase/functions/delete-account/index.ts");
const migration = read("supabase/migrations/20260523183000_account_deletion_reauth_challenges.sql");
const webHook = read("src/hooks/useDeleteAccount.ts");
const webModal = read("src/components/settings/DeleteAccountModal.tsx");
const nativeDelete = read("apps/mobile/app/delete-account.tsx");
const publicDelete = read("src/pages/legal/DeleteAccountWeb.tsx");

test("authenticated delete-account requires server-verified reauth proof", () => {
  assert.match(edgeFunction, /"request_reauth"/);
  assert.match(edgeFunction, /"schedule_deletion"/);
  assert.match(edgeFunction, /reauth_required/);
  assert.match(edgeFunction, /verifyDeletionReauth/);
  assert.match(edgeFunction, /hasRecentVerifiedReauthChallenge/);
  assert.match(edgeFunction, /reauthCode/);
  assert.match(edgeFunction, /reauthChannel/);
  assert.match(edgeFunction, /account_deletion_reauth_challenges/);
  assert.match(edgeFunction, /sendDeletionReauthEmail/);
  assert.match(edgeFunction, /sendDeletionReauthSms/);
  assert.match(edgeFunction, /resolveAvailableReauthTargets/);
  assert.match(edgeFunction, /availableChannels/);
  assert.match(edgeFunction, /reauth_channel_unavailable/);
  assert.match(edgeFunction, /consumeOtherReauthChallenges/);
  assert.doesNotMatch(edgeFunction, /auth\.admin\.signOut\(userId\)/);
  assert.match(edgeFunction, /\.update\(\{ verified_at: now, consumed_at: now \}\)[\s\S]*\.select\("id"\)[\s\S]*\.maybeSingle\(\)/);
  assert.match(edgeFunction, /if \(updateError \|\| !consumedChallenge\?\.id\)/);
  assert.match(edgeFunction, /ACCOUNT_DELETION_RATE_LIMIT_PEPPER/);
  assert.doesNotMatch(edgeFunction, /turnstile|captchaToken|siteverify/i);
});

test("authenticated delete-account is idempotent around the durable pending request", () => {
  assert.match(edgeFunction, /findPendingDeletionRequest/);
  assert.match(edgeFunction, /ensurePendingDeletionRequest/);
  assert.match(edgeFunction, /finalizeDeletionSchedule/);
  assert.match(edgeFunction, /deletion_already_pending/);
  assert.match(edgeFunction, /deletion_request_pending/);
  assert.match(edgeFunction, /idempotent/);
  assert.match(edgeFunction, /insertError\?\.code === "23505"[\s\S]*findPendingDeletionRequest/);

  const existingCheck = edgeFunction.indexOf("const existingPending = await findPendingDeletionRequest");
  const recentVerifiedCheck = edgeFunction.indexOf("const recentlyVerified = await hasRecentVerifiedReauthChallenge");
  const existingPendingVerify = edgeFunction.indexOf(
    "const reauthResult = await verifyDeletionReauth",
    recentVerifiedCheck,
  );
  const existingPendingFinalize = edgeFunction.indexOf("return await finalizeDeletionSchedule", existingPendingVerify);
  assert.ok(existingCheck >= 0, "schedule path should check existing pending request");
  assert.ok(recentVerifiedCheck > existingCheck, "existing pending request should check recent server reauth");
  assert.ok(existingPendingVerify > recentVerifiedCheck, "existing pending request should fall back to fresh reauth");
  assert.ok(existingPendingFinalize > existingPendingVerify, "existing pending request should finalize only after reauth gate");
  assert.ok(
    existingCheck < recentVerifiedCheck,
    "existing pending request should not bypass the authenticated deletion reauth boundary",
  );
  assert.match(edgeFunction, /if \(!recentlyVerified\) \{[\s\S]*verifyDeletionReauth[\s\S]*if \(!reauthResult\.ok\) return reauthResult\.response;[\s\S]*\}[\s\S]*return await finalizeDeletionSchedule/);
  assert.match(edgeFunction, /\.not\("verified_at", "is", null\)/);
  assert.match(edgeFunction, /\.not\("consumed_at", "is", null\)/);
  assert.match(edgeFunction, /\.gt\("verified_at", verifiedAfter\)/);
  assert.match(edgeFunction, /if \(channel !== "email"\) return false/);
  assert.match(edgeFunction, /SMS re-checks Twilio/);

  const ensureRequest = edgeFunction.indexOf("const deletionRequest = await ensurePendingDeletionRequest");
  const finalizeAfterEnsure = edgeFunction.indexOf("return await finalizeDeletionSchedule", ensureRequest);
  assert.ok(ensureRequest >= 0, "first schedule path should ensure durable request");
  assert.ok(finalizeAfterEnsure > ensureRequest, "side effects should run only after durable request exists");
  assert.match(
    edgeFunction,
    /if \(!deletionRequest\.ok\) \{[\s\S]*return response\(req, \{ success: false, error: deletionRequest\.error \}\);[\s\S]*\}[\s\S]*return await finalizeDeletionSchedule/,
    "request creation failure must abort before cleanup side effects",
  );
});

test("account deletion Stripe cleanup is retryable, observable, and sanitized", () => {
  assert.match(edgeFunction, /recordPaymentObservability/);
  assert.match(edgeFunction, /account_deletion_stripe_cancellation/);
  assert.match(edgeFunction, /function shouldCancelStripeSubscription/);
  assert.match(edgeFunction, /"canceled", "incomplete_expired"/);
  assert.match(edgeFunction, /if \(!shouldCancelStripeSubscription\(stripeSubscription\.status\)\)/);
  assert.doesNotMatch(edgeFunction, /\["active", "trialing"\]\.includes/);
  assert.match(edgeFunction, /stripe_subscription_cancel_provider_failed/);
  assert.match(edgeFunction, /stripe_subscription_cancel_request_failed/);
  assert.match(edgeFunction, /stripe_subscription_cancel_skipped_missing_secret/);
  assert.match(edgeFunction, /stripe_subscription_cancel_local_update_failed/);
  assert.match(edgeFunction, /stripe_subscription_cancel_entitlement_recompute_failed/);
  assert.match(edgeFunction, /stripe_subscription_inactive_entitlement_recompute_failed/);
  assert.match(edgeFunction, /stripe_subscription_canceled_for_account_deletion/);
  assert.match(edgeFunction, /subscription_cleanup_pending/);
  assert.match(edgeFunction, /warning_code/);
  assert.match(edgeFunction, /warning_retryable/);
  assert.match(edgeFunction, /Try again later or contact support if billing still appears/);
  assert.match(edgeFunction, /stripe_http_\$\{cancelRes\.status\}/);
  assert.match(edgeFunction, /metadata_summary:[\s\S]*deletion_request_id/);
  assert.doesNotMatch(edgeFunction, /cancelBody/);
  assert.doesNotMatch(edgeFunction, /await cancelRes\.text\(\)/);
  assert.doesNotMatch(edgeFunction, /Failed to cancel Stripe subscription:[\s\S]*body/i);
});

test("reauth challenge storage is service-role only and short-lived", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.account_deletion_reauth_challenges/);
  assert.match(migration, /ALTER TABLE public\.account_deletion_reauth_challenges ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.account_deletion_reauth_challenges FROM anon, authenticated/);
  assert.match(migration, /GRANT ALL ON TABLE public\.account_deletion_reauth_challenges TO service_role/);
  assert.match(migration, /expires_at timestamptz NOT NULL/);
  assert.match(migration, /code_hash text/);
  assert.match(migration, /NOTIFY pgrst, 'reload schema'/);
});

test("web Settings delete requests OTP before scheduling deletion", () => {
  assert.match(webHook, /requestDeleteAccountVerification/);
  assert.match(webHook, /action: "request_reauth"/);
  assert.match(webHook, /reauthChannel: channel/);
  assert.match(webHook, /action: "schedule_deletion"/);
  assert.match(webHook, /reauthCode: reauth\.code/);
  assert.match(webHook, /reauthChannel: reauth\.channel/);
  assert.match(webHook, /typeof data\?\.warning === "string"/);
  assert.match(webHook, /data\?\.deletion_request_pending === true/);
  assert.match(webHook, /toast\.info\(warning/);
  assert.match(webModal, /alternateReauthChannel/);
  assert.match(webModal, /onRequestVerification/);
  assert.match(webModal, /Use \{alternateReauthChannel === "phone" \? "phone" : "email"\} instead/);
  assert.match(webModal, /Verify it’s you/);
  assert.match(webModal, /one-time-code/);
  assert.match(webModal, /overflow-y-auto/);
  assert.match(webModal, /verificationCode\.length === 6/);
  assert.doesNotMatch(webModal, /turnstile|captchaToken/i);
});

test("native Settings delete requests OTP before scheduling deletion", () => {
  assert.match(nativeDelete, /requestDeletionVerification/);
  assert.match(nativeDelete, /action: 'request_reauth'/);
  assert.match(nativeDelete, /reauthChannel: channel/);
  assert.match(nativeDelete, /action: 'schedule_deletion'/);
  assert.match(nativeDelete, /reauthCode: code/);
  assert.match(nativeDelete, /reauthChannel: challenge\.channel/);
  assert.match(nativeDelete, /warning\?: string/);
  assert.match(nativeDelete, /deletion_request_pending\?: boolean/);
  assert.match(nativeDelete, /payload\?\.deletion_request_pending === true/);
  assert.match(nativeDelete, /variant: payload\.warning \? 'warning' : 'success'/);
  assert.match(nativeDelete, /alternateReauthChannel/);
  assert.match(nativeDelete, /Use \{alternateReauthChannel === 'phone' \? 'phone' : 'email'\} instead/);
  assert.match(nativeDelete, /Verify it’s you/);
  assert.match(nativeDelete, /textContentType="oneTimeCode"/);
  assert.match(nativeDelete, /keep using Vibely during the grace window/);
  assert.doesNotMatch(nativeDelete, /turnstile|captchaToken/i);
});

test("public delete-account remains the only Turnstile-gated delete flow", () => {
  assert.match(publicDelete, /WEB_TURNSTILE_SITE_KEY/);
  assert.match(publicDelete, /loadTurnstileScript/);
  assert.match(publicDelete, /window\.turnstile\.render/);
  assert.match(publicDelete, /captchaToken/);
  assert.doesNotMatch(publicDelete, /turnstile\.execute|invisible/i);
});
