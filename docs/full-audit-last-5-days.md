## Vibely repo audit — last 5 days

**Audit focus window:**  
Based on commit timestamps in `git log --since="7 days ago"` and the diff from `fff9438` to `HEAD`, this audit covers the work from **Wed Mar 11 – Fri Mar 13, 2026** inclusive. That spans:

- Backend hardening streams 1B–2E (pause, Ready Gate, Daily Drop, notifications).
- Native planning and architecture docs plus sprint-by-sprint runbooks.
- Initial `apps/mobile` implementation (Sprints 1–6 scope) and parity flows.
- RevenueCat entitlements groundwork and webhook.
- Web/env/runtime hardening before native builds.
- Expo/EAS configuration and build unblocking.
- Final dependency alignment for Expo 55 on mobile.

All findings below are tagged as:

- **Confirmed from repo/history**: directly evidenced by git commits, file contents, or config.
- **Inferred from docs/comments**: plausible intent described in committed docs or comments but not fully verifiable from executable code.
- **Not verifiable from repo**: would require external dashboards, CI logs, or runtime inspection.

---

## Part A — Git history, chronology, and proof points

### 1. Branches and key commits in scope

**Confirmed from repo/history**

- **Primary branch**
  - `main` (also `origin/main`, `origin/HEAD`).

- **Feature / stream branches touching this window (visible in graph)**
  - `sprint-1-mobile-foundation`
  - `sprint-2-profile-events-discovery`
  - `sprint-3-chat-notifications`
  - `sprint-4-daily-drop-ready-gate`
  - `sprint-5-video-date`
  - `sprint-6-revenuecat-release`
  - `sync/final-prebuild-state` (and remote `origin/sync/final-prebuild-state`)
  - `sync/mobile-dependency-fix` (remote only)
  - Backend hardening streams:
    - `fix/pause-resume-backend`, `fix/pause-resume-followups` (Stream 1B)
    - `fix/video-date-state-machine` (Stream 2A)
    - `fix/ready-gate-atomicity` (Stream 2B)
    - `fix/daily-drop-server-ownership` (Stream 2C)
    - `fix/notification-side-effects-server-ownership` (Stream 2D)
    - `fix/chat-and-swipe-notifications-server-ownership` (Stream 2E)

- **Tag anchoring the pre-native baseline**
  - `pre-native-hardening-golden-2026-03-10` (on commit `5eef706`) — marks the hardened web baseline before the native stream.

**Key commits (last ~5 days)**

- **Native foundation + docs PR**
  - `70e3db7` — `feat: Vibely native app foundation, parity flows, and release-readiness groundwork (#10)`
    - Merges work from:
      - `483e282` — `docs: finalize native architecture plan and golden-path regression harness`
      - `79e91af` — `feat: add Vibely native app foundation, parity flows, and release-readiness groundwork`
      - `85c920f` — `docs: link deployment-validation-sequence in mobile README`

- **RevenueCat + subscriptions provider work (Sprint 6 backend pieces)**
  - Included in `70e3db7`:
    - Adds `supabase/functions/revenuecat-webhook/index.ts`.
    - Adds `supabase/migrations/20260311200000_notification_preferences_mobile_player.sql`.
    - Adds `supabase/migrations/20260312000000_subscriptions_provider_revenuecat.sql`.

- **Stream 1B–2E backend hardening series (Mar 11)**
  - `6e4c079` — `feat(pause): backend-authoritative account pause/resume (Stream 1B) (#3)`
    - Underlying branch: `fix/pause-resume-backend`.
  - `93a49b0` — `feat(video-date): add server-owned state machine and RPC (#5)`
    - Underlying branch: `fix/video-date-state-machine`.
  - `8857db4` — `Stream 2B: make ready gate transitions server-atomic (#6)`
    - Underlying branch: `fix/ready-gate-atomicity`.
  - `8ebd176` — `Stream 2C: move daily drop transitions to server (#7)`
    - Underlying branch: `fix/daily-drop-server-ownership`.
  - `0bfc76b` — `Stream 2D: move daily drop notifications server-side (#8)`
    - Underlying branch: `fix/notification-side-effects-server-ownership`.
  - `81b6057` — `Stream 2E: move chat and swipe notifications server-side (#9)`
    - Underlying branch: `fix/chat-and-swipe-notifications-server-ownership`.

- **Native Sprint 6 and release groundwork commits**
  - `472e306` — `chore: support platform-specific RevenueCat API keys in mobile`
  - `8f9e6d0` — `chore: align mobile app identifiers with Vibely shipping bundle ID`

- **Web/env/runtime hardening before native builds**
  - `899c54e` — `chore: align web env handling with public Vite variables`
  - `5ea24dd` — `fix: dedupe react in Vite and normalize AuthProvider import path`
  - `58f7bb1` — `fix: harden web runtime and webhook handling before native builds`

- **EAS / build-prep and final mobile dependency alignment**
  - `771537d` — `chore: unblock EAS install with temporary legacy-peer-deps for Daily Expo plugin mismatch`
  - `6d3ed9b` — `chore: finalize build-ready mobile config and docs`
  - `061878b` — `fix: resolve PR review blockers for chat error handling and Android permissions`
  - `f46fcde` — `fix: align mobile dependencies with Expo 55 requirements (#12)`

### 2. Merge chronology into `main`

**Confirmed from repo/history**

- The **backend hardening streams (1B–2E)** all landed on `main` prior to or alongside the native work:
  - Each stream has its own `fix/*` branch, merged via PRs (`#3`, `#5`, `#6`, `#7`, `#8`, `#9`), with their SQL migrations and Edge Functions now present on `main`.
- The **native PR `#10`** (`70e3db7`) merges:
  - Native architecture docs and golden-path regression harness.
  - Initial `apps/mobile` app, screens, and libraries.
  - Native sprint docs and launch-readiness docs.
  - RevenueCat webhook and entitlements schema changes.
- A later **sync branch `sync/final-prebuild-state`** mirrors a near-identical sequence of commits (harden web runtime, EAS unblock, build-ready mobile config) but is effectively superseded by the linearized commits on `main`.
- The **most recent commits on `main`** are tight, mobile-focused polish:
  - Hardening web runtime and OneSignal/RevenueCat integration before native builds (`58f7bb1`).
  - Adding `.npmrc` workaround for Daily plugin peer-deps (`771537d`).
  - Finalizing Expo/EAS config (`6d3ed9b`).
  - Fixing PR review blockers and Android permissions (`061878b`).
  - Aligning mobile dependencies to Expo 55 (`f46fcde`).

### 3. Logical phases/time windows (chronology)

**Phase 0 — Hardened web baseline and backend ownership (Streams 1B–2E)**  
**(Confirmed from repo/history)**

- Commits: `6e4c079`, `93a49b0`, `8857db4`, `8ebd176`, `0bfc76b`, `81b6057`.
- Outcomes:
  - `profiles` gets pause columns and pause semantics (`20260311120000_profiles_pause_columns.sql`).
  - Deck functions (`get_event_deck*`) become pause-aware and auth-guarded.
  - `video_sessions` gets a canonical `video_date_state` enum and `video_date_transition` RPC.
  - `ready_gate_transition` RPC is added as server-owned Ready Gate logic.
  - `daily_drop_transition` RPC is added as canonical Daily Drop state machine.
  - Edge Functions `daily-drop-actions`, `send-message`, `swipe-actions` are introduced or updated to use the new RPCs and to centralize notifications.

