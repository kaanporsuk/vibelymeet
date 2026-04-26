# Native Final Blocker Matrix

Last refreshed: 2026-04-27

Use this as the active native launch evidence log. It separates closed repo/runtime work from the remaining provider-dashboard, build, and real-device proof that must be completed before TestFlight / Play internal distribution.

Active doc map: `docs/active-doc-map.md`

## Current Go/No-Go

**No-Go for native distribution until the remaining provider, build, and device proof rows below are closed.**

This is not a code-hardening no-go. The video-date loop, regression harness, seeded QA pack, native RC smoke pack, and native external setup checklist are now documented and closed from the repo side. The remaining blockers are operator-owned proof in provider dashboards, EAS builds, and real devices.

## Status Labels

| Label | Meaning |
| --- | --- |
| Closed with PR/doc evidence | Work is merged or documented and has a canonical evidence doc. |
| Manual proof pending | Requires a human-run browser/device/provider check. |
| Provider-dashboard pending | Requires Apple, Google, OneSignal, RevenueCat, EAS, Supabase, Daily, Bunny, Sentry, or PostHog dashboard verification. |
| Build/device proof pending | Requires installable native artifacts and real device or simulator validation. |
| Blocked | Cannot proceed until an earlier dependency is closed. |

## Closed With Evidence

| Area | Status | Evidence |
| --- | --- | --- |
| Video-date hardening chain | Closed with PR/doc evidence | `docs/video-date-hardening-closure-handoff.md` covers PRs #519, #521, #522, #523, #524, #525, #526, #527, #528, and #529. |
| Video-date Supabase migration | Closed with PR/doc evidence | #522 migration is documented as deployed in `docs/video-date-hardening-closure-handoff.md`; final dry-run was clean. |
| Admin Video Date Ops function | Closed with PR/doc evidence | #523 function deploy is documented in `docs/video-date-hardening-closure-handoff.md`. |
| Golden-path regression runbook | Closed with PR/doc evidence | `docs/golden-path-regression-runbook.md` defines quick, video-date, full, and DB-dry-run modes. |
| CI golden-path smoke gate | Closed with PR/doc evidence | Golden-path quick smoke and video-date path gate are live; see `docs/golden-path-regression-runbook.md`. |
| Seeded video-date runtime QA pack | Closed with PR/doc evidence | `docs/qa/video-date-seeded-runtime-qa-pack.md` defines the two-user/admin/runtime proof pack. |
| Native RC smoke pack | Closed with PR/doc evidence | `docs/qa/native-rc-smoke-pack.md` defines iOS/Android release-candidate operator checks. |
| Native external setup closure checklist | Closed with PR/doc evidence | `docs/native-external-setup-closure.md` records repo-verified native IDs, EAS profiles, providers, secrets, and go/no-go gates. |
| Authenticated browser proof | Closed with existing evidence | `docs/browser-auth-runtime-proof-results.md` records authenticated Schedule, Referrals, OneSignal worker/subscribed session/DB sync, Vibe Studio, invite, and public-profile proof. |
| Rebuild rehearsal | Closed with existing evidence | `docs/rebuild-rehearsal-log.md` records `npm ci`, `npm run build`, and `./scripts/run_golden_path_smoke.sh` passing. |

## Remaining True Launch Blockers

