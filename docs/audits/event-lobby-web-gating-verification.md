# Event Lobby Web Gating Verification

Date: 2026-05-01  
Branch: `fix/event-lobby-web-gating`  
Supabase project ref: `schdyxcunwcvddlcshwd`

## Dependency Verification

- Prompt 1 active-event contract is merged on `main` and deployed.
- Prompt 2 swipe idempotency contract is merged on `main` and deployed.
- Local/remote `main` before branching: `29943772f15fa3b589fa5a85a408a133a371e737`
- Remote latest migration before this stream: `20260501224000`
- Remote RPC markers confirmed:
  - `get_event_lobby_active_state(...)` active-event taxonomy deployed
  - `handle_swipe` returns `already_swiped`
  - `handle_swipe` returns `duplicate: true`

## Pre-Audit Summary

Inspected:

- `src/pages/EventLobby.tsx`
- `src/hooks/useEventDeck.ts`
- `src/hooks/useEventStatus.ts`
- `src/hooks/useMatchQueue.ts`
- native lobby gating in `apps/mobile/app/event/[eventId]/lobby.tsx`
- current hardening/static test pack

Before this patch, web `EventLobby` enabled `useEventDeck` with only route id, user id, and pause state. That allowed deck polling to start while event details, registration, local live window, or terminal event state were not yet valid. Missing events also fell through into the main lobby shell instead of rendering a clear not-found state.

## Implementation Summary

Added:

- `src/lib/eventLobbyGating.ts`

Patched:

- `src/pages/EventLobby.tsx`
- `src/hooks/useEventStatus.ts`
- `src/hooks/useMatchQueue.ts`

The web route now computes one local gate for:

- missing event id
- missing event row / stale direct link
- signed-out state
- not registered
- waitlisted / not confirmed
- scheduled / not started
- live
- ended by status or local end time
- cancelled
- archived
- draft
- paused account

The gate controls:

- deck query enablement
- swipe/action enablement
- lobby heartbeat/status writes
- match queue drain/realtime side effects
- stale Ready Gate opening from old client state
- explicit unavailable-state rendering
- ended-event modal display

Backend remains authoritative: SQL/RPC guards are unchanged and still reject invalid event states.

## Rebuild Delta

Public backend contract surfaces changed: none.

Client contract/route behavior changed:

- Web `/event/:eventId/lobby` renders explicit unavailable states instead of falling through on missing or invalid events.
- Web deck polling starts only when the authenticated user, confirmed registration, live event window, non-paused state, and route id are all valid.
- Web lobby status/queue side effects are disabled with the same gate.
- Web handles event end while mounted by disabling actions, stopping deck polling, clearing stale client-only Ready Gate state, and showing the ended modal.

Cloud deploy requirements:

- Supabase migration deploy: not required
- Edge Function deploy: not required
- Web hosting deploy: normal hosting/PR deployment only

## Validation Results

- `npx tsx shared/matching/webEventLobbyGating.test.ts` passed: 6 tests.
- `npm run test:hardening-contracts` passed, including the new web EventLobby gating assertions.
- `npm run lint` passed with the repo's existing warning backlog; no new `src/pages/EventLobby.tsx` warnings remain.
- `npm run typecheck` passed.
- `npm run build` passed with existing Vite chunk/dynamic import warnings.
- `git diff --check` passed via the hardening contract script.
- Supabase dry-run/deploy was not run because this stream did not change migrations or Edge Functions.

## Risks

- This is client gating only. If web local state is stale, backend RPCs remain the source of truth.
- The live condition intentionally mirrors the backend invariant by requiring `status = live` and local time inside the event window.
- No production data mutation or Supabase deploy is needed for this stream.