**Phase 1 — Native architecture, sprints, and golden-path docs**  
**(Confirmed from repo/history, with intent inferred from docs)**

- Commit: `70e3db7` and its doc sub-commits (`483e282`, `85c920f`).
- Outcomes:
  - Adds `docs/native-build-architecture-plan.md` (detailed architecture, contracts, and sprint plan).
  - Adds `docs/mobile-sprint1.md` … `docs/mobile-sprint6.md`.
  - Adds `docs/native-launch-readiness.md`, `docs/native-external-setup-checklist.md`, `docs/native-manual-test-matrix.md`, `docs/native-deployment-validation-sequence.md`, `docs/native-pr-summary.md`.
  - Adds `docs/golden-path-regression-runbook.md` and `scripts/run_golden_path_smoke.sh` (regression harness).

**Phase 2 — Native app foundation and parity flows (Sprints 1–6 implementation)**  
**(Confirmed from repo/history)**

- Commit: `70e3db7` (code portion `79e91af`) plus subsequent refinements.
- Outcomes:
  - Introduces `apps/mobile` Expo React Native app with:
    - Auth flows, onboarding, tabs, chat, events, Daily Drop, Ready Gate, video date, premium, and settings screens.
    - Data layer wrappers (`lib/*Api.ts`) that call into the same Supabase tables/RPCs/Edge Functions as web.
    - Push integration wrapper `apps/mobile/lib/onesignal.ts`.
    - RevenueCat wrapper `apps/mobile/lib/revenuecat.ts`.
  - Adds `apps/mobile/app.json`, `apps/mobile/.env.example`, `apps/mobile/eas.json`, and native assets.
  - Aligns mobile bundle/package IDs with production (`com.vibelymeet.vibely`).

**Phase 3 — RevenueCat entitlements and notification prefs alignment**  
**(Confirmed from repo/history)**

- Commits: `70e3db7` (for initial webhook + migrations), `472e306` (mobile RevenueCat envs and docs).
- Outcomes:
  - New Edge Function `supabase/functions/revenuecat-webhook/index.ts`.
  - New migrations for subscriptions provider model and mobile notification player IDs.
  - Mobile RevenueCat SDK wrapper that reads platform-specific env keys.

**Phase 4 — Web/env/runtime hardening before native builds**  
**(Confirmed from repo/history)**

- Commits: `899c54e`, `5ea24dd`, `58f7bb1`.
- Outcomes:
  - Adds `.env.example` for web with public Vite env model.
  - Centralizes Supabase URL/key handling with `VITE_SUPABASE_PUBLISHABLE_KEY`.
  - Hardens OneSignal web integration and main entrypoint.
  - Adjusts Vite config to dedupe React and avoid multiple React instances.
  - Tightens webhook and runtime behavior (especially RevenueCat and notifications).

**Phase 5 — Expo/EAS build-prep, first Android dev build, and dependency alignment**  
**(Confirmed from repo/history; Android build success confirmed from operator report)**

- Commits: `771537d`, `6d3ed9b`, `061878b`, `f46fcde`.
- Outcomes:
  - Adds `apps/mobile/.npmrc` with `legacy-peer-deps=true` to unblock install for Daily Expo plugin mismatch (explicitly marked temporary).
  - Adds `apps/mobile/eas.json` build profiles.
  - Updates `apps/mobile/app.json` with correct bundle IDs, permissions, and plugin configuration.
  - Adjusts `apps/mobile/package.json` dependencies to align with Expo SDK 55 and React Native 0.83, resolving PR review concerns.
  - **Android EAS development build:** per current operator report (outside git history), at least one **Android EAS development build has already succeeded**, proving the Android build pipeline end-to-end once. This moves the project from a purely “pre-build readiness” state into **“post–first Android build, pre–runtime/device-validation.”**

### 4. Proof points (as of this audit)

- **Confirmed from repo/history**
  - Backend Streams 1B–2E fully landed on `main` with migrations and Edge Functions present.
  - `apps/mobile` tree implements Sprints 1–6 scope and calls shared backend contracts.
  - RevenueCat webhook and subscriptions provider migrations are committed.
  - Web golden-path runbook and smoke script exist and are wired to `npm run typecheck:core` and `npm run build`.
  - Expo/EAS configuration for Android and iOS (bundle IDs, plugins, permissions) is checked in.

- **Confirmed via operator report (not visible in git/CI logs)**
  - At least one **Android EAS development build** has completed successfully using this repo and `apps/mobile/eas.json` profiles.
  - That build proves: repository checkout → dependency install → EAS build for Android dev profile is viable at least once.

- **Not verifiable from repo**
  - Any iOS EAS or Xcode build results.
  - Exact Supabase migrations/Edge Function deployment status in the target project (though deployment steps are fully documented).
  - Exact RevenueCat / OneSignal / Daily / store dashboard configuration beyond what is described in docs.

---

## Part B — Workstream-by-workstream audit

Below, each workstream captures: objective, files, backend/shared changes, web impact, build/runtime impact, and status.

### Auth/bootstrap closure hardening (2026-04-04)

Post-audit closure changes completed after the original hardening streams:

- Eliminated unknown-profile protected shell entry:
  - `src/components/ProtectedRoute.tsx` now blocks `profileStatus='unknown'` behind a recovery gate instead of rendering children.
- Removed latent signup fail-open reuse paths:
  - `src/contexts/AuthContext.tsx` `signUp(...)` now hard-errors as deprecated.
  - `apps/mobile/context/AuthContext.tsx` `signUp(...)` now hard-errors as deprecated.
  - `apps/mobile/lib/authApi.ts` `signUpWithEmail(...)` now returns a deprecated contract error and no longer performs direct Supabase signup.
- Cleaned bootstrap helper surface:
  - Removed `ensureBootstrapProfileExists(...)` wrapper from `apps/mobile/lib/profileBootstrap.ts`.
  - Kept `ensureProfileReady(...)` as the single canonical readiness contract.
  - Removed stale reason enums that no longer map to active ownership.

Resulting invariant:

- No unknown-profile state can render protected web shell content.
- No latent context/helper signup path can bypass canonical owner-controlled bootstrap readiness flow.

### Final registered-journey safe refinements (2026-04-05)

Post-closure polish with no backend schema/data contract changes:

- Reminder/join-date CTA hardening:
  - Web `Dashboard` reminder Join now prefers `/date/:id` when an active `in_handshake`/`in_date` session is present, else falls back to `/schedule`.
  - Web `Schedule` reminder Join now performs the same active-session check and fallback.
  - Native `schedule` reminder Join now uses its existing contextual join handler (active session deep-link first, chat fallback).

- VibeStudio shim minimization:
  - `src/pages/VibeStudio.tsx` was an intentional compatibility redirect at that audit point; current branch `feat/vibe-studio-foundation` promotes it to a dedicated studio surface.

