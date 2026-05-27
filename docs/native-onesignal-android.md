# Native Android OneSignal Runbook

This document covers Vibely native Android push wiring for `apps/mobile`.

## Fixed Configuration

- Android package: `com.vibelymeet.vibely`
- iOS bundle identifier: `com.vibelymeet.vibely`
- OneSignal App ID source of truth: the confirmed OneSignal dashboard app used by web, native, and Supabase.
- Required client env var: `EXPO_PUBLIC_ONESIGNAL_APP_ID=<confirmed OneSignal App ID>`
- Web env var for the same app: `VITE_ONESIGNAL_APP_ID=<confirmed OneSignal App ID>`
- Supabase secrets for the same app: `ONESIGNAL_APP_ID` and `ONESIGNAL_REST_API_KEY`
- Supabase project ref: `schdyxcunwcvddlcshwd`
- OneSignal Android / FCM dashboard setup: completed for package `com.vibelymeet.vibely`

The historical UUID previously shown in this document is not a runtime fallback. If
`EXPO_PUBLIC_ONESIGNAL_APP_ID` is missing, native push initialization is disabled
for that build/runtime.

Do not put `ONESIGNAL_REST_API_KEY`, Supabase service-role keys, Firebase service account JSON, Google OAuth client secrets, Google Play service account JSON, Stripe secret keys, RevenueCat secret keys, or APNs private keys in the mobile app.

## Native Auth Architecture

Vibely native auth uses Supabase OAuth redirect flow and Supabase sessions. OneSignal identity binds to the Supabase user ID from the established session:

```ts
OneSignal.login(session.user.id)
```

This task does not require native Google Sign-In, Google Credential Manager, One Tap, Google `idToken` exchange, Android Google OAuth clients, SHA fingerprints, or Supabase Google provider credential changes.

## Expo And Firebase Configuration

The mobile app uses `onesignal-expo-plugin` and `react-native-onesignal`. The OneSignal Expo plugin must stay first in the resolved Expo `plugins` array.

Current Android config does not set `android.googleServicesFile`, so `google-services.json` is not required by the current Expo/Android app configuration. OneSignal Android delivery uses the OneSignal dashboard FCM credentials already configured for `com.vibelymeet.vibely`.

If a future change adds `android.googleServicesFile`, verify the referenced file exists and that:

```json
{
  "client": [
    {
      "client_info": {
        "android_client_info": {
          "package_name": "com.vibelymeet.vibely"
        }
      }
    }
  ]
}
```

If the file is missing or the package name does not match, stop and ask for `google-services.json` only. Never request or use the Firebase service account private key JSON that was uploaded to OneSignal.

## Build Requirement

OneSignal native push cannot be tested in Expo Go. Use an Expo development build, preview build, or other native Android build:

```sh
cd apps/mobile
npx eas build --profile development --platform android
# or
npx eas build --profile preview --platform android
```

A native rebuild is required whenever the installed binary does not already include the current OneSignal native dependency/plugin configuration.

## Android Test Procedure

1. Confirm `.env` or EAS env contains `EXPO_PUBLIC_ONESIGNAL_APP_ID=<confirmed OneSignal App ID>`.
2. Install a development or preview Android build on a device or emulator with Google Play Services.
3. Sign in through the existing Supabase OAuth/session flow.
4. Open notification settings or the app prompt flow and allow notifications.
5. In dev builds, check the Notifications screen diagnostic card:
   - OneSignal initialized: `yes`
   - Permission: `granted`
   - Subscription ID: `present`
   - Opted in: `yes`
   - Supabase user and OneSignal login match
6. Verify Supabase state for the signed-in user.

```sql
select
  user_id,
  mobile_onesignal_player_id,
  mobile_onesignal_subscribed,
  push_enabled,
  paused_until,
  updated_at
from public.notification_preferences
where user_id = '<SUPABASE_USER_ID>';

select
  user_id,
  provider,
  subscription_id,
  platform,
  subscribed,
  last_seen_at,
  updated_at
from public.push_subscriptions
where user_id = '<SUPABASE_USER_ID>'
  and provider = 'onesignal'
order by updated_at desc;
```

7. Send a test push from the existing backend send path or OneSignal dashboard.
8. Tap pushes for new match/chat, message, daily drop, ready gate, event live/lobby, and event details payloads. Confirm the native route opens and the dev diagnostic card shows the last sanitized open payload.

## Known Failure Modes

- Expo Go: native OneSignal module is unavailable.
- Missing `EXPO_PUBLIC_ONESIGNAL_APP_ID`: SDK status is `app_id_missing`.
- Native SDK initialization failure: SDK status is `init_failed`; restart the native runtime after fixing config because the app intentionally does not retry the same App ID repeatedly in one runtime.
- Wrong Android package in OneSignal/Firebase dashboard: FCM delivery fails.
- Stale installed build: app does not include the current native plugin/dependency state.
- Notification permission denied: app cannot register this device for push delivery.
- Android emulator/device lacks Google Play Services: FCM delivery may fail.
- OneSignal dashboard FCM credentials missing or mismatched: subscription may exist but pushes do not arrive.
- `push_enabled = false` or active `paused_until`: backend suppresses push delivery even if the device is registered.
- Backend payload contains both web and native route hints: native uses the structured `action` route for native-specific destinations such as Daily Drop.
- During sign-out, unregister is scoped to the local OneSignal subscription ID when available. If the SDK cannot read that ID, the app opts out/logs out locally and avoids bulk-deleting other native device rows for the same user.

## References

- OneSignal Expo SDK setup: https://documentation.onesignal.com/docs/en/react-native-expo-sdk-setup
- OneSignal React Native SDK setup: https://documentation.onesignal.com/docs/en/react-native-sdk-setup
