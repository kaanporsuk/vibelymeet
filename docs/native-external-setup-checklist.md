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

## 2. RevenueCat

- [ ] Create or use existing RevenueCat project.
- [ ] Add iOS app (bundle ID matches Expo app).
- [ ] Add Android app (package name matches Expo app).
- [ ] Create products in App Store Connect / Play Console and link in RevenueCat (product IDs, e.g. monthly/annual).
- [ ] Create entitlement(s) (e.g. `premium`) and attach to products.
- [ ] Create offering(s) and packages (e.g. monthly, annual).
- [ ] In RevenueCat dashboard → Integrations → Webhooks: add webhook URL  
  `https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/revenuecat-webhook`
- [ ] Set Authorization header to the **same value** as `REVENUECAT_WEBHOOK_AUTHORIZATION` (e.g. `Bearer <secret>` or just `<secret>` per RevenueCat docs).
- [ ] Copy **public** API keys (iOS and/or Android) for use in mobile app as `EXPO_PUBLIC_REVENUECAT_API_KEY` (or separate keys per platform if you prefer).

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
- [ ] Env vars / secrets in EAS: set `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_ONESIGNAL_APP_ID`, `EXPO_PUBLIC_REVENUECAT_API_KEY`, and optionally `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME` for the appropriate profile.

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
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Required | Set in EAS secrets |
| `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME` | Optional | Optional |
| `EXPO_PUBLIC_ONESIGNAL_APP_ID` | Required for push | Set in EAS secrets |
| `EXPO_PUBLIC_REVENUECAT_API_KEY` | Required for IAP UI | Set in EAS secrets |

### Supabase Edge Functions (already used by web)

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_*`, `STRIPE_WEBHOOK_SECRET`, etc.
- **New:** `REVENUECAT_WEBHOOK_AUTHORIZATION` for `revenuecat-webhook`.

---

Do not commit real API keys or secrets. Use `.env` locally and EAS/Supabase secrets for builds and serverless.