| Blocker | Status | Owner | What closes it | Canonical checklist |
| --- | --- | --- | --- | --- |
| Apple bundle/app-store records and credentials | Provider-dashboard pending | Operator | Apple Developer bundle ID, capabilities, App Store Connect app, subscription products, signing, main app profile, and OneSignal extension profile are verified for `com.vibelymeet.vibely`. | `docs/native-external-setup-closure.md` |
| Google Play app records and credentials | Provider-dashboard pending | Operator | Play Console app, Play App Signing/upload key path, internal testing track, subscription products, and FCM setup are verified for `com.vibelymeet.vibely`. | `docs/native-external-setup-closure.md` |
| EAS preview iOS build proof | Build/device proof pending | Operator | Preview build ID/link is recorded, installed, opened, and tied to the intended Supabase/project secrets. Older notes mention an iOS preview build, but final launch evidence still needs the build ID and smoke result recorded here. | `docs/qa/native-rc-smoke-pack.md` |
| EAS preview Android build proof | Build/device proof pending | Operator | Preview build ID/link is recorded, installed, opened, and tied to the intended Supabase/project secrets. | `docs/qa/native-rc-smoke-pack.md` |
| EAS secrets for preview/production | Provider-dashboard pending | Operator | Supabase, OneSignal, RevenueCat, and optional Bunny/Sentry/PostHog envs are confirmed in EAS without exposing secret values. | `docs/native-external-setup-closure.md` |
| RevenueCat offerings, products, entitlement, webhook, and sandbox purchase proof | Provider-dashboard pending, then Manual proof pending | Operator | RevenueCat iOS/Android apps, store products, entitlement, default offering, webhook URL/auth header, sandbox purchase, restore, webhook delivery, and Supabase DB sync are proven. | `docs/native-external-setup-closure.md`, `docs/qa/native-rc-smoke-pack.md` |
| OneSignal native push receive/tap proof | Provider-dashboard pending, then Manual proof pending | Operator | OneSignal iOS APNs and Android FCM are configured, `EXPO_PUBLIC_ONESIGNAL_APP_ID` is in EAS, real devices register player IDs, test pushes arrive, and at least one notification tap routes correctly. | `docs/native-external-setup-closure.md`, `docs/qa/native-rc-smoke-pack.md` |
| Daily native video join proof | Manual proof pending | Operator | iOS and Android preview builds join a Daily room from the Ready Gate/date path, camera/mic work, leave/end works, and backend session state is sane afterward. | `docs/qa/video-date-seeded-runtime-qa-pack.md`, `docs/qa/native-rc-smoke-pack.md` |
| Native RC smoke execution on devices | Build/device proof pending | Operator | `docs/qa/native-rc-smoke-pack.md` is executed on iOS and Android, including auth/session, event lobby, Ready Gate/date/survey, chat send-message, push identity, media/Vibe Video, and sign-off template. | `docs/qa/native-rc-smoke-pack.md` |
| Admin Video Date Ops runtime cross-check during native QA | Manual proof pending | Operator | Admin selects the test event in `/kaan/dashboard`, confirms 24h/7d Video Date Ops metrics, verifies aggregate-only output, confirms non-admin 403, and cross-checks one metric against SQL/PostHog. | `docs/qa/video-date-seeded-runtime-qa-pack.md` |
| OneSignal web final interactive proof | Manual proof pending | Operator | Human grants web push permission and taps a delivered notification on production. Worker, subscribed session, and DB sync are already proven. | `docs/web-push-production-checklist.md`, `docs/browser-auth-runtime-proof-results.md` |

## Non-Blocking / Accepted Limitations

| Item | Status | Notes |
| --- | --- | --- |
| Admin Video Date Ops aggregate-only design | Accepted | Intentional privacy boundary; deeper incident investigation uses SQL/PostHog/Sentry. |
| PostHog timer drift trends | Accepted | Trends only reflect deployed clients after the observability/timer reconciliation changes. |
| Existing Vite chunk/import warnings | Accepted | Documented as unrelated to the video-date hardening chain. |
| Bunny photo/CDN 404s | Provider-dashboard pending, non-blocking if accepted | If still present, verify Bunny pull-zone origin/path prefix. App-side URL logic has been documented as correct. |
| Reset-password native depth | Non-blocking | Minimal native flow is accepted unless product chooses to raise it. |

## Native Launch Evidence Log

Fill these rows as operator proof is completed. Do not invent proof; link build IDs, dashboard notes, private screenshots, or private run notes outside Git when they contain secrets or account details.

