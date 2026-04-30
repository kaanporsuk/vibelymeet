# Ready Gate Event-Ended Terminalization

Branch: `fix/ready-gate-event-ended-terminalization`

## Problem

Stream 1 blocks new Event Lobby deck/swipe/mystery/queue/promotion work outside the strict live-event window. Stream 2 makes `ready_gate_transition` truthful at expiry and guarded-update race boundaries.

The remaining backend gap was existing Ready Gates: a `queued`, `ready`, `ready_a`, `ready_b`, `snoozed`, or unprepared `both_ready` session could still linger after the event ended/cancelled/archived or after the scheduled live window elapsed. A stale `both_ready` row could also attempt `/date/:id` handoff through Daily prepare-entry after the associated event was inactive.

## Audit Note

- Admin cancellation currently sets `events.status = 'cancelled'`; event delete removes dependent rows.
- No lifecycle trigger previously closed existing pre-date Ready Gates when `events.status`, `ended_at`, or `archived_at` changed.
- Natural live-window expiry has no row update, so cleanup must also be reached from Ready Gate sync/action RPCs and the Daily prepare-entry SQL path.
- `daily-room` `prepare_date_entry` already calls `video_date_transition('prepare_entry')` before provider room work and service-role `confirm_video_date_entry_prepared` after provider proof.
- Provider-prepared/date-capable truth is represented by `state/phase` in `handshake` or `date`, `daily_room_name` / `daily_room_url`, `handshake_started_at`, `date_started_at`, or Daily join stamps.

## Change

New migration:

- `supabase/migrations/20260501200000_ready_gate_event_ended_terminalization.sql`

New internal cleanup function:

- `terminalize_event_ready_gates(uuid, text)`

Changed/wrapped public SQL surfaces:

- `ready_gate_transition(uuid, text, text)`
- `video_date_transition(uuid, text, text)`
- `confirm_video_date_entry_prepared(uuid, text, text, text)`

New event lifecycle trigger:

- `events_terminalize_ready_gates_on_inactive`

## Event-Inactive Semantics

The migration reuses Stream 1 backend truth through `get_event_lobby_inactive_reason(uuid)`.

Inactive reasons:

- `event_archived`
- `event_cancelled`
- `event_ended`
- `event_not_live`
- `event_outside_live_window`

Ready Gate terminal reasons:

- `ready_gate_event_archived`
- `ready_gate_event_cancelled`
- `ready_gate_event_ended`
- `ready_gate_event_inactive`

`inactive_reason` is returned additively where useful so clients/operators can distinguish event lifecycle truth without changing existing public signatures.

## Cleanup Scope

`terminalize_event_ready_gates` only targets pre-date Ready Gate rows:

- `queued`
- `ready`
- `ready_a`
- `ready_b`
- `snoozed`
- `both_ready` only when not provider-prepared/date-capable

The cleanup sets:

- `ready_gate_status = 'expired'`
- `state = 'ended'`
- `phase = 'ended'`
- `ended_reason = ready_gate_event_*`
- linked `event_registrations.queue_status = 'idle'`
- `current_room_id = NULL`
- `current_partner_id = NULL`

It deliberately does not put users back into active browsing for an inactive event.

## Provider-Prepared Exclusion

Normal event end does not kill already-prepared handshake/date sessions. Rows are excluded from event-ended Ready Gate terminalization if they have any of:

- `state IN ('handshake', 'date')`
- `phase IN ('handshake', 'date')`
- `daily_room_name IS NOT NULL`
- `daily_room_url IS NOT NULL`
- `handshake_started_at IS NOT NULL`
- `date_started_at IS NOT NULL`
- `participant_1_joined_at IS NOT NULL`
- `participant_2_joined_at IS NOT NULL`

## Prepare-Entry Guard

`video_date_transition('prepare_entry')` now locks the session, verifies participant ownership, and rejects inactive associated events before delegating to the prior state machine for active/prepared rows.

`confirm_video_date_entry_prepared` also rejects inactive unprepared rows before persisting routeable Daily metadata. This preserves the service-role confirmation path and blocks a stale handoff if event inactivity appears between preflight and DB confirmation.

Response shape is additive:

- existing `code = 'READY_GATE_NOT_READY'` is preserved for compatibility
- `error_code = 'EVENT_NOT_ACTIVE'`
- `reason = 'event_not_active'`
- `inactive_reason`
- `terminal`

## Observability

Cleanup emits `READY_GATE_EVENT_ENDED` through `record_event_loop_observability` with:

- `event_id`
- `session_id`
- previous ready gate status
- previous state/phase
- terminal reason
- inactive reason
- registration row count

Prepare-entry blockers emit:

- `prepare_entry_event_inactive`
- `confirm_prepare_entry_event_inactive`

No sensitive profile/media payloads are included.

## Security

All new/replaced functions are `SECURITY DEFINER` and pin:

- `SET search_path TO 'public'`

Internal helper surfaces are not client-executable:

- `terminalize_event_ready_gates(uuid, text)`
- `handle_event_ready_gate_terminalization()`

Both revoke `PUBLIC`, `anon`, and `authenticated`. `terminalize_event_ready_gates` is granted to `service_role` for trusted backend/operator use.

Public signatures are preserved.

## Tests And Validation

Added:

- `shared/matching/readyGateEventEndedTerminalization.test.ts`
- `supabase/validation/ready_gate_event_ended_terminalization.sql`

The validation SQL is read-only/catalog-safe for production. It verifies:

- functions exist
- security definer/search path
- targeted pre-date statuses
- provider-prepared/date-capable exclusions
- lifecycle trigger
- Ready Gate event-inactive handling
- prepare-entry inactive guard
- helper grants/revokes
- renamed bases are not client-executable

## Deploy Notes

Supabase deploy required:

- apply `20260501200000_ready_gate_event_ended_terminalization.sql`

No Edge Function deploy required.

No env var changes.

Approved production target:

- `schdyxcunwcvddlcshwd / MVP_Vibe`

Deployment order:

1. Merge PR.
2. Confirm linked project is `schdyxcunwcvddlcshwd`.
3. Run `supabase db push --linked --dry-run`.
4. Continue only if dry-run shows exactly the Stream 3 migration.
5. Run `supabase db push --linked`.
6. Run the read-only validation SQL against linked production.

## Remaining Risks Deferred

- web terminal copy polish
- native Ready Gate contract/parity
- broader realtime subscription tightening
- swipe retry/idempotency/dedupe
- client observability polish
