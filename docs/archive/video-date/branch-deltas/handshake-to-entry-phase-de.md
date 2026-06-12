# Handshake -> Entry Phase D/E Active Contract

Date: 2026-06-11
Branch: `codex/finish-handshake-to-entry`

## Scope

Simplify the active Vibely Video Date vocabulary from "handshake" to "entry" while preserving the golden flow:

mutual swipe -> Ready Gate -> both ready -> `prepare_date_entry` -> `/date`/native date -> Daily media -> post-date survey -> `date_feedback`.

## Implemented

- Web/native date routes use entry phase vocabulary for active state, countdown completion, decision persistence, terminal survey recovery, and logs.
- Active clients use `complete_entry` / `continue_entry`, `video_session_continue_entry_v2`, `video_session_entry_auto_promote_v2`, `video_date.outbox_v2.continue_entry`, and `video_date.outbox_v2.entry_auto_promote`.
- Shared route, snapshot, public API, recovery, push-preload, active-session, countdown, and persistence helpers normalize legacy server `handshake` phase to canonical `entry` before product code makes decisions.
- Active readers use `entry_started_at` and `entry_grace_expires_at`; old payload keys are only read inside the short-lived server compatibility boundary.
- Forward migration `20260611114354_video_date_entry_contract_phase_de.sql` seeds entry-named flags from old flag state and replaces `get_video_date_snapshot_core(uuid)` so public snapshots emit `phase = 'entry'`.
- Current-facing tests now enforce entry action/flag/RPC usage and preserve `date_feedback` survey continuity.

## Deferred Compatibility

The physical DB purge is intentionally deferred. Linked preflight found one live `video_sessions` row still in `state='handshake'` / `phase='handshake'` and broad live function dependencies. Renaming the enum or dropping the underlying `handshake_*` DB internals in this pass would have risked in-progress dates and post-date survey recovery.

Allowed remaining references:

- server boundary normalizers for legacy phase values;
- Daily-room fallback reads of old RPC payload keys while wrappers delegate through the existing DB internals;
- persisted registration status `in_handshake`;
- old applied migrations, historical docs, generated catalog types, and tests that assert historical migrations or explicit compatibility.

## Proof Boundary

This is source/backend contract simplification, not product acceptance. Static tests and linked dry-run can prove the active contract shape, but Video Date is not accepted until a fresh disposable two-user production-like run persists `date_feedback` for the completed date.
