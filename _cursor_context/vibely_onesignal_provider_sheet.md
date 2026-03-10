# VIBELY — ONESIGNAL PROVIDER SHEET

**Date:** 2026-03-10  
**Baseline:** pre-native-hardening frozen baseline  
**Priority:** Tier 2 / notification-critical

---

## 1. Purpose

This sheet is the provider-specific operating reference for OneSignal.

It is meant to answer:
- what OneSignal does in Vibely
- how push identity is established in the frontend
- how push delivery is triggered in backend functions
- where OneSignal fits relative to Vibely’s own notification/service-worker layer
- what is hardcoded vs env-driven
- what dashboard/webhook/origin state must exist outside the repo
- what can silently fail during rebuild even when the app still boots

This sheet is more detailed than the general External Dependency Ledger.

---

## 2. Why OneSignal matters

OneSignal is the main **remote push delivery provider** in the frozen baseline.

It powers:
- browser push subscription identity
- push delivery to individual users via `onesignal_player_id`
- OneSignal login/logout binding to the Vibely user ID
- push open/click deep-link handling in the browser

But Vibely also has its own browser notification layer, so OneSignal is only part of the full notification story.

A rebuild can therefore fail in multiple ways:
- OneSignal SDK loads but user identity never syncs
- permission is granted but `onesignal_player_id` never gets written to Supabase
- backend sends appear successful but the wrong OneSignal app is targeted
- push opens/clicks do not route correctly
- notification telemetry tables stay incomplete because send and receipt paths are not tightly coupled
- local/service-worker reminders still work, creating false confidence while remote push is broken

---

## 3. Important architecture distinction: Vibely has **two** notification layers

This is the single most important OneSignal-related clarification.

## Layer A — Remote push via OneSignal
Used for:
- user-targeted push sends from backend logic
- browser permission-driven device subscription
- OneSignal external-user binding
- notification click deep linking

## Layer B — App-owned browser/service-worker notifications
Used for:
- local/scheduled reminders
- service-worker-driven browser notifications
- fallback or product-specific local notification flows

### Repo surfaces proving Layer B exists
- `public/sw.js`
- `src/hooks/useServiceWorker.ts`
- `src/hooks/usePushNotifications.ts`
- `src/hooks/useEventReminders.ts`

### Why this matters
A rebuild can have working local notifications while OneSignal remote push is broken.
Do not treat “browser notifications work” as proof that OneSignal is healthy.

---

## 4. Repo surfaces that touch OneSignal

## Frontend SDK / identity layer
- `index.html` loads `https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js`
- `src/lib/onesignal.ts`
- `src/main.tsx`
- `src/contexts/AuthContext.tsx`
- `src/components/PushPermissionPrompt.tsx`
- `src/components/settings/NotificationsDrawer.tsx`
- `src/hooks/useNotificationPreferences.ts`

## Backend / delivery / telemetry layer
- `supabase/functions/send-notification`
- `supabase/functions/push-webhook`
- `supabase/functions/vibe-notification`
- admin push analytics/monitoring surfaces

## Database surfaces
- `notification_preferences`
- `notification_log`
- `push_campaigns`
- `push_notification_events`
- `push_notification_events_admin`

---

## 5. OneSignal config surface

## Frontend hardcoded config
`src/lib/onesignal.ts` hardcodes:
- `ONESIGNAL_APP_ID = "97e52ea2-6a27-4486-a678-4dd8a0d49e94"`

This is **not** read from Vite env in the frozen baseline.

## Backend env config
Functions expect:
- `ONESIGNAL_APP_ID`
- `ONESIGNAL_REST_API_KEY`

### Where backend uses them
`send-notification` uses:
- `ONESIGNAL_APP_ID`
- `ONESIGNAL_REST_API_KEY`

### Important implication
The system has two sources of truth for the OneSignal app:
- hardcoded frontend app ID
- backend env app ID

They must point to the **same** OneSignal app.

If they drift, Vibely can register subscriptions in one app while sending through another.

---

## 6. Frontend OneSignal behavior

## A. SDK boot
`index.html` includes the OneSignal web SDK script.

`src/main.tsx` then calls:
- `initOneSignal()`

