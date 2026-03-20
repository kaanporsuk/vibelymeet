# Notification permission & push delivery audit — Web + Native

**Generated:** 2026-03-19  
**Scope:** Permission UX, OneSignal wiring, service workers, `notification_preferences`, Edge Function `send-notification` (source: `supabase/functions/send-notification/index.ts`).

---

## 1. Web permission flow

### 1.1 Step-by-step flow

1. **SDK load** — `index.html` loads deferred `OneSignalSDK.page.js` (CDN v16).  
   - `index.html` **L29**

2. **App bootstrap** — `src/main.tsx` calls `initOneSignal()` only when `origin === https://vibelymeet.com` **or** `localhost` (avoids OneSignal domain error on other hosts).  
   - `src/main.tsx` **L66–76**

3. **OneSignal init (deferred queue)** — `initOneSignal` pushes a callback onto `window.OneSignalDeferred` that runs `OneSignal.init({ appId, notifyButton: false, allowLocalhostAsSecureOrigin: true, serviceWorkerParam: { scope: '/' } })` and registers a **click** listener to set `window.location.href` from `event.notification?.data?.url`.  
   - `src/lib/onesignal.ts` **L17–34**

4. **Auth → external user id + DB sync** — On `session.user`, `useAppBootstrap` calls `setExternalUserId` → `OneSignal.login(userId)`, then `getPlayerId()` + `isSubscribed()` and **upserts** `notification_preferences` with `onesignal_player_id`, `onesignal_subscribed`.  
   - `src/hooks/useAppBootstrap.ts` **L29–51**

5. **Soft prompt (engagement)** — `PushPermissionPrompt` (mounted in `App.tsx`): if logged in, `Notification` API exists, not subscribed (`isSubscribed()`), permission not granted/denied, re-prompt cooldown (`vibely_push_prompted` in localStorage, 7 days), and user has **match or event registration** count &gt; 0 → after **5s** opens a **Drawer** (“Stay in the loop”). **Enable** calls `promptForPush()` → OneSignal `requestPermission`, then `getPlayerId()` and upserts DB; optional welcome via `sendNotification` Edge invoke.  
   - `src/components/PushPermissionPrompt.tsx` **L27–98**  
   - `src/App.tsx` **L109**

6. **Header / dashboard flow** — `NotificationPermissionFlow` opens from `NotificationPermissionButton` when push not “granted” **per `usePushNotifications`** (`isGranted` = `Notification.permission === 'granted'`). **Enable** calls `onRequestPermission` from parent → **`Notification.requestPermission()`** (Web Notifications API), **not** `promptForPush` / OneSignal.  
   - `src/components/notifications/NotificationPermissionFlow.tsx` **L26–34**  
   - `src/hooks/usePushNotifications.ts` **L36–47**, **L175–178**  
   - `src/pages/Dashboard.tsx` **L389–392**, **L415+** (`NotificationPermissionButton`)  
   - `src/pages/Schedule.tsx` **L78–81**

7. **Settings** — `NotificationsDrawer` uses `promptForPush` + `getPlayerId` + Supabase upsert (OneSignal path), plus full prefs UI.  
   - `src/components/settings/NotificationsDrawer.tsx` **L59–71**

8. **Parallel: local / SW scheduling** — `useServiceWorker` registers **`/sw.js`** (not `OneSignalSDK.sw.js`). `usePushNotifications` uses this for `showNotification` / `scheduleDateReminder` when `swReady`. `NotificationManager` only logs when `usePushNotifications().isGranted`.  
   - `src/hooks/useServiceWorker.ts` **L18–22**  
   - `src/hooks/usePushNotifications.ts` **L55–77**, **L139–163**  
   - `src/components/notifications/NotificationManager.tsx` **L13–25**

9. **In-app toast stack** — `NotificationContext` / `NotificationContainer` are **in-app** UI (not system push).  
   - `src/contexts/NotificationContext.tsx`

### 1.2 Files involved (web)

