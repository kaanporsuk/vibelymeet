# Event Lobby Investigation Batch 1: Backend Contracts

Date: 2026-05-01

Branch: `audit/event-lobby-investigation-backend-contracts`

2026-06-09 supersession: this investigation predates Mystery Match removal. Historical rows below mentioning `find_mystery_match` describe the May 1 backend contract only; current schema removes that RPC and keeps reciprocal swipe plus queue promotion as the supported path.

## 1. Executive Verdict

Verdict: pass.

Streams 0-2 remain true on current `main` and the linked Supabase project `schdyxcunwcvddlcshwd / MVP_Vibe` by repo inspection, read-only Supabase catalog checks, migration parity, deployed `swipe-actions` source parity, and local validation. No implementation defect was found in this investigation batch.

Runtime data-mutating smoke was not run. No production data was mutated, no deployment was performed, and no historical migration was edited.

## 2. Scope And Files Inspected

Audit lineage:

- `docs/audits/event-lobby-deck-deep-dive.md`
- `docs/audits/event-lobby-closure-report.md`
- `docs/audits/event-lobby-active-event-contract-verification.md`
- `docs/audits/event-lobby-swipe-idempotency-verification.md`
- `docs/audits/event-lobby-production-contract-verification.md`

Backend and Edge surfaces:

- `supabase/migrations/20260501223000_event_lobby_canonical_active_state.sql`
- `supabase/migrations/20260501224000_event_lobby_swipe_already_swiped.sql`
- `supabase/migrations/20260501225000_event_lobby_ready_queue_contract.sql`
- `supabase/migrations/20260501230000_event_lobby_deck_payload_media.sql`
- `supabase/functions/swipe-actions/index.ts`
- `supabase/functions/_shared/matching/videoSessionFlow.ts`

Client compatibility:

- `src/hooks/useSwipeAction.ts`
- `apps/mobile/lib/eventsApi.ts`
- `apps/mobile/app/event/[eventId]/lobby.tsx`

Tests and contract docs:

- `shared/matching/eventLobbyCanonicalActiveState.test.ts`
- `shared/matching/eventLobbyActiveEventContract.test.ts`
- `shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts`
- `shared/matching/webEventLobbyGating.test.ts`
- `shared/matching/eventLobbyReadyQueueContract.test.ts`
- `shared/matching/eventLobbyDeckPayloadMedia.test.ts`
- `shared/matching/nativeEventLobbyContractParity.test.ts`
- `shared/observability/eventLobbyObservability.test.ts`

## 3. Local And Remote Migration Parity

Startup checks:

- `git checkout main`: passed before branch creation.
- `git pull --ff-only origin main`: passed, already current.
- `git status --short`: clean before report creation.
- `git branch --show-current`: `audit/event-lobby-investigation-backend-contracts`.
- `git log --oneline -n 20`: latest commit at startup was `0cabb7ceb fix: close final-release-ops-readiness findings (#663)`.

Supabase read-only alignment:

- `supabase projects list`: linked project was `schdyxcunwcvddlcshwd / MVP_Vibe`.
- `supabase migration list --linked`: local and remote migration histories matched through `20260501230000`.
- `supabase db push --linked --dry-run`: passed with `Remote database is up to date.`

No unchecked local migration was found by repo inspection for this investigation batch.

## 4. Active-Event Helper Evidence

Local migration `20260501223000_event_lobby_canonical_active_state.sql` creates the canonical helper:

- `get_event_lobby_active_state(uuid,timestamptz)`
- `SECURITY DEFINER`
- `SET search_path TO 'public'`
- grants revoked from `public`, `anon`, and `authenticated`
- execute granted to `service_role`

Remote catalog evidence:

| Function | Remote md5 | Security | Grants | Evidence |
| --- | --- | --- | --- | --- |
| `get_event_lobby_active_state(uuid,timestamptz)` | `0eaa696dfc0efa7009a4bc74b026c8b4` | `SECURITY DEFINER`, `STABLE`, search path `public` | service-role only | Exists remotely; includes all required reason markers. |
| `get_event_lobby_inactive_reason(uuid)` | `538a26f7c70f7aeee1aa769e6cc0ca9d` | `SECURITY DEFINER`, `STABLE`, search path `public` | service-role only | Delegates to canonical helper. |
| `is_event_lobby_active(uuid)` | `9298c440159ac34ffda9ac7b9c4c96f2` | `SECURITY DEFINER`, `STABLE`, search path `public` | service-role only | Delegates to canonical helper. |

Reason taxonomy verified locally and remotely:

- `event_not_found`
- `event_not_live`
- `event_draft`
- `event_cancelled`
- `event_archived`
- `event_ended`
- `event_not_started`
- `event_outside_live_window`

Remote schema column check confirmed the helper references actual `events` columns: `id`, `status`, `archived_at`, `ended_at`, `event_date`, and `duration_minutes`.

## 5. Function-By-Function Contract Table

| Surface | Inactive/non-live/ended rejection | Rejection timing | Auth/actor guard | Inactive reason behavior | Direct client bypass result |
| --- | --- | --- | --- | --- | --- |
| `get_event_deck(uuid,uuid,integer)` | Yes. Latest wrapper uses `get_event_lobby_active_state` and raises `event_not_active`. | Before base deck/candidate lookup. | Requires `auth.uid() = p_user_id`; service role remains trusted. | Raises `event_not_active` with canonical inactive state context. | Authenticated clients can call the RPC, but cannot bypass actor or active-event checks. |
| `handle_swipe(uuid,uuid,uuid,text)` | Yes. Active state is checked before target lookup, swipe insertion, session mutation, registration updates, and delegated side effects. | Before natural-key mutation/delegation; also protected by event and participant locks. | Requires authenticated actor ownership or service role. | Returns `event_not_active` with duplicate/idempotency path blocked behind active check. | Authenticated clients can call the RPC, but cannot bypass actor, event active, duplicate, or active-session guards. |
| `find_mystery_match(uuid,uuid)` | Historical only. Active state check and event lock existed before base session creation in the May 1 state. | Before candidate selection/session creation. | Required caller ownership or service role. | Raised/returned inactive truth before matching. | Current schema removes this RPC. |
| `drain_match_queue(uuid)` | Yes. Checks active helper and event validity before drain/promotion. | Before queue drain side effects. | Callable by authenticated/service role, but backend promotion guard is enforced. | Raises/returns inactive or invalid event truth. | Direct client call cannot bypass active promotion guard. |
| `promote_ready_gate_if_eligible(uuid,uuid)` | Yes. Checks active helper, event validity, event lock, participant locks, and one-active-session conflict. | Before promotion/session activation delegation. | Requires service role or the same authenticated user. | Raises/returns inactive event truth before promotion. | Direct client call cannot promote inactive events or other users. |
| `ready_gate_transition(uuid,text,text)` | Yes for `sync`, `mark_ready`, and `snooze`; inactive events terminalize through event inactivity truth. | Under locked session row before transition-sensitive mutation. | Uses `auth.uid()` participant ownership checks; service role remains trusted. | Returns terminal/event-inactive truth such as `event_not_active` / inactive reason. | Public RPC remains callable, but session ownership and inactive event checks prevent UI bypass. |
| `find_video_date_match(uuid,uuid)` | Deprecated legacy surface; no session creation path remains. | No candidate/session mutation. | Contains `auth.uid()` / unauthorized markers. | Returns deprecated no-session contract rather than creating sessions. | Callable legacy surface cannot create sessions. |
| `join_matching_queue(uuid,uuid)` | Deprecated legacy surface; no queue/session mutation path remains. | No candidate/session mutation. | Contains `auth.uid()` / unauthorized markers. | Returns deprecated no-session contract. | Callable legacy surface cannot create sessions. |
| `leave_matching_queue(uuid)` | Cleanup-only surface. | Updates registration cleanup only; no session creation. | Contains `auth.uid()` / unauthorized markers. | Cleanup remains allowed for stale/legacy state. | Direct call cannot create sessions or bypass active-event matching. |

Remote catalog markers also showed:

