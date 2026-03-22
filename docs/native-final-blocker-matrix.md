# Native final blocker matrix (through Phase 7)

Categorized view of what blocks production-style validation vs what is acceptable or deferred. Reflects Sprints 1–6 and **Phase 7** (Android/iOS runtime validation, RevenueCat/OneSignal/Daily validation, release-readiness go/no-go). Use for go/no-go and prioritization.

**Phase 7 go/no-go:** See `docs/phase7-stage5-release-readiness-and-go-nogo.md`. Current recommendation: **No-Go** until provider proof and first device validation are done; OneSignal web production service-worker and rebuild rehearsal are accounted for as known risks.

---

## Blocker ownership (Sprint 6)

| Owner | Meaning | Items |
|-------|--------|--------|
| **Cursor (solvable now)** | Repo/docs/code changes Cursor can do. | None remaining; runbook and config check in place. |
| **Kaan (dashboard/store/device)** | Must be done by Kaan: dashboard setup, store consoles, EAS secrets, device install and testing. | RevenueCat dashboard + webhook + store products; OneSignal dashboard (iOS + Android, APNs/FCM); EAS secrets; running builds and submitting to TestFlight/Play. |
| **Requires build/test evidence** | Resolved only by a successful build and/or device test. | EAS preview/production build success; RevenueCat purchase/restore on device; OneSignal push delivery on device; full iOS/Android validation checklist. |

---

## Blocker (must resolve before production / TestFlight-style validation)

| Item | Notes |
|------|--------|
| **RevenueCat dashboard + webhook** | Products, offerings, entitlement, webhook URL and auth header; App Store Connect / Play Console subscription products. Without these, premium screen shows "No offerings available." **Owner:** Kaan. See `docs/native-external-setup-checklist.md` §2 and §2.4; execution order in `docs/native-sprint6-launch-closure-runbook.md`. |
| **OneSignal dashboard (iOS + Android)** | Add iOS app (bundle ID, APNs key/cert) and Android app (FCM). App code is ready; push will not deliver until OneSignal is configured. **Owner:** Kaan. See §3 and runbook Phase 3–4. |
| **EAS build + secrets** | For real-device validation: EAS profile (preview or production), credentials, and EAS secrets for Supabase, OneSignal App ID, RevenueCat API keys. **Owner:** Kaan. See §5 and §5.1; runbook Phase 5–6. |
| **Store submission** | When moving to production: signing, TestFlight/Play upload, store listing. **Owner:** Kaan. Runbook Phase 6. |

---

## Blocker resolution plan (Kaan dashboard/device actions)

For items that are blocking and have a clear resolution path:

### RevenueCat (hard blocker)

- **Cause:** Products/offerings not configured in RevenueCat dashboard, or API key points at a project with no packages.
- **Fix:** Follow `docs/native-external-setup-checklist.md` §2 and §2.4: RevenueCat dashboard (products, entitlement, offering, webhook), Supabase `revenuecat-webhook` + secret, App Store Connect / Play Console products. App shows "No offerings available" until configured; no code change required.

### OneSignal (hard blocker for push)

- **Cause:** OneSignal project must have iOS and Android apps with APNs/FCM configured.
- **Fix:** Follow `docs/native-external-setup-checklist.md` §3: Add iOS app (bundle ID, APNs), Android app (FCM). Set `EXPO_PUBLIC_ONESIGNAL_APP_ID` in EAS secrets. App uses production APNs for EAS preview/production builds via `app.config.js`.

### OneSignal web (production — open hardening caveat)

- **Cause:** OneSignal v16 web push requires the service-worker script to be served **from the production domain root** and correct origin/service-worker configuration in the OneSignal dashboard. Without this, production web push can fail or be untested.
- **Fix:** Ensure production site serves the OneSignal service-worker from root (no 404); in OneSignal dashboard configure the web app’s origin and service-worker settings for production. See `docs/native-external-setup-checklist.md` §3 (web note) and runbook. **Do not forget** this when moving to submission; it is part of the release-readiness picture.

### Bunny photo 404 (non-blocker for launch if accepted)

