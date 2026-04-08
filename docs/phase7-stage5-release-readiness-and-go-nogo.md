# Phase 7 Stage 5 — Release Readiness and Go/No-Go Summary

## Goal

Close remaining release-readiness and metadata gaps, update docs/checklists to current truth, and produce a strict go/no-go summary. Release readiness includes provider proof, environment clarity, and known-risk accounting.

**Open hardening caveat (from web baseline) accounted for:** Production OneSignal **web** service-worker asset and origin configuration, and the logged rebuild rehearsal, are called out in §5, §8, §9, and §12 so they are not forgotten in the final readiness picture.

**Operator sequence:** `npm run launch:preflight` → **`docs/kaan-launch-closure-execution-sheet.md`**. Pass/fail evidence table: **`docs/native-final-blocker-matrix.md`**. Narrative and escalation: **`docs/native-launch-closure-master-runbook.md`**.

---

## 1. Release-Readiness Matrix (Strict: Done / Proven / Partially proven / Not yet proven)

| Area | Done (code/config) | Proven (real evidence) | Partially proven | Not yet proven |
|------|--------------------|------------------------|------------------|----------------|
| **Android** | Build path and runtime code paths in place; auth race and Settings crash fixed. | — | Prebuild and run:android path documented; no device run in Phase 7. | Full cold start → tabs → dashboard → profile → events → matches → chat → premium → push on real device. |
| **iOS** | Prebuild succeeded; run:ios compiles (Pods observed). Bundle ID, entitlements, OneSignal NSE in app.json. | — | Prebuild + compilation in progress observed; full run:ios not seen to completion in automation. | First launch on simulator/device; full runtime checklist; signing on physical device. |
| **RevenueCat** | SDK init, logIn, offerings fetch (post–logIn), purchase, restore, backend refetch; premium UI states; webhook + trigger in repo. | — | Code and design validated in Phase 7 Stage 2; offerings refetch fix applied. | Real-device sandbox purchase + restore; webhook delivery to Supabase; DB sync. |
| **OneSignal (mobile)** | Init, permission, login(userId), upsert notification_preferences; logout on sign out; app.config.js APNs mode. | — | Code path validated in Phase 7 Stage 3. | Real-device push receive; dashboard → device delivery; APNs/FCM configured. |
| **OneSignal (web)** | Web SDK and notification_preferences; send-notification targets web + mobile. | Production worker + authenticated subscribed browser session + `notification_preferences` sync (see `docs/browser-auth-runtime-proof-results.md`). | Interactive permission prompt + delivered-notification tap (manual-only; automation cannot own). | Residual: confirm dashboard origin / service-worker paths still match production after deploys (quick operator audit). |
| **Daily** | Room/token, join, permissions, tracks, leave/endVideoDate on unmount; backend session cleanup fix in Phase 7 Stage 3. | — | Code path validated. | Real-device/simulator join, media, end; backend state after leave. |
| **Env/config** | .env.example and checklist list all EXPO_PUBLIC_*; app.config.js OneSignal mode; EAS profiles (development, preview, production). | — | Env vars documented; EAS secrets must be set by operator. | EAS build with secrets; production env verification. |
| **Store metadata / submission** | Bundle ID and package `com.vibelymeet.vibely`; eas.json profiles; store listing not in repo. | — | — | App Store Connect / Play Console listing; screenshots; privacy; submission. |

**Legend**

- **Done:** Implemented in repo and/or documented; no known code defect for the flow.
- **Proven:** Real build completed and/or real device test passed and recorded.
- **Partially proven:** Code review or one platform/build step done; not full E2E on target.
- **Not yet proven:** Requires operator/build/device action; no evidence yet.

---

## 2. Android Readiness Summary

| Item | Status |
|------|--------|
| **Build** | Prebuild and `npx expo run:android` path documented. No device/emulator attached in Phase 7 Stage 1. |
| **Runtime fixes** | Auth race (index.tsx: wait for onboardingComplete); Settings crash (radius import). |
| **Validation** | Full validation requires: device/emulator, run through manual test matrix (auth, tabs, dashboard, profile, events, matches, chat, premium, push). |
| **Blocker** | No code blocker. Blocker = device run + provider dashboards (RevenueCat, OneSignal) + EAS secrets. |

**Verdict:** **Beta-ready from code perspective** once EAS build succeeds and provider setup is done. **Not proven** until a full device run is completed and recorded.

---

## 3. iOS Readiness Summary