- Auth/bootstrap ownership unchanged:
  - Signup/bootstrap owners remain: web `src/pages/Auth.tsx`, native `apps/mobile/app/(auth)/sign-in.tsx`.
  - No hydration-time profile creation was reintroduced.
  - Identity invariant remains unchanged (`profiles.id = auth.users.id`).

### 1. Native architecture / planning / runbooks

- **Objective**  
  - **Confirmed from docs**: Define a shared backend contract and sprint plan for web + native, ensure the native app sits cleanly on the hardened backend without forking logic.

- **Files changed (representative)**
  - `docs/native-build-architecture-plan.md`
  - `docs/native-v1-scope.md`
  - `docs/native-launch-readiness.md`
  - `docs/native-external-setup-checklist.md`
  - `docs/native-manual-test-matrix.md`
  - `docs/native-deployment-validation-sequence.md`
  - `docs/native-pr-summary.md`
  - `docs/mobile-sprint1.md` … `docs/mobile-sprint6.md`

- **Backend/shared changes involved**
  - None directly — these docs **describe** contracts for:
    - Auth, onboarding, events, swipes, Daily Drop, chat, Ready Gate, video date.
    - Notifications via `send-notification`.
    - Stripe (web) and RevenueCat (mobile) entitlements convergence.

- **Web impact**
  - **Confirmed / inferred**:
    - Docs explicitly state that web remains the primary baseline and native must not introduce breaking backend changes without web updates.
    - A web golden-path regression harness (runbook + script) is defined to validate shared behavior before/after changes.

- **Build/runtime impact**
  - **Not directly verifiable** — these are planning docs only, but they encode:
    - Expectations for CI (running `scripts/run_golden_path_smoke.sh`).
    - Device test matrix and production deployment validation order.

- **Completion assessment**
  - **What appears complete (confirmed from repo)**:
    - Comprehensive architecture and sprint plan is written and committed.
    - Launch readiness, external setup, and manual test matrix docs exist.
  - **What remains incomplete / unverified**:
    - Execution of the manual matrix and deployment sequence is **not recorded** in the repo. No CI logs or checklists are persisted beyond the doc text.

### 2. Sprint 1 mobile foundation

- **Objective**  
  - **Confirmed from docs + code**: Create an Expo app shell with auth, navigation, env/bootstrap aligned to existing backend.

- **Files changed**
  - `apps/mobile/app.json`
  - `apps/mobile/package.json`, `apps/mobile/package-lock.json`
  - `apps/mobile/tsconfig.json`
  - `apps/mobile/.env.example`, `.gitignore`, `.vscode/*`
  - `apps/mobile/app/_layout.tsx`, `app/index.tsx`, `app/(auth)/*`
  - `apps/mobile/context/AuthContext.tsx`
  - `apps/mobile/lib/supabase.ts`
  - `docs/mobile-sprint1.md`

- **Backend/shared changes**
  - Mobile Supabase client (`apps/mobile/lib/supabase.ts`) points to the same project and uses public keys from `EXPO_PUBLIC_SUPABASE_*`.
  - No schema or Edge Function changes; this sprint consumes existing auth and profile APIs.

- **Web impact**
  - **Confirmed**:
    - Web code is untouched for this sprint; backend contracts are reused.
  - **Inferred**:
    - Some TypeScript types (`src/integrations/supabase/types.ts`) are intended as a shared reference between web and mobile.

- **Build/runtime impact**
  - **Confirmed from config**:
    - `app.json` defines Expo project metadata, iOS bundle identifier `com.vibelymeet.vibely`, and Android package `com.vibelymeet.vibely`.
    - `apps/mobile/.env.example` documents mobile env model for Supabase, Bunny, OneSignal, RevenueCat.
  - **Not verifiable from repo**:
    - Whether the mobile app has successfully built or run on devices; no build logs or artifacts are checked in.

- **Completion assessment**
  - **Complete**:
    - App shell, basic layout, navigation, Supabase client wrapper, and env scaffolding exist.
  - **Unverified**:
    - End-to-end sign-in/out on real devices and persistence across restarts.

### 3. Sprint 2 profile/events/discovery

- **Objective**  
  - **Inferred from docs**: Achieve parity for onboarding, profile, and event discovery between web and mobile.

- **Files changed**
  - `apps/mobile/app/(onboarding)/*`
  - `apps/mobile/app/(tabs)/events/*`
  - `apps/mobile/lib/profileApi.ts`
  - `apps/mobile/lib/eventsApi.ts`
  - `docs/mobile-sprint2.md`

- **Backend/shared changes**
  - **Confirmed**:
    - Backing functions and schema come from earlier hardening streams:
      - `get_event_deck_exclude_paused.sql`
      - `get_event_deck_auth_guard.sql`
    - These enforce pause-aware decks and stricter auth checks.
  - Mobile code calls into existing Supabase tables and RPCs; no new schema is introduced for Sprint 2.

- **Web impact**
  - **Confirmed**:
    - `src/hooks/useVisibleEvents.ts`, `useEventDeck`, `useEventStatus` and related hooks were updated in the same timeframe to honor these new backend semantics.

- **Build/runtime impact**
  - **Inferred**:
    - Mobile should experience the same event visibility and filtering as web because both use `get_event_deck`.

- **Completion assessment**
  - **Complete on paper**:
    - Screens and API wrappers exist; deck and pause behavior is implemented server-side.
  - **Unverified**:
    - Mixed web/mobile scenarios (e.g. paused user on web vs mobile) are not logged as tested; verification depends on manual runs.

### 4. Sprint 3 chat/notifications

- **Objective**  
  - **Inferred from docs + confirmed from code**: Bring chat and notifications to parity, with backend-owned send and notification flows.

- **Files changed**
  - `apps/mobile/app/chat/[id].tsx`
  - `apps/mobile/lib/chatApi.ts`
  - `apps/mobile/lib/onesignal.ts`
  - `docs/mobile-sprint3.md`
  - Web:
    - `src/components/chat/VideoMessageBubble.tsx`, `VideoMessageRecorder.tsx`, `VoiceMessageBubble.tsx`, `VoiceRecorder.tsx`
    - `src/lib/onesignal.ts`
    - `src/hooks/useMessages.ts`, `useSwipeAction.ts`
  - Backend:
    - `supabase/functions/send-message/index.ts`
    - `supabase/functions/swipe-actions/index.ts`
    - `supabase/functions/send-notification/index.ts` (touched for categories)
    - `supabase/migrations/20260311200000_notification_preferences_mobile_player.sql`

- **Backend/shared changes**
  - **Confirmed**:
    - `send-message` Edge Function now:
      - Validates match participation.
      - Inserts messages server-side.
      - Enforces idempotency window.
      - Invokes `send-notification` with deep link `/chat/:match_id`.
    - `swipe-actions` wraps `handle_swipe` RPC and centralizes swipe → notification behavior.
    - Notification preferences table gains `mobile_onesignal_player_id` and `mobile_onesignal_subscribed`.
    - `supabase/config.toml` adds JWT verification settings for new functions.

- **Web impact**
  - **Confirmed**:
    - Web chat components rely on the same `messages` table and now send via `send-message`.
    - `src/lib/onesignal.ts` is hardened with better error handling and a domain restriction guard.

