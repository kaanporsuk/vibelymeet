# Vibely Native — Complete Notification System Audit & Design

This document is the result of a full audit of web and native notification code, Edge Functions, and schemas, plus a design for the ideal native notification system.

---

## 1. Current State (Web) — Complete Notification Inventory

### 1.1 Notification triggers (where they are sent from)

| # | Trigger event | Channel | Title | Body template | Deep link / action | Sent by | Preference key |
|---|---------------|---------|-------|---------------|-------------------|---------|-----------------|
| 1 | New match (event lobby mutual vibe) | Push (OneSignal) | "It's a match! 🎉" | "You have a new match! Start chatting now." | `/matches`, match_id | Edge: swipe-actions | notify_new_match |
| 2 | Ready gate (match queued, partner waiting) | Push | "Video date ready! 📹" | "Someone is waiting — tap to join your video date" | `/matches`, match_id | Edge: swipe-actions | notify_ready_gate |
| 3 | Someone vibed you (non-mutual / super vibe) | Push | "Someone vibed you! 💜" | "Join the event to find out who" | `/events` | Edge: swipe-actions | notify_someone_vibed_you |
| 4 | New message (chat) | Push | Sender name or "New message" | Message preview (≤80 chars) | `/chat/{match_id}`, match_id | Edge: send-message | notify_messages |
| 5 | Daily drop ready (cron) | Push | "💧 Your Daily Drop is ready" | "Someone new is waiting to meet you. Open to see who." | `/matches` | Edge: generate-daily-drops | notify_daily_drop |
| 6 | Daily drop opener received | Push | "💧 Your Daily Drop sent you a message" | "Reply before 6 PM tomorrow to unlock chat" | `/matches` | Edge: daily-drop-actions | notify_daily_drop |
| 7 | Daily drop reply (match unlocked) | Push | "You're connected! 🎉" | "You and {name} matched through Daily Drop" | `/chat/{match_id}` or `/matches` | Edge: daily-drop-actions | notify_new_match |
| 8 | Credits purchased (Stripe) | Push | "Credits added! ⚡" | "{packId} pack purchased" | `/settings` | Edge: stripe-webhook | notify_credits_subscription |
| 9 | Event going live (admin action) | Push | "{eventTitle} is live! 🎉" | "Join now and start meeting people" | `/event/{eventId}/lobby` | Client: AdminEventControls → sendNotification | notify_event_live |
| 10 | Event reminder (admin, 15 min) | Push | "{eventTitle} starts soon! ⏰" | "Get ready — starting in 15 minutes" | `/event/{eventId}/lobby` | Client: AdminEventControls | notify_event_reminder |
| 11 | New event created (admin) | Email (Resend) | "🎉 New Event: {title}" | HTML: event details, CTA to events | — | Edge: event-notifications (event_created) | N/A (email) |
| 12 | Event capacity alert (admin) | Email | "🔥 \"{title}\" is {pct}% Full!" | HTML: FOMO, CTA | — | Edge: event-notifications (capacity_alert) | N/A (email) |
| 13 | Vibe sent (mutual / non-mutual) | OneSignal push | "It's a match!" / "Someone vibed you" style copy | Event lobby pre-event | — | Web: `useEventVibes` → `send-notification` (`new_match` / `someone_vibed_you`) | notify_new_match / notify_someone_vibed_you |

**Web in-app (NotificationContext):** Match, message, event, date_proposal — shown as toasts/cards; not push. Date reminders are scheduled client-side (usePushNotifications.scheduleDateReminder) or via service worker; no server-sent date_reminder push documented. Event reminders (30m/5m) are not automated in code found; admin sends manual "Event reminder" (item 10).

### 1.2 Tables

