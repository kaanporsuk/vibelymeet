# Phase 7 Stage 2 — RevenueCat End-to-End Validation

## Goal

Validate RevenueCat on native surfaces and close the highest-confidence entitlement and purchase-state gaps. No monetization strategy or provider change.

---

## 1. Current RevenueCat integration map (mobile)

| Layer | File(s) | Role |
|-------|---------|------|
| **SDK wrapper** | `apps/mobile/lib/revenuecat.ts` | `getRevenueCatApiKey()` (iOS/Android/generic env); `isRevenueCatConfigured()`; `initRevenueCat(apiKey?)`; `setRevenueCatUserId(userId)` → `Purchases.logIn()`; `getOfferings()` → returns `PurchasesOfferings \| null`, returns `null` when default offering has no packages or on error; `purchasePackage(pkg)` → success if `customerInfo.entitlements.active` has any; `restorePurchases()` → calls SDK, returns `{ success, error? }`. |
| **Canonical state** | `apps/mobile/lib/subscriptionApi.ts` | `useBackendSubscription(userId)` → reads `subscriptions` table (active/trialing) then fallback `profiles.is_premium`; returns `isPremium`, `plan`, `currentPeriodEnd`, `provider`, `isLoading`, `refetch`. No direct RevenueCat read; backend is source of truth. |
| **Premium screen** | `apps/mobile/app/premium.tsx` | Uses `useBackendSubscription(user?.id)` for entitlement UI; calls `initRevenueCat()` and `setRevenueCatUserId(user?.id)` in effects; fetches offerings once per `user?.id` (refetch when user is set so offerings are post–logIn); purchase → `purchasePackage` → `refetch()`; restore → `restorePurchases` → `refetch()`. Shows: loading (subscription + offerings), active entitlement card, package list, unavailable card, restore link. |
| **Backend sync** | `supabase/functions/revenuecat-webhook/index.ts` | Receives RevenueCat webhook; auth via `REVENUECAT_WEBHOOK_AUTHORIZATION`; expects `app_user_id` = Supabase user id; upserts `subscriptions` (provider `revenuecat`) for INITIAL_PURCHASE, RENEWAL, UNCANCELLATION, etc.; updates status for CANCELLATION, EXPIRATION, BILLING_ISSUE. Trigger `sync_profiles_is_premium_from_subscriptions` (per migration) keeps `profiles.is_premium` in sync. |
| **Bootstrap** | `apps/mobile/app/_layout.tsx` | Calls `initRevenueCat()` in `RootLayoutNav` effect so SDK is configured before user opens Premium. |
| **Entry points** | Settings (Premium card), Events (empty state + Happening Elsewhere), Profile (Premium chip) | Navigate to `/premium`; no RevenueCat calls at entry points. |

---

## 2. Validation checklist executed

| # | Flow | Check | Result (code/design) |
|---|------|--------|----------------------|
| 1 | Offerings fetch | RC configured → getOfferings(); no packages → null; UI shows loading then packages or unavailable | Implemented. Offerings refetched when `user?.id` is set (fix in this pass) so fetch runs after logIn. |
| 2 | Paywall / premium entry | Free user sees hero, features, packages or unavailable; active sees entitlement card | Implemented. |
| 3 | Unavailable / no-offerings | getOfferings returns null or empty packages → Premium shows “Premium isn’t available here yet” + Back | Implemented. |
| 4 | Product metadata & pricing | Package cards show `pkg.packageType`, `pkg.product.priceString`, “/month” or “/year” | Implemented. |
| 5 | Purchase attempt | handlePurchase(pkg) → purchasePackage(pkg) → success → refetch() → alert; error → setError | Implemented. |
| 6 | Restore | handleRestore → restorePurchases() → refetch(); success alert; error → setError | Implemented. Backend may lag webhook; refetch() eventually shows entitlement. |
| 7 | Entitlement in-app | After purchase/restore, refetch() updates useBackendSubscription; UI shows “You’re already Premium” when isPremium | Depends on webhook writing to `subscriptions`; mobile only refetches. |
| 8 | Backend reconciliation | revenuecat-webhook upserts `subscriptions`; trigger syncs `profiles.is_premium` | Implemented in Supabase; requires webhook URL + auth secret in RevenueCat dashboard. |
| 9 | Degraded behavior | No key / getOfferings fails / no packages → showUnavailable; no technical copy | Implemented. |

---

## 3. Fixes applied

| File | Change |
|------|--------|
| `apps/mobile/app/premium.tsx` | Offerings effect dependency set to `[user?.id]` and loading set at start of effect so offerings are fetched (and refetched) after `setRevenueCatUserId(user?.id)` runs. Ensures packages are for the logged-in user, not anonymous. |

No change to RevenueCat SDK wrapper, subscription API, or webhook logic.

---

## 4. What requires app-store / provider-side user action vs Cursor

**Cursor handled in repo:**

