import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function sqlWithoutCommentsOrStringLiterals(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/'(?:''|[^'])*'/g, "''");
}

const migrationPath = "supabase/migrations/20260501220000_premium_credits_observability.sql";
const migration = read(migrationPath);
const validation = read("supabase/validation/premium_credits_observability.sql");
const webhook = read("supabase/functions/stripe-webhook/index.ts");
const checkout = read("supabase/functions/create-checkout-session/index.ts");
const creditsCheckout = read("supabase/functions/create-credits-checkout/index.ts");
const eventCheckout = read("supabase/functions/create-event-checkout/index.ts");
const portal = read("supabase/functions/create-portal-session/index.ts");
const helper = read("supabase/functions/_shared/paymentObservability.ts");
const creditPacks = read("supabase/functions/_shared/creditPacks.ts");

test("Stream 9 migration exists and sorts after Stream 7", () => {
  const versions = readdirSync(join(root, "supabase/migrations"))
    .map((name) => name.slice(0, 14))
    .filter((version) => /^\d{14}$/.test(version))
    .sort();

  assert.ok(versions.includes("20260501210000"), "Stream 7 migration should be present");
  assert.ok(versions.includes("20260501220000"), "Stream 9 migration should be present");
  assert.ok(
    versions.indexOf("20260501220000") > versions.indexOf("20260501210000"),
    "Stream 9 migration must sort after Stream 7",
  );
});

