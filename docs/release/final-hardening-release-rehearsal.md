# Final Hardening Release Rehearsal

Date: 2026-05-01
Branch: `docs/final-hardening-release-rehearsal`
Base: `main` at `ae179d9dfc8171e63919cea37a7cf5831a04d6e0`

## 1. Purpose And Scope

This is the final logged rebuild/release rehearsal for the Streams 1-19 hardening session. It proves what can be reproduced from the repo plus read-only cloud checks:

- git baseline and merged stream ledger
- Supabase project linkage
- migration parity posture
- Edge Function inventory and gateway config posture
- provider operational documents and remaining dashboard/manual gates
- validation commands and results
- release go/no-go recommendation
- rollback and next operator steps

This rehearsal is docs/audit proof only. It does not mutate production data, does not run real provider smoke tests, and does not deploy cloud artifacts.

## 2. Operating Model

Confirmed for this rehearsal:

- No Docker command was run.
- No local Supabase command was run.
- No `supabase db push` was run.
- No production data was mutated.
- No real paid checkout, push, SMS, email, Daily room, or media upload/delete smoke was run.
- No Edge Function deploy was required or performed by Stream 20.
- No env vars changed.
- No native modules changed.
- No `expo-av` import or package was added.

## 3. Git Baseline

Read-only git checks:

- `git checkout main`
- `git pull --ff-only origin main`
- `git log --oneline -25`
- `git status --short --branch`

Baseline evidence:

- `main` and `origin/main` were in sync before creating this branch.
- Latest merged commit before this branch: `ae179d9df fix: close Supabase function config gaps (#647)`.
- Working tree was clean before Stream 20 edits.
- No intentionally untracked files were present during baseline audit.

Recent hardening tail on `main`:

```text
ae179d9df fix: close Supabase function config gaps (#647)
a9c20bb77 fix: run screenshot-led native visual parity pass (#646)
846c021db chore: record post-stream readiness audit (#645)
f6bac6921 fix: verify RevenueCat native entitlement readiness (#644)
cdef0a284 qa: add native physical-device validation plan (#643)
3610041c0 fix: verify Twilio phone verification readiness (#642)
d96bf4ec9 fix: verify Resend email provider readiness
2e58bf50e fix: verify Daily provider readiness
1c787c95e fix: verify Bunny media provider readiness
60b2997c5 fix: verify onesignal provider readiness (#624)
```

## 4. Merged Stream Ledger

All Streams 1-19 are merged or represented by equivalent branch-delta/test artifacts on `main`.

| Stream | Scope | Primary Evidence |
| --- | --- | --- |
| Stream 1 | Event Lobby active-event backend contract | `docs/branch-deltas/fix-event-lobby-active-event-contract.md`, `shared/matching/eventLobbyActiveEventContract.test.ts`, `20260501180000_event_lobby_active_event_contract.sql` |
| Stream 2 | Ready Gate transition expiry rowcount | `docs/branch-deltas/fix-ready-gate-transition-expiry-rowcount.md`, `shared/matching/readyGateTransitionExpiryRowcount.test.ts`, `20260501190000_ready_gate_transition_expiry_rowcount.sql` |
| Stream 3 | Ready Gate event-ended terminalization | `docs/branch-deltas/fix-ready-gate-event-ended-terminalization.md`, `shared/matching/readyGateEventEndedTerminalization.test.ts`, `20260501200000_ready_gate_event_ended_terminalization.sql` |
| Stream 4 | Ready Gate contract consumer compliance | `docs/branch-deltas/fix-ready-gate-contract-consumer-compliance.md`, `shared/matching/readyGateContractConsumerCompliance.test.ts`, `docs/ready-gate-backend-contract.md` |
| Stream 5 | Ready Gate terminal UX and observability | `docs/branch-deltas/fix-ready-gate-terminal-ux-observability.md`, `shared/matching/readyGateTerminalUxObservability.test.ts` |
| Stream 6 | Native Ready Gate parity contract | `docs/branch-deltas/fix-native-ready-gate-parity-contract.md`, `shared/matching/nativeReadyGateParityContract.test.ts` |
| Stream 7 | Realtime subscription tightening | `docs/branch-deltas/fix-realtime-subscription-tightening.md`, `shared/matching/realtimeSubscriptionTightening.test.ts` |
| Stream 8 | Swipe retry idempotency and notification dedupe | `docs/branch-deltas/fix-swipe-retry-idempotency-notification-dedupe.md`, `shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts`, `20260501210000_swipe_retry_idempotency_notification_dedupe.sql` |
| Stream 9 | Premium credits observability | `docs/branch-deltas/fix-premium-credits-observability.md`, `shared/matching/premiumCreditsObservability.test.ts`, `20260501220000_premium_credits_observability.sql` |
| Stream 10 | Native video-date contract recovery | `docs/branch-deltas/fix-native-video-date-contract-recovery.md`, `shared/matching/nativeVideoDateContractRecovery.test.ts` |
| Stream 11 | OneSignal provider operational QA | `docs/branch-deltas/fix-onesignal-provider-operational-qa.md`, `shared/matching/onesignalProviderOperationalQa.test.ts` |
| Stream 12 | Bunny media provider operational QA | `docs/branch-deltas/fix-bunny-provider-operational-qa.md`, `shared/matching/bunnyProviderOperationalQa.test.ts` |
| Stream 13 | Daily provider operational QA | `docs/branch-deltas/fix-daily-provider-operational-qa.md`, `shared/matching/dailyProviderOperationalQa.test.ts` |
| Stream 14 | Resend email provider operational QA | `docs/branch-deltas/fix-resend-email-provider-operational-qa.md`, `shared/matching/resendEmailProviderOperationalQa.test.ts` |
| Stream 15 | Twilio phone verification QA | `docs/branch-deltas/fix-twilio-phone-verification-qa.md`, `shared/matching/twilioPhoneVerificationQa.test.ts` |
| Stream 16 | Native physical-device QA plan | `docs/branch-deltas/qa-native-physical-device-flow.md`, `docs/qa/native-physical-device-qa-runbook.md`, `shared/matching/nativePhysicalDeviceQaReadiness.test.ts` |
| Stream 17 | RevenueCat native entitlement readiness | `docs/branch-deltas/fix-revenuecat-native-entitlement-readiness.md`, `shared/matching/revenueCatNativeEntitlementReadiness.test.ts` |
| Stream 18 | Screenshot-led native visual parity pass | `docs/branch-deltas/fix-screenshot-led-native-visual-parity.md`, `docs/qa/screenshot-led-native-visual-parity-capture-plan.md`, `shared/matching/screenshotLedNativeVisualParity.test.ts` |
| Stream 19 | Supabase function config gaps | `docs/branch-deltas/fix-supabase-function-config-gaps.md`, `shared/matching/supabaseFunctionConfigGaps.test.ts`, `supabase/config.toml` |

