# Native External Setup Checklist

Exact checklist for external provider and store setup required before TestFlight / Play internal testing and production. Use placeholders for secret values; do not commit real secrets.

---

## 1. Supabase

### Migrations to apply

- [ ] `20260311200000_notification_preferences_mobile_player.sql` — adds `mobile_onesignal_player_id`, `mobile_onesignal_subscribed` to `notification_preferences`.
- [ ] `20260312000000_subscriptions_provider_revenuecat.sql` — adds `subscriptions.provider`, unique `(user_id, provider)`, trigger for `profiles.is_premium`, RPCs, RevenueCat columns.

**How:** `supabase db push` (linked project) or run the migration SQL files in order against the target project.

### Edge Functions to deploy

- [ ] Deploy/update all existing functions (e.g. `send-notification` already updated for multi-device; `stripe-webhook`, `create-checkout-session`, `create-portal-session`, `create-credits-checkout` with provider filter).
- [ ] Deploy **revenuecat-webhook** (new): `supabase functions deploy revenuecat-webhook`.

### Required Supabase secrets

| Secret | Used by | Notes |
|--------|--------|------|
| `SUPABASE_URL` | All functions | Project URL (already set). |
| `SUPABASE_SERVICE_ROLE_KEY` | All functions | Already set. |
| `STRIPE_SECRET_KEY` | stripe-webhook, create-checkout-session, etc. | Already set. |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook | Already set. |
| `REVENUECAT_WEBHOOK_AUTHORIZATION` | revenuecat-webhook | Set to a shared secret; configure the **same value** as the Authorization header in RevenueCat dashboard webhook. Use a long random string (e.g. `openssl rand -hex 32`). |

---

## 2. RevenueCat (Kaan: exact dashboard actions)

Premium is a hard blocker for native launch. App code is ready (offerings, purchase, restore, backend sync via revenuecat-webhook). The following must be done in RevenueCat and Supabase before TestFlight/Play or production IAP.

### 2.1 RevenueCat dashboard

- [ ] **Project:** Create or use existing RevenueCat project.
- [ ] **Apps:** Add iOS app (bundle ID must match Expo `app.json` / EAS). Add Android app (package name must match).
- [ ] **Products:** In App Store Connect create In-App Purchase subscription products (e.g. monthly, annual). In Play Console create subscription products. In RevenueCat → Products, link these (product IDs must match).
- [ ] **Entitlements:** Create entitlement (e.g. `premium`) and attach to the products.
- [ ] **Offerings:** Create at least one Offering (e.g. "default"); add packages (monthly, annual) to that offering. The app calls `Purchases.getOfferings()` and uses `offerings.current.availablePackages`; if empty, the premium screen shows "No offerings available."
- [ ] **Webhook:** RevenueCat dashboard → Integrations → Webhooks. Add webhook:
  - URL: `https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/revenuecat-webhook`
  - Authorization header: set to the **exact same** value as the Supabase secret `REVENUECAT_WEBHOOK_AUTHORIZATION` (e.g. generate with `openssl rand -hex 32` and use that string, or `Bearer <token>` per RevenueCat docs).
- [ ] **Public API keys:** In RevenueCat → Project Settings → API Keys, copy the **public** API keys (not secret). Set in mobile: `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`, or a single `EXPO_PUBLIC_REVENUECAT_API_KEY` for both. These go in `.env` locally and in EAS secrets for builds.

### 2.2 Supabase (required for RevenueCat sync)

- [ ] Deploy Edge Function: `supabase functions deploy revenuecat-webhook`.
- [ ] Set secret: `REVENUECAT_WEBHOOK_AUTHORIZATION` to the same value configured as the Authorization header in the RevenueCat webhook.
- [ ] Migrations applied so `subscriptions` has `provider` and trigger updates `profiles.is_premium` (see §1).

### 2.3 App-side

No code changes required. The app already: initializes RevenueCat with the API key, calls `Purchases.logIn(userId)` with Supabase user id so webhook receives `app_user_id`, fetches offerings, purchases packages, restores purchases, and refetches backend subscription state after purchase/restore.

### 2.4 RevenueCat real-device closure prep (Kaan)

Checklist for closing IAP on real devices before TestFlight/Play or production. Do not change working purchase code unless a real issue is found.

#### iOS

- [ ] **App Store Connect:** In-App Purchase subscription products created and approved (e.g. `monthly_premium`, `annual_premium`). Product IDs must match exactly what the app expects (check `apps/mobile` premium screen / RevenueCat packages).
- [ ] **RevenueCat → Products:** iOS products linked to App Store Connect product IDs.
- [ ] **Sandbox:** Use a Sandbox Apple ID (App Store Connect → Users and Access → Sandbox testers) for testing. On device: Settings → App Store → Sandbox Account. Expect "Environment: Sandbox" in RevenueCat debug logs.
- [ ] **Env / EAS:** `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` set in `.env` (local) and in EAS secrets for the build profile used for the device build.

#### Android

- [ ] **Play Console:** Subscription products created and active (e.g. same product IDs as iOS or app-specific). License testing: add testers in Play Console if needed.
- [ ] **RevenueCat → Products:** Android products linked to Play Console product IDs.
- [ ] **Env / EAS:** `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` set in `.env` and in EAS secrets for the build profile.

