# fix/final-release-ops-readiness-closure

## Investigation Source

- `docs/investigations/final-release-ops-readiness.md`

## Findings Addressed

- Refreshed the stale operator runbook Edge Function inventory in `_cursor_context/vibely_rebuild_runbook.md` Section 13.
- Replaced the historical 30-function baseline and stale JWT counts with the current config-backed repo inventory.
- Added static proof that the runbook function list and JWT counts match `supabase/config.toml` and the actual `supabase/functions` directories.
- Follow-up audit alignment refreshed the manifest, provider sheet, dependency ledger, machine-readable inventory, and release notes to the same 70/40/30 source/config truth.

## Findings Deferred

- RevenueCat dashboard, store-product, sandbox purchase/restore, and webhook provider proof remains manual.
- Supabase cloud `verify_jwt` proof remains limited by tooling because `supabase functions list` does not expose gateway JWT posture.
- Controlled OneSignal, Bunny, Daily, Resend, Twilio, physical-device, and screenshot-led release gates remain manual release follow-up.

## Files Changed

- `_cursor_context/vibely_rebuild_runbook.md`
- `_cursor_context/vibely_edge_function_manifest.md`
- `_cursor_context/vibely_external_dependency_ledger.md`
- `_cursor_context/vibely_supabase_provider_sheet.md`
- `_cursor_context/vibely_machine_readable_inventory.json`
- `_cursor_context/vibely_golden_snapshot_audited.md`
- `docs/external-dependency-closure-plan-2026-05-23.md`
- `docs/investigations/final-release-ops-readiness.md`
- `docs/release/final-hardening-release-rehearsal.md`
- `docs/supabase-disk-io-diagnosis.md`
- `docs/supabase-full-backend-vs-frontend-audit.md`
- `docs/supabase-live-backend-audit.md`
- `shared/matching/finalReleaseOpsReadinessClosure.test.ts`
- `shared/matching/finalHardeningReleaseRehearsal.test.ts`
- `shared/matching/supabaseFunctionConfigGaps.test.ts`
- `docs/branch-deltas/fix-final-release-ops-readiness-closure.md`

## Exact Implementation

- Updated Section 13 of the rebuild runbook to record the current config-backed function inventory:
  - 70 deployable function directories excluding `_shared`
  - 70 `[functions.<slug>]` entries in `supabase/config.toml`
  - 40 `verify_jwt = true` functions
  - 30 `verify_jwt = false` functions
  - canonical production project ref `schdyxcunwcvddlcshwd / MVP_Vibe`
  - targeted deploy guidance for scoped repairs
  - full rebuild deploy guidance only for planned rebuild/cutover work
- Removed stale operator-facing counts and obsolete function names from the active inventory section.
- Marked older 55/67-function snapshots as historical where they remain useful provenance.
- Converted stale count assertions to derive function/config counts from the actual repo tree.

## Tests Added/Updated

- Added `shared/matching/finalReleaseOpsReadinessClosure.test.ts`.

The closure test checks:

- the investigation report and this branch delta exist
- runbook Section 13 uses the current config-backed function inventory
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