- **Cause:** Pull zone returns 404 — request reaches CDN but path not found. App builds URLs per contract (`photos/{userId}/{timestamp}.{ext}`); no app bug.
- **Fix (provider-side only):**
  1. In Bunny dashboard, open the pull zone that serves your CDN hostname (e.g. `cdn.vibelymeet.com`).
  2. Set **Origin** to **Storage zone** and select the **same** storage zone as `BUNNY_STORAGE_ZONE` (used by upload-image EF).
  3. If the zone uses a path prefix for the storage root, set `EXPO_PUBLIC_BUNNY_CDN_PATH_PREFIX` (and web `VITE_BUNNY_CDN_PATH_PREFIX`) to that prefix; otherwise leave unset.
  4. Confirm in DB that stored paths look like `photos/...`; test one URL in Safari.
- **App-side:** None required; URL logic is correct.


---

## Non-blocking known issue

Known issues that do not block release-readiness or dev validation. Fix when convenient.

| Item | Notes |
|------|--------|
| **RevenueCat console warnings** | When dashboard not fully set up; premium screen shows intentional empty state. Resolve via dashboard before launch. |
| **Reset-password screen** | Minimal flow; web has full flow. Document as P1 if needed. |
| **Bunny photo 404** | Until pull zone configured; upload works; display may show placeholder. Acceptable for launch if documented. |

---

## In v1 (done in Sprints 1–4)

| Item | Notes |
|------|--------|
| **Profile photo upload** | Image picker → upload-image EF → profiles.photos update. |
| **Vibe video** | Record → create-video-upload → tus upload → video-webhook; state and delete. |
| **Premium** | RevenueCat + backend; hard blocker until dashboard/webhook configured. |
| **Public profile** | `/user/:userId`; entry from chat. Sprint 4. |
| **Match celebration** | Unread match → celebration → Message → chat. Sprint 4. |
| **Credits** | Pack selection + create-credits-checkout → Stripe in browser. Sprint 4. |
| **Delete account** | Native flow via delete-account EF. Sprint 3. |

## Explicitly accepted web handoff (no blocker)

Schedule, profile preview, account settings, notification toggles, Daily Drop (empty state), reset password, legal/marketing links. See `docs/native-web-handoff-burndown.md`.

## Deferred

| Item | Notes |
|------|--------|
| **Photo loading (Bunny 404)** | Until pull zone configured; URL logic correct. |
| **Polish-only** | Accessibility, loading states, visual tweaks after v1 flows. |

---

## Dev-only artifact

Expected in dev builds only; not bugs and not present in production builds.

| Item | Notes |
|------|--------|
| **Expo dev client chrome** | Dev menu, reload, debug UI. Normal for dev client. |
| **RevenueCat dev warnings** | Configuration/offerings warnings when dashboard not fully set up. |
| **Photo URL trace logs** | `[Vibely photo URL]` in __DEV__; useful for diagnosis, not shipped to production. |

---

## Sprint 6 / Phase 7 test results (fill after validation)

| Phase | Pass/fail | Blocker (if fail) |
|-------|-----------|--------------------|
| RevenueCat dashboard setup | | |
| RevenueCat real-device (purchase/restore) | | |
| OneSignal dashboard setup | | |
| OneSignal real-device (push) | | |
| OneSignal web (production service-worker + origin) | | |
| EAS preview build | | |
| EAS production build | | |
| iOS device validation checklist | | |
| Android device validation checklist | | |
| Rebuild rehearsal (post–Phase 7) | | |

Execution order and Kaan steps: `docs/native-sprint6-launch-closure-runbook.md`. Full release-readiness matrix and go/no-go: `docs/phase7-stage5-release-readiness-and-go-nogo.md`.

---

## Summary

- **Blocker (must resolve for launch):** RevenueCat dashboard + webhook + store products; OneSignal dashboard (iOS + Android); EAS build + secrets. **Owner:** Kaan. All documented in `docs/native-external-setup-checklist.md` and step-by-step in `docs/native-sprint6-launch-closure-runbook.md`.
- **Non-blocking:** RevenueCat warnings until configured, reset-password minimal, Bunny 404 until pull zone.
- **In v1 (done):** Profile photo, vibe video, premium, public profile, match celebration, credits, delete account.
- **Accepted web handoff:** Schedule, account, notifications, Daily Drop, reset password, legal/marketing.
- **Deferred:** Bunny photo loading, polish.
- **Dev-only:** Dev client UI, RevenueCat warnings, trace logs.
