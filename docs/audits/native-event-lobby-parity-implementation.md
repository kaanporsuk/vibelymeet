# Native Event Lobby Parity Implementation

Date: 2026-05-01
Branch: `fix/native-event-lobby-parity`
Supabase project ref: `schdyxcunwcvddlcshwd`

2026-06-09 supersession: this implementation report predates Mystery Match removal. The native `useMysteryMatch` hook listed below was later deleted, and `find_mystery_match` is no longer a backend contract.

## Dependency Verification

- Prompt 8 merged on `origin/main`: `be124392c docs: define native event lobby contract`
- Native contract read: `docs/contracts/event-lobby-native-contract.md`
- Event Lobby status/audit docs inspected through the active doc map.
- No backend artifacts were changed in this stream.

## Pre-Audit Summary

Inspected:

- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `apps/mobile/lib/eventsApi.ts`
- `apps/mobile/lib/readyGateApi.ts`
- `apps/mobile/lib/useMysteryMatch.ts` (historical; deleted by Mystery Match removal on 2026-06-09)
- `apps/mobile/lib/useActiveSession.ts`
- `apps/mobile/lib/imageUrl.ts`
- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/components/NotificationDeepLinkHandler.tsx`
- `src/pages/EventLobby.tsx`
- `src/hooks/useEventDeck.ts`
- `src/hooks/useSwipeAction.ts`
- `shared/observability/eventLobbyObservability.ts`
- `supabase/functions/_shared/eventProfileAdapters.ts`
- `supabase/functions/_shared/matching/videoSessionFlow.ts`

Findings:

- Native already blocked missing, not-confirmed, cancelled, draft, archived, ended, paused, and locally not-live states before deck fetching.
- Native already consumed the safe deck payload, `deckCardUrl`, Ready Gate transitions, queue drain, and observability taxonomy.
- Swipe failure envelopes with `success: false` still showed a generic toast instead of using the finalized outcome taxonomy.
- Deck RPC `event_not_active` errors were classified as `rpc_error`, which made stale direct-link diagnostics less precise.
- Candidate `availability_state` was parsed but not used to disable future non-available cards if the backend ever returns them.

## Implementation Summary

- Native now normalizes swipe envelopes from `outcome`, `result`, or `error` before telemetry, Ready Gate routing, toast handling, duplicate suppression, and deck advancement.
- Backend `event_not_active` from deck fetch or swipe failure now moves native into a terminal lobby-closed state and invalidates event details for fresh truth.
- Swipe toasts now cover the finalized backend taxonomy, including duplicate, paused, registration, unavailable, and stale-event outcomes.
- Native action buttons are disabled when the current deck card reports a non-`available` `availability_state`; direct backend attempts remain protected by the backend.
- Deck-empty diagnostics now classify explicit `event_not_active` RPC errors as `event_not_active`.
- Event Lobby regression harness now includes native parity assertions.

## Rebuild Delta

- Native route changed: `apps/mobile/app/event/[eventId]/lobby.tsx`
- Shared observability helper changed: `shared/observability/eventLobbyObservability.ts`
- Regression harness changed: `scripts/run_event_lobby_regression.sh`
- New tests: `shared/matching/nativeEventLobbyContractParity.test.ts`
- Docs changed: this audit, branch delta, native contract status, active doc map
- No schema changes
- No migrations added
- No RPC return-shape changes
- No Edge Function changes
- No provider or environment variable changes
- No Supabase deploy required

## Validation Results

- `npx tsx shared/matching/nativeEventLobbyContractParity.test.ts` - pass
- `npx tsx shared/observability/eventLobbyObservability.test.ts` - pass
- `npm run test:event-lobby-regression` - pass
- `npm run typecheck` - pass
- `npm run lint` - pass with existing warnings, no errors
- `npm run build` - pass with existing Vite chunk/dynamic-import warnings

## Risks And Follow-Ups

- Full device proof still belongs to the staging smoke runbook because the automated harness intentionally avoids production data mutation.
- Native app-store/TestFlight rollout is out of scope for this stream.
