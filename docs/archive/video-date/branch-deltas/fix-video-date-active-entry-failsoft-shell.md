# Branch Delta: Video Date Active Entry Fail-Soft Shell

Date: 2026-06-09

## Problem

The latest disposable two-user production run reached Ready Gate both-ready and routed into `/date/:sessionId`, but never established a stable bilateral Video Date. One participant held `/date` only briefly, the backend surface claim expired before provider-backed Daily presence stabilized, the peer joined Daily later and briefly, and the session ended as a pre-stable partial join without survey or feedback rows.

The stable bilateral media gate correctly refused date promotion. The remaining failure class was the active-entry shell before stable media: route/surface ownership could gap while the user was already on `/date`, and retryable active-path RPC/Edge failures could still appear as raw transport errors.

## Changes

- Web `VideoDate` now keeps the duplicate-tab/server surface lease active for the whole allowed `/date` route shell until terminal survey, explicit exit, feedback, or ended phase.
- The web surface claim still treats backend `SURFACE_NOT_CLAIMABLE` as no-backoff retry while route state catches up, but ownership renewal no longer waits for handshake/date truth.
- `daily-room` prepare-entry responses now map retryable prepare/confirm payloads to retryable non-500 responses.
- Migration `20260609105249_video_date_active_entry_failsoft_shell.sql` adds final active-entry fail-soft shells for:
  - `video_session_mark_ready_v2(uuid,text,text)`
  - `video_date_transition(uuid,text,text)`
  - `mark_video_date_daily_joined(uuid,text,text,text,text,text)`
  - `record_video_date_launch_latency_checkpoint(uuid,text,jsonb,integer)`
- Added `shared/matching/videoDateActiveEntryFailsoftShellContracts.test.ts` and wired it into the Video Date red-flag and v4 suites.
- Updated ownership/review-comment contracts to assert allowed-route shell ownership rather than waiting for handshake/date truth.

## Verification

- `npx tsx shared/matching/videoDateActiveEntryFailsoftShellContracts.test.ts`
- `npx tsx shared/matching/videoDateStableBilateralMediaGateContracts.test.ts`
- `npx tsx shared/matching/reviewComments1256_1262Followups.test.ts`
- `npx tsx shared/matching/videoDateFailsoftDateRoomRpcs.test.ts`
- `npm run test:video-date:red-flags`
- `npm run test:video-date-v4`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`

## Still Unproven

This is implementation evidence only. Product acceptance still requires a fresh disposable two-user production run through match, Ready Gate, same Daily room, stable bilateral provider-backed media/date, date end, and survey completion by both users, plus short leave/rejoin and prolonged absence checks.
