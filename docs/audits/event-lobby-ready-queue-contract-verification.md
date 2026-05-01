# Event Lobby Ready Queue Contract Verification

Date: 2026-05-01
Branch: `fix/event-lobby-ready-queue-contract`

## Remote Verification

- Supabase project ref: `schdyxcunwcvddlcshwd`
- Local latest migration before patch: `20260501224000_event_lobby_swipe_already_swiped.sql`
- Remote latest migration before patch: `20260501224000`
- Remote migration parity: local and remote were in parity through `20260501224000`
- Dry run before patch: `supabase db push --linked --dry-run` reported the remote database was up to date

Dependency status:

- Prompt 1 active-event contract: merged on `main` in `22d30191e`
- Prompt 2 swipe idempotency/notification dedupe: merged on `main` in `29943772f`
- Prompt 3 web EventLobby gating: merged on `main` in `5a5a24de9`

Remote definition spot-check before patch:

| Surface | Uses active helper | Busy deck filter | Public conflict marker | Notes |
|---|---:|---:|---:|---|
| `get_event_deck` | Yes | No | No | Active-event guard was present, but busy registration/session states could still be returned by the delegated deck. |
| `handle_swipe` | Yes | N/A | No | Retry idempotency existed. Active-session conflict was still only in the delegated mutual path after swipe insertion. |
| `promote_ready_gate_if_eligible` | Yes | N/A | No | Active-event guard existed. The delegated base had conflict checks, but the public wrapper did not expose the current invariant. |
| `drain_match_queue` | Yes | N/A | No | Active-event guard existed and delegated to queue promotion. |

## Pre-Audit Findings

`get_event_deck` preserved auth and active-event checks, then delegated to `get_event_deck_20260501180000_active_base`. The delegated deck returned `event_registrations.queue_status` and did not hide `in_ready_gate`, `in_handshake`, `in_date`, `in_survey`, `offline`, or stale active session truth.

Web and native already had defensive `queue_status` badges, but those badges were informational. A busy candidate could still be presented as a normal swipe target if returned by the backend deck.

`handle_swipe` returned explicit duplicate outcomes from the idempotency wrapper, but its active-session conflict check remained in the deeper mutual-match path after `event_swipes` insertion. A direct swipe against a busy target could therefore persist stale swipe state before returning a conflict.

`promote_ready_gate_if_eligible` and `drain_match_queue` already rejected inactive events. The older promotion base also checked conflicts, but the current public contract did not lock participants before promotion delegation.

Legacy direct session creation surfaces (`find_video_date_match`, `join_matching_queue`) remain deprecated and non-inserting per the active-event verification tests. `ready_gate_transition` already has event-ended terminalization guards and is not redesigned by this stream.

## Patch Plan

Add migration `20260501225000_event_lobby_ready_queue_contract.sql`:

- Keep `get_event_deck` signature, `SECURITY DEFINER`, `search_path`, grants, auth check, and active-event rejection.
- Filter backend deck candidates to `queue_status` `browsing`/`idle` only.
- Also hide candidates with unended Ready Gate/handshake/date session truth (`ready`, `ready_a`, `ready_b`, `both_ready`, `snoozed`, handshake/date state or phase, handshake/date timestamps).
- Keep `handle_swipe` signature and retry outcomes, but add ordered participant advisory locks plus active-session conflict return before `event_swipes` lookup/delegated mutation.
- Keep first-time successful outcomes delegated to the canonical mutation base.
- Keep `promote_ready_gate_if_eligible` active-event guard, add ordered participant locks and pre-promotion conflict check before delegation.
- Keep `drain_match_queue` delegated through public promotion, with comment updated to make the route explicit.

## Surface Status After Patch

| Surface | Inactive events | Busy / active session policy |
|---|---|---|
| `get_event_deck` | Raises `event_not_active` | Hides non-idle/browsing statuses and active Ready Gate/handshake/date session truth |
| `handle_swipe` | Returns `event_not_active` before mutation | Returns `participant_has_active_session_conflict` before swipe/session/registration mutation |
| `find_mystery_match` | Already guarded by Prompt 1 | Not changed in this stream |
| `promote_ready_gate_if_eligible` | Returns `event_not_valid` with inactive reason | Locks queued pair and blocks if either participant has another unended session |
| `drain_match_queue` | Returns `event_not_valid` with inactive reason | Delegates promotion through the public promotion guard |
| `ready_gate_transition` | Already terminalizes event-ended sessions | Not redesigned; date entry remains backend truth driven |
| `find_video_date_match` / `join_matching_queue` | Deprecated direct session surfaces | Documented out of scope because existing migrations remove session insertion bypasses |

## Risks

- Backend hiding is stricter than client-only disable: users in `in_survey`, `offline`, unknown, or stale active states will not appear as normal swipe cards. This matches the safe launch default and keeps queue promotion backend-owned.
- The migration adds advisory locks on participant pairs for direct swipe and queued promotion. This can serialize a small amount of high-contention lobby work, but avoids cross-pair session races.
- No unique partial index was added because production duplicate cleanup would be data-affecting and could fail if historical data contains duplicates. This stream proves the invariant at the RPC contract layer.

## Validation Plan

- Static contract test: `npx tsx shared/matching/eventLobbyReadyQueueContract.test.ts`
- Hardening pack: `./scripts/run_hardening_contract_tests.sh`
- Type/build/lint commands available for touched surfaces
- Migration dry run: `supabase db push --linked --dry-run`
- Read-only post-deploy SQL: `supabase/validation/event_lobby_ready_queue_contract.sql`

## Validation Results

- `npx tsx shared/matching/eventLobbyReadyQueueContract.test.ts` passed.
- `npm run test:hardening-contracts` passed.
- `npm run typecheck:core` passed.
- `npm run typecheck` passed.
- `npm run build` passed with existing Vite chunk/dynamic-import warnings only.
- `npm run lint` completed with zero errors and the existing repo warning backlog.
- `supabase db push --linked --dry-run` on project `schdyxcunwcvddlcshwd` reported it would push only `20260501225000_event_lobby_ready_queue_contract.sql`.

## Rebuild Delta

Changed backend contract surfaces:

- `get_event_deck(uuid, uuid, integer)` now hides busy/non-swipeable event lobby candidates instead of returning them as normal cards.
- `handle_swipe(uuid, uuid, uuid, text)` can now return `participant_has_active_session_conflict` before persisting swipe state when either participant has another unended session.
- `promote_ready_gate_if_eligible(uuid, uuid)` now locks queued participants and returns `participant_has_active_session_conflict` before promotion when another unended session exists.
- `drain_match_queue(uuid)` continues to route through public promotion, now documented as relying on the participant-lock/conflict guard.

No web/native route, Edge Function, environment variable, or provider surface changed in this stream. Existing web/native busy badges remain defensive for stale cached cards; canonical deck eligibility is backend-owned.
