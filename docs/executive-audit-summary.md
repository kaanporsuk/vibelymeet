## Executive audit summary — Vibely native + backend hardening (last ~5 days)

### Audit window and scope

- **Window covered:** Approximately Wed Mar 11 – Fri Mar 13, 2026 (based on `git log --since="7 days ago"` and `fff9438..HEAD` diff).
- **Scope:** Native mobile build stream, backend/shared changes, web runtime hardening, env/config alignment, RevenueCat/OneSignal work, and Expo/EAS build prep on the `main` branch.
- **Method:** Evidence drawn from git history, migrations, Edge Functions, `apps/mobile` code, env/config files, and docs under `docs/**` and `_cursor_context/**`. No assumptions made about external dashboards or deployments without explicit in-repo evidence.

---

### 1. What was accomplished

**Backend and shared system**

- **Server-owned core flows landed (Streams 1B–2E).**  
  - Pause/resume, Ready Gate, Daily Drop, chat send, and swipe/match transitions are now implemented as **backend RPCs and Edge Functions**:
    - `profiles` pause columns and `account-pause` / `account-resume`.
    - `video_date_state_machine.sql` + `video_date_transition`.
    - `ready_gate_transition` and `daily_drop_transition`.
    - `send-message`, `swipe-actions`, `daily-drop-actions`.
  - Notifications for chat, swipes, matches, and Daily Drop are centralized in `send-notification`.

- **Entitlements model unified across Stripe and RevenueCat.**  
  - `subscriptions` gains a `provider` column and RevenueCat-specific fields, with `(user_id, provider)` uniqueness.
  - Trigger `sync_profiles_is_premium_from_subscriptions` keeps `profiles.is_premium` in sync with any active/trialing subscription.
  - Edge Function `revenuecat-webhook` maps RevenueCat events into this model.

**Native app and parity**

- **Initial Vibely native app implemented under `apps/mobile`.**  
  - Expo React Native app with:
    - Auth, onboarding, events, lobby, matches, chat, Daily Drop, Ready Gate, video date, premium, and settings screens.
    - Data-layer wrappers calling existing Supabase tables, RPCs, and Edge Functions.
  - Native integrations:
    - Supabase client using `EXPO_PUBLIC_SUPABASE_*`.
    - OneSignal wrapper storing `mobile_onesignal_player_id` in `notification_preferences`.
    - RevenueCat wrapper configured from platform-specific env keys.

- **Sprints 1–6 planned and documented.**  
  - `docs/native-build-architecture-plan.md` defines architecture and contracts.
  - `docs/mobile-sprint1.md` … `docs/mobile-sprint6.md` outline per-sprint objectives.
  - Additional docs cover launch readiness, external setup, manual test matrix, and deployment validation sequence.

**Web/runtime hardening**

- **Web app hardened for env, React duplication, and OneSignal runtime.**  
  - `.env.example` introduced with a clear **public env model** using `VITE_*` variables.
  - Supabase client uses `VITE_SUPABASE_PUBLISHABLE_KEY` with legacy fallback.
  - `vite.config.ts` dedupes `react` / `react-dom` to avoid hook/context issues when Expo is present.
  - `src/lib/onesignal.ts` gains safer initialization and error handling.

- **Env/config and build prep**