### `initOneSignal()` behavior
Observed settings:
- `appId` = hardcoded Vibely OneSignal app ID
- `notifyButton.enable = false`
- `allowLocalhostAsSecureOrigin = true`
- `serviceWorkerParam.scope = "/"`

### Click behavior
A notification click listener reads:
- `event.notification?.data?.url`

If present, the browser navigates to that URL.

### Rebuild implication
Push click routing depends on notification payload data and browser-side OneSignal SDK initialization, not only on backend delivery.

## B. Permission request
`promptForPush()` calls:
- `OneSignal.Notifications.requestPermission()`

This is used in:
- `PushPermissionPrompt`
- `NotificationsDrawer`

## C. Subscription identity readback
Frontend helper methods expose:
- `getPlayerId()` → `OneSignal.User.PushSubscription.id`
- `isSubscribed()` → `OneSignal.User.PushSubscription.optedIn`

## D. Vibely user identity binding
`setExternalUserId(userId)` calls:
- `OneSignal.login(userId)`

`removeExternalUserId()` calls:
- `OneSignal.logout()`

### Rebuild implication
Vibely expects OneSignal’s external user model to be bound directly to the Supabase user ID.

---

## 7. Frontend sync into Supabase

The frontend persists OneSignal subscription identity into `notification_preferences`.

## A. Auth-context sync on login/session
`src/contexts/AuthContext.tsx` runs `syncOneSignal(userId)`.

Observed behavior:
1. calls `setExternalUserId(userId)`  
2. reads `playerId` via `getPlayerId()`  
3. reads subscription state via `isSubscribed()`  
4. upserts into `notification_preferences`:
   - `user_id`
   - `onesignal_player_id`
   - `onesignal_subscribed`

## B. Prompt-driven sync
`PushPermissionPrompt` and `NotificationsDrawer` also upsert:
- `onesignal_player_id`
- `onesignal_subscribed = true`

after permission is granted.

### Important implication
Successful OneSignal delivery depends on `notification_preferences` being in sync with browser subscription state.

If the browser grants permission but the upsert fails, the backend will later suppress sends with:
- `no_player_id`

---

## 8. Notification preferences model

`notification_preferences` is the main local control surface for push behavior.

Observed push-related columns include:
- `push_enabled`
- `paused_until`
- `onesignal_player_id`
- `onesignal_subscribed`
- `notify_new_match`
- `notify_messages`
- `notify_someone_vibed_you`
- `notify_ready_gate`
- `notify_event_live`
- `notify_event_reminder`
- `notify_date_reminder`
- `notify_daily_drop`
- `notify_recommendations`
- `notify_product_updates`
- `notify_credits_subscription`
- `quiet_hours_enabled`
- `quiet_hours_start`
- `quiet_hours_end`
- `quiet_hours_timezone`
- `message_bundle_enabled`

### Important implication
OneSignal subscription state alone is insufficient. Backend delivery is also gated by Vibely’s own preference system.

---

## 9. Backend send path

The main send function is:
- `supabase/functions/send-notification`

## A. Auth posture
- gateway config: `verify_jwt = false`
- function still requires:
  - service-role key **or**
  - valid user bearer JWT

## B. Delivery prechecks before OneSignal call
The function checks, in order:
- authenticated caller or service role
- presence of `user_id` and `category`
- user notification preferences row (creates defaults if absent)
- paused state
- master push toggle
- category-level toggle
- per-match mute / legacy match notification mute
- quiet hours
- message throttling
- presence of `onesignal_player_id`
- `onesignal_subscribed`

## C. OneSignal send payload
If allowed, the function POSTs to:
- `https://api.onesignal.com/notifications`

Payload includes:
- `app_id`
- `include_player_ids: [prefs.onesignal_player_id]`
- `headings.en = title`
- `contents.en = body`
- `data`
- `url = APP_URL + data.url` when `data.url` exists
- optional `chrome_web_image`

### Important implication
The backend send model targets **OneSignal player IDs**, not external user IDs directly.
So the `onesignal_player_id` sync path is operationally critical.

## D. Logging behavior
The function writes to:
- `notification_log`