- **Mobile impact**
  - **Confirmed**:
    - `apps/mobile/lib/onesignal.ts`:
      - Uses `EXPO_PUBLIC_ONESIGNAL_APP_ID`.
      - Registers `mobile_onesignal_player_id` in `notification_preferences` via Supabase.
    - This is additive and does not change web behavior.

- **Build/runtime impact**
  - **Confirmed from code**:
    - Notification categories (messages, matches, Daily Drop) are all orchestrated via `send-notification`.
  - **Not verifiable from repo**:
    - Actual OneSignal dashboard configuration, push deliverability, and domain/app ID correctness in production.

- **Completion assessment**
  - **Functionally complete in code**:
    - All sends go through backend; notification prefs schema is extended for mobile.
  - **Unverified**:
    - Mobile push notifications on physical devices and multi-device (web + mobile) delivery.

### 5. Sprint 4 Daily Drop / Ready Gate

- **Objective**  
  - **Confirmed from migrations and functions**: Move Daily Drop and Ready Gate transitions fully server-side and align notifications.

- **Files changed**
  - Backend:
    - `supabase/migrations/20260311153000_ready_gate_transition.sql`
    - `supabase/migrations/20260311160000_daily_drop_transition.sql`
    - `supabase/functions/daily-drop-actions/index.ts`
  - Web:
    - `src/hooks/useDailyDrop.ts`
    - `src/hooks/useMatchQueue.ts`, `useMatchCall.ts`
    - `src/components/lobby/ReadyGateOverlay.tsx`
  - Mobile:
    - `apps/mobile/app/daily-drop.tsx`
    - `apps/mobile/app/ready/[id].tsx`
    - `apps/mobile/lib/dailyDropApi.ts`
    - `apps/mobile/lib/readyGateApi.ts`
    - `docs/mobile-sprint4.md`

- **Backend/shared changes**
  - **Confirmed**:
    - `ready_gate_transition`:
      - Uses `auth.uid()` to enforce participation.
      - Handles `mark_ready`, `snooze`, `forfeit` transitions with idempotency and terminal safeguards.
    - `daily_drop_transition`:
      - Centralizes `view`, `send_opener`, `send_reply`, and `pass`.
      - Creates or reuses `matches`, seeds messages, and enforces text validation.
    - `daily-drop-actions` Edge Function:
      - Calls `daily_drop_transition`.
      - On `send_opener` and `send_reply`, triggers `send-notification` with appropriate deep links and copy.

- **Web impact**
  - **Confirmed**:
    - Web hooks switched to use RPC/Edge Function rather than inline client logic.

- **Mobile impact**
  - **Inferred from code**:
    - Mobile uses the same RPCs/Edge Functions via its `*Api` wrappers, so behavior should match web.

- **Completion assessment**
  - **Complete in backend implementation**:
    - Canonical state machines are in place.
  - **Unverified**:
    - Cross-platform flows (web vs mobile participant mixes) across all edge cases.

### 6. Sprint 5 video date / Daily integration

- **Objective**  
  - **Confirmed from migrations**: Introduce a canonical video-date state machine and server-owned transitions.

- **Files changed**
  - Backend:
    - `supabase/migrations/20260311133000_video_date_state_machine.sql`
    - `supabase/functions/daily-room` (indirectly referenced in docs; code not in the diff list here).
  - Web:
    - `src/hooks/useMatchCall.ts`, `useVideoDate` (indirectly impacted).
  - Mobile:
    - `apps/mobile/app/date/[id].tsx`
    - `apps/mobile/lib/videoDateApi.ts`
    - `docs/mobile-sprint5.md`

- **Backend/shared changes**
  - **Confirmed**:
    - Adds `video_date_state` enum and extra columns to `video_sessions`.
    - Adds `video_date_transition` RPC that:
      - Uses `auth.uid()` and validates participation.
      - Implements `enter_handshake`, `vibe`, `complete_handshake`, `end`.
      - Encapsulates duration and termination reasons.

- **Web and mobile impact**
  - **Inferred from docs**:
    - Both platforms are expected to call `video_date_transition` and `daily-room` for room tokens; no client-side state machine.

- **Completion assessment**
  - **Backend complete**:
    - Canonical server-owned state machine is implemented.
  - **Unverified**:
    - Daily SDK integration on mobile and full cross-platform dates; no device-level telemetry in repo.

### 7. Sprint 6 RevenueCat / entitlements / release groundwork

- **Objective**  
  - **Confirmed from code and migrations**: Add RevenueCat integration for mobile and unify entitlements so web Stripe and mobile RevenueCat share a canonical model.

- **Files changed**
  - Backend:
    - `supabase/functions/revenuecat-webhook/index.ts`
    - `supabase/migrations/20260312000000_subscriptions_provider_revenuecat.sql`
  - Mobile:
    - `apps/mobile/lib/revenuecat.ts`
    - `apps/mobile/.env.example` (RevenueCat keys).
    - `docs/mobile-sprint6.md`
    - `docs/native-deployment-validation-sequence.md`, `docs/native-external-setup-checklist.md` (updated with RevenueCat steps).

- **Backend/shared changes**
  - **Confirmed**:
    - `subscriptions` table gets:
      - `provider` text column with default `'stripe'`.
      - Unique key `(user_id, provider)`.
      - RevenueCat-specific fields `rc_product_id`, `rc_original_app_user_id`.
    - A trigger `sync_profiles_is_premium_from_subscriptions` ensures `profiles.is_premium` reflects any active or trialing subscription.
    - Helper functions `get_user_subscription_status` and `check_premium_status` encapsulate entitlement status logic.
    - `revenuecat-webhook`:
      - Checks `REVENUECAT_WEBHOOK_AUTHORIZATION`.
      - Maps RevenueCat events to `subscriptions` rows with `provider='revenuecat'`.
      - Handles status transitions and trialing vs active/past_due semantics.

- **Web impact**
  - **Confirmed**:
    - Existing Stripe flows remain valid; existing rows default to `provider='stripe'`.
    - Web can continue to rely on `profiles.is_premium` and the new helpers without caring about provider.

- **Mobile impact**
  - **Confirmed**:
    - `apps/mobile/lib/revenuecat.ts`:
      - Reads platform-specific or generic RevenueCat public API keys.
      - Wraps `react-native-purchases` for offerings, purchase, restore.
      - Comments state that the canonical entitlement comes from backend after purchase.

- **Completion assessment**
  - **Backend feature complete**:
    - Model supports both Stripe and RevenueCat.
  - **Unverified**:
    - RevenueCat dashboard configuration (products, webhooks).
    - End-to-end flows from mobile purchase → webhook → entitlements in app.

### 8. Stabilization / launch-readiness docs

- **Objective**  
  - **Inferred from docs**: Provide a launch checklist, external setup sequencing, and manual validation plan for native release.

- **Files changed**
  - `docs/native-launch-readiness.md`
  - `docs/native-external-setup-checklist.md`
  - `docs/native-manual-test-matrix.md`
  - `docs/native-deployment-validation-sequence.md`