| Item | Status |
|------|--------|
| **Build** | `npx expo prebuild --platform ios` succeeded. `npx expo run:ios` was started; Pods compiled (Hermes, RN, Daily, OneSignal, RevenueCat, etc.); full build not observed to completion in automation. |
| **Config** | Bundle ID `com.vibelymeet.vibely`, appleTeamId, deploymentTarget 15.1, infoPlist usage strings, OneSignal NSE, aps-environment. |
| **Validation** | First launch and runtime checklist (startup, auth, shell, dashboard, profile, events, matches, chat, media, Daily, RevenueCat, OneSignal) to be filled after local run (see phase7-stage4-ios-build-and-runtime-validation.md). |
| **Blocker** | No code blocker. Signing and first-run proof require local Xcode/device or EAS build. |

**Verdict:** **Beta-ready from code/config perspective** once a full `expo run:ios` (or EAS iOS build) completes and first-run checklist is executed. **Not proven** until first successful launch and at least one full pass documented.

---

## 4. RevenueCat Readiness Summary

| Item | Status |
|------|--------|
| **Code** | Init, setRevenueCatUserId, getOfferings (refetched when user.id set), purchase, restore, refetch; premium screen states; backend via revenuecat-webhook. |
| **Fix applied** | Offerings effect depends on user?.id so packages are post–logIn (Phase 7 Stage 2). |
| **Proven** | No. Requires: RevenueCat dashboard (products, offerings, webhook), Supabase revenuecat-webhook deploy + REVENUECAT_WEBHOOK_AUTHORIZATION, store products, then real-device sandbox purchase + restore + DB check. |

**Verdict:** **Release-ready for beta** from an integration standpoint **provided** dashboard, webhook, and store are configured. End-to-end is **not yet proven** without a real-device test.

---

## 5. OneSignal Readiness Summary

### Mobile (native)

| Item | Status |
|------|--------|
| **Code** | initOneSignal, registerPushWithBackend (permission, login, getIdAsync, upsert notification_preferences), logoutOneSignal; PushRegistration in root layout. |
| **Proven** | No. Requires: OneSignal dashboard iOS + Android apps, APNs key + FCM, EXPO_PUBLIC_ONESIGNAL_APP_ID in env/EAS, then real-device sign-in → permission → test push receive. |

**Verdict:** Code path correct; **not proven** until push is received on a real device.

### Web (open hardening caveat)

| Item | Status |
|------|--------|
| **Production service-worker** | OneSignal v16 web push requires the OneSignal service-worker script to be served **from the domain root** so it does not 404. Site origin and service-worker configuration in the **OneSignal dashboard** must match production. |
| **Rebuild rehearsal** | A rebuild rehearsal was logged (`_cursor_context/rebuild_rehearsals/2026-03-11_current-controlled-baseline.md`). For submission readiness, a **post–Phase-7** clean rebuild rehearsal (and, if applicable, verification that web OneSignal service-worker and origin are correct in production) should be run and logged so it is not forgotten. |

**Verdict:** Core **web** push plumbing and subscribed state are **proven** in automation; remaining gap for “full human confidence” is **interactive** prompt + notification tap. Treat production dashboard origin/service-worker parity as a short **KD** audit after material web deploys, not an unvalidated unknown.

---

## 6. Daily Readiness Summary

| Item | Status |
|------|--------|
| **Code** | getDailyRoomToken, join, leave, endVideoDate on unmount (Phase 7 Stage 3 fix); PermissionsAndroid on Android. |
| **Proven** | No. Requires: daily-room EF deployed, dev build, then join from lobby/Ready Gate → camera/mic → see local/remote → end/leave → confirm backend session ended. |

**Verdict:** Code path correct and unmount cleanup fixed; **not proven** until a join/leave is done on device/simulator and backend state verified.

---

## 7. Environment / Config Readiness Summary

| Item | Status |
|------|--------|
| **Documented** | native-external-setup-checklist.md: Supabase, RevenueCat, OneSignal, Daily, EAS, env vars, store. |
| **Repo** | app.json bundle/package, plugins, infoPlist, entitlements; app.config.js OneSignal mode; eas.json profiles. |
| **Secrets** | EAS secrets and Supabase secrets must be set by operator; not in repo. |
| **Missing** | No repo config missing for builds; failures are typically credentials or env. |

**Verdict:** **Ready** from a documentation and repo-config standpoint; operator must set secrets and dashboards.

---

## 8. Store Metadata / Submission Prerequisites

| Item | Status |
|------|--------|
| **App identity** | Bundle ID / package `com.vibelymeet.vibely` in app.json. |
| **EAS** | development, preview, production profiles; submit production. |
| **Store listing** | Not in repo: App Store Connect / Play Console app records, screenshots, descriptions, privacy, IAP products, agreements. |
| **Submission** | TestFlight / Play internal: EAS submit or dashboard upload after successful build. |

**Verdict:** **Exact next actions** to move from beta-ready to submission-ready are in §9 below.

