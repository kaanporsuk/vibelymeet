# Native RC Smoke Pack

## Purpose

Use this pack before TestFlight, Play internal distribution, or a production-style native release-candidate run. It focuses on operator-repeatable iOS/Android smoke coverage and links back to the shared golden path and seeded video-date QA packs.

References:

- `docs/golden-path-regression-runbook.md`
- `docs/qa/video-date-seeded-runtime-qa-pack.md`
- `docs/vibely-canonical-project-reference.md`
- `docs/native-external-setup-checklist.md`
- `docs/native-v1-rc-validation-matrix.md`
- `apps/mobile/README.md`

## Existing Assets Audited

- `apps/mobile/package.json`
  - `npm run typecheck`: `guard:no-expo-crypto` plus `tsc --noEmit`.
  - `npm run rc-smoke`: runs `apps/mobile/scripts/rc-smoke-check.sh`.
  - `npm run ios` / `npm run android`: local Expo native builds.
- `apps/mobile/scripts/rc-smoke-check.sh`
  - Always runs mobile typecheck.
  - Runs ESLint on native RC-touched surfaces.
  - Runs Maestro only when `MAESTRO_RUN=1` and the `maestro` CLI is installed.
- `apps/mobile/maestro/native-rc-smoke.yaml`
  - Cold-launches `com.vibelymeet.vibely` and waits for the auth shell.
- `.github/workflows/native-rc-smoke.yml`
  - Runs the host-safe native RC smoke on PRs/pushes that touch `apps/mobile/**`.
  - Does not run device/simulator Maestro flows in CI.
- `apps/mobile/eas.json`
  - `development`: dev client, internal distribution.
  - `preview`: internal distribution.
  - `production`: store distribution.
- `apps/mobile/app.config.js`
  - Uses OneSignal `production` mode for EAS `preview`/`production`; `development` mode otherwise.
  - Ensures `expo-video`, `expo-audio`, localization, Daily, OneSignal, and platform plugins are present.

This pack adds no new automation. It makes the existing checks and manual RC path hard to miss.

## Environment Selection

Choose the environment before installing or launching the build.

| Environment | Build style | Use when | Notes |
| --- | --- | --- | --- |
| Local dev client | `npm run ios`, `npm run android`, or EAS `development` | Xcode/Android Studio debugging, tunnel testing | Native modules require a custom/dev build; Expo Go is not sufficient. |
| EAS preview | `eas build --profile preview` | TestFlight/internal-style QA before store release | OneSignal APNs mode is production for preview builds. |
| EAS production | `eas build --profile production` | Store-ready artifact | Use only after preview smoke is clean. |

Required mobile env/EAS secrets:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` preferred, or legacy `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_ONESIGNAL_APP_ID`
- `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` and/or `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`, or fallback `EXPO_PUBLIC_REVENUECAT_API_KEY`
- Optional media hostnames: `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME`, `EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME`

Do not commit secrets. Use local `.env` for local builds and EAS secrets for EAS builds.

## Host-Safe Smoke

Run before installing any RC build:

```bash
cd apps/mobile
npm run rc-smoke
```

Expected:

- TypeScript passes.
- `guard:no-expo-crypto` passes.
- ESLint passes for RC-touched native surfaces.
- Maestro is skipped unless `MAESTRO_RUN=1`.

If this fails, stop before device testing.

## Local iOS / Xcode-First Validation

Prefer local iOS first when debugging a new native RC.

```bash
cd apps/mobile
npm run ios
```

Alternative for deeper debugging:

1. Open `apps/mobile/ios/mobile.xcworkspace` in Xcode.
2. Select scheme `mobile`.
3. Select a simulator or connected device.
4. Set Signing & Capabilities for `mobile` and `OneSignalNotificationServiceExtension` when building for a physical device.
5. Run from Xcode and keep the console open.

Pass criteria:

- Build succeeds.
- App opens without native crash.
- Auth shell or logged-in route appears.
- Xcode console does not show repeated provider init failures.

Known local iOS gotchas:

- If Xcode reports a build database lock, close competing Xcode/build processes and retry.
- Daily, OneSignal, RevenueCat, and `expo-video` require a custom/dev build. Expo Go is not enough.

## Local Device Tunnel Mode

Use tunnel mode when a physical device cannot reach local Metro directly:

```bash
cd apps/mobile
npx expo start --dev-client --tunnel
```

Then open the installed dev build on the device and connect to the tunnel.

Use tunnel mode for:

- Real-device camera/mic checks.
- Foreground/background behavior.
- Push identity setup with a dev build.
- Quick verification after a native UI change.

Do not use tunnel mode as proof that an EAS preview/TestFlight artifact is good; run the EAS preview smoke separately.

## EAS Preview Build Validation

Before building:

- [ ] EAS project is linked.
- [ ] Required EAS secrets are set for the selected profile.
- [ ] RevenueCat and OneSignal dashboards are configured for the bundle/package.
- [ ] Daily configuration is valid for the Supabase project under test.

Build:

```bash
cd apps/mobile
eas build --profile preview --platform ios
eas build --profile preview --platform android
```

Install the artifacts through TestFlight/internal distribution, EAS install links, or the appropriate device tooling.

Pass criteria:

- Build completes.
- App installs on target devices.
- App opens without a crash.
- Build points at the intended Supabase environment.

## Install / Open / Sign-In Smoke

Run on iOS and Android, with separate test accounts where possible.

| Step | Action | Expected outcome |
| --- | --- | --- |
| 1 | Fresh install/open | Splash/auth shell appears; no crash loop. |
| 2 | Sign in with an existing test user | Session is created and route gate resolves. |
| 3 | Kill and reopen app | Session persists and protected routes are available. |
| 4 | Sign out | Session clears; protected routes are blocked. |
| 5 | Sign in as a second user | No stale data or push identity from the first user is visible. |

Optional Maestro cold-launch smoke:

```bash
cd apps/mobile
MAESTRO_RUN=1 npm run rc-smoke
```

This verifies launch/auth-shell visibility only. Continue with the manual flows below.

## Auth / Session / Onboarding Gate

- [ ] Existing complete profile signs in and lands in the main app.
- [ ] Incomplete profile routes to onboarding.
- [ ] Onboarding can progress through required fields.
- [ ] Reload/kill/reopen preserves the correct gate.
- [ ] Password reset request shows a stable confirmation state.
- [ ] Sign-out clears protected data and provider identity.

## Event Lobby / Ready Gate / Date / Survey Path

Use `docs/qa/video-date-seeded-runtime-qa-pack.md` for the seeded two-user setup.

Minimum native RC pass:

- [ ] User enters a registered event lobby.
- [ ] Deck loads or a truthful empty/event-ended state appears.
- [ ] Swipe path works without duplicate cards or dead queue state.
- [ ] Ready Gate overlay/route opens for a valid session.
- [ ] Ready Gate countdown matches server `ready_gate_expires_at` after refresh/reconnect.
- [ ] Both-ready routes into `/date/[id]`.
- [ ] Daily room join works with camera/mic permissions.
- [ ] Date timer follows server truth after refresh/rejoin.
- [ ] End date -> post-date survey -> continuity route works.

## Chat Send-Message Path

- [ ] Open Matches.
- [ ] Open a known match thread.
- [ ] Send a text message.
- [ ] Confirm the message persists after leaving and reopening the thread.
- [ ] Confirm the partner sees the message on another device/session.
- [ ] Retry quickly and confirm no duplicate send regression.

If testing media:

- [ ] Send an image.
- [ ] Send a voice message if enabled.
- [ ] Send or preview a Vibe clip if enabled.
- [ ] Confirm failures show truthful retry/error states.

## Push Notification Identity Sanity

Device/app checks:

- [ ] Prompt appears at the intended time.
- [ ] Grant/deny paths do not crash.
- [ ] After sign-in, OneSignal identity binds to the active user.
- [ ] After sign-out/sign-in as another user, identity does not leak across accounts.

Read-only SQL:

```sql
-- read-only: verify mobile push identity for the signed-in smoke user
select
  user_id,
  mobile_onesignal_player_id is not null as has_mobile_player_id,
  mobile_onesignal_subscribed,
  updated_at