- **Backend/shared changes**
  - None — purely documentation.

- **Web/mobile impact**
  - **Inferred**:
    - These docs outline dependencies on Supabase, RevenueCat, OneSignal, Daily, Expo/EAS, app stores, but do not change behavior.

- **Completion assessment**
  - **Docs complete**:
    - Checklists and matrices are present.
  - **Not verifiable from repo**:
    - Whether these checklists have been executed or updated post-run.

### 9. Web runtime hardening / Sentry issue fixes

- **Objective**  
  - **Confirmed from commits**: Harden web runtime and webhooks to reduce production errors and prepare for native builds.

- **Files changed**
  - `src/lib/onesignal.ts`
  - `src/main.tsx`
  - `src/App.tsx`
  - Multiple UI components and hooks (chat, notifications, safety flows).
  - `supabase/functions/revenuecat-webhook/index.ts` (error paths and robustness).

- **Backend/shared changes**
  - **Confirmed**:
    - Web entrypoint and runtime now guard against OneSignal domain mismatches and fallback gracefully.
    - RevenueCat webhook handles more event types and error conditions.

- **Web impact**
  - **Confirmed**:
    - Reduced risk of runtime crashes from misconfigured OneSignal.
    - Safer chat/video message handling and fallback behavior.

- **Completion assessment**
  - **Complete**:
    - Code changes are present and cohesive with native objectives.
  - **Unverified**:
    - Actual reduction in Sentry error rates; this requires external observability.

### 10. Env/config alignment (web + mobile)

- **Objective**  
  - **Confirmed from env files**: Align env models across web and mobile, making public vs secret boundaries explicit.

- **Files changed**
  - Web:
    - `.env.example`
    - `src/integrations/supabase/client.ts`
    - `src/lib/importMetaEnv.d.ts`
  - Mobile:
    - `apps/mobile/.env.example`
    - `apps/mobile/lib/supabase.ts`
  - Docs:
    - `_cursor_context/vibely_rebuild_runbook.md`

- **Backend/shared changes**
  - None; all env modeling is client-side and doc-level.

- **Web impact**
  - **Confirmed**:
    - Web now uses `VITE_SUPABASE_PUBLISHABLE_KEY` (preferred) and falls back to `VITE_SUPABASE_ANON_KEY`.
    - `.env.example` documents optional provider vars (Bunny, OneSignal, PostHog, Sentry, Stripe, RevenueCat) clearly.

- **Mobile impact**
  - **Confirmed**:
    - `apps/mobile/.env.example` mirrors the web env model with `EXPO_PUBLIC_*` equivalents.
    - Optional vs required mobile variables (Supabase URL/key, OneSignal app ID, RevenueCat keys) are documented.

- **Completion assessment**
  - **Complete**:
    - Env models are aligned and documented.
  - **Unverified**:
    - Whether actual `.env` values in production follow these examples — by design they are not committed.

### 11. Expo/EAS/build-prep + Android build troubleshooting

- **Objective**  
  - **Confirmed from commits**: Prepare Expo/EAS configs and work around dependency mismatches to enable native builds.

- **Files changed**
  - `apps/mobile/app.json`
  - `apps/mobile/eas.json`
  - `apps/mobile/.npmrc`
  - `apps/mobile/README.md`
  - `apps/mobile/package.json`, `apps/mobile/package-lock.json`

- **Backend/shared changes**
  - None; purely client/build side.

- **Web impact**
  - **Confirmed**:
    - `package.json` at root adds Expo as a dependency, but web bundling is preserved via separate tooling (`vite`).
    - Vite config is hardened to dedupe `react`, avoiding conflicts with Expo’s React.

- **Mobile/build impact**
  - **Confirmed**:
    - `eas.json` defines `development`, `preview`, `production` build profiles.
    - `app.json` includes:
      - Bundle/package IDs (`com.vibelymeet.vibely`).
      - iOS entitlements for OneSignal notification service extension.
      - Android permissions for notifications, camera, microphone, foreground services.
      - Plugins:
        - `@daily-co/config-plugin-rn-daily-js`
        - `onesignal-expo-plugin` (development mode)
        - `expo-router`
    - `.npmrc` sets `legacy-peer-deps=true` (temporary).

- **Completion assessment**
  - **Config-complete (confirmed from repo)**:
    - All necessary build configs for EAS appear present.
  - **Android build proven once (confirmed via operator report)**:
    - An Android EAS development build has already completed successfully end-to-end against this repo and config.
  - **Still unverified from repo perspective**:
    - Any iOS EAS/Xcode builds.
    - Any Android or iOS store submissions.

### 12. Final sync / merge / build-ready state

- **Objective**  
  - **Inferred from commit messages**: Resolve review feedback, finalize dependencies, and make the repo build-ready for native.

- **Files changed**
  - Minor tweaks in:
    - `apps/mobile/app.json`
    - `apps/mobile/package.json`, `apps/mobile/package-lock.json`
    - `apps/mobile/README.md`
    - `src/components/chat/VoiceMessageBubble.tsx`

- **Completion assessment**
  - **Complete as far as code is concerned**:
    - Review feedback addressed.
    - Dependencies aligned to Expo 55.
  - **Unverified**:
    - End-to-end “clean checkout → install → build (web + mobile)” run on CI or operator machines.

---

## Part C — Categorized file inventory (since `fff9438`)

Using `git diff --name-status fff9438..HEAD`.

### 1. Mobile app files (`apps/mobile/**`)

**Confirmed from diff**

- Env/config:
  - `apps/mobile/.env.example`
  - `apps/mobile/.gitignore`
  - `apps/mobile/.npmrc`
  - `apps/mobile/.vscode/extensions.json`
  - `apps/mobile/.vscode/settings.json`
  - `apps/mobile/eas.json`
  - `apps/mobile/app.json`
  - `apps/mobile/package.json`
  - `apps/mobile/package-lock.json`
  - `apps/mobile/tsconfig.json`

- App shell / routing:
  - `apps/mobile/app/_layout.tsx`
  - `apps/mobile/app/+html.tsx`
  - `apps/mobile/app/+not-found.tsx`
  - `apps/mobile/app/index.tsx`
  - `apps/mobile/app/modal.tsx`

- Auth and onboarding:
  - `apps/mobile/app/(auth)/_layout.tsx`
  - `apps/mobile/app/(auth)/sign-in.tsx`
  - `apps/mobile/app/(auth)/sign-up.tsx`
  - `apps/mobile/app/(auth)/reset-password.tsx`
  - `apps/mobile/app/(onboarding)/_layout.tsx`
  - `apps/mobile/app/(onboarding)/index.tsx`

- Tabs and screens:
  - `apps/mobile/app/(tabs)/_layout.tsx`
  - `apps/mobile/app/(tabs)/index.tsx`
  - `apps/mobile/app/(tabs)/events/_layout.tsx`
  - `apps/mobile/app/(tabs)/events/index.tsx`
  - `apps/mobile/app/(tabs)/events/[id].tsx`
  - `apps/mobile/app/(tabs)/matches/_layout.tsx`
  - `apps/mobile/app/(tabs)/matches/index.tsx`
  - `apps/mobile/app/(tabs)/profile/_layout.tsx`
  - `apps/mobile/app/(tabs)/profile/index.tsx`
  - `apps/mobile/app/chat/[id].tsx`
  - `apps/mobile/app/daily-drop.tsx`
  - `apps/mobile/app/date/[id].tsx`
  - `apps/mobile/app/event/[eventId]/lobby.tsx`
  - `apps/mobile/app/premium.tsx`
  - `apps/mobile/app/ready/[id].tsx`
  - `apps/mobile/app/settings.tsx`

