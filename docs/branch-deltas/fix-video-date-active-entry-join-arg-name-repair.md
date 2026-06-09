# Branch Delta: Video Date Active Entry Join Arg Name Repair

Date: 2026-06-09

## Problem

Post-apply catalog verification of `20260609105249_video_date_active_entry_failsoft_shell.sql` found that the public `mark_video_date_daily_joined(uuid,text,text,text,text,text)` wrapper exposed its fifth PostgREST argument as `p_provider_participant_id`.

Current web/native clients and generated Supabase types call the six-argument RPC with named argument `p_entry_attempt_id`. The type signature was still positional-compatible, but named PostgREST calls could fail.

## Changes

- Added corrective migration `20260609112843_video_date_active_entry_join_arg_name_repair.sql`.
- Dropped and recreated the public `mark_video_date_daily_joined(uuid,text,text,text,text,text)` wrapper with fifth argument `p_entry_attempt_id`.
- Preserved delegation to `mark_video_date_daily_joined_20260609105249_active_entry_base(...)`.
- Preserved active-entry fail-soft JSON behavior and grants.
- Extended `shared/matching/videoDateActiveEntryFailsoftShellContracts.test.ts` to lock the public argument name.

## Verification

- `npx tsx shared/matching/videoDateActiveEntryFailsoftShellContracts.test.ts`
- `npm run test:video-date:red-flags`
- `git diff --check`

## Still Unproven

This repairs deployment/API compatibility. Product acceptance still requires a fresh disposable two-user production run through survey completion, plus short leave/rejoin and prolonged absence checks.