- Offerings refetch when user is set (so offerings are post–logIn).
- Existing behavior: purchase → refetch(); restore → refetch(); unavailable state when no offerings; backend as source of truth.

**User / provider / store (must be done outside repo):**

1. **RevenueCat dashboard**
   - Create project and link App Store Connect / Google Play.
   - Create products/entitlements and attach to offerings; set default offering.
   - Add webhook: URL `https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/revenuecat-webhook`, Authorization header = value of `REVENUECAT_WEBHOOK_AUTHORIZATION` (set in Supabase secrets).

2. **Supabase**
   - Deploy Edge Function: `supabase functions deploy revenuecat-webhook`.
   - Set secret: `REVENUECAT_WEBHOOK_AUTHORIZATION` (same as RevenueCat webhook Authorization header).
   - Ensure migration applied that adds `subscriptions.provider`, unique `(user_id, provider)`, and trigger `sync_profiles_is_premium_from_subscriptions`.

3. **App Store Connect / Google Play**
   - Create in-app subscription products and link to RevenueCat (product IDs must match what webhook’s `planFromProductId` expects for “annual”/“monthly”).
   - Complete agreements and tax/banking so sandbox/live purchases can complete.

4. **Mobile env**
   - Set `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` and/or `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` (or `EXPO_PUBLIC_REVENUECAT_API_KEY`) in `.env` / EAS secrets so `initRevenueCat()` configures the SDK.

5. **Real-device proof**
   - Run a sandbox purchase and a restore on a real device; confirm webhook fires, `subscriptions` row exists, and Premium screen shows “You’re already Premium” after refetch.

---

## 5. Final status by area

| Area | Status | Notes |
|------|--------|--------|
| **Offerings** | Implemented | Fetched after logIn; null/empty → unavailable UI. |
| **Purchase** | Implemented | purchasePackage → refetch(); success/error surfaced. |
| **Restore** | Implemented | restorePurchases → refetch(); success/error surfaced. In-app entitlement appears after webhook + refetch (may be delayed). |
| **Entitlement sync** | Backend-dependent | Webhook writes `subscriptions`; trigger syncs `profiles.is_premium`. Mobile only refetches; no client-only entitlement cache. |
| **Degraded fallback** | Implemented | No key / no offerings / error → “Premium isn’t available here yet” + Back; no technical jargon. |

---

## 6. RevenueCat release-ready for beta/store?

**Yes, for code path.** App is ready for beta/store from a RevenueCat integration standpoint provided:

- RevenueCat dashboard has products, offerings, and webhook configured.
- Supabase has `revenuecat-webhook` deployed and `REVENUECAT_WEBHOOK_AUTHORIZATION` set.
- Migrations for `subscriptions.provider` and `sync_profiles_is_premium_from_subscriptions` are applied.
- Store-side (App Store / Play) products and agreements are in place.
- End-to-end is proven once on a real device (sandbox purchase + restore, then confirm backend and UI).

---

## 7. Rebuild delta / docs update

- **Env/config:** No new env vars. Existing: `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`, `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, or `EXPO_PUBLIC_REVENUECAT_API_KEY`. Backend: `REVENUECAT_WEBHOOK_AUTHORIZATION`.
- **Assumptions:** Entitlement is canonical in backend (`subscriptions` + `profiles.is_premium`); mobile never trusts client-only entitlement; after purchase/restore, refetch() is used and webhook must run for backend (and thus UI) to update.
- **Docs:** This file is the Phase 7 Stage 2 record. If you keep a single “native validation” or “RevenueCat” runbook, add: “Phase 7 Stage 2: Premium screen offerings refetch when user is set; RevenueCat flows validated; store/webhook setup remains required.”

---

## Step-by-step for store/provider (user actions)

1. **Supabase**
   - Apply migration that adds RevenueCat columns and trigger (if not already).
   - Deploy: `supabase functions deploy revenuecat-webhook`.
   - In Supabase project settings → Edge Function secrets, set `REVENUECAT_WEBHOOK_AUTHORIZATION` to a secret string (e.g. random 32 chars).

2. **RevenueCat**
   - In project → Project settings → Integrations → Webhooks (or equivalent), add webhook URL: `https://<YOUR_SUPABASE_REF>.supabase.co/functions/v1/revenuecat-webhook`.
   - Set Authorization header to the same value as `REVENUECAT_WEBHOOK_AUTHORIZATION`.
   - Create entitlement(s) (e.g. `premium`) and offerings; attach store products; set default offering.

3. **App Store Connect / Google Play**
   - Create subscription products; note product IDs (e.g. include “annual” or “monthly” for plan detection).
   - Link app to RevenueCat; complete agreements so sandbox (and live when ready) works.

4. **Mobile**
   - In `apps/mobile/.env` or EAS secrets, set `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` and/or `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` from RevenueCat.

5. **Smoke test**
   - Build and run on device (dev client); sign in; open Premium; confirm packages or unavailable; run sandbox purchase; confirm “You’re already Premium” after refetch; run restore and confirm same.
