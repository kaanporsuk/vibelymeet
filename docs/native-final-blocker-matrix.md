# Native final blocker matrix (through Phase 7)

Categorized view of what blocks production-style validation vs what is acceptable or deferred. Reflects Sprints 1–6 and **Phase 7** (Android/iOS runtime validation, RevenueCat/OneSignal/Daily validation, release-readiness go/no-go). Use this as the **single active launch backlog and evidence log** for go/no-go and prioritization.

**Active doc map:** `docs/active-doc-map.md`

**Phase 7 go/no-go:** See `docs/phase7-stage5-release-readiness-and-go-nogo.md`. Current recommendation: **No-Go** until **KD** (RevenueCat, OneSignal mobile, webhook), **KB** (EAS secrets + installable builds), and **KV** (sandbox purchase/restore, push receive, Daily on device) are done — not because core web or repo typecheck is failing. Rebuild rehearsal is logged; authenticated browser proof covers Schedule, Referrals, OneSignal worker + subscribed session + DB sync, Vibe Studio read/caption/fresh binary upload→processing→ready/replace/cleanup, and public-profile route render. Remaining **browser** gaps: interactive push prompt + notification tap (manual). **Operator path:** `docs/kaan-launch-closure-execution-sheet.md` + `docs/native-launch-closure-master-runbook.md`.

---

## Blocker ownership (Sprint 6)

| Tag | Meaning | Typical items |
|-----|--------|----------------|
| **KD** | Kaan — dashboard or store console | RevenueCat project/apps/products/offering/webhook; Supabase `revenuecat-webhook` deploy + `REVENUECAT_WEBHOOK_AUTHORIZATION`; OneSignal iOS/Android apps + APNs/FCM; App Store Connect / Play Console products |
| **KB** | Kaan — build/install | EAS preview/production builds; local `expo run:*`; install on device; store upload when applicable |
| **KV** | Kaan — device/runtime proof | Sandbox purchase + restore; test push receive; Daily join/leave; manual test matrix rows |
| **CF** | Cursor — repo/doc/code **only if** failure is proven | Typecheck/preflight regression; webhook/function defect after URL/secrets verified; doc contradictions |

---

## Blocker (must resolve before production / TestFlight-style validation)

| Item | Notes |
|------|--------|
| **RevenueCat dashboard + webhook** | Products, offerings, entitlement, webhook URL and auth header; App Store Connect / Play Console subscription products. Without these, premium screen shows "No offerings available." **KD.** See `docs/native-external-setup-checklist.md` §2 and §2.4; order in `docs/kaan-launch-closure-execution-sheet.md`. |
| **OneSignal dashboard (iOS + Android)** | Add iOS app (bundle ID, APNs key/cert) and Android app (FCM). App code is ready; push will not deliver until OneSignal is configured. **KD.** See §3. |
| **EAS build + secrets** | For real-device validation: EAS profile (preview or production), credentials, and EAS secrets for Supabase, OneSignal App ID, RevenueCat API keys. **KD** (secrets) + **KB** (build). See `docs/kaan-launch-closure-execution-sheet.md` §4–5. |
| **Real-device validation** | Purchase/restore, push receive, Daily, shell flows. **KV** after **KB.** Record pass/fail in this file § Sprint 6 test results. |
| **Store submission** | When moving to production: signing, TestFlight/Play upload, store listing. **KD** + **KB.** |

---

## Blocker resolution plan (Kaan dashboard/device actions)

For items that are blocking and have a clear resolution path:

### RevenueCat (hard blocker)

- **Cause:** Products/offerings not configured in RevenueCat dashboard, or API key points at a project with no packages.
- **Fix:** Follow `docs/native-external-setup-checklist.md` §2 and §2.4: RevenueCat dashboard (products, entitlement, offering, webhook), Supabase `revenuecat-webhook` + secret, App Store Connect / Play Console products. App shows "No offerings available" until configured; no code change required.

### OneSignal (hard blocker for push)

- **Cause:** OneSignal project must have iOS and Android apps with APNs/FCM configured.
- **Fix:** Follow `docs/native-external-setup-checklist.md` §3: Add iOS app (bundle ID, APNs), Android app (FCM). Set `EXPO_PUBLIC_ONESIGNAL_APP_ID` in EAS secrets. App uses production APNs for EAS preview/production builds via `app.config.js`.

### OneSignal web (production — remaining manual-only gap)