| Area | File |
|------|------|
| OneSignal init | `index.html`, `src/main.tsx`, `src/lib/onesignal.ts` |
| Auth ↔ OneSignal ↔ DB | `src/hooks/useAppBootstrap.ts` |
| Soft prompt (OneSignal) | `src/components/PushPermissionPrompt.tsx` |
| Modal flow (Web Notification API) | `src/components/notifications/NotificationPermissionFlow.tsx` |
| “Granted” for dashboard button | `src/hooks/usePushNotifications.ts` |
| Settings drawer | `src/components/settings/NotificationsDrawer.tsx` |
| Prefs hook | `src/hooks/useNotificationPreferences.ts` |
| Client → Edge | `src/lib/notifications.ts` → `send-notification` |
| Custom SW | `public/sw.js`, `src/hooks/useServiceWorker.ts` |
| OneSignal SW shim | `public/OneSignalSDK.sw.js` |
| App shell | `src/App.tsx` |

### 1.3 Issues found (web)

- **CRITICAL — Split permission sources:** Dashboard / Schedule / `NotificationPermissionFlow` use **`Notification.requestPermission()`** while `PushPermissionPrompt` and `NotificationsDrawer` use **OneSignal `requestPermission`**. Browser can show “granted” for Web Notifications without OneSignal subscription (and vice versa). `NotificationPermissionButton.isGranted` does **not** equal OneSignal `isSubscribed()`.
- **HIGH — Dual service worker story:** App registers **`/sw.js`** for custom scheduling; OneSignal v16 uses its own worker path (dashboard typically expects root `OneSignalSDK.sw.js` — present as shim). Two registrations can be confusing; behavior depends on browser + order.
- **MEDIUM — `getPlayerId` timing / API:** `src/lib/onesignal.ts` **L63–65** uses `await OneSignal.User.PushSubscription.id`. If the user is not yet opted in or the SDK exposes an async getter elsewhere, this can resolve **null** until subscription settles — consider retries or official v16 `getIdAsync`-style API if available.
- **HIGH — `PushPermissionPrompt` vs browser-only grant:** If `Notification.permission === 'granted'` but OneSignal is **not** subscribed (e.g. user only used `NotificationPermissionFlow`), the prompt **never shows** (**L36–37**), so **no** OneSignal `promptForPush` / player ID sync from that path.
- **MEDIUM — Hardcoded fallback App ID:** `ONESIGNAL_APP_ID_FALLBACK` in `src/lib/onesignal.ts` **L7–9** if `VITE_ONESIGNAL_APP_ID` unset.
- **MEDIUM — Logout:** `removeExternalUserId()` calls `OneSignal.logout()` but **does not clear** `onesignal_player_id` / `onesignal_subscribed` in `notification_preferences` (stale targeting until overwrite on next login).
- **MEDIUM — `NotificationPermissionFlow` success path:** Does not persist player ID or call `getPlayerId` + upsert (relies on `useAppBootstrap` timing vs permission).
- **LOW — `useDateReminders` / `useEventReminders`:** Additional **`Notification` API** usage for local reminders; separate from OneSignal server push.

---

## 2. Native permission flow

### 2.1 Step-by-step flow

1. **Expo root** — `PushRegistration` mounted inside `AuthProvider` in `RootLayoutNav`.  
   - `apps/mobile/app/_layout.tsx` **L177–178** (`<PushRegistration />`)  
   - `apps/mobile/components/PushRegistration.tsx`

2. **Cold start** — `useEffect` → `initOneSignal()` once. Uses `OneSignal.initialize(APP_ID)`; `APP_ID` from `process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID`.  
   - `apps/mobile/lib/onesignal.ts` **L13–20**  
   - `apps/mobile/components/PushRegistration.tsx` **L14–16**

3. **After sign-in** — Second `useEffect`: if `user.id` + `session`, calls `registerPushWithBackend(user.id)`; on sign-out calls `logoutOneSignal()` only.  
   - `apps/mobile/components/PushRegistration.tsx` **L18–24**

4. **`registerPushWithBackend`** — `OneSignal.Notifications.requestPermission(false)` → if granted, `OneSignal.login(userId)`, poll `pushSubscription.getIdAsync()` (with **1.5s** retry), then **upsert** `notification_preferences`: `mobile_onesignal_player_id`, `mobile_onesignal_subscribed: true`.  
   - `apps/mobile/lib/onesignal.ts` **L28–57**

5. **Settings screen** — `settings/notifications.tsx` uses `usePushPermission()` (OneSignal `getPermissionAsync` / `requestPermission`) + `registerPushWithBackend` on enable; prefs from `useNotificationPreferences`.

