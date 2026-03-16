# Phase 7 Stage 4 — iOS Build and First-Pass Runtime Validation

## Goal

Produce the first verified iOS build and complete first-pass iOS runtime validation. Bundle ID: `com.vibelymeet.vibely`. Prefer local Xcode/local iOS build first; use EAS only if a shareable or store-like artifact is needed.

---

## Evidence from this run (post–JitsiWebRTC fix)

| What | Evidence |
|------|----------|
| **Commands run** | (1) `rm -rf .../DerivedData/mobile-*` then `npx expo run:ios --configuration Debug`. (2) First attempt failed: `error: unable to attach DB: ... build.db: database is locked` (concurrent Xcode build). (3) Second attempt: `npx expo run:ios --configuration Debug` — build proceeded past JitsiWebRTC [CP] Copy XCFrameworks and continued through Hermes, ReactNativeDependencies, libavif, expo-image, etc. Full build completion and install/launch were not captured in automation (long build). |
| **Build completed successfully?** | **Not verified in automation.** The native compile proceeds past JitsiWebRTC. To confirm full success: run `npx expo run:ios` locally and wait for "Build Succeeded" and simulator/device launch. |
| **App installed / launched?** | **Requires manual verification.** After a successful build, `expo run:ios` installs and launches the app; confirm on simulator/device. |
| **Runtime smoke** | **Requires manual verification.** No automated UI/simulator run was performed. Use the checklist in §3 and the steps in §9. |
| **Exact fixes applied (this pass)** | None. JitsiWebRTC fix was already in place (Phase 7 closure). This pass: re-ran build (lock then retry), updated Stage 4 doc with evidence, runtime checklist, blockers, completion status, Podfile note. |

---

## 1. Exact Commands and Build Path Used

### Prerequisites

- **macOS** with **Xcode** installed (Command Line Tools + iOS Simulator or device).
- **Node** and **npm** in repo root; `.env` present in `apps/mobile` with required `EXPO_PUBLIC_*` vars (Supabase, RevenueCat iOS, OneSignal, etc.).
- From repo root or `apps/mobile`: dependencies installed (`npm install` in `apps/mobile` or at monorepo root as applicable).

### Step 1: Generate native iOS project (if not present)

```bash
cd apps/mobile
npx expo prebuild --platform ios --no-install
```

- **Result (this run):** Success. Created/updated `./ios`, applied `onesignal-expo-plugin` (OneSignalNotificationServiceExtension), Daily/Expo plugins.
- **Note:** `ios/` is in `.gitignore`; it is generated and can be regenerated with `npx expo prebuild --platform ios --clean` if needed.

### Step 2: Build and run on iOS (simulator or device)

```bash
cd apps/mobile
npx expo run:ios
```

- **Behavior:** Runs `pod install` (if needed), then Xcode build for the `mobile` scheme, then launches the app on the default simulator (or device if selected). Starts Metro bundler unless you pass `--no-bundler`.
- **Alternative (build only, no launch):**  
  `npx expo run:ios --no-bundler` — builds the native app and installs on simulator without starting the dev server (useful for verifying compile-only).
- **Alternative (specific simulator):**  
  `npx expo run:ios --device "iPhone 16"` (or another simulator name from `xcrun simctl list devices`).

### Step 3: Open in Xcode (optional, for debugging)

```bash
cd apps/mobile
open ios/mobile.xcworkspace
```

- In Xcode: select scheme **mobile**, choose a simulator or a connected device, then **Product → Run** (⌘R).
- For device: ensure **Signing & Capabilities** uses your Team (e.g. `W38S57AM55` per `app.json`); provisioning may require an Apple Developer account.

---

## 2. iOS Build Blockers Found and Fixes Applied

