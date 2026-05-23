# Notification pipeline — final verification (2026-03-20)

## Summary table

| Check | Status | Notes |
|-------|--------|-------|
| Web: OneSignal-only permission path | ✅ | Dashboard uses `requestWebPushPermissionAndSync` → `promptForPush` + `getPlayerId` + upsert |
| Web: PushPermissionPrompt checks subscription | ✅ | Skips only when `Notification.permission === "granted" && subscribed` |
| Native: Dashboard registers after grant | ✅ | `requestPermission` then `registerPushWithBackend(user.id)` |
| Native: Schedule registers after grant | ✅ | Same handler pattern as Dashboard |
| Native: No aggressive auto-prompt | ✅ | `PushRegistration` uses `syncPushWithBackendIfPermissionGranted` only |
| Native: DeepLinkHandler exists + wired | ✅ | `NotificationDeepLinkHandler.tsx` + imported in `_layout.tsx` |
| Web: Logout clears player ID | ✅ | `AuthContext.logout` unregisters the current web subscription when available and nulls `onesignal_player_id` / `onesignal_subscribed` |
| Native: Logout clears player ID | ✅ | `signOut` unregisters the current OneSignal subscription, opts out locally, and clears legacy mobile columns |
| send-notification in repo | ✅ | Reads legacy web/mobile columns plus `push_subscriptions` when available |
| TypeScript clean | ✅ | `apps/mobile`: `npx tsc --noEmit` exit 0 |

## send-notification notes

- **API:** `POST https://api.onesignal.com/notifications` with `include_subscription_ids` and `target_channel: "push"`.
- **Compatibility:** The database column names still say `*_player_id`, but the stored values are OneSignal subscription IDs used by the current API. New native/web registrations also write `push_subscriptions`, which allows multiple devices per user and transfers a subscription to the currently authenticated owner.
- **Env:** `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`, Supabase service role, etc.