It logs both:
- suppressed sends with reasons like `paused`, `user_disabled`, `quiet_hours`, `throttled`, `no_player_id`
- successful sends with `delivered = true`

### Important limitation
`send-notification` does **not** write OneSignal message IDs into `push_notification_events`.
It logs at the app layer, not at the provider-receipt layer.

---

## 10. Telemetry and webhook path

This is the second major OneSignal-related nuance.

## A. `push_notification_events` is not automatically fed by normal sends
The current normal send path:
- sends through OneSignal
- writes `notification_log`

But it does **not** automatically insert or update:
- `push_notification_events`

## B. What feeds `push_notification_events`
Observed sources are:
1. admin campaign queueing in `AdminPushCampaignsPanel`  
2. the generic `push-webhook` function

### Admin campaign queueing behavior
`AdminPushCampaignsPanel` inserts queued rows into:
- `push_notification_events`

with status like:
- `queued`

### `push-webhook` behavior
`push-webhook`:
- is generic, not explicitly OneSignal-only
- accepts `provider = fcm | apns | web`
- can parse delivery/open/click/failure style events
- updates or inserts `push_notification_events`
- optionally requires `x-webhook-secret` if `PUSH_WEBHOOK_SECRET` is set

## C. Important implication
The telemetry model is **loosely coupled**:
- send path → OneSignal + `notification_log`
- telemetry path → campaign queue rows + generic webhook ingestion

So it is possible for OneSignal delivery to work while `push_notification_events` remains sparse or incomplete.

---

## 11. What OneSignal definitely does vs what is more ambiguous

## Clear / strongly evidenced
- OneSignal web SDK is loaded in the browser
- OneSignal app ID is hardcoded in source
- backend sends to OneSignal REST API
- frontend binds Vibely user ID via `OneSignal.login(userId)`
- player ID and subscription state are persisted in `notification_preferences`
- push click behavior deep-links using notification `data.url`

## Ambiguous / not proven strongly by repo
- whether `push-webhook` is actually fed by OneSignal in production
- whether OneSignal itself is the source of the webhook receipts, or whether the design anticipated multiple providers
- the exact OneSignal dashboard origin/service-worker settings required in production
- whether OneSignal’s own external-user features are being fully leveraged beyond login binding

---

## 12. Vibely-owned browser notification layer (non-OneSignal)

Vibely also has its own service-worker notification system.

### Files
- `public/sw.js`
- `src/hooks/useServiceWorker.ts`
- `src/hooks/usePushNotifications.ts`

### Capabilities
- service-worker registration at `/sw.js`
- local `showNotification`
- scheduled notifications via postMessage + `setTimeout`
- periodic sync attempts for daily-drop checks
- direct browser `Notification.requestPermission()` support
- click handling inside app-owned service worker

### Why this matters
This is a parallel capability layer.

It can support:
- date reminders
- daily drop nudges
- local/browser-visible alerts

without proving that OneSignal remote push is healthy.

---

## 13. Outside-the-repo OneSignal state that must exist

The repo proves the code contract, but not the provider-side setup.

### Required provider-side reality
- a OneSignal app matching the hardcoded frontend app ID and backend env app ID
- REST API key for that same app
- web push configuration in OneSignal dashboard
- allowed site origin(s) for Vibely web push
- any service-worker/origin setup required by the OneSignal app
- if receipt/callback ingestion is used, a configured source targeting `push-webhook`

### What the repo does **not** fully preserve
- exact OneSignal dashboard configuration
- exact origin/domain settings registered in OneSignal
- exact service-worker linkage/config in OneSignal dashboard
- exact receipt/callback setup, if any
- exact segmentation or audience state inside OneSignal dashboard

---

## 14. What the repo proves vs what it does not prove

## What the repo proves strongly
- hardcoded app ID in frontend
- SDK load path and init settings
- external user binding to Supabase user ID
- `onesignal_player_id` persistence into `notification_preferences`
- backend REST send payload shape
- local preference/mute/quiet-hours gating before provider send
- existence of a generic webhook ingestion path and admin monitoring views
- existence of a separate app-owned service-worker notification layer

