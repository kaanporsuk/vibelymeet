# Sprint 6 — Launch closure execution runbook

Operator runbook for executing launch closure with dashboards and real devices. Do phases in order. For each phase: Cursor can do repo/docs; Kaan does dashboard/device/store actions.

**Start here:** **`docs/kaan-launch-closure-execution-sheet.md`** (compressed order). **Stage 0:** `npm run launch:preflight` + `npm run typecheck` (repo must be green before dashboard work). **Pass/fail table:** **`docs/native-final-blocker-matrix.md`** § Sprint 6 test results. **Canonical criteria / escalation:** **`docs/native-launch-closure-master-runbook.md`**.
**Active doc map:** `docs/active-doc-map.md`

**Branch:** `feat/native-sprint6-launch-closure-execution` (**historical execution-stream provenance only**)  
**Base:** `main` (historical launch-closure base; do not treat as a required current branch-base instruction)

---

## Phase 1 — RevenueCat dashboard setup

| Role | Actions |
|------|--------|
| **Cursor** | Confirm repo: bundle ID `com.vibelymeet.vibely`, package `com.vibelymeet.vibely`; app uses `Purchases.getOfferings()` and `offerings.current.availablePackages`. Ensure checklist §2 is accurate. No code deploy. |
| **Kaan** | 1) RevenueCat dashboard: create/use project. 2) Apps: add iOS app (bundle ID `com.vibelymeet.vibely`), add Android app (package `com.vibelymeet.vibely`). 3) App Store Connect: create subscription products (e.g. monthly, annual); note product IDs. 4) Play Console: create subscription products; note product IDs. 5) RevenueCat → Products: link iOS and Android products to store product IDs. 6) RevenueCat → Entitlements: create entitlement (e.g. `premium`), attach to all products. 7) RevenueCat → Offerings: create offering (e.g. "default"), add packages (monthly, annual). 8) RevenueCat → Project Settings → API Keys: copy **public** API keys for iOS and Android. |

**Expected result:** RevenueCat project has iOS + Android apps, products linked, one entitlement, one offering with packages, public API keys available.

**Pass/fail:** Offerings in dashboard show packages; API keys copied. **Fail:** No offerings or missing keys → redo RevenueCat steps.

---

## Phase 2 — RevenueCat real-device validation

| Role | Actions |
|------|--------|
| **Cursor** | No actions in this phase (validation is on device). |
| **Kaan** | 1) Generate webhook secret: `openssl rand -hex 32`. 2) Supabase: set secret `REVENUECAT_WEBHOOK_AUTHORIZATION` to that value. 3) Deploy: `supabase functions deploy revenuecat-webhook`. 4) RevenueCat → Integrations → Webhooks: add webhook URL `https://<YOUR_SUPABASE_PROJECT_REF>.supabase.co/functions/v1/revenuecat-webhook`, Authorization header = same secret. 5) Set in `.env`: `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` (from Phase 1). 6) Set same keys in EAS secrets for the build profile you will use. 7) Build: `eas build --profile preview` for iOS (and Android if testing both). 8) Install on physical device. 9) Sign in with test Supabase user. 10) Open Premium: offerings should load (no "No offerings available"). 11) Tap a package; complete sandbox (iOS) or test (Android) purchase. 12) Check RevenueCat dashboard → Customers: events for user. 13) Check Supabase: `subscriptions` row with `provider = 'revenuecat'`, `profiles.is_premium` true. 14) Restore test: second device or reinstall, sign in → Premium → Restore; backend stays in sync. |

**Expected result:** Offerings load; sandbox/test purchase succeeds; webhook fires; `subscriptions` and `profiles.is_premium` updated; restore works.

**Pass/fail:** Purchase completes and DB + RevenueCat show the event. **Fail:** "No offerings" → check RevenueCat offering/packages. Purchase fails → check store products + RevenueCat product IDs. No webhook/DB update → check webhook URL and `REVENUECAT_WEBHOOK_AUTHORIZATION`.

