# Vibely Mobile (Sprint 1)

Expo + React Native + TypeScript app sharing the same Supabase backend as the web app. See `docs/native-build-architecture-plan.md` for full architecture. **Sprint 0 architecture lock (contracts, route map, gaps):** `docs/native-sprint0-architecture-lock.md`.

## Structure

- **`app/`** — Expo Router file-based routes.
  - **`index.tsx`** — Entry; redirects to auth, onboarding, or tabs by session/onboarding state.
  - **`(auth)/`** — Sign in, sign up, reset password (unauthenticated).
  - **`(onboarding)/`** — Onboarding: name, gender, optional tagline/job/about (createProfile + user_credits). Profile photos can be added on Profile.
  - **`(tabs)/`** — Main app: Dashboard, Events (list/detail), Matches, Profile (load + edit core fields, **photo upload**, **vibe video**).
  - **Stack screens** — Event lobby (deck + vibe/pass/super_vibe via swipe-actions), chat, Daily Drop, Ready Gate, **video date** (Daily.co room + backend state), **premium** (RevenueCat + backend entitlement), settings.
- **`context/AuthContext.tsx`** — Supabase auth, session persistence (AsyncStorage), onboarding check (profiles).
- **`lib/supabase.ts`** — Supabase client (same project as web).

## Env vars (required for local run)

Copy `.env.example` to `.env` and set:

| Variable | Description |
|----------|-------------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL (same as web `VITE_SUPABASE_URL`) |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key used by the mobile client. Preferred over the legacy anon key. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | (Legacy) Supabase anon key, used only as a fallback if publishable key is not set. |
| `EXPO_PUBLIC_BUNNY_CDN_HOSTNAME` | Optional; for `photos/` image URLs (same as web Bunny CDN). |
| `EXPO_PUBLIC_ONESIGNAL_APP_ID` | OneSignal App ID for push (same as web). Required for push registration. |
| `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` | RevenueCat public API key for iOS. Preferred on iOS; omit to fall back to `EXPO_PUBLIC_REVENUECAT_API_KEY`. |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` | RevenueCat public API key for Android. Preferred on Android; omit to fall back to `EXPO_PUBLIC_REVENUECAT_API_KEY`. |
| `EXPO_PUBLIC_REVENUECAT_API_KEY` | RevenueCat public API key (fallback for both platforms if platform-specific key unset). Omit all to hide purchase UI. |

Secrets stay out of committed source; use `.env` locally and EAS/CI secrets for builds.

**EAS / npm install:** `.npmrc` sets `legacy-peer-deps=true` so cloud installs succeed despite (1) `@daily-co/config-plugin-rn-daily-js` declaring `expo@^54` while the app uses Expo 55, and (2) `@daily-co/react-native-daily-js` declaring a peer on `@react-native-async-storage/async-storage@^1.24.0` while we use `2.2.0` for Expo 55 compatibility. This is temporary until Daily publishes Expo 55–compatible packages; remove the override when no longer needed.

## Run locally

```bash
cd apps/mobile
npm install
# Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or EXPO_PUBLIC_SUPABASE_ANON_KEY as fallback) (e.g. in .env or export)
npm start
# Then: i (iOS simulator), a (Android emulator), or w (web)
```

From repo root (no workspace yet):

```bash
cd apps/mobile && npm start
```

## Sprint 1 + 2 scope

- **Included:** App shell, auth/session, route guards, onboarding (createProfile + user_credits), profile load/edit (core fields, **profile photo upload** via upload-image EF, **vibe video** record/upload/state/delete), events list/detail/lobby, event registration, event deck (`get_event_deck` RPC), swipe actions (`swipe-actions` Edge Function), premium (RevenueCat; hard blocker), shared client wiring to existing backend.
- **Sprint 3:** Matches list, chat thread (message history + send via `send-message`), realtime messages; OneSignal push registration. See `docs/mobile-sprint3.md`.
- **Sprint 4:** Daily Drop (view, send opener/reply, pass via `daily_drop_transition` + `daily-drop-actions`); Ready Gate (mark ready, snooze, forfeit via `ready_gate_transition`); navigation to date on both_ready. See `docs/mobile-sprint4.md`.
- **Sprint 5:** Live video date: join Daily.co room via `daily-room` (create_date_room), `video_date_transition` (enter_handshake, end), local/remote video, end/leave with delete_room + backend end. See `docs/mobile-sprint5.md`.
- **Sprint 6:** RevenueCat entitlements + release hardening: canonical backend subscription (Stripe + RevenueCat), premium screen (offerings, purchase, restore), RevenueCat webhook sync. See `docs/mobile-sprint6.md`.
- **Deferred:** Read receipts and notification deep link, post-date survey on mobile. Schedule, public profile, match celebration, delete-account native flow remain as current repo (link-out or later).

## Release readiness (Sprint 6)

- **Dev build required:** Video (Daily) and in-app purchases (RevenueCat) use native modules; they do **not** run in Expo Go. Use `npx expo prebuild` and run on simulator/device, or EAS Build.
- **External setup:** RevenueCat dashboard (project, apps, products, offerings, webhook URL + auth header). Supabase: deploy `revenuecat-webhook` and set `REVENUECAT_WEBHOOK_AUTHORIZATION` secret.
- **Store submission:** Not part of Sprint 6; app is ready for dev/preview builds and entitlement flow. App Store / Play Store submission and dashboard configuration are separate steps.

**Launch-closure docs (repo root):**

- `docs/active-doc-map.md` — current doc entrypoint map: where to start, where evidence is recorded, and which docs are canonical vs historical.
- `docs/kaan-launch-closure-execution-sheet.md` — one-page operator sequence.
- `docs/native-launch-closure-master-runbook.md` — canonical launch-closure narrative, criteria, and escalation.
- `docs/native-final-blocker-matrix.md` — single active launch backlog and evidence log.
- `docs/native-external-setup-checklist.md` — Supabase migrations/functions/secrets, RevenueCat, OneSignal, Daily, Expo/EAS, App Store Connect, Play Console, env vars.
- `docs/native-manual-test-matrix.md` — manual test matrix for all domains and cross-platform (web ↔ iOS/Android).
- `docs/phase7-stage5-release-readiness-and-go-nogo.md` — strict release-readiness matrix and go/no-go.

## Checks

- **TypeScript:** `npx tsc --noEmit` (from `apps/mobile`).
- **Web (root):** `npm run typecheck:core` and `npm run build` from repo root must still pass.