#### Entitlements and offerings

- [ ] **Entitlement:** One entitlement (e.g. `premium`) created in RevenueCat and attached to all subscription products.
- [ ] **Offering:** At least one Offering (e.g. "default") with packages (monthly, annual). App uses `offerings.current.availablePackages`; empty offerings show "No offerings available" in UI.

#### Webhook auth

- [ ] **Supabase secret:** `REVENUECAT_WEBHOOK_AUTHORIZATION` set (e.g. `openssl rand -hex 32`). Same value in RevenueCat webhook Authorization header.
- [ ] **Webhook URL:** `https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/revenuecat-webhook`. RevenueCat must deliver events (initial purchase, renewal, cancellation) so backend can keep `subscriptions` and `profiles.is_premium` in sync.

#### Test accounts and sandbox expectations

- [ ] **Sandbox (iOS):** Purchases do not charge real money; renewals are accelerated. Use Sandbox Apple ID only for IAP testing.
- [ ] **Test (Android):** License testers in Play Console can make test purchases without being charged.
- [ ] **Backend:** After a sandbox/test purchase, verify in Supabase: `subscriptions` row for the user with `provider = 'revenuecat'` and correct status; `profiles.is_premium` true if entitlement is active.

#### Exact real-device validation steps

1. **Build:** `eas build --profile preview` (or development) for iOS and Android; install on physical device (simulator/emulator IAP behavior can differ).
2. **Auth:** Sign in with a test Supabase user (same one you will use to check `subscriptions` in DB).
3. **Premium screen:** Open app → Premium. Expect offerings to load (no "No offerings available" unless dashboard is misconfigured).
4. **Purchase:** Tap a package; complete sandbox/test purchase. Expect success and return to app; premium state should unlock (e.g. backend `is_premium` true, or in-app paywall dismissed).
5. **Webhook:** In RevenueCat dashboard → Customers, select the test user; confirm events. In Supabase `subscriptions` and `profiles`, confirm row/columns updated.
6. **Restore:** On a second device or after reinstall, sign in with same user → Premium → Restore. Expect entitlements to restore and backend to stay in sync.

---

## 3. OneSignal

- [ ] Web app already configured; ensure same OneSignal project or linked app for mobile.
- [ ] Add iOS app in OneSignal (bundle ID, APNs key/certificate).
- [ ] Add Android app in OneSignal (FCM/server key or Firebase config).
- [ ] No repo code changes required; mobile already sends `mobile_onesignal_player_id` to backend and `send-notification` includes it in `include_player_ids`.

---

## 4. Daily

- [ ] Web already uses Daily domain and API key; same project supports mobile.
- [ ] No separate mobile-only Daily setup required for same backend `daily-room` and domain.
- [ ] Optional: confirm Daily dashboard has correct domain and API key for production.

---

## 5. Expo / EAS (for TestFlight / Play internal)

- [ ] EAS project linked: `eas init` or existing project.
- [ ] `eas.json` build profiles (e.g. development, preview, production).
- [ ] Credentials: iOS (distribution cert, provisioning profile), Android (keystore). EAS can manage these.
- [ ] Env vars / secrets in EAS: set `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_ONESIGNAL_APP_ID`, RevenueCat keys (`EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`, or `EXPO_PUBLIC_REVENUECAT_API_KEY`), and optionally `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME` for the appropriate profile.

---

## 6. iOS App Store Connect

- [ ] App record created (bundle ID matches Expo/RevenueCat).
- [ ] In-App Purchases created and approved (subscription products).
- [ ] Signing and capabilities (push, etc.) configured via EAS or Xcode.
- [ ] TestFlight: upload build via EAS or Xcode; add internal testers.

---

## 7. Android Play Console

- [ ] App created (package name matches Expo/RevenueCat).
- [ ] In-app products / subscriptions created and active.
- [ ] Signing key (EAS or upload key) configured.
- [ ] Internal testing track: upload build; add testers.

---

## 8. Required env vars by environment

### Mobile app (Expo)

| Variable | Local dev | EAS preview/production |
|----------|-----------|-------------------------|
| `EXPO_PUBLIC_SUPABASE_URL` | Required (e.g. `.env`) | Set in EAS secrets |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Required (preferred) | Set in EAS secrets |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Legacy fallback only | Set in EAS secrets (optional) |
| `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME` | Optional | Optional |
| `EXPO_PUBLIC_ONESIGNAL_APP_ID` | Required for push | Set in EAS secrets |
| `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` | Preferred for iOS IAP | Set in EAS secrets |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` | Preferred for Android IAP | Set in EAS secrets |
| `EXPO_PUBLIC_REVENUECAT_API_KEY` | Fallback for both if platform keys unset | Set in EAS secrets |

### Supabase Edge Functions (already used by web)

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_*`, `STRIPE_WEBHOOK_SECRET`, etc.
- **New:** `REVENUECAT_WEBHOOK_AUTHORIZATION` for `revenuecat-webhook`.

---

Do not commit real API keys or secrets. Use `.env` locally and EAS/Supabase secrets for builds and serverless.
