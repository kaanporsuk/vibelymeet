# Mobile — Sprint 3: Chat + Notifications Parity

Sprint 3 implements chat (matches list, message thread, send message) and push notification registration on mobile using the same backend as web. No Daily Drop, Ready Gate, video dates, or RevenueCat.

## Repo contracts used

### Chat / messages
- **Matches list:** Web `useMatches` — `matches` table with `profile_id_1`/`profile_id_2`, joined to `profiles` and latest row from `messages` for last message and unread. Mobile `lib/chatApi.ts` `useMatches` mirrors this (same tables, same ordering).
- **Message thread:** Web `useMessages(otherUserId, currentUserId)` — finds match by profile pair, loads `messages` for that `match_id`. Chat route uses **other profile id** as `id` (e.g. `/chat/:id`). Mobile `useMessages` and `app/chat/[id].tsx` use the same contract; `id` = other user’s profile id.
- **Send message:** Web `useSendMessage` → Edge Function `send-message` with body `{ match_id, content }`. Inserts into `messages`, then invokes `send-notification` for recipient. Mobile uses same Edge Function; no direct table writes. *(Sprint 3 snapshot; voice/Vibe Clip today: see operative `docs/chat-video-vibe-clip-architecture.md`.)*
- **Realtime:** Web `useRealtimeMessages` subscribes to `postgres_changes` on `messages` for the match; invalidates queries. Mobile `useRealtimeMessages` in `lib/chatApi.ts` does the same.

### Notifications
- **Web:** OneSignal SDK in browser; `getPlayerId()` → subscription id stored in `notification_preferences.onesignal_player_id`, `onesignal_subscribed = true`. `send-notification` uses `include_player_ids: [prefs.onesignal_player_id]`.
- **Mobile:** OneSignal React Native (`react-native-onesignal` + `onesignal-expo-plugin`). After login, we request permission, get subscription id via `OneSignal.User.pushSubscription.getIdAsync()`, and upsert `notification_preferences` with `mobile_onesignal_player_id` and `mobile_onesignal_subscribed = true`. Same `send-notification` Edge Function now targets **all** non-null player IDs (web + mobile) so one user can receive push on both.

## Implemented in Sprint 3

1. **Matches screen** (`(tabs)/matches/index.tsx`): Loads matches via `useMatches`, shows avatar, name, last message preview, time, unread indicator. Tap opens `/chat/[otherProfileId]`. Loading, empty, error, pull-to-refresh.
2. **Chat thread** (`chat/[id].tsx`): Loads thread via `useMessages(id, currentUserId)`. Renders message list, input, Send. Sends via `send-message` Edge Function; realtime subscription for new messages. Loading, empty, send-in-flight, error.
3. **Push registration:** OneSignal initialized in app lifecycle. When user is logged in, `PushRegistration` requests permission, gets subscription id, calls `OneSignal.login(userId)`, and upserts `notification_preferences.mobile_onesignal_player_id` and `mobile_onesignal_subscribed`. On sign out, `OneSignal.logout()`.

## Backend / shared changes

1. **Migration `20260311200000_notification_preferences_mobile_player.sql`**  
   - Adds `mobile_onesignal_player_id` (TEXT) and `mobile_onesignal_subscribed` (BOOLEAN, default false) to `notification_preferences`.  
   - Additive; no change to web behavior.

2. **`supabase/functions/send-notification/index.ts`**  
   - Builds `playerIds` from both `onesignal_player_id` (web) and `mobile_onesignal_player_id` (mobile) when present and subscribed.  
   - Sends to `include_player_ids: playerIds` so delivery goes to all registered devices.  
   - Web impact: none; web still writes only `onesignal_player_id`; existing single-device behavior unchanged. Multi-device: if a user also has the mobile app and registers, they receive on both.

## Web impact

- **None** for existing web flows. Web continues to set only `onesignal_player_id`; `send-notification` still includes that ID. New columns are optional and only written by the mobile app.

## Gaps / limits after Sprint 3

- **Device-level push delivery:** Not validated on physical device or with production OneSignal/APNs/FCM credentials. Implemented path: init → request permission → get subscription id → upsert to backend; actual receipt of push on device depends on OneSignal app config, credentials, and device testing.
- **Read receipts:** Web has `read_at` on messages; mobile does not update read state in this sprint (can be added later using same schema).
- **Notification tap / deep link:** Mobile does not yet handle notification click to open a specific chat or screen; can be added via OneSignal notification click handler and app routing.

## Checks

- **Web:** `npm run typecheck:core`, `npm run build`, `./scripts/run_golden_path_smoke.sh` (from repo root).
- **Mobile:** `cd apps/mobile && npm run typecheck`.
- **Not run:** EAS build, device/emulator push tests, OneSignal dashboard delivery tests.

**Sprint 4:** Daily Drop + Ready Gate — see **`docs/mobile-sprint4.md`**.