## 5. Migration Posture

Repo audit:

- `supabase/migrations`: 347 local migration files.
- Stream 20 adds no migration.
- No migration was deployed in Stream 20.

Read-only cloud audit:

- Command: `supabase migration list --linked`
- Result: local and remote migration columns matched in the CLI output, including the latest rows through `20260501230000`.
- No local-only or remote-only migration gap was visible in the command output.
- No `supabase db push` was run.

## 6. Edge Function Deploy Posture

Repo audit:

- `supabase/functions`: 53 deployable function directories, excluding `_shared`.
- `supabase/config.toml`: 53 `[functions.<slug>]` entries.
- No config gaps were found.
- Stream 20 changes no Edge Function source.
- Stream 20 requires no Edge Function deploy.

Read-only cloud audit:

- Command: `supabase functions list --project-ref schdyxcunwcvddlcshwd`
- Result: all listed functions were `ACTIVE`.
- `forward-geocode` and `push-webhook` were active after Stream 19's post-merge posture deploy.
- The function list showed current cloud versions and timestamps only; it does not expose `verify_jwt`.

Gateway posture source of truth:

- `supabase/config.toml`
- `_cursor_context/vibely_edge_function_manifest.md`
- `_cursor_context/vibely_supabase_provider_sheet.md`

## 7. Supabase Linked Project Proof

Read-only command:

```bash
supabase projects list
```

Result:

- Linked project: `schdyxcunwcvddlcshwd / MVP_Vibe`
- Region: `West EU (Ireland)`
- Project ref in `supabase/config.toml`: `schdyxcunwcvddlcshwd`

Read-only secrets posture:

- Command: `supabase secrets list --project-ref schdyxcunwcvddlcshwd`
- Result: expected provider secret names were visible by name/digest.
- No secret values were printed.

Visible secret names included the expected families for Supabase self-reference, Stripe, Bunny, Daily, OneSignal, Resend, Twilio, RevenueCat, cron/outbox, and push webhook posture.

## 8. Provider Posture

### Supabase

- Project linkage is known: `schdyxcunwcvddlcshwd / MVP_Vibe`.
- 49 Edge Functions are represented in config and active in read-only cloud listing.
- Migration list showed local/remote parity in CLI output.
- Storage and RLS details remain governed by the migration history and provider sheets.
- Manual gates: do not run DB push without a separate migration review; verify dashboard-only settings before any rebuild cutover.

### Stripe

