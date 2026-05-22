# fix/final-release-ops-readiness-closure

## Investigation Source

- `docs/investigations/final-release-ops-readiness.md`

## Findings Addressed

- Refreshed the stale operator runbook Edge Function inventory in `_cursor_context/vibely_rebuild_runbook.md` Section 13.
- Replaced the historical 30-function baseline and stale JWT counts with the current 55-function repo inventory.
- Added static proof that the runbook function list and JWT counts match `supabase/config.toml` and the actual `supabase/functions` directories.

## Findings Deferred

- RevenueCat dashboard, store-product, sandbox purchase/restore, and webhook provider proof remains manual.
- Supabase cloud `verify_jwt` proof remains limited by tooling because `supabase functions list` does not expose gateway JWT posture.
- Controlled OneSignal, Bunny, Daily, Resend, Twilio, physical-device, and screenshot-led release gates remain manual release follow-up.

## Files Changed

- `_cursor_context/vibely_rebuild_runbook.md`
- `shared/matching/finalReleaseOpsReadinessClosure.test.ts`
- `docs/branch-deltas/fix-final-release-ops-readiness-closure.md`

## Exact Implementation

- Updated Section 13 of the rebuild runbook to record the then-current function inventory. This branch-delta is superseded by the 2026-05-23 external-dependency closure pass:
  - 67 deployable function directories excluding `_shared`
  - 67 `[functions.<slug>]` entries in `supabase/config.toml`
  - 39 `verify_jwt = true` functions
  - 28 `verify_jwt = false` functions
  - canonical production project ref `schdyxcunwcvddlcshwd / MVP_Vibe`
  - targeted deploy guidance for scoped repairs
  - full rebuild deploy guidance only for planned rebuild/cutover work
- Removed stale operator-facing counts and obsolete function names from the active inventory section.

## Tests Added/Updated

- Added `shared/matching/finalReleaseOpsReadinessClosure.test.ts`.

The closure test checks:

- the investigation report and this branch delta exist
- runbook Section 13 uses the current 55-function inventory
- runbook Section 13 no longer carries stale historical function guidance
- function inventory and JWT counts match `supabase/config.toml` and the function directories
- no migration, validation SQL, or Edge Function artifact was added
- no env vars, native modules, or `expo-av` usage were introduced
- manual provider/device/screenshot gates remain explicit

## Rebuild Impact

- Operator documentation only.
- No runtime product behavior changed.

## Route/Page Drift

- Added routes/pages: none
- Removed routes/pages: none
- Changed routes/pages: none

## Edge Functions

- Edge Function files changed: none
- Edge Function deploy requirement: none
- Broad Edge Function deploy: not required

## Schema/Storage

- Supabase migration requirement: none
- Supabase validation SQL: none
- Storage changes: none

## Env Vars

- Env vars added/changed: none

## Provider/Dashboard Changes

- Provider/dashboard changes required: manual follow-up only.
- RevenueCat dashboard/store/sandbox proof remains manual.
- Controlled provider smokes remain manual and were not run by this closure.

## Supabase Cloud

- Supabase DB push requirement: none
- Supabase function deploy requirement: none
- Supabase config cloud artifact changes: none

## Web/Static Deploy

- Web/static deploy requirement: none

## Native

- Native module changes: none
- `expo-av`: not used

## Production Smoke Limitations

- No real provider smoke was run.
- No real payments, push, email, SMS, media, Daily room, or RevenueCat purchase/restore smoke was run.
- No production data-mutating smoke was run.

## Remaining Manual Follow-Up

- Execute and log controlled provider QA gates before broad public release.
- Execute and log physical-device native QA and screenshot-led parity gates.
- Confirm Supabase dashboard gateway JWT posture after any future function deploy because read-only CLI output does not expose `verify_jwt`.
