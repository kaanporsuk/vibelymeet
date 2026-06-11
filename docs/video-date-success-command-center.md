# Vibely Video Date Success Command Center

Date opened: 2026-06-04  
Owner intent: recover Vibely Video Date end to end, from match through post-date survey completion, across web, native, and mobile.

---

## Why This Document Exists

Vibely Video Date has not had a fully successful production run for over a month: match -> Ready Gate -> Daily room -> live video -> end -> post-date survey completion. Many remediation attempts have been made over many consecutive days. The failure mode has moved over time, which makes isolated fixes and isolated notes dangerous.

This document is the active common-understanding log for Video Date recovery. Every agent, engineer, or assistant working on Video Date must consult this file before changing code and update it after material investigation, code changes, migrations, deployments, manual QA, or newly observed failures.

The goal is not to record optimism. The goal is to preserve evidence, root-cause thinking, decisions, unresolved gaps, and the exact acceptance proof needed before calling Video Date healthy again.

## Operator Brief

The founder/operator brief that opened this document:

> Currently it has been over a month since the last time there was a fully successful Video Date run, from match till survey completion. Despite that we have been working to remedify the feature several hundred times and in many many consecutive days. So please let's start properly documenting everything we do at each and every step.

Working interpretation:

- This is now a recovery program, not a one-off bug fix.
- Every step needs durable documentation because repeated local fixes have not produced a stable production outcome.
- The shared goal is progressive thinking: each investigation should improve the common model of the system, not restart from scratch.

---

## Operating Rule

For any work touching Video Date, Ready Gate, event lobby match handoff, Daily.co room entry, post-date survey, notification outbox, or related Supabase RPCs:

1. Read this document first.
2. Check `docs/active-doc-map.md` for any newly promoted canonical docs.
3. Update this document with:
   - observed symptom and exact user-facing copy,
   - affected session/event IDs where available,
   - relevant console/network/Supabase/Daily evidence,
   - hypothesis and rejected hypotheses,
   - code and migration changes,
   - verification run,
   - what remains unproven.
4. Do not claim the feature is definitively fixed until a fresh end-to-end run proves match -> survey completion.

---

## Current Product Definition Of Success

A successful Video Date run means:

1. Two eligible users in the same live event mutually match.
2. Both are routed to the same Ready Gate session.
3. Each user can mark ready once, in either order, on web or native/mobile.
4. The second ready action transitions the canonical session to `both_ready`.
5. Both users are handed to `/date/:sessionId` or native date route without lobby cycling.
6. Both users enter the same Daily room name and URL.
7. Local and remote media tracks mount for both users.
8. The entry/date timer follows server truth.
9. Ending the date opens the post-date survey.
10. Survey completion persists and routes the user into the expected next lobby/deck/Ready Gate state.
11. No raw HTTP 500 is emitted from the active hot-path RPCs.
12. Retryable backend contention shows syncing/retrying UX, not stale or changed Ready Gate copy.

---

## 2026-06-10 Implementation Update: Top-5 Simplification Execution (verdict v3-only, flag/alias purge, single web hydration owner, legacy sweeps, dead drain views)

Delta: `docs/branch-deltas/video-date-simplification-top5.md`. Source audit: `docs/audits/video-date-next-simplification-candidates-2026-06-10.md`. Branch `claude/video-date-simplification-top5`.

- **Verdict path is v3-only.** Web/native `PostDateSurvey`, `apps/mobile/lib/videoDateApi.ts`, and both post-date outbox executors no longer carry `backendVersion`/`submitVerdictV3`; `transition_version: "v3"` is hard-coded. `post-date-verdict` Edge source now dispatches a single verdict RPC (`submit_post_date_verdict_v3`) and coerces stale v2/keyless callers onto v3 with a deterministic legacy idempotency key plus `deprecated_version_coerced_to_v3` log. Verified before hard-coding: flag `video_date.outbox_v2.submit_verdict` is enabled in production, so v3 was already live behavior. RPCs v1/v2 are NOT dropped yet (needs Edge deploy + release boundary).
- **Client flag list purged.** `VIDEO_DATE_V4_CLIENT_FEATURE_FLAGS` now lists only client-read flags; 8 server-read rollout keys, 4 retired v1 alias keys, and `outbox_v2.submit_verdict` are out of the client list. `featureFlagAliasResolution.ts` and `VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS` are deleted; the five dual-read sites read canonical `.enabled` (all canonical flags verified enabled in production). DB flag rows untouched.
- **One web lobby hydration owner.** The default-false single-owner/shadow experiment is deleted (`runtimeFlags` entries, `useEventActiveSession`, shadow compare in `useActiveSession`); `EventLobby.tsx` uses `useActiveSession(user?.id, { eventId })` only. `SessionHydrationProvider` stays (live app-shell usage).
- **Legacy sweeps:** `pendingMatch` deep-link param consumers removed (zero producers verified); unconsumed `videoDateLeanRuntimeContract` module/test/wiring deleted (doc tombstoned); outbox drainer dispatches canonical kinds only.
- **Cloud change:** migration `20260610182520_remove_dead_event_loop_drain_views.sql` applied to `schdyxcunwcvddlcshwd` (drops `v_event_loop_drain_events`/`v_event_loop_drain_outcomes_hourly`; zero dependents/readers verified live); post-apply dry-run clean; types regenerated (−56 lines).
- **Deferred with live-evidence reasons:** physical queued purge (15 live functions incl. the `enforce_one_active_video_session` trigger still reference `queued_expires_at`), queue-fairness views (26 live dependents), client `'queued'` pre-hydration placeholder rename, verdict v1/v2 RPC drop, onion flattening, handshake→entry Phase D/E.
- **Edge deploys completed (2026-06-10 close-out):** after PR #1286 squash-merged to `main` as `93e73c9948bf2ffb3bb40327b9139b91e16290b1` (all CI checks green), `post-date-verdict` was deployed as active version `600` (2026-06-10 18:51:03 UTC) and `video-date-outbox-drainer` as active version `47` (2026-06-10 18:52:33 UTC) on project `schdyxcunwcvddlcshwd`. Post-merge alignment evidence: linked migration list and dry-run show local == remote through `20260610182520` ("Remote database is up to date"); `npm run regen:supabase-types` against the linked project reproduces the committed `src/integrations/supabase/types.ts` byte-identically; local `main` == `origin/main`; feature branch deleted locally and remotely; parent workspace gitlink committed at the merge commit.

This is a behavior-preserving simplification pass, not product acceptance. The acceptance bar remains a fresh disposable two-user production run through both persisted `date_feedback` rows.

---

## 2026-06-10 Implementation Update: handshake → entry, Phase B/C (additive DB compat + client readers)

Delta: `docs/branch-deltas/handshake-to-entry-phase-bc.md`. **Additive and behavior-preserving** — nothing renamed or dropped.

Phase B (deployed to `schdyxcunwcvddlcshwd` via `supabase db push`, migration `20260610130000_video_date_handshake_to_entry_compat.sql`):
- `video_sessions.entry_started_at` / `entry_grace_expires_at` as `GENERATED ALWAYS AS (handshake_*) STORED` mirror columns (read-only, auto-synced, cannot desync).
- Entry-named RPC wrappers delegating to the handshake functions (same signatures/grants): `video_session_entry_auto_promote_v2`, `video_session_continue_entry_v2`, `finalize_video_date_entry_deadline`, `expire_due_joined_video_date_entries_bounded`.
- `video_date_transition` accepts `complete_entry` / `continue_entry` as aliases for `complete_handshake` / `continue_handshake` (old actions and the failsoft body unchanged).
- Types regenerated.

Phase C (client readers): migrated the client RPC call sites (`src/pages/VideoDate.tsx`, `apps/mobile/lib/videoDateApi.ts`) to the entry wrappers, exercising the compat over the real client→backend path; updated the client-code contract assertions. Feature flag (`video_date.outbox_v2.continue_handshake`) and transition action strings stay on handshake.

Phase C Edge-Function migration **deferred deliberately**: it would be behavior-neutral (`entry_started_at` === `handshake_started_at`; `phase`/`state === 'handshake'` can't change until Phase D), would risk the output payload keys consumers depend on, and would require deploying `daily-room` and the other critical functions to production with no two-user verification — real risk for zero behavior benefit, and the handshake column is not dropped for several phases. Recommend doing it in lockstep with the column-drop/enum-rename phase behind a real e2e window.

Verification: typecheck, lint, `test:video-date-v4`, `test:video-date:red-flags`, persistence test 18/18; `db push --dry-run` "Remote database is up to date".

Proof boundary: additive compat, not Video Date acceptance. No two-user run was possible here.

---

## 2026-06-10 Implementation Update: handshake → entry, Phase A (client vocabulary)

First pass of the handshake → entry terminology migration: **client-facing TS identifiers only**, DB/wire unchanged. Audit map: `docs/branch-deltas/handshake-to-entry-audit.md`; delta: `docs/branch-deltas/handshake-to-entry-phase-a.md`.

Renamed a safe allowlist of ~40 internal identifiers (312 substitutions / 14 files) + two file renames (`videoDateHandshakePersistence.ts` → `videoDateEntryPersistence.ts` and its test). Examples: `clearHandshakeGraceState` → `clearEntryGraceState`, `completeHandshake` → `completeEntry`, `VideoDateHandshakeTruth` → `VideoDateEntryTruth`, `resolveVideoDateHandshakeUiState` → `resolveVideoDateEntryUiState`.

Deliberately preserved (wire/data/contract): the `'complete_handshake'`/`'continue_handshake'` transition action strings, the `handshake_started_at`/`handshake_grace_expires_at` columns and `'handshake'` phase/state values, `ReadyGateQueueStatus.InHandshake = 'in_handshake'` (queue_status), the `video_date.outbox_v2.continue_handshake` flag + `continueHandshakeV2`, analytics payload keys, the lucide `HeartHandshake` icon, generated types, migrations, Edge Functions, validation SQL.

Verification: typecheck (the net for identifier renames), lint, `test:video-date-v4`, `test:video-date:red-flags`, the renamed persistence test (18/18); full matching/observability sweep shows the 13 still-red files are pre-existing on clean `main` with **zero new failures**. Behavior unchanged (identifier-only rename).

Subsequent phases (separate sign-off + real e2e window): DB additive compat columns/RPC wrappers/actions, Edge Function migration, `ALTER TYPE video_date_state RENAME VALUE 'handshake' → 'entry'`, flag-key rename, types regen.

Proof boundary: client vocabulary refactor, not Video Date acceptance. No two-user run was possible here.

---

## 2026-06-10 Implementation Update: Ready Gate Single Prepare-Owner

Consolidated Ready Gate entry ownership so there is one canonical `prepare_date_entry` owner per platform. Golden flow unchanged: Event Lobby -> mutual match -> Ready Gate -> both_ready -> `prepare_date_entry`/`prepare_entry` -> `/date/:sessionId`. Ready Gate and the Daily room creation inside `prepare_date_entry` are untouched.

Before, prepare was owned in competing places: web `EventLobby` ran its own `prepareVideoDateEntry` from a `ready_gate_both_ready` broadcast while the mounted `ReadyGateOverlay` also prepared; native re-ran prepare in `navigateToDateSession` after the overlay had already prepared. The web overlay's exhausted/exception prepare-failure paths blind-navigated to `/date`, which could cause `/date`<->lobby bounce churn for non-routeable sessions.

Implementation:

- Web `src/pages/EventLobby.tsx`: removed `prepareAndNavigateToDateSession`, the `prepareNavigationInFlightRef` latch, and the `prepareVideoDateEntry` import. `reconcileLobbyBroadcastEvent` no longer prepares on `ready_gate_both_ready`; it only runs the convergence refresh, after which the mounted overlay owns the single prepare/navigate. The lobby still dedupes date navigation.
- Native `apps/mobile/app/event/[eventId]/lobby.tsx`: the overlay handoff passes `{ skipPrepare: true }` so the lobby does not re-run prepare; `navigateToDateSession`'s `startable` (routeable-truth) gate still runs before any `/date` nav.
- Web `src/components/lobby/ReadyGateOverlay.tsx`: the `exhausted` and exception prepare-failure handoffs now navigate to `/date` only when `isRouteableVideoDateTruth(latestTruth)` is proven, mirroring the overlay's existing retryable-failure gate and native's lobby `startable` gate; otherwise the overlay shows a failed/ended state instead of blind-navigating.
- Standalone `/ready/:id` (web `ReadyRedirect`, native `app/ready/[id].tsx`) remains a canonical host/owner; deep links still work.
- Branch delta: `docs/branch-deltas/ready-gate-single-prepare-owner.md`.
- Tests updated to the single-owner invariant: `readyGatePartialReadyDefinitiveClosure`, `videoDateEndToEndHardening`, `realtimeSubscriptionTightening`.

Verification: typecheck, lint, `test:video-date-v4`, `test:video-date:red-flags`, `test:event-lobby-regression` all pass; the broad matching/observability sweep's still-red files were confirmed pre-existing on clean `main`.

Proof boundary: client ownership simplification, not Video Date acceptance. No two-user end-to-end run was possible in this environment; acceptance still requires a real run from mutual swipe through survey plus a `/ready/:id` deep-link check.

---

## 2026-06-10 Implementation Update: Queued-Session Branch Removed At The Swipe Source

Current source removes the last live remnant of the match-queue subsystem: the swipe path no longer creates a queued `video_sessions` row or returns `match_queued`. This finishes the cleanup that began with the post-date instant-next removal (`20260610000100`) and the `match_queued` -> Ready Gate conversion wrapper (`20260610022531`). Those earlier changes already dropped `drain_match_queue`, `drain_match_queue_v2`, `get_video_date_queue_hint_v1`, and `promote_ready_gate_if_eligible`, and ensured no queued session was ever persisted (the wrapper promoted any queued result to `ready` in the same transaction). This change moves that guarantee to the source so the queued branch no longer exists at all.

Implementation added:

- Forward migration `supabase/migrations/20260610120000_remove_match_queue_source_always_ready.sql`:
  - `CREATE OR REPLACE public.handle_swipe_20260506090000_stale_room_base(...)` now inserts a single `ready` Ready Gate session for every mutual match (`ready_gate_status = 'ready'`, `ready_gate_expires_at = now() + 30s`, `queued_expires_at = NULL`) and returns `result = 'match'` with `immediate = true`. The `v_create_queued` / `v_has_queued_session` / actor-target presence computation and the entire queued branch (the `match_queued` return and `ready_gate_status = 'queued'` insert) are removed.
  - `CREATE OR REPLACE public.handle_swipe_20260601183000_deck_authority_base(...)` collapses to a pass-through over `handle_swipe_20260610000100_auto_next_base(...)`; the now-dead `match_queued` -> Ready Gate promotion logic is gone. Super Vibe consumed truth is still preserved by the inner auto-next/super-vibe base.
- Dead admin queue-drain analytics removed from `supabase/functions/_shared/admin-video-date-ops.ts` (`summarizeQueueDrain`, `QueueDrainSummary`/`QueueDrainInputRow`/`QueueDrainReasonCount`, `EXPECTED_QUEUE_DRAIN_NO_OP_REASON_CODES`, helpers) plus their tests; the drain command kind they summarized no longer exists. `summarizeSwipeRecovery` and the rest of operator metrics are untouched.
- Regression coverage: `shared/matching/matchQueueSourceRemovalContracts.test.ts`, wired into `npm run test:video-date:red-flags` and `npm run test:video-date-v4`.
- Branch delta: `docs/branch-deltas/remove-match-queue-source.md`.

Intentionally left in place (inert, documented):

- `video_sessions.queued_expires_at` column, the `p_queued_expires_at` parameter of `video_session_blocks_global_active_conflict(...)`, and the `'queued'` value in the `ready_gate_status` / `queue_status` vocabularies are kept as vestigial. After this change they have no live writer (always NULL / never set). Physically dropping them cascades into the shared global-active-conflict guard signature and generated types, which cannot be end-to-end verified in this environment; it is recorded as a clean follow-up rather than bundled into this change.
- Phase 6 queue-fairness views (`v_video_date_queue_fairness_candidates`, `v_video_date_queue_fairness_event_health`) and `get_video_date_queue_fairness_health(...)` are kept: they are an operator-observability surface read by the `admin-video-date-ops` Edge Function and `shared/observability/videoDateOperatorMetrics.ts`, independent of the matching queue flow. With no queued sessions they simply report empty/healthy.

Schema-shape note:

- No tables, columns, views, or function signatures were added or removed; only two function bodies changed. Generated `src/integrations/supabase/types.ts` is therefore unchanged and was not regenerated.

Proof boundary:

- This is a simplification/cleanup pass, not Video Date product acceptance. Static contract suites (`test:video-date-v4`, `test:video-date:red-flags`, event-lobby regression) pass, but acceptance still requires the fresh disposable two-user production run from mutual match -> Ready Gate -> same Daily room -> stable bilateral media/date -> date end -> both users persist `date_feedback`.

---

## 2026-06-09 Implementation Update: Mystery Match Removed From Event Lobby

Current source and linked Supabase cloud now remove Mystery Match from the active Event Lobby and Video Date creation path.

Implementation added:

- Web Event Lobby no longer imports or calls `useMysteryMatch`; empty-deck UI only exposes refresh/end-break behavior.
- Native Event Lobby no longer imports or calls `useMysteryMatch`; the empty-deck waiting/search CTA path was removed.
- Deleted active hook modules `src/hooks/useMysteryMatch.ts` and `apps/mobile/lib/useMysteryMatch.ts`.
- Shared empty-deck state no longer carries `showMysteryMatch`.
- Mystery Match analytics constants were removed from `shared/analytics/lobbyToPostDateJourney.ts`.
- Forward migration `20260609152000_remove_mystery_match.sql` was applied to linked Supabase cloud. It deletes existing test `video_sessions.session_source = 'mystery_match'` rows and dependent rows, drops the public/helper `find_mystery_match` RPC chain, and temporarily constrained/defaulted the now-removed source marker to `reciprocal_swipe`.
- Supabase generated types were regenerated from the linked project after the migration; `find_mystery_match` no longer appears in `src/integrations/supabase/types.ts`.
- `supabase/validation/event_lobby_active_event_contract.sql` now validates that Mystery Match RPCs are absent instead of guarded.
- Added `shared/matching/mysteryMatchRemovalContracts.test.ts` and wired it into `npm run test:event-lobby-regression`.

Proof boundary:

- This is a simplification/removal pass, not Video Date product acceptance. The only supported creation path is now swipe/mutual-match into Ready Gate.
- Video Date remains unaccepted until a fresh disposable two-user production run proves match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> survey completion by both users, plus short leave/rejoin and prolonged absence checks.

Read-only verification addendum from the same 2026-06-09 session:

- Verified branch/worktree state: `codex/remove-mystery-match-local-integration` at HEAD `eb11e826a21e76451c55927dc5b5f3337719f647`, intentionally uncommitted so the integration diff can be split into focused PRs.
- Active source/generated-type search returned zero hits for `useMysteryMatch`, `find_mystery_match`, `MYSTERY_MATCH`, `Mystery Match`, `showMysteryMatch`, and `mystery_match` across `src`, `apps/mobile`, `shared/analytics`, `supabase/functions`, and `src/integrations/supabase/types.ts`.
- Full-repo residual references are expected only in old applied migrations, `_cursor_context` snapshots, dated audit/branch-delta docs, current docs explicitly saying the feature was removed, and tests/validation asserting the RPC is absent. Active source, generated types, active validation requiring the RPC to exist, or active tests preserving the old feature are blockers.
- Linked Supabase read-only verification passed at that time: migration `20260609152000` existed on remote, post-apply dry-run returned `Remote database is up to date`, linked public-schema lint exited 0 with only legacy warning-level notices, error-level advisors returned `No issues found`, and marker SQL showed zero `find_mystery_match%` routines plus zero `session_source = 'mystery_match'` sessions. The temporary default/constraint from that pass was later removed by `20260609171950_remove_video_sessions_session_source.sql`.
- Required verification passed: `npx tsx shared/matching/mysteryMatchRemovalContracts.test.ts`, `npm run test:event-lobby-regression`, `npm run typecheck`, `npm run lint`, and `git diff --check`.
- Optional `npm run test:video-date:red-flags` passed. Optional `npm run test:video-date-v4` stopped on an unrelated formatting-sensitive assertion in `shared/matching/videoDateSprint3DailyHandoffContracts.test.ts` that expects `existing.roomName === params.roomName && existing.roomUrl === params.roomUrl` on one line; current `src/lib/webVideoDateDailyPrewarm.ts` contains the same two-condition room-name/URL guard split across lines, and neither file is part of the Mystery Match removal diff.
- PR split guidance from the original Mystery Match removal is complete through the later legacy RPC and `session_source` cleanup passes. Do not restore Mystery Match, the deprecated direct queue/session RPCs, or the session-source discriminator unless product direction changes.

---

## 2026-06-09 Implementation Update: Legacy Direct Queue/Session RPCs Removed

Current source and linked Supabase cloud now remove the deprecated direct queue/session RPC surfaces from the active Event Lobby and Video Date backend contract:

- `public.find_video_date_match(uuid, uuid)`
- `public.join_matching_queue(uuid, uuid)`
- `public.leave_matching_queue(uuid)`

Implementation added:

- Forward migration `20260609163130_remove_legacy_queue_session_rpcs.sql` drops only the two deprecated RPCs above.
- Forward migration `20260609165218_remove_leave_matching_queue.sql` drops the remaining legacy cleanup RPC only.
- Supabase generated types were regenerated from the linked project after the migrations; none of the removed RPCs appears in `src/integrations/supabase/types.ts`.
- `supabase/validation/event_lobby_active_event_contract.sql` now validates absence for all three RPCs with `to_regprocedure(...) is null`.
- Focused Event Lobby and Video Date contract tests now assert removal instead of preserving `deprecated_legacy_queue_surface` callable shims.

Proof boundary:

- The only supported Event Lobby -> Video Date creation path remains `/event/:eventId/lobby` -> deck/swipe through `swipe-actions` -> backend `handle_swipe` / `handle_swipe_v2` -> direct mutual match -> Ready Gate -> Video Date.
- Do not restore `find_video_date_match`, `join_matching_queue`, or `leave_matching_queue` as compatibility no-ops unless product direction changes.
- This legacy RPC cleanup originally preserved `drain_match_queue` and `promote_ready_gate_if_eligible`; the later Post-Date Instant Next removal supersedes that preservation and removes those queued auto-promotion surfaces while keeping Ready Gate, Video Date state-machine behavior, and post-date survey behavior.
- Historical applied migrations and older audits can still mention these RPCs as past behavior; active source, generated types, validation requiring callability, or tests preserving callable no-op behavior are blockers.
- This remains a cleanup/simplification pass, not Video Date product acceptance. Video Date is not accepted until the fresh disposable two-user production proof reaches survey completion by both users.

---

## 2026-06-09 Implementation Update: Video Session Source Discriminator Removed

Current source and linked Supabase cloud now remove the temporary `video_sessions.session_source` audit marker from the active Event Lobby and Video Date backend contract.

Implementation added:

- Forward migration `20260609171950_remove_video_sessions_session_source.sql` redefines `handle_swipe_20260601183000_deck_authority_base(...)` so it preserves `super_vibe_consumed` response truth without reading, writing, selecting, or returning `session_source`.
- The same migration drops `video_sessions_session_source_rec_swipe_only` and drops `video_sessions.session_source`.
- Supabase generated types were regenerated from the linked project after the migration; `video_sessions.Row`, `Insert`, and `Update` no longer expose `session_source`.
- `supabase/functions/swipe-actions/index.ts` and `supabase/functions/_shared/matching/videoSessionFlow.ts` no longer include `session_source` in active swipe payload types.
- `supabase/validation/event_lobby_active_event_contract.sql` now validates that the column and constraint are absent while still validating Mystery Match and legacy direct queue/session RPC absence plus supported public lobby RPC callability.
- Added `shared/matching/videoSessionSourceRemovalContracts.test.ts` and wired it into `npm run test:event-lobby-regression`.

Proof boundary:

- The only supported Event Lobby -> Video Date creation path remains `/event/:eventId/lobby` -> deck/swipe through `swipe-actions` -> `handle_swipe_v2` -> direct mutual match -> Ready Gate -> Video Date.
- Current session creation no longer stores a source discriminator. Historical migrations and older docs may still mention the temporary marker as past behavior; active source, generated types, validation, or tests must not preserve it as a current field.
- This session-source cleanup originally preserved `drain_match_queue` and `promote_ready_gate_if_eligible`; the later Post-Date Instant Next removal supersedes that queue-preservation boundary while keeping Ready Gate, the Video Date state machine, and post-date survey behavior.
- This remains a cleanup/simplification pass, not Video Date product acceptance. Video Date is not accepted until the fresh disposable two-user production proof reaches survey completion by both users.

---

## 2026-06-09 Implementation Update: Post-Date Instant Next Removed

Current local source now removes the post-date instant-next and queued auto-promotion path from the active Video Date golden flow.

Implementation added:

- Web/native `PostDateSurvey` no longer drains a match queue, prefetches queued decks, or follows server `ready_gate` / `video_date` auto-next actions after survey completion.
- Web/native Event Lobby no longer imports queue hints, polls queued counts, shows queued convergence UI, or drains queued sessions from lobby refresh/realtime paths.
- Native notification reconciliation no longer rescues queued sessions through `drain_match_queue`.
- Shared queue-drain eligibility/reason-copy helpers and queue-drain observability events were removed.
- Feature flags `video_date.post_date_instant_next_v2` and `video_date.outbox_v2.drain_match_queue` were removed from client contracts.
- Forward migration `20260610000100_remove_post_date_instant_next.sql` deletes those flags, expires existing queued sessions, rejects processing `drain_match_queue` commands, rewrites `mark_lobby_foreground` to heartbeat only, rewrites `resolve_post_date_next_surface` to return only survey/lobby/chat/wrap-up/home, strips legacy queue-drain counters from Sprint 7 ops payloads, and drops queue drain, queue hint, queued promotion, and pending-feedback queue-drain RPCs. Review follow-up migration `20260610022531_review_comments_1262_1280_followups.sql` supersedes the original non-session conversion wrapper so any delegated `match_queued` fallback promotes into the same session as a normal Ready Gate `match` instead of burning reciprocal swipes.
- Admin Video Date Ops no longer shows queue-drain health or survey-to-next-gate conversion metrics.
- Branch delta: `docs/branch-deltas/remove-post-date-instant-next.md`.

Preserved:

- Event Lobby deck/swipe, direct mutual match -> Ready Gate, Ready Gate mark-ready, `prepare_date_entry`, Video Date, post-date survey, persisted `date_feedback`, Chat, `matches`, and the global `match_id` contract.

Proof boundary:

- This is source/cloud implementation evidence, not product acceptance. Linked Supabase cloud is applied through `20260610000100_remove_post_date_instant_next.sql`, and generated Supabase types were regenerated from the linked project without reintroducing the removed RPCs. Video Date remains unaccepted until a fresh disposable two-user production run proves match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> survey completion by both users, plus short leave/rejoin and prolonged absence checks.

---

## 2026-06-09 Implementation Update: Neutral Entry Timer Aliases

Current source now introduces neutral entry/date timer aliases over the legacy handshake timer column names. This is a terminology cleanup only; deployed DB columns and runtime phase values are intentionally preserved.

Implementation added:

- New shared alias boundary `shared/matching/videoDateEntryTiming.ts` maps legacy DB fields to neutral names: `handshake_started_at` -> `entryStartedAtIso`, `handshake_grace_expires_at` -> `entryGraceExpiresAtIso`, and `date_started_at` -> `dateStartedAtIso`.
- Web/native countdown model `shared/matching/videoDateCountdown.ts` now accepts `entryStartedAtIso` and `entryDurationSeconds`.
- Web/native timer UI components are renamed to `EntryPhaseTimer`.
- Web `/date/:sessionId`, native `/date/[id]`, and native session countdown resolution use neutral names such as `entryStartedAt`, `entryTimerStarted`, `entryDeadlineUrgent`, and `entry_visible_countdown_elapsed` for active countdown/timer logic.
- Warm-up timer telemetry source action is now `server_entry_started_at`; active payloads include neutral `entry_started_at` while preserving legacy `handshake_started_at` for compatibility.
- Branch delta: `docs/branch-deltas/neutral-entry-timer-aliases.md`.

Preserved:

- `handshake_started_at` and `handshake_grace_expires_at` remain server timing columns.
- Runtime phase values remain `handshake`, `date`, and `ended`.
- `complete_handshake`, Vibe/Pass, `prepare_date_entry`, `video_date_transition('prepare_entry')`, and `video_date_transition('end')` remain active.

Proof boundary:

- This is a cleanup/simplification pass, not Video Date product acceptance. Do not remove legacy DB columns, generated type fields, or phase vocabulary until the fresh disposable two-user production proof reaches survey completion by both users.

---

## 2026-06-10 Review-Comments Follow-up: PR #1262 Through #1280

Thread-aware GitHub review scan covered the 18 most recent merged PRs chronologically: #1262, #1263, #1264, #1265, #1266, #1267, #1268, #1269, #1270, #1271, #1272, #1273, #1275, #1276, #1277, #1278, #1279, and #1280. No Copilot-authored review comments were present in that set. Codex comments with actionable findings were present on #1262, #1264, #1267, #1268, #1277, #1279, and #1280.

Already-current main coverage:

- #1262 surface-claim lease/backoff feedback is covered by the current `SURFACE_NOT_CLAIMABLE` no-backoff guard behavior and `shared/matching/reviewComments1256_1262Followups.test.ts`.
- #1264 Daily joined RPC argument-name feedback is covered by corrective migration `20260609112843_video_date_active_entry_join_arg_name_repair.sql` and generated types preserving `p_entry_attempt_id`.
- #1266 prewarm adoption feedback was already resolved/outdated in GitHub and superseded by the current Daily adoption guards.

Current follow-up implementation:

- Branch delta: `docs/branch-deltas/review-comments-1262-1280-followups.md`.
- Forward migration: `supabase/migrations/20260610022531_review_comments_1262_1280_followups.sql`.
- The migration repairs event registrations that still point at a live Ready Gate session via `current_room_id` but lost partner/status truth while stale Mystery Match suppression was cleared.
- The same migration replaces the post-auto-next swipe wrapper so a delegated `match_queued` fallback promotes the same session to a normal Ready Gate `match` instead of expiring the only reciprocal-swipe session after both swipes were recorded.
- `scripts/audit-video-date-ultimate-design.mjs` now follows `EntryPhaseTimer` paths and neutral `entryStartedAt` aliases.
- `docs/supabase-live-backend-audit.md` no longer includes removed `find_mystery_match` / `drain_match_queue` rows in the current critical-RPC existence claim.
- `docs/branch-deltas/remove-match-calls.md` records the #1277 cleanup limitation: once `match_calls` and `match-call-room-cleanup` were removed from linked cloud, a later forward migration cannot reconstruct deleted Daily room-name inventory; current verification must prove Match Calls remain absent and rely on golden Video Date cleanup for `video_sessions` room drift.
- Regression coverage: `shared/matching/reviewComments1262_1280Followups.test.ts`, wired into `npm run test:video-date:red-flags` and `npm run test:video-date-v4`.

Proof boundary:

- This is review-comment hardening and cloud-alignment work, not product acceptance. Video Date remains unaccepted until the fresh disposable two-user production run proves match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> both users persist `date_feedback`, including leave/rejoin and prolonged absence checks.

---

## 2026-06-09 Implementation Update: Standalone Enter Handshake Removed

Current source now removes standalone/client-visible `video_date_transition('enter_handshake')` from the active Video Date entry path. The golden entry command is `prepare_date_entry`, which continues to call `video_date_transition('prepare_entry')` inside `daily-room`.

Implementation added:

- Native no longer exports `enterHandshake(...)` or `enterHandshakeWithTimeout(...)` from `apps/mobile/lib/videoDateApi.ts`.
- Native `/date/[id]` no longer has an explicit prejoin `enter_handshake` branch; it checks that `prepare_date_entry`/`prepare_entry` left the session routeable/startable before Daily token and join work.
- Web/native prepare-entry telemetry no longer emits active `enter_handshake_*` checkpoint names. Active checkpoints remain `prepare_entry_started`, `prepare_entry_success`, and `prepare_entry_failure`.
- Migration `supabase/migrations/20260609202707_remove_standalone_enter_handshake.sql` wraps `public.video_date_transition(uuid,text,text)` so `p_action = 'enter_handshake'` returns structured nonretryable JSON with code `ENTER_HANDSHAKE_REMOVED` and points callers to `prepare_entry` / `prepare_date_entry`.
- `prepare_entry`, `end`, reconnect, vibe/complete-handshake, and other lifecycle actions continue delegating through the existing hot-path no-throw transition stack.
- Branch delta: `docs/branch-deltas/remove-standalone-enter-handshake.md`.

Preserved:

- `prepare_date_entry` remains the only golden web/native room and token entry command.
- `video_date_transition('prepare_entry')` remains active and owns routeable entry/timing setup.
- `video_date_transition('end')` remains active.
- `handshake_started_at` and `handshake_grace_expires_at` remain server timing columns, now aliased in active product countdown code as entry/date timer semantics.

Proof boundary:

- This is a cleanup/simplification pass, not Video Date product acceptance. Video Date is not accepted until the fresh disposable two-user production proof reaches survey completion by both users.

---

## 2026-06-09 Implementation Update: Match Calls Removed

Current source and linked Supabase cloud now remove the non-golden Chat Match Calls product surface. This is the follow-up to the earlier Daily-room non-golden action cleanup.

Implementation added:

- Web/native Chat no longer mounts `MatchCallProvider`, no longer imports `useMatchCall`, and no longer renders voice/video call buttons or incoming/active call overlays.
- Deleted Match Call client/API/helper source: `src/hooks/useMatchCall.tsx`, `apps/mobile/lib/useMatchCall.tsx`, `apps/mobile/lib/matchCallApi.ts`, web/native call overlays, `shared/chat/matchCallDiag.ts`, and `shared/chat/matchCallEdgeCodes.ts`.
- `supabase/functions/daily-room/index.ts` no longer accepts or dispatches `create_match_call`, `answer_match_call`, or `join_match_call`, and `delete_room` is Video Date participant-gated only.
- `supabase/functions/send-notification/index.ts` no longer has a `match_call` category or `notify_match_calls` mapping.
- `supabase/functions/match-call-room-cleanup/index.ts` and its `supabase/config.toml` entry were removed, and the stale deployed `match-call-room-cleanup` Edge Function was deleted from project `schdyxcunwcvddlcshwd`.
- Migration `supabase/migrations/20260609224646_remove_match_calls.sql` drops `public.match_calls`, `public.match_call_transition(...)`, `public.expire_stale_match_calls()`, `notification_preferences.notify_match_calls`, realtime publication membership, and match-call cron jobs, and rewrites active cleanup/admin RPCs away from `match_calls`.
- `src/integrations/supabase/types.ts` was regenerated after applying the linked migration.
- Branch delta: `docs/branch-deltas/remove-match-calls.md`.

Preserved:

- Chat itself remains active, including text/image/video/voice messages.
- `matches`, `match_id`, date suggestions, unmatch/block/archive/mute flows, and golden Video Date remain active.
- `prepare_date_entry`, `video_date_leave`, and Video Date `delete_room` cleanup semantics remain active.

Cloud proof:

- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --yes` applied `20260609224646_remove_match_calls.sql`.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` returned `Remote database is up to date`.
- Direct linked catalog checks returned true for absence of `match_calls`, both `match_call_transition` overloads, `expire_stale_match_calls`, `notify_match_calls`, realtime publication membership, and match-call cron jobs.
- `daily-room` and `send-notification` were deployed to linked project `schdyxcunwcvddlcshwd`.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions delete match-call-room-cleanup --project-ref schdyxcunwcvddlcshwd` deleted the obsolete deployed cleanup function; a follow-up function list showed `daily-room` and `send-notification` active and no `match-call-room-cleanup` row.

Proof boundary:

- This is Match Call removal and backend simplification evidence only. It is not Video Date product acceptance. Video Date remains unaccepted until a fresh disposable two-user production run reaches match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> both users persist `date_feedback`, including leave/rejoin and prolonged absence checks.

---

## 2026-06-09 Implementation Update: Daily-room Non-Golden Video Date Actions Removed

Current source now removes the legacy/non-golden public/client-facing `daily-room` Video Date entry action support for `create_date_room`, `join_date_room`, `ensure_date_room`, `prepare_diagnostic_entry`, and `prepare_solo_entry`.

Implementation added:

- `supabase/functions/daily-room/index.ts` no longer lists `create_date_room`, `join_date_room`, `ensure_date_room`, `prepare_diagnostic_entry`, or `prepare_solo_entry` as Daily-config-required date actions and no longer dispatches those public Video Date entry branches.
- `supabase/functions/daily-room/dailyRoomContracts.ts` removes the non-golden Video Date entry names from `DateRoomAction`; the active date-entry action is `prepare_date_entry`.
- `shared/matching/dailyRoomFailure.ts` removes `DAILY_ROOM_ACTIONS.CREATE` and `DAILY_ROOM_ACTIONS.JOIN`; unactioned 404 Daily-room failures now classify as `SESSION_NOT_FOUND` unless the server explicitly returns `ROOM_NOT_FOUND`.
- Web/native Ready Gate surfaces no longer call room-only warmup, solo prejoin, or Daily diagnostic room helpers. Readiness checks record local camera/mic capability only.
- Active observability no longer exposes `room_warmup_*` or `daily_prewarm_solo_*` checkpoints/fields; historical migrations can still mention them as past schema/checkpoint history.
- Added/updated removal coverage in `shared/matching/dailyRoomLegacyActionRemovalContracts.test.ts`, `shared/matching/readyGatePartialReadyDefinitiveClosure.test.ts`, `shared/matching/nativeReadyGateParityContract.test.ts`, and related static contracts.
- Branch delta: `docs/branch-deltas/remove-daily-room-non-golden-actions.md`.
- GitHub/Supabase deployment proof: implementation PR #1275 merged on 2026-06-09 as squash commit `7a20720ff4dd4a2e3071649398bf9697d6cc960a`; after the merge, `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions deploy daily-room --project-ref schdyxcunwcvddlcshwd --use-api` and `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions deploy admin-video-date-ops --project-ref schdyxcunwcvddlcshwd --use-api` succeeded from `main`; `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions list --project-ref schdyxcunwcvddlcshwd` showed `daily-room` ACTIVE version 865 updated at `2026-06-09 19:17:45 UTC` and `admin-video-date-ops` ACTIVE version 349 updated at `2026-06-09 19:17:54 UTC`.

Preserved:

- `prepare_date_entry` remains the web/native room and token entry path.
- Superseded follow-up: standalone `video_date_transition('enter_handshake')` is removed by `supabase/migrations/20260609202707_remove_standalone_enter_handshake.sql`; clients must use `prepare_date_entry` / `prepare_entry`.
- `video_date_leave` and `delete_room` remain cleanup/end actions required after successful Video Date flows.
- Superseded follow-up: `docs/branch-deltas/remove-match-calls.md` removes Match Calls entirely. `create_match_call`, `answer_match_call`, and `join_match_call` are no longer active after migration `20260609224646_remove_match_calls.sql`.
- Provider-side Daily room creation/reuse/verification remains inside `prepare_date_entry`.
- Existing `create_date_room_*` provider observability operation labels remain intact as shared Daily provider lifecycle internals used by `prepare_date_entry`.

Proof boundary:

- This is a cleanup/simplification pass, not Video Date product acceptance. Video Date is not accepted until the fresh disposable two-user production proof reaches survey completion by both users.

---

## 2026-06-09 Implementation Update: Hot-Path No-Throw Shells And Daily Same-Session Adoption

Current local source now includes the next active-entry hardening pass after the latest production failure still stalled at `/date/:sessionId` with `Still connecting...`.

Failure model addressed:

- The latest two-user production run showed both users reaching Ready Gate readiness, then oscillating between Ready Gate and `/date/:sessionId` while the date shell stayed in `Opening the room...` / `Still connecting...`.
- Network screenshots showed repeated/pending active-path calls plus raw 500s on `record_video_date_launch_latency_checkpoint` and `video_date_transition`; earlier failure classes also included `claim_video_date_surface`, `mark_video_date_daily_alive`, and `mark_video_date_daily_joined`.
- Backend chronology from the prior session showed Daily room/session creation was not sufficient proof: one side could briefly have provider evidence while durable bilateral media never stabilized.
- The remaining client-side race was same-session Daily ownership. Route entry, retry, remount recovery, and legitimate Ready Gate prewarm could see an existing fresh/protected Daily call as an external call and return `external_call_busy` instead of using the existing same-session owner safely.

Implementation added:

- Migration `20260609130139_video_date_hot_path_no_throw_daily_adoption.sql` adds final no-throw public shells around the active hot-path RPCs:
  - `claim_video_date_surface(uuid,text,text,boolean,integer)`
  - `mark_video_date_daily_alive(uuid,text,text,text,text,text)`
  - `mark_video_date_daily_joined(uuid,text,text,text,text,text)`
  - `video_date_transition(uuid,text,text)`
  - `video_session_mark_ready_v2(uuid,text,text)`
  - `record_video_date_launch_latency_checkpoint(uuid,text,jsonb,integer)`
- Each wrapper delegates to a preserved base implementation and returns sanitized retryable JSON if the base throws. If the richer lifecycle exception helper fails, the wrapper still returns a direct last-resort JSON payload instead of surfacing a transport 500.
- Web and native/mobile Daily guards now tag fresh call objects with `videoDateSessionId` and Daily room name, serialize creation, and let route entry, retry, and remount recovery adopt a current/protected same-session call when they ask for the same session/room.
- Web `useVideoCall`, web Daily prewarm, native/mobile Daily prewarm, and native/mobile `/date/[id]` active entry pass those session/room markers into the guard. Ready Gate prewarm intentionally does **not** adopt a route-owned active call; it fails soft with guard diagnostics instead of wrapping the live route call in prewarm TTL/fallback cleanup.
- Web `/date/:sessionId` now has bounded automatic retry for retryable start failures while the route shell still owns the active date and the user has not explicitly exited.
- New diagnostics cover adopted same-session calls, adopted current call objects, protected-call owner/requested session-room markers, and bounded start-retry scheduling/firing/exhaustion.
- Contract coverage in `shared/matching/videoDateDefinitiveOwnershipContracts.test.ts`, `shared/matching/videoDateActiveEntryFailsoftShellContracts.test.ts`, and `shared/matching/videoDateEndToEndHardening.test.ts` now locks the web/native route adoption paths, prewarm non-adoption, and final no-throw RPC shell shape.
- Branch delta: `docs/branch-deltas/fix-video-date-hot-path-no-throw-daily-adoption.md`.

Verification completed locally:

- `npx tsx shared/matching/videoDateActiveEntryFailsoftShellContracts.test.ts`
- `npx tsx shared/matching/videoDateDefinitiveOwnershipContracts.test.ts`
- `npx tsx shared/matching/reviewComments1256_1262Followups.test.ts`
- `npx tsx shared/matching/videoDateStableBilateralMediaGateContracts.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm run test:video-date:red-flags`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` showed exactly pending migration `20260609130139_video_date_hot_path_no_throw_daily_adoption.sql` at local verification time.

Cloud/proof boundary:

- This section describes the source and migration contract; publish close-out must apply and verify linked cloud, and clients must be redeployed, before claiming source/cloud runtime alignment.
- Final post-review verification avoided additional web/native builds. One earlier local smoke harness invocation did run the web build, so build output is not used as acceptance evidence here.
- This still is not product acceptance. Video Date is not fixed until a fresh disposable two-user production run proves match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> survey completion by both users, plus short leave/rejoin and prolonged absence checks.

---

## 2026-06-09 Implementation Update: Lean Runtime Contract Foundation

Current local source now includes the first simplification foundation for Video Date. This does not change production routing, Supabase RPC behavior, Edge Function behavior, or Daily provider behavior. It defines the smaller screen/command contract that future web/native migrations should converge on.

Implementation added:

- `docs/contracts/video-date-lean-runtime-contract.md` defines the lean screen model: `lobby`, `ready_gate`, `date`, `survey`, `done`, and `blocked`.
- `shared/matching/videoDateLeanRuntimeContract.ts` wraps the existing canonical route decision layer and exposes normalized lean commands, command ownership, web path, native path, participant state, and snapshot metadata.
- `shared/matching/videoDateLeanRuntimeContract.test.ts` asserts the golden-path screen sequence, command ownership, and that the contract wraps existing read surfaces instead of introducing a duplicate backend source of truth.
- Branch delta: `docs/branch-deltas/video-date-lean-runtime-contract.md`.

Backend scope:

- No Supabase migration was added.
- No Edge Function was changed.
- The read-model boundary intentionally reuses `get_video_date_start_snapshot_v1`, `video-date-snapshot`, and `get_video_date_snapshot_core` instead of adding a new runtime snapshot RPC before clients consume the contract.

Verification completed:

- `npx tsx shared/matching/videoDateLeanRuntimeContract.test.ts`
- `npm run test:video-date-v4`
- `npm run typecheck`

Proof boundary:

- This is architecture/simplification groundwork only. Video Date remains unaccepted until a fresh disposable two-user production run proves match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> both users persist `date_feedback`, including leave/rejoin and prolonged absence checks.

---

## 2026-06-09 Implementation Update: Active Entry Stable Shell And Hot-Path Fail-Soft

Current local source now includes the active-entry recovery layer for failed production session `d54c5fdb-67f2-4fca-93c5-30936b8af8cb`, event `25e67136-43fa-44de-9f71-475272bc4f59`.

Post-publish repair:

- Live catalog verification after applying `20260609105249_video_date_active_entry_failsoft_shell.sql` found that the public `mark_video_date_daily_joined(uuid,text,text,text,text,text)` wrapper exposed its fifth PostgREST argument as `p_provider_participant_id`.
- Current web/native clients and generated types call that argument as `p_entry_attempt_id`; positional SQL delegation still worked, but named PostgREST calls could fail.
- Corrective migration `20260609112843_video_date_active_entry_join_arg_name_repair.sql` drops and recreates the public wrapper with fifth argument `p_entry_attempt_id`, preserves active-entry fail-soft behavior, and keeps delegation to `mark_video_date_daily_joined_20260609105249_active_entry_base(...)`.
- `shared/matching/videoDateActiveEntryFailsoftShellContracts.test.ts` now locks this public argument name.

Failure model from the latest two-user run:

- Ready Gate reached the both-ready handoff, but `/date/:sessionId` stayed in `Opening the room...` / `Still connecting...`.
- Network evidence showed active hot-path failures/pending churn around `daily-room`, direct `video_date_transition`, `record_video_date_launch_latency_checkpoint`, and earlier `mark_video_date_daily_joined`.
- Supabase chronology showed one participant reached `/date` and claimed the video-date surface once, but the claim expired before durable Daily provider presence existed. That participant never produced provider-backed Daily join/presence.
- The peer later prepared/joined Daily briefly, then left; stable bilateral media never certified, `date_started_at` stayed null, and no `date_feedback` rows were expected or created.
- The stable-media gate was doing the correct thing by refusing promotion/survey. The remaining root cause was the asymmetric active-entry shell: route ownership/surface ownership and retryable hot-path RPC responses were not continuous enough during the pre-stable handoff.

Implementation added:

- Web `/date/:sessionId` now treats `videoDateAccess === "allowed"` as the stable single-owner shell. `useVideoDateDupTabGuard(...)` stays active for the full allowed route shell until terminal survey, explicit exit, feedback, or ended phase, instead of waiting for handshake/date truth before renewing backend surface claims.
- Existing web surface-claim behavior still treats `SURFACE_NOT_CLAIMABLE` as no-backoff retry while backend route state catches up, but duplicate-tab/local lease protection begins immediately once the date route is allowed.
- Native/mobile already had the stronger shape: active surface ownership spans eligible entry, joining, connecting, local Daily room presence, handshake, and date. Contract coverage now keeps web and native aligned around this invariant.
- `supabase/functions/daily-room/index.ts` now maps retryable `prepare_entry` and `confirm_prepare_entry` payloads to retryable 409-style responses instead of falling through to default 500 status mapping.
- New migration `20260609105249_video_date_active_entry_failsoft_shell.sql` wraps the final public active-entry RPCs without changing their base state-machine logic:
  - `video_session_mark_ready_v2(uuid,text,text)`
  - `video_date_transition(uuid,text,text)`
  - `mark_video_date_daily_joined(uuid,text,text,text,text,text)`
  - `record_video_date_launch_latency_checkpoint(uuid,text,jsonb,integer)`
- These wrappers return sanitized retryable JSON with `active_entry_failsoft_shell=true` on uncaught helper/observability failures, with last-resort fallback JSON if the richer lifecycle exception payload builder itself fails.
- Added `shared/matching/videoDateActiveEntryFailsoftShellContracts.test.ts`, wired into both `npm run test:video-date:red-flags` and `npm run test:video-date-v4`.
- Updated `shared/matching/videoDateStableBilateralMediaGateContracts.test.ts` and `shared/matching/reviewComments1256_1262Followups.test.ts` so they assert route-shell ownership starts at allowed `/date`, not only after handshake/date truth appears.
- Branch delta: `docs/branch-deltas/fix-video-date-active-entry-failsoft-shell.md`.

Verification completed:

- `npx tsx shared/matching/videoDateActiveEntryFailsoftShellContracts.test.ts`
- `npx tsx shared/matching/videoDateStableBilateralMediaGateContracts.test.ts`
- `npx tsx shared/matching/reviewComments1256_1262Followups.test.ts`
- `npx tsx shared/matching/videoDateFailsoftDateRoomRpcs.test.ts`
- `npm run test:video-date:red-flags`
- `npm run test:video-date-v4`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked` showed the new local migration `20260609105249_video_date_active_entry_failsoft_shell.sql` pending with no remote counterpart.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` showed exactly that pending migration would be pushed.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error` exited 0 with only legacy warning/notice output.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db advisors --linked --level error --fail-on error` returned `No issues found`.

Cloud/proof boundary:

- This section describes local source and migration implementation until the new migration is applied to linked Supabase cloud and clients are redeployed.
- This still is not product acceptance. Video Date is not fixed until a fresh disposable two-user production run proves match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> survey completion by both users, plus short leave/rejoin and prolonged absence checks.

---

## 2026-06-09 Implementation Update: PR #1256-#1262 Review-Comments Follow-Up

Current source and linked Supabase cloud now include the follow-up pass for actionable GitHub review comments on the last seven merged PRs: `#1256`, `#1257`, `#1258`, `#1259`, `#1260`, `#1261`, and `#1262`.

Review scope:

- Thread-aware GitHub review-comment inspection found Codex-authored comments on the last seven PRs and no Copilot-authored review threads requiring action.
- PR `#1260` had an already-resolved/outdated Codex thread and did not require a source change.
- Actionable Codex threads were present on PRs `#1256`, `#1257`, `#1258`, `#1259`, `#1261`, and `#1262`.

Implementation added:

- Web surface claim ownership now waits for claimable date/handshake truth before activating the lease, and `SURFACE_NOT_CLAIMABLE` resets duplicate-tab claim backoff instead of growing an exponential retry delay.
- Web and native/mobile remote-seen retry loops keep the originally accepted render/media evidence source in `p_evidence_source`; retry labels remain diagnostic metadata only.
- Native/mobile `PostDateSurvey` queue-drain execution now reads fast-changing UI/callback state from a runtime ref, so verdict UI transitions no longer cancel the drain and strand an already-keyed queued Ready Gate.
- Review-comment documentation was scoped to the historical verification moments that produced it: the PR #1259 audit no longer presents `20260608215911` as the current top migration, and the command center scopes the `4e9f87d` main/origin-main alignment statement to the PR #1257 verification moment.
- Added `shared/matching/reviewComments1256_1262Followups.test.ts`, wired into both `npm run test:video-date:red-flags` and `npm run test:video-date-v4`.
- Updated older remote-seen/static contracts so they assert the preserved base evidence source instead of the retry attempt label.
- Branch delta: `docs/branch-deltas/fix-video-date-review-comments-1256-1262-followups.md`.

Verification completed:

- `npx tsx shared/matching/reviewComments1256_1262Followups.test.ts`
- `npx tsx shared/matching/reviewComments1188_1197Followups.test.ts`
- `npx tsx shared/matching/reviewComments1242_1256Followups.test.ts`
- `npx tsx shared/matching/videoDateStrictDailyJoinRemoteSeen.test.ts`
- `npx tsx shared/matching/videoDateStableBilateralMediaGateContracts.test.ts`
- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
- `npm run test:video-date:red-flags`
- `npm run test:video-date-v4`
- `npm run typecheck`
- `npm run lint`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked` showed local and remote aligned through `20260609045533_video_date_pre_stable_survey_eligibility.sql`.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` returned `Remote database is up to date.`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error` exited 0 with only legacy warning/notice output.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db advisors --linked --level error --fail-on error` returned `No issues found`.

Cloud scope:

This branch changes source, tests, and docs only. No new Supabase migration or Edge Function was introduced, so no `supabase db push --linked --yes` or function deploy was required; linked cloud verification shows the existing cloud state is already aligned.

Proof boundary:

This is review-comment hardening evidence only. Video Date is still not product-accepted until a fresh disposable two-user production run proves match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> survey completion by both users, plus short leave/rejoin and prolonged absence checks.

---

## 2026-06-09 Implementation Update: Definitive Active Media Ownership, Stable Certification, And Survey Persistence

Current source and linked Supabase cloud now include the definitive active-media ownership layer on top of the stable bilateral media gate work.

Problem addressed:

- The previous stable gate still had no persistent stable-media certification marker, so an already-started session could not distinguish certified real media from historical provider overlap.
- The promotion gate did not require live surface ownership, leaving a path where provider overlap and heartbeat evidence could promote without continuous `/date` ownership on both sides.
- Provider absence after a false pre-stable encounter could still send users to survey as if a real date had happened.
- Web and native/mobile Daily start could still expose active-path `external_call_busy` under route remount/prewarm/retry races instead of coalescing or internally retrying.
- Web surface ownership could gap during same-session hot remounts, and native/mobile surface ownership could drop before Daily/date proof was stable.
- Post-date survey UI trusted verdict responses without proving the actor's `date_feedback` row was actually persisted.

Implementation added:

- Migration `20260609035833_video_date_definitive_active_media_ownership.sql` adds `video_sessions.stable_bilateral_media_at`, `stable_bilateral_media_source`, and `stable_bilateral_media_detail`.
- New service helper `video_date_active_surface_claims_v1(...)` requires both participants to hold current unexpired `video_date` surface claims.
- New service helper `video_date_mark_stable_bilateral_media_v1(...)` persists the first stable bilateral media certification.
- `video_date_stable_bilateral_media_gate_v1(...)` now requires active bilateral surface claims plus either fresh heartbeat-backed stable copresence or explicit bilateral render-bound remote-seen proof. It no longer treats `state = 'date'` as sufficient unless stable certification already exists.
- Provider-overlap, confirmed-encounter, and auto-promote wrappers now mark stable certification before delegating to their preserved base implementations.
- `video_date_reconcile_provider_absence_v1(...)` now downgrades uncertified pre-stable terminal absence to `pre_stable_media_failed`, clears users back to retryable idle/browsing state, and returns `survey_required = false`.
- `shared/matching/videoDateRouteDecision.ts` treats `pre_stable_media_failed` as survey-ineligible.
- Web `useVideoCall` adds a bounded per-session/user Daily create retry loop for `external_call_busy` and `cleanup_pending`, while preserving the existing module-scope single-flight start gate.
- Web `useVideoCall` now makes start-gate observers adopt the current hook owner after a remount. Awaiting another owner is not enough; the observing route instance must hydrate its own call/listener/heartbeat state or retry internally without creating a second Daily call.
- Web `useVideoDateDupTabGuard` bridges same-tab server surface claims only for a short same-session hot remount window so ownership does not gap before the new owner reclaims. Terminal survey, explicit end, manual exit, and ended route cleanup release the server claim instead of keeping a stale bridge alive.
- Devil's-advocate audit found the bridge/release decision ref was passive-effect synchronized, so cleanup from a render that flips `leaseActive` false could still observe the previous callback. The hook now layout-syncs that callback before passive cleanup, keeping terminal survey and explicit-exit cleanup on the release path.
- Web `VideoDate` and native/mobile `/date/[id]` emit route ownership diagnostics with `routeMountId` and `routeOwnerId`.
- Native/mobile Daily creation adds the same bounded retry behavior, and active surface ownership now remains true through eligible entry, handshake/date, joining, connecting, and local Daily room presence.
- Web and native/mobile `PostDateSurvey` now confirm the current actor's `date_feedback` row after verdict persistence before advancing route state.
- Late audit found one server-side survey eligibility gap: `pre_stable_media_failed` was client-route-ineligible but not yet excluded by the shared database survey helpers. Migration `20260609045533_video_date_pre_stable_survey_eligibility.sql` now excludes it in both helper generations so lifecycle payload enrichment cannot re-open survey from stale date-started/remote-seen truth.
- Generated Supabase types and `shared/matching/videoDateStableBilateralMediaGateContracts.test.ts` were updated for the new RPCs, stable columns, ownership diagnostics, route decision, and survey feedback-row confirmation.

Verification completed:

- `npx tsx shared/matching/videoDateStableBilateralMediaGateContracts.test.ts`
- `npx tsx shared/observability/videoDateClientStuckObservability.test.ts`
- `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`
- `npx tsx shared/matching/videoDateDefinitiveOwnershipContracts.test.ts`
- `npm run test:video-date:red-flags`
- `npm run typecheck`
- `npm run lint`
- `npm run test:video-date-v4`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 npm run regen:supabase-types`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --yes`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` returned `Remote database is up to date.`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error` exited 0 with only legacy warning/notice output.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db advisors --linked --level error --fail-on error` returned `No issues found`.
- Live catalog query verified deployed markers for the stable columns, `video_date_active_surface_claims_v1(...)`, `video_date_mark_stable_bilateral_media_v1(...)`, preserved provider absence base, no raw already-date shortcut without certification, pre-stable provider absence no-survey downgrade, stable gate surface-claim enforcement, and `pre_stable_media_failed` server-side survey ineligibility.
- Late audit verified live `date_feedback` RLS/grants support the survey confirmation guard: RLS is enabled, `authenticated` has `SELECT`, and the own-feedback policy is `auth.uid() = user_id`.
- Late audit verified the live `mark_video_date_daily_joined(uuid,text,text,text,text,text)` wrapper is `SECURITY DEFINER`, authenticated-callable, delegates through the last-resort base, and contains the v2 exception/enrich/sanitize shell.
- Late audit lesson: live catalog marker predicates must match deployed wrapper generations. An initial marker that looked for the older `video_date_lifecycle_exception_payload_v1` helper returned false, but direct function inspection showed the deployed wrapper correctly uses `video_date_lifecycle_exception_payload_v2(...)` plus `video_date_lifecycle_enrich_and_sanitize_payload_v2(...)`. When a marker disagrees with expected behavior, inspect `pg_get_functiondef(...)` before declaring a regression.
- Generated-type lesson: use the repo's canonical `npm run regen:supabase-types` path rather than raw `supabase gen types` as the source of truth. The canonical script preserves the repo header and local nullability patches while pulling newly generated schema entries, including previously missing post-date reminder/certification feedback tables.

Proof boundary:

This is source, migration, test, and linked-cloud implementation evidence only. Video Date is still not product-accepted until a fresh disposable two-user production run proves match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> survey completion by both users, plus short leave/rejoin and prolonged absence checks.

---

## 2026-06-09 Implementation Update: Stable Bilateral Media Gate And Durable Date Ownership

Current source and linked Supabase now implement the recovery plan from failed production session `ec02c212-3cee-4af3-9d4d-dc0e9b846188`.

Problem addressed:

- The failed run showed `/date/:sessionId` route churn while the UI sat on `Opening your date`, with repeated `mark_video_date_daily_joined` 500s, many pending `mark_video_date_daily_alive`/surface/transition calls, and a return to Ready Gate/lobby despite the date route needing to own the handoff.
- The frontend route-owner mark still waited for Daily connection evidence, which left the date route unowned during the exact opening-room window where EventLobby/Ready Gate recovery loops could compete.
- Web duplicate Daily start protection was hook-local, so full route remounts could lose the in-flight guard and start another Daily join.
- Native/mobile active handoff cleanup still depended on date-established state, so an early pre-date remount could tear down a live Daily handoff before the bilateral media/date proof existed.
- Backend promotion needed one final guard: one-sided remote-seen, one-sided provider overlap, or stale pre-date evidence must not promote to a real date or survey-eligible encounter.

Implementation added:

- `src/pages/VideoDate.tsx` now marks `/date/:sessionId` route ownership as soon as `videoDateAccess === "allowed"` and the user/session are known, before Daily connection state exists. It also ignores stale async start results after effect cleanup.
- `src/hooks/useVideoCall.ts` now has a module-scope web Daily start gate keyed by session/user, so route remounts share one in-flight `startCall(...)` result. Internal retries bypass only that outer gate with `skipStartGate: true`. A second audit pass confirmed web Daily singleton preservation remains disabled during feedback, terminal survey recovery, and ended states, so immediate allowed-route ownership cannot preserve Daily past terminal cleanup.
- Devil's-advocate audit found a real web-side proof gap: `requestVideoFrameCallback` render validation could prove a remote frame but only update local playback state. The validator now routes that proof through `markRemoteFirstFrameRendered(...)`, which stamps canonical `mark_video_date_remote_seen(...)` with `request_video_frame_callback`; ready-state fallback uses the backend-accepted `first_remote_frame` evidence label.
- `apps/mobile/app/date/[id].tsx` now marks native/mobile date route ownership before join when entry permission is eligible and preserves active Daily handoff during pre-date cleanup unless feedback/terminal/error/left-meeting truth is present.
- Migration `20260609014410_video_date_stable_bilateral_media_gate.sql` adds `video_date_stable_bilateral_media_gate_v1(...)` and wraps `video_date_promote_provider_overlap_v1(...)`, `video_date_promote_confirmed_encounter_v1(...)`, and `video_session_handshake_auto_promote_v2(...)`.
- Deep audit correction migration `20260609022729_video_date_auto_promote_stable_bilateral_media_gate.sql` hardens `video_session_handshake_auto_promote_v2(...)` so it checks lifecycle eligibility and stable bilateral media before delegating to the preserved legacy auto-promoter base. This closes the gap where auto-promote previously only tagged `stable_bilateral_media_gate_checked` after delegation.
- Second devil's-advocate correction migration `20260609031421_video_date_stable_bilateral_media_one_sided_guard.sql` tightens `video_date_stable_bilateral_media_gate_v1(...)` again. The first gate blocked one-sided remote-seen only on the bilateral remote-seen branch; the owner-heartbeat branch could still pass with exactly one participant carrying render-bound remote-seen proof. The corrected gate now allows promotion only after existing date truth, fresh bilateral owner heartbeat overlap with stable copresence and no one-sided remote-seen asymmetry, or bilateral render-bound remote-seen.
- New structured block events/results include `stable_bilateral_media_promotion_waiting`, `confirmed_encounter_stable_bilateral_media_waiting`, `stable_bilateral_media_auto_promotion_waiting`, and `promotion_blocked_by_stable_bilateral_media`.
- Generated Supabase types were refreshed from the linked public schema so the new stable gate and short base helper RPCs are represented in `src/integrations/supabase/types.ts`.
- Contract coverage: `shared/matching/videoDateStableBilateralMediaGateContracts.test.ts`, wired into `npm run test:video-date:red-flags` and `npm run test:video-date-v4`, with existing review/runtime contracts updated to the stronger ownership model.
- Branch delta: `docs/branch-deltas/fix-video-date-stable-bilateral-media-gate.md`.

Verification completed:

- `npx tsx shared/matching/videoDateStableBilateralMediaGateContracts.test.ts`
- `npx tsx shared/matching/videoDateStrictDailyJoinRemoteSeen.test.ts`
- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
- `npx tsx shared/matching/reviewComments1188_1197Followups.test.ts`
- `npm run test:video-date-v4`
- `npm run typecheck`
- `npm run lint`
- `npm run test:video-date:red-flags`
- `git diff --check`
- `jq empty package.json`
- `npm run launch:preflight`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --yes`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` returned `Remote database is up to date.`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error` exited 0 with only legacy warning/notice output.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db advisors --linked --level error --fail-on error` returned `No issues found`.
- Live catalog query verified deployed markers for `video_date_stable_bilateral_media_gate_v1`, `video_date_promote_provider_overlap_v1`, `video_date_promote_confirmed_encounter_v1`, `video_session_handshake_auto_promote_v2`, and the preserved short base functions.
- Live catalog query verified `mark_video_date_remote_seen(...)` accepts `request_video_frame_callback` and still requires explicit render evidence before delegating.
- Deep audit live catalog query verified `video_session_handshake_auto_promote_v2(...)` now calls `video_date_session_lifecycle_eligibility_v1(...)`, calls `video_date_stable_bilateral_media_gate_v1(p_session_id)`, emits `stable_bilateral_media_auto_promotion_waiting`, returns `promotion_blocked_by_stable_bilateral_media`, and calls `vd_auto_promote_stable_media_base(...)` only after the gate.
- Deep audit grants query verified stable-media helper/base functions remain service-role only, while authenticated clients retain only the intended public wrapper access.
- Second live catalog query verified the deployed `video_date_stable_bilateral_media_gate_v1(...)` heartbeat branch contains `AND NOT v_one_remote_seen`, with the service-only function comment updated accordingly.

At the time of this stable-gate pass, Supabase cloud was aligned through `20260609031421_video_date_stable_bilateral_media_one_sided_guard.sql`. This is superseded by the definitive active-media ownership section above; current linked Supabase is aligned through `20260609045533_video_date_pre_stable_survey_eligibility.sql`.

This is source, migration, and cloud implementation evidence. It is not product-health proof until a fresh disposable two-user production run completes match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> both users persist `date_feedback`, including short leave/rejoin and prolonged absence checks.

---

## 2026-06-09 Implementation Update: Strict Daily Join And Remote-Seen Proof

Current source adds the strict proof layer for the `Both join same Daily room` and `Remote media observed` stages.

Problem addressed:

- `mark_video_date_daily_alive(...)` still had an older provider-lag bridge where missing Daily webhook evidence could be treated as current joined proof.
- Web and native/mobile could call canonical `mark_video_date_remote_seen(...)` from Daily participant/snapshot hydration events, before rendered remote media evidence existed.
- Promotion RPCs could be reached from hot paths without reusing the full session lifecycle eligibility now used by Ready Gate.

Implementation added:

- Migration `20260609003604_video_date_strict_daily_join_remote_seen.sql` adds service-only lifecycle eligibility and current provider-session proof helpers.
- Public `mark_video_date_daily_alive(...)` is wrapped so joined stamps require a matching Daily `participant.joined` webhook for the same provider session and no newer same-provider-session `participant.left`.
- Public `mark_video_date_remote_seen(...)` is wrapped with `p_evidence_source`; accepted evidence is render/media-bound (`loadeddata`, `playing`, `remote_track_mounted`, `first_remote_frame`, or `request_video_frame_callback`) before delegating to the existing provider/current-call guard.
- Provider-overlap and client auto-promote RPCs now check the same lifecycle eligibility before they can promote to date.
- Web `/date/:sessionId` and native/mobile `/date/[id]` no longer stamp server remote-seen from `participant_joined`, `participant_updated`, post-join snapshots, or shared-call snapshots.
- Generated Supabase RPC types now include `p_evidence_source`.
- Contract coverage: `shared/matching/videoDateStrictDailyJoinRemoteSeen.test.ts`, wired into `npm run test:video-date:red-flags` and `npm run test:video-date-v4`.
- Branch delta: `docs/branch-deltas/fix-video-date-strict-daily-join-remote-seen.md`.

Verification completed in this local pass:

- `npx tsx shared/matching/videoDateStrictDailyJoinRemoteSeen.test.ts`
- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
- `npx tsx shared/matching/reviewComments1188_1197Followups.test.ts`
- `npm run test:video-date:red-flags`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `npm run test:video-date-v4`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` showed pending migration `20260609003604_video_date_strict_daily_join_remote_seen.sql` during that local pass.
- Superseding note: later recovery passes applied this migration; current linked Supabase is now aligned through `20260609022729_video_date_auto_promote_stable_bilateral_media_gate.sql`.

The stricter public `mark_video_date_remote_seen(...)` wrapper requires updated web/native/mobile clients that send `p_evidence_source`. This remains source/migration/test evidence until updated clients are deployed and a fresh disposable two-user production run proves both users persist `date_feedback`.

---

## 2026-06-09 Implementation Update: Prepare-Entry Terminal Blockers And Pre-Date Exit Ownership

Current source now closes the concrete `/date/:sessionId owns the flow` gaps found in the June 9 assessment pass.

Problem addressed:

- Shared Ready Gate prepare-entry recovery only treated event-inactive truth as nonretryable. Auth, access, blocked-pair, session-ended/session-missing, room-missing, and terminal Daily auth/request failures could fall through to retry exhaustion and then be marked date-owned.
- Web `/date/:sessionId` had direct pre-date Back exits from media-permission failure, handshake-start failure, and retryable call-start failure screens. Those bypassed the existing `handlePreDateExit(...)` path that clears route ownership, stops Daily, signals a pre-date server end, suppresses Ready Gate bounce, and routes only after server cleanup work is attempted.
- The web Ready Gate overlay had drifted back toward top-aligned mobile presentation while existing UX contracts require the overlay to remain centered, not a bottom-sheet style handoff surface.

Implementation added:

- `shared/matching/readyGateTerminalRecovery.ts` now exposes `isReadyGatePrepareEntryTerminalBlocker(...)` and keeps `isReadyGatePrepareEntryNonRetryable(...)` as the compatible public alias.
- Prepare-entry terminal blockers now include `UNAUTHORIZED`/`auth`, `ACCESS_DENIED`, `BLOCKED_PAIR`, `SESSION_ENDED`, `SESSION_NOT_FOUND`, `ROOM_NOT_FOUND`, `DAILY_AUTH_FAILED`, `DAILY_CREDENTIALS_INVALID`, `DAILY_REQUEST_REJECTED`, and status-only `401`/`403`/`404`/`410` while preserving retryable `READY_GATE_NOT_READY` races even when they carry HTTP `403`.
- Web Ready Gate overlay, native Ready Gate overlay, native standalone Ready route, native Event Lobby, and native pre-navigation startability now pass available `httpStatus` into the shared classifier.
- Web media-permission, handshake-start, and retryable call-start Back buttons now call `handlePreDateExit(...)` instead of direct navigation.
- Web Ready Gate overlay mobile alignment is restored to centered alignment.
- Static contracts now cover terminal prepare-entry classification, web pre-date exit ownership, current native/mobile date-route formatting, and the centered overlay contract.
- Branch delta: `docs/branch-deltas/fix-video-date-prepare-entry-terminal-and-predate-exit-ownership.md`.

Verification completed in this local pass:

- `npx tsx shared/matching/readyGateTerminalUxObservability.test.ts`
- `npx tsx shared/matching/videoDateDefinitiveOwnershipContracts.test.ts`
- `npx tsx shared/matching/nativeVideoDateContractRecovery.test.ts`
- `npx tsx shared/matching/videoDateDefinitiveHandoffRecovery.test.ts`
- `npx tsx shared/matching/nativeReadyGateParityContract.test.ts`
- `npx tsx shared/matching/reviewComments1242_1256Followups.test.ts`
- `npx tsx shared/matching/videoDateStartSnapshotContracts.test.ts`
- `npm run test:video-date:red-flags`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `npm run test:video-date-v4`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked` showed local and remote aligned through `20260608224048`.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` returned `Remote database is up to date.`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error` exited 0 with only existing warning/notice-level legacy output.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db advisors --linked --level error --fail-on error` returned `No issues found`.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 npm run verify:video-date:functions -- --require-remote` returned `42 pass, 0 warn, 0 fail`.

No Supabase migration or Edge Function deployment was needed for this pass; the change is client/shared-source ownership behavior plus regression coverage.

This remains source/test/cloud-alignment evidence. It does not replace the fresh disposable two-user production run through both users persisting `date_feedback`.

---

## 2026-06-09 Implementation Update: Definitive Ownership Contract Guard

Current source adds `shared/matching/videoDateDefinitiveOwnershipContracts.test.ts`, wired into `npm run test:video-date:red-flags` and `npm run test:video-date-v4`.

This is a source/test hardening pass. No runtime code or Supabase migration was needed because the current web/native/mobile implementation already keeps the checked owners separated:

- `video_session_mark_ready_v2` is Ready Gate owned.
- `both_ready` routes ownership to `/date/:sessionId`, but it is not Daily-start proof.
- Daily room metadata alone is not completion proof.
- `/date/:sessionId` and native `/date/[id]` are the only client owners that can stamp `mark_video_date_daily_alive`, `mark_video_date_daily_joined`, and `mark_video_date_remote_seen`.
- Terminal survey truth stays date-route owned because `PostDateSurvey` is hosted on `/date/:sessionId`.
- Client source contains no direct `date_feedback` writes; completion remains only persisted feedback through the backend-owned verdict path.

Branch delta: `docs/branch-deltas/fix-video-date-definitive-ownership-contracts.md`.

Verification passed:

- `npx tsx shared/matching/videoDateDefinitiveOwnershipContracts.test.ts`
- `npm run test:video-date:red-flags`
- `npm run test:video-date-v4`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` (`Remote database is up to date.`)

This remains source/test evidence only. It does not replace the fresh two-user production run through both users persisting `date_feedback`.

---

## 2026-06-09 Implementation Update: PR #1242-#1256 Review Comments Follow-Up

PR #1257 used the GitHub review-comments workflow for the last 15 PRs, `#1242` through `#1256`. No actionable Copilot-authored review comments were found. Current Codex review comments were mapped to source, migrations, and docs, then handled with targeted code fixes plus one forward Supabase corrective migration.

Implemented follow-ups:

- `docs/sql/video-date-invariants.sql` now applies active `video_date_certification_feedback_exceptions` to both missing-feedback warning rows, including `survey_pending_feedback_held_in_survey`.
- Web and native `PostDateSurvey` queue-drain handlers ignore stale same-session `pending_post_date_feedback` callbacks after verdict submission, confirmation, partner-wait, or finish-in-flight state instead of reopening the verdict step.
- Native Ready Gate overlay, standalone Ready route, and native Event Lobby no longer mark `/date` owned or route to date on nonretryable `prepare_date_entry` failures such as inactive/ended event truth.
- Web parked Daily singleton reuse now transfers/stops the old alive-heartbeat timer when the parked call is consumed, so a remounted date owner cannot leave the previous heartbeat interval running.
- Migration `20260608224048_review_comments_1242_1256_followups.sql` keeps zero-feedback reminders scoped to the current survey room, prevents retryable eligibility failures from terminalizing Ready Gate, makes `mark_video_date_remote_seen(...)` require server-recorded owner/call heartbeat proof in addition to provider proof, and strips nested `auxiliary_errors` plus raw diagnostics from mark-ready safety-check failures.
- Source migration `20260608171837_video_date_active_owner_terminal_truth.sql` received a syntax-only `END;` repair for replayability after review caught an unterminated `DO` block in the repository copy. Behavioral database changes stay in the new forward migration.
- Branch delta: `docs/branch-deltas/fix-video-date-review-comments-1242-1256-followups.md`.
- Contract coverage: `shared/matching/reviewComments1242_1256Followups.test.ts`, wired into `npm run test:video-date:red-flags` and `npm run test:video-date-v4`.

Verification completed before merge:

- `jq empty package.json`
- `npx tsx shared/matching/reviewComments1242_1256Followups.test.ts`
- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
- `npm run test:video-date:red-flags`
- `npm run test:video-date-v4`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` planned only `20260608224048_review_comments_1242_1256_followups.sql`.

Publish and cloud verification completed after merge:

- At the PR #1257 verification moment, PR #1257 merged to `main` as `4e9f87d7107b92a3e197dc0ded41412a9de951aa`; local `main` and `origin/main` were aligned at that SHA before later PRs advanced `main`.
- Remote branch `codex/review-comments-1242-1256-followups` was deleted; `git ls-remote --heads origin codex/review-comments-1242-1256-followups main` returned only `refs/heads/main`.
- GitHub checks passed: Host-safe smoke, Static matrix and contracts, Quick golden-path smoke, Video-date golden-path smoke, Phase 7 no-go guardrails, Phase 8 privacy/media contracts, Phase 9 playback/captions/lifecycle contracts, Vercel, and Vercel Preview Comments. Staging native/web matrix jobs were skipped by workflow design.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --yes` applied `20260608224048_review_comments_1242_1256_followups.sql` to linked project `schdyxcunwcvddlcshwd`.
- Post-apply `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` returned `Remote database is up to date.`
- Post-apply `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked` showed local and remote aligned through `20260608224048`.
- Post-apply `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error` exited 0 with only existing warning/notice-level legacy output.
- Post-apply `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db advisors --linked --level error --fail-on error` returned `No issues found`.
- Live catalog markers returned true for the migration row, zero-feedback current-room scoping, retryable eligibility non-terminalization, remote-seen owner/call proof requirement, mark-ready auxiliary-error stripping, and authenticated execute grants for the public remote-seen and mark-ready RPCs.

Fresh disposable two-user production acceptance through both users persisting `date_feedback` remains required before calling Video Date healthy.

---

## 2026-06-09 Implementation Update: Certification Exception Closure

Source and linked Supabase cloud now add an operator-only closure path for known historical failed Video Date rows that are missing `date_feedback` and should not keep blocking release certification after review.

Problem addressed:

- The 2026-06-08 missing-feedback diagnostic correctly flagged stale survey-required participants without `date_feedback`.
- Earlier linked diagnostics in this pass showed session `3fabfd4e-523d-4593-bda5-ab6aa20f1005`, event `1eddfdbf-ee93-47ea-a266-4f2ca4a5468e`, with both participants in `in_survey`, no `date_feedback`, and `release_blocker=true`. After the migration apply, current linked diagnostics returned zero missing-feedback rows, so no exception row was inserted.
- The safe fix cannot fabricate `date_feedback`, because `date_feedback` is the only product finish line and must represent the user's submitted verdict.

Implementation added:

- Migration `20260608215911_video_date_certification_exception_closure.sql`.
- Service-owned table `video_date_certification_feedback_exceptions`.
- Service-only operator RPCs `upsert_video_date_certification_feedback_exception_v1(...)`, `revoke_video_date_certification_feedback_exception_v1(...)`, and `video_date_certification_feedback_exception_active_v1(...)`.
- `video_date_missing_feedback_operator_diagnostics_v1(...)` keeps the same return columns, keeps stale missing-feedback rows visible, and changes only `release_blocker`: an active service-owned exception makes that row nonblocking for certification.
- `docs/sql/video-date-invariants.sql` now applies the same rule to `stale_survey_pending_feedback_blocks_certification` when running `npm run check:video-date:invariants -- --warn-as-error`.
- Contract coverage added in `shared/matching/videoDateCertificationExceptionClosure.test.ts` and wired into `npm run test:video-date:red-flags` plus `npm run test:video-date-v4`.
- Branch delta: `docs/branch-deltas/fix-video-date-certification-exception-closure.md`.

Ownership boundary:

- Exceptions do **not** persist `date_feedback`.
- Exceptions do **not** move `event_registrations` out of `in_survey`.
- Exceptions do **not** participate in queue drain, Ready Gate routing, PostDateSurvey routing, web EventLobby, native EventLobby, or native notification rescue.
- Web/native/mobile users with pending feedback remain owned by `/date/:sessionId` or the native date route until their real `date_feedback` row exists.

Verification completed in this local pass:

- `npx tsx shared/matching/videoDateCertificationExceptionClosure.test.ts`
- `npm run test:video-date:red-flags`
- `npm run test:video-date-v4`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --yes`
- post-apply `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db advisors --linked --level error --fail-on error`
- Live catalog marker query for migration row, exception table, service-only RPC grants, authenticated non-write table privileges, diagnostic body markers, and no `date_feedback` insert in the operator upsert RPC.
- `npm run check:video-date:invariants -- --warn-as-error`

Linked Supabase state:

- Remote migration history is aligned through `20260608215911_video_date_certification_exception_closure.sql`.
- Post-apply linked dry-run returns `Remote database is up to date.`
- Current linked `video_date_missing_feedback_operator_diagnostics_v1(...)` returns zero rows, so no `video_date_certification_feedback_exceptions` rows were inserted.
- Linked invariant check with `--warn-as-error` exits 0 with no failures and no warnings.
- Linked DB lint exited 0 with only existing warning/notice-level legacy output, and linked error-level advisors returned `No issues found`.

Not yet performed in this pass:

- Fresh disposable two-user production acceptance through both users persisting `date_feedback`.

---

## 2026-06-09 Implementation Update: Survey Feedback Drain Guard

Local source now closes the synchronous ownership gap between queue drain and the mandatory post-date verdict finish line.

Problem addressed:

- `date_feedback` is the finish line, but survey/lobby queue drain could still promote the actor to another Ready Gate before their own `date_feedback` row existed for an ended survey-required Video Date.
- The 2026-06-08 missing-feedback reminder/certification closure made stale missing feedback visible and warn-as-error blocking, but it did not synchronously reject a queue-drain promotion in the same user session.
- Direct authenticated `date_feedback` insert/update grants and old own-row insert/update policies still left the mandatory verdict table writeable outside the canonical RPC path.

Implementation added:

- Migration `20260608211359_video_date_survey_feedback_drain_guard.sql`.
- Corrective migration `20260608214714_video_date_survey_feedback_gate_lint_repair.sql`, added after linked DB lint caught an invalid `video_sessions.created_at` fallback in `video_date_actor_pending_feedback_gate_v1(...)`. The helper now orders pending sessions by real columns: `ended_at`, `state_updated_at`, then `started_at`.
- Service-only helper `video_date_actor_pending_feedback_gate_v1(...)`, using the current `video_date_session_is_post_date_survey_eligible_v2(...)` truth plus actor-missing `date_feedback` checks.
- Public `drain_match_queue_v2(...)` and legacy `drain_match_queue(...)` now return structured `pending_post_date_feedback` with `found=false`, `queued=false`, `blocked=true`, `session_id`/`video_session_id`, and `next_surface.action='survey'` before any Ready Gate promotion delegate can run.
- Web/native/mobile clients now treat `pending_post_date_feedback` as survey ownership:
  - Web `useMatchQueue` exposes `onPendingPostDateFeedback`.
  - Web PostDateSurvey stays on/reopens the verdict step or routes to `/date/:sessionId`.
  - Web EventLobby routes escaped users to `/date/:sessionId` with forced survey ownership.
  - Native PostDateSurvey routes pending feedback through the date route, never the Ready Gate callback.
  - Native EventLobby handles interval, initial, and realtime queue-drain rescue results before `openReadyGateWithSession`.
  - Native notification queued-session rescue returns `videoDateHref(pendingSessionId)` when the guard blocks promotion.
- `date_feedback` direct authenticated insert/update/delete is revoked; old own-row insert/update RLS policies are dropped. Mandatory verdict writes remain backend-owned through `submit_post_date_verdict_v3` / `post-date-verdict`; optional details remain through `update_post_date_feedback_details`.
- Contract coverage added in `shared/matching/videoDateSurveyFeedbackDrainGuard.test.ts` and wired into `npm run test:video-date:red-flags` plus `npm run test:video-date-v4`.
- Branch delta: `docs/branch-deltas/fix-video-date-survey-feedback-drain-guard.md`.

Verification completed in this local pass:

- `npx tsx shared/matching/videoDateSurveyFeedbackDrainGuard.test.ts`
- `npm run test:video-date:red-flags`
- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
- `npm run test:video-date-v4`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --yes`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db advisors --linked --level error --fail-on error`
- Live catalog marker query for migration rows, helper body, wrapper/base functions, execution grants, `date_feedback` table privileges, and removed write policies.

Linked Supabase state:

- Remote migration history is aligned through `20260608214714_video_date_survey_feedback_gate_lint_repair.sql`.
- Post-apply linked dry-run returns `Remote database is up to date.`
- Linked DB lint exited 0 with only existing warning/notice-level legacy output, and linked error-level advisors returned `No issues found`.
- Live catalog markers confirmed both migration rows, repaired helper body with `vs.started_at` and no `vs.created_at`, both public drain wrappers and preserved bases, authenticated wrapper execution, service-only helper execution, revoked authenticated `date_feedback` insert/update/delete, preserved authenticated select, and removal of old direct write policies.

Not yet performed in this pass:

- Web deployment and native/mobile client rollout.
- Fresh disposable two-user production acceptance through both users persisting `date_feedback`.

This is source/schema/cloud/client implementation evidence only until shipped to web/native clients and proven by the fresh two-user acceptance run.

---

## 2026-06-08 Implementation Update: Missing Feedback Certification Closure

Source and linked Supabase cloud now close the zero-feedback post-date survey recovery gap that remained after the A-H / Daily/date ownership fixes.

Problem addressed:

- Existing `post_date_pending_verdicts` reminder logic handled one-sided verdicts after one participant submitted.
- A survey-required Video Date with zero `date_feedback` rows could remain in `in_survey` as an operator warning without either participant entering the same backend reminder/diagnostic path.
- That does not make A-H unhealthy, but it can still make the full Vibe Video Date unsuccessful because `date_feedback` is the real finish line.

Implementation added:

- Migration `20260608202749_video_date_missing_feedback_certification_closure.sql`.
- Service-owned per-user table `post_date_zero_feedback_reminders`, keyed by `(session_id, missing_user_id)`, for ended survey-eligible sessions where neither user has submitted feedback.
- Service-only RPCs `sync_post_date_zero_feedback_reminders_v1(...)`, `claim_post_date_zero_feedback_reminders_v1(...)`, `mark_post_date_zero_feedback_reminders_stale_v1(...)`, `record_post_date_zero_feedback_reminder_result_v1(...)`, and `video_date_missing_feedback_operator_diagnostics_v1(...)`.
- `post-date-verdict-reminders` now also claims zero-feedback survey reminders and sends canonical `post_date_feedback_reminder` pushes/deep links to `/date/:sessionId`.
- `docs/sql/video-date-invariants.sql` now includes `stale_survey_pending_feedback_blocks_certification`; normal invariant runs show this as a warning, and certification must run `npm run check:video-date:invariants -- --warn-as-error`.
- The migration validates `video_sessions_ready_gate_timestamp_consistency` after checking for historical violations, turning the prior `NOT VALID` Ready Gate timestamp constraint into an enforced validated constraint when applied.
- Contract coverage was added in `shared/matching/videoDateMissingFeedbackCertificationClosure.test.ts` and wired into both `npm run test:video-date:red-flags` and `npm run test:video-date-v4`.
- Branch delta: `docs/branch-deltas/fix-video-date-missing-feedback-certification-closure.md`.

Verification completed before merge and after cloud deploy:

- `npx tsx shared/matching/videoDateMissingFeedbackCertificationClosure.test.ts`
- `deno check --no-lock supabase/functions/post-date-verdict-reminders/index.ts`
- `npm run test:video-date:red-flags`
- `npm run test:video-date-v4` with expected env-gated RLS probe skips
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db advisors --linked --level error --fail-on error`
- `npm run verify:video-date:functions -- --require-remote --json`
- `npm run check:video-date:invariants`
- `npm run check:video-date:invariants -- --warn-as-error`

Linked Supabase state:

- PR #1252 merged as `44440923679140dc375fbe4e40ddf749658e920f`; nested `main` and `origin/main` are aligned at that SHA.
- Remote migration history is aligned through `20260608202749`.
- Post-apply dry-run returns `Remote database is up to date`.
- `post-date-verdict-reminders` is deployed as active version `306`, updated `2026-06-08 21:01:07 UTC`.
- Live catalog markers confirm `post_date_zero_feedback_reminders` exists with RLS enabled, the admin read policy exists, the new RPCs are service-role executable, authenticated/anon callers cannot execute the service RPCs, and `video_sessions_ready_gate_timestamp_consistency` is validated.
- Default invariant run has no critical failures and two warnings for session `3fabfd4e-523d-4593-bda5-ab6aa20f1005`.
- `--warn-as-error` intentionally fails on that session via `stale_survey_pending_feedback_blocks_certification`, proving stale missing feedback now blocks certification.

Not performed in this pass:

- Fresh disposable two-user production acceptance through both users persisting `date_feedback`.

This is source/cloud closure and certification hardening, not product-health proof. The flow remains uncertified until a fresh two-user web/native/mobile acceptance run completes through `date_feedback` for both users.

## 2026-06-08 Implementation Update: Both Ready Definitive Date Owner And Eligibility

Local source now closes the audited `both_ready + canonical Daily room` contract gap at the shared backend boundary used by web, native, and mobile clients.

Implementation added:

- Migration `20260608193915_video_date_both_ready_definitive_owner_eligibility.sql` wraps the public Ready Gate/date hot-path RPCs without changing their public names: `video_session_mark_ready_v2(...)`, `video_date_ready_gate_actionability_v1(...)`, `get_video_date_start_snapshot_v1(...)`, and `video_date_transition(...)`.
- New service-only helper `video_date_participant_eligibility_v1(...)` rechecks participant eligibility before Ready Gate/date entry. It blocks deleted auth users, active suspensions, hidden profiles, and under-18 profiles before provider room/token work can begin.
- New service-only helper `video_date_both_ready_route_payload_v1(...)` enriches successful and terminal payloads with explicit route truth: `route_decision`, `next_surface`, `ready_gate_completed`, `ready_gate_terminal`, `date_terminal`, `date_owned`, `both_ready_date_owned`, canonical Daily room name/URL, and provider room metadata when available.
- `video_session_mark_ready_v2(...)` still delegates to the decisive ready commit base. On the second ready tap, the durable `both_ready` commit remains first, deterministic Daily room truth remains canonical, and date-starting notification/outbox work is fail-soft so notification degradation cannot poison the ready commit.
- Successful `both_ready` now returns a date-owned route payload even if Daily provider room creation/token work is still pending or degraded. This makes `/date/:sessionId` the owner immediately and prevents Ready Gate/lobby loops from treating provider delay as a reason to reclaim the flow.
- Terminal/survey truth is explicit in the same wrapper payloads. If the actor is already `in_survey` and feedback is missing, the returned next surface is `/date/:sessionId` with survey recovery semantics, not Ready Gate or lobby.
- New service-only operator diagnostic `video_date_both_ready_operator_diagnostics_v1(...)` reports stuck `both_ready`/Daily/survey categories: missing bilateral join, Daily room domain mismatch, joined without bilateral remote-seen, remote-seen without date promotion, and survey-required without bilateral feedback.
- The existing `daily-room` Edge Function already calls `video_date_ready_gate_actionability_v1(...)` before provider room/token work, so the new eligibility and date-owner semantics apply to current web/native/mobile entry without an Edge Function source change.
- Contract coverage was added in `shared/matching/bothReadyCanonicalDailyRoomDefinitiveOwner.test.ts` and wired into both `npm run test:video-date:red-flags` and `npm run test:video-date-v4`.
- Branch delta: `docs/branch-deltas/fix-video-date-both-ready-definitive-owner-eligibility.md`.

Verification completed locally:

- `npx tsx shared/matching/bothReadyCanonicalDailyRoomDefinitiveOwner.test.ts`
- `npm run test:daily-room-contract`
- `npm run test:video-date:red-flags`
- `npm run test:video-date-v4`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db advisors --linked --level error --fail-on error`

Linked Supabase dry-run planned only `20260608193915_video_date_both_ready_definitive_owner_eligibility.sql`; cloud apply was not performed in this pass. Linked DB lint returned exit 0 with existing warning-only legacy noise, and DB advisors returned `No issues found`.

This is not product-health proof. Before calling Video Date healthy, apply the migration to Supabase cloud, deploy any required app builds, and run a fresh disposable two-user production acceptance flow through match -> Ready Gate -> `both_ready` -> same Daily room -> stable bilateral media/date -> end -> PostDateSurvey -> persisted `date_feedback` for both users.

## 2026-06-08 Implementation Update: Active Date Owner, Terminal Truth, And PostgREST Probes

Local source now closes the latest audited gaps around active `/date` ownership, terminal observability, delayed Daily webhook proof, and HTTP-level lifecycle RPC contracts.

Validated current state before changing code:

- Web `useVideoCall` already preserves live same-session Daily singleton remount identity and heartbeat ownership transfer for active joining/joined calls; it does not clear `activeDailyCallIdentityRef` or the alive heartbeat unless the remount owner can take over.
- Native/mobile `/date/[id]` already has the matching explicit `preserve_active_handoff` cleanup path and avoids `leave()` / destroy for that named warm handoff.
- The remaining live-code gap was route ownership outside `/date`: web and native event lobby side effects could still run while a same-event active video/date or terminal survey route owned the session.

Implementation added:

- Web `src/pages/EventLobby.tsx` now derives `activeDateRouteOwnsLobby` from date navigation, `in_survey` registration truth, and same-event active `video` session truth. While true, lobby status/readiness/queue/drain/foreground/action side effects are disabled.
- Native/mobile `apps/mobile/app/event/[eventId]/lobby.tsx` now applies the same single-owner rule for same-event active `video` sessions before readiness/status/queue side effects run.
- Migration `20260608171837_video_date_active_owner_terminal_truth.sql` adds terminal generation/audit columns to `video_sessions`, terminal tuple columns to `video_date_surface_claim_events`, a terminal audit trigger, and PostgREST-safe final wrappers for `video_session_mark_ready_v2(...)` and `claim_video_date_surface(...)`.
- The same migration preserves delayed Daily provider join/left truth by webhook `occurred_at` into participant provider-proof columns and an append-only `daily_webhook_historical_truth` presence event, even when the session is already terminal and state mutation is no longer allowed. The preservation path must run for the base Daily recorder's terminal no-mutation response (`state = ignored`, `result = ignored_terminal_session`) as well as normal processed/duplicate responses.
- Runtime probe `shared/matching/videoDateLifecycleRpcPostgrestRuntime.test.ts` now exercises authenticated HTTP/PostgREST calls for `video_session_mark_ready_v2`, `mark_video_date_daily_alive`, `claim_video_date_surface`, and `video_date_transition` across duplicate, invalid, and optional terminal seeded cases, asserting structured JSON and no raw 5xx.
- Generated Supabase types now include the new terminal/audit and delayed provider-proof columns.
- Branch delta: `docs/branch-deltas/fix-video-date-active-owner-terminal-truth.md`.

Session lessons and guidance:

- Heartbeat continuity and route ownership are separate contracts. Current web/native date routes already preserve live same-session Daily identity for explicit active handoff, but lobby/queue/deck logic also has to stand down while `/date/:sessionId` owns the session.
- A visible `/date` shell, warm-up UI, timer, or even brief media is not enough. The next accepted proof must show the active owner kept control until stable bilateral provider-backed media/date, then survey completion.
- After `queue_status = 'in_survey'`, `survey_required`, or terminal survey truth appears, the system should stop Daily alive/join loops, surface claim loops, queue drain loops, and Ready Gate recovery loops for that session until `date_feedback` persists.
- Delayed Daily webhook facts are historical evidence. They must be preserved by provider `occurred_at` even if terminal state correctly blocks further lifecycle mutation; `ignored_terminal_session` means "do not mutate active state," not "discard provider truth."
- Future failure queries must include `terminal_generation`, `terminal_audit_at`, `terminal_audit_reason`, `terminal_audit_source`, `terminal_audit_detail`, `participant_1_provider_joined_at`, `participant_2_provider_joined_at`, `participant_1_provider_left_at`, `participant_2_provider_left_at`, and the surface-claim terminal tuple fields.

Verification completed locally in this implementation pass:

- `npx tsx shared/matching/webEventLobbyGating.test.ts`
- `npx tsx shared/matching/videoDateLatestFailureRouteLifecycleContracts.test.ts`
- `npx tsx shared/matching/videoDateLifecycleRpcFailsoft.test.ts`
- `npx tsx shared/matching/videoDateLifecycleRpcPostgrestRuntime.test.ts` with the expected local skip when seeded `VIDEO_DATE_PUBLIC_API_RLS_*` credentials are absent.
- `npm run test:video-date:red-flags`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked` shows `20260608171837` as the only local migration not yet on remote.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` shows it would push only `20260608171837_video_date_active_owner_terminal_truth.sql`.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error` exits 0 with the known legacy warning backlog only.

Verification limitation:

- Local Supabase apply/reset could not run because Docker was not available on this workstation (`Cannot connect to the Docker daemon`). Cloud apply was not performed in this implementation pass.

Still not acceptance proof:

- These changes close source/schema/probe gaps only. Video Date remains uncertified until a fresh disposable two-user production run proves match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> survey completion, including short leave/rejoin and prolonged absence checks.

---

## 2026-06-08 Implementation Update: Partial-Ready Definitive Closure

Local code now closes the `ready_a` / `ready_b` boundary for web, native, and mobile users before provider room/token work can run.

Follow-up implementation at 2026-06-08 17:14 +03:

- `video_date_ready_gate_actionability_v1(...)` now checks terminal/ended truth before returning the active `non_ready_gate_owned` success branch, so `state = ended`, `phase = ended`, `ended_at`, or terminal `ready_gate_status` cannot be misclassified as date-owned actionability.
- Web lobby, web Ready Gate overlay, native event lobby, native Ready Gate overlay, and native standalone `/ready/[id]` now keep `/date/:sessionId` or native `/date/[id]` as the owner after `both_ready` when `prepare_date_entry` fails or throws after canonical startability/ownership has already been observed. These failures are now recorded as date-owned recovery instead of reopening Ready Gate or surfacing Ready Gate prepare-failure UI.
- Focused tests now pin both invariants: terminal-before-active SQL ordering and date-owned prepare-failure recovery across all web/native/mobile handoff surfaces.

Follow-up verification completed locally:

- `npx tsx shared/matching/readyGatePartialReadyDefinitiveClosure.test.ts`
- `npx tsx shared/matching/readyGateMarkReadyActionabilitySafety.test.ts`
- `npx tsx shared/matching/nativeReadyGateParityContract.test.ts`
- `npx tsx shared/matching/videoSessionDailyGate.test.ts`
- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
- `npm run test:video-date:red-flags`
- `npm run typecheck`

Follow-up Supabase cloud verification:

- Linked migration history contains `20260608160809`.
- `supabase db push --linked --dry-run` reports `Remote database is up to date.`
- `supabase db lint --linked --schema public --fail-on error` exits 0 with the known warning backlog only.
- `supabase db advisors --linked --level error --fail-on error` reports `No issues found`.
- Live marker queries confirm `video_date_ready_gate_actionability_v1`, `video_date_terminalize_ready_gate_session_v1`, `video_date_partial_ready_diagnostics_v1`, wrapped public RPC names, and the `video_sessions_ready_gate_timestamp_consistency` constraint are present.
- No Edge Function deploy was required for this follow-up because this branch did not change Supabase function source.

Follow-up still not acceptance proof:

- This is source, typecheck, and linked-cloud verified. It still does not certify Video Date until a fresh disposable two-user production run completes through `date_feedback` persistence.

Migration added:

- `supabase/migrations/20260608160809_video_date_ready_gate_partial_ready_definitive_closure.sql`

Code/test files changed:

- `supabase/functions/daily-room/index.ts`
- `shared/matching/readyGatePartialReadyDefinitiveClosure.test.ts`
- `shared/matching/videoDateEndToEndHardening.test.ts`
- `shared/matching/readyGatePreReadyRoomWarmup.test.ts`
- `package.json`

What this closes:

- `video_date_ready_gate_actionability_v1(...)` is now the canonical server gate for Ready Gate mark-ready and `prepare_entry`: participant authority, strict snooze rejection, active event truth, blocked/reported/hidden safety, registration/session pointer drift, expiry, and ready timestamp consistency are checked in one place.
- Invalid pre-date Ready Gates can be terminalized through `video_date_terminalize_ready_gate_session_v1(...)`; route-owned handshake/date sessions are explicitly not terminalizable by this cleanup path.
- `video_session_mark_ready_v2(...)` and `video_date_transition('prepare_entry')` are wrapped through the canonical actionability gate before the decisive base RPC can commit readiness or routeable date state.
- First-ready partner notification is fail-soft outbox work after the ready commit, so notification/provider failure cannot poison readiness.
- `get_video_date_start_snapshot_v1(...)` now removes `mark_ready` / date-entry affordances from invalid partial-ready truth instead of letting clients advertise stale actions.
- `prepare_date_entry` calls the actionability RPC before provider room/token work.
- `ensure_date_room` and `prepare_solo_entry` have since been removed from active source by the Daily-room non-golden action cleanup; solo prejoin is no longer kept as a disabled compatibility branch.
- `terminalize_event_ready_gates(...)` now delegates through the new terminalizer and no longer exempts pre-date Ready Gate rows solely because room metadata was warmed; only route-owned handshake/date or concrete Daily join evidence is excluded.
- `video_sessions_ready_gate_timestamp_consistency` is added `NOT VALID` for new writes, and `video_date_partial_ready_diagnostics_v1(...)` gives service-only diagnostics for active partial-ready drift.

Verification completed locally:

- `npx tsx shared/matching/readyGatePartialReadyDefinitiveClosure.test.ts`
- `npx tsx shared/matching/readyGateMarkReadyActionabilitySafety.test.ts`
- `npx tsx shared/matching/readyGatePreReadyRoomWarmup.test.ts`
- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
- `npx tsx shared/matching/videoDateFailsoftDateRoomRpcs.test.ts`
- `npm run test:video-date:red-flags`
- `deno check --no-lock supabase/functions/daily-room/index.ts`
- `npm run typecheck`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`

Supabase verification notes:

- Linked cloud migration history contains `20260608160809`.
- Linked dry-run exits 0 and reports `Remote database is up to date.`
- Linked public-schema lint exits 0 with the existing warning backlog only.
- Linked error-level advisors exit 0 with `No issues found`.
- Live marker queries confirm the new actionability, terminalizer, diagnostics, wrapped public RPC names, and timestamp consistency constraint are present in Supabase cloud.
- No Edge Function deploy was required in this follow-up because no Supabase function source changed.

Still not acceptance proof:

- This closed the partial-ready root causes in source/cloud at that checkpoint, but Video Date remains uncertified until a fresh disposable two-user production run completes match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> survey completion.

---

## 2026-06-08 Implementation Update: Ready Gate Actionability Safety

Local code now includes the Ready Gate actionability/safety closure for web, native, and mobile/Expo standalone users.

Migration added:

- `supabase/migrations/20260608063016_video_date_mark_ready_actionability_safety.sql`

Client/test files changed:

- `src/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/app/ready/[id].tsx`
- `shared/matching/readyGateMarkReadyActionabilitySafety.test.ts`
- `shared/matching/readyGateEntryProofContracts.test.ts`
- `shared/matching/readyGate57014ReliabilityContracts.test.ts`
- `package.json`

What this closes:

- `video_session_mark_ready_v2` now locks the `video_sessions` row before delegating to the decisive fail-soft base.
- Direct Ready taps are rejected before the ready commit when the session is still `queued`; queued remains retryable/syncable but is no longer advertised or accepted as mark-ready actionable truth.
- Direct Ready taps now repeat blocked-pair, report-pair, hidden-actor, hidden-partner, and partner-snoozed checks inside the RPC, so client route differences cannot bypass match/safety actionability.
- `get_video_date_start_snapshot_v1` no longer returns `can_mark_ready` for `queued`, partner-snoozed, or safety-invalid states.
- Native standalone `/ready/[id]` now records durable Ready Gate entry proof with `surface: ready_gate_standalone`.
- Native standalone `/ready/[id]` now pre-creates the Daily room after partial-ready success and starts the same non-joining native Daily prewarm path when media permission is proven.
- Web Ready tap permission prewarm now has a bounded gesture-path timeout and will not call `markReady()` until camera/microphone proof exists.

Verification completed locally:

- `npx tsx shared/matching/readyGateMarkReadyActionabilitySafety.test.ts`
- `npx tsx shared/matching/readyGateEntryProofContracts.test.ts`
- `npx tsx shared/matching/readyGate57014ReliabilityContracts.test.ts`
- `npx tsx shared/matching/videoDateStartSnapshotContracts.test.ts`
- `npx tsx shared/matching/videoDateProviderOverlapPromotion.test.ts`
- `npx tsx shared/matching/readyGateDecisiveMarkReadyCommit.test.ts`
- `npx tsx shared/matching/videoDateHandoffOwnershipContract.test.ts`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error`

Supabase verification notes:

- Local Supabase was not running on `127.0.0.1:54322`, so `supabase migration list --local` could not run.
- Linked dry-run exited 0 and reported only `20260608063016_video_date_mark_ready_actionability_safety.sql` would be pushed.
- Linked public-schema lint exited 0 with the existing warning backlog only.
- No migration was applied to Supabase cloud during this implementation pass.

Still not acceptance proof:

- This implementation is statically and type-check verified, but Video Date is not proven healthy until a fresh disposable two-user production run completes match -> Ready Gate -> both ready -> same Daily room -> remote media -> date promotion -> survey open -> `date_feedback` persistence -> expected return route.

---

## 2026-06-08 Implementation Update: Red-Flag Closure Gates And Certification Tooling

Local code now includes a focused red-flag gate and operator certification tooling for the current Golden Flow proof boundary.

Tooling/docs added or updated:

- `npm run test:video-date:red-flags`
- `npm run check:video-date:invariants`
- `npm run verify:video-date:functions`
- `npm run certify:video-date:golden-flow`
- `docs/sql/video-date-invariants.sql`
- `scripts/check-video-date-invariants.mjs`
- `scripts/verify-video-date-functions.mjs`
- `scripts/certify-video-date-golden-flow.mjs`
- `shared/matching/videoDateGoldenFlowCertificationContracts.test.ts`
- shared certification diagnostic builder in `shared/matching/videoDateDiagnostics.ts`
- `docs/qa/video-date-golden-flow-certification.md`
- `docs/qa/video-date-native-device-certification.md`
- `docs/runbooks/video-date-edge-function-release-verification.md`

What this closes:

- The red-flag gate now explicitly covers mark-ready actionability/safety, native Ready Gate parity, provider-overlap promotion, post-date survey persistence, safety/privacy, and fail-soft Daily room RPC behavior.
- The full `test:video-date-v4` suite now includes the previously separate fail-soft Daily room RPC and native Ready Gate parity contracts.
- The stale fail-soft RPC contract assertions now target the current shared lifecycle retryability helper instead of older direct `payload.retryable` string shapes.
- Standalone native `/ready/[id]` now has explicit contract coverage for Ready Gate entry proof and non-authoritative post-ready room warmup.
- Operator invariants are packaged as a repeatable read-only gate with redacted PASS/FAIL rows. The runner uses `psql` when a DB URL is present and falls back to linked `supabase db query` otherwise.
- Edge Function release verification is packaged as a non-deploying local/remote catalog check.
- A compact certification diagnostic shape now captures route owner, Ready Gate status, Daily room presence, token state, joined/provider/remote-seen roles, survey state, and next surface without tokens, raw Daily URLs, or participant IDs.
- Golden Flow and native physical-device certification now have current June 2026 checklists.

Still not acceptance proof:

- No live Supabase deployment or fresh two-user runtime certification was performed by this tooling change.
- Video Date remains uncertified until a fresh disposable two-user run completes through both users saving `date_feedback` and returning to the expected next state.

2026-06-08 follow-up during publish verification:

- The first live invariant run showed two current `in_survey` participants missing `date_feedback`. That is valid pending-survey hold state, not a critical release failure.
- `docs/sql/video-date-invariants.sql` now treats missing feedback as critical only when the participant is no longer held by `in_survey`; active pending survey holds remain visible as warnings for operator evidence.

---

## 2026-06-08 Implementation Update: Route Lifecycle And Last-Resort RPC Fail-Soft Recovery

Latest failed production run analyzed:

- Event: `1722f3e0-33d1-4fd5-9ec3-0b88e92b9cfb`
- Video session: `176d9ed3-f1c6-48e4-901a-c2098ed61b34`
- The backend reached the important middle milestones: both users entered Ready Gate, both marked ready, both were sent to the same Daily room, provider-backed joins existed, date UI opened, remote-seen evidence existed, and the session ended survey-eligible with registrations in `in_survey`.
- The product still failed because the client lifecycle was unstable: `/date/:sessionId` and `/ready/:sessionId` competed during stale hydration, terminal survey state did not dominate route decisions early enough, route ownership was too short-lived and memory-only on web, same-session Daily cleanup could stop the alive heartbeat and null the parked call ref during remount, and exposed lifecycle RPCs could still leak raw 500s from `claim_video_date_surface(...)` or nested helper/enrichment/sanitizer failures.

Migration added:

- `supabase/migrations/20260608080938_video_date_lifecycle_rpc_last_resort_failsoft.sql`

Client/test files changed:

- `shared/matching/videoDateRouteDecision.ts`
- `src/components/session/SessionRouteHydration.tsx`
- `apps/mobile/components/NativeSessionRouteHydration.tsx`
- `src/lib/dateEntryTransitionLatch.ts`
- `apps/mobile/lib/dateEntryTransitionLatch.ts`
- `src/hooks/useVideoCall.ts`
- `apps/mobile/app/date/[id].tsx`
- `src/lib/vdbg.ts`
- `shared/matching/videoDateLatestFailureRouteLifecycleContracts.test.ts`
- `shared/matching/videoDateLifecycleRpcFailsoft.test.ts`
- `shared/matching/videoDateSprint1RouteDecisionContracts.test.ts`
- `shared/matching/videoDateSurfaceContinuityHardening.test.ts`
- `package.json`

What this closes:

- `event_registrations.queue_status = 'in_survey'` is now terminal route truth for canonical routing, even when session truth is stale, missing, or still looks Ready Gate/date-capable. Feedback-submitted users can still progress out.
- Web and native hydration now pass registration state into `decideCanonicalVideoDateRoute(...)`, mark route ownership before suppressing stale bounces, and no longer redirect an already-owned `/date/:sessionId` back to Ready Gate from stale active-session hydration.
- Web route ownership now survives realistic route churn with a 10-minute signed-in TTL, a 2-minute anonymous TTL, and sessionStorage persistence. Native/mobile route ownership uses the same longer TTL in its JS runtime.
- Web same-session Daily remount parking is now detach-only for the call object: it skips leave/destroy and preserves the parked call ref, while the old hook heartbeat is stopped so heartbeat ownership transfers to the remounted date owner.
- Native/mobile preserve-active-handoff cleanup now decides whether to park before clearing heartbeat, token, participant, and room state; destructive leave/background/timeout cleanup remains destructive.
- `claim_video_date_surface(...)`, `mark_video_date_daily_alive(...)`, `mark_video_date_daily_joined(...)`, and `video_date_transition(...)` now have a final public last-resort fail-soft shell. The shell delegates to the existing wrapper stack, but independently catches base, enrichment, sanitizer, and observability failures and returns sanitized JSON to authenticated clients.
- Static regression coverage now pins the latest failure shape through `shared/matching/videoDateLatestFailureRouteLifecycleContracts.test.ts`, included in `npm run test:video-date-v4`.

Verification and publish evidence:

- `npm run test:video-date-v4`
- `npm run typecheck`
- `git diff --check`
- `npx tsx shared/matching/videoDateLatestFailureRouteLifecycleContracts.test.ts`
- `npx tsx shared/matching/videoDateLifecycleRpcFailsoft.test.ts`
- `npx tsx shared/matching/videoDateSurfaceContinuityHardening.test.ts`
- `npx tsx shared/matching/videoDateSprint1RouteDecisionContracts.test.ts`
- `npx tsx shared/matching/videoDateHandoffOwnershipContract.test.ts`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- PR #1240 merged on 2026-06-08 as squash commit `0b4d0db5ae37bea3e322b4de5935fce48362ff87`; branch `codex/video-date-route-lifecycle-rpc-recovery` was deleted after merge.

Supabase verification notes:

- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --yes` applied `20260608080938_video_date_lifecycle_rpc_last_resort_failsoft.sql` to project `schdyxcunwcvddlcshwd`.
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked` shows local/remote aligned through `20260608080938`.
- Post-apply `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` returned `Remote database is up to date.`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error` exited 0; output is warning-only legacy backlog.
- Live catalog checks confirmed final public `SECURITY DEFINER` shells for `claim_video_date_surface(...)`, `mark_video_date_daily_alive(...)`, `mark_video_date_daily_joined(...)`, and `video_date_transition(...)`; renamed bases and helper functions are service-role only.

Still not acceptance proof:

- This closes the latest observed client lifecycle and RPC fail-soft gaps, but Video Date remains uncertified until a fresh disposable two-user production run completes match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> survey completion, including short leave/rejoin and prolonged absence checks.

## 2026-06-08 CTO Audit Follow-Up: Classifier Precision, Guidance Sync, And Workspace Tidy

Deep audit after PR #1240 found no reason to rewrite the applied migration stack, but it did find three cleanup items:

- `shared/matching/videoDateLifecycleRpc.ts` treated generic `session_ended` lifecycle payloads as terminal-survey truth. Web and native both revalidated before opening survey, so this was not a direct false-survey opener, but it blurred telemetry and could send ineligible ended sessions through unnecessary survey-recovery work. The classifier now reserves terminal-survey truth for `queue_status = 'in_survey'`, `survey_required`, or JS-shaped `surveyRequired`; generic `session_ended` remains terminal-stop truth only.
- `AGENTS.md`, `CODEX.md`, `CLAUDE.md`, and `docs/vibely-canonical-project-reference.md` still described PR #1235 / `20260608001000` as the current implementation/cloud top. They now point to PR #1240 and migration `20260608080938_video_date_lifecycle_rpc_last_resort_failsoft.sql`, while preserving PR #1235 as the prior Daily-owner baseline.
- The ignored top-level `dist/` build output was present again and was removed as generated local clutter. `node_modules/**/dist` package folders remain untouched.

Audit decision:

- The applied migration `20260608080938_video_date_lifecycle_rpc_last_resort_failsoft.sql` contains a harmless duplicate `v_actor := auth.uid();` assignment inside the `claim_video_date_surface(...)` wrapper source. Because that migration has already been applied to Supabase cloud, the file was not edited. If a live SQL behavior issue is later found, add a corrective migration instead of rewriting applied history.

Verification:

- Local checks passed: `npx tsx shared/matching/videoDateLifecycleRpcFailsoft.test.ts`, `npm run test:video-date-v4`, `npm run typecheck`, `npm run lint`, `git diff --check`, and generated-clutter scan for top-level `dist`, `.next`, `.turbo`, `coverage`, `build`, `test-results`, and `.expo`.
- Supabase linked verification passed without mutation: migration list aligned through `20260608080938`, `supabase db push --linked --dry-run` returned `Remote database is up to date.`, `supabase db lint --linked --schema public --fail-on error` exited 0 with legacy warning-only backlog, and live catalog markers confirmed the final public shells are `SECURITY DEFINER`, authenticated-only, delegate to the preserved `*_20260608080938_last_resort_base` functions, and call the v2 exception/enrich/sanitize helpers.

Still not acceptance proof:

- This audit improves correctness and guidance hygiene only. Video Date remains uncertified until the fresh disposable two-user production run completes through survey completion, plus short leave/rejoin and prolonged absence checks.

## 2026-06-08 Review Comments Follow-Up: PR #1232 Through PR #1242

Thread-aware GitHub review sweep:

- Reviewed the last 11 PRs, PR #1242 down through PR #1232, with the GitHub review-comments workflow.
- No Copilot-authored review threads were present in that range.
- Codex review had 10 unresolved actionable threads. The PR #1241 mandatory-doc baseline thread was already corrected on current `main`; the remaining source, script, native, and Supabase findings are addressed in this follow-up.

Migration added:

- `supabase/migrations/20260608114500_review_comments_1232_1242_followups.sql`
- `supabase/migrations/20260608114600_review_comments_identifier_hygiene.sql`

What this closes:

- `/date/:sessionId` hydration no longer claims route ownership when canonical truth is still Ready Gate and not date-capable; web/native clear stale date ownership and redirect to `/ready/:sessionId`.
- Web Ready Gate permission-prewarm timeout cleanup no longer stops a late capture stream if a newer retry is awaiting the same pending browser prompt/capture promise.
- Native/mobile idle Daily singleton reuse is scoped to the same session and Daily room before reusing a parked call; cross-session parked calls are destroyed for retry.
- `check:video-date:invariants` accepts the normal linked Supabase CLI bare JSON-array output instead of treating it as zero rows.
- `verify:video-date:functions -- --require-remote` parses listed function slugs and compares exact names, so `post-date-verdict-reminders` cannot satisfy `post-date-verdict`.
- `certify:video-date:golden-flow` loads repo-local `.env.cursor.local` before deciding whether live invariants are available.
- The survey-required invariant now uses confirmed-encounter evidence, excluding pre-date ended sessions with no survey obligation.
- The mark-ready RPC now sanitizes `SAFETY_CHECK_UNAVAILABLE` client payloads and logs SQL diagnostics through service-side lifecycle observability.
- Provider-absence no-survey terminalization now preserves idle resume status for inactive events instead of leaving participants as browsing.
- The corrective identifier-hygiene migration keeps applied history immutable after the `20260608114500` cloud apply and renames the provider-absence base helper to short catalog name `vd_absence_review_1232_1242_base`.

Still not acceptance proof:

- These review-comment fixes are source/schema/tooling correctness improvements. They do not prove Video Date healthy until a fresh disposable two-user production run completes match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> survey completion, including short leave/rejoin and prolonged absence checks.

---

## 2026-06-08 Implementation Update: Provider-Bound Remote-Seen Recovery

Latest failed production run analyzed:

- Event: `86dc1e15-d2cc-45f6-be81-628bd685a759`
- Video session: `34ed864c-e6eb-4804-bc71-8aeba6bce9b1`
- The flow reached the core middle milestones: match, Ready Gate, both ready, same Daily/date route, and visible date UI. It still failed because a stale `mark_video_date_remote_seen` call was accepted after that actor's Daily provider session had already emitted `participant.left`, so historical remote-media proof was able to mutate canonical encounter truth after current provider proof was gone.

Migrations added:

- `supabase/migrations/20260608120000_video_date_provider_bound_remote_seen.sql`
- `supabase/migrations/20260608121834_video_date_remote_seen_identifier_hygiene.sql`
- `supabase/migrations/20260608122623_video_date_remote_seen_lint_cleanup.sql`

Client/test/type files changed:

- `src/hooks/useVideoCall.ts`
- `apps/mobile/app/date/[id].tsx`
- `src/integrations/supabase/types.ts`
- `shared/matching/videoDateLifecycleRpcFailsoft.test.ts`
- `shared/matching/videoDateEndToEndHardening.test.ts`

What this closes:

- `mark_video_date_remote_seen(...)` now has the same provider-proof envelope as Daily alive: the caller must be the authenticated participant, must pass the current owner/call identity, must be in `owner_state = 'joined'`, and the supplied `provider_session_id` must match that participant's latest Daily provider `participant.joined` event.
- Old session-only or stale-provider remote-seen calls no longer reach the old canonical mutator. They return structured JSON with `remote_seen_rejected_stale_provider_session`, `provider_presence_required`, `provider_presence_missing`, `provider_backed_current = false`, `remote_seen_stamp_accepted = false`, and a specific code such as `REMOTE_SEEN_PROVIDER_SESSION_MISSING`, `REMOTE_SEEN_OWNER_NOT_JOINED`, `REMOTE_SEEN_PROVIDER_SESSION_LEFT`, or `REMOTE_SEEN_PROVIDER_NOT_CURRENT`.
- Web and native/mobile clients no longer call remote-seen from session id alone. They bind the stamp to the current Daily call identity (`call_instance_id`, `entry_attempt_id`, `owner_id`, and local provider session id) and skip or stop retrying when provider proof is missing or terminal.
- The Daily alive public wrapper now keeps a direct JSON last-resort fallback around the provider-bound base so stale/terminal provider paths do not leak raw HTTP 500s to authenticated clients.
- Rejection telemetry records `remote_seen_rejected_stale_provider_session` when possible, but observability failures are swallowed so telemetry cannot turn a defensive no-op into a hot-path failure.
- The first provider-bound migration produced a Postgres identifier-truncation notice for the Daily alive base helper after cloud apply. Applied history was left immutable; corrective migration `20260608121834_video_date_remote_seen_identifier_hygiene.sql` renames the truncated helper to short service-only `vd_daily_alive_remote_seen_base` and recreates the public Daily alive wrapper against it.
- DB lint then surfaced a warning-only unused `v_now` local in the new remote-seen wrapper. Corrective migration `20260608122623_video_date_remote_seen_lint_cleanup.sql` recreates that wrapper without the unused variable while preserving the provider-current guard and stale-provider rejection contract.

Verification completed locally:

- `npx tsx shared/matching/videoDateLifecycleRpcFailsoft.test.ts`
- `npx tsx shared/matching/videoDateIdentifierHygieneContracts.test.ts`
- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
- `npm run test:video-date-v4`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --schema public --fail-on error`

Supabase verification notes:

- Before cloud apply, linked migration list was aligned through `20260608114600_review_comments_identifier_hygiene.sql`.
- Linked dry-run showed only `20260608120000_video_date_provider_bound_remote_seen.sql` pending.
- Cloud was applied through `20260608120000_video_date_provider_bound_remote_seen.sql`, then corrective migrations `20260608121834_video_date_remote_seen_identifier_hygiene.sql` and `20260608122623_video_date_remote_seen_lint_cleanup.sql`.
- Post-apply migration list is aligned through `20260608122623`; post-apply dry-run returns `Remote database is up to date.`
- `supabase db lint --linked --schema public --fail-on error` exits 0. The new `mark_video_date_remote_seen` unused-local warning was removed by `20260608122623`; remaining output is the pre-existing legacy warning/notice backlog.
- Live catalog checks confirm `mark_video_date_daily_alive(...)` and `mark_video_date_remote_seen(...)` are authenticated public `SECURITY DEFINER` wrappers, `vd_daily_alive_remote_seen_base(...)` and `mark_video_date_remote_seen_20260608120000_provider_base(uuid)` are service-role only, the Daily alive wrapper calls `vd_daily_alive_remote_seen_base`, remote-seen contains `remote_seen_rejected_stale_provider_session`, and the live remote-seen wrapper no longer contains `v_now`.

Publish and sync evidence:

- PR #1245 merged on 2026-06-08 as squash commit `a178e1265001f01d5beca0375c38a9cb8c0d4e59`; branch `codex/provider-bound-remote-seen` was deleted locally and remotely.
- Nested repo `main` and `origin/main` were verified aligned at `a178e1265001f01d5beca0375c38a9cb8c0d4e59` with a clean worktree.
- Parent repo `/Users/kaanporsuk/Documents/Vibely` has no remote; local parent commit `7d1443e5a2d6dd93c3bc6df6a0a1810b102c1bc8` records the nested gitlink update to `a178e1265001f01d5beca0375c38a9cb8c0d4e59`.
- PR checks passed: Host-safe smoke, Quick golden-path smoke, Video-date golden-path smoke, Static matrix and contracts, Phase 7/8/9 policy checks, Vercel, and Vercel Preview Comments. Staging matrix jobs were skipped by workflow rules.
- Final linked Supabase checks after merge: migration list aligned through `20260608122623`, `supabase db push --linked --dry-run` returned `Remote database is up to date.`, DB lint exited 0 with the legacy warning backlog only, and live catalog markers confirmed wrapper/base grants and stale-provider guard state.

Still not acceptance proof:

- This closes the stale provider remote-seen authority gap observed in `34ed864c-e6eb-4804-bc71-8aeba6bce9b1`, but Video Date remains uncertified until a fresh disposable two-user production run completes match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> survey completion, including short leave/rejoin and prolonged absence checks.

---

## Known Recent Failure Pattern

### User-visible symptoms

Recent screenshots and reports showed:

- User reaches the Ready Gate.
- User taps ready.
- UI alternates between "Opening the room...", "Opening your date", "You're both here. Starting gently.", "Keeping the room open...", and back to lobby/Ready Gate.
- In the latest report, the user sees "This Ready Gate changed. Back to browsing." and never reaches a stable Video Date.
- In the subsequent latest report, the user did reach warm-up briefly, then bounced between `/date/:sessionId` and `/ready/:sessionId` while the backend had already moved the encounter to survey-required terminal truth.
- In the latest post-PR #1200 test, the session reached `date` and showed a live date UI, but the peer disappeared after Daily leave events. The session ended survey-eligible, one participant stayed `in_survey`, the other was later overwritten to `offline`, and no `date_feedback` rows were created.
- In the latest provider-bound remote-seen investigation, the session reached the date UI, but stale client remote-seen evidence was accepted after a matching Daily provider leave. Remote-seen must now be treated as current provider-backed proof, not session-only proof.
- Older reports showed "Still connecting your date" and repeated Daily sessions for a single attempted date.

### Console/network signals

Observed or reported signals included:

- Earlier: raw HTTP 500 from `video_date_transition`, `claim_video_date_surface`, `mark_video_date_daily_joined`, and Ready Gate/lobby RPCs.
- Later: `video_session_mark_ready_v2` and route-state calls returning retryable/late states that the client rendered as stale Ready Gate.
- Daily/mediasoup-like warnings such as producer not found for `cam-video`, consistent with peers not co-occupying the same Daily room at the same time.
- Very noisy PostHog client rate-limit messages and OneSignal 409s that are distracting but not the primary Video Date handoff cause.

### Important interpretation

Console noise is not the root cause by itself. The recurring root theme is split authority and timing around the handoff: Ready Gate readiness, room metadata, route ownership, Daily presence, and terminal/stale interpretation must all be consistent under contention, remounts, late retries, duplicate tabs, and native/mobile route churn.

---

## 2026-06-04 Recovery Timeline

### 1. Date-room RPC fail-soft wrapper and stuck-room backfill

Migration: `supabase/migrations/20260604093000_video_date_failsoft_date_room_rpcs.sql`

What it addressed:

- Raw 500s from `video_date_transition`, `claim_video_date_surface`, and `mark_video_date_daily_joined`.
- Lock/statement-timeout cascades during `/date` -> lobby -> Ready Gate remount storms.
- Stuck active sessions with `daily_room_name` / `daily_room_url` missing after earlier split-ready paths.

Decision rationale:

- Raw 500s gave clients no structured recovery path and hid the SQLSTATE.
- Fail-soft wrappers allow clients to receive `{ ok:false, retryable:true, sqlstate, message }` for residual backend contention.
- Existing stuck rows needed a bounded NULL-only backfill because code fixes do not repair already-corrupted live rows.

Follow-up correction:

- Migration `20260604094500_video_date_transition_preserve_raise_semantics.sql` restored `video_date_transition` to transparent raise/error behavior because existing web/native callers treat a 200 payload without expected state as terminal. Fail-soft behavior remained appropriate for `claim_video_date_surface` and `mark_video_date_daily_joined`.

### 2. Ready Gate mark-ready hot-path recovery

Migration: `supabase/migrations/20260604103000_ready_gate_mark_ready_hot_path_retry_recovery.sql`

What it addressed:

- `ready_gate_transition('mark_ready')` was still too broad and too vulnerable to stale/retryable command replay.
- Mark-ready needed to be a narrow hot path: persist readiness, derive canonical Daily metadata when both-ready, and enqueue provider work fail-soft.
- The visible "Ready Gate changed" state could appear after retryable contention rather than only true session replacement/staleness.

Decision rationale:

- The ready tap is the user intent that must survive transient lock contention.
- Provider/Daily work should not block or poison the readiness commit.
- Deterministic canonical room metadata belongs in server truth once both users are ready.

### 3. Definitive Ready Gate handoff hardening

Migration: `supabase/migrations/20260604104154_ready_gate_mark_ready_grace_notification_auth.sql`

Client/server files changed in PR #1188 / squash commit `c532dca0ac324d02f0749a25c06097160357fbfb`:

- `src/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/app/ready/[id].tsx`
- `shared/matching/readyGateDiagnosticCopy.ts`
- `shared/matching/readyGate57014ReliabilityContracts.test.ts`
- `supabase/functions/send-notification/index.ts`
- `supabase/functions/swipe-actions/index.ts`
- `supabase/functions/video-date-outbox-drainer/index.ts`
- `supabase/config.toml`

What it addressed:

- A ready tap that started before expiry can now commit within a short server-side grace window even if the retry lands after nominal expiry.
- `video_session_mark_ready_v2` now standardizes response fields including `hot_path`, `mark_ready_started_at`, `expiry_grace_applied`, and `retryable_command_reopened`.
- Retryable mark-ready failures are rendered as syncing/retrying, not "Ready Gate changed."
- Terminal or expired canonical states cancel Ready Gate retry churn, prewarm, and media handoff work.
- Notification auth failures in the provider outbox are explicitly classified, logged, and health-checked.
- Notification payload identity was normalized so `user_id` remains the recipient and `match_user_id` is the matched profile.

Decision rationale:

- The system must honor real user intent under lock contention. A user who tapped ready before expiry should not be rejected because the database was busy.
- The server must distinguish retryable command contention from true terminal replacement.
- The client must not turn a retryable backend signal into stale UX.
- Push failure should not block Video Date, but it must become visible immediately because native/mobile users depend on notifications and push-driven state awareness.

### 4. Deployment and synchronization

PR: `https://github.com/kaanporsuk/vibelymeet/pull/1188`  
Merged: 2026-06-04 12:25:56 UTC  
Main commit: `c532dca0ac324d02f0749a25c06097160357fbfb`

Supabase DB:

- Migration `20260604104154_ready_gate_mark_ready_grace_notification_auth.sql` applied to project `schdyxcunwcvddlcshwd`.
- Final dry run reported `Remote database is up to date`.

Supabase Edge Functions deployed and verified:

- `send-notification` version `812`, updated `2026-06-04 12:28:36 UTC`.
- `swipe-actions` version `746`, updated `2026-06-04 12:29:19 UTC`.
- `video-date-outbox-drainer` version `45`, updated `2026-06-04 12:33:03 UTC`.

Git:

- Local `main` and `origin/main` both at `c532dca0ac324d02f0749a25c06097160357fbfb`.
- Working tree was clean after merge/deploy verification.
- Feature branch `fix/ready-gate-handoff-hardening` was deleted locally and remotely.

Verification run:

- `npx tsx shared/matching/readyGate57014ReliabilityContracts.test.ts`
- `npx tsx shared/matching/phase2PaymentsDurableNotifications.test.ts`
- `npm run test:google-tls-posture`
- `supabase db push --dry-run`

No web or native build was run during this audit/commit sequence.

### 5. Latest failed two-user web test: Ready Gate succeeded, Daily co-occupancy did not

Evidence captured from screenshots, browser Network/Console pasted text, and Supabase project `schdyxcunwcvddlcshwd`.

Identifiers:

- Event: `5727a8b5-1526-4230-8b5b-4bde98b4296e`
- Video session: `1592aa53-f011-45ab-bcb4-e2685fe172b9`
- Participants:
  - `267aa05e-0802-4b87-9a7b-ff78b97fdfa7` / Kaan Apple
  - `2a0995e1-8ec8-4a11-bdfe-0877c3383f5c` / Direk
- Canonical Daily room returned by mark-ready and webhooks: `date-1592aa53f01145abbcb4e2685fe172b9`

Observed flow:

- `13:48:24.035847Z`: mutual match created the video session.
- `13:48:28.823137Z`: Kaan mark-ready command committed as `ready_a`.
- `13:48:32.154945Z`: Direk mark-ready command committed as `both_ready`; payload included canonical `daily_room_name` and `daily_room_url`, `hot_path`, and provider verify reason `ready_gate_mark_ready_hot_path`.
- Screenshots then showed `Both ready. Connecting you now...`, `/date/1592...` opening, then black/waiting date surfaces, then repeated `Opening the room...`, `Your next date is ready`, lobby fallback, and `This date continued in another tab - closing here.`
- Daily webhooks show Kaan joined at `13:48:36.435Z` and left at `13:48:37.382Z` after `0.943s`.
- Daily webhooks show Direk joined at `13:48:43.490Z` and stayed until `13:50:13.777Z` after `90.284s`.
- Daily webhooks show Kaan rejoined at `13:49:11.368Z` and left at `13:49:12.174Z` after `0.797s`.
- Backend `mark_video_date_daily_joined` started handshake from stale joined evidence before durable co-presence: at `13:48:43.731859Z` it saw both `participant_*_joined_at` values even though Kaan had already left; later handshake evidence moved to Kaan's brief `13:49:11Z` rejoin.
- The final session row ended at `13:52:00.427253Z` with `ended_reason = reconnect_grace_expired`, `date_started_at = null`, both `participant_*_remote_seen_at = null`, and refund status `granted`.

Interpretation:

- Ready Gate hot-path authority worked for this session. The latest failure was not a mark-ready failure.
- Daily provider room creation also worked; provider webhooks prove both users reached the same room name.
- The users did not remain co-present long enough to produce durable remote-media evidence. Kaan's sub-second joins align with the web duplicate-tab branch auto-ending and navigating away on `dupBlocked && callStarted`.
- `useVideoDateDupTabGuard` used a localStorage key scoped only to `sessionId`. In same-browser/same-origin two-account tests, participant A and participant B could evict each other locally even though the backend `video_date_surface_claims` row is correctly scoped per `profile_id`.
- Event lobby registration realtime could call `prepareVideoDateEntry` again while `/date/:sessionId` already owned the entry pipeline, contributing to route/lobby churn and stale "next date" prompts.
- Backend Daily join stamping treated historical `joined_at` as active co-presence even after a Daily `participant.left` webhook. That can start or extend the handshake timer on stale evidence.

Code changes made after this investigation:

- `src/hooks/useVideoDateDupTabGuard.ts`: local duplicate lease is now scoped by `profileId + sessionId`, preserving same-user duplicate protection without making the two participants look like duplicate tabs in a disposable same-browser test.
- `src/pages/VideoDate.tsx`: duplicate-tab conflicts no longer auto-call `endCall("duplicate_tab_lease_blocked")` or auto-navigate to lobby. The takeover UI is shown only after the conflict remains stable for `2.5s`.
- `src/pages/EventLobby.tsx`: lobby prepare-entry handoff now suppresses re-entry when a same-session date-entry pipeline or date navigation claim is already active.
- `supabase/migrations/20260604142017_video_date_active_presence_join_guard.sql`: replaces the private base of the fail-soft `mark_video_date_daily_joined` wrapper so the actor's away stamp is cleared on a real route join and the handshake timer starts only when both participants' latest Daily presence is active.
- Regression contracts updated in `shared/matching/videoDateSurfaceContinuityHardening.test.ts` and `shared/matching/videoDateEndToEndHardening.test.ts`.

Verification run after code changes:

- `npx tsx shared/matching/videoDateSurfaceContinuityHardening.test.ts`
- `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
- `npx tsx shared/matching/videoDateHandoffOwnershipContract.test.ts`
- `npx tsx shared/matching/videoDateFailsoftDateRoomRpcs.test.ts`
- `npx tsc --noEmit -p tsconfig.app.json`
- `supabase db push --dry-run` showed only `20260604142017_video_date_active_presence_join_guard.sql` pending and completed without applying it before the PR was published.

Deployment and synchronization after PR #1190:

- PR: `https://github.com/kaanporsuk/vibelymeet/pull/1190`
- Source branch: `codex/video-date-active-presence-recovery`
- Branch commit: `978f0ed8c0b98a0931309c4766bed0e4f047c24f`
- Squash merge commit on `main`: `b72e487d65972566e63f508d023cf2e1e886734a`
- Merged: `2026-06-04 14:33:06 UTC`
- Supabase project: `schdyxcunwcvddlcshwd`
- Migration `20260604142017_video_date_active_presence_join_guard.sql` was pushed and applied to Supabase cloud.
- Post-deploy `SUPABASE_NO_TELEMETRY=1 supabase db push --dry-run` returned `Remote database is up to date`.
- Direct Supabase verification confirmed:
  - `migration_applied = true`
  - `active_presence_guard_installed = true`
  - `waiting_observability_installed = true`
- Git alignment after merge:
  - local `main`, `origin/main`, and `origin/HEAD` all pointed at `b72e487d6`.
  - source branch was deleted locally and remotely, then pruned.
  - working tree was clean after the merge/deploy verification.
- PR checks passed:
  - Phase 7 no-go guardrails
  - Phase 8 privacy and media contracts
  - Phase 9 playback/captions/lifecycle contracts
  - Quick golden-path smoke
  - Video-date golden-path smoke
  - Vercel
  - Vercel Preview Comments

Remaining unproven:

- No fresh deployed two-user run has yet proved that both users remain co-present, remote media mounts, date starts, and surveys complete.
- No native/mobile runtime smoke has been run after this patch.

### 6. Latest failed two-user web test: warm-up reached, then a transport flap terminalized the session

Evidence captured from chronological screenshots, Console/Network pasted text, and Supabase project `schdyxcunwcvddlcshwd`.

Identifiers:

- Event: `5ff63806-4e06-45f1-8391-a7a5bdd1c542`
- Video session: `aac15b03-8de7-45e2-a11b-629cdd9b5b16`
- Canonical Daily room: `date-aac15b038de745e2a11b629cdd9b5b16`

Observed flow:

- Ready Gate was not the final blocker. One `mark_ready` command hit retryable timeout/recovery behavior, then both `mark_ready` commands committed to the same canonical Daily room.
- Daily handoff worked briefly. Both clients joined the room, both produced `remote_seen` evidence, and the warm-up UI appeared.
- During the first seconds of co-presence, Daily emitted a `participant-left` event.
- Web `useVideoCall` treated that provider event as partner-away authority immediately and called the backend `mark_reconnect_partner_away` path before the local Daily transport grace could absorb the flap.
- Backend ended the session at `2026-06-04 15:06:41.574871+00` with `ended_reason = reconnect_grace_expired`.
- Backend correctly set both event registrations to `in_survey`, but clients kept mounting `/date/:sessionId` and `/ready/:sessionId`, claiming surfaces, retrying Daily work, polling optional reads, and later emitted a false `peer_missing_terminal`.
- Console 500s during the churn were amplifiers, not the root cause: optional/read/recovery calls should stop once terminal survey truth is known and must not block survey recovery.

Interpretation:

- The recovery problem has moved past Ready Gate handoff and past first Daily entry. The current primary failure is post-handoff warm-up stability plus terminal-survey recovery.
- A raw Daily `participant-left` is not enough evidence to start backend absence grace during the first local transport window. It can be a transient Daily/media transport flap while the peer is already on the way back.
- Once server truth says an encounter ended with survey-required evidence, `/date/:sessionId` must become the survey host immediately and synchronously stop Daily start/retry, surface claim, reconnect, broadcast, foreground, and peer-wait loops.

Code changes made after this investigation:

- `src/hooks/useVideoCall.ts`: Daily `participant-left` now starts the local 12s transport grace and defers `onPartnerLeft` until that grace expires. Remote participant return, participant update, or fresh remote frame clears the pending away mark. The first-remote watchdog now refetches server truth before showing terminal peer-missing UI. Current invariant: survey-required terminal truth suppresses peer-missing and opens survey; historical remote-seen/encounter proof does not prove the peer is currently present.
- `src/hooks/useReconnection.ts`: `mark_reconnect_partner_away` now sends `p_reason: "daily_transport_grace_expired"`, preserving backend reconnect semantics only after local transport grace has expired.
- `src/pages/VideoDate.tsx`: terminal survey recovery is a hard stop. Survey-required terminal truth clears handshake/reconnect state, stops Daily and surface churn, opens `PostDateSurvey`, and treats optional profile/observability/verdict fetch failures as non-blocking unless completed feedback already exists.
- `src/pages/ReadyRedirect.tsx`: `go_survey` and canonical survey decisions navigate to `/date/:sessionId` with `forceSurvey` route state so `VideoDate` opens survey instead of trying to restart the call.
- `apps/mobile/app/date/[id].tsx` and `apps/mobile/lib/videoDateApi.ts`: native Daily `participant-left` now uses the same local grace before backend away marking, passes the explicit `daily_transport_grace_expired` reason, and follows the same peer-missing invariant as web.
- `shared/observability/videoDateClientStuckObservability.ts`: added peer-missing survey/legacy diagnostic event names and safe payload fields for same-session Daily continuity, singleton parking, truth refresh attempts, and historical remote-seen truth.
- `supabase/migrations/20260604170438_video_date_warmup_reconnect_stability.sql`: wraps `video_date_transition` without changing the public signature. Legacy/null immediate `mark_reconnect_partner_away` calls are suppressed during early warm-up when recent bilateral joined, remote-seen, or handshake evidence exists. Explicit `p_reason = "daily_transport_grace_expired"` delegates to the base transition and still starts backend reconnect grace. The migration also allows the new suppressed peer-missing observability events.

Verification run after code changes:

- `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`
- `npx tsx shared/matching/videoDateSprint1RouteDecisionContracts.test.ts`
- `npx tsx shared/observability/videoDateClientStuckObservability.test.ts`
- `npx tsx shared/matching/videoDateFailsoftDateRoomRpcs.test.ts`
- `npm run typecheck:core`
- `cd apps/mobile && npm run typecheck`
- `npx tsc --noEmit -p tsconfig.app.json`
- `npm run lint`
- `SUPABASE_NO_TELEMETRY=1 supabase db push --dry-run --linked`
- `SUPABASE_NO_TELEMETRY=1 supabase db push --linked --yes`
- `SUPABASE_NO_TELEMETRY=1 supabase db push --dry-run --linked`
- `SUPABASE_NO_TELEMETRY=1 supabase db query --linked -o json ...`

Deployment and synchronization state:

- Supabase migration `20260604170438_video_date_warmup_reconnect_stability.sql` is applied to project `schdyxcunwcvddlcshwd`.
- Post-push dry-run returned `Remote database is up to date`.
- Direct catalog verification returned:
  - `migration_applied = true`
  - `transition_wrapper_installed = true`
  - `transition_base_preserved = true`
  - `stuck_observability_installed = true`
- No Edge Functions changed in this patch, so no Edge Function deployment was required.
- PR: `https://github.com/kaanporsuk/vibelymeet/pull/1192`
- Source branch: `fix/video-date-warmup-stability`
- Branch commit before squash merge: `ed75b90a99d34ff8b25d729edc90eb3cef738437`
- Squash merge commit on `main`: `b2a4a10ce22c2f4950b94fa6b9e49aa235c6c7fa`
- Merged: `2026-06-04 17:44:30 UTC`
- Source branch was deleted on GitHub by the PR merge and is no longer present locally after sync.

Remaining unproven:

- No fresh deployed two-user run has yet proved stable warm-up, visible remote media through the full warm-up, date continuation/end, and survey completion.
- The simulated short Daily leave/rejoin under 12s has not yet been run manually after deployment.
- Native/mobile has static parity and typecheck coverage, but still needs runtime smoke.

### 7. Latest failed two-user web test: repeated Daily rebuild, stale presence, and false lifecycle away authority

Evidence source: chronological screenshots, Console/Network pasted text, and Supabase investigation from the latest two-user test.

Identifiers:

- Event: `fba940f5-b219-4f10-a046-84e86bc8cfff`
- Video session: `83e88141-ebab-4254-869a-c69db7bdb107`
- Canonical Daily room: `date-83e88141ebab4254869ac69db7bdb107`

Observed flow:

- Ready Gate and canonical Daily room handoff succeeded.
- The failing side repeatedly entered and left the same Daily room during the first minute while the other side remained longer.
- The users did not intentionally leave the screen, switch tabs, or background the browser.
- Client/network evidence showed repeated `/date` work, surface claims, Daily joins, and recovery calls during the same session.
- Backend presence was not latest-state safe enough: old `participant_*_joined_at` evidence could remain authoritative after newer leave/away evidence, and reconnect grace was not reliably cleared by later return evidence.
- A soft browser lifecycle signal such as `web_visibilitychange` could still mark self away even while Daily was joining/joined.
- Backend eventually ended with `reconnect_grace_expired`, even though the intended behavior for a short Daily transport/rebuild flap is local recovery first, backend grace only after confirmed local absence, and grace cancellation on real return.

Interpretation:

- The current failure is not a Ready Gate readiness failure and not a missing Daily room.
- The precise failure chain is: duplicate/repeated Daily start/rebuild on one side -> provider join/leave flapping -> stale/first-join backend presence -> reconnect grace not cleared on later join/return -> soft lifecycle away over-authority -> terminalization despite both users staying in the intended flow.
- `remote_seen` observability is useful evidence, but canonical DB remote-seen repair must succeed or retry because terminal eligibility and recovery must use canonical truth.

Code changes in this branch:

- `src/hooks/useVideoCall.ts`
  - Exposes `dailyMeetingState` and `localInDailyRoom`.
  - Reuses an existing nonterminal same-session Daily call instead of calling `leave()`/`destroy()` and rebuilding.
  - Converts `daily_call_busy` into an internal wait/retry path before surfacing a failure.
  - Emits append-only cleanup/reuse/busy diagnostics with room, caller, reason, meeting state, and leave/destroy flags.
  - Keeps Daily `participant-left` behind local transport grace and retries canonical `mark_video_date_remote_seen`, with a persisted diagnostic if canonical repair exhausts.
- `src/pages/VideoDate.tsx`
  - Treats `visibilitychange` as soft telemetry while Daily is joining/joined or the date is in handoff/handshake/date.
  - Keeps hard exits (`beforeunload`, non-persisted `pagehide`) authoritative.
  - Adds a terminal survey hard-stop bridge that actively tears down Daily once survey-required terminal truth is found, even if the recovery path fires before the hook callback is attached.
- `apps/mobile/app/date/[id].tsx`
  - Native background now waits until native background grace expiry before sending backend leave/away, while still cleaning local Daily resources.
- `shared/observability/videoDateClientStuckObservability.ts`
  - Adds append-only diagnostic event names and safe fields for Daily cleanup/reuse/busy and canonical remote-seen repair failure.
- `supabase/migrations/20260604193140_video_date_latest_presence_grace_repair.sql`
  - Replaces the fail-soft `mark_video_date_daily_joined` base so joined timestamps advance to latest join, own away state clears, and reconnect grace clears on return.
  - Wraps Daily webhook recording so provider joins advance latest joined time and clear reconnect grace when the join proves return; stale provider leaves cannot override newer joins.
  - Wraps `video_date_transition` so soft lifecycle `mark_reconnect_self_away` is suppressed while the actor has active Daily presence, while explicit `daily_transport_grace_expired` remains the legitimate partner-away path through the existing warm-up wrapper.
  - Replaces reconnect-grace expiry so it rechecks latest presence and suppresses terminalization when newer joined or remote-seen-after-away evidence proves return.
  - Makes cleanup/reuse/busy/remote-seen repair diagnostics append-only while preserving dedupe for older stuck-state events.
- `supabase/migrations/20260604205645_video_date_remote_seen_latest_state.sql`
  - Replaces `mark_video_date_remote_seen` so canonical `participant_*_remote_seen_at` advances on every remote-media observation instead of preserving first-seen evidence.
  - Returns and logs `latest_remote_seen_at`, `previous_remote_seen_at`, and `remote_seen_canonical_repaired`, addressing PR #1194 review feedback that reconnect expiry needed current remote-seen proof after a transient leave/return.

Verification run in this branch:

- `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`
- `npx tsx shared/observability/videoDateClientStuckObservability.test.ts`
- `npx tsc --noEmit --pretty false --skipLibCheck`
- `cd apps/mobile && npm run typecheck`
- `npm run typecheck:core`
- `supabase db push --dry-run --linked` showed only `20260604193140_video_date_latest_presence_grace_repair.sql` pending.
- `supabase db push --linked --yes` applied `20260604193140_video_date_latest_presence_grace_repair.sql` to project `schdyxcunwcvddlcshwd`.
- Post-push `supabase db push --dry-run --linked` returned `Remote database is up to date`.
- Direct remote catalog verification confirmed the migration row, latest-presence helper, `video_date_transition`, `record_video_date_daily_webhook_event_v2`, `record_video_date_client_stuck_observability`, and append-only stuck-state index predicate.
- A follow-up review fix added and applied `20260604205645_video_date_remote_seen_latest_state.sql`; post-push dry-run returned `Remote database is up to date`, and direct catalog verification confirmed both migration rows plus latest-state `mark_video_date_remote_seen` payload fields.
- `supabase db advisors --linked --type all --level error --fail-on error`

Verification not available in this workspace:

- `supabase db lint --local --fail-on error` could not run because local Postgres at `127.0.0.1:54322` is not running and Docker is not installed.

Remaining unproven:

- No fresh deployed two-user run has proven the new single-owned Daily start and latest-state reconnect behavior.
- A short simulated Daily transport flap under 12s still needs production verification.
- A real prolonged absence still needs verification to prove terminalization remains intact.
- Native/mobile runtime smoke still needs physical-device validation.

### 8. Superseded sync state after ultimate stabilization rollout

Evidence source: direct Git, GitHub, Vercel, and Supabase verification after PR #1194 and the final documentation follow-up.

Superseded code/deploy baseline at that point:

- PR #1194: `https://github.com/kaanporsuk/vibelymeet/pull/1194`
- PR #1194 squash commit: `0a160cd975d87cd756e9c399e748810508f005cb`
- PR #1195 final documentation follow-up: `https://github.com/kaanporsuk/vibelymeet/pull/1195`
- App `main` / `origin/main` at that point: `d2c912c873cd3c119b2296a507d5c4b05007f8a9`
- Parent workspace gitlink commit: `a50175961b64b5ec18fb5a0f5b3c7d3759ac5193`; this parent repo has no remote configured, so only the nested app repo is GitHub-pushable.
- Production Vercel status for that app commit: success, deployment URL `https://vercel.com/okp805/vibelymeet/2W87s4V56hNCz16snCNhaPkrm89X`.
- Source branches `fix/video-date-ultimate-stabilization` and `docs/video-date-ultimate-rollout-final` were deleted locally and remotely.

Supabase cloud baseline:

- Linked project: `schdyxcunwcvddlcshwd`
- `supabase db push --dry-run --linked` returned `Remote database is up to date`.
- `supabase migration list --linked` showed local and remote both include `20260604193140` and `20260604205645`.
- Direct catalog verification returned true for:
  - `20260604193140_video_date_latest_presence_grace_repair.sql`
  - `20260604205645_video_date_remote_seen_latest_state.sql`
  - latest-presence helper installation
  - canonical remote-seen latest-state repair
  - public transition soft lifecycle suppression
  - transition chain partner-away local-grace semantics
  - reconnect-grace expiry latest-presence recheck
- `supabase db advisors --linked --type all --level error --fail-on error` returned no issues.

Important boundary:

- This confirms code, migrations, and deployment alignment. It still does not prove product recovery.
- The next decisive proof remains a fresh disposable two-user production run from mutual match through survey completion, plus short-flap and real-prolonged-absence checks.

### 9. Final sync state after confirmed-encounter deadline rescue rollout

Evidence source: direct Git, GitHub, and Supabase verification after PR #1199.

Current code/deploy baseline:

- PR #1199: `https://github.com/kaanporsuk/vibelymeet/pull/1199`
- PR #1199 merge commit: `ebe4690467b7956511338d94c5847b88889cd1a8`
- PR #1196 recovery hardening commit: `359fa5c42bd5fcdefef9a8a1fca9396d96194f4f`
- PR #1194 squash commit: `0a160cd975d87cd756e9c399e748810508f005cb`
- Current app `main` / `origin/main`: `ebe4690467b7956511338d94c5847b88889cd1a8`
- Source branch `codex/video-date-confirmed-encounter-rescue` was deleted on GitHub and pruned locally.

Supabase cloud baseline:

- Linked project: `schdyxcunwcvddlcshwd`
- `supabase db push --linked` applied `20260605085010_video_date_confirmed_encounter_deadline_rescue.sql`.
- `supabase migration list --linked` showed local and remote aligned through `20260605085010`.
- `supabase db push --linked --dry-run` returned `Remote database is up to date`.
- Direct live function verification confirmed `finalize_video_date_handshake_deadline(...)` has `has_confirmed_encounter_rescue=true`, `has_positive_extension_v2=true`, `wraps_20260605085010_base=true`, and `old_least_pattern_position=0`.
- `supabase db lint --linked --level warning --fail-on none` completed after rerunning with telemetry disabled; it reported existing unrelated warnings and no new overlong identifier from the rescue migration.

Important boundary:

- This confirms code, migration, and cloud alignment for the latest rescue. It still does not prove product recovery.
- The next decisive proof remains a fresh disposable two-user production run from mutual match through survey completion, plus short-flap and real-prolonged-absence checks.

### 10. Latest failed two-user production audit: confirmed encounter existed, but the date never stabilized

Evidence source: chronological screenshots, Console/Network pasted text, local source review, and read-only Supabase CLI queries against project `schdyxcunwcvddlcshwd`.

Identifiers:

- Event: `5dd6716f-b18b-40b1-b238-21d4eb1bf1d5`
- Video session: `d38e4c62-3cf9-4c98-b6a5-b37b2fe36ef3`
- Participants:
  - `267aa05e-0802-4b87-9a7b-ff78b97fdfa7`
  - `2a0995e1-8ec8-4a11-bdfe-0877c3383f5c`
- Canonical Daily room: `date-d38e4c623cf94c98b6a5b37b2fe36ef3`

Observed user/browser flow:

- The browser entered `/date/d38e4c62-3cf9-4c98-b6a5-b37b2fe36ef3` and repeatedly showed "Opening your date."
- The UI then alternated through "Still connecting your date", "Opening the room", a black in-call shell with controls/timer, and "Keeping your date state in sync."
- Network evidence showed the Daily websocket opened, repeated `claim_video_date_surface`, `video_date_transition`, `video-date-snapshot`, `video_sessions` reads, and many `record_video_date_launch_latency_checkpoint` calls.
- Console evidence included opaque 500s for `mark_video_date_daily_joined`, `record_video_date_launch_latency_checkpoint`, and `video_session_handshake_auto_promote_v2`; those were amplifiers/observability gaps, not the first boundary failure.
- Console also showed Daily call-object warnings and a non-video OneSignal CSP image violation for `https://img.onesignal.com/...`, which should be cleaned separately because it pollutes production diagnostics.

Supabase timeline:

- `10:30:48.885857Z`: match created the session.
- `10:30:51.311016Z`: participant 2 committed `mark_ready` as `ready_b`.
- `10:30:56.028410Z`: participant 1 committed `mark_ready` as `both_ready`; payload returned the canonical Daily room URL/name, `hot_path=true`, and `retryable_command_reopened=false`.
- `10:30:57.690724Z` and `10:30:58.209702Z`: `confirm_prepare_entry_prepared` recorded `room_metadata_persisted=true`.
- `10:30:59.183Z`: participant 1 joined the Daily room according to webhook `3793`.
- `10:31:01.335Z`: participant 2 joined the same Daily room according to webhook `3794`.
- `10:31:10.377441Z`: backend started the handshake after active Daily co-presence.
- `10:31:11.425544Z`: canonical remote-seen repair recorded `confirmed_encounter=true`.
- `10:31:15.392304Z`: first remote frame evidence was recorded.
- `10:31:48.723648Z`: `remote_readable` was recorded from `progressive_blur_complete`.
- `10:31:36.802Z` / processed `10:31:41.658099Z`: participant 1 left Daily.
- `10:31:38.533Z` / processed `10:31:46.296816Z`: participant 1 rejoined Daily.
- `10:32:26.857Z` / processed `10:32:41.775670Z`: participant 1 left Daily again.
- `10:32:42.235Z` / processed `10:33:44.984002Z`: participant 2 left Daily.
- `10:34:00.555980Z`: deadline cleanup extended the handshake by launch evidence instead of promoting to `date`.
- `10:36:00.217291Z`: the session ended as `handshake_timeout`, `survey_required=true`, `date_started_at=null`, registrations moved to `in_survey`, and no `date_feedback` rows were present.

Important final row facts:

- Final `state` / `phase`: `ended`
- `ended_reason`: `handshake_timeout`
- `date_started_at`: `null`
- `daily_room_name` / `daily_room_url`: `null` on the final row despite canonical room metadata being returned by `mark_ready` and `room_metadata_persisted=true` during prepare-entry.
- `participant_1_remote_seen_at`: `2026-06-05T10:31:40.856601Z`
- `participant_2_remote_seen_at`: `2026-06-05T10:32:01.410506Z`
- `participant_1_away_at`, `participant_2_away_at`, and `reconnect_grace_ends_at`: `null` in the final row.
- `date_feedback`: no rows.

Expected vs actual:

- Ready Gate: expected both users to commit readiness once and receive the same canonical room. Actual matched expectation.
- Daily room creation: expected both users to join the same room. Actual matched expectation.
- Date route ownership: expected the route handoff to keep one stable Daily call object per user while React route/state churn settles. Actual diverged: observability recorded 18 `daily_call_cleanup` events from `useVideoCall.unmount` during `handshake`, including `joining-meeting` and `joined-meeting` states.
- Daily singleton preservation: expected a same-session live remount to park/reuse without provider leave/destroy. Actual diagnostics showed `leave_called=false` and `destroy_called=false`, but no effective `parked_singleton`/reuse outcome prevented provider join/leave churn.
- Media confirmation: expected bilateral remote-seen/first-frame/readable evidence to promote the session into `date` or keep a stable warm-up until promotion. Actual diverged: `confirmed_encounter=true` was recorded by `10:31:11Z`, but `date_started_at` stayed null.
- Deadline rescue: expected the confirmed-encounter rescue to prevent false `handshake_timeout`. Actual rescue ran too late; by deadline cleanup, provider left events had already emptied the room, so the server extended once and later ended survey-required.
- Terminal survey: expected survey-required terminal truth to open and complete the survey. Actual backend moved both registrations to `in_survey`, but no feedback row was persisted in this test.

Root-cause assessment:

- Primary client root cause: web Daily lifecycle ownership is still too sensitive to React hook/component churn. `src/hooks/useVideoCall.ts` calls cleanup from a `useEffect` whose dependency is `cleanupCallObject`; when that callback identity changes, React can run the cleanup while the user is still on the intended `/date/:sessionId` flow. This exactly matches the `useVideoCall.unmount` diagnostics during active Daily states.
- Primary server root cause: promotion is too delayed. `video_session_handshake_auto_promote_v2` still waits for the 60-second handshake deadline before promoting, even when `video_date_session_has_confirmed_encounter(...)` is already true. This leaves the product in a long fragile handshake window after bilateral media evidence exists.
- Deadline-rescue limitation: `finalize_video_date_handshake_deadline` can promote an active confirmed encounter at the deadline, but this test shows that deadline is not early enough. By the time cleanup ran, provider leave rows had already been processed, so the active room had been lost.
- Room metadata integrity gap: canonical room metadata existed in command payloads and prepare-entry evidence, but the final `video_sessions` row had `daily_room_name`/`daily_room_url` null. This must be treated as an invariant failure until explained or repaired.
- RPC observability gap: the client still surfaces raw 500s for key RPCs during handoff. These should be structured, retry-classified responses with `sqlstate`, `message`, `retryable`, and source RPC name so the UI can back off without tearing down Daily.

Scoped next-change plan from this audit:

- Web: make the `useVideoCall.unmount` cleanup mount-stable. Use a ref-backed cleanup function or stable-event helper so callback identity churn cannot trigger a live Daily cleanup. During same-session `handshake`/`date`, unmount cleanup should park or no-op if the current route/session still owns the date handoff.
- Web: latch same-session Daily continuity eligibility once Daily join starts, rather than recomputing it from transient render state. The cleanup diagnostic must always include `dailyCallSingletonEligible`, `willParkSingleton`, `parked_singleton`, and the final reuse/park/destroy outcome.
- Web: treat `external_call_busy` for the same session/room as a reuse/wait path before showing "Still connecting your date"; surface blocking UI only for different room/session or after bounded same-session recovery fails.
- Server: add an early confirmed-encounter promotion path from `mark_video_date_remote_seen` and/or `video_session_handshake_auto_promote_v2`. Once both users have joined and both have canonical remote-seen evidence, and neither user has explicitly passed, promote to `date` immediately rather than waiting for the 60-second deadline.
- Server: keep the deadline rescue as a fallback, but add diagnostics that record `confirmed_encounter`, `active_confirmed_encounter`, away timestamps, latest joined/remote-seen evidence, latest provider leave/join, and the exact branch selected.
- Server: enforce canonical room metadata persistence as an invariant. A both-ready/session with a deterministic room must not end with null `daily_room_name` unless the row is intentionally anonymized, and recovery helpers should repair both active and terminal rows.
- Web/native/mobile: treat confirmed server `date` promotion as the single warm-up/date-start source of truth; avoid resetting warm-up timers or restarting Daily after a positive promotion/extension response.
- Native/mobile: preserve the existing native prejoin cleanup guard, but align the product invariant with web: transient navigation/focus/app lifecycle must not mark a failed date or tear down recoverable server state before grace expires or terminal truth arrives.
- Observability/UX cleanup: add `https://img.onesignal.com` to CSP `img-src` separately, and ensure all handoff RPC failures return structured payloads instead of opaque browser 500s.

Boundary:

- This was an audit/investigation pass only. No code changes, migrations, deploys, web build, or native build were run.
- The product remains unproven. The required proof is still a fresh disposable production two-user run through match -> Ready Gate -> same Daily room -> stable bilateral remote media/warm-up -> date end -> post-date survey opens and completes.

### 11. Implemented confirmed-encounter stability patch after session `d38e4c62`

Evidence source: local code changes, focused contract/type/lint verification, and Supabase cloud apply to linked project `schdyxcunwcvddlcshwd`.

Implementation branch:

- Branch: `codex/video-date-confirmed-encounter-stability`
- PR: `https://github.com/kaanporsuk/vibelymeet/pull/1200`
- PR #1200 merge commit: `fbca4996a096273914ee650b556ba7994477aa5e`
- New Supabase migration: `20260605115657_video_date_early_confirmed_encounter_promotion.sql`
- Cloud apply: `supabase db push --linked --yes` applied `20260605115657` successfully.
- Post-apply remote check: `supabase migration list --linked` showed local/remote alignment through `20260605115657`.
- Post-apply remote lint: `supabase db lint --linked --schema public --fail-on error` completed with no error-level issues; it reported existing unrelated warning-level issues and pre-existing identifier-truncation notices from older migrations.

What changed:

- Web Daily lifecycle now uses a ref-backed unmount cleanup, so `cleanupCallObject` callback identity churn cannot trigger `useVideoCall.unmount` cleanup while the date route is still actively settling.
- Web same-session Daily continuity now latches once start/join begins (`start_call_requested`, active truth, call object attached, join started, join success). Cleanup eligibility no longer depends only on transient `dailyCallSingletonEligible` render props.
- Parked same-session Daily cleanup preserves active session continuity metadata and avoids resetting the hook's connection/reconnect/media state on the parked path.
- Supabase now has a shared `video_date_promote_confirmed_encounter_v1(...)` helper. It promotes an active `handshake` to `date` immediately when both participants have joined, both have canonical `remote_seen`, neither participant has an explicit pass, both have not already decided, and neither side has a newer away timestamp than their latest join/remote evidence.
- `mark_video_date_remote_seen` now delegates to that helper after stamping remote media, so the second canonical remote-seen proof can start the date without waiting for the 60s deadline.
- `video_session_handshake_auto_promote_v2` now checks the same helper before delegating to the older deadline-gated command wrapper, so confirmed bilateral media bypasses `handshake_auto_promote_not_due`.
- `finalize_video_date_handshake_deadline` still delegates to the PR #1199 deadline rescue as fallback, but now checks the same early promotion helper first and restores canonical room metadata after the fallback path.
- CSP now allows `https://img.onesignal.com` in `img-src` to remove a noisy non-Daily console violation from production debugging.

Expected behavior after this patch:

- If both users reach the same Daily room and both clients/provider surfaces produce canonical remote-seen evidence, server truth should move to `state=date`, `phase=date`, and non-null `date_started_at` immediately.
- A later handshake finalizer should be fallback-only, not the primary date-start path after confirmed bilateral media.
- A React remount/state-churn event during the same `/date/:sessionId` handoff should park/reuse the live Daily call rather than leave/destroy/recreate it.
- Terminal rows should retain or restore deterministic Daily room metadata for operator forensics and survey recovery.

Verification run, with no web or native build triggered:

- `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`
- `npx tsx shared/matching/videoDateInstantPremiumV2Contracts.test.ts`
- `npx tsx shared/matching/videoDateDefinitiveHandoffRecovery.test.ts`
- `npx tsx shared/matching/videoDatePhase3RemainingContracts.test.ts`
- `npm run typecheck:core`
- `npx eslint src/hooks/useVideoCall.ts shared/matching/videoDateWarmupStabilityContracts.test.ts shared/matching/videoDateInstantPremiumV2Contracts.test.ts shared/matching/videoDateDefinitiveHandoffRecovery.test.ts shared/matching/videoDatePhase3RemainingContracts.test.ts`
- `supabase db push --linked --dry-run`
- `supabase db push --linked --yes`
- `supabase migration list --linked`
- `supabase db lint --linked --schema public --fail-on error`
- Live catalog/function marker query confirmed `migration_applied=true`, `mark_remote_seen_wraps_helper=true`, `mark_remote_seen_returns_flag=true`, `auto_promote_checks_helper=true`, `auto_promote_delegates_base=true`, `finalizer_delegates_base=true`, `finalizer_repairs_room_after_base=true`, `helper_records_confirmed_event=true`, and `helper_sets_date_state=true`.

Boundary:

- This is still not acceptance proof. The decisive proof remains a fresh disposable production two-user run through match -> Ready Gate -> same Daily room -> stable bilateral remote media/warm-up -> date end -> post-date survey opens and completes.
- If the next run fails, first inspect whether `mark_video_date_remote_seen` or `video_session_handshake_auto_promote_v2` returned `early_confirmed_encounter_promoted=true`, whether `confirmed_encounter_promoted_to_date` appears in `video_session_events` / `event_loop_observability_events`, and whether web cleanup rows show `same_session_daily_continuity_latched=true` with `parked_singleton=true`.

### 12. Final sync after PR #1200 confirmed-encounter stability merge

Evidence source: GitHub PR status, local Git sync, and Supabase remote checks after merging PR #1200.

Current code/cloud state:

- PR #1200: `https://github.com/kaanporsuk/vibelymeet/pull/1200`
- PR #1200 merge commit: `fbca4996a096273914ee650b556ba7994477aa5e`
- Source branch `codex/video-date-confirmed-encounter-stability` was deleted on GitHub and pruned locally.
- Local `main` and `origin/main` aligned at `fbca4996a096273914ee650b556ba7994477aa5e` immediately after the PR #1200 merge. A docs-only follow-up may sit on top of this functional baseline; verify current HEAD before quoting it.
- Supabase project `schdyxcunwcvddlcshwd` stayed aligned through `20260605115657`, and `supabase db push --linked --dry-run` reported `Remote database is up to date`.
- `supabase db lint --linked --schema public --fail-on error` completed with no error-level issues; only existing unrelated warning-level issues and older identifier-truncation notices were reported.
- Live function marker verification confirmed the migration row, early-promotion helper, `mark_video_date_remote_seen` wrapper, `video_session_handshake_auto_promote_v2` wrapper, deadline finalizer fallback wrapper, post-base room repair, and `confirmed_encounter_promoted_to_date` / `state = date` helper markers are installed.
- PR checks passed before merge: Vercel, Phase 7 no-go guardrails, Phase 8 privacy/media contracts, Phase 9 playback/captions/lifecycle contracts, Quick golden-path smoke, and Video-date golden-path smoke.

Important boundary:

- This still is not manual acceptance proof. The required proof remains a fresh disposable production two-user run from match through survey completion.

### 13. Latest failed test after PR #1200: date started, then terminal survey lifecycle broke

Evidence source: attached chronological screenshots/network panels, local code audit, and live Supabase project `schdyxcunwcvddlcshwd`.

Identifiers:

- Event: `6c9c647f-242b-463c-8b24-0896f02677e5`
- Video session: `782f5eb6-497f-4fd8-9898-2f47cf939751`
- Canonical Daily room: `date-782f5eb6497f4fd898982f47cf939751`
- Participants: `267aa05e-0802-4b87-9a7b-ff78b97fdfa7` and `2a0995e1-8ec8-4a11-bdfe-0877c3383f5c`

Observed Supabase timeline:

- `2026-06-05T13:25:28.016704Z`: participant 2 committed `mark_ready`, session moved to `ready_b`.
- `2026-06-05T13:25:32.046417Z`: participant 1 committed `mark_ready`, session moved to `both_ready`, with Daily room metadata returned.
- `2026-06-05T13:25:47.508Z` and `2026-06-05T13:25:48.257Z`: Daily provider reported both participants joined the same canonical room.
- `2026-06-05T13:25:50.242506Z`: `confirmed_encounter_promoted_to_date` fired, with `date_started_at = 2026-06-05T13:25:51.75678Z`. Ready Gate, room creation, remote-seen, and early date promotion worked.
- `2026-06-05T13:26:27.495401Z` and `2026-06-05T13:26:29.940336Z`: canonical remote-seen evidence existed for both participants.
- `2026-06-05T13:26:48Z` through `13:27:02Z`: Daily provider reported participant 1 left twice and participant 2 left once; the backend reconciled those leaves.
- `2026-06-05T13:28:09.710Z`: only participant 2 rejoined the Daily room. There was no later participant 1 provider join.
- `2026-06-05T13:30:53.723208Z`: `date_timeout` ended the session with `survey_required=true`; `date_feedback` remained empty.
- Final row originally had `date_started_at` and bilateral remote-seen truth, but `daily_room_name` and `daily_room_url` were null. Final registrations diverged: participant 1 remained `in_survey`; participant 2 was later overwritten to `offline` at `2026-06-05T13:35:14.884865Z`.
- Post-fix cloud verification repaired and preserved this terminal row as `daily_room_name=date-782f5eb6497f4fd898982f47cf939751` and `daily_room_url=https://vibelyapp.daily.co/date-782f5eb6497f4fd898982f47cf939751` with `daily_room_provider_verify_reason=canonical_room_metadata_recovered_after_outbox_drainer_v2`. After the cleanup-worker hardening deploy, provider deletion is tracked separately through `daily_room_provider_deleted_at` / `daily_room_provider_delete_reason=room_cleanup:provider_room_deleted` instead of erasing room metadata.

Interpretation:

- The failure boundary moved again. This was not Ready Gate, Daily room creation, remote-seen repair, or confirmed-encounter promotion. The date started.
- Historical remote-seen evidence proved the encounter happened, but did not prove the missing peer was currently present after the provider leave/rejoin sequence. The old peer-missing suppression theory was too broad.
- `date_timeout` was technically survey-eligible, but using the normal timeout reason after a post-encounter peer disappearance made the client wait for the wrong path and left one side vulnerable to `update_participant_status(..., 'offline')` overwriting `in_survey`.
- Terminal forensics were weaker than they should be because `video_session_date_timeout_v2` did not repair/return canonical Daily room metadata after terminal transition/replay, and the old cleanup/outbox workers used null `daily_room_name` / `daily_room_url` as the provider-room-deleted marker.

Implementation plan from this audit, updated by the 2026-06-08 active-date stability patch:

- Web/native/mobile first-remote watchdogs should suppress local terminal peer-missing for terminal survey truth and historical bilateral encounter truth. Terminal survey truth opens survey recovery immediately; historical encounter truth logs `daily_no_remote_watchdog_historical_truth_suppressed`, emits `peer_missing_suppressed_remote_seen`, keeps the room recoverable, and leaves provider/server absence reconciliation to own any terminalization.
- Web/native/mobile manual exits after confirmed encounter truth may still call end with `partner_absent_after_confirmed_encounter`, which remains post-date survey eligible. Automatic post-encounter peer-missing watchdog state should not local-end the date by itself.
- `update_participant_status` should keep `in_survey` sticky for survey-eligible ended sessions until that user has a `date_feedback` row. The old 30-second protection window is insufficient.
- `video_session_date_timeout_v2` should repair canonical Daily room metadata for already-ended/replay/post-transition terminal rows and include `daily_room_name` / `daily_room_url` in returned payloads and terminal events.
- Cleanup/outbox workers should never null terminal `daily_room_name` / `daily_room_url`. Provider room deletion must be represented by `daily_room_provider_deleted_at` and `daily_room_provider_delete_reason`, so support/debug forensics stay canonical after Daily provider cleanup.
- Observability must keep the new safe fields needed to tell same-session Daily parking, route ownership, current call object state, truth refresh attempts, and historical remote-seen truth apart.

Implemented and cloud-applied for this section:

- Supabase migration `20260605135616_video_date_terminal_survey_lifecycle_hardening.sql` replaces `update_participant_status` and `video_session_date_timeout_v2` with the sticky-survey and terminal-room-repair behavior above.
- Supabase migration `20260605143637_video_date_terminal_room_metadata_backfill.sql` records the initial helper-loop backfill. It proved the repair path could reconstruct canonical Daily room metadata, but later evidence showed old cleanup workers could re-null the same terminal fields.
- Supabase migration `20260605144003_video_date_terminal_room_metadata_corrective_backfill.sql` performs a bounded direct backfill for already-ended, survey-eligible rows with missing/non-canonical Daily metadata.
- Supabase migration `20260605145306_video_date_terminal_room_cleanup_preserve_metadata.sql` adds `daily_room_provider_deleted_at` and `daily_room_provider_delete_reason`, plus a pending-cleanup partial index, so provider deletion can be tracked without erasing terminal forensics.
- Supabase migrations `20260605145926_video_date_terminal_room_metadata_final_repair.sql` and `20260605150130_video_date_terminal_room_metadata_historical_delete_marker.sql` re-repair terminal rows after the cleanup worker fix and mark historically provider-deleted rooms.
- Supabase migration `20260605152058_video_date_pending_survey_registration_repair.sql` restores pre-hardening registrations that were already downgraded to `browsing` / `idle` / `offline` while still pointing at an ended survey-eligible session with no feedback.
- Edge Functions `video-date-outbox-drainer`, `video-date-room-cleanup`, and `video-date-orphan-room-cleanup` now stamp provider-delete markers instead of nulling `daily_room_name` / `daily_room_url`.
- Live cloud verification after the fixed workers had time to run showed zero remaining ended survey-eligible terminal-room candidates, while the repaired rows still retained canonical `daily_room_name` / `daily_room_url` and had provider-delete markers. Follow-up verification also restored both affected failed-session registrations to `in_survey` with zero feedback rows.
- Web `src/hooks/useVideoCall.ts` and `src/pages/VideoDate.tsx` now keep current-peer-vs-historical-encounter separation without client-owned post-encounter terminalization: historical encounter truth suppresses local peer-missing terminal UI, and post-encounter peer-missing terminal state logs `post_encounter_peer_missing_terminal_end_suppressed` with `provider_absence_server_owned_after_encounter`.
- Native/mobile `apps/mobile/app/date/[id].tsx` now mirrors the web peer-missing suppression and server-owned post-encounter absence behavior.
- Shared contracts now pin this incident through `shared/matching/videoDateTerminalSurveyLifecycleHardening.test.ts`, `shared/matching/videoSessionDailyGate.test.ts`, and updated warm-up/review follow-up tests.

### 14. Latest failed test after single-owner hardening: Ready Gate mark-ready timed out before Daily

Evidence source: attached chronological screenshots/network panels, read-only Supabase investigation, local source review, and Supabase cloud verification for linked project `schdyxcunwcvddlcshwd`.

Identifiers:

- Event: `21497965-394a-45fe-8700-5d91bf927f65`
- Video session: `cac485cd-da3b-475b-aa4c-27b70cd914d6`
- Participants:
  - `267aa05e-0802-4b87-9a7b-ff78b97fdfa7` / Kaan Apple / participant 1
  - `2a0995e1-8ec8-4a11-bdfe-0877c3383f5c` / Direk / participant 2

Observed flow:

- Participant 2 committed Ready Gate readiness at `2026-06-06T07:52:49.519065Z`, moving the session to `ready_b`.
- Participant 1 then attempted `mark_ready`, but repeated `video_session_mark_ready_v2` commands were rejected with SQLSTATE `57014` and `READY_GATE_TRANSITION_TIMEOUT`.
- The browser Network panel showed repeated `ready_gate_transition`, `get_video_date_start_snapshot_v1`, `video_session_mark_ready_v2`, profile/event/session reads, and one visible 500 from `get_video_date_start_snapshot_v1`.
- No `both_ready` row was reached. There was no Daily room metadata, Daily webhook row, surface claim, remote-seen evidence, date start, or feedback row for this session.
- At `2026-06-06T07:53:39.056628Z`, the session expired as `ready_gate_expired`.

Interpretation:

- This failure is distinct from the post-Ready Gate Daily-owner and survey failures. It regressed at the earliest critical intent boundary: the second user's ready tap did not durably write `ready_participant_1_at`.
- Prior mark-ready work still allowed a wrapper/preflight/observability path to consume enough time that the critical ready timestamp was never committed before retry/expires handling.
- The frontend retried explicit retryable payloads, but an RPC transport/PostgREST error could still stop the mark-ready attempt after the first failed call.

Implemented for this section:

- Supabase migration `20260606092944_video_date_decisive_mark_ready_commit.sql` replaces the public `video_session_mark_ready_v2(uuid,text,text)` with one direct decisive hot path.
- Supabase migration `20260606100511_video_date_mark_ready_lint_cleanup.sql` keeps that public function behavior unchanged but removes the unused event-append variable that linked DB lint flagged after the first apply.
- The new hot path begins the idempotent command before locking `video_sessions`, commits the actor's ready timestamp and deterministic `both_ready` Daily room metadata before observability/event/outbox work, and extends `ready_gate_expires_at` to at least `now() + 45 seconds` on every real ready tap.
- Idempotency remains compatible with deployed clients: committed replay returns current DB truth, retryable rejected replay reopens the same command, and stale `processing` commands older than six seconds can be reclaimed.
- Existing `ready_gate_transition('mark_ready')` bridges to the same public RPC, so web, mobile web, native/mobile, and older clients share the same backend behavior.
- Web `src/hooks/useReadyGate.ts` and native/mobile `apps/mobile/lib/readyGateApi.ts` now retry bounded mark-ready RPC errors with the same deterministic idempotency key, in addition to retrying explicit retryable backend payloads.
- New contract `shared/matching/readyGateDecisiveMarkReadyCommit.test.ts` pins the direct backend path, post-commit auxiliary work ordering, idempotency recovery, grants, and web/native RPC-error retry parity. It is wired into `npm run test:video-date-v4`.
- Existing Ready Gate 57014 reliability contracts were made whitespace-tolerant where line wrapping had made assertions brittle without changing product behavior.

Verification after implementation, with no web or native build triggered:

- `npx tsx shared/matching/readyGateDecisiveMarkReadyCommit.test.ts`
- `npx tsx shared/matching/readyGate57014ReliabilityContracts.test.ts`
- `npx tsx shared/matching/videoDatePhase3Contracts.test.ts`
- `npx tsx shared/matching/videoDateStartSnapshotContracts.test.ts`
- `npx tsc --noEmit -p tsconfig.app.json`
- `cd apps/mobile && npm run typecheck`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`
- live marker query confirmed `decisive_live=true`, `authenticated_execute=true`, and `anon_execute=false` for `video_session_mark_ready_v2(uuid,text,text)`
- no-auth smoke call returned structured `not_authenticated` JSON rather than a raw database error
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked` completed with only pre-existing warnings/notices unrelated to this migration
- post-cleanup live marker query confirmed `unused_event_removed=true`; a second linked DB lint no longer reported `public.video_session_mark_ready_v2`

Boundary:

- This directly addresses the `cac485cd-da3b-475b-aa4c-27b70cd914d6` Ready Gate mark-ready timeout / `ready_b` expiry failure class across all clients that use the shared RPC contract.
- This still is not product-health proof. The fresh disposable two-user production acceptance run remains required from match through survey completion, plus short Daily leave/rejoin under 12 seconds and real prolonged absence terminalization.

### 15. Surface client-identity hardening after route remount audit

Evidence source: attached chronological screenshots/network panels, source review, contract tests, and Supabase linked dry-run/list verification.

Observed risk:

- The UI could enter Ready Gate, `/date/:sessionId`, and Daily, but still show transient "Still connecting your date" / duplicate-owner overlays during route churn.
- Network traces showed repeated `claim_video_date_surface`, `record_heartbeat_v2`, `video_date_transition`, `video-date-snapshot`, and date/session polling while the route remounted.
- Web/native component remounts could create a new server-facing `client_instance_id` for the same user/session while the previous unexpired `video_date` surface claim still existed. That made one logical device look like a duplicate device to the backend.
- A second race existed where stale cleanup could release a fresh remount's surface claim if cleanup only knew the session key, not the specific active owner token.

Design decision:

- Do not solve this by backend same-profile/same-session auto-reclaim. That shortcut would allow a true second browser, mobile web tab, or native device for the same user/session to silently take over and race the original device.
- Keep backend duplicate-device conflict semantics strict: a different `client_instance_id` remains a conflict unless explicit takeover occurs.
- Fix the root cause at the clients by keeping a stable server-facing client identity per user/session and by making cleanup owner-tokened.

Implemented:

- Web `useVideoDateDupTabGuard` now stores a stable server-facing surface client id at `vibely_vd_surface_client:${profileId}:${sessionId}` and sends that id to `claim_video_date_surface` / `release_video_date_surface_claim`.
- Web keeps the tab-local lease owner separate from the server-facing surface client id, so duplicate-tab UX can remain local while the backend sees one stable logical device across remounts.
- Web active surface cleanup is owner-tokened and delayed briefly. It only releases when the cleanup still owns the active marker and no fresh same-client owner has appeared.
- Native/mobile `/date/[id]` mirrors this with `AsyncStorage` key `vibely_vd_native_surface_client:${profileId}:${sessionId}`, stable `vd-native-*` server client ids, owner-tokened active ownership, delayed guarded release, and a hydration gate so native cannot claim with a fallback id and then switch to the persisted id mid-session.
- No new Supabase migration was kept for this pass. A proposed same-session SQL reclaim migration was intentionally deleted after review because it would weaken duplicate-device blocking.

Verification after implementation, with no web or native build run:

- `npx tsx shared/matching/videoDateSurfaceContinuityHardening.test.ts`
- `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`
- `npx tsx shared/matching/videoDateLatestFailureSurfaceOwnerContracts.test.ts`
- `npm run typecheck:core`
- `npx tsc --noEmit -p tsconfig.app.json`
- `cd apps/mobile && npm run typecheck`
- `git diff --check -- 'apps/mobile/app/date/[id].tsx' src/hooks/useVideoDateDupTabGuard.ts shared/matching/videoDateSurfaceContinuityHardening.test.ts shared/matching/videoDateWarmupStabilityContracts.test.ts`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`

Cloud state:

- Linked Supabase dry-run returned `Remote database is up to date`.
- Local/remote migrations stayed aligned through `20260606100511_video_date_mark_ready_lint_cleanup.sql`.
- No additional migration was applied for this client-identity hardening pass.

Boundary:

- This addresses the surface-owner self-conflict/remount-release race across web, mobile web, and native/mobile clients that use the shared surface RPC contract.
- This still is not product-health proof. The fresh disposable two-user production acceptance run remains required from match through survey completion, plus short Daily leave/rejoin under 12 seconds and real prolonged absence terminalization.

---

### 16. Active-date stability after latest two-user failure: server-owned absence and live remount heartbeat

Evidence source: latest chronological screenshots/network panels, local source audit, focused contracts, and linked Supabase catalog verification.

Observed product/runtime shape:

- The flow repeatedly reached `/date/:sessionId`, displayed "Opening your date", created/entered Daily, and sometimes showed warm-up/date media, but later returned to opening/lobby-style recovery instead of staying in a stable bilateral date.
- Network panels showed the expected hot loop: `ready_gate_transition`, `record_video_date_launch_latency_checkpoint`, `video_session_mark_ready_v2`, `video-date-snapshot`, `get_video_date_start_snapshot_v1`, `mark_video_date_daily_alive`, `mark_video_date_daily_joined`, `mark_video_date_remote_seen`, `claim_video_date_surface`, `video_date_transition`, `record_video_date_client_stuck_observability`, `get_video_date_queue_hint_v1`, `get_profile_for_viewer`, session/registration/event reads, Daily websocket/object bundle traffic, and PostHog `/e/` ingestion.
- Backend catalog checks showed `claim_video_date_surface`, `mark_video_date_daily_alive`, `mark_video_date_daily_joined`, `video_date_transition`, and provider-absence reconciliation already fail soft and preserve the server-owned absence contract. No new migration was needed for this patch.

Implemented contract:

- Web and native first-remote watchdogs now treat terminal survey truth and historical encounter truth differently. Terminal survey truth still opens survey recovery. Historical bilateral encounter truth suppresses local terminal peer-missing, logs `daily_no_remote_watchdog_historical_truth_suppressed`, emits `peer_missing_suppressed_remote_seen`, and keeps the room recoverable while provider/server absence reconciliation decides whether the date should terminalize.
- Web parked same-session Daily cleanup preserves the active Daily identity and alive heartbeat for a live joining/joined call, with `daily_call_live_remount_identity_preserved` and `daily_call_live_remount_heartbeat_preserved` diagnostics. Destructive cleanup still clears identity/heartbeat for terminal, mismatched, or unrecoverable calls.
- Web and native post-encounter peer-missing terminal effects no longer call local end automatically. They log `post_encounter_peer_missing_terminal_end_suppressed` with `provider_absence_server_owned_after_encounter`; explicit user exits can still use `partner_absent_after_confirmed_encounter`.

Verification completed locally:

- `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`
- `npx tsx shared/matching/reviewComments1188_1197Followups.test.ts`
- `npx tsx shared/matching/videoDateTerminalSurveyLifecycleHardening.test.ts`
- `npx tsx shared/matching/videoDateLatestFailureRouteLifecycleContracts.test.ts`
- `npx tsx shared/matching/videoDateStableCopresenceOwnerContracts.test.ts`
- `npx tsx shared/matching/videoDateLifecycleRpcFailsoft.test.ts`
- `npm run test:video-date-v4`
- `npm run typecheck`
- `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` returned `Remote database is up to date.`

Boundary:

- This is implementation and cloud-contract evidence only. It is not acceptance proof. The required fresh disposable two-user production run must still prove match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> survey completion, plus short leave/rejoin and prolonged absence.

---

## Current Architecture Decisions

### Backend owns lifecycle truth

The client should render and retry, not invent lifecycle state. Authoritative truth lives in Supabase-backed session state and RPC responses.

### Mark-ready is a hot path

`video_session_mark_ready_v2` must stay narrow:

- start/recover the idempotent command before taking the session row lock,
- verify participant,
- preserve idempotency,
- persist readiness,
- derive canonical room metadata at both-ready,
- commit the command result before observability, event append, or provider outbox work,
- enqueue provider work fail-soft after readiness is already durable,
- return structured payload.

It must not synchronously create/provider-verify Daily rooms or depend on network/provider latency.

### Daily room metadata must be deterministic

The canonical Daily room for a video session is deterministic (`date-<sessionId-without-dashes>` style, per existing helpers). Missing row metadata must not make the route bounce forever if the canonical room can be derived safely.

### Daily active co-presence is stronger than joined history

`participant_1_joined_at` and `participant_2_joined_at` are latest-state launch evidence, not first-join history. A later Daily `participant.left` / `participant_*_away_at` makes that participant inactive until a newer client/provider join clears the away stamp and clears reconnect grace. `mark_video_date_daily_joined`, Daily webhook repair, reconnect-return, and reconnect-grace expiry must all use the same latest-join-newer-than-away rule.

### Daily start ownership is single-session and nonterminal-call reuse first

For a given `video_session_id`, the client should have one active Daily start pipeline. A same-session, same-room, nonterminal Daily call in `joining` or `joined` state must be reused or waited on, not torn down and rebuilt. Cleanup/rebuild is reserved for terminal, mismatched, or unrecoverable call state and must emit append-only diagnostics.

### Date-route ownership suppresses stale surface bounces

Once `/date/:sessionId` or the native date route owns a same-session active handoff, stale event-lobby or Ready Gate truth must not bounce that client back to `/ready` or lobby while Daily is joining/joined, handshake/date is active, or the same route ownership lease is fresh. Route ownership is client-local and short-lived; terminal survey truth and explicit exits still clear it. Web same-session Daily continuity is not allowed to depend on the optional cross-date warm-handoff feature flag.

### Remote-seen is canonical presence evidence, not only media-element evidence

`mark_video_date_remote_seen` should fire when a remote Daily participant is observed through provider presence, post-join snapshots, shared-call hydration, or mounted media. Media playback events remain valuable first-frame evidence, but canonical `participant_*_remote_seen_at` must not depend solely on a browser/native media element event.

### Historical encounter proof is not current peer presence

`participant_*_remote_seen_at`, `date_started_at`, and confirmed-encounter events prove the date happened and make terminal survey recovery eligible. They do not prove the remote peer is still in the current Daily room after later leave/rejoin churn, and they should not force client-owned terminalization by themselves. First-remote and peer-missing watchdogs suppress local terminal peer-missing on historical encounter truth, emit `peer_missing_suppressed_remote_seen`, and leave provider absence/reconnect grace to own terminalization. Terminal survey truth opens survey recovery. No-proof pre-date missing peer can still surface peer-missing choices.

### Confirmed encounters start the date before deadline fallback

Once both participants have confirmed bilateral remote-media/date-entry evidence and neither side has passed or both-decided, server truth must promote the session to `date` immediately. `mark_video_date_remote_seen` and `video_session_handshake_auto_promote_v2` must both use the shared confirmed-encounter promotion invariant; the handshake deadline finalizer is fallback-only. Deadline cleanup must never end an already confirmed encounter as `handshake_timeout`, and any launch-evidence extension must grant positive remaining time; zero-second extensions are terminal races in disguise.

### Browser lifecycle is not authoritative during handoff

`visibilitychange` is soft telemetry while Daily is joining/joined or while the session is in handoff, handshake, warm-up, or date. It must not call backend `mark_reconnect_self_away`. Hard exits such as real unload and non-persisted pagehide can still send leave signals. Native/mobile background uses local grace first and only sends backend away once the grace expires.

### Daily transport grace precedes backend partner-away authority

A Daily `participant-left` event is first a local transport signal, not immediate canonical absence. Web and native must hold a local 12s Daily transport grace before calling `mark_reconnect_partner_away`. Only the explicit backend reason `daily_transport_grace_expired` should start server reconnect grace. Legacy/null immediate-away calls during fresh warm-up evidence should be suppressed.

### Retryable is not terminal

Any payload with `retryable: true` must keep the user in syncing/retrying posture. "Ready Gate changed" is reserved for true replacement, terminal expiry, or multi-tab handoff.

### Terminal means stop work

Once canonical truth says `ended`, `ready_gate_expired`, forfeited, or replaced, clients must cancel prewarm, permission prewarm, route preload, and Ready Gate retries.

### Survey-required terminal truth is a hard stop

If an ended session has survey-required encounter evidence, `/date/:sessionId` is the survey host. Clients must synchronously stop Daily start/retry, surface claiming, reconnect grace, foreground sync, route/broadcast churn, and peer-missing timers, then open `PostDateSurvey`. Optional profile, observability, and verdict reads are not allowed to block survey entry; only a confirmed completed `date_feedback` row can route away from survey.

### Survey status is sticky until feedback

Client presence writes must not move a participant from `in_survey` to `browsing`, `idle`, or `offline` while a survey-eligible ended session exists for that event/user and the user has no `date_feedback` row. This is not a short grace window; it is a lifecycle invariant.

### Terminal rows retain Daily room forensics

Terminal timeout/replay/already-ended paths must repair deterministic Daily room metadata when possible and return `daily_room_name` / `daily_room_url`. Null terminal room metadata makes later support analysis and room cleanup harder and should be treated as a repairable invariant violation. Daily provider cleanup must stamp `daily_room_provider_deleted_at` / `daily_room_provider_delete_reason` and leave terminal room metadata intact.

### Active video and survey truth owns the route surface

If active session truth says `kind=video`, including `queue_status = in_survey`, `/date/:sessionId` or native `/date/[id]` is the single owner. Lobby and Ready Gate surfaces must yield to that owner, must not run Daily prepare for `in_survey`, and must not reopen stale Ready Gate UI when the same session is already video/survey-owned. Terminal-survey recovery must force navigation past duplicate-navigation/manual-exit suppression on both web and native while preserving same-route no-op protection.

### Exposed lifecycle RPCs are outermost fail-soft

Hot-path browser/native-callable lifecycle RPCs must not leak raw 500s for stale, duplicate, already-terminal, or transient database contention. `claim_video_date_surface`, `mark_video_date_daily_joined`, `mark_video_date_remote_seen`, and `get_or_seed_video_session_vibe_questions` are wrapped with outer fail-soft shells that preserve existing base behavior and return retryable JSON with SQLSTATE/message/server time on uncaught errors.

---

## Open Gaps And Risks

These are not claims that the current code is broken; they are the unproven areas that must be validated before declaring recovery complete.

1. **No fresh successful manual E2E proof yet.** The final acceptance run must prove match -> survey completion after the latest deploy.
2. **Production SQLSTATE history is incomplete.** Some earlier fixes were shipped without full log forensics. The newer wrappers should expose future residual SQLSTATE/message, but old failures may remain partly inferred.
3. **Warm-up stability must be observed, not assumed.** Passing requires both users in the same Daily room at the same time, remote tracks mounted, and no backend terminalization from a short provider transport flap.
4. **Static and CI checks passed after the warm-up stabilization patch, but they are not acceptance proof.** The deployed local-grace and terminal-survey hard-stop behavior still needs a real two-user production run.
5. **Native/mobile runtime needs physical-device smoke.** Static parity and contracts are not enough for mobile media permissions, push, Daily transport events, app backgrounding, and route restoration.
6. **Latest-state presence, remote-seen, immediate confirmed-encounter promotion, and deadline fallback rescue migrations are applied, but behavior still needs production proof.** Cloud catalog verification confirms `20260604193140_video_date_latest_presence_grace_repair.sql`, `20260604205645_video_date_remote_seen_latest_state.sql`, `20260605085010_video_date_confirmed_encounter_deadline_rescue.sql`, and `20260605115657_video_date_early_confirmed_encounter_promotion.sql`; the next acceptance run must prove they clear grace on return, suppress stale expiry, promote confirmed encounters to `date` immediately after bilateral remote media, and preserve positive launch-evidence extensions in real Daily traffic.
7. **Daily start ownership must be proven under real browser behavior.** Static tests assert same-session reuse, but production must show no same-session `leave()`/`destroy()` churn while joining/joined.
8. **Date-route ownership and live Daily preservation are newly patched, not production-proven.** The next run must show no `/date` <-> `/ready` cycling while a same-session Daily call is joining/joined, and no lobby/Ready Gate surface should prepare Daily or reopen Ready Gate after active `video` / `in_survey` truth exists.
9. **Soft lifecycle suppression must be proven.** The browser should not send `web_visibilitychange` self-away while Daily is active, but hard unload/pagehide should still work.
10. **PostHog rate-limit spam remains noisy.** It is probably not the Video Date root cause, but it can hide useful console signals and should be handled separately.
11. **OneSignal 409 identity noise remains non-blocking but distracting.** It should not block Video Date, but provider health should stay visible.
12. **Manual survey completion still needs proof.** Many recent fixes focused on match -> Ready Gate -> room entry; survey end-to-end persistence must be revalidated.
13. **Post-encounter peer absence needs production proof.** The latest failed test reached `date`, then one peer disappeared. Web/native/mobile now distinguish historical encounter proof from current peer presence, suppress local terminal peer-missing on historical encounter truth, and leave automatic terminalization to provider/server absence reconciliation; explicit manual exits may still use `partner_absent_after_confirmed_encounter`. A fresh two-user run must prove both users still reach survey.
14. **Sticky survey lifecycle needs production proof.** Cloud function markers prove `update_participant_status` now protects pending survey rows until feedback exists; a fresh run must prove normal web/native/mobile lifecycle writes no longer knock either participant out of survey.
15. **Terminal Daily room repair has cloud data proof, but still needs runtime proof.** Cloud verification restored the failed session and found zero remaining ended survey-eligible rows with missing/non-canonical Daily metadata. A fresh run must prove terminal `date_timeout` and replay/already-ended responses preserve or repair `daily_room_name` / `daily_room_url` naturally.
16. **Lifecycle RPC fail-soft wrappers are cloud-applied but still need runtime proof.** Catalog verification proves the wrappers are installed and call the preserved base implementations, but the next live run must confirm browser/native clients no longer see raw 500s from stale/duplicate/terminal lifecycle calls.
17. **Decisive mark-ready commit is cloud-applied but still needs production proof.** Catalog verification proves `20260606092944_video_date_decisive_mark_ready_commit.sql` and lint cleanup `20260606100511_video_date_mark_ready_lint_cleanup.sql` are live, callable by authenticated clients only, and warning-free in linked lint; the next run must prove both ready taps commit without retry/expiry collapse under real web/native/mobile timing.

---

## Required Acceptance Run

Run this on a fresh disposable test pair after deployment has propagated:

1. Open two distinct browsers, browser profiles, or devices with two test users. If a same-browser disposable test is used, record whether storage/profile context is shared.
2. Register both users into the same live test event.
3. Match them from event lobby.
4. Let one user tap ready first; wait several seconds; then let the second user tap ready.
5. Repeat with reversed order.
6. Repeat with one client refreshed during Ready Gate.
7. Repeat with one duplicate tab open and verify the duplicate-tab copy does not kill the active path for the other participant or the canonical session.
8. Confirm both users land on the same `/date/:sessionId`.
9. Confirm both users join the same Daily room.
10. Confirm local and remote media are visible/audible or intentionally muted.
11. Let the date end or end it explicitly.
12. Complete the post-date survey on both sides.
13. Repeat once with a simulated short Daily leave/rejoin under 12s and confirm no backend `reconnect_grace_expired` terminalization.
14. Confirm terminal survey truth opens `PostDateSurvey` on `/date/:sessionId` without `/date` <-> `/ready` cycling or new Daily/surface churn.
15. Confirm no raw 500s from:
    - `video_session_mark_ready_v2`
    - `ready_gate_transition`
    - `video_date_transition`
    - `claim_video_date_surface`
    - `mark_video_date_daily_joined`
    - `mark_video_date_remote_seen`
    - `get_or_seed_video_session_vibe_questions`
    - `video-date-token-refresh`
    - `daily-room`
16. Confirm no stale "This Ready Gate changed" copy unless there is a real duplicate-tab/session replacement case.
17. Query Supabase and Daily afterward for the exact session timeline.
18. Confirm the Daily webhook ledger has `participant.joined` and `participant.left` rows for both users when they actually join/leave.
19. Confirm `mark_video_date_daily_joined` logged `handshake_started_after_active_daily_copresence` only after both latest Daily presences were active, and `daily_join_waiting_for_active_partner` only when the partner's latest presence was absent or away.
20. Confirm no legacy/null `mark_reconnect_partner_away` starts backend grace during fresh warm-up evidence; explicit `daily_transport_grace_expired` may start backend grace only after local transport grace expires.
21. Confirm same-session Daily start does not repeatedly call `leave()` / `destroy()` while the call is `joining-meeting` or `joined-meeting`; if cleanup happens, inspect `daily_call_cleanup` diagnostics for `caller`, `cleanup_reason`, `meeting_state`, `leave_called`, and `destroy_called`.
22. Confirm `web_visibilitychange` does not produce backend `mark_reconnect_self_away` during active Daily handoff/warm-up/date.
23. Confirm provider/client return clears `reconnect_grace_ends_at` via `reconnect_grace_cleared_by_daily_join`, `reconnect_grace_cleared_by_provider_join`, or `reconnect_grace_cleared_by_return`.
24. Simulate post-encounter peer disappearance after `date_started_at`; confirm the remaining user sees peer-missing, the server ends with a survey-eligible reason, both registrations remain `in_survey` until feedback, and both users can complete survey.
25. Confirm terminal rows retain deterministic Daily room metadata after timeout/replay/already-ended paths.
26. Confirm a real prolonged absence still ends the session with `reconnect_grace_expired`.

Pass condition: both users complete the full journey from match through survey completion without lobby cycling, stale Ready Gate invalidation, or split-room Daily behavior.

---

## Investigation Checklist For The Next Failure

If Video Date fails again, collect this before changing code:

- Event ID.
- Video session ID.
- User IDs for both participants.
- Browser/device/platform for each user.
- Exact screen copy and timestamp.
- Console errors filtered to network/RPC/Daily only.
- Network response bodies for failed or retryable RPCs.
- Daily room name and Daily session IDs.
- Supabase rows for:
  - `video_sessions`
  - `event_registrations`
  - `video_session_commands`
  - `video_date_surface_claims`
  - `video_date_daily_webhook_events`
  - `video_date_provider_outbox`
  - `event_loop_observability_events`
- Whether `daily_room_name` and `daily_room_url` were present at both-ready.
- Whether `ready_participant_1_at` and `ready_participant_2_at` were set.
- Whether `participant_1_joined_at`, `participant_2_joined_at`, `participant_1_away_at`, `participant_2_away_at`, `participant_1_remote_seen_at`, `participant_2_remote_seen_at`, `handshake_started_at`, and `date_started_at` support active co-presence.
- Whether the latest Daily provider event for either participant was `participant.left` after their last `participant.joined`.
- Whether duplicate-tab behavior came from local browser storage, server `video_date_surface_claims`, or a real same-user duplicate surface.
- Whether any payload included:
  - `retryable_command_reopened`
  - `reclaimed_processing_command`
  - `decisive_mark_ready_commit`
  - `expiry_grace_applied`
  - `hot_path`
  - `sqlstate`
  - `legacy_mark_ready_signature_detected`
  - `daily_join_waiting_for_active_partner`
  - `handshake_started_after_active_daily_copresence`
  - `daily_transport_grace_expired`
  - `away_mark_suppressed`
  - `daily_transport_grace_required`
  - `latest_joined_at`
  - `reconnect_grace_cleared`
  - `reconnect_grace_cleared_by_daily_join`
  - `reconnect_grace_cleared_by_provider_join`
  - `reconnect_grace_cleared_by_return`
  - `mark_reconnect_self_away_suppressed_active_daily_presence`
  - `reconnect_grace_expiry_suppressed_latest_presence`
  - `daily_call_cleanup`
  - `daily_call_reuse`
  - `daily_call_busy_internal_retry`
  - `remote_seen_canonical_repair_failed`
  - `remote_seen_canonical_repaired`
  - `latest_remote_seen_at`
  - `previous_remote_seen_at`
  - `peer_missing_suppressed_remote_seen`
  - `peer_missing_suppressed_survey_truth`
  - `daily_no_remote_watchdog_historical_truth_suppressed`
  - `post_encounter_peer_missing_terminal_end_suppressed`
  - `provider_absence_server_owned_after_encounter`
  - `partner_absent_after_confirmed_encounter`
  - `historical_remote_seen_truth`
  - `truth_refresh_attempt`
  - `go_survey`
  - `forceSurvey`
  - `daily_call_singleton_eligible`
  - `will_park_singleton`
  - `parked_singleton`
  - `daily_call_live_remount_identity_preserved`
  - `daily_call_live_remount_heartbeat_preserved`
  - `activeIdentityPreserved`
- Whether `ended_reason`, `survey_required`, `date_feedback`, and `forceSurvey` route state support immediate survey recovery.

Do not treat "This Ready Gate changed" as a root cause. Treat it as a symptom and prove why the client selected stale terminal copy.

---

## Primary Files To Inspect For Future Work

Backend / migrations:

- `supabase/migrations/20260604093000_video_date_failsoft_date_room_rpcs.sql`
- `supabase/migrations/20260604094500_video_date_transition_preserve_raise_semantics.sql`
- `supabase/migrations/20260604103000_ready_gate_mark_ready_hot_path_retry_recovery.sql`
- `supabase/migrations/20260604104154_ready_gate_mark_ready_grace_notification_auth.sql`
- `supabase/migrations/20260604142017_video_date_active_presence_join_guard.sql`
- `supabase/migrations/20260604170438_video_date_warmup_reconnect_stability.sql`
- `supabase/migrations/20260604193140_video_date_latest_presence_grace_repair.sql`
- `supabase/migrations/20260604205645_video_date_remote_seen_latest_state.sql`
- `supabase/migrations/20260605085010_video_date_confirmed_encounter_deadline_rescue.sql`
- `supabase/migrations/20260605115657_video_date_early_confirmed_encounter_promotion.sql`
- `supabase/migrations/20260605135616_video_date_terminal_survey_lifecycle_hardening.sql`
- `supabase/migrations/20260605143637_video_date_terminal_room_metadata_backfill.sql`
- `supabase/migrations/20260605144003_video_date_terminal_room_metadata_corrective_backfill.sql`
- `supabase/migrations/20260605145306_video_date_terminal_room_cleanup_preserve_metadata.sql`
- `supabase/migrations/20260605145926_video_date_terminal_room_metadata_final_repair.sql`
- `supabase/migrations/20260605150130_video_date_terminal_room_metadata_historical_delete_marker.sql`
- `supabase/migrations/20260605152058_video_date_pending_survey_registration_repair.sql`
- `supabase/migrations/20260605170249_video_date_surface_owner_outer_failsoft.sql`
- `supabase/migrations/20260605174703_video_date_vibe_question_outer_base_name_repair.sql`
- `supabase/migrations/20260605200729_video_date_beforeunload_active_presence_repair.sql`
- `supabase/migrations/20260605203904_video_date_remote_seen_grace_payload_preserve.sql`
- `supabase/migrations/20260605211924_video_date_surface_claim_expiry_current_guard.sql`
- `supabase/migrations/20260605221535_review_comments_1199_1204_followups.sql`
- `supabase/migrations/20260605222458_review_comments_helper_name_repair.sql`
- `supabase/migrations/20260605232304_video_date_single_owner_runtime_hardening.sql`
- `supabase/migrations/20260606092944_video_date_decisive_mark_ready_commit.sql`
- `supabase/migrations/20260606100511_video_date_mark_ready_lint_cleanup.sql`
- `supabase/functions/video-date-outbox-drainer/index.ts`
- `supabase/functions/video-date-room-cleanup/index.ts`
- `supabase/functions/video-date-orphan-room-cleanup/index.ts`

Web:

- `src/components/lobby/ReadyGateOverlay.tsx`
- `src/hooks/useReadyGate.ts`
- `src/pages/VideoDate.tsx`
- `src/hooks/useVideoCall.ts`
- `src/hooks/useVideoDateDupTabGuard.ts`
- `shared/matching/videoDateTerminalSurveyLifecycleHardening.test.ts`
- `shared/matching/videoSessionDailyGate.test.ts`

Native/mobile:

- `apps/mobile/components/lobby/ReadyGateOverlay.tsx`
- `apps/mobile/app/ready/[id].tsx`
- `apps/mobile/app/date/[id].tsx`
- `apps/mobile/lib/readyGateApi.ts`
- `apps/mobile/lib/videoDateApi.ts`

Provider / notification:

- `supabase/functions/daily-room/index.ts`
- `supabase/functions/video-date-token-refresh/index.ts`
- `supabase/functions/video-date-outbox-drainer/index.ts`
- `supabase/functions/send-notification/index.ts`
- `supabase/functions/swipe-actions/index.ts`

Contracts:

- `shared/matching/readyGate57014ReliabilityContracts.test.ts`
- `shared/matching/readyGateDecisiveMarkReadyCommit.test.ts`
- `shared/matching/videoDateFailsoftDateRoomRpcs.test.ts`
- `shared/matching/videoDateEndToEndHardening.test.ts`
- `shared/matching/videoDateDefinitiveHandoffRecovery.test.ts`
- `shared/matching/videoDateSurfaceContinuityHardening.test.ts`
- `shared/matching/videoDateWarmupStabilityContracts.test.ts`
- `shared/matching/phase2PaymentsDurableNotifications.test.ts`

Runbooks:

- `docs/video-date-diagnostics-runbook.md`
- `docs/video-date-end-to-end-hardening-runbook.md`
- `docs/video-date-hardening-closure-handoff.md`
- `docs/video-date-post-release-monitoring-runbook.md`
- `docs/video-date-daily-webhook-operator-checklist.md`

---

## Update Log

### 2026-06-06

- Implemented the definitive owner/stable-copresence recovery plan in code and a coordinated Supabase migration, without running web or native builds. The new shared client owner contract lives in `shared/matching/videoDateEntryOwner.ts` and keys date-entry ownership by `{session_id,user_id}` plus Daily call ownership by `{session_id,user_id,room_name}`. Web and native/mobile prepare-entry paths now claim the same owner, coalesce duplicate force retries, hand off route state as `navigating`, and keep date route/Daily ownership separate from component-local remounts.
- Web `src/hooks/useVideoCall.ts` and native/mobile `apps/mobile/app/date/[id].tsx` now emit route/session-level Daily owner state, send `mark_video_date_daily_alive` heartbeats after join, stamp `owner_id`, `call_instance_id`, `provider_session_id`, `entry_attempt_id`, and `owner_state`, mark unexpected provider `left-meeting` as `daily_owner_provider_left_unexpected`, and promote owner state to `remote_seen` when canonical remote-seen succeeds. Nonterminal remount cleanup remains a UI detach/parking path; terminal survey, explicit leave/end, room/session mismatch, provider terminal state, or idle expiry remain the destructive disposal boundaries.
- Added migration `20260606180000_video_date_stable_copresence_handshake_guard.sql`. It creates service-only `video_date_presence_events`, adds public RPC `mark_video_date_daily_alive(...)`, adds service helper `video_date_stable_copresence_v1(session_id)`, and replaces the fail-soft `mark_video_date_daily_joined` base so a join records latest evidence but starts handshake only after stable copresence: both latest provider/client joins are active after any later leave, both owners heartbeat after the later join, both heartbeats are fresh within 15 seconds, and stability lasts at least 2 seconds unless remote-seen is already present.
- CTO audit correction: the pending stable-copresence migration now separates latest-heartbeat freshness from first-heartbeat stability. Latest owner heartbeats prove both clients remain fresh within 15 seconds; `stable_copresence_since_at` is anchored to the first qualifying bilateral owner-heartbeat pair after the later join so ongoing heartbeat refreshes cannot keep resetting the 2-second stability window.
- CTO audit also found and corrected a native/mobile lobby parity gap: the deck query gate now requires the resolved event lifecycle to be live before fetching deck data, matching the intended web/Ready Gate pressure behavior. Two stale contract assertions were updated to the current source-aware inactive-reason setter and native deck-gating truth.
- Rollout completed: PR #1212 merged to `main` at `0a85449a0384f257d314a77c5a7fe455a71e2003`, the remote PR branch was deleted, and `20260606180000_video_date_stable_copresence_handshake_guard.sql` was applied to Supabase cloud. Post-apply `supabase migration list --linked` shows `20260606180000` local/remote aligned; `supabase db push --linked --dry-run` reports the remote database is up to date.
- Documentation and rollout guidance were synchronized after the cloud apply in PR #1213 at `a3c34dd2b2400908c3cf529d8c3146a141b7ebb8`. The nested app repo `main` / `origin/main` baseline for this handoff is `a3c34dd2b2400908c3cf529d8c3146a141b7ebb8`; the parent workspace has no configured remote and records the nested pointer locally at `9d0536877ebb9c808abb8b538c68935bf0581702`. Recheck live Git and Supabase before treating these as current in a later session.
- Verification passed without triggering web or native builds: `npx tsx shared/matching/videoDateStableCopresenceOwnerContracts.test.ts`, full `npm run test:video-date-v4` with only the two expected env-gated RLS skips, `npm run lint`, full `npm run typecheck` including mobile/core/app typechecks, `git diff --check`, `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`, `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`, and `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --level error --fail-on error`. Supabase lint returned no error-level findings; existing identifier-truncation notices are from earlier deployed helper names and were not failures.
- Live Supabase marker verification confirmed `video_date_presence_events` exists with RLS enabled, anon/authenticated cannot select it directly, `mark_video_date_daily_alive`, `mark_video_date_daily_joined`, and `video_date_stable_copresence_v1` exist, and the helper returns a typed `missing_session` waiting payload for an unknown session.
- Updated evidence vocabulary for the next failure/acceptance run: collect `video_date_presence_events`, `mark_video_date_daily_alive` payloads, `waiting_for_stable_copresence`, `stable_copresence`, `latest_owner_heartbeat_at`, `owner_id`, `owner_state`, `entry_attempt_id`, `call_instance_id`, `provider_session_id`, `daily_owner_provider_left_unexpected`, and any handshake-start reason. A handshake/date promotion from stale joined evidence or from a one-second Daily overlap is now considered a guard regression after the migration is applied.
- Acceptance boundary is unchanged. The implementation can be called verified only at static/database-contract level. Product success still requires a fresh disposable two-user production run through match -> Ready Gate -> same Daily room -> stable bilateral media/warm-up/date -> date end -> survey opens and completes, plus a short Daily leave/rejoin under 12 seconds and a real prolonged absence terminalization check.

- Investigated latest failed two-user production session `cac485cd-da3b-475b-aa4c-27b70cd914d6` for event `21497965-394a-45fe-8700-5d91bf927f65`. This run failed before Daily: participant 2 committed `ready_b`, participant 1's mark-ready attempts returned SQLSTATE `57014` / `READY_GATE_TRANSITION_TIMEOUT`, no `both_ready` or Daily room metadata was created, and the session expired as `ready_gate_expired`.
- Implemented and cloud-applied Supabase migration `20260606092944_video_date_decisive_mark_ready_commit.sql`. The public `video_session_mark_ready_v2` now commits participant readiness and deterministic `both_ready` room metadata before auxiliary observability/event/outbox work, preserves deployed idempotency/replay semantics, reclaims stale processing commands, and remains the target reached by legacy `ready_gate_transition('mark_ready')` bridges.
- Follow-up migration `20260606100511_video_date_mark_ready_lint_cleanup.sql` removes the unused `v_event` variable from the final live function definition after linked DB lint caught it. Reverification showed `unused_event_removed=true`, remote dry-run up to date, and linked DB lint no longer reports `public.video_session_mark_ready_v2`.
- Web `src/hooks/useReadyGate.ts` and native/mobile `apps/mobile/lib/readyGateApi.ts` now retry bounded mark-ready RPC transport errors with the same deterministic idempotency key, matching the existing retryable-payload behavior.
- Verification passed without triggering web or native builds: focused decisive mark-ready, 57014, Phase 3, and start-snapshot contracts; app TypeScript check; mobile typecheck; Supabase cloud apply/list/dry-run; live marker query; no-auth structured-response smoke; and linked DB lint with only pre-existing warnings/notices. This is still not acceptance proof; the fresh two-user production flow through survey completion remains required.
- Event Lobby RLS follow-up: investigated the live-policy proof note and found the real cloud risk is `event_registrations`, where authenticated direct DML grants/policies can bypass the intended registration/status/cancel RPC authority. The other audited authority tables (`event_swipes`, `video_sessions`, `event_deck_card_reservations`, `event_profile_impressions`, and `event_profile_impression_events`) are covered by the new read-only validation pack.
- Implemented and cloud-applied migration `20260606164737_event_registration_rpc_owned_dml_lockdown.sql`, validation SQL `supabase/validation/event_registration_rpc_owned_dml_lockdown.sql`, static authority contract `shared/matching/eventRegistrationRlsAuthority.test.ts`, and env-gated direct-write runtime proof `shared/matching/eventLobbyDirectWriteRlsRuntime.test.ts`. Web, mobile web, and native clients are contract-checked to avoid direct `event_registrations` DML and remain on RPC/service-role paths. Verification passed: focused RLS contracts, full `npm run test:event-lobby-regression`, `git diff --check`, live validation SQL with all seven checks true, raw live policy/privilege query showing `event_registrations` authenticated `SELECT` only with no DML policies, `supabase migration list --linked` aligned through `20260606164737`, post-apply `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` reporting the remote database is up to date, and linked public-schema lint with no error-level findings. Optional user-token direct-write runtime proof remains available through `npm run test:event-lobby-runtime-rls:required` when seeded `EVENT_LOBBY_RLS_*` credentials are present.
- Implemented an admission/setup and event-card lifecycle consistency patch. Shared admission readiness now records `payment_status` as diagnostic context only and keeps `admission_status = 'confirmed'` as the sole lobby/deck/Ready Gate readiness signal; web and native registration snapshots now expose `admissionStatus`, `paymentStatus`, `canEnterLobby`, `paidLikeButNotConfirmed`, and `admissionReadinessReason`. The seeded runtime QA pack now requires both smoke users to be confirmed-admitted and flags paid-like but non-confirmed rows as setup failure before deck/Ready Gate triage. Web list/featured cards and native/mobile Events tab featured/rail cards now use shared lifecycle badge resolution instead of raw `status === "live"` or time-window-only checks, terminal `ended_at` / `archived_at` fields flow into card props where available, and native registration-list helpers no longer treat payment-only rows as registered markers. Verification passed focused admission/card lifecycle helper tests, admission/card contract tests, `shared/matching/webEventLobbyGating.test.ts`, `shared/nativeEventPhase.test.ts`, `shared/matching/eventLobbyActiveEventContract.test.ts`, `shared/matching/eventDeckAuthorityContract.test.ts`, full `npm run test:event-lobby-regression`, `npm run test:video-date-ux-contracts`, full `npm run test:video-date-v4` with only the expected env-gated RLS skips, full `npm run typecheck`, `npm run lint`, and `git diff --check`. No Supabase migration, production data mutation, web build, native build, or manual two-user acceptance run was performed; this is not Video Date acceptance proof.

### 2026-06-05

- Review-comments follow-up for the latest 16 merged PRs (#1189 through #1204): unresolved current Codex threads were rechecked against `main`. Older items for route ownership, terminal survey hard-stop, remote-seen restamping, historical remote-seen peer-missing, documentation, and latest joined-at ordering were already covered by later merged work. New branch `codex/review-comments-1189-1204-followups` addresses the remaining live issues: migration `20260605221535_review_comments_1199_1204_followups.sql` authorizes authenticated confirmed-encounter promotion callers before delegating to room-metadata repair and tightens reconnect-grace expiry so only the participant with the latest away marker can satisfy joined-after-away recovery; migration `20260605222458_review_comments_helper_name_repair.sql` renames the preserved promotion base helper to short catalog name `vd_promote_ce_auth_20260605221535_base`; web first-remote terminal survey truth clears connecting state before survey recovery; and native/mobile prejoin now awaits a confirmed surface claim before entering Daily. Static contracts `shared/matching/reviewComments1198_1204Followups.test.ts` and `shared/matching/videoDatePhase5TimelineContracts.test.ts` cover these review follow-ups. Verification passed: focused review tests, `npm run typecheck:core`, `cd apps/mobile && npm run typecheck`, `npx tsc --noEmit -p tsconfig.app.json`, narrow ESLint, `git diff --check`, and `npm run test:video-date-v4` with only the expected env-gated runtime RLS skips. Supabase project `schdyxcunwcvddlcshwd` applied both migrations; post-apply dry-run returned remote up to date, migration list showed local/remote aligned through `20260605222458`, linked DB lint returned no error-level findings, and live catalog markers confirmed the short helper, removal of the truncated helper, participant auth before wrapper delegation, no room repair in the public wrapper, and participant-specific latest-away guards in reconnect expiry. GitHub review threads were not resolved or replied to because the requested workflow did not explicitly ask for GitHub thread write actions.
- Updated the recovery documentation and agent guidance after the ultimate stabilization rollout was merged and synchronized.
- Recorded then-current app `main` / `origin/main` commit `d2c912c873cd3c119b2296a507d5c4b05007f8a9`, PR #1195 final documentation follow-up, successful Vercel production status, deleted rollout branches, and clean app working tree.
- Recorded parent workspace gitlink commit `a50175961b64b5ec18fb5a0f5b3c7d3759ac5193`; the parent workspace has no configured remote, so GitHub push/merge verification applies to the nested `Git/vibelymeet` app repo.
- Reverified Supabase cloud alignment: remote database up to date, migrations `20260604193140` and `20260604205645` present, latest-state presence/remote-seen/transition/reconnect functions installed, and linked advisors returned no error-level issues.
- Clarified for future agents that the current primary work is not another broad Ready Gate rewrite. The next work should begin with fresh production evidence: prove or disprove stable Daily co-presence, local-grace behavior, reconnect grace clearing, terminal-survey hard-stop, and survey completion.
- Investigated the latest two-user failure session `c8027948-bf32-40c5-94a8-09e0d1207290` for event `324e52fc-c88a-4a57-a212-15ae79e0a1cd`. Ready Gate and same Daily room creation succeeded, but web same-session route churn unmounted `useVideoCall` while Daily was `joined-meeting`; cleanup called `leave()`/`destroy()`, provider emitted participant-left, and reconnect terminalization followed. Secondary evidence showed provider/media presence without canonical remote-seen symmetry, so `mark_video_date_remote_seen` needed earlier stamping than media-element first-frame only.
- Implemented web live same-session Daily remount preservation: `useVideoCall.unmount` now parks an eligible same-session `joining-meeting`/`joined-meeting` call for a short live-remount window without `leave()`/`destroy()`, then the next route instance reuses or waits for that call instead of joining again. This same-session continuity is decoupled from the optional cross-date warm-handoff flag. Added diagnostics for `live_same_session_remount`, skipped leave/destroy, singleton joined/in-flight reuse, and destroy-on-idle fallback.
- Implemented web and native/mobile date-route ownership leases. Event lobby, ReadyRedirect/standalone ready, `/date/:sessionId`, and native lobby/ready/date routes now mark fresh date-route ownership, suppress stale Ready Gate/lobby bounces while the date route owns the active handoff, and clear ownership on terminal survey or explicit abort.
- Hardened canonical remote-seen repair on web and native/mobile. Web now calls `mark_video_date_remote_seen` from `participant-joined`, `participant-updated`, and post-join snapshots in addition to first-frame/media playback. Native now bridges `markRemoteSeenOnce` through a ref and stamps from `participant_joined`, `participant_updated`, shared-call hydration, and mounted remote tracks.
- Deep-audited the route-ownership hardening and found two remaining edge cases:
  - `/date/:sessionId` and native `/date/[id]` were marking route ownership on mount before proving the session was actually date-routeable. That could suppress legitimate Ready Gate/lobby recovery for stale direct date entries. Web and native now keep the long entry-pipeline latch on mount but only refresh date-route ownership from explicit pre-navigation handoffs or active Daily startup/date evidence.
  - A handoff marked before the user id was available could leave an anonymous ownership key alive after later user-scoped cleanup. Web and native `clearVideoDateRouteOwnership` now clear the user-scoped key, anonymous key, and any remaining keys for that session.
- Reverified then-current baseline state during the deep audit: nested app repo `HEAD` and `origin/main` were both `d2c912c873cd3c119b2296a507d5c4b05007f8a9`; Supabase project `schdyxcunwcvddlcshwd` migration list showed `20260604142017`, `20260604170438`, `20260604193140`, and `20260604205645` applied remotely. The first parallel CLI check hit a local Supabase telemetry rename race; rerunning with telemetry disabled succeeded.
- Updated static contracts for route ownership, live Daily remount preservation, singleton join wait/reuse, and remote-seen provider-presence stamping across web/native/mobile.
- Verification: focused contracts passed after the native compile fix, web same-session continuity flag-decoupling, route-ownership mount-scope correction, and anonymous ownership cleanup:
  - `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`
  - `npx tsx shared/matching/videoDateSurfaceContinuityHardening.test.ts`
  - `npx tsx shared/matching/videoDateInstantPremiumV2Contracts.test.ts`
  - `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`
- Verification: full `npm run typecheck` passed after replacing an invalid native `currentPhaseRef` reference with the existing `phaseRef`, passed again after decoupling web same-session continuity from the optional cross-date warm-handoff flag, and passed again after the route-ownership/cleanup deep-audit patch. `git diff --check` also passed. No web or native build was run for this verification.
- CTO audit follow-up: removed obsolete web warm-handoff singleton scaffolding discovered during review. Web Daily continuity is now explicitly same-session live remount only with the 20s idle guard; the optional `video_date.daily_call_singleton_v2` flag remains native/mobile-only for idle/cross-session warm handoff. Contract tests now reject `warm_handoff` in web code so future changes cannot silently reintroduce that misleading branch.
- CTO audit follow-up: closed a native/mobile observability parity gap. If `mark_video_date_remote_seen` exhausts all retries after provider/media evidence, native now emits `remote_seen_canonical_repair_failed` through the same client-stuck observability channel web already uses. This does not change success behavior; it ensures the next native/mobile failure leaves canonical repair evidence instead of debug-only logs.
- Devil's-advocate re-audit found and fixed a native route-ownership self-authorization risk. Native `/date/[id]` was refreshing date-route ownership from the default handshake/date phase before backend route truth marked the route eligible, which could suppress a legitimate stale direct-entry bounce. Native now requires `dateEntryPermissionEligible` before refreshing ownership from active date-route state; explicit pre-navigation ownership still works for real handoffs.
- Devil's-advocate re-audit also found a long-call lease-expiry risk: web/native date-route ownership was refreshed only on state changes, so a stable active call could outlive the 90s local route-ownership TTL and lose stale-bounce protection. Web and native now refresh date-route ownership every 30s while, and only while, the date route is backend-eligible and locally active.
- A further anonymous-ownership pass found that the hydration fallback key should not carry the same authority as a user-scoped route lease. Web and native now cap anonymous route ownership to a 30s bridge while preserving the full 90s TTL plus 30s keepalive for user-scoped active date ownership.
- Expanded 63-file Video Date contract run surfaced a stale brittle assertion in `videoDateSurfaceRenderContracts.test.ts`; the Ready Gate web behavior already filtered actionable diagnostic rows correctly, but the test required both comparisons on one source line. The contract now asserts the behavior across formatting.
- Expanded contract verification also surfaced an over-specific Daily token refresh assertion in `videoDatePhase3PresenceRecoveryContracts.test.ts`. Manual source review confirmed the retryable web token-refresh failure path already clears the connecting state and starts `daily_token_refresh_failed` reconnect grace inside the `!refreshed` branch; the contract now verifies that behavior by branch scope instead of adjacency.
- Extra non-build CTO audit checks found two hook dependency lint warnings and one stale Ready Gate UX contract assertion. The native standalone Ready Gate initial truth effect now declares `cancelTerminalReadyGateWork`, the web pre-date exit callback declares `user?.id` for route-ownership cleanup, and the Ready Gate shared-vibe contract now checks the current snapshot-based partner guard.
- Additional canonical-origin audit found a notification boundary risk outside the Daily handoff itself: `send-notification` accepted legacy/apex app URLs and also used raw `APP_URL` for the OneSignal provider open URL, so a misconfigured apex `APP_URL` could emit non-canonical production notification links. `send-notification` now separates `RAW_APP_URL` for inbound compatibility from canonicalized outbound `APP_URL`; native notification deep-link handling still accepts historical apex links but derives that compatibility origin from the canonical `www` origin. The OneSignal contract now protects this split, and `npm run check:canonical-origin` passes.
- CTO audit verification after the cleanup/parity/route-ownership keepalive patch:
  - `node --import tsx --test shared/matching/videoDate*.test.ts` (569 tests, 567 passed, 2 env-gated runtime RLS skips, 0 failed)
  - `npm run test:daily-room-contract`
  - `npm run test:video-date-ux-contracts`
  - `npm run lint`
  - `npm run typecheck`
  - `git diff --check`
  No web or native build was run.
- Focused notification/canonical verification after the outbound URL fix:
  - `npm run check:canonical-origin`
  - `node --import tsx --test shared/matching/onesignalProviderOperationalQa.test.ts shared/pushDeliveryHealth.test.ts shared/permissions/permissionFlowHardeningContracts.test.ts shared/notificationInboxContracts.test.ts shared/matching/videoDatePhase4TokenPushDedupContracts.test.ts shared/matching/videoDatePushOpenDedupePreloadContracts.test.ts`
- Final non-build audit verification after the native notification allow-list rename and contract correction:
  - `npm run lint`
  - `npm run typecheck`
  - `git diff --check`
  - `npm run check:canonical-origin`
  - `node --import tsx --test shared/matching/onesignalProviderOperationalQa.test.ts shared/permissions/permissionFlowHardeningContracts.test.ts shared/matching/videoDatePhase4TokenPushDedupContracts.test.ts shared/matching/videoDatePushOpenDedupePreloadContracts.test.ts`
  - `node --import tsx --test shared/matching/videoDate*.test.ts` (569 tests, 567 passed, 2 env-gated runtime RLS skips, 0 failed)
  - `npm run test:video-date-ux-contracts`
  - `npm run test:video-date-v4`
- Read-only Supabase baseline sanity check: `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked` confirmed local/remote alignment through the expected Video Date migrations `20260604142017`, `20260604170438`, `20260604193140`, and `20260604205645`. The installed Supabase CLI is `2.104.0`; the first parallel version probe hit the known local telemetry rename race, and the sequential telemetry-opted-out rerun succeeded.
- Published recovery hardening PR #1196 (`https://github.com/kaanporsuk/vibelymeet/pull/1196`) and squash-merged it into `main` at commit `359fa5c42bd5fcdefef9a8a1fca9396d96194f4f`; source branch `codex/video-date-stability-cloud-sync` was deleted on GitHub and pruned locally.
- Deployed the changed Supabase Edge Function `send-notification` to cloud project `schdyxcunwcvddlcshwd` with explicit `--no-verify-jwt` so its service-to-service auth contract remains unchanged. `supabase functions list --project-ref schdyxcunwcvddlcshwd` showed `send-notification` active at version `813`, updated `2026-06-05 01:59:45 UTC`.
- Post-deploy Supabase verification: `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --dry-run --linked` returned `Remote database is up to date`, and `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked` still showed local/remote alignment through `20260604205645`. No migration was applied, and no web or native build was run.
- Boundary remains unchanged: these checks do not prove Video Date is fixed. Acceptance still requires a fresh disposable production two-user run through match -> Ready Gate -> same Daily room -> stable bilateral remote media/warm-up -> date end -> survey opens and completes.
- Investigated the latest two-user production test session `26d56372-7505-49ac-b701-c3e7be5c806c` for event `1822440f-e166-4ee4-95d0-6d8097e47e24` with participants `267aa05e-0802-4b87-9a7b-ff78b97fdfa7` and `2a0995e1-8ec8-4a11-bdfe-0877c3383f5c`. Local app git was at `63d41b652a7ba7ce0019a6ae11f711d08ac6639b`; `supabase migration list --linked` and `supabase db push --linked --dry-run` confirmed the cloud DB remains aligned through `20260604205645`.
- Latest session evidence: Ready Gate hot path succeeded (`ready_a` at `07:50:32.744162Z`, `both_ready` at `07:50:41.872032Z`, `hot_path=true`, `retryable_command_reopened=false`); canonical Daily room was `date-26d56372750549acb701c3e7be5c806c`. Daily webhooks show both users joined the same room at `07:51:04.388Z` and `07:51:04.390Z`; later participant-left rows were processed only after terminal truth and were recorded as `ignored_terminal_session`.
- Latest session remote-media evidence: `mark_video_date_remote_seen` produced `confirmed_encounter=true` by `07:51:06.776187Z`; latest observed `participant_1_remote_seen_at` was `07:51:15.240947Z` and `participant_2_remote_seen_at` was `07:51:41.629644Z`. `participant_1_away_at`, `participant_2_away_at`, and `reconnect_grace_ends_at` were null, so this failure was not a backend partner-away/reconnect-grace terminalization.
- Failure boundary: warm-up/date-start ownership diverged. No `continue_handshake` command committed. Two `handshake_auto_promote` commands raced at `07:53:00Z`: the first returned `state=handshake`, `extended=true`, `reason=handshake_launch_evidence_extension`, but `seconds_remaining=0`; the second immediately ended the session with `ended_reason=handshake_timeout`, `survey_required=true`, `date_started_at=null`, and no persisted user decisions. One user remained `in_survey`, the other later went `offline`; `date_feedback` had no rows.
- Root cause identified in deployed SQL: `finalize_video_date_handshake_deadline` still uses `handshake_started_at = LEAST(v_now, v_latest_launch_evidence_at)` for launch-evidence extension and does not consult `video_date_session_has_confirmed_encounter`. In this session, latest launch evidence was already more than 60 seconds old by the time the finalizer ran, so the extension returned zero seconds and allowed the peer client to terminalize immediately. Existing contract `shared/matching/videoDateDefinitiveHandoffRecovery.test.ts` currently asserts this flawed `LEAST(...)` pattern.
- Secondary UX/load evidence from the attached Console/Network logs: raw 500s occurred on `video_date_transition`, `claim_video_date_surface`, and `record_video_date_launch_latency_checkpoint`; `video-date-snapshot` returned 503 once; `video-date-token-refresh` returned 429 once. Observability recorded repeated route shells (`date_route_entered` and `video_stage_shell_visible` count 15), `warmup_timer_started` count 9, `daily_reconnect_started`, and `daily_reconnect_failure`. These are secondary stability/noise issues; the decisive terminal cause was confirmed encounter + zero-second extension + auto-promote timeout.
- Current plan boundary: fix the backend first with a new migration that makes confirmed bilateral remote media/date-entry evidence authoritative before handshake timeout, repairs launch-evidence extension to grant positive time or decline extension, and makes paired auto-promote calls idempotent under contention. Then harden web/native/mobile clients so a handshake extension refreshes server truth without immediate stale retry, warm-up timers do not reset backwards from server repairs, token/surface/snapshot telemetry callers back off cleanly, and survey hard-stop remains authoritative. This still must be proven by a fresh disposable production two-user run through match -> Ready Gate -> same Daily room -> stable bilateral media/warm-up -> date end -> survey completion.
- Implemented local migration `20260605085010_video_date_confirmed_encounter_deadline_rescue.sql`. It wraps `finalize_video_date_handshake_deadline`, restores canonical Daily metadata before deadline decisions, promotes active confirmed-encounter/no-pass/no-both-decided handshakes to `date`, updates both registrations to `in_date`, records `confirmed_encounter_deadline_promoted_to_date`, and replaces the zero-second `LEAST(...)` launch-evidence extension with `handshake_started_at = v_now` plus a positive `seconds_remaining` response.
- Hardened web/native/mobile clients for the repaired deadline contract. Web `VideoDate.tsx` and native `apps/mobile/app/date/[id].tsx` now treat positive `state=handshake, extended=true` responses as real deadline extensions, clear stale retry keys, refresh local countdowns, and avoid immediately retrying an already-repaired deadline. Warm-up `warmup_timer_started` telemetry is session-deduped so server-side `handshake_started_at` repairs do not create repeated timer-start metrics.
- Hardened surface-claim churn across web and native/mobile. `useVideoDateDupTabGuard` and native `/date/[id]` now use single-flight plus bounded backoff for retryable/unknown `claim_video_date_surface` failures while preserving hard duplicate-surface blocking on non-retryable `SURFACE_CLAIM_CONFLICT`. This addresses the secondary 500 retry storm evidence without letting optional ownership telemetry force users out of an active handoff.
- CTO audit follow-up found and fixed one native parity bug in the surface-claim backoff path: a skipped renewal during in-flight/backoff could clear visible duplicate-device blocking even though the server conflict had not been released. Native now mirrors the blocked state into `surfaceClaimBlockedRef`, uses a ref-backed setter, and returns `canContinue` from the latest blocked truth when a renewal is intentionally skipped.
- Reconciled peer-missing suppression contracts with the active recovery theory at the time. This was later superseded by the `782f5eb6-497f-4fd8-9898-2f47cf939751` audit: historical remote-seen/encounter exposure proves survey eligibility, not current peer presence. Current web/native first-remote watchdogs suppress peer-missing only for survey-required terminal truth.
- Tidied generated local output: removed the top-level untracked `dist/` directory left by earlier local work. A post-cleanup scan found no top-level generated `dist`, `.next`, `.turbo`, `coverage`, or `build` folders; the only untracked file is the intended migration `supabase/migrations/20260605085010_video_date_confirmed_encounter_deadline_rescue.sql`.
- Verification after implementation, with no web or native build run: `npx tsx shared/matching/videoDateDefinitiveHandoffRecovery.test.ts`, `npx tsx shared/matching/videoDateSurfaceContinuityHardening.test.ts`, `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`, `npx tsx shared/matching/reviewComments1188_1197Followups.test.ts`, `npx tsx shared/observability/videoDateClientStuckObservability.test.ts`, `node --import tsx --test shared/matching/videoDate*.test.ts` (570 tests: 568 pass, 2 expected env-gated RLS skips), `npm run test:video-date-ux-contracts`, `npm run typecheck:core`, `cd apps/mobile && npm run typecheck`, `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, and `git diff --check` all passed.
- Supabase cloud apply: `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked` applied `20260605085010_video_date_confirmed_encounter_deadline_rescue.sql` to project `schdyxcunwcvddlcshwd`. Post-apply `supabase migration list --linked` shows local/remote aligned through `20260605085010`, and `supabase db push --linked --dry-run` reports `Remote database is up to date`.
- Supabase live function verification: `supabase db query --linked` against `pg_get_functiondef('public.finalize_video_date_handshake_deadline(uuid, uuid, text, text)'::regprocedure)` returned `has_confirmed_encounter_rescue=true`, `has_positive_extension_v2=true`, `wraps_20260605085010_base=true`, and `old_least_pattern_position=0`.
- Supabase schema lint: first `supabase db lint --linked --level warning` attempt failed before querying due a CLI telemetry file rename race after concurrent CLI commands; rerun alone as `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db lint --linked --level warning --fail-on none` completed. It reported existing unrelated warnings and already-applied identifier-truncation notices; the new migration base name `finalize_vd_handshake_deadline_20260605085010_base` is 50 chars and does not add another overlong identifier.
- Supabase changelog scan (`https://supabase.com/changelog.md`) showed no relevant hosted Postgres migration/PLpgSQL breaking item for this scoped wrapper migration; the visible breaking items were unrelated/self-hosted/API exposure/OAuth/pg_graphql topics.
- Published confirmed-encounter deadline rescue PR #1199 (`https://github.com/kaanporsuk/vibelymeet/pull/1199`) and merged it into `main` at commit `ebe4690467b7956511338d94c5847b88889cd1a8`; source branch `codex/video-date-confirmed-encounter-rescue` was deleted on GitHub and pruned locally.
- Final sync verification after PR #1199: local `main` and `origin/main` aligned at `ebe4690467b7956511338d94c5847b88889cd1a8`; Supabase project `schdyxcunwcvddlcshwd` stayed aligned through `20260605085010`, and `supabase db push --linked --dry-run` reported `Remote database is up to date`.
- Updated active recovery guidance and related runbook overlays to the PR #1199 / `20260605085010` baseline so future agents do not start from the superseded PR #1195 assumptions. Historical rollout sections remain preserved as point-in-time evidence.
- Boundary remains unchanged: this implementation is not proof that Video Date is fixed. Acceptance still requires a fresh disposable production two-user run after migration/deploy through match -> Ready Gate -> same Daily room -> stable bilateral media/warm-up -> date end -> survey opens and completes.
- Investigated the latest failed production two-user session `d38e4c62-3cf9-4c98-b6a5-b37b2fe36ef3` for event `5dd6716f-b18b-40b1-b238-21d4eb1bf1d5`. Ready Gate and Daily room creation succeeded, both users joined the same Daily room, canonical remote-seen repair reached `confirmed_encounter=true`, first remote frame/readable evidence existed, and both registrations ended `in_survey`; however `date_started_at` remained null and the final session ended `handshake_timeout`.
- Latest failure boundary: web Daily lifecycle churn still emitted repeated `useVideoCall.unmount` cleanup diagnostics during active `joining-meeting`/`joined-meeting` states, provider join/leave churn emptied the room before deadline cleanup, `video_session_handshake_auto_promote_v2` remained deadline-gated despite confirmed bilateral media, and the deadline rescue ran too late to create a stable date. The final row also had null `daily_room_name`/`daily_room_url` despite earlier room metadata evidence.
- Current next-change plan from this audit: make web unmount cleanup mount-stable/ref-backed, latch same-session Daily continuity once join starts, make same-room `external_call_busy` a reuse/wait path, promote to `date` immediately on confirmed bilateral remote-seen plus joined evidence, add branch diagnostics to deadline cleanup, enforce canonical room metadata persistence, preserve native/mobile lifecycle parity, and structure handoff RPC failures instead of allowing opaque 500s.
- This was an audit-only investigation update. No code changes, migrations, deploys, web build, or native build were run.
- Implemented confirmed-encounter stability branch `codex/video-date-confirmed-encounter-stability`: web `useVideoCall` now uses ref-backed unmount cleanup and a latched same-session Daily continuity guard so React route/state churn parks live same-session Daily calls instead of tearing them down; CSP now allows `https://img.onesignal.com` to remove noisy OneSignal image violations during debugging.
- Added and applied Supabase migration `20260605115657_video_date_early_confirmed_encounter_promotion.sql` to project `schdyxcunwcvddlcshwd`. It creates shared helper `video_date_promote_confirmed_encounter_v1(...)`, wraps `mark_video_date_remote_seen`, `video_session_handshake_auto_promote_v2`, and `finalize_video_date_handshake_deadline`, promotes active confirmed bilateral encounters to `date` before deadline fallback, and repairs canonical Daily room metadata.
- Verification after implementation, with no web or native build run: focused Video Date contract tests, `npm run typecheck:core`, narrow ESLint on touched TS/TSX contract surfaces, `supabase db push --linked --dry-run`, `supabase db push --linked --yes`, `supabase migration list --linked`, and `supabase db lint --linked --schema public --fail-on error` all completed with the new migration aligned locally/remotely and no Supabase error-level lint findings. A live catalog/function marker query also returned true for migration application, the `mark_video_date_remote_seen` early-promotion wrapper, the auto-promote helper-before-base wrapper, the finalizer fallback wrapper, post-base room repair, and the shared helper's `confirmed_encounter_promoted_to_date` / `state = date` markers.
- Updated active recovery guidance and runbook overlays to the `20260605115657` early-promotion invariant. Historical PR #1199 / `20260605085010` rollout evidence remains preserved as point-in-time context.
- Investigated latest failed production test session `782f5eb6-497f-4fd8-9898-2f47cf939751` for event `6c9c647f-242b-463c-8b24-0896f02677e5`. Ready Gate, Daily room creation, bilateral provider joins, canonical remote-seen, and early confirmed-encounter promotion all worked; the session reached `date` at `2026-06-05T13:25:51.75678Z`. The failure was post-date-start lifecycle: both users left Daily around `13:26:48Z`, only participant 2 rejoined at `13:28:09.710Z`, `date_timeout` ended survey-eligible at `13:30:53.723208Z`, final Daily room metadata was null, `date_feedback` had no rows, participant 1 stayed `in_survey`, and participant 2 was later overwritten to `offline`.
- Implemented terminal survey lifecycle hardening in migrations `20260605135616_video_date_terminal_survey_lifecycle_hardening.sql`, `20260605143637_video_date_terminal_room_metadata_backfill.sql`, `20260605144003_video_date_terminal_room_metadata_corrective_backfill.sql`, `20260605145306_video_date_terminal_room_cleanup_preserve_metadata.sql`, `20260605145926_video_date_terminal_room_metadata_final_repair.sql`, `20260605150130_video_date_terminal_room_metadata_historical_delete_marker.sql`, and `20260605152058_video_date_pending_survey_registration_repair.sql`, web `useVideoCall`, web `VideoDate`, native/mobile `/date/[id]`, shared observability, cleanup/outbox Edge Functions, and new/updated contracts. The current invariant is sticky survey until feedback, pending-survey registration repair, terminal room metadata repair/preservation, provider-delete marker tracking, and current-peer-vs-historical-encounter separation.
- Applied all seven terminal-survey lifecycle migrations to Supabase project `schdyxcunwcvddlcshwd`; post-push dry-run reported remote up to date, live function marker query confirmed sticky-survey and terminal-room-repair clauses, linked public-schema lint returned no error-level findings, and the failed session `782f5eb6-497f-4fd8-9898-2f47cf939751` now has canonical `daily_room_name`/`daily_room_url`.
- Backfill learning: helper-based migration `20260605143637` repaired rows, but the old cleanup/outbox workers could re-null terminal room fields because they used null metadata as a provider-delete marker. The final fix adds explicit marker columns, redeploys `video-date-outbox-drainer`, `video-date-room-cleanup`, and `video-date-orphan-room-cleanup`, reruns final repair/marker migrations, and verifies zero remaining terminal-room metadata candidates while repaired rows stay preserved and marked. The sticky-survey function prevents future status downgrades, but already-downgraded live registrations required `20260605152058` to restore `in_survey` where no feedback exists.
- Revisited the original `782f5eb6-497f-4fd8-9898-2f47cf939751` failed-session prompt after PR #1202 merged. Local focused contracts passed for terminal-survey lifecycle, warm-up stability, and Daily gate recovery; the full `npm run test:video-date-v4` suite passed with only the expected env-gated runtime RLS skips. Remote Supabase dry-run again reported up to date, migrations through `20260605152058` remained applied, cleanup/outbox functions remained active at versions `video-date-room-cleanup` 437, `video-date-outbox-drainer` 46, and `video-date-orphan-room-cleanup` 38, and the live invariant query showed the failed session is survey-eligible with canonical Daily room metadata preserved, provider-delete markers present, both event registrations `in_survey`, zero remaining terminal metadata candidates, and zero downgraded pending-survey registrations. Audit conclusion: the bugs identified in that prompt are addressed in code and cloud state; the feature still requires the fresh manual two-user acceptance run before calling Video Date product-healthy.
- Implemented the latest `d7507b5c-7837-4310-a52c-ebd10c1ae535` failure plan locally. Web `SessionRouteHydration` now makes any hydrated active `video` session, especially `queueStatus="in_survey"`, the cross-surface route owner and sends stale `/ready` or lobby surfaces back to `/date/:sessionId` with `forceSurvey` state. Web `EventLobby` now treats `in_survey` as date-stack owned without running Daily prepare, suppresses Ready Gate openings when the same session is already video-owned, handles canonical `survey`/`ended` video-session realtime before Ready Gate, and stops deck pressure while video ownership is active. A PR review caught that web survey recovery still passed through duplicate/manual-exit suppression; the final patch gives the web date-navigation guard the same narrow `force` bypass as native and sends `forceSurvey` route state for active-session, registration-realtime, and video-session-realtime survey ownership.
- Added native/mobile parity for the same ownership boundary. `NativeSessionRouteHydration` redirects active video/survey sessions back to `/date/[id]`; native `dateNavigationGuard` supports `force` so terminal survey recovery bypasses duplicate-navigation/manual-exit suppression; native Ready Gate uses that force path for `go_survey`; native EventLobby routes `in_survey` from active-session hydration, registration realtime, video-session realtime, and stale Ready Gate enrichment directly to the date stack; native `/date/[id]` opens terminal survey for explicit `show_terminal`/`go_survey` recovery actions, not only legacy `ended` decisions.
- Created and applied Supabase migration `20260605170249_video_date_surface_owner_outer_failsoft.sql`. It wraps `claim_video_date_surface`, `mark_video_date_daily_joined`, `mark_video_date_remote_seen`, and `get_or_seed_video_session_vibe_questions` as outermost fail-soft RPCs, preserving existing base implementations while converting uncaught errors into retryable JSON payloads with `sqlstate`, message, retry delay, and server time. This directly addresses the raw 500s seen in the latest Console/Network evidence.
- The first cloud apply of `20260605170249` exposed a PostgreSQL identifier-truncation notice for the long `get_or_seed_video_session_vibe_questions_20260605170249_outer_base` helper name. Corrective migration `20260605174703_video_date_vibe_question_outer_base_name_repair.sql` repairs cloud and fresh-database state by normalizing that preserved base helper to `vd_vibe_q_outer_20260605170249_base` and repointing the wrapper to the short name.
- Added regression contract `shared/matching/videoDateLatestFailureSurfaceOwnerContracts.test.ts` and wired it into `npm run test:video-date-v4`. Verification run, with no web or native build: `npx tsx shared/matching/videoDateLatestFailureSurfaceOwnerContracts.test.ts`, `npx tsx shared/matching/videoDateFailsoftDateRoomRpcs.test.ts`, `npx tsx shared/matching/videoDateTerminalSurveyLifecycleHardening.test.ts`, `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`, `npx tsx shared/matching/videoDateSurfaceContinuityHardening.test.ts`, `npm run typecheck`, narrow `npx eslint` on touched TypeScript/TSX files, and `git diff --check` passed. Supabase linked cloud verification applied `20260605170249` and `20260605174703`, then `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` returned `Remote database is up to date`; `supabase migration list --linked` showed local/remote aligned through `20260605174703`; a live catalog marker query returned true for all four wrappers calling their preserved bases, the short vibe-question base helper existing, and the truncated helper name removed; `supabase db lint --linked --schema public --fail-on error` returned no error-level findings and only pre-existing warnings/notices. Local Supabase status/list could not run because Docker/local Postgres was not running; no web or native build was run.
- Investigated latest failed production test session `f3d1bd2a-5c37-43bb-9a9a-ec3c78fe7442` for event `9ac64807-7fe3-41b1-86db-49a3d4053b56`. The session reached `ready_gate_status=both_ready`, created Daily room `date-f3d1bd2a5c3743bb9a9aec3c78fe7442`, entered `date` at `2026-06-05T19:06:18.40143Z`, recorded both Daily joins, and recorded bilateral remote-media evidence. It still ended `reconnect_grace_expired` at `2026-06-05T19:09:00.570226Z` because a client lifecycle `mark_reconnect_self_away` with `reason=web_beforeunload` opened reconnect grace at `2026-06-05T19:07:43.923740Z` while the date was visibly active. This proves the remaining bug was not Ready Gate, room creation, early date promotion, sticky survey, or room metadata; it was browser lifecycle false-away authority plus too-short surface evidence during launch churn.
- Implemented lifecycle false-away hardening. Web `VideoDate` now treats `beforeunload`, `pagehide`, `visibilitychange`, and `freeze` as soft telemetry while Daily is active/starting or the session is in handshake/date; active soft lifecycle handling no longer stops local tracks. Web and native/mobile `video_date` surface claims now use a 30-second server TTL so route/app churn does not erase active-surface evidence before reconnect-grace expiry. Supabase migration `20260605200729_video_date_beforeunload_active_presence_repair.sql` wraps `video_date_transition`, `mark_video_date_remote_seen`, and `expire_video_date_reconnect_graces` so lifecycle away reasons `web_visibilitychange`, `web_freeze`, `web_beforeunload`, `web_pagehide`, and `app_background` are suppressed or cleared when fresh joined, remote-media, or surface evidence proves the active date is still live.
- Devil's-advocate follow-up: created `20260605203904_video_date_remote_seen_grace_payload_preserve.sql` after noticing the `20260605200729` `mark_video_date_remote_seen` wrapper could overwrite an existing base `reconnect_grace_cleared=true` with `false` when the outer wrapper itself did not update rows. The follow-up preserves the base true value with `v_base_reconnect_grace_cleared OR v_rows_changed > 0`.
- PR review follow-up: created `20260605211924_video_date_surface_claim_expiry_current_guard.sql` after review caught that the expiry wrapper accepted a surface claim valid at `v_latest_away_at` even if it had expired by `v_now`. The corrective wrapper requires `c.expires_at >= v_now` before surface evidence can suppress reconnect-grace expiry, so stale closed-tab claims cannot keep a genuinely disconnected session alive.
- Verification after implementation, with no web or native build run: `npx tsx shared/matching/videoDateWarmupStabilityContracts.test.ts`, `npm run test:video-date-v4` (with only the expected env-gated runtime RLS skips), `npm run typecheck:core`, narrow `npx eslint` on touched web/native/test files, and `git diff --check` passed. Supabase linked cloud verification applied `20260605200729`, `20260605203904`, and `20260605211924`, then `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` returned `Remote database is up to date`; live migration-row query showed all three versions applied; a live catalog marker query returned true for `web_beforeunload` transition handling, base delegation, remote-seen base grace payload preservation, remote-seen outer/base grace OR semantics, expiry surface/recent-media checks, and current unexpired surface-claim enforcement; `supabase db lint --linked --schema public --fail-on error` returned no error-level findings and only pre-existing warnings/notices.
- Documentation lesson from this pass: do not treat navigation/lifecycle events as terminal proof once Daily or the date route has positive active evidence. The backend must re-rank evidence at reconnect-expiry time, and client docs must name all equivalent sources across web and native/mobile (`web_visibilitychange`, `web_freeze`, `web_beforeunload`, `web_pagehide`, and `app_background`). Surface proof at expiry must be current, not merely historically valid near the away event. Static tests, cloud migration markers, and lint are required for release confidence, but the product-health boundary remains a fresh two-user acceptance run through post-date survey completion.
- Investigated latest failed production test session `4082fe36-8480-4d30-9a1d-1de227b855e3` for event `cdb38cb8-acfb-4fa1-b732-10903eccc3b0` after the PR #1204 lifecycle false-away repair and review-comment follow-ups. Before analysis, the parent repo showed only the nested `Git/vibelymeet` pointer changed, nested `main` / `origin/main` were clean at `9fc82b5f9867de0ab9905e64804c3d226a0f065f`, `supabase migration list --linked` showed local and remote aligned through `20260605222458`, and `supabase db push --linked --dry-run` returned `Remote database is up to date`.
- Latest session timeline: match/session created at `2026-06-05T22:14:44.285514Z`; both users marked Ready Gate ready at `22:14:47.530303Z` and `22:14:47.659992Z`; canonical Daily room `date-4082fe3684804d309a1d1de227b855e3` was verified; Daily joins arrived at `22:14:52.071Z` and `22:14:53.163Z`; `handshake_started_after_active_daily_copresence` fired at `22:14:53.504822Z`; `confirmed_encounter_promoted_to_date` fired at `22:14:53.687453Z`; `date_started_at` became `22:14:53.753531Z`.
- The date did not stabilize. Observability recorded 18 `date_route_entered`, 18 `video_stage_shell_visible`, 6 `daily_join_started` / `daily_join_success`, 26 `daily_call_cleanup`, and 7 `daily_call_busy_internal_retry` rows. Screenshots and console/network evidence matched that churn: the UI moved among `/date`, `/ready`, and lobby, showed "Still connecting your date", "This date is already open on another device", "Opening the room", "Opening your date", and "Connection softened. Reconnecting...", and raw browser 500s appeared for `video_date_transition`, `claim_video_date_surface`, `get_video_date_queue_hint_v1`, and `drain_match_queue_v2`.
- Daily provider evidence shows repeated join/leave churn, not one stable room stay: participant 1 joined `82be35b1-8d3b-489b-9fbb-972a8f0a183f`, left, rejoined as `ff11f656-331d-4790-a984-e4ff76f88efb`, left, rejoined as `82653369-97ff-4a71-ad04-35e4a46f5119`, and finally left at `22:16:43.365Z`; participant 2 joined `5b4e5797-2dd0-4842-ade4-e1be13cb568b`, left, rejoined as `51d5c859-3ad3-48c9-8438-1a9944567e4c`, and finally left at `22:16:53.812Z`. Surface claims existed only as current rows updated at `22:16:36.109573Z` and `22:16:37.209746Z`, expiring at `22:17:06.109573Z` and `22:17:07.209746Z`.
- Backend expiry at `2026-06-05T22:18:00.839509Z` ended the session as `reconnect_grace_expired`, `survey_required=true`, `resume_status=in_survey`, with both registrations `in_survey`, canonical Daily URL preserved, provider delete marker at `22:19:02.881Z`, and zero `date_feedback` rows. Given the final evidence at expiry - no current unexpired surface claim and latest provider events being leaves for both participants - the terminalization was consistent with the current guard. The product still failed because the client never maintained a stable active date/survey owner and no user completed the survey.
- Diagnostic gaps found in this audit: `record_video_date_client_stuck_observability` in cloud still rebuilds a narrow JSON detail and drops the current client-sanitized fields `same_session_daily_continuity_latched`, `will_park_singleton`, and `parked_singleton`, so production rows cannot prove whether same-session Daily parking/reuse worked. `video_date_transition` has lifecycle suppression logic but still delegates to its base without an outer `EXCEPTION` fail-soft shell, so console 500s can still surface from transition calls. Reconnect expiry currently logs `latest_away_reason=null` for this terminal event and clears away fields on the final row, leaving no durable explanation of which away marker opened the grace. `video_date_surface_claims` is a current-state table, not append-only history, so it cannot reconstruct earlier surface ownership or duplicate-overlay causes.
- Current implementation plan from this audit: make `/date/:sessionId` the only active owner after Ready Gate or `date_started_at`, and make terminal `in_survey` a hard-stop owner across date, ready, and lobby; move the Daily call object into a route-level/session-level owner so React unmount/remount churn cannot create external-call-busy loops or provider leave/rejoin storms; extend the DB observability function to preserve parking/continuity/owner fields; wrap `video_date_transition`, queue hint, and drain queue paths with true outermost retryable JSON fail-soft behavior; add append-only surface-claim and away/grace audit history; and make terminal survey truth synchronously cancel Daily/surface/reconnect/queue work and render a submit-resilient survey from any surface.
- This was an investigation and documentation update only. No code changes, migrations, web build, native build, or manual acceptance proof were run. The feature remains unproven until the fresh disposable two-user production flow completes match -> Ready Gate -> same Daily room -> stable bilateral media/warm-up/date -> date end -> survey opens and completes, plus short leave/rejoin and prolonged absence checks.
- Implemented the 2026-06-06 single-owner runtime hardening after the `4082fe36-8480-4d30-9a1d-1de227b855e3` audit. Web and native/mobile now mark active `/date/:sessionId` ownership as soon as an active video session or date route is hydrated; active `in_handshake` / `in_date` handoffs from lobby skip Daily prepare/restart and route directly to the date owner; terminal `in_survey` on web can force same-route survey recovery; native/mobile date recovery hard-stops local joining/reconnect state before showing survey.
- Created and applied Supabase migration `20260605232304_video_date_single_owner_runtime_hardening.sql` to project `schdyxcunwcvddlcshwd`. It adds service-only append-only `video_date_surface_claim_events`, wraps `video_date_transition`, `get_video_date_queue_hint_v1`, `drain_match_queue_v2`, and `claim_video_date_surface` with outermost retryable JSON fail-soft shells, and widens `record_video_date_client_stuck_observability` so production rows preserve route ownership, same-session Daily continuity, singleton parking, truth refresh, and related client-sanitized fields.
- Deep audit follow-up: native/mobile terminal survey recovery originally set `phaseRef.current = "ended"` only inside the survey opener, but a later render assignment could overwrite it before hook/server phase caught up; route ownership refresh could also stop when `dateEntryPermissionEligible=false`. Patched `/date/[id]` with `terminalSurveyHardStopRef`, disabled date-entry eligibility when terminal survey opens, pinned `phaseRef.current` / `latestDateRouteEndedRef` while the survey hard-stop is active, and kept date-route ownership refreshed when `showFeedback`, `phase === "ended"`, or the hard-stop ref is active. Added contract coverage so this cannot silently regress.
- Verification after implementation and deep audit: focused contracts `shared/matching/videoDateLatestFailureSurfaceOwnerContracts.test.ts`, `shared/matching/videoDateSurfaceContinuityHardening.test.ts`, and `shared/observability/videoDateClientStuckObservability.test.ts` passed 21/21; the full `npm run test:video-date-v4` passed with only the expected env-gated runtime RLS skips; the combined `npm run typecheck` passed; repo-wide `npm run lint` passed; and `git diff --check` passed. Supabase `db push --linked --yes` had already applied `20260605232304`; fresh post-audit `migration list --linked` showed local/remote aligned through `20260605232304`; fresh dry-run returned `Remote database is up to date`; live marker queries confirmed all four RPC wrappers call the new base helpers, the public wrappers remain executable by `authenticated`, the base helpers are not executable by `anon`/`authenticated` and remain executable by `service_role`, `video_date_surface_claim_events` exists with RLS enabled and service-only insert grants, and `record_video_date_client_stuck_observability` contains the preserved continuity/parking fields. `supabase db lint --linked --schema public --fail-on error` passed with only pre-existing warning/notices; `supabase db advisors --linked --type all --level error --fail-on error` returned `No issues found`. No web build or native build was run.
- This implementation still does not prove Video Date healthy. The fresh disposable two-user production acceptance run remains required, including match -> Ready Gate -> same Daily room -> stable bilateral media/warm-up/date -> date end -> survey opens and completes, plus short Daily leave/rejoin under 12s and real prolonged absence terminalization.

### 2026-06-04

- Created this dedicated Video Date recovery document.
- Recorded user brief that Video Date has been failing for over a month despite repeated remediation.
- Consolidated same-day fixes:
  - date-room RPC fail-soft wrappers and stuck metadata backfill,
  - transition raise-semantics correction,
  - mark-ready hot-path recovery,
  - mark-ready expiry grace and retryable UX hardening,
  - terminal churn cancellation,
  - notification auth health/classification,
  - recipient/match payload identity cleanup.
- Recorded PR #1188, commit `c532dca0ac324d02f0749a25c06097160357fbfb`, Supabase deployment state, verification commands, and open acceptance gaps.
- Recorded latest failed two-user session `1592aa53-f011-45ab-bcb4-e2685fe172b9`, where Ready Gate and Daily room creation succeeded but active Daily co-presence did not hold.
- Recorded PR #1190, merge commit `b72e487d65972566e63f508d023cf2e1e886734a`, Supabase migration `20260604142017_video_date_active_presence_join_guard.sql`, post-deploy dry-run, direct remote verification, branch cleanup, and remaining manual E2E/native gaps.
- Recorded latest failed two-user session `aac15b03-8de7-45e2-a11b-629cdd9b5b16`, where Ready Gate and Daily room handoff succeeded briefly but a Daily `participant-left` event triggered backend reconnect/terminalization before local transport grace could absorb the flap.
- Implemented the warm-up stabilization patch: local Daily transport grace before backend partner-away marking, explicit `daily_transport_grace_expired` reason, terminal survey hard-stop on web, ReadyRedirect force-survey state, native/mobile parity, peer-missing survey recovery guard, and migration `20260604170438_video_date_warmup_reconnect_stability.sql`. Later audit `782f5eb6-497f-4fd8-9898-2f47cf939751` narrowed the guard so historical remote-seen proof no longer suppresses current peer-missing.
- Recorded PR #1192, squash merge commit `b2a4a10ce22c2f4950b94fa6b9e49aa235c6c7fa`, Supabase migration cloud application, post-push dry-run, direct catalog verification, and branch cleanup state for the warm-up stabilization patch.
- Recorded latest failed two-user session `83e88141-ebab-4254-869a-c69db7bdb107`, where Ready Gate and Daily room handoff succeeded but repeated Daily rebuild/join/leave churn, stale joined presence, uncleared reconnect grace, and soft lifecycle away authority caused `reconnect_grace_expired` despite users staying in flow.
- Implemented the ultimate stabilization branch: same-session Daily call reuse, internal `daily_call_busy` retry, append-only Daily cleanup/reuse diagnostics, visibilitychange suppression while Daily is active, terminal survey hard-stop Daily teardown, native background grace-before-away, canonical remote-seen repair diagnostics, and migration `20260604193140_video_date_latest_presence_grace_repair.sql`.
- Applied `20260604193140_video_date_latest_presence_grace_repair.sql` to Supabase project `schdyxcunwcvddlcshwd`; post-push dry-run and direct catalog verification confirmed remote alignment, and linked advisors returned no error-level issues.
- Recorded PR #1194, squash merge commit `0a160cd975d87cd756e9c399e748810508f005cb`, remote/local branch deletion, Supabase post-merge dry-run, direct migration verification, green PR checks, green post-merge main checks, and production Vercel deployment `HXyMQQUBijhNcDLEfU4FreKuzPye`.
- Addressed PR #1194 review feedback by adding `20260604205645_video_date_remote_seen_latest_state.sql`, which makes canonical remote-seen timestamps latest-state evidence; applied it to Supabase cloud, verified both migration rows and function payload fields, and reran linked advisors with no error-level issues.

---

### 2026-06-07 Documentation and Guidance Sync After PR #1216

Verified release state from the previous session:

- PR #1216 merged via squash at `3ae7f196749f2229d66da6f0ef73ae2f76f30768` on 2026-06-06 after all refreshed checks passed.
- Source branch `codex/video-date-provider-authoritative-presence` was deleted remotely and pruned locally.
- Nested repo `main` and `origin/main` were aligned at `3ae7f196749f2229d66da6f0ef73ae2f76f30768`.
- Parent repo `/Users/kaanporsuk/Documents/Vibely` has no remote and tracks `Git/vibelymeet` as a nested gitlink; verify the current pointer with `git ls-tree HEAD Git/vibelymeet` instead of relying on a historical local pointer hash.
- Supabase project `schdyxcunwcvddlcshwd` is applied/aligned through `20260606205211_video_date_provider_participant_id_presence_repair.sql`. Fresh 2026-06-07 verification again showed local/remote migration list aligned through `20260606205211`, and `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` returned `Remote database is up to date`.

Session lessons that should survive into future handoffs:

- The failed session `c9dc7af1-1f40-431f-93ed-4435019126aa` moved the remaining failure from Ready Gate and room creation into provider-backed current presence. Client heartbeats are telemetry unless they carry a current provider session id that is not contradicted by Daily webhook leave evidence.
- Daily provider session identity must be read from `video_date_daily_webhook_events.provider_participant_id` first, matching `video-date-daily-webhook` ingestion. Payload-only `payload.session_id` extraction is insufficient and can falsely mark an active provider join as missing.
- Once a migration has been applied to Supabase cloud, review fixes must land as corrective follow-up migrations. Do not rewrite an already-applied migration to satisfy review feedback.
- PR review conversations can be real release blockers. PR #1216 initially could not merge until the provider-id source review was addressed and the thread was resolved.
- Git/Supabase/CI/Vercel alignment is implementation proof only. It still does not prove Video Date healthy without the fresh disposable two-user production run through survey completion plus leave/rejoin and prolonged absence checks.

---

### 2026-06-07 Review Comments Follow-Up for PR #1217-#1231

Reviewed the last 16 PRs (`#1216` through `#1231`) for Copilot and Codex review comments. No Copilot-authored actionable comments were found. Codex review comments were either already resolved by later source/migration work or addressed in this follow-up branch.

Implemented follow-ups:

- `20260607185652_review_comments_1217_1231_followups.sql` rewrites public `video_session_mark_ready_v2(...)` so authenticated participant/service precheck happens before the preserved event-cleanup base, clears reconnect grace and away markers when Daily provider truth shows a participant rejoined, excludes queued sessions from registration/session drift validation and repair, and gates terminal lifecycle context so nonparticipants receive only minimal nonterminal access-denied context.
- `20260607190533_review_comments_1217_1231_lint_repair.sql` repairs the provider-absence reconciler after linked `db lint --fail-on error` found a nonexistent `video_date_surface_claims.release_reason` reference in the already-applied first follow-up migration. The replacement releases surface claims with existing `released_at` / `updated_at` columns only.
- Native `ReadyGateOverlay` now fetches routeable/terminal session truth only after retryable `prepare_date_entry` failures, so non-retryable Daily/provider failures do not route-recover past the authoritative failure state.
- `shared/matching/reviewComments1217_1231Followups.test.ts` is wired into `npm run test:video-date-v4` and asserts the review-comment contracts plus the lint repair.

Verification on 2026-06-07: focused review-comments test passed, adjacent Video Date contract tests passed, `git diff --check` passed, Supabase cloud applied both migrations, post-apply dry-run returned `Remote database is up to date`, linked `db lint --schema public --fail-on error` exited cleanly with only pre-existing warnings/notices, and live catalog markers returned true for both migration rows, mark-ready participant precheck, provider rejoin grace clearing without `release_reason`, queued drift exclusion, and terminal context access gating. This is implementation and cloud evidence only; it is not Video Date acceptance proof.

---

### 2026-06-10 Ready Gate Lock-Convoy Incident (session 927942c2) + Convoy Hardening

Observed symptom: two-user production test on event `3f303f62-6c12-4f3e-a6c7-6cc338413db0` (online lobby 19:44-20:29 UTC) stuck at Ready Gate after both users tapped ready. UI showed "Both ready. Connecting you now..." with "Status sync is delayed"; console showed HTTP 500s from `video_session_mark_ready_v2`, `ready_gate_transition`, `get_video_date_start_snapshot_v1`, and `get_profile_for_viewer`. Session `927942c2-0704-4e42-a95c-c3fc56accc02` started 19:44:49, ready gate expired 19:45:52, ended 19:45:55 with `ended_reason = ready_gate_expired`. `daily_room_name`/`daily_room_url` were not the issue this time; readiness simply never landed server-side.

Root cause chain (postgres_logs + lock-wait logs + pg_stat_statements evidence):

1. All 500s were SQLSTATE `57014` statement timeouts (nine between 19:45:04 and 19:45:42) against the `authenticated` role's 8s `statement_timeout`. PL/pgSQL `EXCEPTION WHEN OTHERS` cannot catch `query_canceled`, so the established fail-soft wrappers correctly did not (and cannot) absorb these — raw 500s are inherent to 57014.
2. Lock-wait logs show a lock convoy on the single `video_sessions` row (relation 17626, tuple (0,3)): `video_session_mark_ready_v2` waited 1.85s behind an earlier transaction, then itself held the row > 3.3s while `video_date_outbox_enqueue_v2` and `record_video_date_ready_gate_entered_v1` (entry-proof telemetry, eager `SELECT ... FOR UPDATE`) queued behind it. Client retries deepened the queue past 8s.
3. The underlying capacity truth: the project runs on default Micro burstable compute (no compute add-on; `shared_buffers` 224MB, 60 direct connections, 2 shared ARM cores for Postgres + PostgREST + Realtime + Auth). Over the 15-day `pg_stat_statements` window the box is chronically CPU-starved: `video_session_mark_ready_v2` mean 3.1s / max 27.8s over 109 calls, `get_profile_for_viewer` mean 436ms over 7,237 calls, `mark_video_date_remote_seen` mean 1.6s; Supabase-internal telemetry and Realtime WAL queries took 11s during the incident window. Cache hit ratio is 99.97%, so this is CPU, not disk. Realtime WAL/`postgres_changes` processing is the top cumulative consumer (~5,800s over ~446k calls in 15 days).
4. Rejected hypotheses: PR #1286 object drops (no live RPC references a dropped view; the chronic timing pattern predates tonight), `daily_room_name` null regression (room columns never populated because the gate never reached both-ready server-side), and the hourly `23505` on `idx_video_date_recovery_alert_dispatches_hour` (expected dedupe-by-unique-violation, explicitly handled by `video-date-recovery-alert-dispatcher`; log noise only).

Product decision 2026-06-10: compute upgrade offered (Small/Medium/Large) and deliberately deferred by the operator. Convoy resilience must therefore come from the database layer until that decision changes.

Implemented hardening (branch `fix/video-date-ready-gate-convoy-hardening`, migration `20260610201512_video_date_ready_gate_convoy_hardening.sql`, applied to cloud):

- `record_video_date_ready_gate_entered_v1` now takes `FOR UPDATE NOWAIT` on the session row and converts `lock_not_available` (55P03) into structured retryable JSON `{ok:false, code:'READY_GATE_BUSY', retryable:true}` instead of queueing behind critical ready-path transactions. All web/native callers are fire-and-forget with analytics-only failure handling (`ready_gate_entry_proof_failed`), so the busy-skip is strictly better than the prior 8s queue wait followed by a raw 500.
- `authenticated` `statement_timeout` raised 8s -> 15s (with `NOTIFY pgrst, 'reload config'`). The Ready Gate window is 45-60s; a mark_ready that survives a 10s transient convoy beats one cancelled at 8s whose retry re-queues at the back of the lock queue. Revert: `ALTER ROLE authenticated SET statement_timeout = '8s'; NOTIFY pgrst, 'reload config';`.
- `shared/matching/readyGateEntryProofContracts.test.ts` gained a convoy-incident contract test asserting NOWAIT + READY_GATE_BUSY + preserved authority/actionability guards + the 15s ceiling.

Verification on 2026-06-10: dry-run then push applied the migration; live catalog markers confirmed `FOR UPDATE NOWAIT`, `READY_GATE_BUSY`, `lock_not_available` handler, and `authenticated` rolconfig `statement_timeout=15s`; a no-auth probe returned `AUTH_REQUIRED` (function executes). Entry-proof contract file passes 7/7. `npm run test:video-date:red-flags` passes except one pre-existing failure on main: `videoDateSprint5PostDateSurveyContracts.test.ts` "safety reports force a pass before any match or notification path" still asserts the removed `submit_post_date_verdict_v2` path in `post-date-verdict` (stale assertion missed by the PR #1286 v3-only close-out; follow-up needed, not caused by this branch).

Open risk, stated honestly: this hardening removes one convoy participant and raises the survival ceiling, but the chronic CPU starvation of Micro compute remains the dominant failure driver for Ready Gate under any concurrency. Until compute is upgraded, multi-second RPC latencies and occasional 57014s remain possible at both-ready bursts. A fresh two-user end-to-end run is required before claiming recovery; this entry is implementation and cloud evidence only, not acceptance proof.

---

### 2026-06-11 First Confirmed Golden-Flow Success + Lean Pass

**The 2026-06-10 ~23:40 UTC two-user run on event `a91c362f-6815-4cd3-8721-135ff9fb2b4c` (session `d0b93d6d-05ac-4ec1-b56b-313a9f8d1a92`) reached a live date**: match -> Ready Gate (all checks green) -> both ready -> /date route -> Daily join -> bilateral video with warm-up timer and rotating vibe questions ("You're both here. Starting gently."). This is the first observed end-to-end date start since the recovery program opened. It ran on the convoy-hardened backend (migration `20260610201512`) with zero RPC 500s in the trace. Survey completion was not captured in the evidence, so this is still not full acceptance proof, but the launch path is now demonstrably sound.

The successful trace exposed three redundant client traffic patterns that made the launch slow and noisy on the current Micro compute (critical RPCs still took seconds: `claim_video_date_surface` 4.46s, `mark_video_date_remote_seen` 6.14s):

1. ~30 single `record_video_date_launch_latency_checkpoint` RPCs per launch (telemetry; #2 cumulative DB consumer).
2. A 12-call `evaluate_client_feature_flag_detail` burst on /date mount (shared 60s TTL expiring together; the batch RPC existed but the single-flag path never used it).
3. ~15 duplicate `get_profile_for_viewer` calls for the same partner across ReadyGateOverlay, useReadyGate, and VideoDate (#1 cumulative DB consumer).

Lean pass implemented (branch `perf/video-date-golden-flow-lean-pass`):

- Migration `20260610235546_video_date_launch_latency_batch_checkpoints.sql` (applied to cloud): additive `record_video_date_launch_latency_checkpoints_v1(uuid, jsonb)` that loops each item through the EXISTING fail-soft single shell (identical validation/failure semantics), capped at 40 items, granted to authenticated + service_role. Live-probed: null session -> `INVALID_BATCH`; one-item array -> count 1.
- `shared/observability/videoDateLaunchLatencyCheckpointObservability.ts`: checkpoints now buffer per session and flush in ONE batch RPC at 1.5s / 10 items; `*_failure` checkpoints and `first_remote_frame` flush immediately; failed batch flush falls back to per-item single RPCs. Worst case on abrupt tab close: <=1.5s of non-critical checkpoints lost. ~30 RPCs/launch -> ~4-6.
- `shared/featureFlags/batchedFlagDetailFetcher.ts` + web/native wrappers: concurrent single-flag cache misses coalesce (25ms window) into one `evaluate_client_feature_flags` call; batch failure falls back to per-flag detail fetch. Core evaluation/caching/sequencing semantics untouched. 12 RPCs at /date mount -> 1.
- `src/lib/videoDatePartnerProfile.ts` + 3 web call sites: partner profile shared through one in-flight request + 5-min TTL memo; errors never cached. ~15 RPCs/launch -> 1-2. Native parity closed same day (branch `fix/native-video-date-partner-profile-memo`): `apps/mobile/lib/videoDatePartnerProfile.ts` mirrors the helper and all 7 native video-date call sites (useActiveSession x2, videoDateApi x2, readyGateSharedVibes, readyGateApi, PostDateSurvey) are wired; eventsApi/dailyDropApi/fetchUserProfile intentionally untouched (non-video-date surfaces).
- Contract test `shared/matching/videoDateGoldenFlowLeanPass.test.ts` (wired into `test:video-date-v4` and `test:video-date:red-flags`) pins all of the above; `videoDateEndToEndHardening.test.ts` profile assertion updated to track the memoized helper while preserving its after-access-allowed intent.

Verification on 2026-06-11: full `npm run typecheck` (web + native) clean; new contract test 4/4; touched-module contract tests 194 pass / 1 pre-existing failure; red-flags suite green except the known stale Sprint 5 `submit_post_date_verdict_v2` assertion (pre-existing on main, still open); types regenerated (+4 lines, exactly the new RPC); migration live-probed.

Still open after this pass: compute upgrade (deferred 2026-06-10) remains the dominant latency driver; duplicate `video_sessions` row reads with 4+ select shapes on /date mount (needs a single-owner session-truth read, larger refactor); overlapping `get_video_date_start_snapshot_v1` pollers;  Realtime `postgres_changes` WAL audit.

---

### 2026-06-11 Remaining-Fat Closure (session-row single owner, snapshot dedupe, WAL audit, stale test)

Branch `fix/video-date-golden-flow-remaining-fat`. Closes the open items from the lean pass:

- **Single-owner session-truth read (web):** `src/lib/videoDateSessionRow.ts` owns the canonical date-path projection (28-column superset typed from generated schema), with in-flight dedupe + 300ms reuse; errors never memoized; PostgREST error fields pass through. Wired: SessionRouteHydration, IceBreakerCard, useVideoCall truth fetch, VideoDate mount log (was `select *`), VideoDate access guard, VideoDate handshake refresh. The 4+ divergent mount-time select shapes are now one query. Native date-path reads live inside `videoDateApi` functions with per-call filters and stay as-is for now (different shapes, not mount-storm duplicates in evidence).
- **Start-snapshot dedupe (web + native):** `fetchVideoDateStartSnapshot` shares in-flight requests per session and reuses ok snapshots for 300ms (below all poll cadences); not-ok results never memoized.
- **Realtime WAL audit (evidence, no transport change):** `video_sessions` + `event_registrations` are in the `supabase_realtime` publication and video-date surfaces subscribe via postgres_changes on web and native, so every hot-row write (heartbeats, mark_alive ~3s) is WAL-processed per subscriber — the top cumulative DB consumer (~5,800s/15d). Deliberate decision: do NOT swap the live realtime transport the day after the first successful run. Follow-up plan: migrate video-date subscriptions to the existing DB-triggered Broadcast channels, then drop `video_sessions`/`event_registrations` from the publication; requires its own acceptance run.
- **Stale Sprint 5 assertion fixed:** the safety-report forced-pass contract now pins the v3-only reality (v2/keyless coerced to v3 with `deprecated_version_coerced_to_v3`) and asserts the retired v2/legacy RPC branches stay removed. Red-flags suite is fully green for the first time since PR #1286.

Verification 2026-06-11: web tsc clean, red-flags suite 0 failures, lean-pass contracts 7/7 (session-row owner + snapshot dedupe pinned), Sprint 5 9/9. No backend/schema changes in this branch.

---

### 2026-06-11 Simplification PR 1: Ready Gate Entry-Proof Telemetry Removed

Branch `codex/remove-ready-gate-entry-proof-telemetry`. First PR of the aggressive-simplification plan (remove obsolete owners/telemetry/compat paths without weakening the golden flow).

Audit findings (live catalog + repo, 2026-06-11): `video_sessions.ready_gate_participant_*_entered_at` had NO readers besides the entry-proof RPC itself; `video_date_ready_gate_entries` was read only by `video_date_partial_ready_diagnostics_v1` (operator diagnostics, zero DB/client/Edge callers); no route decision, expiry, or acceptance behavior consumed entry-proof state. The RPC's 45s TTL extension was deliberately NOT relocated — Ready Gate timing is owned by session creation and mark_ready.

Removed: web helper `src/lib/readyGateEntryProof.ts`, native helper `apps/mobile/lib/readyGateEntryProof.ts`, the mount-telemetry effects + `isReadyGateEntryProofStatus` predicates + proof-key refs from web ReadyGateOverlay, native ReadyGateOverlay, and native `/ready/[id]`, and the obsolete `readyGateEntryProofContracts.test.ts` (its live `statement_timeout=15s` config pin moved to the new removal contract). Forward migration `20260611091620_remove_ready_gate_entry_proof.sql` (cloud-applied): redefines `video_date_partial_ready_diagnostics_v1` without the entries laterals, then drops the RPC, the ledger table, and both stamp columns in one pass. Parity/reliability tests updated to keep their warmup/prepare-entry-ownership intent without the proof assertions. New `readyGateEntryProofRemovalContracts.test.ts` (wired into `test:video-date-v4`) proves: no platform calls entry proof, helpers deleted, migration drops all four objects, no TTL relocation.

Verification 2026-06-11: live markers confirm RPC/table/columns gone and diagnostics redefined + executing (`ok:true` probe); types regenerated (117 pure deletions); full `npm run typecheck` 0 errors; lint clean; `test:video-date-v4` 0 failures; red-flags 0 failures; `test:event-lobby-regression` 0 failures; linked DB lint clean at error level; post-push dry-run up to date. Acceptance criteria met: Ready Gate mount performs no session-row mutation; `video_session_mark_ready_v2` + `prepare_date_entry` remain the only hot Ready Gate mutations. Static proof only — the standing bar remains a fresh two-user run through persisted `date_feedback`.

---

## Fresh Session Handoff Prompt

Use this prompt when starting a new Codex/agent session:

```text
You are continuing Vibely Video Date recovery in /Users/kaanporsuk/Documents/Vibely/Git/vibelymeet. Start by reading docs/video-date-success-command-center.md, docs/active-doc-map.md, AGENTS.md, CODEX.md, and CLAUDE.md. Treat docs/video-date-success-command-center.md as the active source of truth and update it after every material investigation, code change, migration, deploy, or manual QA result.

Current recovery work builds on PR #1212 merge commit `0a85449a0384f257d314a77c5a7fe455a71e2003` for shared entry/Daily owner plus stable-copresence guard, PR #1213 commit `a3c34dd2b2400908c3cf529d8c3146a141b7ebb8` for rollout documentation, PR #1216 merge commit `3ae7f196749f2229d66da6f0ef73ae2f76f30768` for provider-authoritative presence after failed session `c9dc7af1-1f40-431f-93ed-4435019126aa`, PR #1218 merge commit `a7b8cb7dc05a47262a4c7c7dcd31e5972ed4d0c4` for provider-terminal recovery after failed session `98d50175-1c75-4966-a6e6-f444c4631289`, PR #1223 merge commit `0579ef7ce3845d07444918658f822f7d190ee88a` for Mutual Match handoff closure, PR #1225 merge commit `dc96df5c8c93d96d2b37e79c16212b782156bbae` for provider-backed joined/absence-terminal recovery after failed session `fd02e8ed-a272-46b1-a961-b130e83ce2a4`, the routeable `both_ready` entry protection work after failed session `916f8ed7-15a9-45ec-8ec2-79879fa60a7f`, and PR #1230 merge commit `8721810f94215840b15332c6a75b92022d2df992` for lifecycle RPC terminal recovery plus Ready Gate entry proof (`20260607155414`, `20260607183000`, `20260607183100`). The latest source sync is PR #1230 merge commit `8721810f94215840b15332c6a75b92022d2df992`. The parent workspace has no remote and tracks `Git/vibelymeet` as a nested gitlink; verify the local parent pointer with `git ls-tree HEAD Git/vibelymeet` instead of relying on a stale handoff commit. Supabase project `schdyxcunwcvddlcshwd` is currently applied/aligned through `20260607183100_video_date_lifecycle_truthy_helper_alignment.sql`, after `20260607183000_video_date_ready_gate_entry_proof.sql`; `daily-room` was redeployed as active version 860 at `2026-06-07 13:15:36 UTC`. The current stack makes stable copresence and Daily alive/joined stamping provider-authoritative on top of service-only `video_date_presence_events`, `mark_video_date_daily_alive(...)`, `mark_video_date_daily_joined(...)`, and `video_date_stable_copresence_v1(session_id)`, corrects provider session extraction to prefer Daily webhook `provider_participant_id` before sanitized payload fallbacks, bounds no-provider Daily calls to telemetry/no-op behavior, preserves first provider-backed join evidence, stops client heartbeats on terminal truth, protects `both_ready` entry with a five-minute prepare-entry lease even when deterministic Daily room metadata already exists, confirms routeable handshake state before Daily provider verification/token minting, lets web/native Ready Gate overlays navigate when canonical truth is already routeable after a retryable prepare failure, recovers terminal survey from authenticated `event_registrations.queue_status='in_survey'` when the session-row fetch fails, and reconciles provider absence from Daily webhooks plus reconnect-grace expiry. Reverify current Git main/origin-main, `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`, `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`, `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase functions list --project-ref schdyxcunwcvddlcshwd`, and live catalog markers before relying on this baseline.

Latest review-comments follow-up for PR #1217 through #1231 adds migrations `20260607185652_review_comments_1217_1231_followups.sql` and `20260607190533_review_comments_1217_1231_lint_repair.sql`. The follow-up prechecks `video_session_mark_ready_v2(...)` participant/service authority before event cleanup, clears provider-absence reconnect grace on Daily rejoin, excludes queued sessions from drift validation/repair, limits terminal lifecycle context for nonparticipants, gates native routeable truth recovery to retryable prepare failures only, and repairs the first migration's invalid `video_date_surface_claims.release_reason` reference with an existing-column surface-claim release. Supabase cloud is aligned through `20260607190533`; post-apply dry-run returned `Remote database is up to date`, linked error-level DB lint passed with only pre-existing warnings/notices, and live catalog markers confirmed the deployed function bodies. This is still not acceptance proof.

Latest source/documentation sync after the CTO audit started with PR #1219 merge commit `849fc3ed5bbec87cf8575fd217a58e8ed3db9834` and later docs-only handoff PRs. PR #1226 corrected the handoff to the PR #1225 / `20260607103100` provider-backed joined/absence-terminal baseline. Follow-up handoff syncs removed brittle static parent-pointer hashes and replaced them with `git ls-tree HEAD Git/vibelymeet`. Parent repo `/Users/kaanporsuk/Documents/Vibely` remains local-only and tracks the nested repo through a gitlink; verify the current parent pointer with `git ls-tree HEAD Git/vibelymeet` and exact nested source with `git rev-parse HEAD` plus `git ls-remote origin refs/heads/main`.

The feature is still not proven healthy. Do not claim success from static tests, PR checks, Supabase alignment, both_ready, route entry, Daily room creation, brief warm-up UI, visible short media, or a terminal survey row. The required proof remains a fresh disposable two-user production run: match -> Ready Gate -> same Daily room -> stable bilateral remote media/warm-up -> date end -> post-date survey opens and completes, plus a simulated short Daily leave/rejoin under 12s and a real prolonged absence terminalization check.

Current theory: Ready Gate, Daily room creation, canonical remote_seen, and immediate confirmed-encounter date promotion can succeed, but the post-`both_ready` routeability boundary must not depend on slow Daily provider verification/token work. The latest failed session `916f8ed7-15a9-45ec-8ec2-79879fa60a7f` showed a deterministic Daily room and `both_ready` could exist while the user remained stuck in Ready Gate until stale cleanup ended the session as `ready_gate_expired`; the latest fix protects the routeable handoff before provider work and lets clients recover from routeable truth. Latest `fd02e8ed-a272-46b1-a961-b130e83ce2a4` lesson: the long `both_ready` to stable handshake gap was abnormal, but not because first Daily entry waited a minute. Both users initially joined Daily within 3-5 seconds, both provider sessions left around +26 seconds, and stable handshake correctly waited until current provider-backed rejoins at +36/+55 seconds. Future audits must distinguish first Daily join latency from current stable provider-backed copresence latency and treat early provider join-left-rejoin as route/Daily lifecycle churn. The latest deployed code/cloud fix makes stable copresence provider-authoritative and routeability explicit: stale or provider-null client heartbeats are telemetry only and cannot revive a Daily participant after a matching provider leave; provider identity comes from Daily webhook `provider_participant_id` before payload fallbacks; web/native/mobile only send `owner_state='joined'` when Daily reports `joined-meeting` and exposes a local provider session id; `mark_video_date_daily_joined(...)` is a provider-backed facade, not an independent stale join-stamp authority; protected `both_ready` rows keep `prepare_entry_expires_at` and canonical Daily room metadata while the handoff is in progress; and `in_survey` with cleared `current_room_id` is now treated as active terminal-survey recovery, not lobby/deck ambiguity. The broader implemented fixes enforce same-session Daily start ownership/reuse, ref-backed live same-session Daily remount preservation without leave/destroy, short-lived date-route ownership from explicit handoff or active Daily/date evidence to suppress stale Ready Gate/lobby bounces, active `video` / `in_survey` route ownership across web/native/mobile, shared date-entry ownership keyed by `{session_id,user_id}`, route/session-level Daily ownership keyed by `{session_id,user_id,room_name}`, `mark_video_date_daily_alive` owner heartbeats, stable-copresence gating before handshake start, local Daily transport grace before backend partner-away, soft browser lifecycle handling during active Daily including `web_beforeunload`/`web_pagehide`, latest-state joined/away presence, canonical remote_seen latest-state repair from provider presence/media evidence, immediate confirmed-encounter promotion to date from `mark_video_date_remote_seen` / `video_session_handshake_auto_promote_v2`, confirmed-encounter deadline fallback rescue, positive launch-evidence deadline extension, 30-second video-date surface claims, surface-claim backoff, reconnect grace clearing on return/remote-seen/lifecycle active evidence, reconnect expiry recheck with current unexpired surface-claim proof only plus provider-absence reconciliation, terminal-survey and historical-encounter peer-missing suppression with server-owned provider absence terminalization, sticky `in_survey` until feedback, repair of already downgraded pending-survey registrations, terminal Daily room repair/preservation, provider-delete markers that do not null Daily room metadata, explicit post-encounter manual absence reason `partner_absent_after_confirmed_encounter`, terminal-survey hard-stop on /date/:sessionId, outer fail-soft wrappers for exposed lifecycle RPCs, direct active-date handoff without lobby Daily prepare/restart, same-route forced survey recovery, append-only surface-claim audit events, append-only presence events, and preserved client continuity/parking/owner observability fields.

Latest active-date stability patch after the 2026-06-08 repeated opening/warm-up/date churn screenshots keeps web/native/mobile clients from ending a post-encounter date locally just because the first-remote watchdog cannot currently see the peer after historical bilateral encounter truth. The watchdog now logs `daily_no_remote_watchdog_historical_truth_suppressed`, emits `peer_missing_suppressed_remote_seen`, clears local terminal peer-missing state, and waits for provider/server absence reconciliation. Web same-session Daily parked cleanup preserves the active Daily identity and alive heartbeat for live joining/joined calls (`daily_call_live_remount_identity_preserved`, `daily_call_live_remount_heartbeat_preserved`). Post-encounter peer-missing terminal effects now log `post_encounter_peer_missing_terminal_end_suppressed` / `provider_absence_server_owned_after_encounter` instead of auto-calling local end; explicit user exits can still use `partner_absent_after_confirmed_encounter`.

Applied implementation after the `d7507b5c-7837-4310-a52c-ebd10c1ae535` audit adds the missing single-owner route boundary: hydrated active `video` sessions, including terminal `in_survey`, own `/date/:sessionId` across web and native/mobile; lobbies no longer run Daily prepare for `in_survey`; stale Ready Gate opens are suppressed when date/survey ownership is already true; native survey recovery can force past duplicate-navigation/manual-exit suppression; and migration `20260605170249_video_date_surface_owner_outer_failsoft.sql` wraps `claim_video_date_surface`, `mark_video_date_daily_joined`, `mark_video_date_remote_seen`, and `get_or_seed_video_session_vibe_questions` with retryable JSON fail-soft shells. Corrective migration `20260605174703_video_date_vibe_question_outer_base_name_repair.sql` normalizes the preserved vibe-question base helper to `vd_vibe_q_outer_20260605170249_base` after the first cloud apply exposed a PostgreSQL identifier-truncation notice. Live verification showed both migrations applied, remote dry-run up to date, all four wrappers calling preserved bases, the short vibe-question helper present, and the truncated helper name removed.

Latest failed production audit after PR #1200: session 782f5eb6-497f-4fd8-9898-2f47cf939751 for event 6c9c647f-242b-463c-8b24-0896f02677e5 proved the remaining failure is no longer Ready Gate, room creation, remote_seen, or early date promotion. The session reached `date_started_at=2026-06-05T13:25:51.75678Z`, both users later left Daily, only participant 2 rejoined, `date_timeout` ended survey-eligible, no `date_feedback` rows existed, participant 1 stayed `in_survey`, and participant 2 was overwritten to `offline`. Before the terminal-survey lifecycle fix the final Daily room metadata was null; migration `20260605144003` repaired it, old cleanup workers re-nullified metadata, then migrations `20260605145306`, `20260605145926`, and `20260605150130` plus redeployed cleanup/outbox functions made the repair durable. Migration `20260605152058` repaired the already-overwritten participant 2 registration back to `in_survey` while no feedback exists. Live verification now shows `date-782f5eb6497f4fd898982f47cf939751` / `https://vibelyapp.daily.co/date-782f5eb6497f4fd898982f47cf939751` preserved with provider-delete markers, zero remaining ended survey-eligible room-metadata candidates, and both failed-session registrations in `in_survey`. The patched boundaries are historical encounter proof vs current peer presence, survey status persistence, pending-survey registration repair, terminal room metadata repair/preservation, cleanup marker semantics, and post-encounter absence handling.

Latest failed production audit after terminal-survey lifecycle hardening: session d7507b5c-7837-4310-a52c-ebd10c1ae535 for event 46c03a11-925f-4678-aab5-874d28500458 shows the previous backend fixes held but the user flow is still not acceptable. Ready Gate committed `ready_b` at `2026-06-05T15:47:17.449329Z` and `both_ready` at `2026-06-05T15:47:18.496863Z`; Daily room `date-d7507b5c78374310a52cebd10c1ae535` was created/preserved; Daily webhooks show both users joined, participant 2 left at `15:48:34.677Z`, participant 1 left at `15:48:50.351Z`, and only participant 1 rejoined before timeout; `mark_video_date_remote_seen` promoted the confirmed encounter to `date`; `date_timeout` ended at `2026-06-05T15:52:53.855203Z` with `survey_required=true`, `survey_eligible=true`, both registrations remained `in_survey`, final room metadata plus provider-delete markers were preserved, and no `date_feedback` rows existed. This proves the old room-metadata and sticky-survey persistence bugs are addressed for this run. The remaining failures are client-side route/surface/Daily churn and survey completion: screenshots showed `/ready`, `/date`, and `/event/.../lobby` churn; observability recorded 27 `date_route_entered`, 21 `daily_join_started`, 54 `daily_call_cleanup`, repeated `external_call_busy`, `peer_missing_suppressed_remote_seen`, and ReadyRedirect later forced `go_survey`, but no feedback was submitted. Console also showed raw 500s for `mark_video_date_remote_seen`, `claim_video_date_surface`, `mark_video_date_daily_joined`, and `get_or_seed_video_session_vibe_questions`; exposed lifecycle RPCs must be outermost fail-soft and non-blocking under stale/duplicate/terminal calls. The next implementation plan should prioritize a single cross-surface date/survey owner, eliminate active same-session Daily unmount churn, make terminal survey recovery visible and submit-resilient from any surface, and harden all exposed lifecycle RPC wrappers.

Latest failed production audit after surface-owner/fail-soft hardening: session f3d1bd2a-5c37-43bb-9a9a-ec3c78fe7442 for event 9ac64807-7fe3-41b1-86db-49a3d4053b56 shows Ready Gate, Daily room creation, `date_started_at`, bilateral joins, and remote-media evidence all worked. The date still ended incorrectly because `mark_reconnect_self_away` with `reason=web_beforeunload` opened reconnect grace while users were visibly in the date; `expire_video_date_reconnect_graces` later treated that lifecycle false-away as terminal. Implementation applied: web lifecycle `beforeunload`/`pagehide`/`visibilitychange`/`freeze` are soft telemetry while Daily is active or starting, active soft lifecycle handling does not stop local tracks, web/native `video_date` surface claims use a 30-second server TTL, migration `20260605200729_video_date_beforeunload_active_presence_repair.sql` suppresses/clears lifecycle reconnect grace when latest joined, remote-media, or active surface evidence proves the session is still live, follow-up migration `20260605203904_video_date_remote_seen_grace_payload_preserve.sql` preserves base `reconnect_grace_cleared=true` in the outer remote-seen response, and corrective migration `20260605211924_video_date_surface_claim_expiry_current_guard.sql` requires surface-claim evidence to still be current at reconnect-expiry time.

Latest failed production audit after PR #1204 and review-comment follow-ups: session `4082fe36-8480-4d30-9a1d-1de227b855e3` for event `cdb38cb8-acfb-4fa1-b732-10903eccc3b0` shows the backend can still reach Ready Gate `both_ready`, canonical Daily room verification, bilateral Daily joins, remote-media evidence, and immediate `date_started_at=2026-06-05T22:14:53.753531Z`. The product still failed because the active client owner was unstable: the UI churned across `/date`, `/ready`, and lobby, observability recorded 18 date route entries, 6 Daily starts, 26 Daily cleanup rows, and 7 `external_call_busy` retries, and Daily webhooks ended with both participants leaving by `22:16:53.812Z`. Surface claims expired at `22:17:06Z` / `22:17:07Z`; reconnect expiry at `22:18:00.839509Z` ended as `reconnect_grace_expired`, `survey_required=true`, and both registrations `in_survey`, but no `date_feedback` rows were created. The next change should focus on single date/survey ownership, route-level Daily lifetime, terminal survey hard-stop recovery, outermost fail-soft `video_date_transition` / queue RPCs, and durable telemetry for Daily parking, surface claims, and away/grace triggers.

Applied implementation after the `4082fe36-8480-4d30-9a1d-1de227b855e3` audit: web and native/mobile now mark `/date/:sessionId` owned on active session/date-route hydration; lobby active `in_handshake` / `in_date` handoffs skip Daily prepare and route directly to the date owner; terminal `in_survey` remains a forced date/survey owner; and native terminal survey recovery clears local joining/reconnect state before rendering survey. Migration `20260605232304_video_date_single_owner_runtime_hardening.sql` is applied to Supabase and adds service-only `video_date_surface_claim_events`, fail-soft wrappers for `video_date_transition`, `get_video_date_queue_hint_v1`, `drain_match_queue_v2`, and `claim_video_date_surface`, plus widened `record_video_date_client_stuck_observability` detail preservation for route ownership, same-session continuity, singleton parking, and truth-refresh fields. Verification passed focused contracts, web/core/mobile typechecks, app typecheck, Supabase post-apply dry-run/list/marker queries, linked public-schema lint, and `git diff --check`. This is still not acceptance proof.

Second-pass CTO audit follow-up on 2026-06-06 found one native/mobile parity gap: pending-survey navigation was represented only as generic `force`, while web uses explicit `forceSurvey` intent. Native event-lobby navigation now accepts `forceSurvey`, treats it as the force bypass plus survey-only prepare suppression, and all native pending-survey call sites pass it (`active_session_hydration`, registration realtime/refetch, video-session update/insert, and Ready Gate canonical survey recovery). The shared contract now asserts the native `forceSurvey` option, `forceNavigation = force || forceSurvey`, `skipPrepare = skipPrepare || forceSurvey`, and every native survey-intent call site. Verification in this audit passed `npx tsx --test shared/matching/videoDateLatestFailureSurfaceOwnerContracts.test.ts shared/matching/videoDateSurfaceContinuityHardening.test.ts shared/observability/videoDateClientStuckObservability.test.ts`, full `npm run test:video-date-v4` with only the two expected env-gated RLS skips, `npm run typecheck`, `npm run lint`, `git diff --check`, linked Supabase migration list/dry-run aligned through `20260605232304`, linked public-schema lint with no error-level findings, and linked error-level advisors with `No issues found`. No web or native build was run, and no ignored env/cache/build artifacts were removed.

Third-pass CTO audit follow-up on 2026-06-06 found one additional native/mobile deep-link gap: `adviseVideoSessionTruthRecovery()` could return `go_survey` from the legacy/fallback notification truth path, but `NotificationDeepLinkHandler` only handled `go_date`, `go_ready_gate`, and `go_lobby` after that fallback and could send a pending-survey terminal encounter back to lobby/tabs. Native notification date links now mark `/date/:sessionId` route ownership for both snapshot and fallback truth recovery, and fallback `go_survey` returns `/date/:sessionId` with `pending_survey_terminal_encounter` diagnostics so the Date stack owns terminal survey recovery. The shared Phase 5 contract now asserts snapshot `go_date`/`go_survey` route ownership plus fallback `go_date` and `go_survey` ownership/routing. Verification passed `npx tsx shared/matching/videoDatePhase5TimelineContracts.test.ts`, `npx tsx --test shared/matching/videoDateLatestFailureSurfaceOwnerContracts.test.ts shared/matching/videoDatePhase5TimelineContracts.test.ts shared/matching/videoDateSurfaceContinuityHardening.test.ts shared/observability/videoDateClientStuckObservability.test.ts`, full `npm run test:video-date-v4` with only the two expected env-gated RLS skips, `npm run typecheck`, `npm run lint`, `git diff --check`, linked Supabase migration list/dry-run aligned through `20260605232304`, linked public-schema lint with no error-level findings, and linked error-level advisors with `No issues found`. No web or native build was run during that implementation verification pass. A later documentation-only cleanup accidentally invoked the web build via a shell search quoting mistake; it emitted Vite dynamic-import/chunk-size warnings, no native build was run, `git status --short` showed no generated build artifacts, and this accidental build is not acceptance proof. This is still not acceptance proof.

Fourth-pass implementation on 2026-06-06 after failed session `c9dc7af1-1f40-431f-93ed-4435019126aa` for event `43d1614c-9b2d-45d6-be59-c56fa6cb852f`: the latest run proved Ready Gate, same Daily room, visible local/remote media, and date UI could appear, but participant 2's Daily provider session left at `2026-06-06T19:22:52Z` and never had a later provider join. Client heartbeats with missing or stale provider proof then kept the backend believing both sides were active/stable, so the UI showed waiting/current-date surfaces while the provider ledger said one user was gone; the date later timed out survey-required with no feedback rows. Implementation adds applied migration `20260606203000_video_date_provider_authoritative_presence.sql`, which makes `video_date_stable_copresence_v1` provider-authoritative: stable copresence, `remote_seen`, and `already_date` shortcut all require current Daily provider presence or a recent provider-session-backed client alive that is not contradicted by a matching Daily `participant.left`. `mark_video_date_daily_alive(...)` now records every heartbeat but only clears away/join-stamps when `owner_state='joined'`, `provider_session_id` is present, and the current provider ledger supports that provider session. A fresh provider session after an older left is accepted for rejoin/webhook-lag recovery; the same or unknown left provider session is not.

Fourth-pass client changes: web `useVideoCall` and native/mobile `/date/[id]` no longer report Daily owner state `joined` merely because the route is alive. They read the Daily meeting state and local provider session id; only `joined-meeting` plus a non-empty provider session id sends `owner_state='joined'`, otherwise the heartbeat is `joining` or `lost`. Web and native/mobile event lobbies now treat `queue_status='in_survey'` with a cleared `current_room_id` as an active terminal-survey recovery signal: they clear stale Ready Gate state, set post-survey/recovery UI state, refetch active session immediately, and do not fall through to deck/lobby ambiguity.

Fourth-pass verification: initial linked dry-run showed only `20260606203000_video_date_provider_authoritative_presence.sql` pending, then `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --yes` applied it to project `schdyxcunwcvddlcshwd`. Fresh post-apply `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked` showed local/remote aligned through `20260606203000`, and `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run` returned `Remote database is up to date`. Local validation passed `npx tsx shared/matching/videoDateStableCopresenceOwnerContracts.test.ts`, full `npm run typecheck`, full `npm run test:video-date-v4` with only the two expected env-gated runtime RLS skips, and `git diff --check`. No web build, native build, or fresh two-user acceptance run was performed in this implementation pass. This is still not acceptance proof.

PR #1216 review follow-up: corrective migration `20260606205211_video_date_provider_participant_id_presence_repair.sql` replaces `video_date_actor_provider_presence_v1(...)` and `mark_video_date_daily_alive(...)` so provider-authoritative checks prefer `video_date_daily_webhook_events.provider_participant_id`, matching `video-date-daily-webhook` ingestion, before falling back to sanitized payload participant/session fields. The shared contract now asserts the helper, the `provider_participant_id` source, and the absence of payload-only `payload.session_id` extraction in the corrective migration. Lesson: because `20260606203000` had already been applied to Supabase cloud, the review fix correctly landed as a follow-up migration instead of rewriting applied history. This is still not acceptance proof.

Latest review-comments follow-up on 2026-06-07: a thread-aware scan of the latest 12 PRs (#1205 through #1216) found no actionable Copilot-authored review threads and several current Codex review threads. The implemented branch addresses them without rewriting applied migration history:

- Web Event Lobby now ignores deck-only `event_not_active` overrides for the broader page gate, so an inactive deck response does not permanently disable future deck fetches after the event becomes live again.
- Superseded historical note: Web Mystery Match polling was limited to visible empty-state UI in this pass; the entire Mystery Match product/backend path was removed on 2026-06-09 by `20260609152000_remove_mystery_match.sql`.
- Web Daily cleanup now always stops the old `mark_video_date_daily_alive` heartbeat when a same-session Daily singleton is parked, while still preserving the parked call/continuity state.
- Native/mobile `/date/[id]` prejoin now waits for the native surface client identity when multi-device v2 is enabled, avoiding a Daily join before the surface claim can be keyed to the hydrated client instance.
- Static canonical-active-state tests now target the current `20260505220000_event_lobby_browse_while_queued_repair.sql` promotion base instead of an older scheduled-activation helper.
- Branch delta `docs/branch-deltas/fix-video-date-entry-daily-owner-stable-copresence.md` now distinguishes source merge/cloud schema alignment from actual web/native client deployment or build proof.
- Supabase migration `20260606212727_review_comments_1205_1216_followups.sql` is applied to project `schdyxcunwcvddlcshwd`. It binds authenticated `video_date_promote_confirmed_encounter_v1(...)` callers to `auth.uid()` before privileged delegation, records `claim_video_date_surface(...)` audit outcomes from either `ok` or `success` and from `SURFACE_CLAIM_CONFLICT`, and restores event-wide inactive Ready Gate cleanup before delegating to the decisive `video_session_mark_ready_v2` base.
- Verification passed: focused review/gating contracts, full `npm run test:video-date-v4` with only the expected env-gated runtime RLS skips, full `npm run typecheck`, `npm run lint`, full `npm run test:event-lobby-regression`, `git diff --check`, linked Supabase migration list aligned through `20260606212727`, post-apply linked dry-run returning `Remote database is up to date`, linked public-schema DB lint with no error-level findings, and live catalog markers for auth binding, anon execute denial, surface-claim fallback derivation, mark-ready cleanup, and the preserved mark-ready base helper.

Provider-terminal recovery implementation on 2026-06-07 after failed session `98d50175-1c75-4966-a6e6-f444c4631289`: the latest run showed the date could briefly become visible, but the system still fell back into "Opening your date" / "Keeping the room open" churn while the Network tab kept issuing `mark_video_date_daily_alive`, `video_date_transition`, `video-date-snapshot`, `record_video_date_launch_latency_checkpoint`, feature-flag, profile, and registration reads. Some `mark_video_date_daily_alive` calls returned HTTP 500 after long waits, and the UI had already reached survey/date ownership ambiguity. The root failure class is now stale provider-terminal recovery: once Daily/provider truth says the active provider session is missing or terminal, clients must not keep hot-looping owner heartbeats that mutate presence or registration state; the backend must bound older clients; terminal `in_survey` must still open survey even if the first `video_sessions` fetch times out.

Current implementation adds Supabase migration `20260606224200_video_date_provider_terminal_recovery.sql`, web hook changes in `src/hooks/useVideoCall.ts`, native/mobile changes in `apps/mobile/app/date/[id].tsx`, and regression contract `shared/matching/videoDateProviderTerminalRecovery.test.ts`. The migration redefines `mark_video_date_daily_alive(...)` so no-provider heartbeats are throttled telemetry, not join-stamping authority; provider-backed heartbeats preserve the first accepted join stamp instead of advancing it on every tick; registration writes are diff/throttle-guarded; terminal sessions release stale `video_date` surface claims; and old clients get explicit `provider_presence_missing` / `provider_presence_terminal` / `join_stamp_accepted` fields. Web and native/mobile now skip the RPC entirely unless Daily is `joined-meeting` with a current local provider session id, stop the heartbeat on terminal server truth, and use `in_survey` registration fallback to open the post-date survey when the session-row fetch fails.

Verification for this implementation passed `npx tsx shared/matching/videoDateProviderTerminalRecovery.test.ts`, focused adjacent Video Date contracts, full `npm run test:video-date-v4` with only the expected env-gated RLS skips, full `npm run typecheck`, repo-wide `npm run lint`, `git diff --check`, linked Supabase apply of `20260606224200`, post-apply linked migration list aligned through `20260606224200`, post-apply linked dry-run returning `Remote database is up to date`, linked public-schema DB lint with no error-level findings, and live catalog markers confirming the migration row, rewritten `mark_video_date_daily_alive(...)` body, and both new indexes.

Deep audit/guidance sync on 2026-06-07 after PR #1218: a repo and cloud verification pass found the provider-terminal code/schema contract still aligned with intent across web and native/mobile. The concrete issue found was stale operator guidance: `AGENTS.md`, `CODEX.md`, `CLAUDE.md`, `docs/active-doc-map.md`, and this handoff prompt still described the older PR #1216 / `20260606212727` baseline even though PR #1218 and migration `20260606224200` were already the current source/cloud state. The guidance has been corrected to make PR #1218 the documented baseline, while preserving the hard rule that source merge, tests, Supabase alignment, visible media, or survey-required terminal state are implementation evidence only, not product acceptance proof. No source, migration, or branch-delta evidence file was deleted during this audit because those files remain part of the recovery trail.

Final session documentation sync on 2026-06-07: docs-only guidance updates merged into `main`, deleted/pruned their branches, and should be reverified from live Git instead of copied from static handoff hashes. Parent repo `/Users/kaanporsuk/Documents/Vibely` has no remote and should be checked with `git ls-tree HEAD Git/vibelymeet`. Supabase verification after the merge showed local/remote migrations aligned through `20260606224200`, dry-run returned `Remote database is up to date`, and live catalog markers confirmed the migration row, rewritten `mark_video_date_daily_alive(...)` body, and both provider-terminal indexes. The only removed clutter was ignored generated Expo state under `apps/mobile/.expo`. No code/schema defect was found in this audit, and no acceptance run was performed.

Mutual Match handoff closure implementation and audit on 2026-06-07: local source made `both_ready` date-owned even when Daily room/provider metadata was still preparing, so `/date/:sessionId` owns recovery instead of falling back to lobby/Ready Gate, and stale server `ready_gate` next-surface hints now yield to known `both_ready` date ownership. Migration `20260607103000_video_date_mutual_match_handoff_closure.sql` historically added durable `video_sessions.session_source` to label reciprocal swipes separately from the now-removed Mystery Match fallback; that source marker and its swipe payload field were later removed by `20260609171950_remove_video_sessions_session_source.sql`. The enduring behavior from the handoff closure is fail-soft `video_date_outbox_enqueue_v2`, `super_vibe_consumed=true` when a new Super Vibe row is recorded, service-role-only legacy tokenless `handle_swipe(...)`, and actor-bound `handle_swipe_v2(...)` while production clients remain on `swipe-actions` -> `handle_swipe_v2` with `deck_token`. Web and native/mobile consumers refresh/decrement Super Vibe count when `super_vibe_consumed=true`, queued-match notification payloads route to the event lobby with explicit queued state instead of opening Ready Gate early, and validation packs inspect the current renamed mutation bases instead of obsolete tokenless wrapper bodies. Historical verification included the then-active Mystery Match/source contracts; those surfaces are superseded by the 2026-06-09 removal migrations. Full `npm run test:event-lobby-regression`; full `npm run test:video-date-v4` with the expected two env-gated runtime RLS skips; `npm run typecheck`; repo-wide `npm run lint`; `npm run launch:preflight`; `git diff --check`; and linked Supabase dry-run passed for that historical pass. PR #1223 merged source to `main` at `0579ef7ce3845d07444918658f822f7d190ee88a`; Supabase cloud applied `20260607103000_video_date_mutual_match_handoff_closure.sql`; live catalog markers then confirmed the migration row, historical `session_source` column, fail-soft outbox wrapper, actor-bound `handle_swipe_v2`, legacy `handle_swipe` privilege restriction, Super Vibe/source wrapper, and the historical source wrapper that is now rewritten without source metadata; post-apply dry-run returned `Remote database is up to date`; linked public-schema lint had no error-level findings; and `swipe-actions` was deployed to project `schdyxcunwcvddlcshwd` as active version 747.

Provider-backed joined/absence-terminal implementation on 2026-06-07 after failed session `fd02e8ed-a272-46b1-a961-b130e83ce2a4`: PR #1225 merged source to `main` at `dc96df5c8c93d96d2b37e79c16212b782156bbae`, and Supabase cloud applied migration `20260607103100_video_date_provider_joined_absence_terminal.sql`. The legacy public `mark_video_date_daily_joined(...)` path is simplified into a provider-backed facade over `mark_video_date_daily_alive(...)`; web and native/mobile no longer send a bare `p_session_id` joined stamp and instead retry locally until Daily reports `joined-meeting` plus a local provider session id. Daily webhook ingestion and reconnect-grace expiry now call `video_date_reconcile_provider_absence_v1(...)`, which starts a 12-second provider-absence grace after a confirmed encounter when both Daily provider participants have left, preserves short leave/rejoin if either provider returns, and terminalizes to survey with `ended_reason='provider_absence_after_confirmed_encounter'` when both remain provider-absent after grace. Verification passed the new provider-joined absence contract, adjacent provider-terminal and stable-copresence contracts, refreshed Sprint 4 runtime contract, full `npm run test:video-date-v4` with only the two expected env-gated runtime RLS skips, full `npm run typecheck`, repo lint before the final internal helper-name shortening, targeted ESLint on changed TS files after that shortening, `git diff --check`, GitHub PR checks, linked post-apply migration list aligned through `20260607103100`, linked post-apply dry-run returning `Remote database is up to date`, linked public-schema lint with no error-level findings, and live catalog markers confirming the migration row, provider-absence function, 12-second grace marker, joined facade, provider latest index, Daily webhook wrapper, and reconnect-expiry wrapper. Local Supabase apply/parse validation could not run because Docker was unavailable. This is implementation evidence only, not acceptance proof.

Post-merge deep reanalysis of failed session `fd02e8ed-a272-46b1-a961-b130e83ce2a4` for event `3da1aef7-caef-4a2b-88d7-3aa35c29de7f` corrected a likely misleading shorthand in the handoff. The one-minute gap was abnormal for product acceptance, but it was not a one-minute delay to match, Ready Gate, room creation, or first Daily entry. Actual UTC sequence: match/session created `09:15:27.196`; `both_ready` committed `09:15:30.691`; initial Daily provider joins happened quickly at `09:15:34.084` for participant 1 (+3.4s) and `09:15:36.055` for participant 2 (+5.4s); both initial provider sessions then left at `09:15:57.173` and `09:15:57.397` (+26.5s/+26.7s); participant 2 rejoined with a new provider session at `09:16:07.207` (+36.5s); participant 1 rejoined at `09:16:26.076` (+55.4s); stable provider-backed handshake started at `09:16:31.564` (+60.9s); date promotion followed at `09:16:54.664` (+84.0s). The backend was right not to start stable handshake from the first joins because both had later matching Daily `participant.left` evidence. The unacceptable behavior was route/Daily lifecycle churn: observability showed 8 `daily_join_started`, 7 `daily_join_success`, 24 `daily_call_cleanup`, repeated date-route/stage visibility, provider-presence waits, no feedback rows, and final `date_timeout` with both registrations in `in_survey`. Lesson for future audits: when `both_ready` to stable copresence is long, split the question into first Daily join latency versus current provider-backed copresence latency. A clean acceptance run should show both initial Daily joins within a few seconds, no early provider leave, stable copresence shortly after, then bilateral media/date/survey completion.

Routeable `both_ready` entry protection implementation on 2026-06-07 after failed session `916f8ed7-15a9-45ec-8ec2-79879fa60a7f` for event `7b97ba01-59ee-41e7-bcf5-57b9d8517498`: the latest run failed before Daily provider evidence. It did not fail at matching, `both_ready`, or deterministic room metadata; it failed because routeable handshake/date ownership was still downstream of `daily-room` provider verification/token minting, while the old prepare-entry lease was skipped when Daily room metadata already existed. Migration `20260607123952_video_date_routeable_both_ready_entry_protection.sql` adds service-only `video_date_protect_both_ready_entry_v1(...)`, wraps `video_session_mark_ready_v2(...)` and `video_date_transition('prepare_entry')` to refresh a five-minute prepare-entry lease regardless of existing room metadata, extends `ready_gate_expires_at`, preserves canonical Daily room metadata for terminal diagnostics, and changes stale cleanup to respect active prepare-entry leases before terminalizing as `date_entry_prepare_timeout`. The `daily-room` `prepare_date_entry` path now confirms routeable handshake state before Daily provider verification/token minting, while still verifying/recreating the Daily provider room before issuing the token. Web and native/mobile Ready Gate overlays now fetch canonical session truth after retryable prepare failures and navigate to `/date/:sessionId` when truth is already routeable instead of exhausting in Ready Gate. Verification passed `npx tsx shared/matching/videoDateSprint3DailyHandoffContracts.test.ts`, `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`, full `npm run test:video-date-v4` with only the two expected env-gated runtime RLS skips, full `npm run typecheck`, repo-wide `npm run lint`, `npm run launch:preflight` with zero errors/warnings, `git diff --check`, linked Supabase apply of `20260607123952`, linked migration list aligned through `20260607123952`, linked dry-run returning `Remote database is up to date`, linked error-level DB lint with no error findings, live catalog markers for the migration/helper/wrappers/cleanup/index, and `daily-room` Edge Function deploy/list verification showing active version 860 updated at `2026-06-07 13:15:36 UTC`. No generated `.expo`, `dist`, or `test-results` clutter was present in the expected cleanup paths. This is implementation and cloud-deploy evidence only, not acceptance proof.

Video Session Created definitive contract implementation on 2026-06-07 after reviewing the attached assessment: shared active-session recovery now treats non-ended `both_ready` rows as fresh date-owner truth even when Daily provider metadata is still pending, so web and native/mobile active-session hydration cannot reject the same row that canonical route decision sends to `/date/:sessionId`. Queued sessions with `current_room_id` remain non-actionable and route to lobby/syncing only. Corrective migration `20260607152000_video_session_created_definitive_contracts.sql` replaces `video_date_protect_both_ready_entry_v1(...)` with clearer routeable-provider-pending observability and adds service-only `validate_video_date_registration_session_drift_v1(...)` plus dry-run-default `repair_video_date_registration_session_drift_v1(...)` for safe pre-date registration/session convergence checks. Its historical Mystery Match payload compatibility and then-current source-marker type drift are superseded by the 2026-06-09 removal migrations. Verification passed `npx tsx shared/matching/videoSessionCreatedDefinitiveContracts.test.ts`, `npx tsx shared/matching/videoDateSprint1RouteDecisionContracts.test.ts`, `npx tsx shared/matching/videoSessionDailyGate.test.ts`, `npx tsx shared/matching/videoDateSprint3DailyHandoffContracts.test.ts`, `npx tsx shared/matching/videoDateEndToEndHardening.test.ts`, full `npm run test:video-date-v4` with only the two expected env-gated runtime RLS skips, full `npm run typecheck`, repo-wide `npm run lint`, `npm run launch:preflight` with zero errors/warnings, `npm run regen:supabase-types`, and `git diff --check`. Cloud apply passed `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --yes`; post-apply linked dry-run returned `Remote database is up to date`, linked DB lint passed with no error findings, and live catalog checks confirmed migration `20260607152000` plus service-only drift function grants. This is implementation and cloud-deploy evidence, not acceptance proof.

Ready Gate entry proof implementation on 2026-06-07 after critically reviewing the follow-up assessment: the still-real gap was not queued-session routing or registration/session drift, which `20260607152000` already addressed, but the lack of durable proof that each participant actually mounted an actionable Ready Gate surface. Migration `20260607183000_video_date_ready_gate_entry_proof.sql` adds `video_sessions.ready_gate_participant_1_entered_at` and `ready_gate_participant_2_entered_at`, creates service-readable append-only ledger `video_date_ready_gate_entries`, and adds authenticated RPC `record_video_date_ready_gate_entered_v1(...)`. The RPC derives the actor from `auth.uid()`, requires the actor to be one of the two participants, rejects blocked pairs, inactive events, queued, `both_ready`, expired, date-owned, and terminal truth, records only `ready`/`ready_a`/`ready_b`/`snoozed` surface entry, and may extend an active gate to at least 45 seconds from a participant's first proven entry without marking Ready, handshake, date, or survey lifecycle truth. Web and native Ready Gate overlays now call this RPC only after `useReadyGate` has hydrated the same `sessionId` and the current status is entry-actionable; if the RPC extends the TTL, the client immediately syncs the session so the countdown follows server truth. Regression contract `shared/matching/readyGateEntryProofContracts.test.ts` is wired into `npm run test:video-date-v4`. This closes the product-truth blind spot for "both users entered Ready Gate" in source/schema, but it is not production acceptance proof until the migration is applied, deployed clients are live, and a fresh two-user run shows both entry timestamps/ledger rows before Ready/date/survey completion.

Lifecycle RPC terminal-contract implementation on 2026-06-07 after the latest failed two-user tests: the remaining failure class was not match, `both_ready`, deterministic Daily room creation, or first media. Network evidence showed normal high-volume Supabase/PostgREST polling and telemetry around `get_profile_for_viewer`, `get_video_date_start_snapshot_v1`, `get_video_date_queue_hint_v1`, `event_registrations` selects, `record_heartbeat_v2`, `ready_gate_transition`, `record_video_date_launch_latency_checkpoint`, `daily-room`, `video_sessions` selects, `mark_video_date_daily_alive`, `mark_video_date_daily_joined`, `mark_video_date_remote_seen`, `claim_video_date_surface`, `video_date_transition`, `record_video_date_client_stuck_observability`, `get_or_seed_video_session_vibe_questions`, feature flags, profile images, Daily scripts/websocket, and compressed analytics `e/?ip=...` calls. The actionable defect was that some browser/native lifecycle RPCs still behaved like ordinary retryable failures or raw 500 surfaces after server truth was already terminal/survey-bound. Live catalog inspection showed `mark_video_date_daily_joined(...)` and `video_date_transition(...)` still lacked the same outer exception/fail-soft contract already present on several adjacent RPCs. Migration `20260607155414_video_date_lifecycle_rpc_terminal_contracts.sql` adds shared terminal context, structured fail-soft payloads, and outer wrappers for `claim_video_date_surface`, `get_or_seed_video_session_vibe_questions`, `mark_video_date_daily_alive`, `mark_video_date_daily_joined`, `mark_video_date_remote_seen`, and `video_date_transition`; follow-up migration `20260607183100_video_date_lifecycle_truthy_helper_alignment.sql` adds tolerant JSON boolean parsing and replaces the shared payload helpers so terminal/survey enrichment cannot throw on malformed or stringy boolean payloads. Web and native/mobile now use shared `videoDateLifecycleRpc` classifiers so Daily alive/joined, reconnect sync/return, handshake decision/completion, and end-date paths stop terminal heartbeats/retries and route terminal survey truth to the existing survey recovery instead of keeping users on "Opening", "Holding", or Ready Gate retry surfaces. Regression contract `shared/matching/videoDateLifecycleRpcFailsoft.test.ts` is wired into `npm run test:video-date-v4`. Cloud/source sync evidence: PR #1230 merged at `2026-06-07T18:17:02Z` as `8721810f94215840b15332c6a75b92022d2df992`; Supabase applied `20260607183100_video_date_lifecycle_truthy_helper_alignment.sql`; final linked dry-run returned `Remote database is up to date`; live catalog markers confirmed the lifecycle helper and wrappers; linked DB lint had no error-level findings. This is still implementation/cloud evidence only; a fresh two-user production acceptance run is still required before calling Video Date fixed.

Provider-overlap promotion implementation on 2026-06-07 after failed session `09c8d1fb-b622-4f7f-ba4c-9f9c66c5e617` for event `84103231-823a-454d-8286-34f60c50f1b4`: the latest screenshots again showed the flow passing match/Ready Gate/route handoff and reaching `/date/:sessionId`, but not settling into a durable date. The Network tab continued the same hot-path family: `daily-room`, `mark_video_date_daily_alive`, `mark_video_date_daily_joined`, `mark_video_date_remote_seen`, `video-date-snapshot`, `video_date_transition`, `claim_video_date_surface`, `video_sessions` selects, `event_registrations` selects, `get_video_date_start_snapshot_v1`, `get_video_date_queue_hint_v1`, `record_heartbeat_v2`, `record_video_date_launch_latency_checkpoint`, `record_video_date_client_stuck_observability`, profile/feature-flag reads, Daily scripts/websocket, profile images, and compressed analytics `e/?ip=...` calls. The actionable lesson is that stable provider-backed overlap must be promoted by the shared server hot path, not by a brittle exact-order handshake race or a client route retry. A valid current overlap can have small join/heartbeat skew, and a token/provider hiccup must not convert an active date snapshot into a Ready Gate bounce.

Migration `20260607194546_video_date_definitive_provider_overlap_promotion.sql` makes that contract explicit. It replaces `video_date_stable_copresence_v1(...)` with a skew/freshness-tolerant provider-overlap decision, adds service-only `video_date_promote_provider_overlap_v1(...)`, and has `mark_video_date_daily_alive(...)`, `mark_video_date_daily_joined(...)`, `mark_video_date_remote_seen(...)`, and `video_session_handshake_auto_promote_v2(...)` all call that same promoter. The same migration keeps server-started provider-backed dates survey-continuous by updating `video_date_session_has_confirmed_encounter(...)`, and fixes startup truth so `both_ready` is routeable active state, not terminal state. The Edge `video-date-snapshot` function now returns a retryable tokenless active snapshot when Daily token issuance/provider work fails after core session truth exists; bounded Daily 429s still return `Retry-After`, while non-rate-limit token failures do not force the client back to Ready Gate. Regression contract `shared/matching/videoDateProviderOverlapPromotion.test.ts` is wired into `npm run test:video-date-v4`.

Review follow-up migration `20260607205617_video_date_provider_overlap_current_remote_seen.sql` tightens the one-sided remote-seen escape hatch. A single current `participant_*_remote_seen_at` can still combine with current provider-backed overlap to promote, but only when that one-sided remote evidence is current for that participant's latest provider-active window. Historical one-sided remote evidence from before a leave/rejoin churn can no longer combine with fresh provider overlap to start the date.

Verification for this implementation passed the focused provider-overlap contract, adjacent startup-snapshot/lifecycle/provider-terminal contracts, full `npm run test:video-date-v4` with only the expected env-gated runtime RLS skips, web app typecheck, mobile app typecheck, Daily room contract, `npm run lint`, `git diff --check`, linked Supabase apply of `20260607194546` and `20260607205617`, post-apply migration list alignment through `20260607205617`, post-apply dry-run returning `Remote database is up to date`, linked public-schema DB lint with no error-level findings, and `video-date-snapshot` deploy/list verification showing active version `53` updated at `2026-06-07 20:38:25 UTC`. This is implementation/cloud evidence only. The product is still not accepted until a fresh two-user production run proves match -> Ready Gate -> same Daily room -> stable bilateral provider-backed media/date -> date end -> survey completion, plus short leave/rejoin and prolonged absence.

Post-merge guidance sync on 2026-06-08: PR #1233 merged on 2026-06-07 as `0eb845d27dbc3557c5ae727d2586c9656faae82f`, and the nested repo source baseline was verified with local `main` and `origin/main` aligned at that commit. Supabase project `schdyxcunwcvddlcshwd` remained aligned through `20260607205617_video_date_provider_overlap_current_remote_seen.sql`, with `video-date-snapshot` active version `53`. The parent workspace has no remote; its sync point was parent commit `14771f00e4d552e50e303a6141a6469442caaee4`, whose gitlink pointed `Git/vibelymeet` at `0eb845d27dbc3557c5ae727d2586c9656faae82f`. Stale parent-root generated audit artifacts were removed because they cited obsolete source/cloud state. Keep this distinction explicit: PR #1233 is the implementation/cloud baseline, while later documentation-only PRs may advance source `main` without changing that implementation baseline. This still is not product acceptance proof.

Latest failed production audit after provider-overlap promotion: session `690f917e-f2d4-4e8f-a9ec-ece5ec70926e` for event `0f087f66-6b84-4618-8c98-909660f6139f` proved Ready Gate, same Daily room creation, provider-backed joins, bilateral remote_seen, and date promotion can all succeed, but the client still failed to keep a stable active Daily owner. Daily joins arrived at `2026-06-07T21:44:40.900Z` and `21:44:46.432Z`; the backend promoted to active date by `21:44:49Z`; bilateral remote_seen arrived at `21:44:57.870Z` and `21:44:58.921Z`; both provider sessions then left Daily around `21:45:19Z`; backend terminalized at `21:46:37Z` with `ended_reason='provider_absence_after_confirmed_encounter'`, both registrations in `in_survey`, and zero `date_feedback` rows. The key backend/client correlation was repeated `daily_call_cleanup` diagnostics from `useVideoCall.unmount` / `component_unmount`: web parked the live same-session Daily singleton but armed a `WEB_DAILY_CALL_LIVE_REMOUNT_IDLE_MS=20_000` destroy timer, and the final cleanup near `21:44:59Z` lined up with the Daily provider leaves near `21:45:19Z`. Native/mobile had the same class of bug in a different form: `cleanupDailyAndLocalState()` called `leave()` before `parkSharedCallForWarmHandoff()`, so a parked native singleton could already be left. Network screenshots also showed raw 500s from `mark_video_date_daily_alive`, `mark_video_date_daily_joined`, and `video_date_transition`; repository inspection found the provider-overlap migration had replaced public `alive`/`joined` after the lifecycle fail-soft migration, making the provider-overlap bodies the outermost exposed RPC layer.

PR #1235 Daily owner definitive implementation after session `690f917e`: web `src/hooks/useVideoCall.ts` now treats live same-session Daily remount parking as non-expiring (`WEB_DAILY_CALL_LIVE_REMOUNT_IDLE_MS: number | null = null`), keeps destructive disposal for destroyed/unusable/session-mismatched calls, records append-only `daily_call_singleton_idle_destroy` observability if an idle/expired destroy path ever executes, and preserves cleanup telemetry with `idle_destroy_disabled`. Native/mobile `apps/mobile/app/date/[id].tsx` now makes Daily singleton preservation an explicit `preserve_active_handoff` cleanup mode, parks before any `leave()`/destroy only on that named handoff path, keeps abort/end/background cleanup destructive by default, disables idle destroy for active warm-handoff parking, refuses to park terminal/survey-ended cleanup, and records the same singleton idle-destroy observability event if a timed destroy is re-enabled later. Shared observability allowlists the new event and fields. Supabase migration `20260607222923_video_date_daily_owner_definitive_recovery.sql` re-establishes final outermost wrappers for `mark_video_date_daily_alive(...)`, `mark_video_date_daily_joined(...)`, and `video_date_transition(...)` after provider-overlap by renaming the current public bodies to `*_20260607222923_definitive_base`, enriching successful payloads with lifecycle terminal context, and converting residual exceptions into structured fail-soft JSON while recording `lifecycle_rpc_exception` observability. Corrective migration `20260608001000_video_date_base_failsoft_payload_sanitization.sql` then sanitizes fail-soft JSON returned by those renamed base RPCs too, because a base `EXCEPTION` can return JSON instead of throwing and would otherwise bypass the outer wrapper's sanitized exception path.

Deep audit refinement on 2026-06-08 tightened the native/mobile cleanup contract after code review found the first local fix still allowed broad `cleanupDailyAndLocalState()` callers to park Daily during manual abort/end/background paths. Native cleanup now defaults to destructive mode, names each destructive reason (`leave_and_cleanup`, `app_background`, `app_background_timeout`, `app_foreground_after_background_timeout`), and only preserves Daily on an explicit `preserve_active_handoff` mode. A second pass tightened the SQL fail-soft fallback: raw exception `message`/`detail`/`hint` remain in server-side `lifecycle_rpc_exception` observability, while the three re-exposed public hot RPCs pass sanitized diagnostic fields into the client fail-soft payload builder; if the richer fail-soft payload builder itself fails, the final emergency payload returned to web/native clients is compact and sanitized too. PR review then found one remaining base-return gap, so `20260608001000` adds service-only `video_date_lifecycle_sanitize_client_failsoft_payload_v1(jsonb)` and replaces the three public wrappers to sanitize enriched base-returned fail-soft payloads before authenticated clients receive them. The stale untracked audit artifact `docs/audits/video-date-current-codebase-audit-2026-06-07.md` was removed because it cited obsolete branch, HEAD, and Supabase alignment. Verification passed focused singleton/warmup/lifecycle/observability contracts, `shared/matching/videoDateEndToEndHardening.test.ts`, `shared/matching/videoDateStableCopresenceOwnerContracts.test.ts`, full `npm run test:video-date-v4` with only expected env-gated RLS skips, `npm run typecheck`, `npm run lint`, `git diff --check`, pre-apply linked migration list showing `20260607222923` and later `20260608001000` as the sole pending migrations at their respective stages, linked Supabase dry-runs planning only those migrations before apply, linked DB lint with no error-level findings, PR #1235 GitHub checks, linked Supabase apply of `20260607222923` and `20260608001000`, post-apply migration list alignment through `20260608001000`, post-apply dry-run returning `Remote database is up to date`, post-apply DB lint with no error-level findings, and live catalog markers confirming the migration rows, public wrappers, renamed base functions, service-only helper grants, authenticated wrapper grants, delegate calls, sanitized fail-soft payloads, base-return sanitizer, and exception observability. This is still not product acceptance proof.

Post-merge PR #1235 synchronization on 2026-06-08: PR #1235 merged to nested repo `main` as `604ac8bc1c76c79035ac01311aa501f4e2ce2fe5` (`fix: stabilize video date Daily owner recovery (#1235)`), local `main` and `origin/main` were verified at the same commit, and the remote/local source branch `fix/video-date-daily-owner-definitive` was gone. The parent workspace remains local-only; its `Git/vibelymeet` gitlink was committed to point at the nested PR #1235 merge commit, but future handoffs should still verify that with `git ls-tree HEAD Git/vibelymeet` instead of copying a parent commit hash. Supabase project `schdyxcunwcvddlcshwd` was reverified after merge with migration list alignment through `20260608001000`, a dry-run result of `Remote database is up to date`, DB lint exit 0 with legacy warning-only findings, and live catalog markers proving the sanitizer/helper/wrapper grants plus sanitized success/exception delegation. No Edge Function deploy was required for PR #1235 because the landed changes were client source, tests, docs, and database migrations. Documentation sync lesson: when a corrective migration is added after an applied migration, promote the corrective migration as the source/cloud top everywhere; do not leave guidance naming only the original applied migration.

PR #1235/source-cloud alignment is not acceptance proof. Before calling Video Date fixed, verify source is merged/deployed for web, native/mobile builds contain the client-side heartbeat skip, and a fresh disposable two-user production run completes match -> Ready Gate -> same Daily room -> stable provider-backed bilateral media/date -> date end -> survey completion, plus short leave/rejoin and prolonged absence checks.

Before changing code, inspect the latest failed or acceptance session with Supabase/Daily evidence in order. Capture event_id, video_session_id, both user IDs, Ready Gate payloads, video_session_commands, video_date_daily_webhook_events, video_date_surface_claims, video_date_presence_events, event_loop_observability_events, Daily room/session IDs, participant joined/left order, participant_*_away_at, participant_*_remote_seen_at, reconnect_grace_ends_at, ready_gate_expires_at, prepare_entry_started_at, prepare_entry_expires_at, prepare_entry_attempt_id, latest away reason, ended_reason, survey_required, date_feedback rows, event_registrations queue_status/current_room_id, final daily_room_name/url, daily_room_provider_verify_reason, daily_room_provider_deleted_at/delete_reason, and any RPC response bodies with sqlstate/message/hot_path/expiry_grace_applied/retryable_command_reopened/daily_transport_grace_expired/away_mark_suppressed/reconnect_grace_cleared/reconnect_grace_cleared_by_remote_seen/latest_remote_seen_at/early_confirmed_encounter_promoted/promotion_reason/provider_overlap_promotion/provider_overlap_promoted_to_date/confirmed_encounter_promoted_to_date/confirmed_encounter_deadline_rescue/handshake_deadline_extended_for_launch_evidence_v2/surface_claim_backoff/surface_active_near_away/current_unexpired_surface_claim/recent_lifecycle_media/same_session_daily_continuity_latched/parked_singleton/daily_call_live_remount_identity_preserved/daily_call_live_remount_heartbeat_preserved/activeIdentityPreserved/historical_remote_seen_truth/truth_refresh_attempt/daily_no_remote_watchdog_historical_truth_suppressed/peer_missing_suppressed_remote_seen/post_encounter_peer_missing_terminal_end_suppressed/provider_absence_server_owned_after_encounter/partner_absent_after_confirmed_encounter/waiting_for_stable_copresence/stable_copresence/heartbeat_floor_at/heartbeat_overlap/heartbeat_fresh/one_remote_seen_provider_current/latest_owner_heartbeat_at/owner_id/owner_state/entry_attempt_id/call_instance_id/provider_session_id/daily_owner_provider_left_unexpected/provider_presence_missing/provider_presence_terminal/provider_backed_current/join_stamp_accepted/date_entry_prepare_timeout.

If the next run fails, decide precisely which boundary diverged from expected behavior: Ready Gate hot path, routeable `both_ready` prepare-entry lease protection, route confirmation before provider verification/token work, date route ownership, Daily start ownership, first Daily join latency versus current provider-backed copresence latency, provider-overlap promotion, early provider join-left-rejoin churn, same-session Daily remount parking/reuse, provider join/leave ledger, canonical remote_seen repair, immediate confirmed-encounter promotion, confirmed-encounter deadline fallback rescue, positive launch-evidence extension, browser/native lifecycle-away suppression including `web_beforeunload`, reconnect grace clearing/expiry, active surface-claim continuity, current-peer detection, post-encounter absence ending, sticky survey status, pending-survey registration repair, terminal room repair/preservation, cleanup marker semantics, terminal survey hard-stop, tokenless snapshot recovery, or survey persistence. Propose scoped changes only after that evidence is collected.
```
