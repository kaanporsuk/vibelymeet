# Event Lobby Observability Verification

Date: 2026-05-01
Branch: `fix/event-lobby-observability`
Supabase project ref: `schdyxcunwcvddlcshwd`

## Dependency Verification

Prompts 1-5 were present on `origin/main` before implementation:

- Active-event contract: `22d30191e`
- Swipe idempotency: `29943772f`
- Web EventLobby gating: `5a5a24de9`
- Ready Gate / queue contract: `4cac3caed`
- Deck payload / media contract: `162646923`
- Post-deploy generated types sync: `bfc9a1378`

## Remote Verification

- Local latest migration: `20260501230000_event_lobby_deck_payload_media.sql`
- Remote latest migration: `20260501230000`
- Remote migration parity: local and remote were in parity through `20260501230000`.
- `supabase db push --linked --dry-run`: remote database was up to date before changes.
- Linked project ref was read from `supabase/.temp/project-ref` and matched `schdyxcunwcvddlcshwd`.

No migration is added by this stream.

## Surfaces Audited

- Web analytics helper: `src/lib/analytics.ts`
- Native analytics helper: `apps/mobile/lib/analytics.ts`
- Event Lobby web route: `src/pages/EventLobby.tsx`
- Web swipe hook: `src/hooks/useSwipeAction.ts`
- Web queue hook: `src/hooks/useMatchQueue.ts`
- Web Ready Gate hook/overlay: `src/hooks/useReadyGate.ts`, `src/components/lobby/ReadyGateOverlay.tsx`
- Native lobby route: `apps/mobile/app/event/[eventId]/lobby.tsx`
- Native queue/deck/swipe API: `apps/mobile/lib/eventsApi.ts`
- Native Ready Gate hook/overlay: `apps/mobile/lib/readyGateApi.ts`, `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
- Edge Function: `supabase/functions/swipe-actions/index.ts`
- Existing backend observability migrations/tables:
  - `20260423120000_event_loop_observability.sql`
  - `20260501135000_video_date_observability_v1.sql`
  - `20260501225000_event_lobby_ready_queue_contract.sql`

## Findings

- Existing backend SQL already records queue/Ready Gate lifecycle rows through `event_loop_observability_events` and related helper functions.
- Web and native already emitted several legacy journey events, but event names were not normalized across deck-empty, swipe-result, queue-drain, and Ready Gate surfaces.
- `swipe-actions` already logged notification sends/suppression, but the structured logs did not consistently include the requested taxonomy event names or sanitized notification suppression reason fields.
- Web and native deck-empty states did not share a common safe reason taxonomy.

## Implementation Summary

- Added `shared/observability/eventLobbyObservability.ts` with canonical event names, deck-empty reason taxonomy, count bucketing, swipe-result payload builder, queue-drain payload builder, and reason-code sanitizer.
- Web now emits `lobby_deck_loaded`, `lobby_deck_empty`, `lobby_deck_error`, `lobby_swipe_submitted`, `lobby_swipe_result`, `lobby_swipe_duplicate_suppressed`, `queue_drain_attempted`, `queue_drain_result`, `ready_gate_shown`, `ready_gate_transition`, and `date_entered_from_lobby`.
- Native now emits matching taxonomy events from the lobby route, queue API, and Ready Gate overlay/hook.
- `swipe-actions` logs `lobby_swipe_result`, `lobby_swipe_duplicate_suppressed`, `notification_suppressed`, and `notification_sent` with sanitized reason fields and no raw actor/target identifiers in the JSON log line.
- Existing legacy journey events remain in place for dashboard compatibility.

## Risks

- Some analytics volume increases because queue drain and Ready Gate transition results are now normalized. Polling sync is not separately emitted to avoid excessive volume.
- Edge Function deployment is required after merge because `swipe-actions` source changed.
- No production data mutation is required or performed for validation.

## Rebuild Delta

- Shared contract helper added: `shared/observability/eventLobbyObservability.ts`
- Contract tests added: `shared/observability/eventLobbyObservability.test.ts`
- Hardening test pack updated: `scripts/run_hardening_contract_tests.sh`
- Docs added:
  - `docs/contracts/event-lobby-observability.md`
  - `docs/audits/event-lobby-observability-verification.md`
  - `docs/branch-deltas/fix-event-lobby-observability.md`
- Edge Function changed: `swipe-actions`
- Migrations added: none
- Deploy plan: after merge, verify linked project ref, run clean DB dry-run, deploy only `swipe-actions`, then inspect deployed function source/log taxonomy where possible.
