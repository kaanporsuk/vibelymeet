# Phase 7 Closure — Typecheck and Repo-Ready for Device Proof

## Goal

Remove remaining repo-side blockers before manual/device proof: fix typecheck and confirm build/config does not block `expo run:android`, `expo run:ios`, or `expo start --dev-client --tunnel`.

---

## 1. Exact Commands Run

```bash
cd apps/mobile
npm run typecheck
# (after fixes)
npm run typecheck
npx expo config --type prebuild
```

---

## 2. Exact Typecheck Errors Found (Before Fixes)

| File | Line | Error |
|------|------|--------|
| `app/(tabs)/matches/index.tsx` | 100 | VibelyText missing required prop `variant`. |
| `app/(tabs)/matches/index.tsx` | 296 | VibelyText missing required prop `variant`. |
| `app/(tabs)/matches/index.tsx` | 297 | VibelyText missing required prop `variant`. |
| `app/(tabs)/matches/index.tsx` | 313 | VibelyText missing required prop `variant`. |
| `app/(tabs)/matches/index.tsx` | 334 | VibelyText missing required prop `variant`. |
| `app/(tabs)/matches/index.tsx` | 339 | VibelyText missing required prop `variant`. |
| `app/(tabs)/profile/index.tsx` | 550 | `Text` received prop `title` which does not exist on React Native Text (web-only). |
| `app/daily-drop.tsx` | 188 | VibelyButton missing required prop `onPress`. |
| `components/ui.tsx` | 157, 159, 161, 163, 165, 167, 169 | Chip: `theme` properties are `as const` literals; reassignment to different literals in branches caused type errors. Variables needed explicit `string` type. |

---

## 3. Exact Fixes Applied

| File | Change |
|------|--------|
| `components/ui.tsx` | In `Chip`, declared `backgroundColor`, `borderColor`, and `labelColor` as `string` so reassignments in variant branches type-check. |
| `app/(tabs)/matches/index.tsx` | Added `variant="body"` (line 100), `variant="titleSM"` and `variant="bodySecondary"` (296–297), `variant="caption"` (313), `variant="body"` (334, 339) to all VibelyText usages that lacked it. |
| `app/(tabs)/profile/index.tsx` | Replaced `title={getZodiacSign(...)}` with `accessibilityLabel={getZodiacSign(...)}` on the zodiac `Text` (RN Text has no `title`; use accessibility for screen readers). |
| `app/daily-drop.tsx` | Added `onPress={() => {}}` to VibelyButton inside Link/Pressable so the required prop is satisfied; parent Pressable/Link still handles navigation. |

---

## 4. Whether `apps/mobile` Now Typechecks Cleanly

**Yes.** `npm run typecheck` exits with code 0 and no output.

---

## 5. Whether Android Local Dev-Client Validation Is Repo-Ready

**Yes.** No code or config change in this closure blocks:

- `npx expo run:android` — prebuild and build path are documented; typecheck passes; expo config resolves.
- A connected device or emulator is required to run the app; that is a user/device step, not a repo blocker.

---

## 6. Whether iOS Local Build/Run Is Repo-Ready

**Yes.** No code or config change in this closure blocks:

- `npx expo run:ios` — prebuild succeeded in Phase 7 Stage 4; typecheck passes; expo config resolves.
- Signing and first launch must be done locally (Xcode/device); that is a user/device step, not a repo blocker.

---

## 7. Remaining Blockers (By Category)

### User/device-only

- **Android:** Connect device or start emulator; run `npx expo run:android` (or install EAS dev build); execute manual test matrix / Phase 7 runtime checklist.
- **iOS:** On Mac with Xcode, run `npx expo run:ios` (or install EAS build); set signing for **mobile** and **OneSignalNotificationServiceExtension** if needed; run first-launch and runtime checklist.
- **RevenueCat:** Complete a sandbox (iOS) or test (Android) purchase and restore on a real device; confirm webhook and DB.
- **OneSignal:** Receive a test push on a real device after dashboard and env are configured.
- **Daily:** Join a video date from lobby on device/simulator; confirm media and end/leave; confirm backend session ended.

### Provider-dashboard-only

