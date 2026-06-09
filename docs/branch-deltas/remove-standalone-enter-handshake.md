# Remove Standalone Enter Handshake

Date: 2026-06-09
Branch: `codex/remove-standalone-enter-handshake`

## Scope

Remove standalone/client-visible `video_date_transition('enter_handshake')` as a direct Video Date entry command.

Golden entry remains:

- Event Lobby deck swipe / vibe / super-vibe
- mutual match
- Ready Gate
- both ready
- `prepare_date_entry`
- `video_date_transition('prepare_entry')` inside `daily-room`
- `/date/:sessionId`
- Daily video date
- `video_date_transition('end')`
- post-date survey

## Removed

- Native no longer exports `enterHandshake(...)` or `enterHandshakeWithTimeout(...)` from `apps/mobile/lib/videoDateApi.ts`.
- Native `/date/[id]` no longer has an explicit prejoin branch that calls `video_date_transition` with `p_action: 'enter_handshake'`.
- Active prepare-entry telemetry no longer emits `enter_handshake_started`, `enter_handshake_success`, or `enter_handshake_failure` checkpoints.
- Shared analytics no longer exposes unused `VIDEO_DATE_ENTER_HANDSHAKE_*` constants.

## Backend Behavior

Migration `supabase/migrations/20260609202707_remove_standalone_enter_handshake.sql` wraps `public.video_date_transition(uuid,text,text)`.

If `p_action = 'enter_handshake'`, the public RPC now returns structured fail-soft JSON:

- `success: false`
- `code: ENTER_HANDSHAKE_REMOVED`
- `retryable: false`
- `removed_public_action: true`
- `supported_action: prepare_entry`
- `entry_command: prepare_date_entry`

All other lifecycle actions delegate through the preserved hot-path no-throw base, including `prepare_entry`, `end`, reconnect actions, `vibe`, and `complete_handshake`.

## Preserved

- `prepare_date_entry` remains the only golden web/native room and token entry command.
- `video_date_transition('prepare_entry')` remains active and owns routeable entry setup.
- `video_date_transition('end')` remains active.
- Provider-side Daily room creation, verification, reuse, and token minting remain inside `prepare_date_entry`.
- `handshake_started_at` and `handshake_grace_expires_at` remain DB timer fields. The timing concept is not removed; standalone public entry into it is removed.

## Validation

- `shared/matching/dailyRoomLegacyActionRemovalContracts.test.ts` asserts active web/native clients do not send standalone `enter_handshake`, native does not export `enterHandshake`, and the migration rejects the removed public action while preserving `prepare_entry` delegation.
- `shared/matching/nativeVideoDateContractRecovery.test.ts` asserts native date entry remains `prepare_date_entry` / Daily-room gated and rejects the old helper/export.
- `shared/matching/videoDatePrejoinAttempt.test.ts` now preserves the `prepare_entry_routeable` prejoin step instead of an `enter_handshake` step.

## Residual References

Allowed residual `enter_handshake` references:

- old applied migrations;
- historical/archive/audit docs;
- current docs that explicitly say the action was removed or superseded;
- removal/static tests that assert the action is absent or rejected.

Blockers:

- active web/native client source sending `p_action: 'enter_handshake'`;
- native exports named `enterHandshake` or `enterHandshakeWithTimeout`;
- active telemetry emitting `enter_handshake_*` checkpoints as current entry stages;
- generated types or validation preserving a callable standalone entry contract.

## Proof Boundary

This is a cleanup/simplification pass only. It is not Video Date product acceptance. Video Date remains unaccepted until a fresh disposable two-user production run proves match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> both users persist `date_feedback`, including leave/rejoin and prolonged absence checks.
