# Final Release Ops Readiness Investigation

Date: 2026-05-01
Branch: `docs/investigate-final-release-ops-readiness`
Base: `main` at `6296cf965`

## Executive Verdict

WARN.

Streams 17, 19, and 20 are closed in the repo and their primary artifacts/tests are present. The RevenueCat/native entitlement posture is correctly represented as code-ready but still provider/dashboard/device-proof dependent. `forward-geocode` and `push-webhook` are explicitly represented in `supabase/config.toml` with the intended auth posture, and the final rehearsal records the no-Docker/no-local-Supabase operating model, provider gates, rollback notes, and go/no-go recommendation.

The release posture is not FAIL because no active code/config defect was found and all validations passed. It is WARN because `_cursor_context/vibely_rebuild_runbook.md` still contains an older historical Edge Function deploy section with a 30-function baseline, stale `23`/`7` JWT counts, and obsolete function names. That section does include a caveat telling operators to prefer current repo inventory, but it still contradicts the current config-backed manifest/rehearsal enough to deserve a repair stream before the runbook is used as the primary rebuild checklist.

NOT READY markers: none for Streams 17, 19, or 20.

## Artifacts Inspected

Context Streams 1-16 and 18:

- Branch deltas and tests for Streams 1-16 and Stream 18 were present on `main`.
- Spot checks confirmed Ready Gate, swipe/realtime, payment, provider QA, native physical-device readiness, and screenshot-led visual parity artifacts remain represented.

Stream 17:

- `apps/mobile/package.json`
- `apps/mobile/lib/revenuecat.ts`
- `apps/mobile/app/_layout.tsx`
- `apps/mobile/app/premium.tsx`
- `apps/mobile/app/settings/account.tsx`
- `apps/mobile/app/settings/credits.tsx`
- `apps/mobile/hooks/useEntitlements.ts`
- `apps/mobile/lib/subscriptionApi.ts`
- `apps/mobile/lib/syncRevenueCatSubscriber.ts`
- `apps/mobile/lib/creditsCheckout.ts`
- `supabase/functions/revenuecat-webhook/index.ts`
- `supabase/functions/sync-revenuecat-subscriber/index.ts`
- `supabase/functions/_shared/revenuecatSubscription.ts`
- `docs/branch-deltas/fix-revenuecat-native-entitlement-readiness.md`
- `shared/matching/revenueCatNativeEntitlementReadiness.test.ts`
- Stream 9 Stripe/payment docs/tests

Stream 19:

- `supabase/config.toml`
- `supabase/functions/forward-geocode/index.ts`
- `supabase/functions/push-webhook/index.ts`
- `docs/branch-deltas/fix-supabase-function-config-gaps.md`
- `shared/matching/supabaseFunctionConfigGaps.test.ts`
- `_cursor_context/vibely_edge_function_manifest.md`
- `_cursor_context/vibely_external_dependency_ledger.md`
- `_cursor_context/vibely_rebuild_runbook.md`

Stream 20:

- `docs/release/final-hardening-release-rehearsal.md`
- `docs/branch-deltas/docs-final-hardening-release-rehearsal.md`
- `shared/matching/finalHardeningReleaseRehearsal.test.ts`
- provider docs/ledger/runbook references named by Stream 20

## Stream 17: RevenueCat / Native Entitlement Posture

PASS: RevenueCat dependency posture is documented and installed.

- `apps/mobile/package.json` includes `react-native-purchases`.
- `apps/mobile/lib/revenuecat.ts` wraps configure, login, offerings, purchase, and restore.
- `apps/mobile/app/_layout.tsx` initializes RevenueCat and binds the RevenueCat user id to the Supabase auth user id.

PASS: Native Premium uses RevenueCat, not web Stripe checkout as native IAP.

- `apps/mobile/app/premium.tsx` calls `getOfferings()`, `purchasePackage(pkg)`, and `restorePurchasesWithCustomerInfo()`.
- The native Premium screen does not call `create-checkout-session` or Stripe price-id env vars.

PASS: Native entitlement display remains backend-owned.

- `apps/mobile/lib/subscriptionApi.ts` reads `subscriptions` for active/trialing billable rows and falls back to `profiles.is_premium`.
- `apps/mobile/hooks/useEntitlements.ts` remains the native tier/profile entitlement reader.
- Native credits read `user_credits`.

