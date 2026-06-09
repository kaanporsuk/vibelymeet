# Event Lobby Closure Report

Date: 2026-05-01
Branch: `audit/event-lobby-closure`
Supabase project ref: `schdyxcunwcvddlcshwd`
Latest local and remote migration: `20260501230000_event_lobby_deck_payload_media.sql`

2026-06-09 addendum: this closure report is historical for the May 1 Event Lobby hardening stack. Mystery Match was later removed from the active product/backend path by `supabase/migrations/20260609152000_remove_mystery_match.sql`; current source/generated types should not expose `find_mystery_match`, and the supported session creation path is reciprocal swipe plus supported queue promotion.

## Executive Verdict

The Event Lobby Deck work is **launch-ready for backend/web/native contract posture**.

All original `EVT-LOBBY-*` findings are either closed with evidence or explicitly marked as non-blocking remaining work. The launch-blocking issues around active-event enforcement, stale deck/swipe calls, busy candidates, swipe idempotency, media payload safety, observability, and production migration uncertainty are closed.

Runtime two-user/three-user staging smoke is **blocked, not passed**, because this workspace has no approved safe staging fixture metadata and production data mutation is not allowed. The manual smoke runbook exists and should be run with approved non-production fixtures before app-store/TestFlight or operator launch signoff.

## Source Audit Status

Requested source: `docs/audits/event-lobby-deck-deep-dive.md`.

That file was not present on `main` during this closure audit, and `git log --all -- docs/audits/event-lobby-deck-deep-dive.md` returned no tracked history. Earlier verification docs record that the scratch deep dive was intentionally left untracked/removed to avoid preserving stale pre-hardening claims as current truth. This closure therefore uses the original finding IDs from the stream brief plus the merged Prompt 1-9 evidence trail.

The original path now exists as a status pointer to this closure report.

## Dependency And PR Evidence

| Prompt | PR | Merge commit | Artifact summary | Status |
|---|---:|---|---|---|
| 1. Backend active-event contract | #626 | `22d30191e634a41d83288d01a5da8a0209426dfb` | `20260501223000_event_lobby_canonical_active_state.sql`; active-event helper and guards | Merged/deployed |
| 2. Swipe idempotency and notification dedupe | #627 | `29943772f15fa3b589fa5a85a408a133a371e737` | `20260501224000_event_lobby_swipe_already_swiped.sql`; `swipe-actions` update | Merged/deployed |
| 3. Web EventLobby gating parity | #628 | `5a5a24de92663544c938a39158433a3f74ee915d` | Web route/hook gating, no Supabase artifact | Merged |
| 4. Busy-user / Ready Gate / queue contract | #630 | `4cac3caedfae8fc4070f5c78fe6cad0a5419bfe0` | `20260501225000_event_lobby_ready_queue_contract.sql` | Merged/deployed |
| 5. Deck payload and media contract | #631 | `162646923861f9539efbd3c8f4ff827cf0eb12e4` | `20260501230000_event_lobby_deck_payload_media.sql` | Merged/deployed |
| 5b. Generated Supabase types sync | #632 | `bfc9a137889de0327a0872b67667d2715ce80dc2` | Generated types after deck payload deploy | Merged |
| 6. Observability taxonomy | #633 | `e823f8caaa1b7dbafe9112a09146de0d8f4300b2` | Shared taxonomy; `swipe-actions` logs | Merged/deployed |
| 7. Regression harness | #634 | `9f46806b0e63b6af891278edce2154274c40553c` | `npm run test:event-lobby-regression`; staging runbook | Merged |
| 8. Native contract doc | #635 | `be124392ca7a14ece4f2a97f18ca525fa88d6a39` | `docs/contracts/event-lobby-native-contract.md` | Merged |
| 9. Native Event Lobby parity | #636 | `5a951253ed8ecd53df218427cccc6086de370757` | Native outcome/gating/media parity; no Supabase artifact | Merged |

## Finding Closure Table

