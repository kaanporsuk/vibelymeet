# Ready Gate Transition Expiry / Rowcount Hardening

Branch: `fix/ready-gate-transition-expiry-rowcount`

## Problem

The Ready Gate RPC was already backend-owned, row-locked, and observable, but the current production shape was layered through wrapper migrations:

- `20260501135000_video_date_observability_v1.sql`
- `20260501170000_video_date_handshake_starts_after_daily_join.sql`

Those wrappers delegated transition semantics to the older implementation. That meant a `mark_ready` or `snooze` request could rely on cleanup that ran before the row lock, then mutate the session after the gate had elapsed at the expiry boundary. Guarded `UPDATE` statements also returned optimistic success without checking whether the row was actually updated.

## Audit Note

Pre-change audit findings:

- `ready_gate_transition` calls `expire_stale_video_sessions()` before locking the target `video_sessions` row.
- The target session is locked with `FOR UPDATE`.
- Terminal states short-circuit as `forfeited`, `expired`, and `both_ready`.
- `mark_ready`, `snooze`, and `forfeit` used guarded updates, but the public transition body did not check `ROW_COUNT` before returning success.
- The latest public function was a wrapper that preserved observability and both-ready provider grace, but it did not own the critical ready/snooze mutation logic.

## Change

New migration:

- `supabase/migrations/20260501190000_ready_gate_transition_expiry_rowcount.sql`

The migration renames the previous public function to:

- `ready_gate_transition_20260501190000_expiry_rowcount_prior`

and recreates public:

- `ready_gate_transition(uuid, text, text)`

The public signature is unchanged.

## Behavior

The new canonical public function:

- remains `SECURITY DEFINER`
- pins `SET search_path TO 'public'`
- keeps `auth.uid()` participant authorization
- calls `expire_stale_video_sessions()`
- locks the target `video_sessions` row with `FOR UPDATE`
- re-checks `ready_gate_expires_at <= v_now` under the lock for `mark_ready` and `snooze`
- terminalizes elapsed pre-Daily/pre-date gates as `expired` with `ended_reason = 'ready_gate_expired'`
- clears linked `event_registrations` for the affected session only when expiry/forfeit actually updates the session
- checks `GET DIAGNOSTICS v_row_count = ROW_COUNT` after guarded transition updates
- re-reads session truth on zero-row guarded updates
- returns explicit `stale_transition`, `conflict`, terminal, or expired truth instead of optimistic success
- preserves terminal idempotency for `forfeited`, `expired`, and `both_ready`
- preserves both-ready provider grace at 45 seconds
- preserves `ready_gate_transition` event-loop observability

Additive response fields may appear on some paths:

- `ready_gate_status`
- `reason`
- `error_code`
- `terminal`

Existing fields such as `success`, `status`, `ready_gate_expires_at`, `ready_participant_1_at`, `ready_participant_2_at`, `snoozed_by`, and `snooze_expires_at` remain present where they existed.

## Out Of Scope

This stream does not implement:

- event-ended Ready Gate terminalization
- inactive-event Daily prepare-entry guard
- web terminal copy polish
- native Ready Gate contract/parity
- broader realtime subscription tightening
- Edge Function changes

## Tests And Validation

Added:

- `shared/matching/readyGateTransitionExpiryRowcount.test.ts`
- `supabase/validation/ready_gate_transition_expiry_rowcount.sql`

The validation SQL is read-only/catalog-safe for production verification. It checks:

- public signature exists
- function is `SECURITY DEFINER`
- fixed `search_path`
- under-lock expiry handling for `mark_ready` / `snooze`
- `GET DIAGNOSTICS` / `ROW_COUNT`
- explicit zero-row stale/conflict handling
- prior renamed base is not client-executable

## Deploy Notes

Supabase deploy required:

- apply `20260501190000_ready_gate_transition_expiry_rowcount.sql`

No Edge Function deploy required.

No env var changes.

Approved production target:

- `schdyxcunwcvddlcshwd / MVP_Vibe`

Deployment order:

1. Merge PR.
2. Confirm linked project is `schdyxcunwcvddlcshwd`.
3. Run `supabase db push --linked --dry-run`.
4. Continue only if dry-run shows exactly the Stream 2 migration.
5. Run `supabase db push --linked`.
6. Run the read-only validation SQL against linked production.
