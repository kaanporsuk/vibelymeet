# Ready Gate Backend Contract

Last updated: 2026-04-30

## Purpose and Scope

Ready Gate is the consent boundary between Event Lobby matching and a live Video Date. Web and native clients consume the same backend-owned contract. Clients may render state, request transitions, refetch, subscribe, and route from backend truth; they must not own Ready Gate or Video Date lifecycle writes.

This document freezes the contract after:

- Stream 1: `20260501180000_event_lobby_active_event_contract.sql`
- Stream 2: `20260501190000_ready_gate_transition_expiry_rowcount.sql`
- Stream 3: `20260501200000_ready_gate_event_ended_terminalization.sql`

## Canonical Backend Surfaces

- Swipe/match creation: `swipe-actions` Edge Function, delegating to `handle_swipe`.
- Queue promotion: `drain_match_queue(uuid)` and internal `promote_ready_gate_if_eligible(uuid, uuid)`.
- Ready Gate transitions: `ready_gate_transition(uuid, text, text)`.
- Daily handoff: `daily-room` action `prepare_date_entry`.
- Video Date lifecycle: `video_date_transition(uuid, text, text)`.
- Provider confirmation: `confirm_video_date_entry_prepared(uuid, text, text, text)`.
- Daily joined stamps: `mark_video_date_daily_joined` where present in the platform-specific video-date join path.

Native must not create a second contract. Native Ready Gate overlay and standalone `/ready/[id]` fallback consume these same surfaces.

## Event Lobby Active Rule

Event Lobby backend actions are allowed only when backend truth says:

- event exists
- `events.status = 'live'`
- `events.ended_at IS NULL`
- `events.archived_at IS NULL`
- database time is inside `event_date + COALESCE(duration_minutes, 60)`
- caller auth and participation checks for the specific RPC pass

Inactive reasons are machine-readable and user-safe after eligibility checks:

- `event_archived`
- `event_cancelled`
- `event_ended`
- `event_not_live`
- `event_outside_live_window`

Stream 1 blocks new deck/swipe/mystery/queue/promotion work outside this live window.

## Ready Gate Actions

Clients call `ready_gate_transition` with:

- `sync`: reconcile backend truth on open, focus, reconnect, polling fallback, or deep-link recovery.
- `mark_ready`: user consents to enter Video Date.
- `forfeit`: user skips/leaves this Ready Gate.
- `snooze`: user requests the backend-owned snooze transition.

Request shape:

```sql
select public.ready_gate_transition(
  p_session_id := '<video_sessions.id>'::uuid,
  p_action := 'sync' | 'mark_ready' | 'forfeit' | 'snooze',
  p_reason := null
);
```

The public signature is intentionally stable:

```sql
ready_gate_transition(uuid, text, text) returns jsonb
```

## Response Vocabulary

Responses are JSON objects. Existing fields remain compatible; Streams 2 and 3 added fields only additively.

Common fields:

- `success`: boolean
- `status`
- `ready_gate_status`
- `ready_participant_1_at`
- `ready_participant_2_at`
- `ready_gate_expires_at`
- `snoozed_by`
- `snooze_expires_at`
- `reason`
- `inactive_reason`
- `error_code`
- `code`
- `terminal`
- `event_id`

Clients must tolerate unknown additive fields and unknown terminal reason strings by falling back to generic stale/ended recovery.

## Ready Gate Statuses

Ready Gate statuses include:

- `queued`
- `ready`
- `ready_a`
- `ready_b`
- `snoozed`
- `both_ready`
- `forfeited`
- `expired`

Terminal client handling must treat `forfeited`, `expired`, and backend terminal truth as final for the Ready Gate. `both_ready` is not permission to directly create/join Daily; it is permission to attempt the backend prepare-entry path.

## Terminal Reasons

Existing Ready Gate terminal reasons include:

- `ready_gate_forfeit`
- `ready_gate_expired`
- `queued_ttl_expired`

Event-inactive terminal reasons include:

- `ready_gate_event_archived`
- `ready_gate_event_cancelled`
- `ready_gate_event_ended`
- `ready_gate_event_inactive`

Clients should show calm recovery copy and return users to the lobby/events surface. They should not loop retries on event-ended or inactive truth.

## Expiry Behavior

Stream 2 makes `ready_gate_transition` transactionally truthful at the expiry boundary:

- locks the `video_sessions` row before transition-sensitive checks
- computes one server timestamp
- re-checks `ready_gate_expires_at` under lock for `mark_ready` and `snooze`
- rejects late ready/snooze after expiry
- terminalizes elapsed mutable gates using existing expiry semantics
- checks guarded update rowcount
- returns stale/conflict/expired/terminal truth instead of optimistic success when a guarded update affects zero rows

Clients should call `sync` after local countdown expiry or reconnect and then follow backend truth.

## Event-Ended Behavior

Stream 3 closes existing pre-date Ready Gates when the associated event is inactive. Cleanup targets only pre-date Ready Gate rows:

- `queued`
- `ready`
- `ready_a`
- `ready_b`
- `snoozed`
- `both_ready` only when not provider-prepared/date-capable

Cleanup sets the session to ended/expired with `ended_reason = ready_gate_event_*`, clears affected `event_registrations.current_room_id` and `current_partner_id`, and sets affected registrations to neutral `idle`. It does not put users back into active browsing for an inactive event.

