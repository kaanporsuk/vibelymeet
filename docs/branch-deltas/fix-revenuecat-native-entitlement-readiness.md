# RevenueCat Native Entitlement Readiness

Branch: `fix/revenuecat-native-entitlement-readiness`

## Problem

Stream 17 verifies that native Premium entitlement readiness is aligned with the existing web Stripe model without changing pricing, product semantics, checkout semantics, or provider ownership. The risk is a split-brain entitlement model: native purchases can succeed in RevenueCat while web Stripe, `subscriptions`, credits, and profile tier reads drift.

## Why This Follows Streams 1-16

Streams 1-8 hardened lobby, Ready Gate, swipe, and realtime contracts. Stream 9 hardened Stripe payment observability and duplicate safety. Streams 10-16 verified native video-date, OneSignal, Bunny, Daily, Resend, Twilio, and physical-device QA contracts. Stream 17 closes the remaining native monetization readiness gap: RevenueCat native subscription code must reconcile into the same backend entitlement truth as web Stripe.

## RevenueCat Status: Implemented

RevenueCat is already part of the installed native stack:

- `apps/mobile/package.json` includes `react-native-purchases`.
- `apps/mobile/lib/revenuecat.ts` wraps `Purchases.configure`, `Purchases.logIn`, offerings, purchase, and restore.
- `apps/mobile/app/_layout.tsx` initializes RevenueCat and binds the RevenueCat app user id to the Supabase auth user id.
- `apps/mobile/app/premium.tsx` uses RevenueCat offerings and packages for native Premium purchases.
- `supabase/functions/revenuecat-webhook/index.ts` receives provider events and reconciles to backend `subscriptions`.
- `supabase/functions/sync-revenuecat-subscriber/index.ts` lets authenticated native clients pull RevenueCat subscriber state after restore.

## Files Audited

- `apps/mobile/package.json`
- `apps/mobile/app/_layout.tsx`
- `apps/mobile/app/premium.tsx`
- `apps/mobile/app/settings/account.tsx`
- `apps/mobile/app/settings/credits.tsx`
- `apps/mobile/hooks/useEntitlements.ts`
- `apps/mobile/lib/revenuecat.ts`
- `apps/mobile/lib/subscriptionApi.ts`
- `apps/mobile/lib/syncRevenueCatSubscriber.ts`
- `apps/mobile/lib/creditsCheckout.ts`
- `src/hooks/useSubscription.ts`
- `src/hooks/usePremium.ts`
- `src/hooks/useCredits.ts`
- `src/hooks/useVisibleEvents.ts`
- `supabase/config.toml`
- `supabase/functions/revenuecat-webhook/index.ts`
- `supabase/functions/sync-revenuecat-subscriber/index.ts`
- `supabase/functions/_shared/revenuecatSubscription.ts`
- `supabase/functions/create-checkout-session/index.ts`
- `supabase/functions/create-credits-checkout/index.ts`
- `supabase/functions/stripe-webhook/index.ts`
- `supabase/functions/_shared/creditPacks.ts`
- RevenueCat and Stripe provider docs:
  - `docs/phase7-stage2-revenuecat-validation.md`
  - `docs/entitlements-migration-guide.md`
  - `docs/native-deployment-validation-sequence.md`
  - `docs/branch-deltas/fix-premium-credits-observability.md`
  - `_cursor_context/vibely_stripe_provider_sheet.md`

## Native Entitlement Source Of Truth

Native entitlement UI reads backend truth, not client-only RevenueCat state:

- `apps/mobile/lib/subscriptionApi.ts` reads active/trialing rows from `subscriptions`.
- If no active billable subscription row exists, it falls back to `profiles.is_premium` for admin/sync grants.
- `apps/mobile/hooks/useEntitlements.ts` reads `profiles.subscription_tier` and `tier_config_overrides`.
- Credits read from `user_credits`.

RevenueCat SDK state is used to initiate purchase/restore and to get restore customer info, but Premium entitlement display is still backend-owned.

## Purchase Readiness

Purchases are implemented for Premium subscriptions:

- Native Premium screen calls `getOfferings()`.
- Package cards use RevenueCat package metadata and `pkg.product.priceString`.
- Purchase calls `purchasePackage(pkg)`.
- Restore calls `restorePurchasesWithCustomerInfo()`.
- Restore also calls `syncRevenueCatSubscriberFromServer()` so backend can reconcile without waiting only on webhook delivery.

Purchase readiness is code-ready, but production/sandbox proof still depends on provider setup and real-device testing. No real purchases were run in this stream.

## Stripe Relationship

Web Stripe semantics are preserved:

- Web Premium still uses `src/hooks/useSubscription.ts` and `create-checkout-session`.
- `create-checkout-session` still uses `STRIPE_MONTHLY_PRICE_ID` / `STRIPE_ANNUAL_PRICE_ID`.
- `stripe-webhook` still verifies the Stripe signature and settles subscription/credit/event-ticket state.
- Credit pack pricing remains in `supabase/functions/_shared/creditPacks.ts`.

Native Premium does not use Stripe checkout as native IAP. Credits remain Stripe browser checkout through `create-credits-checkout`, intentionally matching the existing web credit-pack contract. Event ticket checkout remains Stripe-owned and out of RevenueCat scope.

## Backend RevenueCat Contract