- **Cause:** Production web push serving and subscribed browser state are now proven, but headless automation cannot complete a human-granted browser permission outcome or click a delivered notification.
- **Fix:** **KV** (manual browser) — prompt acceptance + notification click/deep-link. Worker + subscribed state already in `docs/browser-auth-runtime-proof-results.md`. See `docs/native-external-setup-checklist.md` §3 (web note).

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
| **Delete account** | Scheduled/cancelable deletion flow via `request-account-deletion` + `cancel-deletion`; web Settings and native are now normalized to the same contract. |

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
| RevenueCat dashboard setup | Partial | Operator confirmed RevenueCat dashboard/apps/products/offering are configured. `revenuecat-webhook` is deployed and active in Supabase, but webhook delivery / DB sync is not yet evidenced here. Remaining blocker: **KD** for webhook/header truth, then **KV** for purchase proof. |
| RevenueCat real-device (purchase/restore) | Blocked by KV | No operator evidence yet for sandbox/tester purchase + restore on device. |
| OneSignal dashboard setup | Blocked by KD | No operator evidence yet for iOS + Android OneSignal credential/dashboard completion. |
| OneSignal real-device (push) | Blocked by KD | No operator evidence yet for delivered mobile push on iOS or Android; dashboard setup remains the first blocker. |
| Daily real-device (join/leave) | Blocked by KV | `daily-room` Edge Function is deployed and active in Supabase, but no operator evidence yet for join/leave media flow or backend cleanup confirmation on device. |
| OneSignal web (production service-worker + origin) | Partial | **Proven:** worker + subscribed session + DB sync (`docs/browser-auth-runtime-proof-results.md`). **KV:** interactive prompt + delivered-notification click. **KD:** quick dashboard/origin audit after production web deploys. |
| Authenticated browser proof (Schedule / Referrals / Vibe Studio / invite landing) | Pass | `docs/browser-auth-runtime-proof-results.md` hard-proves authenticated `/schedule`, schedule save + rollback, authenticated `/settings/referrals`, canonical invite copy, browser `/invite?ref=` handoff into `/auth?ref=...`, and post-fix authenticated `/vibe-studio` render health. |
| Authenticated public-profile browser proof | Pass | `npm run proof:smoke-bootstrap` now opens `/user/2cf4...` from an authenticated partner session and hard-proves public-profile render of name/age, tagline, photo verification, ready Vibe Video caption, About Me, vibes, and lifestyle without hitting the not-found shell. |
| Authenticated smoke-account browser bootstrap + proof | Pass | `npm run proof:smoke-bootstrap` now resets fresh smoke passwords via linked SQL, seeds tagged proof data, and hard-proves non-empty schedule buckets, reminder countdown routing on `/schedule` + `/dashboard`, referral set-once/self-ref/repeat immutability, Vibe Studio ready/caption save-revert, create/upload-entry plus delete cleanup, and public-profile route render. |
| Fresh Vibe video binary upload -> processing -> ready / replace (web harness) | Pass | `npm run proof:vibe-upload-processing` kept primary smoke profile `2cf4...` untouched, cleaned partner `2a09...` back to `none`, uploaded two real `video/webm` assets through Bunny tus, observed profile + `draft_media_sessions` `processing -> ready` on fresh uid `d4ccdc68...` and replacement uid `efb092da...`, verified the prior ready session became `abandoned`, re-rendered `/vibe-studio` in the ready state after both uploads, and finally deleted the replacement cleanly (`bunnyRemoteDeleteOk = true`, profile back to `bunny_video_uid = null`, session `deleted`). |
| EAS preview build | Partial | Operator confirmed a preview iOS build succeeded and was installable. Remaining blocker: **KB** for Android preview evidence and recording the build id / URL here. |
| EAS production build | Blocked by KB | No operator evidence yet for production-profile builds. |
| iOS device validation checklist | Blocked by KV | A preview iOS build exists, but no full iOS runtime proof is recorded yet for premium, push, Daily, and shell flows. |
| Android device validation checklist | Blocked by KB | No Android build/install evidence is recorded yet, so Android runtime validation has not started. |
| Rebuild rehearsal (post–Phase 7) | Pass | Logged in `docs/rebuild-rehearsal-log.md`; `npm ci`, `npm run build`, and `./scripts/run_golden_path_smoke.sh` passed. Remaining gap is local `SUPABASE_DB_URL` for parity-helper replay, not rebuild failure. |

Execution order (single page): `docs/kaan-launch-closure-execution-sheet.md`. Narrative: `docs/native-launch-closure-master-runbook.md` + `docs/native-sprint6-launch-closure-runbook.md`. Go/no-go matrix: `docs/phase7-stage5-release-readiness-and-go-nogo.md`.

---

## Summary

- **Blocker (must resolve for native launch):** **KD** RevenueCat + webhook + store products + OneSignal mobile; **KD/KB** EAS secrets; **KB** installable builds; **KV** device proof. Checklist depth: `docs/native-external-setup-checklist.md`. Compressed order: `docs/kaan-launch-closure-execution-sheet.md`.
- **Non-blocking:** RevenueCat warnings until configured, reset-password minimal, Bunny 404 until pull zone.
- **In v1 (done):** Profile photo, vibe video, premium, public profile, match celebration, credits, delete account.
- **Accepted web handoff:** Schedule, account, notifications, Daily Drop, reset password, legal/marketing.
- **Deferred:** Bunny photo loading, polish.
- **Dev-only:** Dev client UI, RevenueCat warnings, trace logs.