- **notification_preferences:** user_id, push_enabled, paused_until, notify_new_match, notify_messages, notify_someone_vibed_you, notify_ready_gate, notify_event_live, notify_event_reminder, notify_date_reminder, notify_daily_drop, notify_recommendations, notify_product_updates, notify_credits_subscription, sound_enabled, quiet_hours_enabled, quiet_hours_start/end/timezone, message_bundle_enabled, onesignal_player_id, onesignal_subscribed, mobile_onesignal_player_id, mobile_onesignal_subscribed (from migration).
- **push_notification_events:** delivery tracking (sent, delivered, opened, clicked, failed); used by push-webhook (FCM/APNs/Web).
- **notification_log:** (send-notification) user_id, category, title, body, data, delivered, suppressed_reason.
- **match_mutes / match_notification_mutes:** per-match mute; send-notification skips messages/new_match when muted.

### 1.3 Web behavior summary

- **send-notification** Edge Function: single entry point for push. Checks account pause (profiles.is_paused), prefs pause (paused_until), push_enabled, category toggle, match mute, quiet hours, message throttle (1/min when message_bundle_enabled). Sends to both onesignal_player_id and mobile_onesignal_player_id. Categories: new_match, messages, someone_vibed_you, ready_gate, event_live, event_reminder, date_reminder, daily_drop, recommendations, product_updates, credits_subscription; safety_alerts bypasses pause/quiet hours.
- **event-notifications:** email only (Resend); event_created + capacity_alert; admin-only, rate-limited.
- **Event lobby vibes (web):** `useEventVibes` invokes **`send-notification`** for mutual vs one-way vibes (replaces legacy `vibe-notification`). Swipe-actions still sends push for `super_vibe_sent` / `vibe_recorded` at events.
- **daily-drop-actions:** send_opener → daily_drop to partner; send_reply → new_match to opener.
- **generate-daily-drops:** cron; creates pairs, then send-notification daily_drop to each user.
- **email-drip:** cron; profile-complete (profile live + 2+ photos, 1h–7d old); first-event-nudge (1–7d old, no registrations). Resend; unsubscribe via UNSUB_HMAC_SECRET.

---

## 2. Current State (Native) — What Exists

### 2.1 OneSignal

- **Init:** `apps/mobile/lib/onesignal.ts` — `initOneSignal()` with `EXPO_PUBLIC_ONESIGNAL_APP_ID`; called from `main.tsx` and from `PushRegistration` component.
- **Registration:** After auth, `PushRegistration` (in `_layout.tsx`) calls `registerPushWithBackend(user.id)`: requestPermission(false), OneSignal.login(userId), get subscription ID via `OneSignal.User.pushSubscription.getIdAsync()` (with 1.5s retry), upsert `notification_preferences` with `mobile_onesignal_player_id` and `mobile_onesignal_subscribed: true`. On sign out, `logoutOneSignal()` (no DB clear of player id).
- **App config:** `app.config.js` — OneSignal plugin; production APNs for EAS preview/production.

### 2.2 Permission flow

- **usePushPermission** (`lib/usePushPermission.ts`): reads OneSignal.Notifications.getPermissionAsync(); requestPermission() → OneSignal.Notifications.requestPermission(false); openSettings() for device settings.
- **NotificationPermissionFlow** (`components/notifications/NotificationPermissionFlow.tsx`): modal steps intro → requesting → success/denied; “Open Settings” when denied. Used on dashboard and in settings.
- **Settings → Notifications** (`app/settings/notifications.tsx`): shows push status (Enabled/Disabled/Not set), Enable / Open Settings; toggles for notify_messages, notify_new_match, notify_date_reminder, notify_event_reminder, notify_ready_gate, notify_daily_drop, notify_product_updates; link to “Open notification settings on web” for quiet hours and sounds.

### 2.3 What native can receive

- Same push payloads as web for any trigger that calls **send-notification** with user_id: new match, ready gate, someone vibed you, messages, daily drop (ready, opener, reply), credits, event live, event reminder. Native is targeted via `mobile_onesignal_player_id` in the same Edge Function.

### 2.4 Display and deep links

