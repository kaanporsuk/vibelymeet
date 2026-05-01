# docs/final-hardening-release-rehearsal

## Problem

Streams 1-19 hardened the Event Lobby, Ready Gate, video-date, payment, media, notification, provider, native, and Supabase function posture. Stream 20 records a final release/rebuild rehearsal so the current state can be reproduced without relying on memory.

## Scope

Docs and audit proof only:

- final rehearsal document
- Stream 20 branch delta
- static contract test

No product semantics changed.

## Files Audited

- `git log --oneline -25`
- `docs/branch-deltas/*`
- `docs/ready-gate-backend-contract.md`
- provider docs for OneSignal, Bunny, Daily, Resend, Twilio, Stripe, RevenueCat, Supabase, DNS/CDN, PostHog, and Sentry
- `_cursor_context/vibely_edge_function_manifest.md`
- `_cursor_context/vibely_external_dependency_ledger.md`
- `_cursor_context/vibely_supabase_provider_sheet.md`
- `_cursor_context/vibely_machine_readable_inventory.json`
- `docs/rebuild-rehearsal-log.md`
- `docs/post-audit-operational-verification-checklist.md`
- `supabase/config.toml`
- `shared/matching/*.test.ts`

## Read-Only Supabase Checks

Commands run:

- `supabase projects list`
- `supabase migration list --linked`
- `supabase functions list --project-ref schdyxcunwcvddlcshwd`
- `supabase secrets list --project-ref schdyxcunwcvddlcshwd`

Results:

- Linked project: `schdyxcunwcvddlcshwd / MVP_Vibe`
- Migrations: local and remote columns matched in the CLI output, including the latest rows through `20260501230000`
- Functions: 49 functions listed as `ACTIVE`
- Secrets: expected provider secret names visible by name/digest; no secret values printed

## Changes Made

- Added `docs/release/final-hardening-release-rehearsal.md`
- Added `docs/branch-deltas/docs-final-hardening-release-rehearsal.md`
- Added `shared/matching/finalHardeningReleaseRehearsal.test.ts`

## Stream Ledger Status

The rehearsal document records Streams 1-19 as merged/represented by current `main` artifacts. The ledger points to each stream's primary branch delta and contract test or migration.

## Deploy Requirements

- Supabase migration: none
- Supabase DB push: not required and not run
- Edge Function files changed: none
- Edge Function deploy: not required
- Provider dashboard mutation: not performed
- Production data mutation: not performed

## Environment And Safety

- Docker: not used
- Local Supabase: not used
- Real paid checkout: not run
- Real push: not run
- Real SMS: not run
- Real email: not run
- Real media upload/delete: not run
- Env var changes: none
- Native modules: none
- `expo-av`: not imported or required

## Release Recommendation

The repo is go for controlled internal release rehearsal and continued provider/device manual QA. It is no-go for broad public release until the remaining controlled provider and physical-device gates are completed and logged.

## Remaining Manual Release Gates

- Controlled OneSignal push QA
- Controlled Bunny media QA
- Controlled Daily room QA
- Resend controlled email QA
- Twilio controlled phone QA
- RevenueCat/App Store entitlement setup if incomplete
- Physical-device native QA
- Screenshot-led native visual parity capture and fixes