---

## 9. Known Unresolved Risks

**Ownership tags:** **KD** = Kaan dashboard/store; **KB** = Kaan build/install; **KV** = Kaan device proof; **CF** = Cursor repo/doc/code only if a defect is proven (see `docs/kaan-launch-closure-execution-sheet.md`).

| Risk | Owner | Mitigation |
|------|--------|------------|
| **RevenueCat / OneSignal mobile not configured** | **KD** | `docs/native-external-setup-checklist.md` §2–3; order in `docs/kaan-launch-closure-execution-sheet.md`. |
| **No real-device proof yet (native)** | **KV** (after **KB**) | EAS or local install; Phase 7 Stage 4 iOS + Android manual matrix; record in `docs/native-final-blocker-matrix.md` § Sprint 6 test results. |
| **OneSignal web — interactive gap** | **KV** (manual browser) | Close prompt acceptance + delivered-notification tap in a real browser session; worker/subscribed state already in `docs/browser-auth-runtime-proof-results.md`. |
| **OneSignal web — dashboard / origin drift** | **KD** | After production web changes, quick audit that OneSignal dashboard origin + service-worker paths match the live site. |
| **Rebuild rehearsal stale** | **KD** / **CF** | Re-run clean rebuild + smoke per `docs/rebuild-rehearsal-log.md`; **CF** only if the rehearsal fails for a repo defect. |
| **Repo typecheck regression** | **CF** (if CI/local fails) | `npm run typecheck` at repo root is **closed** — keep green; **CF** only when a merge introduces errors (see `docs/phase7-closure-typecheck-and-repo-ready.md`). |

---

## 10. Exact Next Actions: Beta-Ready → Submission-Ready

1. **Provider and backend (Kaan)**  
   - RevenueCat: project, iOS/Android apps, products, entitlement, offering, webhook URL + auth; App Store Connect / Play Console products.  
   - Supabase: migrations applied; `revenuecat-webhook` deployed; `REVENUECAT_WEBHOOK_AUTHORIZATION` set.  
   - OneSignal: same project as web; iOS app (bundle ID, APNs); Android app (FCM); set `EXPO_PUBLIC_ONESIGNAL_APP_ID` in .env and EAS secrets.  
   - EAS secrets for preview/production: Supabase, OneSignal, RevenueCat (and optional Bunny).

2. **Build and device proof (Kaan)**  
   - iOS: `npx expo run:ios` on Mac (or `eas build --profile preview --platform ios`), install, run through phase7-stage4 runtime checklist; fix any signing/runtime blockers.  
   - Android: device/emulator, `npx expo run:android` (or EAS preview build), install, run through manual test matrix.  
   - Record pass/fail in native-final-blocker-matrix.md § Sprint 6 test results.

3. **Real-device provider proof (Kaan)**  
   - RevenueCat: sandbox purchase + restore on device; confirm webhook and DB.  
   - OneSignal: test push send from dashboard to device; confirm receive.  
   - Daily: join a video date from lobby; confirm media and end/leave; confirm backend session ended.

4. **Web and rehearsal (Kaan / Cursor)**  
   - OneSignal web: production service-worker at root; OneSignal dashboard origin/service-worker for production; verify web push.  
   - Rebuild rehearsal: run full clean rebuild (and web smoke if applicable); log; fix any breakage.

5. **Store submission (Kaan)**  
   - App Store Connect: app record, IAP products, TestFlight upload (e.g. `eas submit`).  
   - Play Console: app record, subscription products, internal track upload.  
   - Store listings: screenshots, descriptions, privacy policy, etc., per platform.

6. **Repo health (maintenance)**  
   - Keep `npm run launch:preflight` and `npm run typecheck` green after material changes. **CF** only if either fails for non-secret reasons.

**Step-by-step instructions for store consoles and provider dashboards:**  
- **Single-page order:** `docs/kaan-launch-closure-execution-sheet.md`.  
- **RevenueCat + Supabase:** `docs/native-external-setup-checklist.md` §1–2.  
- **OneSignal:** `docs/native-external-setup-checklist.md` §3 (mobile + web notes).  
- **EAS builds and submit:** `docs/native-sprint6-launch-closure-runbook.md` + master runbook `docs/native-launch-closure-master-runbook.md`.  
- **Device validation:** `docs/phase7-stage4-ios-build-and-runtime-validation.md` §7; `docs/phase7-stage1-android-validation.md` §4; `docs/native-manual-test-matrix.md`.

---

## 11. Missing Metadata / Assets / Config Items