- Components and utilities:
  - `apps/mobile/components/*` (Themed, StyledText, ExternalLink, PushRegistration, useColorScheme, useClientOnlyValue).
  - `apps/mobile/constants/Colors.ts`
  - `apps/mobile/context/AuthContext.tsx`

- Data layer / integrations:
  - `apps/mobile/lib/chatApi.ts`
  - `apps/mobile/lib/dailyDropApi.ts`
  - `apps/mobile/lib/eventsApi.ts`
  - `apps/mobile/lib/imageUrl.ts`
  - `apps/mobile/lib/onesignal.ts`
  - `apps/mobile/lib/profileApi.ts`
  - `apps/mobile/lib/readyGateApi.ts`
  - `apps/mobile/lib/revenuecat.ts`
  - `apps/mobile/lib/subscriptionApi.ts`
  - `apps/mobile/lib/supabase.ts`
  - `apps/mobile/lib/videoDateApi.ts`

- Assets:
  - `apps/mobile/assets/fonts/SpaceMono-Regular.ttf`
  - `apps/mobile/assets/images/*` (icons, splash).

- Docs:
  - `apps/mobile/README.md`

### 2. Backend files (`supabase/**`)

**Confirmed from diff**

- Config:
  - `supabase/config.toml` (adds verify_jwt entries for new functions).

- Edge Functions:
  - New:
    - `supabase/functions/account-pause/index.ts`
    - `supabase/functions/account-resume/index.ts`
    - `supabase/functions/daily-drop-actions/index.ts`
    - `supabase/functions/revenuecat-webhook/index.ts`
    - `supabase/functions/send-message/index.ts`
    - `supabase/functions/swipe-actions/index.ts`
  - Modified:
    - `supabase/functions/create-checkout-session/index.ts`
    - `supabase/functions/create-credits-checkout/index.ts`
    - `supabase/functions/create-portal-session/index.ts`
    - `supabase/functions/generate-daily-drops/index.ts`
    - `supabase/functions/send-notification/index.ts`
    - `supabase/functions/stripe-webhook/index.ts`

- Migrations:
  - `supabase/migrations/20260309000534_legacy_remote_artifact.sql`
  - `supabase/migrations/20260309005543_legacy_remote_artifact.sql`
  - `supabase/migrations/20260311120000_profiles_pause_columns.sql`
  - `supabase/migrations/20260311120001_get_event_deck_exclude_paused.sql`
  - `supabase/migrations/20260311133000_video_date_state_machine.sql`
  - `supabase/migrations/20260311141500_get_event_deck_auth_guard.sql`
  - `supabase/migrations/20260311153000_ready_gate_transition.sql`
  - `supabase/migrations/20260311160000_daily_drop_transition.sql`
  - `supabase/migrations/20260311200000_notification_preferences_mobile_player.sql`
  - `supabase/migrations/20260312000000_subscriptions_provider_revenuecat.sql`

### 3. Web app files (`src/**`)

**Confirmed from diff**

- Core:
  - `src/main.tsx`
  - `src/App.tsx`

- Routing and pages:
  - `src/pages/Chat.tsx`
  - `src/pages/Credits.tsx`
  - `src/pages/Dashboard.tsx`
  - `src/pages/EventDetails.tsx`
  - `src/pages/EventLobby.tsx`
  - `src/pages/Events.tsx`
  - `src/pages/Matches.tsx`
  - ~~`src/pages/ReadyGate.tsx`~~ *(removed 2026-04-11)*
  - `src/pages/ReadyRedirect.tsx` (new)
  - `src/pages/VideoDate.tsx`
  - `src/pages/VibeFeed.tsx` (deleted)

- Components:
  - Multiple under:
    - `src/components/chat/*`
    - `src/components/notifications/*`
    - `src/components/lobby/*`
    - `src/components/safety/*`
    - `src/components/settings/*`
    - `src/components/video-date/*`
    - `src/components/wizard/*`
    - `src/components/admin/*`

- Hooks and domain:
  - `src/hooks/use*` (DailyDrop, Events, Matches, Messages, ReadyGate, Subscription, Notifications, etc.)
  - `src/domain/enums.ts` (new)
  - `src/domain/transitions.ts` (new)

- Integrations and env:
  - `src/integrations/supabase/client.ts`
  - `src/integrations/supabase/types.ts`
  - `src/lib/onesignal.ts`
  - `src/lib/importMetaEnv.d.ts`

### 4. Docs/runbooks (`docs/**` and `_cursor_context/**`)

**Confirmed from diff**

- New docs:
  - `docs/auth-bootstrap-ownership.md`
  - `docs/golden-path-regression-runbook.md`
  - `docs/mobile-sprint1.md` … `docs/mobile-sprint6.md`
  - `docs/native-build-architecture-plan.md`
  - `docs/native-deployment-validation-sequence.md`
  - `docs/native-external-setup-checklist.md`
  - `docs/native-launch-readiness.md`
  - `docs/native-manual-test-matrix.md`
  - `docs/native-pr-summary.md`
  - `docs/native-v1-scope.md`

- `_cursor_context` updates:
  - `_cursor_context/vibely_cursor_hardening_campaign.md`
  - `_cursor_context/vibely_edge_function_manifest.md`
  - `_cursor_context/vibely_machine_readable_inventory.json`
  - `_cursor_context/vibely_migration_manifest.md`
  - `_cursor_context/vibely_rebuild_runbook.md`

### 5. Build/config/env files (root and shared)

**Confirmed from diff**

- Root:
  - `.env.example`
  - `.gitignore`
  - `package.json`
  - `package-lock.json`
  - `tsconfig.core-strict.json`
  - `vite.config.ts`

- Scripts:
  - `scripts/run_golden_path_smoke.sh`

---

## Part D — Backend/shared system changes

### 1. Migrations added/modified

**Confirmed from migrations**

- **Pause semantics (Stream 1B)**
  - `20260311120000_profiles_pause_columns.sql`
    - Adds `is_paused`, `paused_at`, `paused_until`, `pause_reason` to `public.profiles`.
    - **Additive/backward-compatible** — existing rows get default `is_paused=false`.
  - `20260311120001_get_event_deck_exclude_paused.sql`
    - Rewrites `get_event_deck` to exclude effectively paused profiles (and to continue enforcing blockers, reports, matches).

- **Event deck auth guard**
  - `20260311141500_get_event_deck_auth_guard.sql`
    - Adds an auth guard using `auth.uid()` and raises `Access denied` when caller is not the viewer.
    - **Potentially risky** if any existing callers did not pass `p_user_id=auth.uid()`; web hooks were updated accordingly in the same timeframe.

