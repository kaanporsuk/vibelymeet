# Review Comments 1322-1324 Follow-ups

Date: 2026-06-13

Scope: thread-aware GitHub review-comment follow-up for merged PRs #1322, #1323,
#1324 — which are themselves the prior three review-comment follow-up PRs, so
this is a second-order pass over Codex's comments on those fixes. No
Copilot-authored review threads exist in this repository; both actionable threads
are Codex (`chatgpt-codex-connector[bot]`); #1323 had none. Each was re-triaged
against current `main` HEAD. Ships one Edge Function change
(`video-date-room-cleanup`) plus a native TS fix and two contract-test pins; no
migration.

## Addressed Threads

- **#1322 P2 — fresh entry-truth still short-circuited on a decision-less
  snapshot.** PR #1322 added `{ fresh }` to `fetchVideoSessionDateEntryTruth`
  (`apps/mobile/lib/videoDateApi.ts`) to bypass the 300 ms read cache for
  mutation-verification callers, but it still called
  `fetchVideoDateStartSnapshot` *first* and returned `snapshotTruth` before ever
  reaching the direct `video_sessions` row read. The start-snapshot converter
  (`videoDateStartSnapshotToDateEntryTruth` in
  `shared/matching/videoDateStartSnapshot.ts`) does **not** populate the decision
  columns (`participant_1_liked`, `participant_2_liked`, `participant_*_decided_at`),
  while `persistEntryDecisionWithVerification` confirms a just-persisted Vibe/Pass
  against exactly those columns — so a successful snapshot made native treat a
  saved decision as unsaved and retry/fail. Fix: gate the snapshot short-circuit
  behind `if (!fresh)`. Fresh callers now go straight to `fetchVideoDateSessionRow`
  (which selects the decision columns and is a complete superset truth, including
  `ready_gate_status`); non-fresh route-guard/hydration callers keep the
  snapshot-first fast path (broadcast-gap recovery) and do not consume the
  decision columns. Also repaired the stale
  `videoDateStartSnapshotContracts.test.ts` assertion that PR #1322 had left
  failing (it pinned the bare `fetchVideoDateStartSnapshot(sessionId)` signature;
  the test is not in the curated battery so the drift went uncaught) and pinned
  the fresh-bypass invariant.

- **#1324 P2 — marker-write failures were not treated as reconciliation
  failures.** PR #1324's `reconciliationFailed` predicate
  (`supabase/functions/video-date-room-cleanup/index.ts`) only checked
  `reconciliation.ok === false`. But when the scan succeeds and
  `recordReconciliationMarker` fails on a non-dry-run pass,
  `maybeRunReconciliationPass` returns `{ ran: true, ok: true, dryRun: false,
  markerRecorded: false }` — the cadence marker was not written, so the gate never
  advances, the lane retries every minute, and the stage-2 synthetic probe reads a
  false green. Fix: the predicate now also fails when `dryRun === false &&
  markerRecorded === false` (rewritten as an explicit `if/else if/else` so each
  branch narrows the discriminated union cleanly). Pinned in
  `videoDateRoomCleanupReconciliationContracts.test.ts`.

## Resolved Before This Branch (no action needed)

- **#1323** had no inline review threads.

## Intentional Boundaries

- This is second-order review-comment hardening of the prior follow-up PRs. The
  only live behavior changes are the #1322 native read correctness fix (a fresh
  verification now reads the row that carries the decision columns) and the #1324
  observability fix (a dropped cadence marker now surfaces as a failure). Both
  preserve signatures, grants, and security posture; no migration. Acceptance
  remains a fresh two-user run through persisted `date_feedback`.

## Validation

- `npm run typecheck` (core + apps/mobile + tsconfig.app) — clean
- `npm run lint` — clean
- `npm run test:video-date:red-flags` — pass
- `npm run test:video-date-v4` — pass (incl. the repaired snapshot-contract test
  and the new marker-failure pin)
- Edge Function `video-date-room-cleanup` redeployed to `schdyxcunwcvddlcshwd`
  (Deno typechecks the bundle on deploy)
