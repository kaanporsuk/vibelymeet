# Native Launch Readiness — Post–Sprint 6

> **Historical / superseded for active launch closure.** Use `docs/active-doc-map.md` for the current entrypoint chain. This file is kept as a pre-consolidation readiness snapshot and should not be used as the primary operator runbook.

Status after completion of Sprints 1–6 for the Vibely native build stream. This doc is integration- and release-prep focused; no new product features.

## Current completion status by domain

| Domain | Implemented in repo | Backend shared | External setup required | Device validation |
|--------|---------------------|----------------|--------------------------|-------------------|
| Auth / session | Yes (Supabase, AsyncStorage, route guards) | Yes | None | Session restore on real device |
| Onboarding / profile | Yes (name, gender, tagline, job, about; no photo upload) | Yes | None | — |
| Events / register / lobby | Yes (list, detail, register, lobby, deck) | Yes | None | — |
| Discovery / swipes | Yes (deck, vibe/pass/super vibe via swipe-actions) | Yes | None | — |
| Matches / chat | Yes (matches list, thread, send-message, realtime) | Yes | None | — |
| Push notifications | Yes (OneSignal SDK, mobile player ID, send-notification multi-device) | Yes | OneSignal dashboard, app credentials | Real device push receive |
| Daily Drop | Yes (view, opener/reply, pass, mark viewed) | Yes | None | — |
| Ready Gate | Yes (mark ready, snooze, forfeit, navigate to date) | Yes | None | — |
| Video date | Yes (Daily.co join, media views, end, backend transition) | Yes | Daily dashboard, dev build | Real device/simulator video |
| Premium / subscriptions | Yes (RevenueCat SDK, premium screen, backend sync) | Yes (subscriptions provider, webhook) | RevenueCat + webhook deploy | Real device purchase/restore |

## What is implemented in repo

- **apps/mobile:** Full Expo/React Native app with auth, onboarding, tabs (events, matches, profile), event lobby with deck and swipe actions, chat and matches, Daily Drop, Ready Gate, video date (Daily.co), premium (RevenueCat), settings. All using shared Supabase backend and documented Edge Functions/RPCs.
- **Shared backend (additive):** Migration for `notification_preferences.mobile_onesignal_player_id`; migration for `subscriptions.provider` + trigger for `profiles.is_premium`; `send-notification` targets web + mobile player IDs; `revenuecat-webhook` Edge Function; Stripe webhook and checkout/portal/credits use `provider = 'stripe'`.
- **Web:** `useSubscription` supports multi-provider; no breaking changes. Golden path runbook and smoke script in repo.
- **Docs:** Architecture plan, sprint docs (mobile-sprint1–6), this launch-readiness doc, external-setup checklist, manual test matrix.

## What still requires external setup

- **Supabase:** Apply migrations (notification_preferences mobile columns; subscriptions provider + trigger). Deploy Edge Function `revenuecat-webhook`; set secret `REVENUECAT_WEBHOOK_AUTHORIZATION`.
- **RevenueCat:** Create project; link iOS/Android apps; create products and offerings; set webhook URL to `https://<project>.supabase.co/functions/v1/revenuecat-webhook` and authorization header to match the secret above.
- **OneSignal:** App configured for web; ensure iOS/Android apps and credentials are configured for mobile push (same app or linked).
- **Daily:** Domain and API key already used by web; no extra mobile-only config required for same project.
- **Expo/EAS:** For TestFlight/Play internal: EAS project, credentials, and build profiles (not required for local dev build).
- **App Store Connect / Play Console:** App records, signing, store listings, and submission (out of scope for “launch readiness” in repo).

## What must be tested on real device

- **Session restore:** Kill app, reopen; session persists and user remains logged in.
- **Push notifications:** Receive a push (e.g. match, message) with app in background/foreground.
- **Video date:** Join Daily room, see local/remote video, end call; backend state and partner experience correct.
- **Premium:** Load offerings (if RevenueCat configured), complete sandbox purchase, restore purchases; backend `subscriptions` and `profiles.is_premium` update after webhook.

## What must be validated before TestFlight / Play internal testing

- Apply all migrations to the target Supabase project.
- Deploy all Edge Functions (including `revenuecat-webhook`) and set required secrets.
- RevenueCat webhook configured and verified (e.g. test event from dashboard).
- OneSignal mobile push sending and received on real device.
- Daily video join/leave and backend state correct on real device or simulator.
- Run through `docs/native-manual-test-matrix.md` for auth, onboarding, events, lobby, swipes, matches, chat, Daily Drop, Ready Gate, video date, premium (where applicable).
- Web golden path still passes after merge (`npm run typecheck:core`, `npm run build`, `./scripts/run_golden_path_smoke.sh`).

## What must be validated before production

- All of the TestFlight/Play internal checklist.
- RevenueCat production API keys and production webhook; App Store / Play Store production IAP.
- OneSignal production credentials and any rate/quotas.
- Daily production domain/keys if different from staging.
- Final store review and compliance (privacy, permissions, etc.) per platform.

## Branch / merge note

The “native branch chain” may exist as one branch with multiple commits or as committed work plus local (uncommitted) changes. Before merge:

- Ensure all intended native and shared-backend changes are committed.
- Merge into `main` as one tranche (or as a small number of reviewed PRs) so that web and mobile stay on the same backend contract.
- After merge, run web checks and, if possible, a quick mobile typecheck from repo root.

See `docs/native-external-setup-checklist.md` for stepwise external setup and `docs/native-manual-test-matrix.md` for manual test coverage.

---

## Release risk summary (concrete only)

| Risk | Mitigation |
|------|------------|
| **External provider configuration not yet completed** | RevenueCat (project, apps, products, offerings, webhook), OneSignal (mobile apps/credentials), Supabase (migrations, revenuecat-webhook deploy, webhook secret) are required before TestFlight/Play. Use `docs/native-external-setup-checklist.md`. |
| **RevenueCat webhook not yet deployed/tested** | Deploy `revenuecat-webhook`, set `REVENUECAT_WEBHOOK_AUTHORIZATION`, configure same in RevenueCat dashboard; send test event from dashboard to verify. |
| **OneSignal mobile push not yet device-validated** | Configure iOS/Android in OneSignal, build app with correct credentials; test receive on real device. |
| **Daily native video not yet device-validated** | Same backend `daily-room` as web; run dev build on simulator or device and join a date; confirm media and end flow. |
| **Unvalidated native dev-build behavior** | Run `docs/native-manual-test-matrix.md` on a dev build (simulator + real device for push/IAP/video). |
| **Branch/merge state** | Ensure all intended native and shared-backend changes are committed before merge; merge as one tranche (or small number of PRs) so web and mobile stay on same backend. |
| **Onboarding completeness mismatch** | Web may require photos for “complete”; mobile treats profile row as complete (no photo upload in app). Documented in sprint docs; no code change in this pass. |
