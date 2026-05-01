import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function exists(path: string): boolean {
  return existsSync(join(root, path));
}

function readTreeFiles(
  dir: string,
  extensions: ReadonlySet<string>,
  ignored = new Set(["node_modules", ".expo", ".next", "dist", "build", "Pods"]),
): string[] {
  const abs = join(root, dir);
  const out: string[] = [];
  for (const entry of readdirSync(abs)) {
    if (ignored.has(entry)) continue;
    const absPath = join(abs, entry);
    const relPath = `${dir}/${entry}`;
    const st = statSync(absPath);
    if (st.isDirectory()) {
      out.push(...readTreeFiles(relPath, extensions, ignored));
    } else if (extensions.has(entry.slice(entry.lastIndexOf(".")))) {
      out.push(relPath);
    }
  }
  return out;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function revenueCatEnvNames(...sources: string[]): string[] {
  const names = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/\b(?:EXPO_PUBLIC_REVENUECAT_[A-Z0-9_]+|REVENUECAT_[A-Z0-9_]+)\b/g)) {
      names.add(match[0]);
    }
  }
  return [...names].sort();
}

const branchDeltaPath = "docs/branch-deltas/fix-revenuecat-native-entitlement-readiness.md";
const branchDelta = read(branchDeltaPath);
const nativePackageJson = read("apps/mobile/package.json");
const rootPackageJson = read("package.json");
const revenueCat = read("apps/mobile/lib/revenuecat.ts");
const premiumScreen = read("apps/mobile/app/premium.tsx");
const accountScreen = read("apps/mobile/app/settings/account.tsx");
const nativeLayout = read("apps/mobile/app/_layout.tsx");
const nativeSubscriptionApi = read("apps/mobile/lib/subscriptionApi.ts");
const nativeCreditsSettings = read("apps/mobile/app/settings/credits.tsx");
const nativeCreditsCheckout = read("apps/mobile/lib/creditsCheckout.ts");
const webSubscriptionHook = read("src/hooks/useSubscription.ts");
const stripeCheckout = read("supabase/functions/create-checkout-session/index.ts");
const creditsCheckoutFunction = read("supabase/functions/create-credits-checkout/index.ts");
const stripeWebhook = read("supabase/functions/stripe-webhook/index.ts");
const revenueCatWebhook = read("supabase/functions/revenuecat-webhook/index.ts");
const syncRevenueCatSubscriber = read("supabase/functions/sync-revenuecat-subscriber/index.ts");
const revenueCatShared = read("supabase/functions/_shared/revenuecatSubscription.ts");
const supabaseConfig = read("supabase/config.toml");
const creditPacks = read("supabase/functions/_shared/creditPacks.ts");

test("native RevenueCat entitlement posture is documented", () => {
  assert.equal(exists(branchDeltaPath), true);
  assert.match(branchDelta, /RevenueCat Status: Implemented/);
  assert.match(branchDelta, /Native Entitlement Source Of Truth/);
  assert.match(branchDelta, /Purchases are implemented for Premium subscriptions/);
  assert.match(branchDelta, /Credits remain Stripe browser checkout/);
  assert.match(branchDelta, /Manual RevenueCat Provider-Dashboard Checklist/);
  assert.match(branchDelta, /No real purchases were run/);
});

test("RevenueCat dependency and native SDK contract remain present", () => {
  assert.match(nativePackageJson, /"react-native-purchases"\s*:/);
  assert.match(revenueCat, /import Purchases/);
  assert.match(revenueCat, /Purchases\.configure\(\{ apiKey: key \}\)/);
  assert.match(revenueCat, /Purchases\.logIn\(userId\)/);
  assert.match(revenueCat, /Purchases\.getOfferings\(\)/);
  assert.match(revenueCat, /Purchases\.purchasePackage\(pkg\)/);
  assert.match(revenueCat, /Purchases\.restorePurchases\(\)/);
  assert.match(nativeLayout, /initRevenueCat\(\)/);
  assert.match(nativeLayout, /setRevenueCatUserId\(user\.id\)/);
});

