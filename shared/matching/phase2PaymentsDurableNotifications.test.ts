import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  eventTicketPaymentSuccessCopy,
  normalizeEventTicketPaymentStatus,
  resolveEventTicketPaymentViewState,
} from "./videoDatePublicApi";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260523200000_phase2_payments_durable_notifications.sql"),
  "utf8",
);
const config = readFileSync(join(root, "supabase/config.toml"), "utf8");
const checkout = readFileSync(join(root, "supabase/functions/create-event-checkout/index.ts"), "utf8");
const cors = readFileSync(join(root, "supabase/functions/_shared/cors.ts"), "utf8");
const webhook = readFileSync(join(root, "supabase/functions/stripe-webhook/index.ts"), "utf8");
const refundWorker = readFileSync(join(root, "supabase/functions/process-event-ticket-refunds/index.ts"), "utf8");
const swipeActions = readFileSync(join(root, "supabase/functions/swipe-actions/index.ts"), "utf8");
const outboxDrainer = readFileSync(join(root, "supabase/functions/video-date-outbox-drainer/index.ts"), "utf8");
const publicApi = readFileSync(join(root, "shared/matching/videoDatePublicApi.ts"), "utf8");
const webApp = readFileSync(join(root, "src/App.tsx"), "utf8");
const webPaymentSuccess = readFileSync(join(root, "src/pages/EventPaymentSuccess.tsx"), "utf8");
const nativePaymentSuccess = readFileSync(join(root, "apps/mobile/app/event-payment-success.tsx"), "utf8");
const nativeEventDetail = readFileSync(join(root, "apps/mobile/app/(tabs)/events/[id].tsx"), "utf8");
const webSettings = readFileSync(join(root, "src/pages/Settings.tsx"), "utf8");
const webFeedbackDrawer = readFileSync(join(root, "src/components/settings/FeedbackDrawer.tsx"), "utf8");
const nativeSubmitTicket = readFileSync(join(root, "apps/mobile/app/settings/submit-ticket.tsx"), "utf8");

test("Phase 2 payment migration adds checkout snapshots, refund queue RPCs, caller status, and cron worker", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS tier_at_checkout/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS entitlement_snapshot/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS event_snapshot/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.stripe_event_ticket_refunds/);
  assert.match(migration, /UNIQUE \(checkout_session_id\)/);
  assert.match(migration, /ALTER TABLE public\.stripe_event_ticket_refunds ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.stripe_event_ticket_refunds TO service_role/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.enqueue_event_ticket_refund_v1/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.ensure_event_ticket_refund_support_exception_v1/);
  assert.match(migration, /INSERT INTO public\.event_payment_exceptions/);
  assert.match(migration, /event_payment_exception_id/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.claim_event_ticket_refund_jobs_v1/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.complete_event_ticket_refund_job_v1/);
  assert.match(migration, /FOR UPDATE SKIP LOCKED/);
  assert.match(migration, /complete_event_ticket_refund_job_v1[\s\S]+refund_provider_status/);
  assert.match(migration, /ALTER FUNCTION public\.settle_event_ticket_checkout\(text, uuid, uuid\)\s+RENAME TO settle_event_ticket_checkout_20260523200000_phase2_base/);
  assert.match(migration, /checkout_policy/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\(p_profile_id::text\), hashtext\(p_event_id::text\)\)/);
  assert.match(migration, /'idempotent', true, 'outcome', v_current_settlement\.outcome/);
  assert.match(migration, /DUPLICATE_PAID_CHECKOUT/);
  assert.match(migration, /rejected_duplicate/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_event_ticket_payment_status_v1/);
  assert.match(migration, /'checkout'/);
  assert.match(migration, /'refund'/);
  assert.match(migration, /s\.checkout_session_id = v_checkout\.checkout_session_id/);
  assert.match(migration, /r\.checkout_session_id = v_checkout\.checkout_session_id/);
  assert.match(migration, /event-ticket-refund-worker/);
  assert.match(migration, /process-event-ticket-refunds/);
  assert.match(config, /\[functions\.process-event-ticket-refunds\]\s+verify_jwt = false/);
});