from public.notification_preferences
where user_id = '<user_id>'::uuid;
```

Provider check:

- [ ] OneSignal dashboard shows the device/subscription.
- [ ] A test notification reaches the device where platform rules allow it.
- [ ] Tapping a notification routes to the intended app surface when the payload supports deep linking.

## Media / Vibe Video Smoke

Native module constraint:

- The app uses `expo-video` for Vibe Video/HLS playback and Daily for live date video.
- Do not add or rely on `expo-av`; it is intentionally not the native video playback path.
- If a media failure looks like an `expo-video`/native module issue, capture device logs and the media URL shape before changing code.

Smoke:

- [ ] Profile Vibe Video thumbnail/render path loads.
- [ ] Open a Vibe Video; playback starts or shows a truthful error/retry state.
- [ ] Chat Vibe Clip preview/playback works if a fixture exists.
- [ ] Event/profile images load from the expected Bunny/CDN host.
- [ ] Missing media shows placeholders instead of crashing.

## Native Module Constraints

- Expo Go is not a valid RC environment for Daily, RevenueCat, OneSignal, or `expo-video`.
- Keep `apps/mobile/.npmrc` `legacy-peer-deps=true` until Daily publishes compatible Expo 55 peer ranges or the dependency conflict is otherwise resolved.
- Use EAS `preview`/`production` for production-style push/IAP behavior.
- Use local Xcode/Android Studio/dev client for diagnosis and fast iteration.

## What To Capture On Failure

- Platform, device model, OS version.
- Build profile and build URL/hash.
- Supabase environment/project ref.
- User id and event id, stored outside Git.
- Exact route/screen.
- Expected vs observed behavior.
- Screenshot or screen recording.
- Xcode/Android logs or EAS build logs.
- Relevant Edge Function/provider errors if visible.

## Sign-Off Template

```text
Environment:
Build profile:
Platform/device:
Build URL/hash:
Operator:
Date/time:

Host-safe rc-smoke: PASS / FAIL / SKIP
Install/open/sign-in: PASS / FAIL / SKIP
Auth/session/onboarding gate: PASS / FAIL / SKIP
Event lobby/Ready Gate/date/survey: PASS / FAIL / SKIP
Chat send-message: PASS / FAIL / SKIP
Push identity sanity: PASS / FAIL / SKIP
Media/Vibe Video: PASS / FAIL / SKIP
Native seeded video-date pack: PASS / FAIL / SKIP

P0/P1 findings:
Follow-up issue/PR:
Notes:
```

## What Remains Manual

- Installing EAS/TestFlight/Play artifacts on real devices.
- Sign-in credentials and account setup.
- Provider dashboard checks for OneSignal/RevenueCat/Daily.
- Camera/mic permission behavior.
- Two-user Ready Gate/date/survey timing.
- Push delivery and notification tap behavior.
- Media playback validation on real devices.