test("native premium purchase path uses RevenueCat, not Stripe checkout", () => {
  assert.match(premiumScreen, /useBackendSubscription\(user\?\.id\)/);
  assert.match(premiumScreen, /getOfferings\(\)/);
  assert.match(premiumScreen, /purchasePackage\(pkg\)/);
  assert.match(premiumScreen, /restorePurchasesWithCustomerInfo\(\)/);
  assert.match(premiumScreen, /syncRevenueCatSubscriberFromServer\(\)/);
  assert.doesNotMatch(premiumScreen, /create-checkout-session|STRIPE_SECRET_KEY|STRIPE_MONTHLY_PRICE_ID|STRIPE_ANNUAL_PRICE_ID/);
});

test("native credits stay intentionally web and Stripe browser based", () => {
  assert.match(nativeCreditsSettings, /user_credits/);
  assert.match(nativeCreditsSettings, /getCreditsCheckoutUrl\(packId\)/);
  assert.match(nativeCreditsSettings, /Payment runs in your browser \(Stripe\)/);
  assert.match(nativeCreditsSettings, /Opens Stripe checkout in browser/);
  assert.match(nativeCreditsCheckout, /create-credits-checkout/);
  assert.match(nativeCreditsCheckout, /Returns checkout URL; open in browser\. Same contract as web\./);
  assert.match(nativeCreditsCheckout, /Origin: APP_ORIGIN/);
});

test("backend entitlement reads remain the native source of truth", () => {
  assert.match(nativeSubscriptionApi, /Canonical subscription state from backend \(Stripe \+ RevenueCat\)/);
  assert.match(nativeSubscriptionApi, /\.from\('subscriptions'\)/);
  assert.match(nativeSubscriptionApi, /\.select\('status, plan, current_period_end, provider'\)/);
  assert.match(nativeSubscriptionApi, /status === 'active' \|\| r\.status === 'trialing'/);
  assert.match(nativeSubscriptionApi, /\.from\('profiles'\)/);
  assert.match(nativeSubscriptionApi, /\.select\('is_premium'\)/);
  assert.match(nativeCreditsSettings, /\.from\('user_credits'\)/);
  assert.match(nativeCreditsSettings, /\.select\('extra_time_credits, extended_vibe_credits'\)/);
});

test("RevenueCat webhook and server sync reconcile into backend entitlements", () => {
  assert.match(supabaseConfig, /\[functions\.revenuecat-webhook\]\s+verify_jwt = false/);
  assert.match(supabaseConfig, /\[functions\.sync-revenuecat-subscriber\]\s+verify_jwt = true/);
  assert.match(revenueCatWebhook, /REVENUECAT_WEBHOOK_AUTHORIZATION/);
  assert.match(revenueCatWebhook, /app_user_id/);
  assert.match(revenueCatWebhook, /upsertActiveRevenueCatSubscription/);
  assert.match(revenueCatWebhook, /downgradeRevenueCatSubscriptionRow/);
  assert.match(syncRevenueCatSubscriber, /supabase\.auth\.getUser\(jwt\)/);
  assert.match(syncRevenueCatSubscriber, /REVENUECAT_SECRET_API_KEY/);
  assert.match(syncRevenueCatSubscriber, /https:\/\/api\.revenuecat\.com\/v1\/subscribers/);
  assert.match(revenueCatShared, /provider: 'revenuecat'/);
  assert.match(revenueCatShared, /subscription_tier: tier/);
});

test("web Stripe subscription and credit semantics remain present", () => {
  assert.match(webSubscriptionHook, /create-checkout-session/);
  assert.match(webSubscriptionHook, /window\.location\.href = data\.url/);
  assert.match(stripeCheckout, /STRIPE_MONTHLY_PRICE_ID/);
  assert.match(stripeCheckout, /STRIPE_ANNUAL_PRICE_ID/);
  assert.match(stripeCheckout, /mode: 'subscription'/);
  assert.match(stripeWebhook, /stripe\.webhooks\.constructEvent/);
  assert.match(stripeWebhook, /STRIPE_WEBHOOK_SECRET/);
  assert.match(creditsCheckoutFunction, /mode: 'payment'/);
  assert.match(creditsCheckoutFunction, /credits_checkout_created/);
  assert.match(creditPacks, /extra_time_3/);
  assert.match(creditPacks, /priceEur: 2\.99/);
  assert.match(creditPacks, /extended_vibe_3/);
  assert.match(creditPacks, /priceEur: 4\.99/);
  assert.match(creditPacks, /bundle_3_3/);
  assert.match(creditPacks, /priceEur: 5\.99/);
});