| ID | Original finding | Status | Closure evidence |
|---|---|---|---|
| `EVT-LOBBY-001` | Backend active-event enforcement | Closed | Deployed `get_event_lobby_active_state(uuid,timestamptz)` reason taxonomy was present. The May 1 remote marker query confirmed `get_event_deck`, `handle_swipe`, then-supported `find_mystery_match`, `drain_match_queue`, and `promote_ready_gate_if_eligible` used the active helper / inactive guards. Current schema removes `find_mystery_match`. Tests: `eventLobbyCanonicalActiveState.test.ts`, `eventLobbyActiveEventContract.test.ts`. |
| `EVT-LOBBY-002` | Web missing-event dead-end | Closed | `src/lib/eventLobbyGating.ts` and `src/pages/EventLobby.tsx` render explicit missing/unavailable states and disable deck fetch. Tests: `webEventLobbyGating.test.ts`. |
| `EVT-LOBBY-003` | Ended-event stale lobby/stale swipes | Closed | Backend returns `event_not_active` without mutation; web/native gate ended/inactive states; native now treats backend inactive deck/swipe responses as terminal. Tests: active-event, web gating, native parity, and regression harness. |
| `EVT-LOBBY-004` | Busy/in-session candidates swipeable | Closed | Deployed `get_event_deck` hides busy/non-swipeable states; `handle_swipe` and queue promotion return `participant_has_active_session_conflict` before mutation. Contract: `docs/contracts/event-lobby-ready-queue-contract.md`. |
| `EVT-LOBBY-005` | Swipe retry/idempotency notification duplicate | Closed | Deployed `handle_swipe` returns `already_swiped` / `swipe_already_recorded` with duplicate markers; `swipe-actions` suppresses duplicate/no-op notifications. Remote marker query confirms `already_swiped`; downloaded `swipe-actions` source matches repo SHA-256. |
| `EVT-LOBBY-006` | Web image fallback | Closed | Web card uses first valid photo, then avatar, then placeholder through shared media helpers. Tests: `eventLobbyDeckPayloadMedia.test.ts`. |
| `EVT-LOBBY-007` | Thumbnail-sized full-card media | Closed | Web full-card lobby imagery uses `deckCardUrl`; native already uses `deckCardUrl`. Tests: `eventLobbyDeckPayloadMedia.test.ts`, `nativeEventLobbyContractParity.test.ts`. |
| `EVT-LOBBY-008` | Empty-state copy/polling mismatch | Closed for launch | Web/native deck fetches are gated; deck-empty taxonomy is shared and coarse; regression harness covers reason mapping. Minor copy polish can continue, but launch-blocking stale polling/diagnostic mismatch is closed. |
| `EVT-LOBBY-009` | Per-card profile fetches | Closed | Deck payload now carries `photo_verified`, `premium_badge`, `primary_photo_path`, and `availability_state`; web/native card tests assert no per-card profile fetch for these decorations. |
| `EVT-LOBBY-010` | Super Vibe monetization/product contract | Partially closed, non-blocking | Current contract documents 3 Super Vibes per event and backend-owned limit/retry semantics; tests cover duplicate/limit safety. A monetization redesign or credit-product polish remains out of scope and non-blocking for this deck safety launch. |
| `EVT-LOBBY-011` | Observability gap | Closed | Shared taxonomy added for deck/swipe/queue/Ready Gate/notifications; web/native emit normalized events; `swipe-actions` logs notification sent/suppressed. Contract: `docs/contracts/event-lobby-observability.md`. |
| `EVT-LOBBY-012` | Production migration state unknown | Closed | `supabase migration list --linked` shows local/remote parity through `20260501230000`; `supabase db push --linked --dry-run` reports remote database is up to date. |

## Deployed Supabase Verification

Project ref checks:

- `supabase/config.toml`: `schdyxcunwcvddlcshwd`
- `supabase/.temp/project-ref`: `schdyxcunwcvddlcshwd`
- Supabase CLI: `2.95.4`

Migration verification:

- `supabase migration list --linked`: local and remote matched through `20260501230000`.
- Event Lobby hardening tail present remotely:
  - `20260501180000_event_lobby_active_event_contract.sql`
  - `20260501210000_swipe_retry_idempotency_notification_dedupe.sql`
  - `20260501223000_event_lobby_canonical_active_state.sql`
  - `20260501224000_event_lobby_swipe_already_swiped.sql`
  - `20260501225000_event_lobby_ready_queue_contract.sql`
  - `20260501230000_event_lobby_deck_payload_media.sql`
- `supabase db push --linked --dry-run`: `Remote database is up to date.`

Remote RPC marker query:

| Function | Remote MD5 | Key markers confirmed |
|---|---|---|
| `get_event_lobby_active_state(uuid,timestamptz)` | `0eaa696dfc0efa7009a4bc74b026c8b4` | `event_not_found`, `event_not_live`, `event_draft`, `event_cancelled`, `event_archived`, `event_ended`, `event_not_started`, `event_outside_live_window` |
| `get_event_deck(uuid,uuid,integer)` | `17c5385df896d6c4b0947a50c7d04eb0` | active helper, `event_not_active`, `availability_state`, `primary_photo_path`, `photo_verified`, `premium_badge` |
| `handle_swipe(uuid,uuid,uuid,text)` | `b39403eafedf23104920c56b0a58c55c` | active helper, `event_not_active`, `already_swiped`, `participant_has_active_session_conflict` |
| `find_mystery_match(uuid,uuid)` | historical May 1 marker | active helper, `event_not_active`; removed from current schema by `20260609152000_remove_mystery_match.sql` |
| `drain_match_queue(uuid)` | `3085db275ba3c5eb9c9d439e7f81cc1a` | active helper, `event_not_active` |
| `promote_ready_gate_if_eligible(uuid,uuid)` | `f2ece9fa3ca9285320c68ee332fcfa51` | active helper, `event_not_active`, `participant_has_active_session_conflict` |
| `ready_gate_transition(uuid,text,text)` | `edc877ec0657cf772259dd5ac4b89483` | `event_not_active` terminal handling |
| `find_video_date_match(uuid,uuid)` | `a72768446c41e0a04985506df5a96c5d` | deprecated legacy queue surface |
| `join_matching_queue(uuid,uuid)` | `ad071896f1838c874a456d1e169cf9de` | deprecated legacy queue surface |
| `leave_matching_queue(uuid)` | `3cbf2d353879f303c950815fec09abdf` | cleanup only, no session creation |

Edge Function verification:

- `supabase functions list --project-ref schdyxcunwcvddlcshwd`: `swipe-actions` active, version `471`, updated `2026-05-01 02:26:12 UTC`.
- Downloaded deployed `swipe-actions` with `supabase functions download swipe-actions --project-ref schdyxcunwcvddlcshwd --use-api`.
- SHA-256 parity:
  - local `supabase/functions/swipe-actions/index.ts`: `e5ffa27b2c1a59bf28ac646df354807774f6e02845be195d4cb71955f146444a`
  - downloaded remote `swipe-actions/index.ts`: `e5ffa27b2c1a59bf28ac646df354807774f6e02845be195d4cb71955f146444a`

## Web / Native Parity Assessment

Web:

- `src/pages/EventLobby.tsx` uses the shared `getEventLobbyGateState` contract to block missing, unregistered, not-confirmed, scheduled/not-started, cancelled, archived, draft, ended, non-server-active, and paused states.
- `useEventDeck` is enabled only through the route gate.
- Swipe calls go through `swipe-actions`; no direct `handle_swipe` app calls were found.
- Web card media uses deck payload fields and the deck-card preset.

Native:

- `apps/mobile/app/event/[eventId]/lobby.tsx` blocks stale deck/status/foreground/queue side effects with event/user/registration/pause/live gates.
- Native consumes `outcome/result/error`, handles `event_not_active`, duplicate/no-op outcomes, target unavailable, and active-session conflict.
- Native uses `deckCardUrl`, `photo_verified`, `premium_badge`, `primary_photo_path`, and `availability_state`.
- No `expo-av` import or package usage was introduced; search found only comments explicitly saying no `expo-av`.

Client-owned business logic check:

- No app calls to `supabase.rpc('handle_swipe')`.
- Event Lobby swipes go through `swipe-actions` with explicit user `Authorization` and `apikey` headers.
- Client reads of `event_swipes` remain count-only Super Vibe display helpers; no client inserts into `event_swipes` or `video_sessions` were found in Event Lobby paths.
- Session creation, queue promotion, Ready Gate transitions, and notification side effects remain backend/Edge-owned. Current session creation is reciprocal swipe plus supported queue promotion; Mystery Match is no longer a supported path.

## Validation Results

Commands run on `audit/event-lobby-closure`:

- `npm run test:event-lobby-regression` - pass.
- `npm run test:hardening-contracts` - pass.
- `npm run typecheck` - pass.
- `npm run lint` - pass with existing warning backlog, `0` errors / `210` warnings.
- `npm run build` - pass with existing Vite dynamic-import and chunk-size warnings.
- `supabase migration list --linked` - local/remote parity through `20260501230000`.
- `supabase db push --linked --dry-run` - remote database up to date.
- `supabase functions list --project-ref schdyxcunwcvddlcshwd` - `swipe-actions` active.
- `supabase functions download swipe-actions --project-ref schdyxcunwcvddlcshwd --use-api` plus SHA-256 compare - local and deployed source match.
- Remote read-only RPC marker queries - active-event, idempotency, queue conflict, and deck payload markers present.

## Runtime Smoke Status

Status: **blocked, not passed**.

No safe staging fixture metadata is present in this workspace:

- `EVENT_LOBBY_REGRESSION_ENV`
- `EVENT_LOBBY_REGRESSION_SUPABASE_REF`
- `EVENT_LOBBY_REGRESSION_SAFE_FIXTURES`
- `EVENT_LOBBY_REGRESSION_EVENT_ID`

Because production data mutation is forbidden and no rollback-safe fixtures were provided, the following runtime flows were not executed:

- two-user mutual match
- three-user queued match
- stale direct RPC rejection using live fixture accounts
- Super Vibe limit/retry using live fixture accounts
- block/report exclusion using live fixture accounts
- empty deck diagnostics through live UI/provider telemetry

Exact fixture and manual steps are documented in `docs/golden-path-event-lobby-regression-runbook.md`.

## Remaining Risks

- Runtime provider/realtime/device proof still requires approved staging fixtures.
- Super Vibe monetization/product polish remains a non-blocking product follow-up; backend retry/limit safety is closed.
- Existing repository lint warning backlog remains outside this stream. No lint errors were present.
- The original deep-dive file was not tracked; this closure report is now the canonical status artifact.

## Launch-Readiness Verdict

Backend/cloud contract: **ready**.

Web EventLobby: **ready** for the audited launch posture.

Native EventLobby contract readiness: **ready** for backend contract consumption and native parity implementation; app-store/TestFlight rollout still needs the usual device/staging smoke evidence.

Operational launch posture: **go for code/cloud contract closure**, with manual staging runtime smoke still required before declaring end-to-end user-flow proof.

## Rollback Notes

This closure stream is docs-only. Revert its merge commit if the closure report itself needs rollback.

For prior implementation streams, use forward migrations or targeted function redeploy rollback; do not edit historical applied migrations. The relevant artifact rollback anchors are the PRs and migrations listed in the dependency table above.

## Next Non-Blocking Polish Items

- Run the Event Lobby staging smoke runbook with approved non-production fixtures and attach results to this report or a dated follow-up.
- Decide whether Super Vibe monetization should stay as the documented 3-per-event product policy or receive a separate monetization redesign stream.
- Continue reducing the existing lint warning backlog outside Event Lobby launch closure.
