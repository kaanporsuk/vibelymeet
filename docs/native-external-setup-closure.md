# Native External Setup Closure Checklist

## Purpose

Use this as the final external-dependency closure checklist before TestFlight or Play internal distribution for `com.vibelymeet.vibely`.

This document does not replace `docs/native-external-setup-checklist.md`; it summarizes what the repo can verify, what provider dashboards must still prove, and the go/no-go gate for native release candidates.

Related docs:

- `docs/native-external-setup-checklist.md`
- `docs/kaan-launch-closure-execution-sheet.md`
- `docs/native-launch-closure-master-runbook.md`
- `docs/qa/native-rc-smoke-pack.md`
- `docs/qa/video-date-seeded-runtime-qa-pack.md`
- `docs/vibely-canonical-project-reference.md`

## Audit Summary

Audited sources:

- `docs/native-external-setup-checklist.md`
- `docs/active-doc-map.md`
- `apps/mobile/app.json`
- `apps/mobile/app.config.js`
- `apps/mobile/eas.json`
- `apps/mobile/package.json`
- `apps/mobile/.env.example`
- `apps/mobile/README.md`
- `scripts/native-launch-preflight.mjs`
- Existing OneSignal, RevenueCat, Daily, Bunny, Sentry/PostHog, EAS, Xcode, TestFlight, and Play docs under `docs/` and `apps/mobile/docs/`

Repo-verified:

- iOS bundle ID, Android package, and Expo scheme are all `com.vibelymeet.vibely`.
- Apple Team ID is recorded as `W38S57AM55`.
- EAS project ID is recorded in `apps/mobile/app.json`.
- EAS build profiles exist for `development`, `preview`, and `production`.
- `app.config.js` switches OneSignal mode to `production` for EAS `preview` and `production`.
- Daily, OneSignal, RevenueCat, Sentry, PostHog, Bunny media, and `expo-video` dependencies/config hooks are present.
- No runtime config mismatch was found that requires code changes in this pass.

Still manual:

- Provider dashboards, app-store records, credentials, signing, EAS secrets, and real-device proof cannot be verified from the repo alone.

## Identity And Store Records

| Area | Repo truth | Provider/dashboard closure |
| --- | --- | --- |
| iOS bundle ID | `com.vibelymeet.vibely` in `apps/mobile/app.json` | Apple Developer + App Store Connect app record must use the same bundle ID. |
| Android package | `com.vibelymeet.vibely` in `apps/mobile/app.json` | Google Play Console app and Firebase/FCM setup must use the same package. |
| Expo scheme | `com.vibelymeet.vibely` | Deep-link handling should be validated on installed builds. |
| Apple Team ID | `W38S57AM55` | Confirm team owns bundle ID and provisioning profiles. |
| OneSignal NSE bundle | `com.vibelymeet.vibely.OneSignalNotificationServiceExtension` | Confirm extension signing/capabilities in EAS/Xcode. |

## Apple Capabilities

Repo-declared iOS capabilities/permissions:

- Apple Sign In: `usesAppleSignIn: true`
- Push entitlement: `aps-environment` currently set to `development` in `app.json`
- OneSignal mode: overridden by `app.config.js` to `production` for EAS `preview` and `production`
- Background modes: `remote-notification`, `voip`
- Camera, microphone, photo library, and location usage descriptions
- OneSignal Notification Service Extension with app group `group.com.vibelymeet.vibely.onesignal`

Manual closure:

- [ ] Apple Developer bundle ID exists for `com.vibelymeet.vibely`.
- [ ] Sign In with Apple capability is enabled.
- [ ] Push Notifications capability is enabled.
- [ ] App Group for the OneSignal extension is configured if required by the build/signing flow.
- [ ] Main app and extension provisioning profiles are valid.
- [ ] App Store Connect app record exists.
- [ ] Subscription products required by RevenueCat exist and are ready for sandbox/TestFlight testing.

## Google / Android Setup

Repo-declared Android setup:

- Package: `com.vibelymeet.vibely`
- Permissions include internet/network, wake lock, post notifications, camera, microphone, foreground services, media reads, and location.
- Predictive back is disabled.

Manual closure:

- [ ] Play Console app exists for `com.vibelymeet.vibely`.
- [ ] Play App Signing / upload key path is configured.
- [ ] Internal testing track is ready.
- [ ] Subscription products required by RevenueCat exist and are active/testable.
- [ ] FCM/Firebase setup is available for OneSignal Android push.

## EAS Project, Credentials, And Profiles

Repo-verified:

- EAS project ID: `5c6f619c-3eea-4cbc-82f8-52b3875e0bf9`
- `development`: internal dev client
- `preview`: internal distribution
- `production`: store distribution

Manual closure:

- [ ] `eas whoami` is the expected Expo account/team.
- [ ] EAS project is linked to the app above.
- [ ] iOS credentials are configured for the main app and OneSignal extension.
- [ ] Android credentials/keystore are configured.
- [ ] Preview profile has all required secrets.
- [ ] Production profile has all required secrets.
- [ ] A preview build succeeds for iOS.
- [ ] A preview build succeeds for Android.