test("payment observability and webhook idempotency tables are internal-only", () => {
  for (const marker of [
    "CREATE TABLE IF NOT EXISTS public.stripe_webhook_events",
    "stripe_event_id text PRIMARY KEY",
    "CREATE TABLE IF NOT EXISTS public.payment_observability_events",
    "ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE public.payment_observability_events ENABLE ROW LEVEL SECURITY",
    "REVOKE ALL ON TABLE public.stripe_webhook_events FROM authenticated",
    "REVOKE ALL ON TABLE public.payment_observability_events FROM authenticated",
    "GRANT SELECT, INSERT, UPDATE ON TABLE public.stripe_webhook_events TO service_role",
    "GRANT SELECT, INSERT ON TABLE public.payment_observability_events TO service_role",
  ]) {
    assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(migration, /raw Stripe payloads/);
  assert.match(migration, /card data, emails, URLs, or secrets/);
});

test("production validation is read-only catalog-safe", () => {
  assert.match(validation, /to_regclass\('public\.stripe_webhook_events'\)/);
  assert.match(validation, /has_table_privilege/);
  assert.match(validation, /relrowsecurity/);
  assert.doesNotMatch(sqlWithoutCommentsOrStringLiterals(validation), /\b(insert|update|delete|truncate|alter|drop|create)\b/i);
});

test("stripe-webhook verifies raw Stripe signature before idempotency and settlement", () => {
  const bodyIndex = webhook.indexOf("const body = await req.text()");
  const constructIndex = webhook.indexOf("stripe.webhooks.constructEvent");
  const idempotencyIndex = webhook.indexOf("beginWebhookProcessing(webhookContext)");
  const settlementIndex = webhook.indexOf("settle_event_ticket_checkout");

  assert.ok(bodyIndex > 0, "webhook should read raw body text");
  assert.ok(constructIndex > bodyIndex, "signature construction must use raw body after reading it");
  assert.ok(idempotencyIndex > constructIndex, "idempotency should happen after signature verification");
  assert.ok(settlementIndex > constructIndex, "settlement should happen after signature verification");
});

test("stripe-webhook uses Stripe event id for duplicate-safe webhook processing", () => {
  assert.match(webhook, /stripe_event_id:\s*event\.id/);
  assert.match(webhook, /\.from\('stripe_webhook_events'\)[\s\S]{0,220}\.insert\(/);
  assert.match(webhook, /insertError\.code !== '23505'/);
  assert.match(webhook, /webhook_duplicate_replay/);
  assert.match(webhook, /duplicate_skipped/);
  assert.match(webhook, /idempotent:\s*true/);
  assert.match(webhook, /status:\s*'processing'/);
  assert.match(webhook, /\.in\('status', \['failed', 'received'\]\)/);
});

test("duplicate processed webhook path skips settlement and returns success", () => {
  const duplicateIndex = webhook.indexOf("webhook_duplicate_replay");
  const skipReturnIndex = webhook.indexOf("result: 'duplicate_skipped'");
  const switchIndex = webhook.indexOf("switch (event.type)");
  assert.ok(duplicateIndex > 0, "duplicate replay branch should be present");
  assert.ok(skipReturnIndex > duplicateIndex, "duplicate branch should return duplicate_skipped");
  assert.ok(switchIndex > skipReturnIndex, "duplicate skip should happen before settlement switch");
});

test("credit settlement remains checkout-session idempotent and cannot double-increment on processed replay", () => {
  const grantInsertIndex = webhook.indexOf(".from('stripe_credit_checkout_grants')");
  const creditReadIndex = webhook.indexOf(".from('user_credits')");
  assert.ok(grantInsertIndex > 0, "credit grant idempotency insert should exist");
  assert.ok(creditReadIndex > grantInsertIndex, "credit balances should be read only after idempotency insert");
  assert.match(webhook, /idemErr\?\.code === '23505'/);
  assert.match(webhook, /credits_checkout_duplicate_grant_skipped/);
  assert.match(webhook, /extra_time_credits: newExtra/);
  assert.match(webhook, /extended_vibe_credits: newExtended/);
});

test("event-ticket settlement remains RPC-idempotent and webhook-observed", () => {
  assert.match(webhook, /settle_event_ticket_checkout/);
  assert.match(webhook, /event_ticket_/);
  assert.match(read("supabase/migrations/20260407120000_paid_waitlist_promotion.sql"), /stripe_event_ticket_settlements/);
  assert.match(read("supabase/migrations/20260407120000_paid_waitlist_promotion.sql"), /idempotent/);
});

test("subscription lifecycle paths remain present and observable", () => {
  for (const marker of [
    "checkout.session.completed",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.payment_failed",
    "subscription_checkout_settled",
    "subscription_canceled",
    "subscription_past_due",
    "webhook_settlement_succeeded",
    "webhook_settlement_failed",
    "webhook_ignored",
  ]) {
    assert.match(webhook, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("missing metadata and unsupported event types are observed safely", () => {
  assert.match(webhook, /webhook_metadata_invalid/);
  assert.match(webhook, /event_ticket_missing_metadata/);
  assert.match(webhook, /credits_pack_missing_metadata/);
  assert.match(webhook, /subscription_checkout_missing_metadata/);
  assert.match(webhook, /unsupported_event_type/);
});

test("checkout and portal functions write safe durable observability without changing responses", () => {
  for (const [name, source] of [
    ["subscription checkout", checkout],
    ["credits checkout", creditsCheckout],
    ["event checkout", eventCheckout],
    ["portal", portal],
  ] as const) {
    assert.match(source, /recordPaymentObservability/, `${name} should record observability`);
    assert.match(source, /JSON\.stringify\(\{ success: true, url: session\.url \}\)/, `${name} success response should remain compatible`);
  }

  assert.match(checkout, /checkout_session_created/);
  assert.match(creditsCheckout, /credits_checkout_created/);
  assert.match(eventCheckout, /event_ticket_checkout_created/);
  assert.match(portal, /portal_session_created/);
});

test("helper redacts/sanitizes context and does not store raw Stripe payloads", () => {
  assert.match(helper, /safeUuid/);
  assert.match(helper, /safeText/);
  assert.match(helper, /payment_observability_events/);
  assert.doesNotMatch(helper, /payload|card|payment_method|email/i);
  assert.doesNotMatch(webhook, /console\.(?:log|error|warn)\([^)]*(?:STRIPE_SECRET|STRIPE_WEBHOOK_SECRET|session\.url|body)[^)]*\)/);
  assert.doesNotMatch(checkout + creditsCheckout + eventCheckout + portal, /console\.(?:log|error|warn)\([^)]*session\.url[^)]*\)/);
});

test("pricing, pack IDs, and Stripe env names remain unchanged", () => {
  for (const marker of [
    "STRIPE_MONTHLY_PRICE_ID",
    "STRIPE_ANNUAL_PRICE_ID",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ]) {
    assert.match(webhook + checkout, new RegExp(marker));
  }

  assert.match(creditPacks, /extra_time_3/);
  assert.match(creditPacks, /extended_vibe_3/);
  assert.match(creditPacks, /bundle_3_3/);
  assert.match(creditPacks, /priceEur: 2\.99/);
  assert.match(creditPacks, /priceEur: 4\.99/);
  assert.match(creditPacks, /priceEur: 5\.99/);
});

test("no unrelated native module or prior stream artifacts regressed", () => {
  assert.match(read("supabase/migrations/20260501180000_event_lobby_active_event_contract.sql"), /get_event_lobby_inactive_reason/);
  assert.match(read("supabase/migrations/20260501190000_ready_gate_transition_expiry_rowcount.sql"), /GET DIAGNOSTICS v_row_count = ROW_COUNT/);
  assert.match(read("supabase/migrations/20260501200000_ready_gate_event_ended_terminalization.sql"), /terminalize_event_ready_gates/);
  assert.match(read("supabase/migrations/20260501210000_swipe_retry_idempotency_notification_dedupe.sql"), /handle_swipe_idempotency/);
  assert.match(read("shared/matching/realtimeSubscriptionTightening.test.ts"), /broad event-level video_sessions/);
  assert.doesNotMatch(read("apps/mobile/lib/readyGateApi.ts"), /from ['"]expo-av['"]|require\(['"]expo-av['"]\)/);
});