| Category | Item | Where / action |
|----------|------|----------------|
| **Store** | App Store Connect: app record, screenshots, description, privacy, IAP products | Console; not in repo. |
| **Store** | Play Console: app record, store listing, subscription products, internal track | Console; not in repo. |
| **Secrets** | EAS secrets for preview/production: Supabase, OneSignal, RevenueCat (optional Bunny) | Set in EAS dashboard; not in repo. |
| **Secrets** | Supabase: REVENUECAT_WEBHOOK_AUTHORIZATION | Set via Supabase CLI/dashboard. |
| **Provider** | RevenueCat: webhook URL + auth header, products, offerings | RevenueCat dashboard. |
| **Provider** | OneSignal: iOS app (APNs), Android app (FCM), web origin/service-worker for production | OneSignal dashboard. |
| **Repo** | None | Bundle ID, package, plugins, entitlements, EAS profiles are in app.json / eas.json. |

---

## 12. Unresolved Blockers (Summary)

1. **Provider proof not yet done:** RevenueCat (dashboard + webhook + store products) and OneSignal (iOS + Android apps + credentials) must be completed; then real-device purchase/restore and push receive must be proven.
2. **First device validation not yet done:** Full iOS and Android runtime checklists (Phase 7 Stage 4 and manual test matrix) require a successful build and device run; results not yet recorded.
3. **OneSignal web — interactive proof:** Worker + subscribed browser state are proven; manual prompt + notification-tap proof still recommended before treating web push as “fully signed off.”
4. **Rebuild rehearsal:** A post–Phase 7 clean rebuild rehearsal (and web smoke if applicable) should be run and logged before submission.
5. ~~**TypeScript:** Existing tsc errors in apps/mobile~~ **Resolved in Phase 7 closure:** `npm run typecheck` now passes (see `docs/phase7-closure-typecheck-and-repo-ready.md`).

---

## 13. Go / No-Go Recommendation

**No-Go for submission today.**

**Reason:** Native **KD** (RevenueCat, OneSignal mobile dashboards, webhook) + **KB** (EAS secrets/builds) + **KV** (purchase/restore, push receive, Daily join/leave on device) are **not yet proven**. Store metadata and submission are operator-owned. Web OneSignal core plumbing is proven; remaining web gap is mainly **interactive** push proof (see §5).

**Shortest remaining critical path to submission-ready:**

1. Complete **native-external-setup-checklist.md** (RevenueCat dashboard + webhook + Supabase deploy + secret; OneSignal dashboard iOS + Android + APNs + FCM; EAS secrets).  
2. Run **one successful EAS preview build** for iOS and one for Android (or local run:ios / run:android with device).  
3. Install on **real devices**; run **RevenueCat** (purchase + restore) and **OneSignal** (test push receive) and **Daily** (one join/leave).  
4. Optional **KD** audit: OneSignal web dashboard origin/service-worker vs production after deploys; run **manual** web push prompt + tap if product requires it; run **rebuild rehearsal** and log.  
5. ~~Fix **typecheck** in apps/mobile~~ **Done** (Phase 7 closure; see `docs/phase7-closure-typecheck-and-repo-ready.md`).  
6. Complete **store** metadata and **submit** to TestFlight / Play internal.

---

## 14. Rebuild Delta / Docs Update Note (Phase 7)

- **Phase 7 code changes:**  
  - `app/index.tsx`: wait for onboardingComplete (no redirect to tabs when null).  
  - `app/settings/index.tsx`: add radius import.  
  - `app/premium.tsx`: offerings effect dependency on user?.id; setOfferingsLoading at start of effect.  
  - `app/date/[id].tsx`: unmount cleanup calls endVideoDate(sessionId).  
  - **Phase 7 closure (typecheck):** `components/ui.tsx` Chip `backgroundColor`/`borderColor`/`labelColor` typed as `string`; `app/(tabs)/matches/index.tsx` VibelyText `variant` added (6 usages); `app/(tabs)/profile/index.tsx` zodiac `Text`: `title` → `accessibilityLabel`; `app/daily-drop.tsx` VibelyButton given `onPress={() => {}}`.

- **Docs updated in Stage 5 / closure:**  
  - This file: phase7-stage5-release-readiness-and-go-nogo.md (new).  
  - native-release-readiness.md: updated to reflect Phase 7 and current truth.  
  - native-final-blocker-matrix.md: Phase 7 status; OneSignal web caveat; Sprint 6 test results reference.  
  - native-external-setup-checklist.md: OneSignal web (production service-worker / origin) note added.  
  - **Phase 7 closure:** `docs/phase7-closure-typecheck-and-repo-ready.md` (typecheck fixes, repo-ready status, remaining blockers, Kaan step-by-step).

- **Config:** No app.json or eas.json or env schema changes in Phase 7 Stage 5 or closure. OneSignal web and rebuild rehearsal are documented as known risks and next actions.