- `revenuecat-webhook` has `verify_jwt = false` because RevenueCat dashboard calls it directly.
- It requires `REVENUECAT_WEBHOOK_AUTHORIZATION`.
- It expects RevenueCat `app_user_id` / `original_app_user_id` to be the Supabase auth user id.
- Purchase/renewal/uncancel/product-change events upsert `subscriptions` with `provider = 'revenuecat'`.
- Cancellation/expiration/billing issue events downgrade the RevenueCat subscription row.
- Shared helper updates `profiles.subscription_tier`; database triggers keep `profiles.is_premium` aligned with active subscription truth.
- `sync-revenuecat-subscriber` has `verify_jwt = true`, authenticates the caller, reads `REVENUECAT_SECRET_API_KEY`, and pulls `/v1/subscribers/{user.id}` server-side.

## Supabase Read-Only Posture Check

Read-only commands run:

- `supabase projects list`
- `supabase functions list --project-ref schdyxcunwcvddlcshwd`
- `supabase secrets list --project-ref schdyxcunwcvddlcshwd`

Results:

- Linked project: `schdyxcunwcvddlcshwd / MVP_Vibe`.
- `revenuecat-webhook`: ACTIVE.
- `sync-revenuecat-subscriber`: ACTIVE.
- Backend RevenueCat secret names visible without values:
  - `REVENUECAT_WEBHOOK_AUTHORIZATION`
  - `REVENUECAT_SECRET_API_KEY`
- Stripe secret and price-id names remain present in the same project.

The CLI showed secret names and digests only. No secret values were printed.

## Code Fixes Made

- `apps/mobile/app/settings/account.tsx`
  - Replaced raw RevenueCat restore error object logging with a dev-only non-secret error-code log.
  - Product behavior and user-facing restore errors are unchanged.

## Tests Added

- `shared/matching/revenueCatNativeEntitlementReadiness.test.ts`

Coverage includes:

- native entitlement posture is documented
- RevenueCat dependency and SDK wrapper remain present
- native Premium uses RevenueCat rather than Stripe checkout
- native credits remain intentionally Stripe browser checkout
- backend `subscriptions`, `profiles.is_premium`, `subscription_tier`, and `user_credits` reads remain present
- RevenueCat webhook and server sync reconcile into backend entitlements
- web Stripe subscription and credit semantics remain present
- RevenueCat env names remain the existing known names
- raw RevenueCat SDK restore error object logging is avoided
- no pricing semantics, native module, migration, or `expo-av` changes
- Streams 1-16 artifacts remain present

## Manual RevenueCat Provider-Dashboard Checklist

1. Confirm the RevenueCat project is the production Vibely project.
2. Confirm iOS and Android apps are linked to the correct App Store Connect and Google Play apps.
3. Confirm subscription product IDs exist in the stores and are linked to RevenueCat products.
4. Confirm product IDs encode or map cleanly to monthly/annual/vip expectations used by `planFromProductId` and `profileTierFromProductId`.
5. Confirm entitlement identifiers include `premium` and/or `vip` as intended.
6. Confirm the default offering has available packages for production and sandbox.
7. Confirm public mobile SDK keys are set in EAS/build env:
   - `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`
   - `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`
   - or fallback `EXPO_PUBLIC_REVENUECAT_API_KEY`
8. Confirm the RevenueCat webhook URL points to:
   - `https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/revenuecat-webhook`
9. Confirm the RevenueCat webhook Authorization header matches Supabase secret `REVENUECAT_WEBHOOK_AUTHORIZATION`.
10. Confirm Supabase secret `REVENUECAT_SECRET_API_KEY` is the RevenueCat secret API key used by server-side subscriber sync.
11. Run controlled real-device sandbox purchase with an internal test account.
12. Confirm webhook delivery creates/updates the `subscriptions` row with `provider = 'revenuecat'`.
13. Confirm `profiles.is_premium` and `profiles.subscription_tier` reflect the active entitlement.
14. Confirm restore calls update backend state through `sync-revenuecat-subscriber`.
15. Confirm web Stripe subscription checkout still settles through `stripe-webhook`.
16. Confirm native credit packs still open Stripe checkout in browser and settle `user_credits`.

## Remaining Blockers / Deferred Work

- Controlled real-device RevenueCat sandbox purchase.
- Controlled real-device restore flow.
- RevenueCat dashboard offering/product review.
- Store product/agreement review in App Store Connect and Google Play.
- EAS/build env verification for public RevenueCat SDK keys.
- Web Stripe dashboard verification remains governed by Stream 9 provider checklist.

## Deployment Requirements

- Supabase migration requirement: none.
- Edge Function deploy requirement: none, because no Edge Function changed.
- Supabase DB deploy: not required and not run.
- Supabase Edge Function deploy: not required and not run.
- EAS/native binary build: not run. No new native module was added.
- Web/static deploy: normal host deployment after merge is enough for the changed docs/test; native code change ships with the next native build.

## Safety Confirmations

- Env var changes: none.
- Native module changes: none.
- Pricing/product semantics changed: none.
- Web Stripe semantics changed: none.
- Real purchases run: none.
- Docker used: no.
- Local Supabase used: no.
- Supabase DB push run: no.
- Edge Functions deployed: no.
- `expo-av` import or package added: no.
