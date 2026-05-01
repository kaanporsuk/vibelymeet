# Branch Delta: Event Lobby Ready Queue Contract

Branch: `fix/event-lobby-ready-queue-contract`
Date: 2026-05-01

## Problem

The Event Lobby backend active-event and swipe retry contracts were in place, but busy/in-session candidate handling was not explicit enough. A user already in Ready Gate, handshake, or date could still be returned as a normal deck card, and direct swipes could reach delegated mutation paths before active-session conflicts were rejected.

## Implementation Summary

- Added migration `20260501225000_event_lobby_ready_queue_contract.sql`.
- Updated `get_event_deck` to preserve auth and active-event rejection while hiding non-`browsing`/`idle` candidates and stale active Ready Gate/handshake/date session truth.
- Updated `handle_swipe` to acquire ordered participant locks and return `participant_has_active_session_conflict` before `event_swipes`, session creation, registration pointer updates, or notification-worthy outcomes.
- Updated `promote_ready_gate_if_eligible` to use the same ordered participant lock contract and reject queued promotion when either participant has another unended session.
- Documented the Ready Gate / queued-match state machine and web/native expectations.
- Added read-only production validation SQL and static regression coverage.

## Files Changed

- `supabase/migrations/20260501225000_event_lobby_ready_queue_contract.sql`
- `supabase/validation/event_lobby_ready_queue_contract.sql`
- `shared/matching/eventLobbyReadyQueueContract.test.ts`
- `scripts/run_hardening_contract_tests.sh`
- `docs/contracts/event-lobby-ready-queue-contract.md`
- `docs/audits/event-lobby-ready-queue-contract-verification.md`
- `docs/branch-deltas/fix-event-lobby-ready-queue-contract.md`
- `docs/active-doc-map.md`

## Migrations

Added:

- `20260501225000_event_lobby_ready_queue_contract.sql`

No destructive data changes. No historical migrations edited.

## Edge Functions

None changed.

## Rebuild Delta

Backend contract delta only:

- Deck cards now represent normal lobby candidates only; busy users are hidden backend-side.
- Direct swipe active-session conflicts now return before stale swipe state can be persisted.
- Queue promotion now has an explicit participant-lock and conflict gate before promotion.

No client route, environment, provider, or Edge Function deployment required.

## Rollback Plan

If rollback is required, add a forward migration restoring the previous public wrapper definitions for `get_event_deck`, `handle_swipe`, and `promote_ready_gate_if_eligible` from the prior canonical migrations. Do not edit applied historical migrations.

## Out Of Scope

- No Ready Gate UX redesign.
- No removal of queued-match functionality.
- No Super Vibe monetization changes.
- No Edge Function notification semantics changes.
- No production data cleanup or destructive uniqueness migration.