---

## Phase 3 — OneSignal dashboard setup

| Role | Actions |
|------|--------|
| **Cursor** | Confirm repo: `EXPO_PUBLIC_ONESIGNAL_APP_ID` used in `lib/onesignal.ts`; app registers `mobile_onesignal_player_id` in `notification_preferences`. `app.config.js` sets production APNs for EAS preview/production. No code deploy. |
| **Kaan** | 1) OneSignal dashboard: use same project as web or create; note **App ID**. 2) Add iOS app: bundle ID `com.vibelymeet.vibely`. 3) APNs: in Apple Developer create APNs key (.p8) or certificate; upload in OneSignal iOS app settings (production for TestFlight/Store). 4) Add Android app: package name `com.vibelymeet.vibely`. 5) FCM: in Firebase/Google Cloud get FCM server key or Google Services JSON; add in OneSignal Android app settings. 6) Set `EXPO_PUBLIC_ONESIGNAL_APP_ID` in `.env` and in EAS secrets for the build profile. |

**Expected result:** OneSignal project has iOS app (APNs configured) and Android app (FCM configured); App ID set locally and in EAS.

**Pass/fail:** OneSignal dashboard shows both apps with credentials. **Fail:** Missing APNs/FCM → push will not deliver; add credentials in OneSignal.

---

## Phase 4 — OneSignal real-device validation

| Role | Actions |
|------|--------|
| **Cursor** | No actions in this phase. |
| **Kaan** | 1) Build with EAS preview (or production) so OneSignal plugin uses production APNs: `eas build --profile preview` for iOS (or use existing build from Phase 2). 2) Install on physical device; sign in. 3) Grant notification permission when app prompts. 4) Supabase: in `notification_preferences` for your user, confirm `mobile_onesignal_player_id` is set and `mobile_onesignal_subscribed = true`. 5) OneSignal dashboard → Messages: send a test notification to that user (or by player ID). 6) Device should receive the notification. 7) Optional: sign out; confirm app called logout (subscription no longer tied to user). |

**Expected result:** Row in `notification_preferences` with player ID; test message received on device.

**Pass/fail:** Test notification received. **Fail:** No player ID in DB → check app init and `registerPushWithBackend`. No delivery → check OneSignal APNs/FCM and app credentials.

---

## Phase 5 — EAS preview build

| Role | Actions |
|------|--------|
| **Cursor** | Ensure `eas.json` has `preview` profile (distribution: internal, environment: preview). Ensure `app.config.js` sets OneSignal mode production for preview. Doc: list required EAS secrets for preview. No Supabase deploy. |
| **Kaan** | 1) EAS secrets for profile `preview`: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `EXPO_PUBLIC_SUPABASE_ANON_KEY`), `EXPO_PUBLIC_ONESIGNAL_APP_ID`, `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`. Optional: `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME`, `EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME`. 2) Run: `eas build --profile preview --platform ios` (then `--platform android` if needed). 3) Wait for build; download or install via link. |

**Expected result:** Preview build completes; artifact available for internal install.

**Pass/fail:** Build succeeds and installs. **Fail:** Credentials/env error → set missing EAS secrets. Build error → check EAS logs; repo config is already validated.

---

## Phase 6 — EAS production-style build

| Role | Actions |
|------|--------|
| **Cursor** | Ensure `production` profile exists (distribution: store, environment: production). OneSignal mode production for production profile (already in `app.config.js`). No code change. |
| **Kaan** | 1) EAS secrets for profile `production`: same as preview (Supabase, OneSignal, RevenueCat, optional Bunny). 2) Run: `eas build --profile production --platform all` (or ios/android separately). 3) Build produces store-ready artifacts. 4) Submit: `eas submit` or EAS dashboard to upload to TestFlight / Play internal track. |

**Expected result:** Production build completes; can be submitted to stores.

**Pass/fail:** Build succeeds. **Fail:** Same as Phase 5; ensure production profile has same secrets.

