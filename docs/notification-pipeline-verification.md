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
| Web: Logout clears player ID | ✅ | `AuthContext.logout` nulls `onesignal_player_id` / `onesignal_subscribed` |
| Native: Logout clears player ID | ✅ | `signOut` nulls `mobile_onesignal_player_id` / `mobile_onesignal_subscribed` |
| send-notification in repo | ✅ | `index.ts` — **409** lines; reads web + mobile player columns |
| TypeScript clean | ✅ | `apps/mobile`: `npx tsc --noEmit` exit 0 |

## send-notification notes

- **API:** `POST https://api.onesignal.com/notifications` with `include_player_ids`.
- **Risk:** OneSignal has been moving toward subscription-based APIs; monitor deprecation of `include_player_ids`.
- **Env:** `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`, Supabase service role, etc.
