# Branch Delta: Video Date Lean Runtime Contract

Date: 2026-06-09

## Intent

Start simplifying Video Date by adding a small shared screen/command contract over the current route-decision and snapshot surfaces, without changing hot-path backend behavior.

## Changes

- Added `docs/contracts/video-date-lean-runtime-contract.md`.
- Added `shared/matching/videoDateLeanRuntimeContract.ts`.
- Added `shared/matching/videoDateLeanRuntimeContract.test.ts`.
- Wired the contract test into `npm run test:video-date-v4`.

## Scope Boundary

- No Supabase migration was added.
- No Edge Function behavior was changed.
- No web/native route was migrated to the new contract yet.
- The existing read surfaces remain `get_video_date_start_snapshot_v1`, `video-date-snapshot`, and `get_video_date_snapshot_core`.

## Verification

Run:

```bash
npx tsx shared/matching/videoDateLeanRuntimeContract.test.ts
npm run test:video-date-v4
```

Product acceptance still requires a fresh two-user production run through survey completion.