Useful commands:

```bash
cd apps/mobile
eas build --profile preview --platform ios
eas build --profile preview --platform android
```

## Required EAS Secrets

Required for normal preview/production RCs:

| Secret | Required | Notes |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Yes | Same Supabase project as web. |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Preferred mobile public key. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Fallback | Legacy fallback only. |
| `EXPO_PUBLIC_ONESIGNAL_APP_ID` | Yes for push | OneSignal project/app ID used by native builds. |
| `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` | Yes for iOS IAP | Public SDK key, not secret. |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` | Yes for Android IAP | Public SDK key, not secret. |
| `EXPO_PUBLIC_REVENUECAT_API_KEY` | Fallback | Only if using one generic RevenueCat public key. |

Recommended/optional:

| Secret | Use |
| --- | --- |
| `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME` | Profile/event/avatar image CDN. |
| `EXPO_PUBLIC_BUNNY_CDN_PATH_PREFIX` | Optional Bunny path prefix if required by the pull zone. |
| `EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME` | Vibe Video HLS/thumbnail playback. |
| `EXPO_PUBLIC_WEB_APP_URL` | Legal, reset-password, chat/date suggestion web links. |
| `EXPO_PUBLIC_APP_ORIGIN` | Credits checkout return origin where used. |
| `EXPO_PUBLIC_SENTRY_DSN` | Native error tracking. Leave unset to disable. |
| `EXPO_PUBLIC_POSTHOG_KEY` | Native analytics. Leave unset to disable. |
| `EXPO_PUBLIC_POSTHOG_HOST` | Defaults to `https://eu.i.posthog.com`. |
| `EXPO_PUBLIC_POSTHOG_DEV_ENABLED` | Enables PostHog in dev when set to `true`. |
| `EXPO_PUBLIC_VDBG_ENABLED` | Production opt-in for verbose video-date diagnostics during incident investigation. |

Do not commit secret values or screenshots that reveal secret values.

## OneSignal Closure

Repo-verified:

- `react-native-onesignal` and `onesignal-expo-plugin` are installed.
- `app.config.js` selects production OneSignal mode for EAS `preview`/`production`.
- App code registers native player IDs into `notification_preferences.mobile_onesignal_player_id`.
- Sign-out path clears OneSignal identity.
- OneSignal service extension bundle is declared for iOS.

Manual closure:

- [ ] OneSignal project exists and the native App ID is known.
- [ ] iOS app exists in OneSignal for `com.vibelymeet.vibely`.
- [ ] APNs key/cert is configured for TestFlight/store behavior.
- [ ] Android app exists in OneSignal for `com.vibelymeet.vibely`.
- [ ] FCM credentials/config are connected.
- [ ] `EXPO_PUBLIC_ONESIGNAL_APP_ID` is set in local env and EAS secrets.
- [ ] Real device sign-in writes `mobile_onesignal_player_id`.
- [ ] Real device receives a test push.
- [ ] Notification tap deep link is validated for at least one routed payload.

## RevenueCat Closure

Repo-verified:

- `react-native-purchases` is installed.
- Mobile wrapper prefers platform-specific public keys.
- Auth lifecycle calls `Purchases.logIn(userId)` and logs out on sign-out.
- Premium purchase/restore paths exist.
- `revenuecat-webhook` Edge Function exists.
- `sync-revenuecat-subscriber` Edge Function exists.
- Supabase migration for RevenueCat-backed subscriptions exists.

Manual closure:

- [ ] RevenueCat project exists.
- [ ] iOS app exists with bundle ID `com.vibelymeet.vibely`.
- [ ] Android app exists with package `com.vibelymeet.vibely`.
- [ ] App Store Connect subscription products exist and are linked.
- [ ] Play Console subscription products exist and are linked.
- [ ] Entitlement, for example `premium`, exists.
- [ ] Default offering contains packages expected by the app.
- [ ] Public SDK keys are stored in EAS secrets.
- [ ] `REVENUECAT_WEBHOOK_AUTHORIZATION` is set as a Supabase secret.
- [ ] RevenueCat webhook URL points to `https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook`.
- [ ] Sandbox/test purchase updates RevenueCat dashboard.
- [ ] Webhook updates `subscriptions` and `profiles.is_premium`.
- [ ] Restore flow works after reinstall or on a second device.

## Supabase Closure

Repo-verified:

- Mobile client reads `EXPO_PUBLIC_SUPABASE_URL` plus publishable/anon key.
- Native and web share the same backend contracts.
- RevenueCat and mobile push migrations/functions are present in repo.

Manual closure:

- [ ] EAS secrets point at the intended Supabase project.
- [ ] `supabase db push --linked --dry-run` is clean before release work.
- [ ] `revenuecat-webhook` is deployed if validating native IAP.
- [ ] `REVENUECAT_WEBHOOK_AUTHORIZATION` secret exists.
- [ ] Existing notification, Daily, media, and payment Edge Function secrets are present.