## What the repo does not prove strongly
- exact live OneSignal app/dashboard identity
- whether frontend app ID and backend env app ID currently match in production
- whether the OneSignal app is correctly configured for `vibelymeet.com`
- whether the generic webhook path is actively wired to OneSignal or another source
- whether OneSignal delivery metrics are fully represented in local analytics tables

---

## 15. OneSignal-specific rebuild risks

## Risk 1 — Split source of truth for app ID
Frontend app ID is hardcoded.
Backend app ID comes from env.

If they drift, Vibely can subscribe in one app and send in another.

## Risk 2 — Subscription sync failure looks like silent suppression
If `onesignal_player_id` or `onesignal_subscribed` is missing in `notification_preferences`, backend sends are suppressed with:
- `no_player_id`

The app may still appear permission-enabled to the user.

## Risk 3 — Local notifications can mask remote push failure
Because Vibely has its own service-worker/browser-notification layer, local reminders can work while OneSignal remote push is broken.

## Risk 4 — Telemetry is not end-to-end coupled
Normal OneSignal sends do not automatically populate `push_notification_events`.
So operators can misread delivery visibility if they only inspect that table/view.

## Risk 5 — `push-webhook` is a config-gap function
It exists in repo but is not listed in `supabase/config.toml`.
That means deploy posture must be chosen deliberately.

## Risk 6 — Origin/service-worker setup may be provider-dashboard-sensitive
The repo loads the OneSignal SDK and uses `/` scope, but successful web push also depends on correct OneSignal-side domain/origin configuration.

---

## 16. Minimum OneSignal verification procedure

### Step 1 — App identity verification
Confirm:
- frontend hardcoded app ID
- backend `ONESIGNAL_APP_ID`
- OneSignal dashboard app

all refer to the **same** app.

### Step 2 — REST key verification
Confirm `ONESIGNAL_REST_API_KEY` is valid for that app.

### Step 3 — Browser subscription test
Verify:
- SDK loads
- permission prompt works
- `OneSignal.login(userId)` succeeds
- `getPlayerId()` returns a value
- `notification_preferences.onesignal_player_id` is written
- `notification_preferences.onesignal_subscribed = true`

### Step 4 — Remote send test
Trigger a known send through `send-notification` and verify:
- no suppression reason is logged
- OneSignal accepts the request
- device/browser receives the push
- click deep-links correctly using `data.url`

### Step 5 — Preference gating test
Verify that push is suppressed correctly for:
- master toggle off
- category off
- quiet hours
- paused state
- message throttle

### Step 6 — Telemetry test
Verify whether provider events reach `push-webhook` in the intended production setup and whether:
- `push_notification_events`
- `push_notification_events_admin`

reflect the sends you expect.

### Step 7 — Boundary test
Verify separately that local/service-worker notifications still behave as intended and do not get confused with OneSignal remote push health.

---

## 17. Known unknowns to resolve in the next OneSignal-focused audit

1. Does the backend `ONESIGNAL_APP_ID` exactly match the hardcoded frontend app ID in production?  
2. What exact site origin(s) and service-worker settings are configured in the OneSignal dashboard for Vibely?  
3. Is `push-webhook` actively wired to OneSignal receipts/events in production, or is it only a planned/generalized ingestion path?  
4. Are there production cases where users are subscribed in OneSignal but missing `onesignal_player_id` locally?  
5. Should the hardcoded frontend app ID be centralized later to avoid drift between frontend and backend configuration?  

---

## 18. Recommended next provider sheet after OneSignal

The strongest next provider sheet is:

**VIBELY_TWILIO_PROVIDER_SHEET.md**

Reason:
- Twilio is the next sharp-edge verification dependency
- it is the only function explicitly configured with `verify_jwt = true`
- phone verification is trust-critical and easy to break with the wrong SID/settings

---

## 19. Bottom line

OneSignal in Vibely is the remote push delivery layer, but it is not the entire notification system.

To rebuild it correctly, you need more than the code:
- a single consistent OneSignal app across frontend and backend
- working browser subscription + player ID sync into Supabase
- a valid REST API key
- correct origin/service-worker configuration in the OneSignal dashboard
- clear understanding that app-level logs and provider-level telemetry are not currently the same pipeline

This sheet is the provider-level control point for that reality.

