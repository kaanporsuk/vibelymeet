# Ready Gate Contract Consumer Compliance

Branch: `fix/ready-gate-contract-consumer-compliance`

## Problem

Streams 1-3 hardened the backend Ready Gate and Event Lobby contract. Stream 4 freezes that contract for web/native consumers so clients do not drift back into direct writes, optimistic handoff, or stale retry assumptions.

## Audit Note

Backend surfaces audited:

- `ready_gate_transition(uuid, text, text)`
- `video_date_transition(uuid, text, text)`
- `confirm_video_date_entry_prepared(uuid, text, text, text)`
- `terminalize_event_ready_gates(uuid, text)`
- `get_event_lobby_inactive_reason(uuid)`
- `is_event_lobby_active(uuid)`
- `daily-room` `prepare_date_entry`
- `mark_video_date_daily_joined`

Web surfaces audited:

- `src/components/lobby/ReadyGateOverlay.tsx`
- `src/hooks/useReadyGate.ts`
- `src/pages/EventLobby.tsx`
- `src/pages/ReadyRedirect.tsx`
- `src/lib/videoDatePrepareEntry.ts`
- `src/hooks/useMatchQueue.ts`
- `src/hooks/useActiveSession.ts`
- `src/hooks/useEventStatus.ts`
- `src/hooks/useVideoCall.ts`
- `src/pages/VideoDate.tsx`

Native surfaces audited:

- `apps/mobile/lib/readyGateApi.ts`
- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/app/ready/[id].tsx`
- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `apps/mobile/app/date/[id].tsx`
- `apps/mobile/lib/videoDateApi.ts`
- `apps/mobile/lib/videoDatePrepareEntry.ts`
- `apps/mobile/lib/videoDateEntryStartable.ts`
- `apps/mobile/lib/useActiveSession.ts`

## Contract Doc

Created:

- `docs/ready-gate-backend-contract.md`

Pointer updated:

- `_cursor_context/vibely_schema_appendix.md`

The doc freezes:

- canonical backend surfaces
- Ready Gate action vocabulary
- response fields and additive Stream 2/3 fields
- terminal and inactive reason vocabulary
- expiry-under-lock semantics
- event-ended terminalization semantics
- Daily prepare-entry handoff rule
- provider-prepared/date-capable fields
- observability markers
- web and native subscription/refetch expectations
- forbidden client writes and native-only state machines
- mixed-client test matrix

## Client Fixes

Small contract-compliance fixes only:

- Web `useReadyGate` response types now tolerate additive backend fields: `reason`, `inactive_reason`, `error_code`, `code`, and `terminal`.
- Native `readyGateApi` response types now tolerate the same additive backend fields.
- Shared Daily-room failure classification now recognizes additive `error_code = EVENT_NOT_ACTIVE` as non-retryable stale handoff truth.
- Web/native Ready Gate and date-entry copy now have safe fallback messages for `EVENT_NOT_ACTIVE`.

No direct client writes were added. Date navigation remains gated by `prepareVideoDateEntry` / provider-prepared backend truth.

## Tests Added

- `shared/matching/readyGateContractConsumerCompliance.test.ts`

Coverage:

- contract doc includes canonical surfaces, forbidden writes, and terminal/inactive vocabulary
- web/native Ready Gate consumers do not directly update forbidden `video_sessions` lifecycle fields
- web/native Ready Gate consumers do not directly update server-owned `event_registrations` lifecycle fields
- web/native date handoff paths reference backend prepare-entry
- Ready Gate API/types tolerate additive backend fields
- `EVENT_NOT_ACTIVE` prepare-entry blockers are classified as non-retryable
- Streams 1/2/3 migrations remain untouched

## Deploy Requirements

- Supabase migration deploy: not required
- Edge Function deploy: not required
- Environment variables: none

This stream made no SQL migration or Edge Function changes.

## Remaining Deferred Work

- Full web terminal copy polish beyond contract correctness
- Broader realtime subscription tightening
- Native full Ready Gate parity implementation
- Swipe retry/idempotency/dedupe
- Client observability polish