Already-prepared/date-capable sessions are excluded and allowed to finish naturally during normal event end.

## Daily Handoff Rule

Clients must only navigate to `/date/:id` or native date screen after one of these backend truths:

- `daily-room` `prepare_date_entry` succeeds and returns room/token data.
- A refetch shows provider-prepared/date-capable truth already exists.

Date-capable/provider-prepared fields are:

- `state IN ('handshake', 'date')`
- `phase IN ('handshake', 'date')`
- `daily_room_name IS NOT NULL`
- `daily_room_url IS NOT NULL`
- `handshake_started_at IS NOT NULL`
- `date_started_at IS NOT NULL`
- Daily joined stamps such as `participant_1_joined_at` / `participant_2_joined_at`

`both_ready` alone is not a date-route signal. It permits prepare-entry only.

`video_date_transition('prepare_entry')` blocks inactive associated events before provider preparation. `confirm_video_date_entry_prepared` also blocks inactive unprepared rows before persisting provider-room truth.

Prepare-entry inactive blockers preserve compatibility with:

- `code = READY_GATE_NOT_READY`
- additive `error_code = EVENT_NOT_ACTIVE`
- `reason = event_not_active`
- `inactive_reason`

Clients should treat `EVENT_NOT_ACTIVE` as stale terminal truth. `READY_GATE_NOT_READY` may still be retried briefly for replica/race recovery, but never indefinitely.

## Observability

Operator-visible markers include:

- Ready Gate transition observability through `record_event_loop_observability('ready_gate_transition', ...)`.
- `READY_GATE_EVENT_ENDED` when event-inactive cleanup terminalizes Ready Gates.
- `prepare_entry_event_inactive` when `video_date_transition('prepare_entry')` blocks stale handoff.
- `confirm_prepare_entry_event_inactive` when provider confirmation is blocked by event inactivity.
- Client events such as `ready_gate_both_ready_observed`, `prepare_date_entry_failed`, and ready-gate-to-date latency checkpoints.

Payloads must include IDs and machine codes only: `event_id`, `session_id`, `action`, status/reason codes, attempts, latency, trace IDs. Do not include sensitive profile/media payloads.

## Client Reads and Sync

Allowed client reads:

- own `event_registrations`
- active session lookup
- current `video_sessions` row by session id
- partner profile data through existing privacy/RLS-aware surfaces
- event/lobby state for display and recovery

Required sync behavior:

- call `ready_gate_transition('sync')` on open/hydration/reconnect
- subscribe to the session-id `video_sessions` row while mounted
- read own registration for queue/current room recovery
- keep polling/refetch fallback; Realtime is not the source of truth
- refetch on app foreground or deep-link entry
- reconcile queued promotion through own registration and active session lookup

## Forbidden Client Behavior

Clients must not directly write:

- `video_sessions.ready_gate_status`
- `video_sessions.ready_participant_1_at`
- `video_sessions.ready_participant_2_at`
- `video_sessions.ready_gate_expires_at`
- `video_sessions.snoozed_by`
- `video_sessions.snooze_expires_at`
- `video_sessions.state`
- `video_sessions.phase`
- `video_sessions.ended_at`
- `video_sessions.ended_reason`
- Ready Gate/date lifecycle-owned `event_registrations.queue_status`
- `event_registrations.current_room_id`
- `event_registrations.current_partner_id`

Clients must not:

- locally declare `both_ready` as date-entry success
- create or join Daily directly before backend prepare-entry truth
- maintain a native-only Ready Gate state machine
- emit notifications from client-local Ready Gate decisions

## Web Notes

- `ReadyGateOverlay` is the canonical web Ready Gate surface.
- `ReadyRedirect` is a deep-link reconciler and recovery route, not a divergent standalone state machine.
- Web calls `ready_gate_transition` for Ready/Skip/Snooze/Sync.
- Web date navigation from Ready Gate must go through `prepareVideoDateEntry` / `daily-room` `prepare_date_entry` or an already date-capable backend row.

## Native Notes

- Native may keep an in-lobby overlay and standalone `/ready/[id]` fallback.
- Both native surfaces use `ready_gate_transition` and the same session/registration truth.
- Native date navigation must go through `prepareVideoDateEntry` / `daily-room` `prepare_date_entry` or already date-capable backend truth.
- Native API types must tolerate additive fields: `reason`, `inactive_reason`, `error_code`, `code`, `terminal`, and `ready_gate_status`.

## Mixed-Client Test Matrix

- Web to web: both-ready, skip, snooze, expiry, refresh/reconnect.
- Native to native: overlay, standalone `/ready/[id]`, foreground/refetch, expiry.
- Web to native: one ready from each platform, one skip, event-end cleanup observed by both.
- Deep link: stale `/ready/:id` and `/ready/[id]` recover to lobby/events without direct state writes.
- Stale handoff: `both_ready` after event inactivity blocks prepare-entry and returns stale terminal truth.
- Daily: token/room issuance only after prepare-entry success or already date-capable backend truth.

## Release Notes

This documentation/client-contract stream requires no Supabase migration, no Edge Function deployment, and no environment variable changes unless a future PR explicitly changes those surfaces.