test("RevenueCat env contract is explicit and no new names are introduced in this stream", () => {
  assert.deepEqual(
    revenueCatEnvNames(revenueCat, revenueCatWebhook, syncRevenueCatSubscriber, branchDelta).sort(),
    [
      "EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY",
      "EXPO_PUBLIC_REVENUECAT_API_KEY",
      "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY",
      "REVENUECAT_SECRET_API_KEY",
      "REVENUECAT_WEBHOOK_AUTHORIZATION",
    ],
  );
  assert.match(branchDelta, /Env var changes: none/);
});

test("native RevenueCat errors avoid raw SDK object logging", () => {
  assert.doesNotMatch(accountScreen, /console\.error\([^)]*sdk\.error/);
  assert.match(accountScreen, /\[RevenueCat\] restore purchases failed/);
  assert.match(accountScreen, /code: sdk\.errorCode \?\? 'unknown'/);
  assert.doesNotMatch(revenueCat, /console\.log\([^)]*(apiKey|secret|token|customerInfo)/i);
});

test("no pricing semantics, native modules, migrations, or expo-av were added", () => {
  assert.match(branchDelta, /Pricing\/product semantics changed: none/);
  assert.match(branchDelta, /Native module changes: none/);
  assert.match(branchDelta, /Supabase migration requirement: none/);
  assert.doesNotMatch(rootPackageJson, /"expo-av"\s*:/);
  assert.doesNotMatch(nativePackageJson, /"expo-av"\s*:/);
  assert.doesNotMatch(nativePackageJson, /"@stripe\/stripe-react-native"\s*:/);

  const nativeFiles = readTreeFiles("apps/mobile", new Set([".ts", ".tsx", ".js", ".jsx"]));
  for (const path of nativeFiles) {
    assert.doesNotMatch(
      stripComments(read(path)),
      /from ['"]expo-av['"]|require\(['"]expo-av['"]\)|import\(['"]expo-av['"]\)/,
      `${path} must not import expo-av`,
    );
  }
  assert.equal(
    readdirSync(join(root, "supabase/migrations")).some((name) =>
      name.includes("revenuecat_native_entitlement_readiness"),
    ),
    false,
    "Stream 17 should not add a Supabase migration",
  );
});

test("Streams 1-16 artifacts remain present", () => {
  for (const path of [
    "shared/matching/eventLobbyActiveEventContract.test.ts",
    "shared/matching/readyGateTransitionExpiryRowcount.test.ts",
    "shared/matching/readyGateEventEndedTerminalization.test.ts",
    "shared/matching/readyGateContractConsumerCompliance.test.ts",
    "shared/matching/readyGateTerminalUxObservability.test.ts",
    "shared/matching/nativeReadyGateParityContract.test.ts",
    "shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts",
    "shared/matching/realtimeSubscriptionTightening.test.ts",
    "shared/matching/premiumCreditsObservability.test.ts",
    "shared/matching/nativeVideoDateContractRecovery.test.ts",
    "shared/matching/onesignalProviderOperationalQa.test.ts",
    "shared/matching/bunnyProviderOperationalQa.test.ts",
    "shared/matching/dailyProviderOperationalQa.test.ts",
    "shared/matching/resendEmailProviderOperationalQa.test.ts",
    "shared/matching/twilioPhoneVerificationQa.test.ts",
    "shared/matching/nativePhysicalDeviceQaReadiness.test.ts",
    "docs/branch-deltas/fix-premium-credits-observability.md",
    "docs/branch-deltas/fix-onesignal-provider-operational-qa.md",
    "docs/branch-deltas/fix-bunny-provider-operational-qa.md",
    "docs/branch-deltas/fix-daily-provider-operational-qa.md",
    "docs/branch-deltas/fix-resend-email-provider-operational-qa.md",
    "docs/branch-deltas/fix-twilio-phone-verification-qa.md",
    "docs/branch-deltas/qa-native-physical-device-flow.md",
  ]) {
    assert.equal(exists(path), true, `${path} should remain present`);
  }
});
