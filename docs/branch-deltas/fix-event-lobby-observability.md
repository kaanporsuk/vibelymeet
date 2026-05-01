# Branch Delta: `fix/event-lobby-observability`

Date: 2026-05-01
PR title: `Add Event Lobby observability taxonomy`

## Problem

Event Lobby deck, swipe, queue, Ready Gate, notification, and date-entry diagnostics existed across several local events and backend logs, but operators could not consistently answer why a deck was empty, whether a swipe notification was suppressed, or how queue/Ready Gate outcomes resolved across web/native/Edge.

## Pre-audit Summary

- Prompt 1-5 dependency commits were present on `origin/main`.
- Supabase linked ref verified as `schdyxcunwcvddlcshwd`.
- Local and remote migrations were in parity through `20260501230000`.
- `supabase db push --linked --dry-run` reported the remote database was up to date before implementation.
- Existing backend observability tables/functions already covered several queue and Ready Gate lifecycle rows.

## Implementation Summary

- Added one shared taxonomy helper for web and native.
- Added normalized deck load/empty/error events and safe deck-empty reasons.
- Added normalized swipe submitted/result/duplicate-suppressed events.
- Added normalized queue drain attempted/result events.
- Added normalized Ready Gate shown/transition events.
- Added date-entry-from-lobby events after date navigation is backend-verified.
- Updated `swipe-actions` structured logs for notification sent/suppressed and duplicate swipe suppression.

## Files / Functions Changed

- `shared/observability/eventLobbyObservability.ts`
- `shared/observability/eventLobbyObservability.test.ts`
- `src/pages/EventLobby.tsx`
- `src/hooks/useSwipeAction.ts`
- `src/hooks/useMatchQueue.ts`
- `src/hooks/useReadyGate.ts`
- `src/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `apps/mobile/lib/eventsApi.ts`
- `apps/mobile/lib/readyGateApi.ts`
- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
- `supabase/functions/swipe-actions/index.ts`
- `scripts/run_hardening_contract_tests.sh`
- `docs/contracts/event-lobby-observability.md`
- `docs/audits/event-lobby-observability-verification.md`
- `docs/analytics-lobby-to-post-date-journey.md`
- `docs/active-doc-map.md`

## Migrations Added

None.

## Edge Functions changed/deployed

- Changed: `swipe-actions`
- Deploy after merge: deploy only `swipe-actions`.

## Validation Plan

- `npx tsx shared/observability/eventLobbyObservability.test.ts`
- `npm run test:hardening-contracts`
- `npm run typecheck`
- `npm run build`
- `npm run lint`
- `supabase db push --linked --dry-run`
- Edge Function dry-run/equivalent check if supported by the installed Supabase CLI.

## Deploy Plan

1. Merge PR to protected `main` if checks and permissions allow.
2. Checkout/pull `main`.
3. Reconfirm linked Supabase project ref is `schdyxcunwcvddlcshwd`.
4. Run `supabase db push --linked --dry-run`; no DB changes should be pending.
5. Deploy only `swipe-actions`.
6. Inspect deployed function source/config/loggable taxonomy where possible.

## Rollback Plan

- Revert the merge commit for client/shared/Edge source changes.
- Redeploy the previous `swipe-actions` source from `main` if Edge deployment needs rollback.
- No DB rollback is required because this stream adds no migration.

## Rebuild Delta

- Web/native public analytics contract changed by adding new event names and properties.
- Edge Function structured log contract changed by adding taxonomy `event_name`, outcome, reason, duplicate, session-presence, and notification suppression fields.
- No schema/RPC return shape/env/provider changes.

## Out Of Scope

- Admin dashboard redesign.
- New observability storage tables.
- Any user-visible exposure of block/report/moderation details.
- Swipe behavior, queue behavior, Ready Gate UX, or deck payload redesign.