- **Video date state machine (Stream 2A)**
  - `20260311133000_video_date_state_machine.sql`
    - Introduces `video_date_state` enum and `state`/`state_updated_at`/`ended_reason` columns on `video_sessions`.
    - Adds `video_date_transition` RPC.
    - **Additive/backward-compatible** — legacy columns remain for compatibility; state is backfilled.

- **Ready Gate transitions (Stream 2B)**
  - `20260311153000_ready_gate_transition.sql`
    - Adds `ready_gate_transition` RPC, operating on `video_sessions` and enforcing terminal statuses.
    - **Additive** — no schema changes here; behavior changes are server-side.

- **Daily Drop transitions (Stream 2C)**
  - `20260311160000_daily_drop_transition.sql`
    - Adds `daily_drop_transition` RPC for `view`, `send_opener`, `send_reply`, `pass`.
    - **Additive** — uses existing `daily_drops` schema.

- **Notification preferences for mobile (Sprint 3)**
  - `20260311200000_notification_preferences_mobile_player.sql`
    - Adds `mobile_onesignal_player_id` and `mobile_onesignal_subscribed` to `notification_preferences`.
    - **Additive/backward-compatible**.

- **Subscriptions provider/RevenueCat (Sprint 6)**
  - `20260312000000_subscriptions_provider_revenuecat.sql`
    - Adds `provider` to `subscriptions`, defaults to `'stripe'`, and defines `(user_id, provider)` uniqueness.
    - Adds RevenueCat-specific columns `rc_product_id`, `rc_original_app_user_id`.
    - Adds `sync_profiles_is_premium_from_subscriptions` trigger and functions `get_user_subscription_status` and `check_premium_status`.
    - **Additive but behavior-affecting** — premium status derivation is now centralized; however, semantics remain a superset of existing behavior.

### 2. Edge Functions added/modified

**Confirmed from code**

- **New functions**
  - `account-pause` / `account-resume`
    - Implement backend-authoritative pause/resume, operating on the new `profiles` pause columns.
  - `daily-drop-actions`
    - Wraps `daily_drop_transition`, orchestrates notifications via `send-notification`.
  - `send-message`
    - Wraps chat message creation and notifications; enforces idempotency and participation.
  - `swipe-actions`
    - Wraps `handle_swipe`; orchestrates notifications (match, queued match, someone vibed you).
  - `revenuecat-webhook`
    - Syncs RevenueCat events into `subscriptions` with `provider='revenuecat'`.

- **Modified functions**
  - `create-checkout-session`, `create-credits-checkout`, `create-portal-session`
    - Minor adjustments to align with entitlements and provider model (based on diff).
  - `generate-daily-drops`
    - Aligns with updated Daily Drop schema and transitions.
  - `send-notification`
    - Gains new categories for mobile and new flows (e.g. daily_drop, ready_gate, messages).
  - `stripe-webhook`
    - Harmonized with new subscriptions model and entitlements logic.

### 3. Shared entitlement/subscription changes

**Confirmed from migrations and webhook**

- Subscriptions model now:
  - Differentiates `provider` (`stripe` vs `revenuecat`).
  - Treats any active/trialing subscription from any provider as a premium entitlement.
  - Uses `profiles.is_premium` as the canonical boolean gate, derived from subscriptions.
- Helper functions allow both web and mobile to query effective status without knowing provider details.

### 4. Notification model changes

**Confirmed from functions and migrations**

- The notification pipeline is now:
  - Business events → RPC/Edge Function (`send-message`, `swipe-actions`, `daily-drop-actions`, Ready Gate/Video Date transitions) → `send-notification` → OneSignal (and potentially future providers).
- Notification preferences now include:
  - Web player ID (`onesignal_player_id`, pre-existing).
  - Mobile player ID (`mobile_onesignal_player_id`).
- `supabase/config.toml` includes JWT verification flags for all relevant functions, ensuring auth context is correct.

### 5. Cross-surface schema/API/path changes

**Summary**

- **Additive/backward-compatible**
  - Pause columns on `profiles`.
  - Mobile notification columns on `notification_preferences`.
  - Provider and RevenueCat columns on `subscriptions`.
  - State machine columns and enums on `video_sessions`.
  - New RPCs (`video_date_transition`, `ready_gate_transition`, `daily_drop_transition`) and functions (`get_user_subscription_status`, `check_premium_status`).

- **Potentially risky but coordinated**
  - `get_event_deck` now has stricter auth and pause semantics; if any callers were not aligned, they would break. Web hooks and mobile APIs were updated as part of the same branches, which mitigates this.

- **Intended to preserve web compatibility**
  - All migrations and new functions are written to be either additive or accompanied by web code changes in the same trunk, aligning with the hardening campaign rules.

---

## Part E — Environment/config changes

### 1. Mobile env model

**Confirmed from `apps/mobile/.env.example` and code**

- **Required**
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- **Optional but needed for full functionality**
  - `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME`
  - `EXPO_PUBLIC_ONESIGNAL_APP_ID`
  - `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`
  - `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`
  - `EXPO_PUBLIC_REVENUECAT_API_KEY` (fallback)
- These are consumed by:
  - `apps/mobile/lib/supabase.ts` (Supabase).
  - `apps/mobile/lib/imageUrl.ts` (Bunny).
  - `apps/mobile/lib/onesignal.ts` (OneSignal).
  - `apps/mobile/lib/revenuecat.ts` (RevenueCat).

### 2. Web env model

**Confirmed from `.env.example` and `src/integrations/supabase/client.ts`**

