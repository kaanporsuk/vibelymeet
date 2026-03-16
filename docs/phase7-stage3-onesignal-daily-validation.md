# Phase 7 Stage 3 — OneSignal and Daily Validation

## Goal

Prove OneSignal and Daily on real native runtime surfaces; fix only high-confidence defects. No provider or backend contract changes.

---

## Part A — OneSignal

### 1. Current integration map (mobile)

| Layer | File(s) | Role |
|-------|---------|------|
| **Config** | `app.json`, `app.config.js` | `onesignal-expo-plugin` (mode from env; production for EAS preview/prod); iOS OneSignalNotificationServiceExtension. |
| **Init & registration** | `lib/onesignal.ts` | `initOneSignal()` — OneSignal.initialize(APP_ID) when `EXPO_PUBLIC_ONESIGNAL_APP_ID` set; `registerPushWithBackend(userId)` — requestPermission(false), login(userId), getIdAsync() with 1.5s retry, upsert `notification_preferences` (mobile_onesignal_player_id, mobile_onesignal_subscribed); `logoutOneSignal()` on sign out. |
| **App wiring** | `components/PushRegistration.tsx` | In root layout: initOneSignal() once; when user/session set, registerPushWithBackend(user.id).catch(() => {}); when !user or !session, logoutOneSignal(). |
| **Entry points** | Dashboard (header), Settings → Notifications | Dashboard: icon links to `/settings/notifications`. Settings: Notifications row → `/settings/notifications`. Notifications screen: copy + link to web for full management; no in-app permission prompt (permission requested inside registerPushWithBackend when backend registration runs). |

### 2. Validation results (OneSignal)

| # | Flow | Result | Notes |
|---|------|--------|--------|
| 1 | Device registration / player identity | Implemented | registerPushWithBackend: requestPermission → login(userId) → getIdAsync → upsert notification_preferences. Backend send-notification can target user_id; mobile uses mobile_onesignal_player_id. |
| 2 | Permission prompt | Implemented | OneSignal.Notifications.requestPermission(false) inside registerPushWithBackend; runs when user is logged in (PushRegistration effect). No separate “notification permission” screen; prompt is system when registration runs. |
| 3 | Token / subscription persistence | Implemented | Upsert to notification_preferences; OneSignal SDK persists subscription. 1.5s retry if getIdAsync returns null. |
| 4 | Push receipt | Not in app code | No OneSignal.Notifications.add* listeners. Receipt/delivery handled by OS and OneSignal SDK defaults. |
| 5 | Push open / deeplink | Not in app code | No notification opened or click listener. Deeplink from push not wired; would require OneSignal.Notifications.add* listener and routing. |
| 6 | Failure / degraded | Implemented | No APP_ID → init skipped, registerPushWithBackend returns false. Permission denied → return false, no upsert. Errors logged with console.warn; PushRegistration catches so no unhandled rejection. |

### 3. OneSignal fixes applied

None. No high-confidence code defect found; permission/registration/token path and degraded behavior are correct.

### 4. OneSignal remaining issues

| Category | Issue |
|----------|--------|
| **Provider-config blocker** | `EXPO_PUBLIC_ONESIGNAL_APP_ID` must be set and OneSignal dashboard configured (app, platform keys) for real push. Without it, init and registration are no-ops. |
| **Mobile code** | None. |
| **Non-blocking** | (1) Push opened / deeplink: add listener and route to screen if product requires. (2) No automatic retry if user denies permission then grants later (e.g. from settings); registration runs once when user is set; could add foreground or permission-change retry later. |

---

## Part B — Daily

### 1. Current integration map (mobile)

| Layer | File(s) | Role |
|-------|---------|------|
| **Config** | `app.json`, `package.json`, `.npmrc` | `@daily-co/config-plugin-rn-daily-js`, `@daily-co/react-native-daily-js`, `@daily-co/react-native-webrtc`; legacy-peer-deps for Expo 55. |
| **Room token & session** | `lib/videoDateApi.ts` | `getDailyRoomToken(sessionId)` → invoke `daily-room` (create_date_room); `enterHandshake`, `endVideoDate` RPCs; `deleteDailyRoom(roomName)`; `useVideoDateSession(sessionId, userId)` with realtime on video_sessions. |
| **Video date screen** | `app/date/[id].tsx` | Request camera/record_audio (Android); get token; enterHandshake if needed; Daily.createCallObject(); call.join({ url, token }); participant-joined/updated/left, left-meeting, error; DailyMediaView local/remote; leaveAndCleanup (leave, destroy, deleteDailyRoom, endVideoDate, leave_matching_queue). **Fix in this pass:** unmount cleanup now also calls endVideoDate(sessionId) so backend session is ended when user leaves without tapping “End date”. |
| **Entry** | Ready Gate, lobby | From lobby/Ready Gate → router.push(`/date/${activeSessionId}`). |