- May 1 state: `handle_swipe`, `get_event_deck`, then-supported `find_mystery_match`, `drain_match_queue`, `promote_ready_gate_if_eligible`, and `ready_gate_transition` included active-event helper markers. Current schema removes `find_mystery_match`.
- Deprecated `find_video_date_match` and `join_matching_queue` include deprecated/no-session markers and no `video_sessions` insert marker.
- `leave_matching_queue` has cleanup update markers but no session creation marker.

## 6. Swipe Idempotency Evidence Table

| Scenario | Evidence | Result |
| --- | --- | --- |
| First pass | Delegated base mutation remains the first-time path; regression tests cover first-time outcomes. | `pass_recorded`. |
| First vibe | Delegated base mutation remains the first-time path unless mutuality is found. | `vibe_recorded` unless mutual. |
| First super vibe | Delegated base mutation remains the first-time path unless mutuality is found. | `super_vibe_sent` unless mutual. |
| Mutual immediate | Base matching path remains delegated after active/duplicate/session guards. | `match`. |
| Mutual queued | Base matching path remains delegated after active/duplicate/session guards. | `match_queued`. |
| Duplicate same-type with no active mutual session | `20260501224000` and `20260501225000` return same natural-key replay truth before delegated side effects. | `already_swiped`. |
| Duplicate after existing mutual session | Existing session recovery branch returns routable match truth without creating a new session. | `already_matched`. |
| Different-type duplicate natural key | Existing swipe type conflict branch returns explicit conflict truth. | `swipe_already_recorded`. |
| Duplicate after event inactive | Active-event guard precedes replay branch. | `event_not_active`. |
| Active-session conflict | Participant active-session guard runs before delegated mutation. | `participant_has_active_session_conflict`. |

Duplicate/no-op payload markers verified in migration, shared flow types, Edge suppression code, and tests:

- `duplicate`
- `idempotent`
- `replay`
- `notification_suppressed`
- `dedupe_reason`

Remote `handle_swipe` catalog evidence:

- md5 `b39403eafedf23104920c56b0a58c55c`
- `SECURITY DEFINER`
- search path `public`
- active helper marker present
- advisory idempotency lock marker present
- participant lock marker present
- `already_swiped`, `swipe_already_recorded`, `participant_has_active_session_conflict`, `duplicate`, `idempotent`, `replay`, `notification_suppressed`, and `dedupe_reason` markers present

## 7. Notification Dedupe Evidence Table

| Outcome/category | Notification posture | Evidence |
| --- | --- | --- |
| `already_swiped` | Suppressed. | `swipe-actions` classifies duplicate/no-op results and does not attempt notification. |
| `swipe_already_recorded` | Suppressed. | Explicit no-notify outcome. |
| `event_not_active` | Suppressed. | Explicit no-notify outcome; inactive events do not send notifications. |
| `blocked`, `reported`, `account_paused`, `target_unavailable` | Suppressed. | Explicit no-notify outcomes. |
| `participant_has_active_session_conflict` | Suppressed. | Explicit no-notify outcome. |
| Duplicate/idempotent/replay payload flags | Suppressed. | `duplicate`, `idempotent`, `replay`, or `notification_suppressed` forces suppression. |
| `match` | Fresh notification path remains. | Side-effect-worthy first-time outcome. |
| `match_queued` | Fresh notification path remains. | Side-effect-worthy first-time outcome. |
| `super_vibe_sent` | Fresh notification path remains. | Side-effect-worthy first-time outcome. |
| `vibe_recorded` | Fresh notification path remains. | Side-effect-worthy first-time outcome. |

Structured logs in `swipe-actions` are sanitized to low-cardinality outcome/reason flags and do not log secrets, raw payloads, tokens, or private customer data.

Deployed Edge Function source parity:

- Local `supabase/functions/swipe-actions/index.ts` SHA256: `e5ffa27b2c1a59bf28ac646df354807774f6e02845be195d4cb71955f146444a`
- Downloaded deployed `swipe-actions` source SHA256: `e5ffa27b2c1a59bf28ac646df354807774f6e02845be195d4cb71955f146444a`
- `supabase functions list --project-ref schdyxcunwcvddlcshwd`: `swipe-actions` active, version `491`, updated `2026-05-01 15:18:34 UTC`