## Daily Closure

Repo-verified:

- Daily native SDK and config plugin are installed.
- Daily video-date path uses the shared `daily-room` Edge Function.
- Camera/microphone permissions are declared.
- Native video-date diagnostics add Sentry breadcrumbs when Sentry is enabled.

Manual closure:

- [ ] Daily project/domain/API key are valid for the target Supabase backend.
- [ ] `daily-room` Edge Function is deployed and has required provider secrets.
- [ ] iOS preview build can join a Daily room.
- [ ] Android preview build can join a Daily room.
- [ ] Leave/end flow cleans up local media and backend session state.

## Bunny / Media Closure

Repo-verified:

- Profile/event/avatar image URLs use `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME`.
- Optional image path prefix is supported by `EXPO_PUBLIC_BUNNY_CDN_PATH_PREFIX`.
- Vibe Video HLS/thumbnail playback uses `EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME`.
- Native Vibe Video uses `expo-video`; `expo-av` is not the playback path.

Manual closure:

- [ ] Bunny image CDN hostname matches web.
- [ ] Bunny Stream CDN hostname matches web.
- [ ] Pull-zone hotlink/token rules allow native playback.
- [ ] Profile/event images load on iOS and Android.
- [ ] Vibe Video playback works on iOS and Android.

## Sentry And PostHog Closure

Repo-verified:

- `@sentry/react-native` is installed and initialized when `EXPO_PUBLIC_SENTRY_DSN` is set.
- Sentry user context uses stable user id and strips email/IP from outgoing events.
- `posthog-react-native` is installed and initialized when `EXPO_PUBLIC_POSTHOG_KEY` is set.
- PostHog is disabled in Expo dev unless `EXPO_PUBLIC_POSTHOG_DEV_ENABLED=true`.

Manual closure:

- [ ] Sentry native project/DSN exists, if native error tracking is desired.
- [ ] `EXPO_PUBLIC_SENTRY_DSN` is set in EAS secrets for profiles where Sentry should run.
- [ ] Native source map/upload strategy is decided before store release.
- [ ] PostHog key/host are set if native analytics are desired.
- [ ] Native screen/event samples appear in the intended PostHog project.

## Preview Vs Production Profiles

| Profile | Purpose | Go/no-go expectation |
| --- | --- | --- |
| `development` | Dev client and local debugging | Useful for diagnosis; not a release-candidate proof by itself. |
| `preview` | Internal distribution/TestFlight-style QA | Required before declaring provider/device setup closed. |
| `production` | Store-ready artifacts | Use after preview is clean and provider dashboards are proven. |

OneSignal mode is production for `preview` and `production`, so preview builds are the right place to prove APNs/FCM behavior.

## Go / No-Go Checklist

Repo gate:

- [ ] `npm run launch:preflight` returns `"ok": true`.
- [ ] `npm run typecheck` passes.
- [ ] `cd apps/mobile && npm run rc-smoke` passes.
- [ ] `git diff --check` is clean for the release branch.

Provider gate:

- [ ] Apple Developer/App Store Connect ready for bundle ID and subscriptions.
- [ ] Play Console ready for package and subscriptions.
- [ ] EAS credentials/secrets ready for preview.
- [ ] OneSignal iOS/Android apps green.
- [ ] RevenueCat products/entitlements/offerings/webhook green.
- [ ] Supabase RevenueCat secret/function ready.
- [ ] Daily provider/secrets ready.
- [ ] Bunny media hostnames/rules ready.
- [ ] Sentry/PostHog decision made and envs set or intentionally unset.

Device proof gate:

- [ ] iOS preview build installs and opens.
- [ ] Android preview build installs and opens.
- [ ] Sign-in/session/onboarding works on both platforms.
- [ ] Native RC smoke pack passes for both target platforms or records accepted skips.
- [ ] RevenueCat purchase + restore + backend sync pass on at least one target platform before IAP release.
- [ ] OneSignal push receive + tap pass on both target platforms before push release.
- [ ] Daily video join/leave passes on both target platforms before video-date release.
- [ ] Video-date seeded runtime QA pack is run when the release touches event/date/Ready Gate/survey behavior.

No-go if:

- Any required EAS secret is missing for the tested profile.
- RevenueCat offerings are empty when premium/IAP is in release scope.
- Push player ID is not written after permission grant and sign-in.
- Daily join fails on a clean preview build.
- Build points to the wrong Supabase project.
- Provider dashboard status cannot be verified by the operator.

## Evidence To Record

Record outside Git if it contains account IDs, device IDs, or screenshots with private dashboard details.

Safe to record in repo docs:

- Build profile and build URL/hash without secrets.
- Pass/fail status.
- Provider status as "configured" or "blocked" without secret values.
- Follow-up issue/PR links.

Do not record:

- API keys, DSNs, tokens, JWTs, refresh tokens, or full provider secret screenshots.
- Personal account credentials.