6. **Modal flow** — `NotificationPermissionFlow` (native): intro → `onRequestPermission`. **`apps/mobile/app/settings/notifications.tsx`** chains **`registerPushWithBackend`** after grant (**L173–174**). **`apps/mobile/app/(tabs)/index.tsx`** and **`apps/mobile/app/schedule.tsx`** pass **only** `requestPermission` from `usePushPermission` (**index ~L650–653**, **schedule ~L111–114**) — **no backend registration** on that path.

7. **Logout** — `OneSignal.logout()`; **no** DB clear of `mobile_onesignal_*` (commented in `PushRegistration.tsx`).

### 2.2 Files involved (native)

| Area | File |
|------|------|
| Init + register | `apps/mobile/lib/onesignal.ts`, `apps/mobile/components/PushRegistration.tsx` |
| Permission hook | `apps/mobile/lib/usePushPermission.ts` |
| Modal UX | `apps/mobile/components/notifications/NotificationPermissionFlow.tsx` |
| Settings | `apps/mobile/app/settings/notifications.tsx` |
| Prefs | `apps/mobile/lib/useNotificationPreferences.ts` |
| Expo / OneSignal native | `apps/mobile/app.json` (plugin, iOS NSE, `aps-environment`), `apps/mobile/app.config.js` (mode override) |

### 2.3 Issues found (native)

- **HIGH — Dashboard `NotificationPermissionFlow`:** `apps/mobile/app/(tabs)/index.tsx` passes **`onRequestPermission={requestPermission}`** only — **does not** call `registerPushWithBackend` on success, unlike settings. User may grant OS permission but **never write** `mobile_onesignal_player_id`.
- **HIGH — `usePushPermission`:** Treats OneSignal `false` as **denied** even when user was **never prompted** (“default” indistinguishable) — **L30–33** comment acknowledges; wrong UX for “Enable” flows.
- **HIGH — Login-on-open:** `registerPushWithBackend` runs on **every** session effect; calls **`requestPermission`** again — can feel aggressive vs “ask on user action”.
- **HIGH — No in-repo OneSignal notification handlers (native):** Grep shows **no** `OneSignal.Notifications.addEventListener` (foreground display / opened) in `apps/mobile`. **`NotificationDeepLinkHandler.tsx`** is **not present**; deep links from notification taps rely on SDK defaults / OS behavior only unless configured elsewhere.
- **MEDIUM — Logout / DB:** `mobile_onesignal_player_id` not cleared; backend may still attempt stale ID (depends on `send-notification` behavior).
- **MEDIUM — Subscription ID timing:** Single 1.5s retry may be insufficient on slow devices.
- **LOW — OneSignal tags:** No code found setting tags like `onboarding_complete`, `has_photos` on native (not in audited files).
- **CONFIG — iOS `aps-environment`:** `app.json` **L31** shows `development`; `app.config.js` adjusts OneSignal plugin mode for EAS profiles — ensure production builds use **production** APNs where required.

---

## 3. Push delivery pipeline

### 3.1 Client → Edge

- Web/other clients call `supabase.functions.invoke("send-notification", { body: { user_id, category, title, body, data?, image_url?, bypass_preferences? } })`.  
  - `src/lib/notifications.ts` **L12–15**  
- Server-side examples: `supabase/functions/send-message/index.ts` **L131–139**, `daily-drop-actions`, `swipe-actions`, `generate-daily-drops` **L258–266**, `stripe-webhook`, etc.

### 3.2 `send-notification` Edge Function

