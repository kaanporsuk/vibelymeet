# Ready Gate Terminal UX and Observability

Branch: `fix/ready-gate-terminal-ux-observability`

## Problem

Streams 1-4 made the backend Ready Gate contract authoritative and documented it for web/native consumers. Stream 5 polishes the client recovery layer so backend-owned terminal truth is reflected clearly, duplicate side effects are session-latched, and failed handoffs are observable without adding new backend behavior.

## Audit Note

Audited:

- `docs/ready-gate-backend-contract.md`
- `docs/branch-deltas/fix-ready-gate-contract-consumer-compliance.md`
- `docs/branch-deltas/fix-ready-gate-event-ended-terminalization.md`
- `src/components/lobby/ReadyGateOverlay.tsx`
- `src/hooks/useReadyGate.ts`
- `src/lib/videoDatePrepareEntry.ts`
- `src/hooks/useMatchQueue.ts`
- `src/hooks/useActiveSession.ts`
- `src/pages/EventLobby.tsx`
- `src/pages/ReadyRedirect.tsx`
- `apps/mobile/lib/readyGateApi.ts`
- existing analytics and Sentry helpers

No backend migration, Edge Function, provider config, or environment variable change was required.

## Client Fixes

Added shared terminal/recovery mapping:

- `shared/matching/readyGateTerminalRecovery.ts`

The mapping distinguishes:

- partner forfeited
- Ready Gate expired
- event ended
- event cancelled
- event archived
- event inactive
- stale handoff
- unauthorized access
- stale/conflict
- generic retryable error

Web Ready Gate updates:

- Partner forfeit is no longer displayed as a timeout.
- `EVENT_NOT_ACTIVE` and event-inactive prepare-entry blockers are treated as non-retryable stale handoff truth.
- Duplicate date navigation and terminal toast/recovery side effects are session-scoped and observable.
- Ready Gate transition failures, terminal outcomes, prepare-entry failures, event-inactive blockers, and duplicate suppression emit structured analytics.
- Sentry breadcrumbs are added for date navigation, duplicate suppression, and event-inactive prepare-entry blockers.
- The overlay now has dialog semantics, labelled heading/description, restrained `aria-live` status regions, button labels/busy states, focus safety, and reduced-motion handling for looping animation.

Native updates:

- Existing native Ready Gate hook now preserves the terminal distinction between `forfeited` (`skip`) and `expired` (`timeout`).
- No native screen or parity implementation was started.

## Observability Events

Added canonical client event names:

- `ready_gate_client_transition_failure`
- `ready_gate_client_terminal`
- `ready_gate_client_prepare_entry_failure`
- `ready_gate_client_prepare_entry_event_inactive`
- `ready_gate_client_duplicate_nav_suppressed`
- `ready_gate_client_duplicate_terminal_suppressed`

Payloads are limited to safe operational context such as event ID, session ID, action, source surface/action, Ready Gate status, reason/error code/inactive reason, terminal boolean, attempt count, and latency.

## Tests Added

- `shared/matching/readyGateTerminalUxObservability.test.ts`

Coverage:

- terminal mapping distinguishes partner forfeit from timeout
- event-ended/cancelled/archived/inactive reason mapping
- `EVENT_NOT_ACTIVE` prepare-entry blockers are non-retryable
- web date navigation remains gated by `prepareVideoDateEntry`
- no forbidden direct writes to Ready Gate-owned web lifecycle fields
- duplicate navigation/terminal latches are present
- client observability events are wired
- Ready Gate overlay accessibility markers are present
- native terminal distinction remains backend-contract compatible
- Streams 1-4 artifacts remain present

## Deploy Requirements

- Supabase migration deploy: not required
- Edge Function deploy: not required
- Environment variables: none
- Docker/local Supabase: not used

## Remaining Deferred Work

- Full native Ready Gate parity implementation
- Broader realtime subscription tightening
- Swipe retry/idempotency/dedupe
- Premium/credits observability
- Broader web visual polish beyond terminal/recovery correctness
