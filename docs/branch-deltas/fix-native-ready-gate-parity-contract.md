# Native Ready Gate Parity Contract

Branch: `fix/native-ready-gate-parity-contract`

## Problem

Streams 1-5 made the Ready Gate backend authoritative and polished web recovery. Native still needed a focused parity pass so the in-lobby overlay, standalone `/ready/[id]` fallback, and Ready Gate to Daily handoff preserve backend terminal truth, avoid optimistic date navigation, and tolerate the additive response fields introduced by the backend hardening streams.

## Audit Note

Audited:

- `docs/ready-gate-backend-contract.md`
- `shared/matching/readyGateTerminalRecovery.ts`
- `apps/mobile/lib/readyGateApi.ts`
- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/app/ready/[id].tsx`
- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `apps/mobile/app/date/[id].tsx`
- `apps/mobile/lib/videoDateApi.ts`
- `apps/mobile/lib/videoDatePrepareEntry.ts`
- `apps/mobile/lib/videoDateEntryStartable.ts`
- `apps/mobile/lib/useActiveSession.ts`

No backend SQL, Edge Function, environment variable, provider configuration, native module, or `expo-av` change was required.

## Native Fixes

### Ready Gate API

- `apps/mobile/lib/readyGateApi.ts` now preserves `ended_reason` from `video_sessions` and backend RPC payloads.
- Additive backend fields remain available to native consumers:
  - `ready_gate_status`
  - `reason`
  - `inactive_reason`
  - `error_code`
  - `code`
  - `terminal`
- Terminal callbacks now receive a detail payload, so `ready_gate_status = expired` with `ended_reason = ready_gate_event_ended` is no longer treated as an ordinary timeout.
- `ready_gate_transition` unsuccessful payloads are parsed before refetch fallback, allowing terminal/event-inactive backend truth to close or recover the gate without client-owned writes.

### In-Lobby Overlay

- Reuses `shared/matching/readyGateTerminalRecovery.ts` for terminal/recovery classification.
- Preserves partner-forfeit vs timeout copy, and now distinguishes event-ended/cancelled/archived/inactive terminal truth.
- Treats event-inactive prepare-entry blockers as non-retryable stale handoff truth.
- Adds session-scoped duplicate navigation and duplicate terminal suppression latches.
- Adds app foreground sync using the existing React Native `AppState` model; no custom connectivity probes were added.
- Date navigation remains gated by `prepareVideoDateEntry` success or backend date-capable truth.

### Standalone `/ready/[id]`

- Keeps the route as a backend-contract deep-link fallback.
- Adds app foreground sync and canonical `ensureVideoDateStartableBeforeNavigation` reconciliation.
- Adds session-scoped date navigation and terminal recovery latches.
- Shows terminal recovery copy from the shared resolver before returning to the lobby/dashboard.
- Prevents event-inactive prepare-entry blockers from becoming retry loops.

### Date Handoff

- `apps/mobile/lib/videoDateEntryStartable.ts` now treats event-inactive prepare-entry failures as terminal handoff blockers instead of replica-lag `READY_GATE_NOT_READY` retries.
- Existing lobby/date route guards still route through `ensureVideoDateStartableBeforeNavigation`, `prepareVideoDateEntry`, and `navigateToDateSessionGuarded`.

## Observability

Native overlay now emits lightweight Ready Gate client events when existing analytics helpers are available:

- `native_ready_gate_transition_failure`
- `native_ready_gate_terminal`
- `native_ready_gate_prepare_entry_failure`
- `native_ready_gate_prepare_entry_event_inactive`
- `native_ready_gate_duplicate_nav_suppressed`
- `native_ready_gate_duplicate_terminal_suppressed`

Payloads are limited to safe operational context such as event ID, session ID, action/source, Ready Gate status, reason/error code/inactive reason, terminal boolean, attempt count, and latency.

## Tests Added

- `shared/matching/nativeReadyGateParityContract.test.ts`

Coverage:

- native Ready Gate API calls `ready_gate_transition`
- Ready/Skip/Snooze/Sync action vocabulary remains present
- additive backend fields and `ended_reason` are preserved
- partner-forfeit, timeout, event-ended/cancelled/archived, and inactive reasons map through shared recovery logic
- `EVENT_NOT_ACTIVE` prepare-entry blockers are non-retryable
- overlay and standalone route use session-scoped latches
- date navigation is gated by backend prepare-entry/startable truth
- no direct native writes to Ready Gate-owned `video_sessions` or `event_registrations` fields
- no `expo-av` import/require in Ready Gate parity surfaces
- Streams 1-5 artifacts remain present

## Deploy Requirements

- Supabase migration deploy: not required
- Edge Function deploy: not required
- Environment variables: none
- Native modules: none
- Docker/local Supabase: not used
- EAS cloud build: not required

## Runtime QA Notes

Source, typecheck, and build validation should cover the contract surface in CI. A physical-device/manual smoke remains useful before a mobile release:

- web ↔ native Ready Gate
- native ↔ native Ready Gate
- standalone `/ready/[id]` deep link
- event-ended terminal recovery
- stale `both_ready` prepare-entry blocker
- duplicate both-ready/realtime/focus signals

## Remaining Deferred Work

- Full native video-date polish beyond Ready Gate handoff
- Broader realtime subscription tightening
- Swipe retry/idempotency/dedupe
- Premium/credits observability
- Broader screenshot-led native visual parity polish