- **Status:** Implemented in **`supabase/functions/send-notification/index.ts`** (OneSignal REST, preference checks, `notification_log`, web + mobile player IDs).  
- **Secrets:** `ONESIGNAL_REST_API_KEY`, `ONESIGNAL_APP_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.

### 3.3 Recipient resolution (from source)

- Table: **`notification_preferences`** (`user_id` unique).  
- **Web:** `onesignal_player_id`, `onesignal_subscribed`  
- **Native:** `mobile_onesignal_player_id`, `mobile_onesignal_subscribed`  
- **Behavior:** Function collects both IDs into `include_player_ids` when subscribed flags are true (`send-notification/index.ts` ~L351–358).

### 3.4 Issues found (pipeline)

- **MEDIUM — API shape:** Uses `include_player_ids`; monitor OneSignal deprecation in favor of subscription-based APIs.
- **Resolved — Stale IDs on logout:** Web `AuthContext.logout` and native `signOut` clear player columns (post-audit).
- **MEDIUM — API deprecation risk:** If deployed code still uses deprecated OneSignal fields, deliveries may fail silently.

---

## 4. OneSignal dashboard / config (from code)

| Item | Value / location |
|------|------------------|
| Web App ID | `import.meta.env.VITE_ONESIGNAL_APP_ID` or fallback `97e52ea2-6a27-4486-a678-4dd8a0d49e94` — `src/lib/onesignal.ts` **L7–9** |
| Native App ID | `process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID` — `apps/mobile/lib/onesignal.ts` **L9** |
| Web SDK | `https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js` — `index.html` **L29** |
| Web SW shim | `public/OneSignalSDK.sw.js` → `importScripts` CDN worker **L6** |
| Custom SW | `public/sw.js` + register in `useServiceWorker.ts` **L20** |
| iOS | `onesignal-expo-plugin`, NSE in `app.json` **L63–70**, **L96–104**; `UIBackgroundModes` includes `remote-notification` **L21–24** |
| Android | `POST_NOTIFICATIONS` in `app.json` **L47** |
| REST API key | Not in client code; expected as Edge secret **`ONESIGNAL_API_KEY`** (docs only) |

---

## 5. Issues summary table

| # | Issue | Severity | Platform | Location | Fix needed |
|---|--------|----------|----------|----------|------------|
| 1 | Web: `NotificationPermissionFlow` uses Web Notifications API, not OneSignal; mismatches `PushPermissionPrompt` / backend subscription | CRITICAL | Web | `usePushNotifications.ts` + `NotificationPermissionFlow.tsx` + Dashboard | Unify on `promptForPush` + `getPlayerId` + upsert, or drive `isGranted` from `isSubscribed()` + `Notification.permission` |
| 2 | `send-notification` implementation absent from repo | CRITICAL | Both | `supabase/functions/` | Restore function in repo or submodule; document deployed hash |
| 3 | Web `getPlayerId` may return null before subscription ready; verify v16 property vs async API | MEDIUM | Web | `src/lib/onesignal.ts` **L59–70** | Retry after `promptForPush` / confirm SDK API for subscription id |
| 4 | Native Dashboard flow does not call `registerPushWithBackend` after permission | HIGH | Native | `apps/mobile/app/(tabs)/index.tsx` | On grant: call `registerPushWithBackend(user.id)` (same as settings) |
| 5 | `usePushPermission` conflates “denied” and “not asked” | HIGH | Native | `usePushPermission.ts` | Use expo-notifications or native module for granular status |
| 6 | `registerPushWithBackend` on every login without user gesture | MEDIUM | Native | `PushRegistration.tsx` | Defer permission request to explicit UI except maybe cold-start after onboarding |
| 7 | Logout does not clear `onesignal_player_id` / mobile IDs in DB | MEDIUM | Both | `useAppBootstrap.ts`, `PushRegistration` / logout flow | Upsert null + `onesignal_subscribed: false` on logout |
| 8 | Dual SW (`sw.js` + OneSignal) complexity | MEDIUM | Web | `useServiceWorker.ts` + OneSignal init | Document; consider single strategy for scheduled local vs push |
| 9 | Hardcoded OneSignal web App ID fallback | MEDIUM | Web | `src/lib/onesignal.ts` | Remove fallback in production builds |
| 10 | No explicit OneSignal click/foreground handlers + missing `NotificationDeepLinkHandler` | HIGH | Native | N/A | Add `addEventListener` for opened/foreground + route with `expo-router` |
| 11 | `PushPermissionPrompt` skips when `Notification.permission === 'granted'` even if OneSignal unsubscribed | HIGH | Web | `PushPermissionPrompt.tsx` **L36–37** | Gate on `isSubscribed()` only, or call OneSignal opt-in when browser already granted |
| 12 | Native `schedule.tsx` modal: same gap as home tab — no `registerPushWithBackend` after grant | HIGH | Native | `apps/mobile/app/schedule.tsx` **~L111–114** | Chain `registerPushWithBackend` like settings |
| 13 | OneSignal tags not set on native (audited paths) | LOW | Native | — | Optional: align with marketing/segmentation plan |

---

## 6. Recommended fixes

1. **Web permission single path** — Change `NotificationPermissionFlow` consumers to pass an async handler that: (a) `await promptForPush()`, (b) `await getPlayerId()` + upsert `notification_preferences`, (c) refresh `isPushSubscribed` / `isSubscribed()`. Stop using `Notification.requestPermission()` for flows that must align with OneSignal server push. Alternatively, rename dashboard state to “browser notifications” if keeping dual systems intentionally.

2. **Restore `send-notification` in repo** — Add `supabase/functions/send-notification/index.ts` with tests; verify OneSignal REST v16+ payload, `notification_log`, category → `notify_*` mapping, `push_enabled`, `paused_until`, quiet hours, match mutes.

3. **Fix `getPlayerId`** — `src/lib/onesignal.ts`: use documented async getter; add retry loop similar to native.

4. **Native dashboard + schedule** — After `requestPermission()` returns true in `NotificationPermissionFlow` on **`(tabs)/index`** and **`schedule`**, invoke `registerPushWithBackend(user.id)` (mirror **`settings/notifications.tsx` L173–174**).

5. **Logout hygiene** — On session end: `OneSignal.logout()` + `supabase.update` clearing web/native player fields and `*_subscribed` flags (or document why stale IDs are OK).

6. **Native permission state** — Integrate `expo-notifications` `getPermissionsAsync` for iOS/Android distinction alongside OneSignal.

7. **Documentation** — This file + link from README; add diagram of “soft prompt vs settings vs dashboard modal”.

---

## 7. Answers to audit checklist (quick reference)

### Web

| # | Answer |
|---|--------|
| 1 | OneSignal initialized in `src/lib/onesignal.ts` via `OneSignalDeferred` **L18–26**; invoked from `src/main.tsx` **L70**; App ID `src/lib/onesignal.ts` **L7–9** |
| 2 | PushPermissionPrompt: **5s delay** after engagement check **L61–62**; NotificationPermissionFlow: **user opens** from header bell (`Dashboard.tsx` **L415+** / `NotificationPermissionButton`) |
| 3 | **Drawer** (PushPermissionPrompt) and **Dialog** (NotificationPermissionFlow) before native dialog |
| 4 | Player ID: **upsert** `notification_preferences.onesignal_player_id`, `onesignal_subscribed` — PushPermissionPrompt **L73–79**, useAppBootstrap **L35–44** |
| 5 | Denied: PushPermissionPrompt **skips** if `Notification.permission === 'denied'` **L38**; Flow shows **denied** step **L146–165** (`NotificationPermissionFlow.tsx`); settings copy for unblock: `NotificationsDrawer.tsx` **L170–172** |
| 6 | **`onesignal_player_id`** column |
| 7 | **Yes** — `public/sw.js` (custom), `public/OneSignalSDK.sw.js` (OneSignal shim) |
| 8 | Edge functions **invoke** `send-notification` (send-message, swipe-actions, daily-drop-actions, generate-daily-drops, client `notifications.ts`, etc.) |
| 9 | Load prefs by `user_id` → `onesignal_player_id` / `mobile_onesignal_player_id` in `send-notification/index.ts` |
| 10 | **Production check:** validate with live OneSignal + device (not a code gap) |

### Native

| # | Answer |
|---|--------|
| 1 | `apps/mobile/lib/onesignal.ts` **`initOneSignal`** **L13–20** |
| 2 | Init **app start** (`PushRegistration` **L14–16**); register **on auth** **L18–24** |
| 3 | OS prompt inside **`registerPushWithBackend`** on login (**L31**) and settings enable; modal **before** via `NotificationPermissionFlow` when user taps Enable (**L42–45**) |
| 4 | **NotificationPermissionFlow** modal (intro / spinner / success / denied) |
| 5 | **`OneSignal.login(userId)`** in `registerPushWithBackend` **L33**; ID via **`getIdAsync`** **L35–38**; DB **`mobile_onesignal_player_id`**, **`mobile_onesignal_subscribed: true`** **L41–46** |
| 6 | Denied: flow **denied** step + **Open Settings** **L128–129**; DB not updated on deny |
| 7 | Re-open: effect runs **`registerPushWithBackend`** again if session present |
| 8 | **`logoutOneSignal`** **L60–63**; **no** DB clear in code |
| 9 | **`OneSignal.login(userId)`** with Supabase `user.id` **L33** |
| 10 | **No** tags found in audited native files |

### send-notification (source in repo)

- Recipients: **`notification_preferences`** by `user_id`; web + mobile player ID columns when subscribed.  
- **Source:** `supabase/functions/send-notification/index.ts` — preference gates, OneSignal `POST /notifications`, `include_player_ids`.

---

*End of audit.*
