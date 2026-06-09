# Neutral Entry Timer Aliases

Date: 2026-06-09
Branch: `codex/neutral-entry-timer-aliases`

## Scope

Migrate active product countdown/timer terminology away from "handshake timer" names while preserving the deployed DB/API vocabulary.

This is the follow-up to `docs/branch-deltas/remove-standalone-enter-handshake.md`.

## Changed

- Added `shared/matching/videoDateEntryTiming.ts`, a small alias boundary from legacy DB columns to neutral timer names:
  - `handshake_started_at` -> `entryStartedAtIso`
  - `handshake_grace_expires_at` -> `entryGraceExpiresAtIso`
  - `date_started_at` -> `dateStartedAtIso`
- Changed `shared/matching/videoDateCountdown.ts` to accept `entryStartedAtIso` and `entryDurationSeconds` instead of `handshakeStartedAtIso` and `handshakeDurationSeconds`.
- Renamed web/native timer components from `HandshakeTimer` to `EntryPhaseTimer`.
- Updated web `/date/:sessionId`, native `/date/[id]`, and native session countdown resolution to use `entryStartedAt`, `entryTimerStarted`, `entryDeadlineUrgent`, and `entry_visible_countdown_elapsed` names in active countdown/timer code.
- Updated warm-up timer telemetry source actions from `server_handshake_started_at` to `server_entry_started_at` and added neutral `entry_started_at` fields while retaining legacy `handshake_started_at` payload fields for compatibility.

## Preserved

- Database columns remain `handshake_started_at` and `handshake_grace_expires_at`.
- Public/generated type fields remain unchanged.
- Runtime phase values remain `handshake`, `date`, and `ended`.
- Vibe/Pass and `complete_handshake` behavior remains unchanged.
- Backend SQL migrations are not rewritten.

## Blockers

Do not remove or rename the legacy DB columns, generated types, or phase vocabulary until a fresh disposable two-user production run proves:

- match -> Ready Gate -> same Daily room,
- stable bilateral provider-backed media/date,
- date end,
- both users persist `date_feedback`,
- leave/rejoin and prolonged absence checks behave correctly.

## Proof Boundary

This is a terminology and alias-boundary cleanup only. It is not Video Date product acceptance and does not certify Video Date as fixed.
