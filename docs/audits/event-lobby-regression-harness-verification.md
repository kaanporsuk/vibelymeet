# Event Lobby Regression Harness Verification

Date: 2026-05-01
Branch: `test/event-lobby-regression-harness`
Supabase project ref: `schdyxcunwcvddlcshwd`

## Dependency Verification

Prompts 1-6 were present on `origin/main` before implementation:

- Active-event contract: `22d30191e`
- Swipe idempotency: `29943772f`
- Web EventLobby gating: `5a5a24de9`
- Ready Gate / queue contract: `4cac3caed`
- Deck payload / media contract: `162646923`
- Observability taxonomy: `e823f8caa`

## Remote Verification

- Local latest migration: `20260501230000_event_lobby_deck_payload_media.sql`
- Remote latest migration: `20260501230000`
- Remote migration parity: local and remote were in parity through `20260501230000`.
- `supabase db push --linked --dry-run`: remote database was up to date before changes.
- Linked project ref was read from `supabase/.temp/project-ref` and matched `schdyxcunwcvddlcshwd`.
- Deployed functions inspected: `daily-room`, `send-notification`, and `swipe-actions`.
- `swipe-actions` was active in the linked project after the observability stream deployment.

No migration is added by this stream.

No Edge Function source is changed by this stream.

## Test Infrastructure Audited

- `scripts/run_hardening_contract_tests.sh`
- `scripts/run_golden_path_smoke.sh`
- `shared/matching/eventLobbyActiveEventContract.test.ts`
- `shared/matching/eventLobbyCanonicalActiveState.test.ts`
- `shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts`
- `shared/matching/webEventLobbyGating.test.ts`
- `shared/matching/eventLobbyReadyQueueContract.test.ts`
- `shared/matching/eventLobbyDeckPayloadMedia.test.ts`
- `shared/observability/eventLobbyObservability.test.ts`
- `supabase/functions/_shared/matching/videoSessionFlow.test.ts`
- `shared/matching/videoDateEndToEndHardening.test.ts`

## Findings

- The previous streams already added strong source/static tests for active-event enforcement, duplicate swipe semantics, web gating, busy-user policy, deck payload safety, and observability.
- A single Event Lobby-specific entrypoint did not exist, so operators had to know which individual files and broad hardening script to run.
- Full two-user and three-user runtime proof still requires safe staging fixtures because automating it would otherwise require live data mutation and secrets outside repo scope.
- The existing golden-path runbook covered broader Video Date launch checks, but not the Event Lobby-specific stale direct-call, queue, block/report, and empty-deck diagnostic matrix.

## Implementation Summary

- Added `scripts/run_event_lobby_regression.sh` as the focused Event Lobby regression command.
- Added `shared/matching/eventLobbyRegressionHarness.test.ts` to assert the harness stays safe, complete, documented, and wired into the current doc map.
- Added `docs/golden-path-event-lobby-regression-runbook.md` for manual staging smoke flows that are unsafe to automate against production.
- Added this verification doc and a branch delta for rebuild/audit traceability.
- Added `npm run test:event-lobby-regression` as a stable package entrypoint.

## Coverage Map

| Target | Automated coverage |
|---|---|
| active-event helper states | `eventLobbyCanonicalActiveState.test.ts`, `eventLobbyActiveEventContract.test.ts` |
| deck rejects inactive events | `eventLobbyActiveEventContract.test.ts` |
| swipe rejects inactive events with no state mutation | `eventLobbyActiveEventContract.test.ts` |
| mystery match rejects inactive events | `eventLobbyActiveEventContract.test.ts` |
| queue promotion rejects inactive events | `eventLobbyActiveEventContract.test.ts`, `eventLobbyReadyQueueContract.test.ts` |
| block/report/suspended/paused/deleted exclusions | `eventLobbyRegressionHarness.test.ts` verifies current migration/test markers; runbook covers staging proof |
| simultaneous mutual swipes create one session | `swipeRetryIdempotencyNotificationDedupe.test.ts`, `eventLobbyReadyQueueContract.test.ts` |
| duplicate swipes create one row and suppress duplicate notifications | `swipeRetryIdempotencyNotificationDedupe.test.ts` |
| Super Vibe per-event limit and retry behavior | `swipeRetryIdempotencyNotificationDedupe.test.ts`, `videoDateEndToEndHardening.test.ts` |
| active-session collision during queue promotion | `eventLobbyReadyQueueContract.test.ts` |
| `swipe-actions` duplicate/inactive normalization | `swipeRetryIdempotencyNotificationDedupe.test.ts`, `eventLobbyObservability.test.ts` |
| web missing/ended/invalid-registration gating | `webEventLobbyGating.test.ts` |
| empty deck reason mapping | `eventLobbyObservability.test.ts` |
| Ready Gate open dedupe by session id | `webEventLobbyGating.test.ts` |
| native deck/swipe parsing | `eventLobbyDeckPayloadMedia.test.ts`, `videoSessionFlow.test.ts` |

## Risks And Limits

- The harness is intentionally source/static plus local-test based. It does not prove provider delivery, realtime timing, or browser/device rendering by itself.
- Manual staging smoke requires external fixture discipline. The script refuses production smoke metadata by default, but humans still need to enforce fixture safety.
- No live Supabase data mutation is performed by this stream.

## Rebuild Delta

- Script added: `scripts/run_event_lobby_regression.sh`
- Test added: `shared/matching/eventLobbyRegressionHarness.test.ts`
- Package script added: `test:event-lobby-regression`
- Runbook added: `docs/golden-path-event-lobby-regression-runbook.md`
- Verification doc added: `docs/audits/event-lobby-regression-harness-verification.md`
- Branch delta added: `docs/branch-deltas/test-event-lobby-regression-harness.md`
- Active doc map updated with the Event Lobby regression harness entry.
- Migrations added: none
- Edge Functions changed: none
- Deploy plan: no Supabase deploy is required; after merge, confirm `main` is synced and run a clean linked DB dry-run.