| Item | Status |
|------|--------|
| **JitsiWebRTC [CP] Copy XCFrameworks** | **Fixed (Phase 7).** WebRTC.xcframework was missing the `ios-arm64` (device) slice. Podfile `post_install` now restores it from jitsi/webrtc v124.0.2 when missing. See `docs/phase7-ios-jitsi-webrtc-fix.md`. Build now gets past this step. |
| **Xcode build database locked** | **Environmental.** First `expo run:ios` attempt failed with `database is locked ... two concurrent builds`. Fix: close other Xcode builds or remove `~/Library/Developer/Xcode/DerivedData/mobile-*` and retry. |
| **Prebuild** | No blockers. `expo prebuild --platform ios` completes successfully. |
| **Compilation** | After JitsiWebRTC fix, compilation proceeds (Hermes, React Native, Daily, OneSignal, RevenueCat, expo-image, libavif, etc.). No compile errors observed in logs. |
| **Signing** | OneSignalNotificationServiceExtension and main app signing depend on Xcode/Team; set **Signing & Capabilities** for **mobile** and the extension if building for device. |

**Fixes applied in Stage 4 (this pass):** None beyond the existing JitsiWebRTC Podfile workaround. If you see a build error locally:

- **Code signing:** Set Team for **mobile** and **OneSignalNotificationServiceExtension** in Xcode.
- **Missing env:** Ensure `apps/mobile/.env` has `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and optionally RevenueCat/OneSignal keys.
- **Pods:** `cd apps/mobile/ios && pod install` then retry `npx expo run:ios`.

---

## 3. Runtime Findings by Screen / Flow (manual verification)

**No automated runtime smoke was run.** Verify the following manually on simulator or device after a successful build and launch. Fill the "Result" column when you run the flow.

| # | Area | What to check | Result (fill when run) |
|---|------|----------------|------------------------|
| 1 | **Cold start / splash / bootstrap** | Splash shows, then hides; no white screen or crash; font loads (or fallback). | |
| 2 | **Auth sign-in / session restore** | Sign-in or sign-up; kill app and reopen — session restores, user not sent back to login. | |
| 3 | **Navigation shell** | Tab bar visible; Dashboard, Events, Matches, Profile tabs switch; headers (GlassHeaderBar) render. | |
| 4 | **Dashboard** | Tab opens; content or empty state; no crash. | |
| 5 | **Profile** | Tab opens; profile loads; no crash. | |
| 6 | **Settings** | Open from profile or tab; screen loads; no crash. | |
| 7 | **Events** | List and event detail open; no crash. | |
| 8 | **Matches / chat** | Matches list and chat thread open; no crash. | |
| 11 | **Daily entry (baseline)** | From event lobby, start video date flow; join screen loads; grant camera/mic if prompted; no immediate crash. | |
| 9 | **Premium entry** | Open Premium screen (e.g. from Settings); offerings load or show “unavailable”; no crash. | |
| 10 | **Notification permission entry** | Entry points (e.g. after sign-in, or Settings → Notifications) do not crash; prompt may appear. | |
| 12 | **Crash-free baseline** | No crash during the above; check Xcode console for red errors. | |

---

## 4. Remaining Blockers (categorized)

### iOS build blocker

- **None** after the JitsiWebRTC fix. If a build fails locally: (1) Xcode build database locked → close other Xcode builds or remove `~/Library/Developer/Xcode/DerivedData/mobile-*` and retry; (2) code signing → set Team for **mobile** and **OneSignalNotificationServiceExtension** in Xcode.

### iOS runtime blocker

- **TBD by manual run.** To be filled after first successful launch (e.g. crash on startup, black screen, auth loop). Use the checklist in §3.

### Provider-side blocker

- Unchanged from Phase 7 Stage 5: RevenueCat/OneSignal/Daily proof still require real device or simulator runs and provider dashboards (see `docs/phase7-stage5-release-readiness-and-go-nogo.md` and `docs/native-final-blocker-matrix.md`).

### Non-blocking

- Simulator vs device differences (camera/mic, push).
- EAS/TestFlight build not yet run (optional until shareable artifact is needed).
- Run script build phase warnings (Expo Dev Launcher, Hermes) — do not block build.

---

## 5. Stage 4 completion status

- **Build path:** JitsiWebRTC blocker is fixed; the build proceeds past [CP] Copy XCFrameworks and compiles (Hermes, React Native, Daily, OneSignal, expo-image, etc.). Full "Build Succeeded" and install/launch were not observed in automation (long build / Xcode DB lock on first attempt).
- **Stage 4 is code-ready and build-path verified.** It is **genuinely complete** only after you run locally: (1) `npx expo run:ios` to completion, (2) confirm app installs and launches on simulator or device, (3) complete the runtime smoke checklist in §3 and note any runtime blockers. Until then, treat Stage 4 as **build-verified, runtime pending manual check**.

---

## 6. Podfile workaround (JitsiWebRTC ios-arm64)

- **Keep as-is for now.** The `post_install` hook in `apps/mobile/ios/Podfile` that restores the missing `WebRTC.xcframework/ios-arm64` slice from jitsi/webrtc v124.0.2 is the minimal fix and works with the current Expo/native project layout.
- **Regeneration-safe:** If you run `npx expo prebuild --platform ios --clean`, the `ios/` folder (including `Podfile`) is regenerated and this hook will be **lost**. Options for later: (1) Re-apply the same `post_install` block to the new Podfile after each clean prebuild, or (2) Move the fix into an Expo config plugin that patches the Podfile during prebuild so it survives regeneration. Until you need clean prebuilds regularly, re-applying the block is sufficient.

---

## 7. Suitability for Provider Validation / Beta

- **After first successful local build and launch:** The app is in a state suitable to continue **provider validation** (RevenueCat, OneSignal, Daily) and to progress toward **beta**, provided:
  - No runtime blockers appear (no startup or navigation crashes).
  - Env and provider keys (RevenueCat iOS, OneSignal, Supabase) are set for the build.
- **Recommendation:** Complete one full local `npx expo run:ios` run on your Mac, go through the checklist in §3, then fix any runtime blockers before EAS/TestFlight.

---

## 8. Rebuild Delta / Docs Update Note

- **iOS config/build assumptions:** No code or config changes in this Stage 4 pass beyond the existing JitsiWebRTC Podfile workaround (see `docs/phase7-ios-jitsi-webrtc-fix.md`). `app.json` has `ios.bundleIdentifier: com.vibelymeet.vibely`, `appleTeamId`, `deploymentTarget: 15.1`, and OneSignal extension. If you change bundle ID or team, run `npx expo prebuild --platform ios --clean` and re-apply the Podfile `post_install` hook if the generated Podfile does not include it.
- **Docs:** This file updated with evidence from this run, runtime checklist, remaining blockers, Stage 4 completion status, and Podfile workaround note.

---

## 9. User Actions: Exact Local iOS Validation Steps

1. **Terminal – build and run**
   ```bash
   cd /path/to/vibelymeet/apps/mobile
   npx expo run:ios
   ```
   Wait for “Build Succeeded” and simulator/device launch.

2. **If build fails**
   - Open `apps/mobile/ios/mobile.xcworkspace` in Xcode.
   - Select **mobile** scheme; pick a simulator or device.
   - **Signing & Capabilities:** Set Team for **mobile** and **OneSignalNotificationServiceExtension**.
   - **Product → Clean Build Folder**, then **Product → Run**.

3. **When app is running**
   - Go through the table in §3 (startup, auth, tabs, dashboard, profile, events, matches, chat, media, Premium, notifications).
   - Note any crash or stuck screen; share the Xcode console error for runtime blocker fixes.

4. **Optional: device instead of simulator**
   ```bash
   npx expo run:ios --device
   ```
   Pick the connected device when prompted; ensure the device is trusted and that your Apple ID has provisioning for `com.vibelymeet.vibely`.
