# Event Lobby Native Contract Verification

Date: 2026-05-01
Branch: `docs/event-lobby-native-contract`
Supabase project ref: `schdyxcunwcvddlcshwd`

## Dependency Verification

Prompts 1-7 were present on `origin/main` before this branch was created:

| Prompt | Commit observed on `origin/main` |
|---|---|
| 1. Active-event contract | `22d30191e` |
| 2. Swipe idempotency and notification dedupe | `29943772f` |
| 3. Web EventLobby gating | `5a5a24de9` |
| 4. Busy-user, Ready Gate, and queue contract | `4cac3caed` |
| 5. Deck payload and media contract | `162646923` |
| 6. Event Lobby observability taxonomy | `e823f8caa` |
| 7. Event Lobby regression harness | `9f46806b0` |

Branch base:

- `main`: `9f46806b0e63b6af891278edce2154274c40553c`
- `origin/main`: `9f46806b0e63b6af891278edce2154274c40553c`

## Remote Verification

- Linked project ref was read from `supabase/.temp/project-ref` and matched `schdyxcunwcvddlcshwd`.
- Local latest migration before edits: `20260501230000_event_lobby_deck_payload_media.sql`
- Remote latest migration before edits: `20260501230000`
- Remote migration parity: local and remote matched through `20260501230000`.
- `supabase db push --linked --dry-run`: remote database was up to date before this docs stream.

No migration is added by this stream.

No Edge Function source is changed by this stream.

## Surfaces Audited

- `docs/contracts/event-lobby-ready-queue-contract.md`
- `docs/contracts/event-lobby-deck-payload-contract.md`
- `docs/contracts/event-lobby-observability.md`
- `docs/audits/event-lobby-active-event-contract-verification.md`
- `docs/audits/event-lobby-swipe-idempotency-verification.md`
- `docs/audits/event-lobby-regression-harness-verification.md`
- `apps/mobile/lib/eventsApi.ts`
- `apps/mobile/app/event/[eventId]/lobby.tsx`
- `apps/mobile/lib/readyGateApi.ts`
- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
- `supabase/functions/_shared/eventProfileAdapters.ts`
- `supabase/functions/_shared/matching/videoSessionFlow.ts`
- `shared/observability/eventLobbyObservability.ts`

## Findings

- The backend is the final owner of active-event eligibility, deck filtering, swipe mutation, queue promotion, Ready Gate transitions, and session creation.
- Native already calls the canonical Event Lobby surfaces: `get_event_deck`, `swipe-actions`, `drain_match_queue`, and `ready_gate_transition`.
- The final deck payload contract is viewer-safe and includes `primary_photo_path`, `photo_verified`, `premium_badge`, and `availability_state`.
- Busy users are hidden by the backend deck; direct stale swipes fail through active-session conflict or other non-mutating guards.
- Swipe retries are explicitly distinguishable through `already_swiped`, `swipe_already_recorded`, `duplicate`, `idempotent`, `replay`, and notification suppression metadata.
- Queue promotion and Ready Gate recovery are backend-owned and deduped by `video_session_id`.
- The observability taxonomy is shared across web, native, backend logs, and Edge Function logs without exposing private safety details.

## Implementation Summary

- Added `docs/contracts/event-lobby-native-contract.md` as the canonical native/backend Event Lobby contract.
- Updated active and native docs to point native implementation at the contract rather than web reverse-engineering.
- Updated the canonical project reference to reflect the current active-event deck behavior: inactive event deck calls raise `event_not_active`.
- Added this verification doc and a branch delta for rebuild traceability.

## Prompt 9 Native Deltas

Prompt 9 should use the new contract as its source of truth and verify:

- native unavailable, terminal, and empty states map to the approved deck empty taxonomy
- swipe outcome handling covers duplicate, inactive, conflict, paused, unavailable, blocked, and reported outcomes
- Super Vibe UI treats backend outcomes as authoritative
- Ready Gate overlay and `/ready/[id]` dedupe by `video_session_id`
- event-ending-in-lobby behavior stops deck polling and stale actions
- queue drain, mystery match, and foreground markers stay gated by active event, confirmed registration, focus, and pause state
- media fallback remains photo, then avatar, then placeholder with deck-card sizing
- native observability uses shared event names and sanitized properties

## Rebuild Delta

- New canonical doc: `docs/contracts/event-lobby-native-contract.md`
- New audit verification doc: `docs/audits/event-lobby-native-contract-verification.md`
- New branch delta: `docs/branch-deltas/docs-event-lobby-native-contract.md`
- Updated active doc map, canonical project reference, and native contract maps.
- Migrations added: none
- Edge Functions changed: none
- Provider/env changes: none
- Deploy plan: no Supabase deploy is required; after merge, confirm `main` is synced and run a clean linked DB dry-run.

## Validation Results

- `git diff --check`: passed.
- Referenced docs/path existence check: passed.
- `npm run test:event-lobby-regression`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with existing warnings only.
- `supabase db push --linked --dry-run`: remote database is up to date.

## Risks And Limits

- This stream intentionally does not implement Prompt 9 native UI changes.
- This stream does not prove device rendering, realtime timing, or provider delivery.
- The contract reflects current repository and deployed migration state as of 2026-05-01; future backend streams must update this doc when public outcomes or payloads change.
