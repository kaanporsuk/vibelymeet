# Post-Stream Provider and Native Readiness Audit

Date: 2026-05-01
Branch: `chore/post-stream-deep-audit-tidy`
Base: `main` at `f6bac6921 fix: verify RevenueCat native entitlement readiness (#644)`

## Scope

This pass reviewed the work that landed after the recent Event Lobby cleanup, with emphasis on Streams 11-17:

- OneSignal provider operational QA
- Bunny media provider operational QA
- Daily provider operational QA
- Resend email provider operational QA
- Twilio phone verification QA
- Native physical-device QA readiness
- RevenueCat native entitlement readiness

The goal was repository hygiene and confidence, not product behavior changes.

## Baseline Findings

- `main`, `origin/main`, and the audit branch started at the same commit.
- The working tree was clean before tracked edits.
- `git stash list` was empty.
- Only one worktree was present.
- No tracked `.DS_Store`, `.orig`, `.rej`, backup, or duplicate-path junk was found.
- The only local junk artifact found was ignored `docs/.DS_Store`; it was removed locally.
- Large local directories such as `node_modules`, `apps/mobile/node_modules`, `apps/mobile/ios/Pods`, `.vercel`, and `dist` are ignored/generated artifacts. They were not treated as source files and were not deleted as part of this tracked audit.

## What Landed Correctly

- Provider branch deltas for OneSignal, Bunny, Daily, Resend, Twilio, and RevenueCat are present under `docs/branch-deltas/`.
- The native physical-device QA runbook is present at `docs/qa/native-physical-device-qa-runbook.md`.
- Provider/static contract tests are present under `shared/matching/`:
  - `onesignalProviderOperationalQa.test.ts`
  - `bunnyProviderOperationalQa.test.ts`
  - `dailyProviderOperationalQa.test.ts`
  - `resendEmailProviderOperationalQa.test.ts`
  - `twilioPhoneVerificationQa.test.ts`
  - `nativePhysicalDeviceQaReadiness.test.ts`
  - `revenueCatNativeEntitlementReadiness.test.ts`
- The focused TODO/FIXME/HACK/XXX source scan did not find actionable code markers. The only `XXX` hit is phone placeholder UI copy.
- No tracked redundant obsolete file was found that was safe to remove without destroying audit provenance.

## Tidy Changes Made

- Updated `docs/active-doc-map.md` so Streams 11-17 are visible from the current evidence map instead of only from git history.
- Extended `apps/mobile/scripts/rc-smoke-check.sh` to lint native Premium and account settings surfaces:
  - `apps/mobile/app/premium.tsx`
  - `apps/mobile/app/settings/account.tsx`

Those screens now contain the RevenueCat purchase/restore and backend entitlement read surfaces, so including them in the release-candidate smoke lint keeps the launch check aligned with the landed code.

## Files Intentionally Kept

Historical branch deltas, audits, provider sheets, QA runbooks, and `_cursor_context` provider notes were kept. They are provenance and operational evidence, not redundant source. Deleting them would make it harder to explain why provider decisions were made.

Ignored generated/local files were not added to git. Existing ignored dependency/build folders are local workspace state and can be regenerated or cleaned separately when desired.

## Cloud and Provider Posture

This audit branch did not change Supabase migrations or Edge Functions. No Supabase deploy is required for this branch.

Provider dashboard/manual QA remains intentionally deferred where real provider mutation would be required:

- controlled OneSignal push QA
- controlled Bunny media upload/playback/delete QA
- controlled Daily call/reconnect QA
- controlled Resend email QA
- controlled Twilio SMS/Lookup QA
- physical-device native QA
- controlled RevenueCat sandbox purchase and restore QA

## Validation Run

Commands run successfully during this audit:

- `npx eslint apps/mobile/app/premium.tsx apps/mobile/app/settings/account.tsx`
- `npx tsx shared/matching/onesignalProviderOperationalQa.test.ts`
- `npx tsx shared/matching/bunnyProviderOperationalQa.test.ts`
- `npx tsx shared/matching/dailyProviderOperationalQa.test.ts`
- `npx tsx shared/matching/resendEmailProviderOperationalQa.test.ts`
- `npx tsx shared/matching/twilioPhoneVerificationQa.test.ts`
- `npx tsx shared/matching/nativePhysicalDeviceQaReadiness.test.ts`
- `npx tsx shared/matching/revenueCatNativeEntitlementReadiness.test.ts`
- `bash apps/mobile/scripts/rc-smoke-check.sh`
- `npm run typecheck`
- `npm run build`
- `npm run lint`
- `npm run test:hardening-contracts`
- `npm run test:event-lobby-regression`
- `npm run audit:video-date-remote-frame`
- `npm run test:daily-room-contract`
- `npx tsx --test shared/matching/readyGateCountdown.test.ts`
- `npx tsx --test shared/observability/videoDateOperatorMetrics.test.ts`
- `npx tsx --test supabase/functions/_shared/admin-video-date-ops.test.ts`
- `git diff --check`

Notes:

- `npm run lint` exits cleanly with warning-only existing debt.
- `npm run build` exits cleanly with existing Vite chunk-size and dynamic-import warnings.
- The updated native smoke lint list passed; the script still reports existing onboarding warnings, but no errors.

## Safety Confirmations

- Docker was not used.
- Local Supabase was not used.
- `supabase db push` was not run.
- No Supabase migration was added.
- No Edge Function changed.
- No Edge Function was deployed.
- No env vars were added or changed.
- No native modules were added.
- No `expo-av` import or package was added.
- No production SMS, email, push, media upload/delete, Daily room, or RevenueCat purchase smoke was run.