PASS: Stripe relationship and pricing semantics are preserved.

- Web Premium still uses `create-checkout-session` and Stream 9 Stripe webhook semantics.
- Native credits intentionally open Stripe browser checkout through `create-credits-checkout`.
- Credit pack pricing remains in the shared credit pack contract.
- No pricing, plan, pack, event-ticket, or entitlement semantics change was found in this investigation.

WARN: Provider proof remains manual, and the docs say so correctly.

- Stream 17 records no real RevenueCat purchase/restore smoke.
- Remaining gates include RevenueCat dashboard offerings, store products, entitlement names, sandbox purchases, webhook authorization, and EAS/build env verification.

PASS: No unapproved env/native-module drift was found.

- The RevenueCat env names are documented as existing known names.
- No `expo-av` dependency or import exists.
- No `@stripe/stripe-react-native` dependency exists.

## Stream 19: Function Config Gaps

PASS: Both functions are explicitly represented in config.

- `supabase/config.toml` contains `[functions.forward-geocode]` with `verify_jwt = true`.
- `supabase/config.toml` contains `[functions.push-webhook]` with `verify_jwt = false`.
- Current 2026-05-26 dependency-closure evidence supersedes older function-count snapshots: 71 deployable directories and 71 config entries.

PASS: `forward-geocode` role and auth posture are intentional.

- The function requires an Authorization header, resolves the Supabase user, allows admin/premium/onboarding city search, rate-limits by user, and calls OpenStreetMap Nominatim.
- Stream 19 docs identify it as authenticated admin/premium/onboarding city search.

PASS: `push-webhook` role and auth posture are intentional.

- The function is gateway-public for provider callbacks but fail-closes without `PUSH_WEBHOOK_SECRET`.
- It requires `x-webhook-secret` to match `PUSH_WEBHOOK_SECRET`.
- It is documented as generic FCM/APNs/web receipt telemetry, not guaranteed OneSignal receipt truth without dashboard wiring.

PASS: No DB migration or env var addition was introduced by Stream 19.

- `supabaseFunctionConfigGaps.test.ts` confirms no Stream 19 migration and no env var change.
- The deploy posture says no DB push is required.

WARN: Cloud `verify_jwt` proof remains limited by Supabase tooling.

- Stream 19 and Stream 20 record read-only function-list checks and final deploy posture.
- Supabase function list output does not expose `verify_jwt`, so repo config and deployment logs remain the source of truth for gateway posture.
- This investigation did not deploy or mutate cloud state.

## Stream 20: Final Rebuild / Release Rehearsal

PASS: Stream ledger includes Streams 1-19.

- `docs/release/final-hardening-release-rehearsal.md` lists each stream and primary evidence.
- Stream 20 test confirms branch deltas/tests remain present.

PASS: Canonical Supabase project and operating model are recorded.

- The rehearsal records `schdyxcunwcvddlcshwd / MVP_Vibe`.
- It records no Docker, no local Supabase, no `supabase db push`, no production data mutation, no real provider smoke, and no env var/native module change.

PASS: Provider posture sections exist.

The final rehearsal includes sections for:

- Supabase
- Stripe
- Bunny
- Daily
- OneSignal
- Resend
- Twilio
- RevenueCat
- PostHog
- Sentry
- DNS/CDN

PASS: Manual release gates, rollback notes, and operator steps exist.

- Controlled provider QA gates are listed.
- Physical-device QA and screenshot-led parity remain explicit.
- Go/no-go states repo readiness for controlled internal release rehearsal but no-go for broad public release until manual gates are complete.
- Rollback notes and next operator steps exist.

PASS: Rebuild runbook stale Edge Function inventory text has a current addendum.

- `_cursor_context/vibely_rebuild_runbook.md` Section 13 now records 71 deployable functions, 71 config entries, and points operators to the current manifest/config for slug-level JWT posture.
- Obsolete names such as `account-pause`, `account-resume`, `email-drip`, `unsubscribe`, and `vibe-notification` remain historical only unless deliberately restored.

## Cross-Final Findings

PASS: External dependency ledger is aligned with current final posture.

- `_cursor_context/vibely_external_dependency_ledger.md` records 70 functions, provider secret names by name only, Daily webhook closure evidence, and manual provider gates.

