# Review Comments 1322-1330 Follow-ups

Date: 2026-06-14

## Scope

Closed actionable Codex review comments from the last nine PRs (`#1322` through
`#1330`) against current `main`. No schema migration is included.

## Changes

- Web `/date/:sessionId` keeps the browser media preflight before
  `prepare_date_entry` unless the reusable Daily singleton is live or the Ready
  Gate prewarm carries live app-acquired audio and video tracks. Pending
  prewarm entries and generic prewarm call objects no longer suppress the
  recoverable `media_permission_denied` path.
- Web terminal-survey recovery scopes `event_registrations.queue_status =
  'in_survey'` fallback reads before `order(...).limit(1)`: current
  `current_room_id` first, then cleared-room/current-event continuity. A newer
  stale row from another event can no longer hide the current route's survey.
- `npm run latency:video-date [sessionId]` validates any provided session id as
  a UUID before management SQL and derives the "both joined Daily" budget from
  the first provider `participant.joined` webhook per actor, not latest
  reconnect-aware session columns.

## Already Verified On Current Main

- `#1322` native fresh entry verification already bypasses decision-less start
  snapshots for mutation verification in `apps/mobile/lib/videoDateApi.ts`.
- `#1324`/`#1325` room-cleanup marker-write failures already return
  reconciliation failure semantics and are documented in the runbook.
- `#1328` survey verdict contracts already accept skip-aware verdict sources on
  both web and native.

## Contract Pins

- `shared/matching/videoDateValidationFollowupContracts.test.ts`
- `shared/matching/videoDateLaunchAcceleration.test.ts`
- `shared/matching/videoDateStableBilateralMediaGateContracts.test.ts`
- `shared/matching/videoDateRoomCleanupReconciliationContracts.test.ts`