Only `swipe-actions` needed deployment for the Edge notification suppression path; no broad `send-notification` rewrite was introduced by this batch.

## 8. Client Compatibility Evidence

Web:

- `src/hooks/useSwipeAction.ts` invokes `swipe-actions`, not direct `handle_swipe`.
- Web handles additive outcomes/fields including `already_swiped`, `swipe_already_recorded`, `event_not_active`, duplicate/idempotent markers, and `participant_has_active_session_conflict`.
- No deck advancement or notification-like UX is triggered for duplicate/no-op outcomes.

Native:

- `apps/mobile/lib/eventsApi.ts` invokes `swipe-actions` for swipes.
- `apps/mobile/app/event/[eventId]/lobby.tsx` handles `already_swiped`, `swipe_already_recorded`, `event_not_active`, duplicate/idempotent markers, and `participant_has_active_session_conflict`.
- Native treats duplicate/no-op outcomes as no-advance outcomes and preserves backend truth for inactive events.

Direct writes:

- No Event Lobby client insert into `event_swipes` was found.
- No Event Lobby client session creation write to `video_sessions` was found.
- Event Lobby clients use backend RPCs/Edge Functions for backend-owned lifecycle changes.

## 9. Validation Commands And Results

Targeted commands:

- `npx tsx shared/matching/eventLobbyCanonicalActiveState.test.ts`: passed, 11 tests.
- `npx tsx shared/matching/eventLobbyActiveEventContract.test.ts`: passed, 11 tests.
- `npx tsx shared/matching/swipeRetryIdempotencyNotificationDedupe.test.ts`: passed, 14 tests.
- `npx tsx supabase/functions/_shared/matching/videoSessionFlow.test.ts`: passed, 5 tests.

Broader requested packs:

- `npm run test:hardening-contracts`: passed.
- `npm run test:event-lobby-regression`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with existing warnings only, 0 errors and 208 warnings.
- `npm run build`: passed; Vite emitted existing dynamic import and chunk-size warnings.

Supabase/read-only checks:

- `supabase migration list --linked`: passed; local/remote parity confirmed.
- `supabase db push --linked --dry-run`: passed; remote database up to date.
- `supabase functions list --project-ref schdyxcunwcvddlcshwd`: passed; `swipe-actions` active.
- Read-only catalog SQL checks for function definitions, grants, markers, md5s, and event columns: passed.
- Deployed `swipe-actions` source download and SHA256 comparison: passed.

Repository hygiene:

- `git diff --check`: passed before report creation.

## 10. Findings

No FAIL or WARN findings were identified for the investigated Streams 0-2 contract surfaces.

| Severity | Finding | Evidence | Affected surface | Follow-up bugfix prompt |
| --- | --- | --- | --- | --- |
| INFO | Runtime business-data smoke remains intentionally unperformed. | The investigation was read-only; data-mutating event/swipe/payment/provider smoke was out of scope. | Production runtime data path | None. This is an expected audit limitation, not an implementation defect. |
| INFO | Deprecated legacy queue/date RPCs remain callable but no longer create sessions. | Remote and local definitions contain auth/unauthorized and deprecated/no-session markers, with no `video_sessions` insert marker. | `find_video_date_match`, `join_matching_queue`, `leave_matching_queue` | None. The current behavior matches the documented legacy compatibility posture. |

## 11. No-Production-Mutation Statement

This investigation did not mutate production business data.

Actions performed were limited to:

- local repo inspection
- local tests/typecheck/lint/build
- read-only Supabase project/migration/function listing
- read-only Supabase catalog SQL checks
- `supabase db push --linked --dry-run`
- read-only download of deployed `swipe-actions` source for hash comparison

No deployment was performed. No `supabase db push` without dry-run was run. No local Supabase was used. No Docker command was run. No secrets, tokens, service-role keys, provider keys, webhook secrets, or private payloads were printed or committed.
