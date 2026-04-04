# Native v1 Sprint 2 Events Core Closure Report

Date: 2026-04-04
Status: Closed (ready for packaging)
Scope: Events details parity, lobby production pass, Ready Gate production pass, contract audit gate

## Summary
Sprint 2 scope is now closed at implementation level without native builds and without backend/public contract changes.

Completed this pass:
- Event details parity hardening for registration-truth loading states
- Lobby production hardening for registration guard loading and queued-match UX refresh
- Ready Gate production hardening for canonical exit behavior and timeout race protection
- Contract audit gate with positive/negative proof

Already landed before this closure pass:
- Standalone Ready Gate timing/fallback hardening
- Lobby Ready Gate race protection
- Events list parity: keep registered events visible
- Initial contract audit pass

## A. Event Details Parity Completion
Audit target: mobile event details vs web event details truth contracts.

Implemented fixes:
- Registration truth loading guard added so authenticated users do not briefly see non-admitted CTAs before `event-registration-check` resolves.
  - File: `apps/mobile/app/(tabs)/events/[id].tsx`

Parity checks verified:
- Confirmed/waitlisted/canceled truth messages and CTAs are preserved.
- Paid-event settlement truth is handled by `event-payment-success` with registration polling and event status truth messaging.
- Registration/unregister UX remains server-owned via registration RPCs.
- Loading/error/empty states are present and now avoid registration-state flicker.

## B. Event Lobby Production Pass Completion
Audit target:
- entry guards
- deck fetch/render behavior
- repeat-card protection
- empty-state truth
- swipe outcome handling
- queued match UX
- pending session behavior
- transition into Ready Gate

Implemented fixes:
- Added registration snapshot loading guard to prevent false early `Register first`/waitlist guard states.
  - File: `apps/mobile/app/event/[eventId]/lobby.tsx`
- On `match_queued`, refresh queue count immediately for truthful queued badge UX (without waiting for async realtime/poll).
  - File: `apps/mobile/app/event/[eventId]/lobby.tsx`

Parity verified:
- Entry guards enforce live event + confirmed seat.
- Deck fetch remains canonical via `get_event_deck`.
- Repeat-card protection remains via seen-profile set + deck nonce.
- Empty-state truth remains: no cards vs waiting/mystery-match states.
- Swipe outcomes use canonical `swipe-actions` envelope parsing and guarded deck advancement.
- Pending session and pending match query params route into Ready Gate.
- Transition into Ready Gate remains via queue drain + realtime + direct match.

## C. Ready Gate Production Pass Completion
Audit target:
- standalone route transition matrix
- both_ready / forfeit / expired / snooze handling
- return-path CTA correctness
- polling/realtime interplay
- terminal-state messaging

Implemented fixes:
- Standalone Ready Gate header back now routes through canonical step-away flow (forfeit path), preventing silent bypass.
  - File: `apps/mobile/app/ready/[id].tsx`
- Timeout race protections and terminal dedupe hardening were preserved from earlier Sprint 2 work in standalone and lobby overlay.
  - Files:
    - `apps/mobile/app/ready/[id].tsx`
    - `apps/mobile/components/lobby/ReadyGateOverlay.tsx`

Parity verified:
- `both_ready` transitions to date flow.
- `forfeit`/`expired` return paths use event-context-first fallback behavior.
- Snooze handling and countdown interplay preserve server-owned state.
- Realtime + polling fallback remains in `useReadyGate`.

## D. Contract Audit Gate (Final)
Active-path audit results:

1) No direct queue/date/match lifecycle writes reintroduced
- Negative scan: no `.update` writes to `event_registrations.queue_status`, `event_registrations.current_room_id`, or `video_sessions` lifecycle columns in active events path.

2) No deprecated queue-era RPCs used in native active events path
- Negative scan: no `join_match_queue`, `leave_match_queue`, `get_match_queue`, or legacy queue transitions in mobile active events path.

3) Positive proof of canonical contracts in use
- `get_event_deck` present
- `swipe-actions` present
- `drain_match_queue` present
- `update_participant_status` present
- `mark_lobby_foreground` present
- `ready_gate_transition` present

## Files Changed During Sprint 2 (runtime)
- `apps/mobile/app/(tabs)/events/index.tsx`
- `apps/mobile/app/(tabs)/events/[id].tsx`
- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `apps/mobile/app/ready/[id].tsx`
- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`

## Backend/Public Surface Changes
- None.
- No backend schema, RPC signature, or public contract changes were introduced.

## Build/Packaging Status
- No native build run (as required).
- Sprint 2 implementation is at closure point and ready to package.
