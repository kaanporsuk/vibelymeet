# Sprint 5 — Provider/build and launch closure prep

Branch: `feat/native-sprint5-provider-build-and-launch-closure`

## Scope

No new product surfaces. OneSignal and RevenueCat real-device closure prep, production-style build validation prep, and launch blocker matrix refresh.

## Delivered

1. **OneSignal:** App code already complete (init, request permission, login, register `mobile_onesignal_player_id` with backend). Added `app.config.js` so EAS `preview` and `production` builds use APNs **production** mode (TestFlight/Store); dev keeps **development**. Documented in `docs/native-external-setup-checklist.md` §3: env, dashboard (iOS + Android, APNs/FCM), and exact real-device validation steps.

2. **RevenueCat:** Re-audited; app code and env documented. No code changes. §2 and §2.4 in external-setup-checklist remain the single source for dashboard, webhook, and real-device validation.

3. **Build validation prep:** §5 and new §5.1 in external-setup-checklist: EAS profiles, secrets, and step-by-step for local iOS/Android and EAS TestFlight-style builds. No missing app config or plugins identified.

4. **Launch blocker matrix:** `docs/native-final-blocker-matrix.md` updated: blockers = RevenueCat dashboard + webhook, OneSignal dashboard, EAS build + secrets, store submission; resolution plan points to checklist; in-v1 and accepted web handoff summarized.

5. **Release readiness:** `docs/native-release-readiness.md` updated to reflect Sprints 1–5 and current blockers (Kaan dashboard/device actions).

## Files changed

- `apps/mobile/app.config.js` (new) — OneSignal plugin mode from `EAS_BUILD_PROFILE`.
- `docs/native-external-setup-checklist.md` — §2 RevenueCat app status + env; §3 OneSignal expanded with real-device steps; §5 EAS secrets and §5.1 build validation prep.
- `docs/native-final-blocker-matrix.md` — Blocker list, resolution plan (RevenueCat, OneSignal, Bunny), in-v1, accepted handoff, summary.
- `docs/native-release-readiness.md` — Through Sprint 5; blockers and Sprint 5 note.
- `docs/native-sprint5-summary.md` (this file).

## Remaining hard blockers (for Kaan)

- RevenueCat: products, offerings, entitlement, webhook URL + auth, App Store Connect / Play Console products.
- OneSignal: iOS app (APNs), Android app (FCM), `EXPO_PUBLIC_ONESIGNAL_APP_ID` in EAS.
- EAS: build profile (preview/production), credentials, EAS secrets for Supabase, OneSignal, RevenueCat.

All steps are in `docs/native-external-setup-checklist.md`.