- Web Stripe semantics remain the active checkout/subscription/credits path.
- Relevant docs/tests: `shared/matching/premiumCreditsObservability.test.ts`, `docs/branch-deltas/fix-premium-credits-observability.md`, `_cursor_context/vibely_external_dependency_ledger.md`.
- Manual gates: controlled internal checkout QA only with approved test fixtures; confirm products/prices, webhook endpoint, subscribed events, and customer portal settings.

### Bunny

- Bunny Stream/Storage/CDN path conventions are documented and tested.
- Relevant docs/tests: `docs/branch-deltas/fix-bunny-provider-operational-qa.md`, `shared/matching/bunnyProviderOperationalQa.test.ts`.
- Manual gates: controlled internal Vibe Video, profile image, event cover, voice upload, HLS playback, webhook readiness, and delete QA with test users only.

### Daily

- Daily room/token/delete-room posture is documented and tested.
- Relevant docs/tests: `docs/branch-deltas/fix-daily-provider-operational-qa.md`, `shared/matching/dailyProviderOperationalQa.test.ts`, `shared/matching/videoDateEndToEndHardening.test.ts`.
- Manual gates: controlled internal room creation, retry/reuse, reconnect, partner disconnect, cleanup worker, and match-call QA.

### OneSignal

- Web/native identity binding, service worker assets, backend send suppression, and deep-link posture are documented and tested.
- Relevant docs/tests: `docs/branch-deltas/fix-onesignal-provider-operational-qa.md`, `shared/matching/onesignalProviderOperationalQa.test.ts`, `docs/notification-delivery-observability-audit.md`.
- `push-webhook` remains generic receipt telemetry unless provider dashboard wiring is verified.
- Manual gates: controlled internal push receipt/deep-link QA, web worker check, native push identity, and dashboard app/REST key alignment.

### Resend

- Email verification and active email send paths are documented and tested.
- Relevant docs/tests: `docs/branch-deltas/fix-resend-email-provider-operational-qa.md`, `shared/matching/resendEmailProviderOperationalQa.test.ts`.
- Manual gates: controlled internal email QA only; confirm sender/domain verification, suppression/bounce behavior, and active sender aliases.

### Twilio

- Phone verification, JWT posture, Verify, Lookup, rate limiting, WebOTP, and one-user-one-phone safety are documented and tested.
- Relevant docs/tests: `docs/branch-deltas/fix-twilio-phone-verification-qa.md`, `shared/matching/twilioPhoneVerificationQa.test.ts`.
- Manual gates: controlled internal SMS QA with owned numbers; confirm Verify service, Lookup access, geo/fraud settings, sender/copy, and WebOTP format.

### RevenueCat

- Native RevenueCat dependency and entitlement posture are documented and tested while preserving web Stripe semantics.
- Relevant docs/tests: `docs/branch-deltas/fix-revenuecat-native-entitlement-readiness.md`, `shared/matching/revenueCatNativeEntitlementReadiness.test.ts`.
- Manual gates: confirm RevenueCat dashboard offerings, app-store products, entitlement names, sandbox purchases, webhook authorization, and native identity reconciliation.

### PostHog

- Product analytics posture is documented in `_cursor_context/vibely_external_dependency_ledger.md` and observability docs.
- Manual gates: confirm project/host identity, production capture health, and release dashboards after a controlled internal release.

### Sentry

- Error tracking posture is documented in `_cursor_context/vibely_external_dependency_ledger.md` and native/video-date observability docs.
- Manual gates: confirm web/native projects, DSNs, release tagging, source maps, breadcrumbs, and controlled error capture in non-user-impacting environments.

### DNS/CDN

- Production domain/CDN assumptions are documented in `_cursor_context/vibely_external_dependency_ledger.md`, OneSignal/Bunny branch deltas, and provider launch notes.
- Manual gates: confirm `vibelymeet.com`, `www.vibelymeet.com`, service worker paths, `cdn.vibelymeet.com`, Bunny CDN/Stream hostnames, and Vercel production deployment alignment.

## 9. Validations Run

Stream 20 validation set:

```bash
npx tsx shared/matching/finalHardeningReleaseRehearsal.test.ts
for f in shared/matching/*.test.ts; do ...; done
npx tsx supabase/functions/_shared/matching/videoSessionFlow.test.ts
npx tsx --test shared/matching/videoDateEndToEndHardening.test.ts
npm run typecheck
npm run build
cd apps/mobile && npm run typecheck
npm run lint
git diff --check
git diff --cached --check
```

Recorded Stream 20 results:

- `npx tsx shared/matching/finalHardeningReleaseRehearsal.test.ts`: passed, 8/8 tests.
- `shared/matching/*.test.ts` sweep: passed for every stream/static contract test in `shared/matching/`.
- `npx tsx supabase/functions/_shared/matching/videoSessionFlow.test.ts`: passed, 5/5 tests.
- `npx tsx --test shared/matching/videoDateEndToEndHardening.test.ts`: passed, 99/99 tests.
- `npm run typecheck`: passed, including the mobile typecheck substep and expo-crypto regression guard.
- `npm run build`: passed with the existing Vite dynamic-import/chunk-size warning baseline.
- `cd apps/mobile && npm run typecheck`: passed, including the expo-crypto regression guard.
- `npm run lint`: passed with 0 errors and 208 existing warnings.
- `git diff --check`: passed.
- `git diff --cached --check`: passed before commit.

## 10. Cloud Deploys

Stream 20 deploy requirement: none.

- No migration was added.
- No Edge Function source changed.
- No `supabase/config.toml` change was made by Stream 20.
- No Supabase deploy was required or performed by Stream 20.

Recent context:

- Stream 19 post-merge deployed only `forward-geocode` and `push-webhook` to lock config posture.
- Stream 20 only re-verified cloud state read-only.

## 11. Provider Manual Checklist

Before broad public release, complete these controlled manual gates with internal/test accounts only:

1. Controlled OneSignal push QA:
   - Web permission prompt and worker registration.
   - Native permission prompt and player ID sync.
   - Backend `send-notification` to a controlled internal user.
   - Push deep links to ready/date/chat.
   - Confirm whether `push-webhook` is wired to receipts or intentionally unused.
2. Controlled Bunny media QA:
   - Vibe Video upload.
   - Bunny processing webhook readiness.
   - HLS playback.
   - Delete video.
   - Profile image upload.
   - Event cover upload.
   - Voice upload.
3. Controlled Daily room QA:
   - Video-date room creation and token issuance.
   - Retry/reuse.
   - Reconnect and partner disconnect.
   - Match call create/answer.
   - Terminal cleanup worker behavior.
4. Resend controlled email QA:
   - Email verification send/verify.
   - Event notification send.
   - Support/send-email path if in release scope.
   - Domain/sender/bounce/suppression dashboard checks.
5. Twilio controlled phone QA:
   - Send/check OTP with owned test numbers.
   - Lookup/VoIP blocking expectations.
   - Verify service dashboard settings and WebOTP-friendly copy.
6. RevenueCat/App Store entitlement setup:
   - Confirm offerings/products/entitlements.
   - Sandbox purchase/restore.
   - Webhook reconciliation to backend entitlements.
   - Confirm web Stripe remains separate and unchanged.
7. Physical-device native QA:
   - Execute `docs/qa/native-physical-device-qa-runbook.md`.
   - Cover Ready Gate, video-date, media, push, reconnect, stale links, post-date recovery, and duplicate side-effect suppression.
8. Screenshot-led native visual parity:
   - Execute `docs/qa/screenshot-led-native-visual-parity-capture-plan.md`.
   - Fix only concrete screenshot-backed mismatches.

## 12. Release Go/No-Go Recommendation

Recommendation: go for merging the hardening/rehearsal documentation and using this repo state as the current code baseline for controlled internal release rehearsal.

Recommendation: no-go for broad public release until the manual provider/device gates in section 11 are completed and logged.

Rationale:

- Repo, static contracts, and cloud linkage are reproducible.
- Migration and Edge Function inventories are understood.
- Provider semantics are documented and contract-tested.
- Remaining risk is runtime/provider/dashboard/device verification, not hidden repo uncertainty.

## 13. Rollback Notes

For Stream 20 itself:

- Rollback is a documentation/test revert only.
- Revert the Stream 20 merge commit if the rehearsal document or test needs removal.
- No Supabase rollback is required because Stream 20 performs no deploy and adds no migration.

For release rollback generally:

- Web: roll back the hosting deployment to the prior known-good Vercel deployment.
- Edge Functions: deploy the prior known-good function source for the specific affected function only.
- Database: do not attempt blind down migrations; use a forward repair migration after incident review.
- Providers: disable or rotate the specific provider/dashboard integration if a controlled smoke exposes a dashboard-side issue.
- Native: roll back TestFlight/internal build distribution or submit a hotfix build depending on release channel.

## 14. Exact Next Operator Steps

1. Merge this Stream 20 rehearsal PR after checks pass.
2. Pull latest `main` locally and confirm clean status.
3. Do not deploy Supabase for Stream 20.
4. Complete manual provider gates in section 11 with internal/test users only.
5. Record results in the relevant provider branch delta or a new release-gate log.
6. If a manual gate fails, open a focused fix branch for that provider/surface only.
7. After manual gates pass, promote the web deployment and native release candidate according to the existing release runbooks.
8. Continue monitoring Sentry/PostHog/Supabase logs during the controlled rollout window.
