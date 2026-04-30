# OneSignal Provider Operational QA

Branch: `fix/onesignal-provider-operational-qa`

## Problem

Streams 1-10 hardened the Event Lobby, Ready Gate, swipe, payment, realtime, and native video-date contracts. Stream 11 audits the push provider boundary so Vibely can verify OneSignal identity, worker assets, preference/player-id sync, backend send suppression, deep links, and receipt telemetry posture without changing notification product semantics or sending real production pushes.

## Audit Note

Audited:

- `src/lib/onesignal.ts`
- `index.html`
- `public/OneSignalSDK.sw.js`
- `public/OneSignalSDKWorker.js`
- `public/sw.js`
- `src/hooks/useAppBootstrap.ts`
- `src/lib/requestWebPushPermission.ts`
- `src/hooks/usePushDeliveryHealth.ts`
- `src/components/PushPermissionPrompt.tsx`
- `src/components/settings/NotificationsDrawer.tsx`
- `supabase/functions/send-notification/index.ts`
- `supabase/functions/push-webhook/index.ts`
- `supabase/functions/vibe-notification/index.ts`
- `apps/mobile/lib/onesignal.ts`
- `apps/mobile/components/PushRegistration.tsx`
- `apps/mobile/components/NotificationDeepLinkHandler.tsx`
- `apps/mobile/lib/pendingNotificationDeepLink.ts`
- `apps/mobile/app.config.js`
- `supabase/config.toml`

No Ready Gate, swipe, payment, realtime, pricing, notification category, provider preference, Edge Function, or Supabase schema behavior needed to change.

## Production Static Asset Checks

Read-only production checks were run against `https://vibelymeet.com` with redirects followed:

- `curl -I -L https://vibelymeet.com/OneSignalSDK.sw.js` -> 307 to `www`, then HTTP 200
- `curl -I -L https://vibelymeet.com/OneSignalSDKWorker.js` -> 307 to `www`, then HTTP 200
- `curl -I -L https://vibelymeet.com/sw.js` -> 307 to `www`, then HTTP 200

Local static posture:

- `public/OneSignalSDK.sw.js` imports the OneSignal v16 worker from `cdn.onesignal.com`.
- `public/OneSignalSDKWorker.js` imports the same OneSignal v16 worker for compatibility.
- `public/sw.js` remains the app-owned legacy service-worker shim and is not treated as proof that remote OneSignal push delivery works.

## Frontend OneSignal Identity

- Web OneSignal app identity is sourced from `VITE_ONESIGNAL_APP_ID`; no hardcoded app ID was found in `src/lib/onesignal.ts`.
- Web SDK initialization is deduped and root-scoped for the service worker.
- Web `setExternalUserId` is keyed by stable Supabase user ID and avoids noisy `OneSignal.login` calls on token refresh.
- Web logout clears the OneSignal external user and clears web player-id/subscription fields in `notification_preferences`.

The repo can verify that frontend and backend both use OneSignal app ID configuration, but it cannot compare the actual frontend and Supabase secret values without exposing provider configuration. The manual provider-dashboard checklist below covers that final app identity confirmation.

## Supabase Provider Preflight

Read-only Supabase checks were run against the linked canonical project:

- linked project: `schdyxcunwcvddlcshwd / MVP_Vibe`
- `send-notification`: deployed and active
- `push-webhook`: deployed and active
- `ONESIGNAL_APP_ID`: secret name present
- `ONESIGNAL_REST_API_KEY`: secret name present
- `PUSH_WEBHOOK_SECRET`: secret name present

Only secret names and digests were observed; no secret values were printed or used.

## Player-Id and Subscription Sync

Web:

- `syncWebPushRegistrationToBackend` binds OneSignal external user ID, polls the web push player ID, checks subscription state, and upserts `notification_preferences.onesignal_player_id` plus `onesignal_subscribed`.
- `usePushDeliveryHealth` refetches backend player/subscription state and retries sync on focus or OneSignal subscription change.
- Permission prompt and settings flows both use the same backend sync path.

Native:

- `apps/mobile/lib/onesignal.ts` reads `EXPO_PUBLIC_ONESIGNAL_APP_ID`, initializes OneSignal once, binds external user ID, polls native player ID, and upserts `notification_preferences.mobile_onesignal_player_id` plus `mobile_onesignal_subscribed`.
- `PushRegistration` binds identity on login and syncs on app foreground using existing AppState behavior.
- This stream tightened native identity binding so repeated calls for the same user do not repeatedly call `OneSignal.login`.

