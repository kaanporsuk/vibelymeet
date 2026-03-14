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

Premium is a hard blocker for native launch.

**App-side code status:** Ready. App initializes RevenueCat with platform key (`EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` / `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` or fallback `EXPO_PUBLIC_REVENUECAT_API_KEY`), calls `Purchases.logIn(userId)` with Supabase user id, fetches offerings, purchases packages, restores purchases; backend sync via `revenuecat-webhook` Edge Function. No code changes required.

**Env required:** In `.env` and in EAS secrets for the build profile: at least one of `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`, or `EXPO_PUBLIC_REVENUECAT_API_KEY`. Prefer platform-specific keys for each EAS profile.

The following must be done in RevenueCat and Supabase before TestFlight/Play or production IAP.

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

## 3. OneSignal (Kaan: dashboard and device setup)

App code is ready: init, request permission, login(userId), get subscription ID, upsert `notification_preferences` with `mobile_onesignal_player_id` and `mobile_onesignal_subscribed`. Backend `send-notification` targets this device when delivering to `user_id`. No further code changes required.

### 3.1 Env and config

| Item | Notes |
|------|--------|
| `EXPO_PUBLIC_ONESIGNAL_APP_ID` | OneSignal App ID (same project as web). Required for push. Set in `.env` and in EAS secrets for the build profile. |
| OneSignal plugin mode | `app.config.js` sets APNs mode: **production** for EAS `preview` and `production` builds (TestFlight/Store); **development** for local/dev. Do not override unless you know the impact. |

### 3.2 OneSignal dashboard (iOS)

- [ ] **OneSignal project:** Use same project as web or create; note App ID.
- [ ] **iOS app:** Add iOS app in OneSignal; bundle ID must match `com.vibelymeet.vibely` (from app.json).
- [ ] **APNs:** Upload APNs key (.p8) or certificate. For TestFlight/Store use **production** APNs; for dev use **development**. OneSignal docs describe how to add key in Apple Developer and in OneSignal.

### 3.3 OneSignal dashboard (Android)

- [ ] **Android app:** Add Android app in OneSignal; package name must match `com.vibelymeet.vibely`.
- [ ] **FCM:** Add FCM server key or Firebase config (Google Services JSON) in OneSignal so OneSignal can send to FCM.

### 3.4 Exact real-device validation steps (push)

1. **Build:** Use EAS `preview` or `production` for iOS so OneSignal plugin uses production APNs (or use dev build and expect dev APNs).
2. **Install** on a physical device; sign in with a test user.
3. **Grant notification permission** when the app prompts (or in Settings).
4. **Verify backend:** In Supabase `notification_preferences`, confirm a row for the user with `mobile_onesignal_player_id` non-null and `mobile_onesignal_subscribed = true`.
5. **Send test:** In OneSignal dashboard → Messages, send a test notification to that user (or by player ID). Device should receive it.
6. **Sign out:** Sign out in app; optionally verify in OneSignal that the subscription is no longer tied to that user (app calls `OneSignal.logout()`).

---

## 4. Daily

- [ ] Web already uses Daily domain and API key; same project supports mobile.
- [ ] No separate mobile-only Daily setup required for same backend `daily-room` and domain.
- [ ] Optional: confirm Daily dashboard has correct domain and API key for production.

---

## 5. Expo / EAS (for TestFlight / Play internal)

**Config readiness (Sprint 6):** Bundle ID and package are `com.vibelymeet.vibely` (app.json). OneSignal mode is set by `app.config.js` from `EAS_BUILD_PROFILE` (production for preview/production). No repo config is missing for builds; EAS secrets and provider dashboards must be completed by Kaan before builds will have working push and IAP.

- [ ] EAS project linked: `eas init` or existing project (`app.json` → `extra.eas.projectId`).
- [ ] `eas.json` build profiles: **development** (dev client, internal), **preview** (internal distribution), **production** (store). Use `preview` or `production` for real-device push/IAP validation so OneSignal uses production APNs.
- [ ] Credentials: iOS (distribution cert, provisioning profile), Android (keystore). EAS can manage these via `eas credentials`.
- [ ] **EAS secrets** (set per profile or globally): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (or `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`), `EXPO_PUBLIC_ONESIGNAL_APP_ID`, `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` (or `EXPO_PUBLIC_REVENUECAT_API_KEY`). Optional: `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME`, `EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME` for media.

### 5.1 Production-style build validation prep (Kaan)

| Goal | What to do |
|------|------------|
| **Local iOS** | `npx expo prebuild` then open `ios/` in Xcode; build and run on simulator or device. Or use `eas build --profile development` and install the dev client. Native modules (Daily, RevenueCat, OneSignal) require a dev client or custom build—Expo Go is not sufficient. |
| **Local Android** | `npx expo prebuild` then run `android/` in Android Studio, or `eas build --profile development` and install the built APK. |
| **EAS iOS (TestFlight-style)** | `eas build --profile preview` or `--profile production` for iOS. Ensure EAS secrets are set for that profile. OneSignal plugin will use production APNs for preview/production (see §3). Upload to TestFlight via `eas submit` or EAS dashboard. |
| **EAS Android (internal track)** | `eas build --profile preview` or `--profile production` for Android. Set Android secrets. Upload to Play internal testing track. |
| **Missing config** | All required permissions and plugins are in `app.json` / `app.config.js`: camera, mic, photo library, notifications, OneSignal NSE (iOS). No known build blockers from repo; any failure is likely credentials or env. |

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