- OS banner, sound, badge (OneSignal default). No in-app notification center; no custom “notification history” screen. Deep link from tap: handled by OneSignal/Expo; exact route mapping (e.g. data.url → Expo route) depends on Expo/OneSignal config (e.g. vibelymeet:// or custom scheme + path).

### 2.5 Preferences

- **useNotificationPreferences** fetches/updates notification_preferences for the same 7 toggles as in settings UI. Quiet hours and sound are “on web” only in copy.

### 2.6 Badge

- No explicit badge-count implementation found in native (no code that sets/clears app icon badge from unread messages/matches).

---

## 3. Gap Analysis — What’s Missing (Native vs Ideal)

| Area | Gap |
|------|-----|
| **Event lifecycle** | No automated “event starting in 30m/5m” or “event is live” from cron; only admin manual. Native same as web. |
| **Date reminder** | Web can schedule local date reminders (usePushNotifications); no server-sent date_reminder push. Native has no local scheduling; no server trigger found. |
| **Vibe notification** | vibe-notification Edge Function does not send push; only swipe-actions sends push for “someone vibed you”. Mutual vibe in-app message from vibe-notification is not push. |
| **Registration confirmed** | No “event registration confirmed” push in code. |
| **Event ended** | No “event ended — see your matches” push. |
| **Subscription/premium** | stripe-webhook sends credits notification; no “subscription confirmed” or “premium activated” push found; revenuecat-webhook not audited here. |
| **Account/safety** | No push for account deletion scheduled/cancelled, pause/resume, report update. |
| **Re-engagement** | No “haven’t opened in X days” or weekly summary. |
| **In-app center** | Web has NotificationContainer (match/message/event/date_proposal toasts); native has no in-app list/history. |
| **Badge** | Native does not set/clear badge from unread counts. |
| **Deep link map** | data.url is web path (/chat/x, /matches, /event/x/lobby); native must map these to Expo routes (e.g. /chat/[id], /(tabs)/matches, /event/[eventId]/lobby). |
| **Rich notifications** | send-notification supports image_url (chrome_web_image); native image in notification depends on OneSignal payload (large_icon, etc.). Not consistently used per type. |
| **Sounds** | preference sound_enabled exists; no per-category sound or custom sounds in implementation. |

---

## 4. Benchmark Summary (Hinge, Bumble, Tinder)

- **Timing:** Push sent within seconds of match/message; no intentional long delay. Many apps avoid batching for high-signal events (match, message). In-app suppression common (e.g. no push if chat screen open for that thread). Quiet hours (e.g. 10p–8a) and daily cap (e.g. ~10/day) common.
- **Types:** New match, new message, message reaction/like, “someone liked you”, daily pick, event/date reminders (30m, 5m, live), profile boost, weekly digest, re-engagement (“We miss you”), date reminder, profile incomplete.
- **UX:** Rich notifications (sender/matcher photo), grouping (“3 new messages”), action buttons (Reply, View), distinct sounds (match vs message vs reminder), badge = unread count cleared when opening relevant screen, in-app notification center with history.

---

## 5. Complete Notification Catalog (E1)

All 44 notification types with proposed channel, copy, and rules.

| # | Name | Trigger | Channel(s) | Title template | Body template | Image | Sound | Deep link | Preference toggle | Priority | Timing | Suppress if |
|---|------|---------|------------|----------------|---------------|-------|-------|-----------|-------------------|----------|--------|-------------|
| 1 | New match (event lobby) | Mutual vibe at event | Push | It's a match! 🎉 | You have a new match! Start chatting now. | Partner photo | Match chime | /chat/{userId} | notify_new_match | High | Immediate | User in that chat |
| 2 | New message (text) | Chat message insert | Push | {senderName} | {preview ≤80 chars} | Sender avatar | Message tone | /chat/{userId} | notify_messages | High | Immediate | In that chat screen; or throttle 1/1min |
| 3 | New voice message | Voice message received | Push | {senderName} sent a voice message | Listen now | Sender avatar | Message tone | /chat/{userId} | notify_messages | High | Immediate | In that chat |
| 4 | New video message | Video message received | Push | {senderName} sent a video | Watch now | Sender avatar | Message tone | /chat/{userId} | notify_messages | High | Immediate | In that chat |
| 5 | Message reaction | Reaction to user's message | Push | {senderName} reacted to your message | e.g. ❤️ | Sender avatar | Default | /chat/{userId} | notify_messages | Medium | Immediate | In that chat |
| 6 | Match unmatch | (Optional) Partner unmatched | Push or none | — | — | — | — | — | notify_new_match or off | Low | Immediate | — |
| 7 | Date proposal received | New date proposal | Push | Date request from {name} | Video date — tap to respond | Partner avatar | Default | /schedule or /date/proposal/{id} | notify_date_reminder | High | Immediate | — |
| 8 | Date proposal accepted | Proposal accepted by partner | Push | {name} accepted! 📅 | Your video date is on — tap to see time | Partner avatar | Default | /schedule or /date/{sessionId} | notify_date_reminder | High | Immediate | — |
| 9 | Date proposal declined | Proposal declined | Push | {name} couldn't make it | You can propose another time | — | Default | /schedule | notify_date_reminder | Low | Immediate | — |
| 10 | Event registration confirmed | User registered for event | Push | You're in! 🎫 | {eventTitle} — {date/time} | Event cover | Default | /event/{eventId}/lobby | notify_event_reminder | Medium | Immediate | — |
| 11 | Event starting in 30 min | Cron 30m before start | Push | {eventTitle} in 30 minutes | Get ready to meet people live | Event cover | Gentle bell | /event/{eventId}/lobby | notify_event_reminder | Medium | Scheduled | — |
| 12 | Event starting in 5 min | Cron 5m before | Push | {eventTitle} starts in 5! ⏰ | Join the lobby now | Event cover | Gentle bell | /event/{eventId}/lobby | notify_event_reminder | High | Scheduled | — |
| 13 | Event is LIVE | Event status → live (or cron) | Push | {eventTitle} is live! 🎉 | Join now and start meeting people | Event cover | Default | /event/{eventId}/lobby | notify_event_live | High | Immediate | — |
| 14 | Event ended — matches | Event ended, had registrants | Push | {eventTitle} ended | See your matches from tonight | Event cover | Default | /event/{eventId} or /matches | notify_event_reminder | Low | Immediate | — |
| 15 | New event in your city | New event matching user city | Push | New event near you: {title} | {date} — tap to register | Event cover | Default | /events/{eventId} | notify_recommendations | Low | Batched | — |
| 16 | Event almost full | Capacity e.g. ≥90% | Email / Push | "{eventTitle}" is {pct}% full! | Register now | — | — | /events/{eventId} | notify_event_reminder | Low | Immediate | — |
| 17 | Daily drop available | Cron after generate-daily-drops | Push | 💧 Your Daily Drop is ready | Someone new is waiting. Open to see who. | Blurred or generic | Drop sound | /(tabs)/matches (drop tab) | notify_daily_drop | High | Scheduled (~6 PM) | — |
| 18 | Opener received (daily drop) | Partner sent opener | Push | 💧 Your Daily Drop sent you a message | Reply before 6 PM tomorrow to unlock chat | — | Drop sound | /(tabs)/matches | notify_daily_drop | High | Immediate | — |
| 19 | Reply received (daily drop) | Partner replied; match unlocked | Push | You're connected! 🎉 | You and {name} matched through Daily Drop | Partner photo | Match chime | /chat/{userId} | notify_new_match | High | Immediate | — |
| 20 | Drop expiring soon | Unviewed drop, e.g. 1h before expire | Push | Your Daily Drop expires soon | Open now to see who and reply | — | Default | /(tabs)/matches | notify_daily_drop | Medium | Scheduled | — |
| 21 | Partner ready (ready gate) | Other party marked ready | Push | Video date ready! 📹 | Someone is waiting — tap to join | Partner avatar | Urgent double-tone | /date/{sessionId} | notify_ready_gate | High | Immediate | On date/ready screen |
| 22 | Date starting now | Both ready, room started | Push | Your date is starting now | Join before they leave | Partner avatar | Urgent | /date/{sessionId} | notify_ready_gate | High | Immediate | — |
| 23 | Reconnection attempt | Partner reconnecting after drop | Push | {name} is reconnecting… | Tap to rejoin the date | — | Default | /date/{sessionId} | notify_ready_gate | Medium | Immediate | — |
| 24 | Someone vibed you | Vibe at event (non-mutual) | Push | Someone vibed you! 💜 | Join the event to find out who | — | Default | /event/{eventId}/lobby or /events | notify_someone_vibed_you | Medium | Immediate | In that lobby |
| 25 | Super vibe received | Super vibe at event | Push | Someone sent you a Super Vibe! ✨ | You stand out — join the event | — | Default | /event/{eventId}/lobby | notify_someone_vibed_you | High | Immediate | In that lobby |
| 26 | Mutual vibe — match | Mutual vibe at event | Push | It's a mutual vibe! 💜 | You and {name} vibed — it's a match! | Partner photo | Match chime | /chat/{userId} | notify_new_match | High | Immediate | In that lobby |
| 27 | Who liked you (premium teaser) | Count update for premium | Push | {n} people vibe with you | Upgrade to see who | — | Default | /premium | notify_recommendations | Low | Batched | — |
| 28 | Welcome to Vibely | Post signup / onboarding | Push | Welcome to Vibely! 🌟 | Complete your profile and join your first event | — | Default | /(tabs) or /profile | (account) | Low | Once | — |
| 29 | Profile incomplete | Missing photos/bio after 24h | Push/Email | Add photos to get more matches | Profiles with 3+ photos get 2x more matches | — | — | /profile | (account) | Low | Drip | — |
| 30 | Phone verification reminder | Not verified, after delay | Push | Get your trust badge | Verify your phone on web | — | Default | Web settings | (account) | Low | Drip | — |
| 31 | Email verification reminder | Email not verified | Push/Email | Verify your email | So we can send you important updates | — | — | — | (account) | Low | Drip | — |
| 32 | Subscription confirmed | Premium purchase success | Push | You're Premium! ✨ | Enjoy unlimited likes and more | — | Default | /(tabs) or /premium | notify_credits_subscription | Low | Immediate | — |
| 33 | Subscription expiring soon | 3 days before period end | Push | Your Premium expires in 3 days | Renew to keep your benefits | — | Default | /premium | notify_credits_subscription | Medium | Scheduled | — |
| 34 | Credits purchased | Credits pack bought | Push | Credits added! ⚡ | {pack} pack purchased | — | Default | /settings or /credits | notify_credits_subscription | Low | Immediate | — |
| 35 | Low credits balance | Credits below threshold | Push | Running low on credits | Top up to keep extending dates | — | Default | /credits | notify_credits_subscription | Medium | Once per day | — |
| 36 | Premium feature teaser | Upsell moment | Push | Unlock Super Vibes | Stand out at events | — | Default | /premium | notify_recommendations | Low | Rate limited | — |
| 37 | Haven't opened in 3 days | Re-engagement | Push | We miss you! 💜 | Your vibes are waiting | — | Default | /(tabs) | notify_recommendations | Low | Scheduled | — |
| 38 | Haven't opened in 7 days | Re-engagement | Push | It's been a week — come back | New matches could be waiting | — | Default | /(tabs) | notify_recommendations | Low | Scheduled | — |
| 39 | Weekly vibe summary | Weekly digest | Push/Email | Your week on Vibely | X matches, Y messages… | — | — | /(tabs) | notify_recommendations | Low | Weekly | — |
| 40 | Account deletion scheduled | User requested deletion | Push | Account deletion scheduled | Your account will be deleted on {date}. Cancel in settings. | — | Default | /settings/account | (safety, locked ON) | High | Immediate | — |
| 41 | Account deletion cancelled | User cancelled deletion | Push | Account deletion cancelled | Welcome back! 🎉 | — | Default | /(tabs) | (safety) | Low | Immediate | — |
| 42 | Report status update | Report resolved/updated | Push | Update on your report | We've looked into your report. Tap for details. | — | Default | /settings or in-app | (safety) | High | Immediate | — |
| 43 | Account paused confirmation | User paused account | Push | Account paused | You won't get matches or messages until you resume. | — | Default | /settings/account | (safety) | Low | Immediate | — |
| 44 | Account resumed | User resumed account | Push | Welcome back! | Your account is active again. | — | Default | /(tabs) | (safety) | Low | Immediate | — |

---

## 6. Preferences Design (E2)

| Toggle | Default | Controls (catalog #) |
|--------|---------|----------------------|
| Messages | ON | 2, 3, 4, 5, 7, 8, 9 |
| Matches | ON | 1, 26, 27 |
| Events | ON | 10, 11, 12, 13, 14, 15, 16 |
| Daily Drop | ON | 17, 18, 19, 20 |
| Video Dates | ON | 21, 22, 23 |
| Vibes & Social | ON | 24, 25 |
| Marketing & Tips | OFF | 36, 37, 38, 39 |
| Account & Safety | ON (locked) | 28–35, 40–44 |

Native settings screen should mirror these; “Quiet hours” and “Sound” can link to web or be added later.

---

## 7. Timing Rules (E3)

- **Immediate:** 1, 2, 3, 4, 5, 7, 8, 9, 13, 18, 19, 21, 22, 24, 25, 26, 32, 34, 40, 42, 43, 44.
- **Batched (e.g. max 1 per 5 min per user):** Event updates, social (15, 27, 36).
- **Scheduled:** 11, 12 (cron), 17 (daily drop time, e.g. 6 PM local), 20, 33, 37, 38, 39.
- **Suppress if in-app:** Messages when chat screen for that match is open; match when in that event lobby; ready gate when on date/ready screen.
- **Quiet hours:** Respect device DND; optional app quiet hours 11 PM–8 AM except ready_gate, event_live, safety.
- **Rate limit:** Max 10 push per day overall; max 3 marketing (36–39) per week.

---

## 8. Deep Link Mapping (E4)

| Notification | data.url (or equivalent) | Native screen |
|-------------|---------------------------|----------------|
| New match | /chat/{userId} or match_id | /chat/[id] (id = other user profile id) |
| New message | /chat/{match_id} | /chat/[id] |
| Daily drop | /matches | /(tabs)/matches (focus drop tab if exists) |
| Daily drop opener/reply | /matches or /chat/{match_id} | /(tabs)/matches or /chat/[id] |
| Event starting / live / ended | /event/{eventId}/lobby | /event/[eventId]/lobby |
| Event list | /events | /(tabs)/events |
| Ready gate / date | /date/{sessionId} or /matches | /date/[id] |
| Date proposal | /schedule | /schedule |
| Credits / settings | /settings | /settings |
| Premium | /premium | /premium |
| Profile | /profile | /(tabs)/profile |
| Account | /settings/account | /settings/account |

Ensure OneSignal/Expo config maps these paths (or a single app URL with query params) to the above Expo routes.

---

## 9. Badge Strategy (E5)

- **Badge count:** Total unread = unread messages + unviewed new matches + unread daily drop items (or equivalent). Optionally add “event today” if desired.
- **Tab badges:** Matches tab = message + match count; Events tab = e.g. “event today” indicator.
- **Clear:** When user opens the relevant screen (chat, matches, event lobby), clear that portion of badge. On app foreground, optionally recalc from server and set badge (0 if all read).
- **Implementation:** Use OneSignal/Expo APIs to set badge number; subscribe to unread counts from existing APIs (matches, messages).

---

## 10. Rich Notifications (E6)

| Type | Image |
|------|--------|
| New match | Partner's first photo |
| New message | Sender avatar |
| Event starting / live | Event cover |
| Daily drop | Blurred partner or generic drop asset |
| Ready gate / date | Partner avatar |

send-notification already supports image_url; extend callers to pass it. On native, use OneSignal’s large_icon / big picture and ensure payload includes image URL.

---

## 11. Sound Strategy (E7)

| Category | Sound |
|----------|--------|
| Match | Custom “vibe” chime (post-launch) |
| Message | Default message tone |
| Event reminder | Gentle bell |
| Ready gate / date starting | Urgent double-tone |
| Daily drop | Unique drop sound (post-launch) |
| All others | Default system |

Respect sound_enabled in notification_preferences. Custom sounds are post-launch; document for future.

---

## 12. Implementation Priority

| Priority | Scope | Items |
|----------|--------|--------|
| **P0 (launch blocking)** | Must work for launch | 1, 2, 4, 17, 18, 19, 21, 34; deep link map for /chat, /matches, /date, /event; permission flow; backend already sends to mobile_onesignal_player_id. |
| **P1 (first update)** | High value, short term | 7, 8, 9, 10, 11, 12, 13, 22, 24, 25, 26; badge count and clear; preferences parity (all toggles); optional event cron for 11/12/13. |
| **P2 (future)** | Nice to have | 3, 5, 6, 14, 15, 16, 20, 23, 27–33, 35–44; in-app notification center; rich images everywhere; custom sounds; re-engagement cron; email drip parity; account/safety pushes. |

---

## 13. OneSignal Segments (configure in dashboard)

Configure these segments in the OneSignal dashboard (not in code). Use them to send automated messages or trigger campaigns.

| Segment | Filter | Automated message (example) | Deep link |
|--------|--------|-----------------------------|-----------|
| **Incomplete Profile** | `onboarding_complete` = false, First Session > 24 hours ago | "Almost there! 📸 Add photos to get 3x more matches" | /(tabs)/profile |
| **Inactive 3 Days** | Last Session &lt; 3 days ago | "People are vibing without you 💜 Check out new events in your area" | /(tabs)/events |
| **Inactive 7 Days** | Last Session &lt; 7 days ago | "We miss you! 🌟 New events and matches are waiting" | /(tabs) |
| **Daily Drop Ready** | Triggered via API | Sent by generate-daily-drops Edge Function | — |
| **Event Registered** | Has active event registration for today | Managed by event-reminders cron, not OneSignal segments | — |

**Tags set by the app (for segmentation):** The native app sets OneSignal user tags after login and when profile is updated: `user_id`, `onboarding_complete` (true/false), `has_photos` (true/false), `is_premium` (true/false), `city`, `signup_date` (YYYY-MM-DD). Use these in the OneSignal dashboard to build the segments above (e.g. "Incomplete Profile" = `onboarding_complete` = false and First Session > 24h).

---

## References (files audited)

- **Web:** src/hooks/usePushNotifications.ts, useNotificationPreferences.ts, useEventVibes.ts; src/components/notifications/* (NotificationContainer, NotificationPermissionFlow, MessageNotificationCard, etc.); src/contexts/NotificationContext.tsx; src/lib/notifications.ts; src/components/admin/AdminEventControls.tsx, AdminEventFormModal.tsx; src/integrations/supabase/types.ts (notification_preferences, push_notification_events).
- **Edge:** supabase/functions/send-notification/index.ts, send-message/index.ts, swipe-actions/index.ts, daily-drop-actions/index.ts, generate-daily-drops/index.ts, event-notifications/index.ts, push-webhook/index.ts, stripe-webhook/index.ts.
- **Native:** apps/mobile/lib/onesignal.ts, usePushPermission.ts, useNotificationPreferences.ts; apps/mobile/components/notifications/NotificationPermissionFlow.tsx, PushRegistration.tsx; apps/mobile/app/settings/notifications.tsx; app.config.js.