test("Phase 2 checkout and webhook record snapshots and enqueue refunds for paid rejects", () => {
  assert.match(checkout, /tierAtCheckout/);
  assert.match(checkout, /entitlementSnapshot/);
  assert.match(checkout, /eventSnapshot/);
  assert.match(checkout, /safeCheckoutRedirectUrl/);
  assert.match(checkout, /isAllowedOrigin\(parsed\.origin\)/);
  assert.match(cors, /"https:\/\/vibelymeet\.com"/);
  assert.doesNotMatch(checkout, /com\.vibelymeet\.vibely:\/\/|ALLOWED_CHECKOUT_REDIRECT_URL_PREFIXES/);
  assert.match(checkout, /success_url: successUrl/);
  assert.match(checkout, /cancel_url: cancelUrl/);
  assert.match(checkout, /tier_at_checkout: tierAtCheckout/);
  assert.match(checkout, /entitlement_snapshot: entitlementSnapshot/);
  assert.match(checkout, /event_snapshot: eventSnapshot/);
  assert.match(cors, /capacitor:\/\/localhost/);
  assert.match(cors, /ionic:\/\/localhost/);
  assert.match(cors, /function isHttpAllowedOrigin/);
  assert.match(cors, /parsed\.protocol === "https:" \|\| parsed\.protocol === "http:"/);
  assert.match(cors, /if \(origin && isHttpAllowedOrigin\(origin\)\) return origin/);

  assert.match(webhook, /enqueue_event_ticket_refund_v1/);
  assert.match(webhook, /stripeObjectId\(session\.payment_intent\)/);
  assert.match(webhook, /missing_amount_or_currency[\s\S]+enqueueEventTicketRefund/);
  assert.match(webhook, /intent_verification_rejected[\s\S]+enqueueEventTicketRefund/);
  assert.match(webhook, /settled\?\.success === false[\s\S]+enqueueEventTicketRefund/);
  assert.match(webhook, /event_ticket_refund_enqueue_failed/);
  assert.match(webhook, /markEventTicketIntent\(session\.id, refund\.supportNeeded \? 'support_needed' : 'refund_pending'/);
  assert.doesNotMatch(webhook, /settled\?\.success === false \? 'settlement_failed' : 'settled'/);
});

test("Phase 2 refund worker uses Stripe refunds with idempotency and durable completion", () => {
  assert.match(refundWorker, /CRON_SECRET/);
  assert.match(refundWorker, /claim_event_ticket_refund_jobs_v1/);
  assert.match(refundWorker, /stripe\.refunds\.create/);
  assert.match(refundWorker, /payment_intent: job\.payment_intent_id/);
  assert.match(refundWorker, /amount: job\.amount/);
  assert.match(refundWorker, /idempotencyKey: `event_ticket_refund:\$\{job\.checkout_session_id\}`/);
  assert.match(refundWorker, /complete_event_ticket_refund_job_v1/);
  assert.match(refundWorker, /charge_already_refunded/);
  assert.match(refundWorker, /failed_retryable|permanently_failed/);
});

test("Phase 2 swipe notifications use durable outbox and drainer preserves custom payload", () => {
  assert.match(swipeActions, /video_date_outbox_enqueue_v2/);
  assert.match(swipeActions, /p_kind: "notification\.send"/);
  assert.match(swipeActions, /p_session_id: args\.sessionId \?\? null/);
  assert.match(swipeActions, /payload\?\.ok !== true/);
  assert.match(swipeActions, /title: args\.title/);
  assert.match(swipeActions, /body: args\.body/);
  assert.match(swipeActions, /dedupeKey: `swipe:\$\{eventIdStr\}:\$\{sessionId\}:ready_gate:\$\{target_id\}`/);
  assert.match(swipeActions, /dedupeKey: `swipe:\$\{eventIdStr\}:\$\{actorId\}:\$\{target_id\}:\$\{result\.result\}`/);
  assert.doesNotMatch(swipeActions, /functions\.invoke\(["']send-notification["']/);

  assert.match(outboxDrainer, /const title = stringField\(row\.payload, "title"\)/);
  assert.match(outboxDrainer, /const body = stringField\(row\.payload, "body"\)/);
  assert.match(outboxDrainer, /if \(title\) requestBody\.title = title/);
  assert.match(outboxDrainer, /if \(body\) requestBody\.body = body/);
  assert.match(outboxDrainer, /const dedupeKey = stringField\(row\.payload, "dedupe_key", "dedupeKey"\) \?\? row\.dedupe_key \?\? null/);
  assert.match(outboxDrainer, /dedupe_key: dedupeKey \?\? undefined/);
  assert.match(outboxDrainer, /PERMANENT_NOTIFICATION_SUPPRESSIONS/);
  assert.match(outboxDrainer, /notificationPayloadFailureResult/);
  assert.match(outboxDrainer, /no_player_id/);
  assert.match(outboxDrainer, /normalizedReason === "onesignal_error"/);
  assert.match(outboxDrainer, /const authFailure = res\.status === 401 \|\| res\.status === 403/);
  assert.match(outboxDrainer, /reason: authFailure \? `notification_auth_failed_\$\{res\.status\}` : `notification_http_\$\{res\.status\}`/);
  assert.match(outboxDrainer, /permanent: authFailure \|\| \(res\.status >= 400 && res\.status < 500 && res\.status !== 429\)/);
});

test("Phase 2 shared payment normalizer drives web and native success states", () => {
  assert.match(publicApi, /EventTicketPaymentViewState/);
  assert.match(publicApi, /resolveEventTicketPaymentViewState/);
  assert.match(publicApi, /eventTicketPaymentSuccessCopy/);
  assert.match(webPaymentSuccess, /resolveEventTicketPaymentViewState/);
  assert.match(webPaymentSuccess, /eventTicketPaymentSuccessCopy/);
  assert.match(webPaymentSuccess, /searchParams\.get\("event_id"\) \?\? searchParams\.get\("eventId"\)/);
  assert.match(webPaymentSuccess, /drawer=support&primaryType=support&subcategory=Payment%20failed%20or%20refund/);
  assert.match(webApp, /path="\/event-payment-success"/);
  assert.match(nativePaymentSuccess, /resolveEventTicketPaymentViewState/);
  assert.match(nativePaymentSuccess, /eventTicketPaymentSuccessCopy/);
  assert.match(nativePaymentSuccess, /eventIdSnake/);
  assert.match(nativeEventDetail, /CHECKOUT_RETURN_ORIGIN/);
  assert.match(nativeEventDetail, /\/event-payment-success\?eventId=/);
  assert.match(nativeEventDetail, /event_id=\$\{encodeURIComponent\(event\.id\)\}/);
  assert.match(nativePaymentSuccess, /subcategory: 'Payment failed or refund'/);
  assert.match(webSettings, /drawer === "support"/);
  assert.match(webSettings, /handleFeedbackOpenChange/);
  assert.match(webSettings, /next\.delete\("subcategory"\)/);
  assert.match(webFeedbackDrawer, /initialSubcategory/);
  assert.match(nativeSubmitTicket, /subcategoryParam/);

  const pending = normalizeEventTicketPaymentStatus({ ok: true });
  assert.equal(resolveEventTicketPaymentViewState(pending), "pending");

  const confirmed = normalizeEventTicketPaymentStatus({
    ok: true,
    admission_status: "confirmed",
    payment_status: "paid",
  });
  assert.equal(resolveEventTicketPaymentViewState(confirmed), "confirmed");
  assert.equal(eventTicketPaymentSuccessCopy("confirmed").celebrate, true);

  const refundPending = normalizeEventTicketPaymentStatus({
    ok: true,
    settlement: { success: false, code: "TIER_MISMATCH", refund_status: "pending" },
    refund: { status: "pending" },
  });
  assert.equal(resolveEventTicketPaymentViewState(refundPending), "rejected_refund_pending");
  assert.equal(eventTicketPaymentSuccessCopy("rejected_refund_pending").showSupportAction, false);

  const refunded = normalizeEventTicketPaymentStatus({
    ok: true,
    refund: { status: "noop_already_refunded" },
  });
  assert.equal(refunded.refund.status, "refunded");
  assert.equal(resolveEventTicketPaymentViewState(refunded), "refunded");

  const failed = normalizeEventTicketPaymentStatus({
    ok: true,
    refund: { status: "failed_permanent", support_needed: true },
  });
  assert.equal(resolveEventTicketPaymentViewState(failed), "refund_failed_support");
  assert.equal(eventTicketPaymentSuccessCopy("refund_failed_support").showSupportAction, true);

  const duplicateWithoutRefund = normalizeEventTicketPaymentStatus({
    ok: true,
    settlement: { success: false, code: "DUPLICATE_PAID_CHECKOUT" },
  });
  assert.equal(resolveEventTicketPaymentViewState(duplicateWithoutRefund), "support_needed");

  const confirmedWithStalePreviousRefund = normalizeEventTicketPaymentStatus({
    ok: true,
    admission_status: "confirmed",
    checkout: { checkout_session_id: "cs_latest" },
    settlement: { checkout_session_id: "cs_latest", success: true, admission_status: "confirmed" },
    refund: { checkout_session_id: "cs_old", status: "pending" },
  });
  assert.equal(resolveEventTicketPaymentViewState(confirmedWithStalePreviousRefund), "confirmed");
});