## `send-notification` Posture

Verified:

- Reads existing `ONESIGNAL_APP_ID` and `ONESIGNAL_REST_API_KEY` secrets.
- Collects web and native OneSignal player IDs from `notification_preferences`.
- Suppresses safely for missing preferences, paused account/notifications, disabled category, quiet hours, match mute, blocked pair, unknown category, no player ID, and provider failures.
- Preserves existing notification categories, quiet-hours bypass categories, and preference gates.
- Logs app-layer send/suppression outcomes to `notification_log`.
- Stores safe `push_delivery_diagnostic` context such as player presence, subscription booleans, provider attempt/status/http/error/id, and deep-link classification.
- Does not log OneSignal API keys, full provider payloads, profile names, media URLs, messages, or secrets.

`notification_log` remains the app-layer send/suppression log. It is not a guaranteed provider receipt ledger.

## Native OneSignal and Deep Links

Verified:

- Native uses the existing `onesignal-expo-plugin` and `react-native-onesignal` dependencies; no native module was added.
- `app.config.js` keeps OneSignal APNs mode tied to EAS build profile.
- Native notification click handling accepts `additionalData.url`, `deep_link`, `deepLink`, or `launchURL`.
- Native notification date links reconcile through backend date-entry truth before routing to `/date/[id]`.
- Foreground notifications suppress same-thread chat/date suggestion notifications without changing provider semantics.

## `push-webhook` Posture

`push-webhook` is deployed and secret-gated, but it is not proven wired to OneSignal delivery receipts from repository state alone. Its source accepts generic `fcm`, `apns`, and `web` provider event shapes and writes `push_notification_events`; it does not reference OneSignal app IDs, REST keys, or OneSignal receipt payloads.

Operationally:

- Treat `push_notification_events` as provider/webhook telemetry only when an external provider integration is confirmed.
- Do not treat it as guaranteed OneSignal delivery truth by default.
- Continue using `notification_log` and `push_delivery_diagnostic` for app-layer send/suppression observability.

## Code Fixes

- `apps/mobile/lib/onesignal.ts` now tracks the last successfully logged-in OneSignal user ID and skips duplicate `OneSignal.login` calls for the same Supabase user.
- No web, Edge Function, Supabase migration, notification category, preference, or provider payload semantics changed.

## Tests Added

- `shared/matching/onesignalProviderOperationalQa.test.ts`

Coverage:

- web OneSignal initialization uses configured app ID and root worker scope
- OneSignal root service-worker assets exist locally
- app-owned `public/sw.js` remains distinct from remote OneSignal push
- web and native identity binding dedupe repeated login calls
- web/native player-id and subscription sync writes `notification_preferences`
- `send-notification` reads OneSignal secrets and preserves suppression/provider logging
- notification deep-link payloads remain URL-based and native-compatible
- `push-webhook` is documented as not proven wired to OneSignal delivery receipts
- no env vars, native modules, `expo-av`, migrations, or provider semantics were added
- Streams 1-10 artifacts remain present

## Manual Provider-Dashboard Checklist

Before a push release or controlled internal push smoke:

1. Confirm frontend `VITE_ONESIGNAL_APP_ID` and backend `ONESIGNAL_APP_ID` refer to the same OneSignal app.
2. Confirm `ONESIGNAL_REST_API_KEY` belongs to that same app.
3. Confirm production origin/domain is configured in OneSignal.
4. Confirm service-worker setup matches the current OneSignal SDK requirement.
5. Confirm a controlled internal test user can grant permission and write `onesignal_player_id`.
6. Confirm backend send reaches OneSignal for a controlled internal test user only.
7. Confirm click deep-links through notification `data.url`.
8. Confirm preference gates suppress correctly.
9. Confirm whether `push-webhook` is wired to OneSignal receipts or intentionally unused.

No real production push smoke was run in this stream.

## Deploy Requirements

- Supabase migration deploy: not required
- Edge Function deploy: not required
- Web/static deploy: normal host deployment after merge only if web/public files changed
- Environment variables: none
- Native modules: none
- `expo-av`: not used
- Docker/local Supabase: not used

## Remaining Deferred Work

- Physical-device push notification QA with a controlled internal test user
- Screenshot-led native visual parity
- RevenueCat/native entitlement implementation if incomplete
- Broader native video-date visual polish