### 2. Validation results (Daily)

| # | Flow | Result | Notes |
|---|------|--------|--------|
| 1 | Room/token/session entry | Implemented | Session from useVideoDateSession; token from getDailyRoomToken(sessionId); enterHandshake if !handshake_started_at. |
| 2 | Join flow | Implemented | requestPermissions (Android camera + RECORD_AUDIO); call.join({ url, token }); participant events set local/remote. |
| 3 | Local media permissions | Implemented | Android: PermissionsAndroid.requestMultiple([CAMERA, RECORD_AUDIO]). iOS: setHasPermission(true) without explicit request (system may prompt on first join). |
| 4 | Local/remote track behavior | Implemented | getTrack(participant, 'video'|'audio') from participant.tracks or videoTrack/audioTrack; DailyMediaView for remote (full screen) and local (pip). |
| 5 | Disconnect/reconnect | Baseline | participant-left clears remote; left-meeting clears state. No explicit reconnect UI; user can leave and re-enter via navigation. |
| 6 | Exit/cleanup | Implemented + fixed | “End date” → leaveAndCleanup (leave, destroy, deleteDailyRoom, endVideoDate). Unmount cleanup: leave, destroy, deleteDailyRoom, **endVideoDate(sessionId)** (added in this pass) so backend session is ended when user backgrounds or navigates away. |
| 7 | Obvious runtime/device issues | Mitigated | Permission denied → setCallError; token fail → setCallError; join catch → setCallError. get-random-values imported before Daily. |

### 3. Daily fixes applied

| File | Change |
|------|--------|
| `apps/mobile/app/date/[id].tsx` | Unmount cleanup (useEffect return) now calls `endVideoDate(sessionId)` so the backend video_sessions row is moved to ended when the user leaves the screen without tapping “End date” (e.g. back gesture, app kill). Cleanup effect deps set to `[sessionId]` so sessionId is in scope. |

### 4. Daily remaining issues

| Category | Issue |
|----------|--------|
| **Provider-config blocker** | Daily dashboard and `daily-room` Edge Function must be configured (API key, room creation). Backend must have valid Daily credentials and daily-room deployed. |
| **Mobile code** | None remaining from this pass. |
| **Non-blocking** | (1) iOS: camera/mic not explicitly requested in code (relies on system prompt on first join); consider explicit request for consistency. (2) Reconnect UX: no in-call “reconnecting” state if network drops; user can re-enter from lobby/Ready Gate. |

---

## 5. Beta readiness (iOS validation)

- **OneSignal:** Code path is correct for init, permission, registration, and degraded behavior. Real push and deeplink require dashboard config and (if needed) notification opened listener. **Good to proceed** for iOS validation once `EXPO_PUBLIC_ONESIGNAL_APP_ID` and OneSignal app are set.
- **Daily:** Code path is correct for room/token, join, permissions, tracks, and cleanup; unmount now ends the backend session. **Good to proceed** for iOS validation once `daily-room` and Daily config are in place.

---

## 6. Rebuild delta / docs

- **Config:** No env or app.json changes. OneSignal and Daily remain as-is.
- **Assumptions:** OneSignal: backend uses notification_preferences.mobile_onesignal_player_id and mobile_onesignal_subscribed. Daily: backend owns session and token via daily-room and video_date_transition; mobile leaves/ends and cleans up on unmount.
- **Docs:** This file is the Phase 7 Stage 3 record. If you keep a single “native validation” or “providers” runbook, add: “Phase 7 Stage 3: OneSignal and Daily integration audited; Daily unmount cleanup now calls endVideoDate so backend session state is correct on leave.”

---

## User actions (irreducible)

**OneSignal (real push):**

1. In OneSignal dashboard: create/link app, add iOS/Android platform and keys.
2. In Supabase/env: set `EXPO_PUBLIC_ONESIGNAL_APP_ID` (and EAS secrets for builds).
3. Build with dev client (Expo Go does not support native OneSignal).
4. On device: sign in, allow notification when prompted; confirm in dashboard that the device is subscribed (or send a test push).

**Daily (real video date):**

1. Deploy `daily-room` Edge Function and set Daily API key/secret in Supabase.
2. Build with dev client (Daily native modules do not run in Expo Go).
3. On device: complete a match → Ready Gate → “I’m Ready” → join date; allow camera/mic; confirm room join and local/remote video; tap “End date” or leave screen and confirm backend session ends.

**Terminal (smoke test):**

```bash
cd apps/mobile
npx expo run:ios
# or
npx expo run:android
```

Then: sign in → trigger push registration (already automatic) → open Notifications settings; from lobby/Ready Gate start a video date → allow camera/mic → verify join and “End date” / leave → verify no crash.