PASS: Rebuild runbook is aligned by current addendum.

- Current authoritative sources say 71 deployable functions and 71 config entries.
- The runbook now points to the config-backed manifest as source of truth.

PASS: Function manifest no longer has unresolved `forward-geocode` / `push-webhook` ambiguity.

- The manifest current-state addendum explicitly states both functions' `verify_jwt` posture and source role.
- Older historical function sections remain present, but the manifest marks older counts as superseded and current repo inventory as authoritative.

PASS: No unchecked migration was found by repo inspection.

- Latest local migration file is `20260501230000_event_lobby_deck_payload_media.sql`.
- Stream 20 records migration parity through `20260501230000`.
- This investigation did not run `supabase migration list --linked` because the prompt forbids cloud mutation and did not request a cloud read-only check for this investigation.

PASS: No native module / `expo-av` drift found.

- `expo-av` is not in root or mobile package manifests.
- Static scans found no `expo-av` import/require in native code.
- `react-native-purchases` is present as the documented Stream 17 RevenueCat dependency.

PASS: No provider secret values were found in source.

- Static secret-pattern scan found placeholder secret names/examples such as `STRIPE_SECRET_KEY=...` and `SUPABASE_SERVICE_ROLE_KEY=...`, plus normal `service_role` role references in SQL/docs.
- No concrete Stripe/Twilio/Resend/OneSignal/Daily/RevenueCat secret value was identified.

PASS: Manual release gates are explicit, not hidden.

- Provider, physical-device, screenshot, and broad-public-release gates are documented as manual proof.
- The repo is not represented as fully provider/runtime proven without those gates.

## Go / No-Go Recommendation

Go for controlled internal release rehearsal from the current repo baseline after this investigation PR lands.

No-go for broad public release until the manual gates are executed and logged:

- controlled OneSignal push QA
- controlled Bunny media QA
- controlled Daily room QA
- Resend controlled email QA
- Twilio controlled phone QA
- RevenueCat/App Store entitlement setup and sandbox purchase/restore
- physical-device native QA
- screenshot-led native visual parity capture and repair
- final provider dashboard checks for Stripe, DNS/CDN, Sentry, and PostHog

## Validation Results

Passed:

- `npx tsx shared/matching/revenueCatNativeEntitlementReadiness.test.ts`
- `npx tsx shared/matching/supabaseFunctionConfigGaps.test.ts`
- `npx tsx shared/matching/finalHardeningReleaseRehearsal.test.ts`
- all `shared/matching/*.test.ts` via sweep
- `npx tsx supabase/functions/_shared/matching/videoSessionFlow.test.ts`
- `npx tsx --test shared/matching/videoDateEndToEndHardening.test.ts`
- `npm run typecheck`
- `npm run build`
- `cd apps/mobile && npm run typecheck`
- `npm run lint` (0 errors, existing 208-warning backlog)
- `git diff --check`

Build note:

- Vite build completed with the existing dynamic-import/chunk-size warning baseline.

## Missing Proof

- No live provider smoke was run.
- No real RevenueCat sandbox purchase/restore was run.
- No real payment, push, SMS, email, media upload/delete, or Daily room smoke was run.
- No physical-device QA was run in this investigation.
- No screenshot capture was run in this investigation.
- No cloud deploy or cloud mutation was performed.
- Cloud `verify_jwt` cannot be proven from `supabase functions list`; repo config and recorded deploy posture remain the evidence.

## Repair Recommendations

1. Keep `_cursor_context/vibely_rebuild_runbook.md` Section 13 aligned with the current config-backed function inventory, current JWT counts, and no obsolete function names.
2. Keep the machine-readable inventory and Edge Function manifest as the canonical source for future rebuild function deploy lists.
3. Add a small static test for the rebuild runbook's function count/JWT count if the runbook remains an operator-facing source of truth.
4. Execute and log the manual provider/device/screenshot release gates before broad public release.

## Safety Confirmation

- Investigation only.
- No Docker used.
- No local Supabase used.
- No cloud mutation.
- No DB push.
- No function deploy.
- No provider mutation.
- No real provider smoke.
- No env vars changed.
- No native modules added.
- No `expo-av` import or package added.