| Phase | Status | Evidence / next note |
| --- | --- | --- |
| RevenueCat dashboard setup | Provider-dashboard pending | Verify apps/products/entitlement/offering/webhook and record non-secret confirmation. |
| RevenueCat sandbox purchase + restore | Blocked | Blocked until RevenueCat dashboard/store products and EAS preview build are ready. |
| RevenueCat webhook delivery + DB sync | Provider-dashboard pending | Verify webhook delivery and Supabase subscription/profile update after sandbox purchase. |
| OneSignal dashboard setup | Provider-dashboard pending | Verify iOS APNs, Android FCM, and native App ID. |
| OneSignal real-device push receive/tap | Blocked | Blocked until OneSignal dashboard setup, EAS secrets, and preview builds are ready. |
| EAS preview iOS build | Build/device proof pending | Record build ID/link, install result, and smoke result. |
| EAS preview Android build | Build/device proof pending | Record build ID/link, install result, and smoke result. |
| EAS production build | Blocked | Start after preview builds and RC smoke are clean. |
| iOS native RC smoke | Build/device proof pending | Run `docs/qa/native-rc-smoke-pack.md` on installed iOS build. |
| Android native RC smoke | Build/device proof pending | Run `docs/qa/native-rc-smoke-pack.md` on installed Android build. |
| Two-user video-date seeded runtime QA | Manual proof pending | Run `docs/qa/video-date-seeded-runtime-qa-pack.md` with admin, User A, User B, and a live/recent event. |
| Daily real-device join/leave | Manual proof pending | Verify room join, media, refresh/rejoin, end/leave, and backend state. |
| Admin Video Date Ops cross-check | Manual proof pending | Confirm admin panel metrics, non-admin 403, aggregate-only output, and one SQL/PostHog cross-check. |
| OneSignal web prompt/tap | Manual proof pending | Worker and subscribed state are proven; prompt grant and delivered-notification tap remain manual. |

## Next Operator Action Sequence

1. Complete provider dashboards and credentials:
   - Apple Developer / App Store Connect for `com.vibelymeet.vibely`.
   - Google Play Console / FCM for `com.vibelymeet.vibely`.
   - RevenueCat apps, products, entitlement, offering, webhook, and auth header.
   - OneSignal iOS + Android apps with APNs/FCM.
   - EAS preview/production secrets.
2. Run EAS preview builds:
   - `cd apps/mobile`
   - `eas build --profile preview --platform ios`
   - `eas build --profile preview --platform android`
3. Install preview builds and run `docs/qa/native-rc-smoke-pack.md` on real devices.
4. Run `docs/qa/video-date-seeded-runtime-qa-pack.md` for the two-user Ready Gate/date/survey/admin path.
5. Prove RevenueCat sandbox purchase/restore and webhook/DB sync.
6. Prove OneSignal native push receive/tap on iOS and Android.
7. Prove Daily native join/leave and backend cleanup.
8. Update this evidence log with non-secret pass/fail notes and links to private evidence.
9. Move to production-profile builds and store submission only after preview proof is clean.

## Regression Commands Before Launch-Related Changes

```bash
npm run launch:preflight
npm run typecheck
./scripts/run_golden_path_smoke.sh
```

For video-date or admin ops changes:

```bash
./scripts/run_golden_path_smoke.sh --video-date
```

For DB work:

```bash
supabase db push --linked --dry-run
```

For native RC prep:

```bash
cd apps/mobile
npm run rc-smoke
```

## Reference Docs

- Active doc map: `docs/active-doc-map.md`
- Native external setup closure gate: `docs/native-external-setup-closure.md`
- Native external setup depth: `docs/native-external-setup-checklist.md`
- Native RC smoke pack: `docs/qa/native-rc-smoke-pack.md`
- Seeded video-date runtime QA pack: `docs/qa/video-date-seeded-runtime-qa-pack.md`
- Golden-path regression runbook: `docs/golden-path-regression-runbook.md`
- Video-date hardening closure handoff: `docs/video-date-hardening-closure-handoff.md`
- Operator execution sheet: `docs/kaan-launch-closure-execution-sheet.md`
- Canonical launch runbook: `docs/native-launch-closure-master-runbook.md`
- Strict go/no-go background: `docs/phase7-stage5-release-readiness-and-go-nogo.md`