---

## Phase 7 — iOS/Android device validation checklist

| Role | Actions |
|------|--------|
| **Cursor** | Provide checklist doc; no device actions. |
| **Kaan** | On **iOS device**: [ ] Install preview or production build. [ ] Sign in. [ ] Grant notification permission. [ ] Open Premium → offerings load → sandbox purchase succeeds. [ ] Check Supabase `subscriptions` + `profiles.is_premium`. [ ] Restore on same or second device works. [ ] Receive test push from OneSignal. [ ] Core flows: auth, events, matches, chat, profile (photo/vibe video), settings, credits. On **Android device**: same checklist. [ ] Optional: verify Deep links / scheme if configured. |

**Expected result:** All items pass on at least one iOS and one Android device.

**Pass/fail:** Checklist completed; any failure logged in blocker matrix with exact step and blocker.

---

## Phase 8 — Final blocker matrix update

| Role | Actions |
|------|--------|
| **Cursor** | After Kaan reports results: update `docs/native-final-blocker-matrix.md` with: blockers solved by Cursor (none in this sprint beyond docs); blockers requiring Kaan (dashboard/store/device) with status; blockers requiring build/test evidence (mark resolved or still open with reason). Add "Sprint 6 test results" section if Kaan provides pass/fail per phase. |
| **Kaan** | Report pass/fail for Phases 2, 4, 7 (and build success for 5, 6). Share any blocker (e.g. "RevenueCat webhook 401") so Cursor can doc the fix. |

**Expected result:** Blocker matrix reflects actual test results and remaining blockers.

**Pass/fail:** Matrix updated; remaining blockers clearly listed with owner (Kaan vs Cursor vs needs evidence).

---

## Quick reference — IDs and URLs

| Item | Value (from repo) |
|------|-------------------|
| iOS bundle ID | `com.vibelymeet.vibely` |
| Android package | `com.vibelymeet.vibely` |
| EAS project ID | `5c6f619c-3eea-4cbc-82f8-52b3875e0bf9` (app.json extra.eas.projectId) |
| RevenueCat webhook URL | `https://<YOUR_SUPABASE_PROJECT_REF>.supabase.co/functions/v1/revenuecat-webhook` |
| OneSignal NSE bundle ID | `com.vibelymeet.vibely.OneSignalNotificationServiceExtension` |

Replace `<YOUR_SUPABASE_PROJECT_REF>` with your project ref (from `EXPO_PUBLIC_SUPABASE_URL`).

---

## Config readiness check (before Phase 1)

Verify from repo before starting dashboard/build work:

| Check | Source | Status |
|-------|--------|--------|
| **iOS bundle ID** | `app.json` → `expo.ios.bundleIdentifier` | `com.vibelymeet.vibely` |
| **Android package** | `app.json` → `expo.android.package` | `com.vibelymeet.vibely` |
| **EAS project ID** | `app.json` → `expo.extra.eas.projectId` | `5c6f619c-3eea-4cbc-82f8-52b3875e0bf9` |
| **OneSignal plugin** | `app.config.js` | Mode = production for `preview`/`production`; development otherwise. |
| **RevenueCat keys** | `lib/revenuecat.ts` | Reads `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, `_ANDROID_`, or `EXPO_PUBLIC_REVENUECAT_API_KEY`. |
| **Required env (local)** | `apps/mobile/.env.example` | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; for push: `EXPO_PUBLIC_ONESIGNAL_APP_ID`; for IAP: RevenueCat keys. |
| **Required EAS secrets** | For `preview`/`production` | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or ANON_KEY), `EXPO_PUBLIC_ONESIGNAL_APP_ID`, `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`. Optional: Bunny hostnames. |

**Missing before builds:** Nothing in repo. Kaan must set EAS secrets and complete RevenueCat/OneSignal dashboard setup before `eas build` will have working push and IAP. Supabase migrations and `revenuecat-webhook` deploy are required for backend sync (see checklist §1, §2.2).