- **Env models for web and mobile aligned.**  
  - Web: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` and documented optional vars for Bunny, OneSignal, PostHog, Sentry, Stripe, RevenueCat.
  - Mobile: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and optional `EXPO_PUBLIC_*` vars for Bunny, OneSignal, RevenueCat.

- **Expo/EAS build configuration in place, with first Android dev build proven.**  
  - `apps/mobile/app.json` and `eas.json` define:
    - iOS bundle ID and Android package `com.vibelymeet.vibely`.
    - Notification entitlements (iOS extension) and Android permissions for notifications, camera, microphone, and foreground services.
    - Plugins for Daily, OneSignal, and Expo Router.
  - `apps/mobile/.npmrc` adds a **temporary** `legacy-peer-deps=true` workaround for Daily plugin peer-dependency issues.
  - **Android:** At least one **Android EAS development build has already succeeded end-to-end**, proving the Android build pipeline from repo checkout through EAS dev build once (confirmed via operator report, not CI logs in this repo).  
  - **iOS:** No in-repo or documented evidence yet of a successful iOS EAS/Xcode build; treat iOS build status as unverified.

- **Golden-path regression harness authored (web).**  
  - `docs/golden-path-regression-runbook.md` and `scripts/run_golden_path_smoke.sh` define a regression checklist and static smoke (`typecheck:core` + `build`) for the hardened web baseline.

---

### 2. What is in good shape

- **Backend system of record is consistent and mobile-ready.**  
  - All critical flows (pause, Ready Gate, Daily Drop, chat, swipe/match, video-date, entitlements) are now **server-owned**, callable from both web and mobile.
  - Migrations are additive and recorded with a clear manifest; hardening rules in `_cursor_context` are followed (no untracked schema drift in this window).

- **Native app structure is aligned with backend contracts.**  
  - `apps/mobile` calls into existing RPCs/Edge Functions rather than duplicating logic.
  - Notification prefs and entitlements use the same tables/functions as web, with provider-aware behavior.

- **Env and build configuration are explicit and internally consistent.**  
  - Web and mobile env examples are clearly separated and documented.
  - Expo/EAS configs match the intended production bundle IDs, entitlements, and plugins.
  - Android dev build has crossed the **“it actually builds”** threshold; the project is now in a **post–first Android build, pre–runtime-validation** state.

- **Documentation for operations and launch is unusually thorough.**  
  - Native architecture, launch readiness, external setup, and manual test matrix provide a solid base for ops, even before automated tests exist.

---

### 3. What is already proven vs still risky

**Build and backend readiness (proven)**

- Backend contracts and migrations for pause, Ready Gate, Daily Drop, chat, swipes, video date, notifications, and Stripe/RevenueCat entitlements are all landed on `main` and internally consistent.
- `apps/mobile` is wired to those same backend contracts; there is no mobile-only fork of core business logic.
- **Android EAS development build has succeeded at least once**, so the Android path from repo → dependencies → build is **de-risked at the pipeline level** (post–first-build, pre–runtime-validation).

**Functional/UI parity and runtime behavior (still risky)**

- There is no checked-in automated E2E coverage for shared flows (auth, events, matches, chat, Daily Drop, Ready Gate, video date, premium) on web or native.
- Native UI parity with web (layout, polish, edge-case handling) is not validated on devices; behavior under poor networks, backgrounding, and edge cases is still unknown.

**Provider/dashboard setup**

- **RevenueCat:**  
  - Backend webhook and entitlements schema are ready, but the repo contains no evidence of:
    - Product configuration, offering sets, or webhook URLs in the RevenueCat dashboard.
    - End-to-end tests of mobile purchase → webhook → entitlement reflection on real devices.

- **OneSignal:**  
  - Web and mobile code register player IDs, but:
    - App IDs, environment separation (dev/stage/prod), and production log verification live only in the OneSignal dashboard.

- **Daily:**  
  - State machine and docs assume Daily as the video provider; the repo does not record:
    - Native SDK-specific configuration, quality/performance tuning, or device-level behavior.

**Platform/store status**

- **Android:**
  - Build: at least one dev EAS build has succeeded.
  - Runtime/device validation: Daily, push, and RevenueCat flows still need systematic runs on real devices; no results are captured in git.
  - Play Console: no in-repo evidence of internal/production releases or subscription product configuration.

- **iOS:**
  - Build: no explicit evidence yet of a successful EAS or Xcode build.
  - TestFlight/App Store: no in-repo evidence of uploads, test groups, or production submissions.

---

### 4. Recommended next workstream (founder/operator view)

**Goal:** Move from “architecture and first Android build proven” to “end-to-end runtime behavior and providers validated across platforms.”  

- **1) Turn the Android dev build into a fully exercised golden path.**  
  - Take a fresh Android dev build from `main`, run the native manual test matrix (auth → events → lobby → swipes → matches → chat → Daily Drop → Ready Gate → video date → premium), and capture a short results section in `docs/native-launch-readiness.md`.  
  - Treat this as the first concrete Android sign-off and use it as a regression bar for future native work.

- **2) Bring iOS to the same “post–first-build” milestone.**  
  - Produce at least one successful iOS EAS/Xcode build using the committed configs.  
  - Run a trimmed subset of the manual matrix on simulator/device and note any iOS-specific issues (permissions, backgrounding, notifications).

- **3) Close the loop on providers with real traffic.**  
  - Configure RevenueCat webhook to the committed function, then run at least one sandbox purchase/restore flow and confirm `subscriptions`/`profiles.is_premium` behavior.  
  - Configure OneSignal mobile apps and send real test notifications (messages, matches, Daily Drop) to Android first (and then iOS), verifying deep links and foreground/background behavior.  
  - Exercise Daily video dates across web ↔ Android (and later iOS) to confirm state machine behavior and call quality.

- **4) Add a minimal, enforceable automation layer.**  
  - Wire `scripts/run_golden_path_smoke.sh` into CI for web to protect the hardened backend and routes.  
  - Add a very small Android smoke (EAS build + 1–2 critical Detox tests for auth and chat) to catch regressions without slowing development.

Once these are done, the project moves from **“post–first Android build with strong architecture”** to **“multi-platform, provider-backed system with at least one documented end-to-end validation pass”**, leaving most remaining risk in future feature changes rather than in foundational integration.