- **RevenueCat:** Project, iOS/Android apps, products, entitlement, offering, webhook URL + auth; App Store Connect / Play Console products.
- **OneSignal:** iOS app (bundle ID, APNs), Android app (FCM); `EXPO_PUBLIC_ONESIGNAL_APP_ID` in .env and EAS secrets.
- **OneSignal web:** Production service-worker at domain root; OneSignal dashboard origin/service-worker for production.
- **Supabase:** Migrations applied; `revenuecat-webhook` deployed; `REVENUECAT_WEBHOOK_AUTHORIZATION` set.
- **EAS:** Secrets set for the build profile used (Supabase, OneSignal, RevenueCat).

### Still-code-side

- **None.** Typecheck passes; no known repo-side blocker for `expo run:android`, `expo run:ios`, or `expo start --dev-client --tunnel`.

---

## 8. Exact Next Step-by-Step Instructions for Kaan (Irreducible Manual/Device Steps)

### A. One-time setup (provider dashboards and secrets)

1. **Supabase**  
   - Apply migrations (notification_preferences mobile columns; subscriptions provider + trigger).  
   - Deploy: `supabase functions deploy revenuecat-webhook`.  
   - Set secret: `REVENUECAT_WEBHOOK_AUTHORIZATION` (e.g. `openssl rand -hex 32`); use the same value in RevenueCat webhook auth header.

2. **RevenueCat**  
   - Create/use project; add iOS app (bundle ID `com.vibelymeet.vibely`) and Android app (package `com.vibelymeet.vibely`).  
   - Link products from App Store Connect and Play Console; create entitlement (e.g. `premium`) and one offering with packages.  
   - Add webhook: URL `https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/revenuecat-webhook`, Authorization header = `REVENUECAT_WEBHOOK_AUTHORIZATION`.  
   - Copy public API keys; set `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` and `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` in `apps/mobile/.env` and in EAS secrets for the build profile.

3. **OneSignal**  
   - Same project as web or new; add iOS app (bundle ID `com.vibelymeet.vibely`), upload APNs key/cert; add Android app (package `com.vibelymeet.vibely`), add FCM.  
   - Set `EXPO_PUBLIC_ONESIGNAL_APP_ID` in `apps/mobile/.env` and in EAS secrets.

4. **EAS secrets** (for the profile you will use: e.g. preview)  
   - `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_ONESIGNAL_APP_ID`, `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`.  
   - Optional: `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME`, `EXPO_PUBLIC_BUNNY_STREAM_CDN_HOSTNAME`.

### B. Android device/emulator validation

1. Connect an Android device (USB debugging) or start an emulator.  
2. From repo: `cd apps/mobile && npx expo run:android`.  
3. When the app is installed and running: sign in, go through tabs (Dashboard, Events, Matches, Profile), open Premium (offerings should load if RevenueCat is configured), open Settings.  
4. Optional: trigger push registration (sign in and allow notifications); send a test from OneSignal dashboard; confirm receive.  
5. Optional: complete a sandbox/test purchase and restore; confirm in Supabase that `subscriptions` and `profiles.is_premium` update.

### C. iOS device/simulator validation

1. On a Mac with Xcode: `cd apps/mobile && npx expo run:ios`.  
2. If the build fails on signing: open `apps/mobile/ios/mobile.xcworkspace` in Xcode, select scheme **mobile**, set **Signing & Capabilities** with your Team for **mobile** and **OneSignalNotificationServiceExtension**, then run again.  
3. When the app is running: sign in, go through tabs, open Premium, open Settings.  
4. Optional: allow notifications when prompted; send test push from OneSignal; confirm receive.  
5. Optional: complete sandbox purchase and restore; confirm webhook and DB.

### D. Dev server with tunnel (optional)

1. `cd apps/mobile && npx expo start --dev-client --tunnel`.  
2. Open the app on device (already built with dev client); it will connect to the tunnel URL.  
3. Use for testing with a physical device on a different network.

### E. Record results

- Fill the **Sprint 6 / Phase 7 test results** table in `docs/native-final-blocker-matrix.md` (RevenueCat setup, real-device purchase/restore, OneSignal setup, real-device push, EAS build, iOS/Android device checklists, rebuild rehearsal) as you complete each step.

---

**Reference docs:**  
- Full checklist: `docs/native-external-setup-checklist.md`.  
- Runbook order: `docs/native-sprint6-launch-closure-runbook.md`.  
- iOS build/runtime: `docs/phase7-stage4-ios-build-and-runtime-validation.md`.  
- Manual tests: `docs/native-manual-test-matrix.md`.