- **Required**
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_PUBLISHABLE_KEY`  
    - Fallback to `VITE_SUPABASE_ANON_KEY` for backward compatibility.
- **Optional**
  - `VITE_BUNNY_CDN_HOSTNAME`
  - `VITE_BUNNY_STREAM_CDN_HOSTNAME`
  - `VITE_ONESIGNAL_APP_ID` (with code fallback to a hard-coded ID, which is a temporary compatibility choice).
  - `VITE_POSTHOG_API_KEY`, `VITE_POSTHOG_HOST`
  - `VITE_SENTRY_DSN`
  - `VITE_APP_URL`, `VITE_STRIPE_PUBLISHABLE_KEY`
  - `VITE_REVENUECAT_IOS_API_KEY`, `VITE_REVENUECAT_ANDROID_API_KEY`, `VITE_REVENUECAT_API_KEY` (if web ever needs them).

### 3. EAS config changes

**Confirmed from `apps/mobile/eas.json` and `app.json`**

- Build profiles:
  - `development` — dev client, internal distribution.
  - `preview` — internal distribution.
  - `production` — app store.
- App IDs:
  - iOS `bundleIdentifier`: `com.vibelymeet.vibely`.
  - Android `package`: `com.vibelymeet.vibely`.
- Plugins:
  - Daily React Native config plugin.
  - OneSignal Expo plugin (mode: development).
  - Expo Router.

### 4. Bundle/package ID final state

**Confirmed from `app.json`**

- Both platforms use `com.vibelymeet.vibely`, matching the shipping bundle ID as per commit message `chore: align mobile app identifiers with Vibely shipping bundle ID`.

### 5. Temporary workarounds

**Confirmed from `apps/mobile/.npmrc` and docs**

- `.npmrc`:
  - `legacy-peer-deps=true` to work around a Daily Expo plugin peer-dependency mismatch.
  - Commit `771537d` explicitly labels this as a temporary unblock for EAS install.

### 6. Vars no longer expected by code

**Inferred from env changes and comments**

- `VITE_SUPABASE_ANON_KEY` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are now explicitly marked as **legacy** fallbacks, not the preferred keys.
- There is no direct evidence of env vars being removed; rather, the code has been made tolerant to their absence with defaults and fallbacks.

---

## Part F — Current status/readiness assessment

This section synthesizes what can be concluded from code and docs only.

### 1. What is clearly complete (code/docs)

**Confirmed from repo/history**

- **Backend ownership**
  - Pause/resume, Ready Gate, Daily Drop, chat, swipe/match, and video-date transitions are all server-owned via RPCs and Edge Functions.
- **Notification pipeline**
  - Notification flows for chat, Daily Drop, swipes, and matches are centralized in `send-notification`, with mobile player ID support.
- **Entitlements model**
  - Subscriptions table and helpers support both Stripe and RevenueCat.
  - RevenueCat webhook is implemented.
- **Native app scaffolding**
  - `apps/mobile` exists with major screens and data layer wrappers aligned to backend contracts.
- **Doc coverage**
  - Native architecture, sprint runbooks, launch readiness, external setup checklist, and manual test matrix are committed.
  - Golden-path regression runbook and smoke script exist for web.
- **Env/config alignment**
  - Web and mobile env examples are consistent and clearly labeled.
  - EAS and Expo configs are present with production bundle IDs and permissions.

### 2. What is likely complete but not fully verified

**Inferred from docs/comments**

- **Native functional parity**
  - All core flows (auth, onboarding, events, lobby, matches, chat, Daily Drop, Ready Gate, video date, premium) have corresponding screens and hooks.
- **Native UI parity**
  - Screens cover the same conceptual flows as web; exact visual parity cannot be evaluated from this repo alone.
- **Golden-path regression**
  - The presence of runbooks and a smoke script suggests at least one rehearsal, but the repo does not record executed runs or results.

### 3. What is still pending (from repo perspective)

**Not verifiable from repo (with Android build status distinguished)**

- **Android builds:**
  - At least one Android EAS **development build success is confirmed via operator report**, but:
    - There is no in-repo CI log or build artifact.
    - There is no recorded Android **runtime/device validation** run (manual test matrix results not captured in git).
- **iOS builds:**
  - No evidence in repo or docs that an iOS EAS or Xcode build has succeeded; treat iOS build status as **unverified/pending**.
- **Stores:**
  - **App Store Connect / TestFlight** submissions and status are not reflected in this repo.
  - **Google Play Console** internal/production releases and subscription product state are not reflected in this repo.
- **Providers (configuration vs code):**
  - **RevenueCat dashboard** (project, products, offerings, webhook URL and auth) — required, but current state is only described in docs, not confirmed by logs.
  - **OneSignal** mobile app setup (iOS/Android app IDs, environments) — described, but not evidenced.
  - **Daily** mobile-specific tuning (if any) — assumed to reuse web configuration; no explicit device-level validation recorded.
- **Validation runs:**
  - Full execution of the **native manual test matrix** (both Android and iOS) is not recorded in git.

### 4. Dependencies on external dashboards/manual setup

**Inferred from docs**

- Supabase project `schdyxcunwcvddlcshwd` for all DB and Edge Functions.
- OneSignal dashboard for web and mobile push.
- RevenueCat for mobile entitlements.
- Stripe for web billing.
- Daily for video calling.
- Expo/EAS plus App Store Connect and Google Play for distribution.

### 5. What has been validated by build/tooling (from repo + operator evidence)

- **From repo (web):**
  - `tsconfig.core-strict.json` and `npm run typecheck:core` exist and are invoked by `scripts/run_golden_path_smoke.sh`.
  - `scripts/run_golden_path_smoke.sh` runs `npm run build`, so the web build path is formally captured (though no CI logs are stored here).

- **From operator report (mobile):**
  - At least one **Android EAS development build** has completed successfully using the checked-in `apps/mobile` config and dependencies, proving the Android build pipeline once.

- **Still not evidenced:**
  - Any automated mobile build pipeline or CI job wired in this repo.

### 6. What still needs runtime/device validation

**Not verifiable from repo; inferred from scope and current operator report**

- **Android (post-first-build, pre-runtime-validation):**
  - Mixed web ↔ Android flows for:
    - Daily Drop (opener/reply/pass).
    - Ready Gate and video dates.
    - Push notifications (messages, matches, Daily Drop, Ready Gate, billing events).
  - End-to-end Android entitlement flows (RevenueCat purchase/restore → webhook → subscriptions/profile flags).
  - UX details: permission prompts, background behavior, push deep links, and video reliability on real Android devices.

- **iOS (pre-build, pre-runtime-validation):**
  - Initial EAS/Xcode build success is not evidenced.
  - All runtime validation (auth, onboarding, events, chat, push, Daily Drop, Ready Gate, video date, premium) is still pending.

- **Cross-platform and stores (both platforms):**
  - Entitlement reconciliation for web Stripe + mobile RevenueCat across both platforms.
  - Store review and compliance behaviors for App Store Connect and Play Console.

---

## Part G — Summary of verification levels and current-state snapshot

- **Confirmed from repo/history**
  - All backend migrations and Edge Functions listed above.
  - Presence and content of native, launch, and regression docs.
  - Existence and structure of `apps/mobile` and its alignment with backend contracts.
  - Env/config models and EAS/Expo configuration.

- **Confirmed via operator report (outside git/CI)**
  - At least one **Android EAS development build** has succeeded end-to-end.

- **Inferred from docs/comments**
  - Intended sprint-by-sprint objectives and completion criteria.
  - Functional parity claims between web and native (where code exists but no explicit automated tests are checked in).
  - Expected golden-path regression usage and outcomes.

- **Not verifiable from repo**
  - Any iOS build results, Android/iOS store submissions, or actual provider dashboard configuration state.
  - Real-world error rates, performance, and UX polish on devices.

### Current state snapshot

- **Backend/shared state:**  
  - Hardened and server-owned for pause, Ready Gate, Daily Drop, chat, swipes/matches, video dates, and entitlements; additive migrations are on `main`.

- **Web/runtime state:**  
  - Hardened env handling, OneSignal, and Stripe/entitlements; golden-path runbook and smoke script present; no web regressions evident in code.

- **Mobile build state:**  
  - `apps/mobile` implemented with Expo/EAS configs and dependencies; **Android EAS dev build proven once**, iOS build status unverified.

- **UI parity state:**  
  - All major flows have corresponding mobile screens; exact visual parity and UX quality await device validation.

- **Store/provider setup state (from repo docs + operator report):**  
  - Supabase migrations and Edge Functions are fully specified and ready to apply; Android build can target them.  
  - RevenueCat, OneSignal, Daily, App Store Connect, and Google Play have detailed setup/validation docs, with actual dashboard configuration and verification still needing to be recorded outside this repo.


