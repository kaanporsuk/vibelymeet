# Native Event Lobby parity implementation

Branch: `fix/native-event-lobby-parity`
Date: 2026-05-01

## Problem

Prompt 8 defined the canonical Event Lobby backend/native contract, but native still needed final parity hardening for stale backend outcomes, duplicate/idempotent swipe envelopes, future availability payloads, and implementation-status docs.

## Implementation

- Normalized native swipe handling around backend `outcome/result/error` fields.
- Routed inactive-event swipe and deck failures to a terminal lobby-closed state.
- Expanded native outcome handling for duplicate, paused, unavailable, registration, and stale-event outcomes.
- Disabled native swipe controls for non-available candidate payloads while leaving backend conflict checks authoritative.
- Added native parity assertions to the Event Lobby regression harness.
- Classified explicit `event_not_active` deck RPC errors under the safe `event_not_active` empty-state reason.

## Files Changed

- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `shared/observability/eventLobbyObservability.ts`
- `shared/observability/eventLobbyObservability.test.ts`
- `shared/matching/nativeEventLobbyContractParity.test.ts`
- `scripts/run_event_lobby_regression.sh`
- `docs/contracts/event-lobby-native-contract.md`
- `docs/audits/native-event-lobby-parity-implementation.md`
- `docs/active-doc-map.md`

## Cloud Artifacts

- Migrations added: none
- Edge Functions changed: none
- Supabase deploy required: no
- Provider/env changes: none

## Rollback

Revert the branch commit. No remote database, Edge Function, or provider rollback is required because this stream changes only native/shared client code, tests, docs, and the local harness.

## Out Of Scope

- Backend contract changes
- Web EventLobby behavior changes
- Native app-store/TestFlight rollout
- Production smoke tests without approved safe fixtures
