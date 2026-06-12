# Video Date room-cleanup cron consolidation — decision + plan

Date: 2026-06-12 (acceptance follow-up round 2). Status: **decided, planned,
deliberately not implemented in the follow-up batch** — this is a behavior
change to two incident-relevant lanes and must be its own PR with its own live
gate.

## Current state (verified live 2026-06-12)

Two minute-class crons both delete Daily rooms via the Daily API directly
(neither uses the outbox `daily.delete_video_date_room` kind):

| Lane | Schedule | Scan source | Delete trigger | Safety posture | Audit |
|---|---|---|---|---|---|
| `video-date-room-cleanup` (647 LOC) | `* * * * *` | DB `video_sessions` (terminal rows with `daily_room_name`, `daily_room_provider_deleted_at IS NULL`) | session terminal | presence-grace: checks room presence before delete; stamps `daily_room_provider_deleted_at` + `daily_room_provider_delete_reason='room_cleanup:*'` | session-row stamps |
| `video-date-orphan-room-cleanup` (876 LOC) | `*/10 * * * *` | Daily API room listing | room exists with no matching live session | safety interlock (bounded deletes per run, age floors) | `video_date_orphan_room_cleanup_audit` rows |

Overlap: a terminal session's room missed by the session lane (e.g. session row
deleted before the room delete landed — exactly what disposable-smoke cleanup
can produce) is swept by the orphan lane within ~10 minutes. That redundancy is
the current safety net; removing it carelessly trades complexity for risk.

## Decision

Consolidate into **one** `video-date-room-cleanup` function with two internal
passes (session pass every run; provider-reconciliation pass on every Nth run
or behind an interval check), keeping BOTH semantics intact:

1. Session pass: identical to today's session lane (presence grace, stamps).
2. Reconciliation pass: identical to today's orphan lane (provider listing,
   safety interlock, audit rows), executed at the current 10-minute cadence via
   a `last_reconciliation_at` marker (config table row or audit-table max) so
   one cron schedule serves both cadences.

Drop the `video-date-orphan-room-cleanup` cron + function only after the merged
function has produced reconciliation audit rows in production for 24h.

## Why not now

- Both lanes touch the Daily API with different rate budgets; merging changes
  the per-minute API call profile and needs its own observation window.
- The orphan lane's safety interlock parameters must be re-validated at the new
  call site; a mistake here deletes live rooms mid-date.
- The follow-up batch already recreates `video_date_transition`,
  `mark_video_date_remote_seen`, and `update_participant_status`; stacking a
  cron/Edge behavior change on top would make the live gate unattributable.

## Acceptance for the future PR

- Merged function deployed; both passes observable in logs/audit for 24h.
- `video-date-orphan-room-cleanup` cron + function removed with dependent-scan
  evidence; runbook cron table updated.
- A staged orphan room (created via Daily API with a dead name) is reconciled
  within one reconciliation interval; a live in-date room survives both passes.
