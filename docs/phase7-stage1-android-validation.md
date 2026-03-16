# Phase 7 Stage 1 — Android Runtime Validation

## Goal

Validate Android runtime/device behavior and remove the highest-confidence runtime blockers. Scope: cold start, auth/session, onboarding gate, tab navigation, dashboard, profile, events, matches/chat, premium surfaces, notification entry points, media playback, crash-free baseline.

---

## 1. Commands run

From repo root:

```bash
cd apps/mobile
npm install
```

**Start Metro (no device attached):**

```bash
cd apps/mobile
npx expo start --android --port 8083
```

- **Result:** Metro started; exited with: `No Android connected device found, and no emulators could be started automatically.`
- **Implication:** Full runtime validation on Android must be done with a connected device or running emulator.

**TypeScript check:**

```bash
cd apps/mobile
npm run typecheck
```

- **Result:** `tsc --noEmit` reported multiple existing errors (matches, profile, daily-drop, settings, ui). One fix applied in this pass (settings: missing `radius` import); others pre-existing.

---

## 2. Inspection summary (no device available)

| Area | What was inspected |
|------|--------------------|
| **Bootstrap** | `app/_layout.tsx`: SplashScreen.preventAutoHideAsync in try/catch; useFonts(SpaceMono); hideAsync when loaded or error; no throw on font error. RootLayoutNav: QueryClient, AuthProvider, PushRegistration, ThemeProvider, Stack. |
| **Auth / session** | `context/AuthContext.tsx`: getSession + onAuthStateChange; resolveOnboarding(profiles) for onboarding gate. **Race:** getSession resolved with session then setLoading(false) before resolveOnboarding completed → Index could redirect to (tabs) while onboardingComplete was still null. Fixed in this pass. |
| **Index redirect** | `app/index.tsx`: loading → null; !session → sign-in; onboardingComplete === false → onboarding; else → tabs. **Fix:** when session exists but onboardingComplete === null, return null so we don’t send users to tabs before onboarding is resolved. |
| **Onboarding gate** | Redirect to `/(onboarding)` when onboardingComplete === false; after fix, we no longer redirect to tabs when onboarding is still resolving (null). |
| **Navigation** | Stack: index, (auth), (onboarding), (tabs), event lobby, chat, daily-drop, ready, date, settings, premium, vibe-video-record, user, match-celebration. Header hidden everywhere. |
| **Settings** | StyleSheet referenced `radius.lg` but `radius` was not imported from theme → would throw when Settings screen loads. **Fix:** added `radius` to theme import. |

No changes were made to dashboard, profile, events, matches, premium, notifications, or media playback logic; full validation of those flows requires a device/emulator run.

---

## 3. Fixes applied

| File | Change | Reason |
|------|--------|--------|
| `apps/mobile/app/index.tsx` | If `session` and `onboardingComplete === null`, return `null` instead of redirecting to (tabs). | Prevents sending users to tabs before onboarding check completes; avoids showing main app to users who still need onboarding. |
| `apps/mobile/app/settings/index.tsx` | Added `radius` to import from `@/constants/theme`. | `radius.lg` was used in StyleSheet; missing import causes ReferenceError when Settings screen loads. |

---

## 4. Remaining Android issues (by category)

### Blocker (must resolve for reliable validation)

- **No device/emulator run in this pass.** Full validation of cold start, auth, onboarding, tabs, dashboard, profile, events, matches, premium, notifications, and media requires:
  1. Connect an Android device (USB debugging) or start an Android emulator.
  2. From `apps/mobile`: `npx expo run:android` (dev client with native modules) or `npx expo start --android` and open the app on the device/emulator (Expo Go or existing dev client).
  3. Walk through: sign-in/sign-up, onboarding (if new), tab navigation, dashboard, profile, events list → detail → lobby, matches → chat, premium screen, notification prompt (if applicable), and any media/video screen.
  4. Note any crashes, red screens, or obvious runtime errors.

### Should-fix-soon (build/runtime quality)

- **TypeScript (tsc):** Multiple existing errors in `app/(tabs)/matches/index.tsx` (VibelyText missing `variant`), `app/(tabs)/profile/index.tsx` (SectionHeader/Text prop), `app/daily-drop.tsx` (VibelyButton missing `onPress`), `components/ui.tsx` (theme type strictness). Fix so `npm run typecheck` passes and to avoid runtime type/API misuse.
- **Daily / RevenueCat in Expo Go:** README states that video (Daily) and IAP (RevenueCat) require a dev build; they do not run in Expo Go. For full flow validation use a dev client (`npx expo run:android` or EAS build).

### Non-blocking

- **Font load failure:** Root layout logs a warning in __DEV__ and does not throw; app continues with system font. No change needed for stability.
- **RevenueCat __DEV__ LogBox:** Already ignored for configuration/offering messages.
- **CI mode:** When `CI=true`, Metro runs with reloads disabled; for local validation run without CI if you want fast refresh.

---

## 5. Android acceptable for provider validation?

**Conditionally yes**, after you complete device/emulator validation:

- **Done in this pass:** Bootstrap and splash are guarded; auth/session + onboarding gate race fixed; Settings no longer crashes on open due to missing `radius`.
- **Still required:** Run the app on a real device or emulator and confirm: cold start, sign-in/sign-up, session restore, onboarding gate, tab navigation, dashboard load, profile load, events list/detail/lobby, matches/chat, premium entry, notification prompt entry (if any), and media/video (with dev client). Fix any crashes or red screens found.
- **Provider validation (RevenueCat, OneSignal, Daily):** Requires a dev build and correct env/secrets; not validated in this Stage 1 pass.

---

## 6. Rebuild delta / docs

- **Config/build:** No change to app.json, eas.json, or native config.
- **Runtime assumptions:** Index now assumes that when `onboardingComplete === null` and session exists, we are still “loading” for routing purposes; we keep showing a blank screen until onboarding is resolved (same as initial load).
- **Docs:** This file (`docs/phase7-stage1-android-validation.md`) is the Phase 7 Stage 1 record. If you maintain a single “native validation” or “rebuild delta” doc, add: “Phase 7 Stage 1: auth/index onboarding race fix; settings radius import fix; Android device/emulator validation still required.”

---

## User action required: local Android validation

1. **Device or emulator**
   - Connect an Android phone with USB debugging, or start an Android emulator (e.g. from Android Studio).

2. **From repo root**
   ```bash
   cd apps/mobile
   npx expo start --android
   ```
   - If port 8081 is in use: `npx expo start --android --port 8083`
   - When Metro is up, open the app on the device (Expo Go or existing dev client).

3. **For full native modules (Daily, RevenueCat)**  
   Use a dev client:
   ```bash
   cd apps/mobile
   npx expo run:android
   ```
   (Requires Android SDK and device/emulator.)

4. **Smoke test**
   - Sign in (or sign up) → confirm redirect to onboarding or tabs.
   - Complete or skip onboarding as applicable → land on dashboard.
   - Open each tab: Home, Events, Matches, Profile.
   - Open Settings (confirm no crash).
   - Open Premium from Settings or Events.
   - Open an event → detail → lobby if available.
   - Open Matches → open a chat if available.
   - Note any crash, red screen, or stuck loading and report for a follow-up fix.
