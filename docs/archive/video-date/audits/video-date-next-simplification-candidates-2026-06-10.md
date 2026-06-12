# Video Date — Next Simplification Candidates (2026-06-10)

Audit type: investigation/planning only. No code, migration, or deployment changes were made in this pass.

Baseline: nested repo `Git/vibelymeet` on `main` at `449558f866dd1d812d0dbac66521b0493450d41c` (PR #1285, "handshake -> entry: Phase A cleanup + Phase B/C"), clean working tree. Linked Supabase cloud is documented as applied through `20260610130000_video_date_handshake_to_entry_compat.sql` (per `docs/branch-deltas/handshake-to-entry-phase-bc.md`; re-verify with `supabase migration list --linked` before acting on this report).

Proof boundary: nothing in this report claims Video Date is fixed or accepted. The acceptance bar remains a fresh disposable two-user production run: mutual swipe -> Ready Gate -> both ready -> one `prepare_date_entry` -> `/date/:sessionId` -> decision period -> post-date survey -> persisted `date_feedback` for both users.

---

## 1. Executive Summary

The golden flow itself is now structurally simple: one swipe RPC chain creates a `ready` Ready Gate session directly, one prepare owner (the Ready Gate overlay) calls `prepare_date_entry`, one Edge Function (`daily-room`) owns room/token work with only four actions, and one survey path persists `date_feedback`. The queue/drain/rescue subsystem, Mystery Match, session-source, Match Calls, standalone `enter_handshake`, and post-date instant-next are verifiably gone from active runtime code.

What still makes Video Date complex today is **accumulated defensive and transitional scaffolding around that lean core**, not the core itself:

1. **Generational layering in the database.** ~120 timestamp-suffixed `*_base` function generations live in the public schema (21 generations of `video_date_transition_*` alone, 11 of `handle_swipe_*`, 9 of `ready_gate_transition_*`, 7 of `video_session_mark_ready_v2_*`). Each recovery migration wrapped the previous body instead of replacing it. They are service-role-only (verified grant pattern) but they pollute the catalog, the generated types, and every future migration's reasoning.
2. **Dormant compatibility branches on the survey persistence step.** Three callable verdict generations (`submit_post_date_verdict`, `_v2`, `_v3`) are dispatched by `post-date-verdict` based on a client-sent `transition_version` that is still chosen by a feature flag at runtime, with client outboxes defaulting to `"v2"`. The single most important write of the flow (`date_feedback`) has three live code paths.
3. **Unfinished or abandoned migrations living as runtime branches**: the web lobby ships a dual active-session hydration branch behind a default-false runtime flag plus a shadow-context experiment; the handshake→entry rename is mid-flight (Phase B/C compat live, Phase D/E pending); the queued-state vocabulary (`queued_expires_at`, `'queued'` status values, queue-fairness views) survives with zero writers.
4. **Flag and telemetry sprawl**: 36 client-declared Video Date flags of which 8 have zero client readers (they are actually server-side rollout flags misfiled in the client list) and 4 are alias keys kept alive by dedicated alias-resolution machinery; hot-path telemetry RPCs (launch-latency checkpoints, Ready Gate entry proof) sit inside the entry path they were built to debug.

The biggest simplification wins, in order of value-to-risk: collapse the verdict path to v3-only; finish the queued-vocabulary purge; delete the web dual-hydration experiment; purge the client flag list; then — after a successful two-user acceptance run — flatten the base-function onion and complete handshake→entry Phase D/E.

---

## 2. Current Golden Flow Map (verified from source at `449558f86`)

### Event Lobby → swipe
- Web route `/event/:eventId/lobby` → `src/pages/EventLobby.tsx` (3,528 lines). Native: `apps/mobile/app/event/[eventId]/lobby.tsx` (5,309 lines).
- Deck: `get_event_deck(uuid,uuid,integer)` (validated by `supabase/validation/event_lobby_ready_queue_contract.sql` — busy-user filter excludes active Ready Gate/handshake/date sessions).
- Swipe: web `src/hooks/useSwipeAction.ts` → Edge `supabase/functions/swipe-actions/index.ts:321` → `handle_swipe_v2` RPC (actor-bound wrapper `handle_swipe_v2_20260607103000_actor_bound_base` → `handle_swipe_*` chain). Super Vibe is an active product path (`super_vibe_consumed` in `swipe-actions`, `shared/notifications.ts`, both lobbies).
- Mutual match: since `20260610120000_remove_match_queue_source_always_ready.sql`, the deepest INSERT-bearing base (`handle_swipe_20260506090000_stale_room_base`) always inserts a single `video_sessions` row with `ready_gate_status = 'ready'`, `ready_gate_expires_at = now() + 30s`, `queued_expires_at = NULL`, returning `result = 'match'`, `immediate = true`. No queued branch exists.
- Notifications: `swipe-actions/index.ts:69` enqueues via `video_date_outbox_enqueue_v2` (transactional outbox); `send-notification` Edge Function delivers `date_starting` etc.

### Ready Gate
- Overlay (canonical prepare owner per PR #1283): web `src/components/lobby/ReadyGateOverlay.tsx` (3,921 lines), native `apps/mobile/components/lobby/ReadyGateOverlay.tsx` (2,804 lines). Standalone deep-link hosts: web `src/pages/ReadyRedirect.tsx` (279 lines), native `apps/mobile/app/ready/[id].tsx` (2,158 lines).
- State: `video_sessions.ready_gate_status` ∈ `ready | ready_a | ready_b | both_ready | snoozed` (plus inert `queued`), `ready_gate_expires_at`.
- Mark ready: `video_session_mark_ready_v2` (public no-throw shell → `vd_mark_ready_20260609130139_hot_base`), deterministic idempotency key, decisive-commit baseline `20260606092944`.
- Entry proof telemetry: `record_video_date_ready_gate_entered_v1` via `src/lib/readyGateEntryProof.ts` and `apps/mobile/lib/readyGateEntryProof.ts` → ledger `video_date_ready_gate_entries`. Note: first participant entry may extend the gate to ≥45s (behavioral, not pure telemetry).
- Realtime: `shared/matching/readyGateRealtimeSupervisor.ts`, countdown `shared/matching/readyGateCountdown.ts`, web hook `src/hooks/useReadyGate.ts` (1,544 lines), native `apps/mobile/lib/readyGateApi.ts` (1,383 lines).

### both_ready → prepare → `/date/:sessionId`
- Single prepare owner: the mounted Ready Gate overlay calls `prepareVideoDateEntry` (`shared/matching/videoDatePrepareEntry.ts`) on `both_ready`; lobbies only mount/route (web prepare path removed from `EventLobby.tsx` in PR #1283; native passes `{ skipPrepare: true }`).
- Edge `supabase/functions/daily-room/index.ts` (2,500 lines) — action contract is now lean: `prepare_date_entry` (line 2036), `video_date_leave` (1903), `delete_room` (1965), `health_ping` (1838). `dailyRoomContracts.ts` types `DateRoomAction = "prepare_date_entry" | "video_date_leave"`.
- `prepare_date_entry` internally: participant eligibility recheck, prepare-entry lease (`video_date_protect_both_ready_entry_v1`), `video_date_transition('prepare_entry')`, Daily room create/verify/token (room name `date-<sessionId>`), `confirm_video_date_entry_prepared`, routeable handshake state persisted before provider verification (migration `20260607123952`).

### Video Date state machine
- DB: `video_sessions.state` enum `video_date_state` = `ready_gate | handshake | date | post_date | ended` (`post_date` is dead — see §4.G); parallel `phase` text; timers `handshake_started_at` / `handshake_grace_expires_at` with Phase B generated mirrors `entry_started_at` / `entry_grace_expires_at` (`20260610130000`).
- Web `/date/:sessionId`: `src/pages/VideoDate.tsx` (6,792 lines) + `src/hooks/useVideoCall.ts` (8,034 lines). Native: `apps/mobile/app/date/[id].tsx` (13,524 lines) + `apps/mobile/lib/videoDateApi.ts` (1,663 lines).
- Hot-path RPCs (public no-throw shells over service-only bases): `claim_video_date_surface`, `mark_video_date_daily_alive`, `mark_video_date_daily_joined`, `mark_video_date_remote_seen`, `video_date_transition`, `video_session_mark_ready_v2`, `record_video_date_launch_latency_checkpoint`.
- Promotion to `date`: `mark_video_date_remote_seen` (provider-bound) or `video_session_entry_auto_promote_v2` (Phase B wrapper → `video_session_handshake_auto_promote_v2`), gated by the stable bilateral media gate (`stable_bilateral_media_at`, migrations `20260609014410`–`20260609045533`).
- Decision period actions: `video_date_transition` action strings `complete_handshake`/`complete_entry`, `continue_handshake`/`continue_entry` (aliases since Phase B), `end`; in-date UI: `VibeCheckButton`, `MutualVibeToast`, `KeepTheVibe` (extension), `IceBreakerCard` (vibe questions via `advance_video_session_vibe_question`).
- Deadline rescue (fallback only): `finalize_video_date_handshake_deadline` / Phase B alias `finalize_video_date_entry_deadline`, cron `video-date-deadline-finalizer`, bounded sweeper `expire_due_joined_video_date_handshakes_bounded` (+ entry alias).
- Snapshot reads (two parallel read paths, both active): RPC `get_video_date_start_snapshot_v1` via `shared/matching/videoDateStartSnapshot.ts` (11 client consumers, mostly Ready Gate/route truth) and Edge `video-date-snapshot` via `shared/matching/videoDateSnapshot.ts` (11 client consumers, mostly `/date` + push preload). Token refresh: Edge `video-date-token-refresh`.

### Post-date survey → `date_feedback` → return
- Survey UI: web `src/components/video-date/PostDateSurvey.tsx` + `survey/VerdictScreen.tsx`, `survey/SafetyScreen.tsx`, `survey/HighlightsScreen.tsx`; native `apps/mobile/components/video-date/PostDateSurvey.tsx`.
- Submission: client post-date outbox (`shared/postDateOutbox/*`, `src/lib/postDateOutbox/execute.ts`, `apps/mobile/lib/postDateOutbox/*`) → Edge `post-date-verdict` → `submit_post_date_verdict_v3` (or `_v2`/keyless v1 — see §4.A) → `date_feedback` row. Direct authenticated writes to `date_feedback` are revoked (migration `20260608211359`); optional details go through `update_post_date_feedback_details`.
- Survey eligibility: server-owned (`survey_required`, `queue_status = 'in_survey'`; `pre_stable_media_failed` is survey-ineligible). Clients confirm the actor's own `date_feedback` row before advancing.
- Return: web survey navigates to `/event/:eventId/lobby?postSurveyComplete=1` (PostDateSurvey.tsx:587) or `/home` (line 613) or `/chat/:partnerId` (line 1005). No queue drain, no auto-next.
- Reminders (server-owned): `post-date-verdict-reminders` Edge + `post_date_zero_feedback_reminders` + `detect_post_date_half_verdict_timeouts` cron.

### Video-date-related cron jobs (active names from migrations)
`daily-room-keepwarm` (5-min health ping), `expire-stale-video-sessions`, `expire-video-date-reconnect-graces`, `video-date-deadline-finalizer`, `video-date-outbox-drainer`, `video-date-room-cleanup`, `video-date-orphan-room-cleanup`, `video-date-recovery-alert-dispatcher`, `synthetic-video-date-monitor`, `post-date-verdict-reminders`, `post-date-half-verdict-timeout-detection`. (Match Call crons were unscheduled by `20260609224646_remove_match_calls.sql:8-19`.)

---

## 3. Already Removed / No Longer Active (verified)

| Removal | Evidence | Inert leftovers |
|---|---|---|
| Mystery Match | `rg -i mystery src apps/mobile shared supabase/functions` → only absence tests + validation asserting absence; migration `20260609152000` | none in active source |
| Legacy queue/session RPCs (`find_video_date_match`, `join_matching_queue`, `leave_matching_queue`) | migrations `20260609163130`, `20260609165218`; absent from generated types | none |
| `video_sessions.session_source` | migration `20260609171950`; `videoSessionSourceRemovalContracts.test.ts` in regression suite | none |
| Non-golden `daily-room` actions (`create_date_room`, `join_date_room`, `ensure_date_room`, `prepare_diagnostic_entry`, `prepare_solo_entry`) | dispatcher handles only 4 actions (index.ts:1838–2036); `dailyRoomLegacyActionRemovalContracts.test.ts` | `create_date_room_*` provider observability labels remain (intentional, shared Daily lifecycle internals) |
| Chat Match Calls | migration `20260609224646` incl. cron unschedule; `match_calls` absent from types | provider-room cleanup limitation documented in `20260610022531` notes |
| Standalone `enter_handshake` | migration `20260609202707`; native no longer exports `enterHandshake*` | tombstone guard returning `ENTER_HANDSHAKE_REMOVED` still installed (intentional compat shell — retire in Phase E) |
| Post-date instant next / queue drain / queue hints / queued rescue (`drain_match_queue`, `drain_match_queue_v2`, `get_video_date_queue_hint_v1`, `promote_ready_gate_if_eligible`) | migration `20260610000100`; `rg "drain_match_queue|promote_ready_gate_if_eligible|get_video_date_queue_hint"` in active source → zero | `'queued'` vocabulary + fairness views remain (§4.B) |
| Match-queue branch at the swipe source (`match_queued`) | migration `20260610120000`; `rg match_queued` in active non-test source → zero hits | `queued_expires_at` column + `p_queued_expires_at` arg + status values (§4.B) |
| Multi-owner prepare (lobby-owned `prepareVideoDateEntry`) | PR #1283: web `EventLobby.tsx` no longer imports `prepareVideoDateEntry`; native passes `skipPrepare: true` | none |
| Client "handshake" vocabulary (Phase A) + additive entry compat (Phase B/C) | PR #1284/#1285; clients call `video_session_continue_entry_v2` / `video_session_entry_auto_promote_v2`; `EntryPhaseTimer`, `videoDateEntryTiming.ts` | the whole compat layer is itself transitional (§4.E) |

---

## 4. Obsolete / Legacy Candidate Inventory

### A. Triple-generation post-date verdict path (v1 / v2 / v3)
- **Current behavior:** `post-date-verdict` Edge dispatches by client input: `submit_post_date_verdict_v3` when `transition_version === "v3"`, `submit_post_date_verdict_v2` when an idempotency key is present otherwise, bare `submit_post_date_verdict` when no key (`supabase/functions/post-date-verdict/index.ts:107–130`). Clients pick the version at runtime from flag `video_date.outbox_v2.submit_verdict` (`src/components/video-date/PostDateSurvey.tsx:127,694,823`; `apps/mobile/components/video-date/PostDateSurvey.tsx:1022`; `apps/mobile/lib/videoDateApi.ts:1525`) and both platform outbox executors **default to `"v2"`** when `backendVersion` is unset (`src/lib/postDateOutbox/execute.ts:56`, `apps/mobile/lib/postDateOutbox/execute.ts:51`).
- **Surfaces:** Edge `post-date-verdict`; RPCs `submit_post_date_verdict`, `_v2`, `_v3`, plus base `submit_post_date_verdict_20260603090000_remote_seen_base`; client files above; flag row `video_date.outbox_v2.submit_verdict`.
- **Why obsolete:** v3 is the canonical mandatory-write path (survey-feedback drain-guard migration `20260608211359` framed writes as "behind `submit_post_date_verdict_v3` / `post-date-verdict`"). The v2/v1 branches exist only as flag-off fallbacks.
- **Status:** active (flag-conditional). **Parity:** identical branch on web and native. **Owner:** mixed (client chooses, server dispatches).
- **Removal risk:** low-medium — requires live verification that the flag is ON in production and that v3 handles the keyless case (or keep key mandatory); old app versions in the field still sending v2 need a server-side grace (map v2 requests to v3 in the Edge Function for one release boundary).
- **Value:** high — the flow's single most important write becomes one path.
- **Tests:** update `postDateOutbox.test.ts`, `videoDateSurveyFeedbackDrainGuard.test.ts`, add absence contracts for v1/v2 dispatch.

### B. Queued-state vocabulary residue (backend + client parsers + operator views)
- **Current behavior:** no writer exists (post-#1282 every mutual match inserts `ready`), but: column `video_sessions.queued_expires_at` (types.ts:8536), `'queued'` in `ready_gate_status`/`queue_status` allowed values, `p_queued_expires_at` parameter of `video_session_blocks_global_active_conflict` (types.ts:14247); client parse branches: `src/domain/enums.ts:17`, `shared/matching/videoDateSnapshot.ts:2,83` (queued is even the **default fallback phase**), `shared/matching/videoDateRouteDecision.ts:149`, `shared/matching/videoDateRecoveryAdvisor.ts:194–200`, `shared/matching/readyGateReadiness.ts:125`, `shared/matching/videoDateTimeline.ts:36`, `apps/mobile/lib/readyGateApi.ts:89,269,305,388,1034`; operator surfaces: views `v_video_date_queue_fairness_candidates`, `v_video_date_queue_fairness_event_health`, RPC `get_video_date_queue_fairness_health`, views `v_event_loop_drain_events`, `v_event_loop_drain_outcomes_hourly`, fairness reads in `shared/observability/videoDateOperatorMetrics.ts` and `admin-video-date-ops`.
- **Why obsolete:** the queue subsystem is gone; these report empty/healthy forever and force every reader of the route-decision/snapshot code to reason about a state that cannot occur.
- **Status:** inert (documented as a tracked follow-up in `docs/branch-deltas/remove-match-queue-source.md` §"Intentionally Left In Place"). **Parity:** all three layers. **Owner:** mixed.
- **Removal risk:** medium — dropping `p_queued_expires_at` changes the shared global-active-conflict guard signature; constraint tightening needs a data sweep proving zero `'queued'` rows; generated types regen ripples through clients.
- **Value:** high — removes a phantom state from the route decision model on every platform.
- **Tests:** extend `matchQueueSourceRemovalContracts.test.ts` to assert column/value absence; update snapshot/route-decision/readiness tests.

### C. Web dual active-session hydration + shadow context experiment
- **Current behavior:** `src/pages/EventLobby.tsx:394–406` selects between `useEventActiveSession(eventId)` (provider/context path) and "legacy" `useActiveSession(user?.id, …)` based on `isActiveSessionSingleOwnerEnabled()` — which defaults to **false** (`src/lib/runtimeFlags.ts:28–34`, env `VITE_ACTIVE_SESSION_SINGLE_OWNER` / localStorage). A second default-false flag `isActiveSessionContextShadowEnabled` drives shadow-compare instrumentation inside `src/hooks/useActiveSession.ts` (990 lines) with `src/contexts/SessionHydrationContext.tsx`.
- **Why obsolete:** production always runs the legacy path; the single-owner/shadow branch is an unfinished migration that doubles the hydration logic in the most fragile surface (lobby ↔ date route truth) and has **no native counterpart** (native has one path).
- **Status:** legacy+experimental, both live. **Parity:** web-only divergence. **Owner:** client.
- **Removal risk:** low if the *experiment* is deleted (default behavior unchanged); medium if instead the provider path is promoted (would need its own verification window).
- **Value:** high relative to cost — one hydration owner, less `EventLobby.tsx` branching, removes two runtime flags.
- **Tests:** `realtimeSubscriptionTightening.test.ts`, lobby regression harness; delete shadow-specific contracts.

### D. Client feature-flag sprawl (36 declared; 8 with zero client readers; 4 alias keys)
- **Current behavior:** `shared/featureFlags/videoDateV4Flags.ts` declares 36 client flags. Zero active client reads (verified per-key `rg` over `src` + `apps/mobile`): `deck_deal_v2`, `broadcast_batched_v2`, `outbox_lease_refresh_v2`, `deadline_partial_unique_v2`, `orphan_safety_interlock_v2`, `circuit_breaker_v2`, `daily_webhooks_v2`, `daily_pool_v2`. All eight **do** have server-side readers in migration-defined DB functions (latest hits in `20260602005051`, `20260602010000`, `20260522015000`, etc.) — they are server rollout flags misfiled in the client list. Four alias keys (`push_open_dedupe_v1`, `verdict_confirm_v1`, `ready_gate_resilient_clock_v1`, `deck_optimistic_v1`) exist only to feed `featureFlagAliasResolution.ts` dual-read machinery.
- **Why obsolete:** the client list misrepresents the contract; alias groups were one-release-boundary bridges that never got retired; long-settled rollout flags now read as permanent configuration.
- **Status:** mixed — client-list entries inert; server flag reads active. **Owner:** mixed. **Parity:** shared.
- **Removal risk:** low for the client-list/alias cleanup (pure client). Medium-high for hard-coding the server branches (each DB function reading a flag must be inspected via `pg_get_functiondef` against the live catalog and rewritten with the proven-on branch inlined; that is Phase-style migration work).
- **Value:** medium-high — flags are the main "which behavior is actually live?" confusion source.
- **Tests:** `clientFeatureFlagsContracts.test.ts` rewrite; per-flag absence assertions.

### E. handshake→entry transitional compat (Phase B/C live; D/E pending)
- **Current behavior:** generated mirror columns `entry_started_at`/`entry_grace_expires_at`; four delegating wrapper RPCs (`video_session_entry_auto_promote_v2`, `video_session_continue_entry_v2`, `finalize_video_date_entry_deadline`, `expire_due_joined_video_date_entries_bounded`); `video_date_transition` action aliases `complete_entry`/`continue_entry`; `ENTER_HANDSHAKE_REMOVED` tombstone; flag key `video_date.outbox_v2.continue_handshake` intentionally still handshake-named; enum value `'handshake'` + `phase='handshake'` still canonical; 5 Edge Functions still read handshake columns/values (`daily-room`, `video-date-snapshot:565`, `video-date-token-refresh:524`, `send-notification:645–700`, `admin-video-date-ops:1277`); `shared/matching/videoDateHandshakePersistence.ts` and 58 test files pin handshake markers; 6 validation SQL files (e.g. `event_lobby_ready_queue_contract.sql:27-29`) assert `'handshake'` literals.
- **Why it persists:** deliberate — Phase D (enum/phase flip + Edge migration) and Phase E (retire compat) are gated on a real two-user verification window (`docs/branch-deltas/handshake-to-entry-phase-bc.md` §Remaining).
- **Status:** active transitional. **Owner:** mixed. **Parity:** all layers.
- **Removal risk:** highest of all candidates (enum rename touches dozens of live functions atomically).
- **Value:** terminology-debt elimination; no behavior change.
- **Tests:** the 58 pinned test files + 6 validation packs must move in lockstep per phase.

### F. Stale base-function generations ("wrapper onion") in the public schema
- **Current behavior:** generated types list ~120 timestamp-suffixed functions (extraction from `src/integrations/supabase/types.ts` Functions section): 21 `video_date_transition_20260*` generations, 11 `handle_swipe_20260*`, 9 `ready_gate_transition_20260*`, 7 `video_session_mark_ready_v2_20260*`, 6 `mark_video_date_daily_joined_20260*`, 5 each `claim_video_date_surface_20260*` / `mark_video_date_remote_seen_20260*` / launch-latency, plus short-named `vd_*_base` hot bases and singletons. Grants follow the REVOKE-all + GRANT-service_role pattern (verified in `20260609130139_…sql:50–77`), so they are not authenticated-callable, but they remain callable by service role and visible in types.
- **Important nuance:** these are **not all dead**. The architecture is deliberate nesting — newer wrappers delegate down the chain, and intermediate generations may still be in the live call path (e.g. `handle_swipe_20260601183000_deck_authority_base` is now a pass-through over `handle_swipe_20260610000100_auto_next_base`). True deadness must be established per function by walking `pg_get_functiondef` from each public shell against the **live catalog**, never from migration files.
- **Why a candidate:** this is the single largest comprehension cost in the backend. Every new fix adds a layer; reviewers cannot tell which generation executes.
- **Status:** mixed active-chain / dead-intermediate. **Owner:** server. **Parity:** backend-only.
- **Removal risk:** medium-high; mitigated by doing one RPC family per migration: redefine the public shell with a single flattened body, then drop all superseded generations of that family in the same migration, with before/after `pg_get_functiondef` capture and validation SQL.
- **Value:** very high long-term (state-machine branch count, migration safety, types noise).
- **Tests:** per-family validation SQL asserting exactly one base; `supabase db lint`; full Video Date suites.

### G. Dead `post_date` enum value in `video_date_state`
- **Current behavior:** enum is `ready_gate | handshake | date | post_date | ended` (types.ts:14611–14616). Zero references to `'post_date'` as a state in Edge Functions, zero in the last 30 migrations, zero in client domain/route/snapshot modules — survey lifecycle is tracked by `queue_status='in_survey'` + `survey_required` instead.
- **Status:** dead. **Owner:** server. **Risk:** Postgres cannot drop an enum value in place; removal means a type rebuild. **Recommendation:** fold into Phase D enum work (rename `handshake`→`entry` and drop `post_date` in the same rebuild) rather than a standalone effort.

### H. `shared/matching/videoDateLeanRuntimeContract.ts` — unadopted parallel model
- **Current behavior:** screen/command model (`lobby|ready_gate|date|survey|done|blocked`; `swipe|mark_ready|prepare_date|…`) added 2026-06-09 as simplification groundwork. **Zero active client consumers** (verified `rg` over `src` + `apps/mobile`); only its own test + docs reference it.
- **Why a candidate:** an unconsumed second source of truth for the state model is itself complexity. Either adopt it as the real route-decision layer (replacing parts of `videoDateRouteDecision.ts`/`videoDateTimeline.ts`) or delete it until the consolidation project actually starts.
- **Status:** inert. **Owner:** shared/client. **Risk:** none to delete; product decision to adopt. **Value:** low-medium (hygiene/clarity).

### I. Hot-path launch-latency checkpoint telemetry
- **Current behavior:** clients call `record_video_date_launch_latency_checkpoint` during entry (via `src/lib/analytics.ts` / `apps/mobile/lib/analytics.ts` + `shared/observability/videoDateLaunchLatencyCheckpointObservability.ts`); the RPC has 5+ base generations and needed its own no-throw shell because raw failures disrupted entry; `AdminVideoDateTimelinePanel.tsx` reads results.
- **Why a candidate:** investigative telemetry permanently embedded in the most failure-sensitive path; it has already required two rounds of fail-soft armor.
- **Status:** active. **Owner:** mixed. **Risk:** medium — operator latency dashboards consume it; the data was load-bearing in past session forensics. **Recommendation:** keep until a clean acceptance run, then demote to client-side analytics (PostHog) or sampled-only.

### J. Ready Gate entry-proof ledger
- **Current behavior:** `record_video_date_ready_gate_entered_v1` + append-only `video_date_ready_gate_entries` + per-platform `readyGateEntryProof.ts`. Added (migration `20260607183000`) to prove "both users actually entered the gate" during the failure investigations. Not pure telemetry: first entry can extend the active gate to ≥45s from client mount.
- **Status:** active, behavior-bearing. **Owner:** mixed. **Risk:** medium (removing changes gate timing). **Recommendation:** decision needed (§7) — if the 45s extension is wanted product behavior, move it into `video_session_mark_ready_v2`/gate creation and drop the ledger; if not, remove both after acceptance.

### K. Legacy deep-link query param `pendingMatch`
- **Current behavior:** web lobby accepts `pendingVideoSession` **and** legacy `pendingMatch` (`src/pages/EventLobby.tsx:953–957`).
- **Status:** compat shell; producers of the legacy name are gone with the queue/notification rescue removals. **Risk:** trivial (verify no live push payload still emits `pendingMatch` — check `send-notification` payload builders before deleting). **Value:** small.

### L. Outbox drainer kind aliases
- **Current behavior:** `video-date-outbox-drainer/index.ts:771–785` accepts three names per command (`daily.ensure_video_date_room` | `daily.ensure_room` | `ensure_video_date_room`; same for delete; `notification.send` | `push.send`).
- **Status:** active compat. **Owner:** server. **Risk:** low — verify via live `video_date_provider_outbox` rows which kinds are actually enqueued by current producers, then collapse to one canonical kind per command. **Value:** small but cheap.

### M. Daily pool / keepwarm remnants
- **Current behavior:** cron `daily-room-keepwarm` pings `daily-room` every 5 minutes (`20260505214500…sql:279-310`); view `vw_video_date_daily_pool_decision` and flag `video_date.daily_pool_v2` (zero client readers) survive from the Phase 7 pool experiment.
- **Status:** keepwarm active (cold-start mitigation — likely keep); pool decision view + flag likely inert. **Risk:** low for view/flag after live verification; keepwarm removal would need cold-start latency evidence. **Value:** small.

### N. Web/native structural divergence (size, not features)
- Native standalone ready host is 2,158 lines vs web's 279; native date screen is 13,524 lines vs web 6,792+8,034 split. Not a removal target, but each future removal above should land on both platforms in the same PR to stop the gap growing.

---

## 5. Top 5 Recommended Removals

### #1 — Collapse post-date verdict to v3-only
- **Scope:** clients (web+native PostDateSurvey, both `postDateOutbox/execute.ts`, `apps/mobile/lib/videoDateApi.ts`), Edge `post-date-verdict`, DB RPCs.
- **Remove:** flag-conditional `backendVersion` selection (always v3); `transition_version` plumbing; Edge dispatch branches to `_v2` and keyless v1; later RPCs `submit_post_date_verdict` + `submit_post_date_verdict_v2` (+ their base) from the catalog; flag row `video_date.outbox_v2.submit_verdict` and its key in `videoDateV4Flags.ts`.
- **Preserve:** `submit_post_date_verdict_v3` semantics exactly (idempotency key mandatory, safety-report payload, verdict-confirmation read-back of the actor's `date_feedback` row); `update_post_date_feedback_details`; `submit_post_date_safety_report_v1`.
- **Sequence:** (1) verify flag state + 14-day call distribution of v1/v2/v3 in production (live SQL / Edge logs); (2) client PR: hard-code v3; (3) Edge PR: map any incoming `v2`/keyless request to v3 with a `deprecated_version_coerced` log (grace for stale apps); (4) after a release boundary, migration drops v1/v2.
- **Migrations:** yes (step 4 only). **Edge deploy:** yes (`post-date-verdict`). **Types impact:** regen after step 4 (two functions disappear).
- **Docs/tests:** update command center + `postDateOutbox.test.ts`, `videoDateSurveyFeedbackDrainGuard.test.ts`, add v1/v2 absence contract.
- **Rollback risk:** low — v3 is already the flag-on path; Edge coercion step is reversible.
- **Acceptance criteria:** both platforms submit verdicts with no `transition_version` branch; live catalog shows only `_v3`; a two-user run persists both `date_feedback` rows.
- **Smoke/regression:** `npm run test:video-date-v4`, red-flags suite, fresh disposable two-user run through survey.

### #2 — Finish the queued-vocabulary purge (the documented #1282 follow-up)
- **Scope:** DB schema + shared parsers + native readyGateApi + operator views.
- **Remove:** `video_sessions.queued_expires_at`; `'queued'` from `ready_gate_status`/`queue_status` allowed values; `p_queued_expires_at` from `video_session_blocks_global_active_conflict` (signature change + all callers in live function bodies); client `queued` branches (`videoDateSnapshot.ts` — change the default fallback phase to something honest like `"unknown"`, `videoDateRouteDecision.ts`, `videoDateRecoveryAdvisor.ts`, `readyGateReadiness.ts`, `videoDateTimeline.ts`, `src/domain/enums.ts`, `apps/mobile/lib/readyGateApi.ts`); queue-fairness views + `get_video_date_queue_fairness_health` + their reads in `videoDateOperatorMetrics.ts` / `admin-video-date-ops`; `v_event_loop_drain_events` / `v_event_loop_drain_outcomes_hourly` if live inspection confirms no dashboard consumer.
- **Preserve:** `video_session_blocks_global_active_conflict` behavior for all real states; busy-user deck filtering; `swipe_recovery` operator metrics.
- **Sequence:** (1) read-only live sweep proving zero rows with `'queued'` anywhere; (2) one forward migration (column drop, constraint tightening, guard-signature change, view drops) — review SQL carefully per repo rules; (3) `npm run regen:supabase-types`; (4) client/shared branch removal in the same branch; (5) update validation SQL.
- **Migrations:** yes. **Edge deploy:** yes (`admin-video-date-ops` loses fairness reads). **Types impact:** yes (column, arg, enum-ish unions).
- **Docs/tests:** extend `matchQueueSourceRemovalContracts.test.ts`; update `event_lobby_ready_queue_contract.sql`; command-center entry.
- **Rollback risk:** medium (signature change); mitigated by the zero-row proof and dry-run.
- **Acceptance criteria:** `rg -i "queued"` over active video-date source returns only the unrelated chat/media outbox states; generated types contain no `queued_expires_at` / `p_queued_expires_at`.
- **Smoke/regression:** `test:event-lobby-regression`, `test:video-date-v4`, `supabase db lint --linked`, dry-run; two-user swipe→match smoke.

### #3 — Delete the web dual-hydration / shadow-context experiment
- **Scope:** web only.
- **Remove:** `isActiveSessionSingleOwnerEnabled` + `isActiveSessionContextShadowEnabled` from `src/lib/runtimeFlags.ts`; the `useEventActiveSession`/`SessionHydrationContext` opt-in branch in `EventLobby.tsx:394–406`; shadow instrumentation inside `useActiveSession.ts`; `src/contexts/SessionHydrationContext.tsx` if nothing else consumes it.
- **Preserve:** the legacy `useActiveSession` path as the single hydration owner (it is today's production behavior — this PR changes nothing at runtime defaults).
- **Sequence:** single client PR; confirm no e2e/env config sets `VITE_ACTIVE_SESSION_SINGLE_OWNER`.
- **Migrations:** no. **Edge deploy:** no. **Types impact:** none.
- **Docs/tests:** update `realtimeSubscriptionTightening.test.ts` and any shadow contracts; note in command center that the provider-context consolidation, if still wanted, becomes a deliberate future project with its own verification.
- **Rollback risk:** very low (deleting a default-off branch).
- **Acceptance criteria:** one hydration code path in the lobby; `rg "SINGLE_OWNER|ContextShadow" src` → zero.
- **Smoke/regression:** lobby regression suite + manual web lobby→Ready Gate→date smoke.

### #4 — Purge the client flag list and alias machinery
- **Scope:** shared + clients (server flag rows untouched in this PR).
- **Remove:** the 8 server-only keys from `VIDEO_DATE_V4_CLIENT_FEATURE_FLAGS`; the 4 alias keys + `VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS` + `featureFlagAliasResolution.ts` dual-read (after flipping the 4 consumers to canonical keys only); post-#1 the `outbox_v2.submit_verdict` key.
- **Preserve:** genuinely client-read flags (`snapshot_v2`, `readiness_v2`, `timeline_v2`, `broadcast_v2`, the remaining `outbox_v2.*` transition flags until their own retirements); all DB-side flag rows and reads (separate, later: inline proven-on server branches per-flag with live `pg_get_functiondef` evidence).
- **Sequence:** client PR; verify each removed key has zero `useFeatureFlag` consumers at merge time.
- **Migrations:** none now (flag-row deletes come later with the server-branch inlining). **Edge deploy:** no. **Types:** none.
- **Docs/tests:** `clientFeatureFlagsContracts.test.ts` rewrite documenting the now-explicit client/server flag split.
- **Rollback risk:** very low.
- **Acceptance criteria:** every key in the client list has ≥1 active client reader; no alias resolution at runtime.
- **Smoke/regression:** typecheck/lint + video-date suites.

### #5 — Flatten the base-function onion, one RPC family at a time (post-acceptance)
- **Scope:** backend catalog only; start with the family that has the most dead layers after live mapping (likely `video_date_transition`, 21 generations).
- **Remove:** all superseded generations of one family per migration, after inlining the effective behavior into a single public shell + (at most) one service base.
- **Preserve:** exact current public shell semantics — no-throw JSON contracts, sanitized payloads, terminal/fail-soft behavior, grants.
- **Sequence per family:** (1) live `pg_get_functiondef` capture of the whole chain from the public shell down; (2) write the flattened definition; (3) migration: `CREATE OR REPLACE` shell + `DROP FUNCTION` superseded generations; (4) validation SQL asserting exactly the surviving functions; (5) `regen:supabase-types`; (6) linked lint + dry-run + error-level advisors.
- **Migrations:** yes (one per family). **Edge deploy:** no (RPC names unchanged). **Types impact:** large reduction (dozens of entries disappear).
- **Docs/tests:** command-center entry per family; keep behavior contracts (`videoDateActiveEntryFailsoftShellContracts`, `videoDateLifecycleRpcFailsoft`) green unchanged — they assert behavior, not layer count.
- **Rollback risk:** medium-high; this is why it is gated behind a successful two-user acceptance run and done family-by-family with immutable forward migrations.
- **Acceptance criteria:** per family — one public shell, ≤1 base, zero `_20260*` leftovers in types; all fail-soft contracts pass; fresh two-user run unchanged.
- **Smoke/regression:** full `test:video-date-v4`, red-flags, invariants (`check:video-date:invariants -- --warn-as-error`), linked verification, two-user run after the first family (transition) lands.

Deliberately **not** in the top 5: handshake→entry Phase D/E. It is already planned, sequenced, and gated on a two-user verification window (`handshake-to-entry-audit.md`); it should follow #5's first family or ride the same verification window, and the `post_date` enum drop (§4.G) should be folded into its enum rebuild.

---

## 6. Do Not Remove Yet

These look like complexity but currently protect the golden flow; each is tied to a specific production failure class documented in the command center:

- **No-throw public shells / sanitized fail-soft payloads** on the hot RPCs — they closed the raw-500 remount-storm class. Flattening (#5) preserves them; never strip them.
- **`finalize_video_date_handshake_deadline` + `expire_due_joined_video_date_handshakes_bounded` + cron `video-date-deadline-finalizer`** — fallback rescue for the handshake-deadline class; the entry-remount-storm investigation (P0) ended in `handshake_deadline_timeout` without it.
- **Stable bilateral media gate + `video_date_presence_events` + `video_date_surface_claims`/claim events** — server-owned date promotion truth; removing any leg reopens the false-positive "date started" class.
- **Provider-bound remote-seen proof requirements** (owner/call/provider identity) — closed session `34ed864c`'s class.
- **Prepare-entry lease + routeable both_ready protection (`video_date_protect_both_ready_entry_v1`)** — closed session `916f8ed7`'s stranded-Ready-Gate class.
- **`video-date-outbox-drainer` + `_shared/video-date-provider-reliability.ts` + dead-letter/rate-limit tables** — async Daily-provider work and notification delivery with retry/lease semantics; load-bearing.
- **Cleanup/ops crons** (`video-date-room-cleanup`, `video-date-orphan-room-cleanup`, `expire-stale-video-sessions`, `expire-video-date-reconnect-graces`) — bounded sweepers preventing orphaned rooms/sessions.
- **Post-date reminder subsystems** (`post-date-verdict-reminders`, `post_date_zero_feedback_reminders`, half-verdict timeout detection) — they enforce the `date_feedback` completion bar the product is measured on.
- **`synthetic-video-date-monitor` + `video-date-recovery-alert-dispatcher`** — the operator's early-warning system while acceptance is still unproven.
- **Ready Gate realtime supervisor / broadcast gap recovery / convergence scheduling** — realtime resilience for the gate countdown.
- **`video-date-token-refresh`** — active mid-date token expiry path (`daily_token_refresh_v2` is client-read).
- **Certification exception ledger (`video_date_certification_feedback_exceptions`)** — operator-only, explicitly excluded from runtime routing.
- **Web same-session Daily remount parking / native `preserve_active_handoff`** — closed session `690f917e`'s active-owner-destruction class.

---

## 7. Ambiguities / Decisions Needed

1. **Verdict v2 grace window (for #1):** how long must the Edge coerce v2→v3 for stale native binaries? Needs install-base data (RevenueCat/store analytics) or a forced-update policy decision.
2. **Single-owner hydration (for #3):** confirm the provider-context consolidation is abandoned (delete) rather than paused (finish). This audit recommends delete-now, re-propose later as its own project.
3. **Ready Gate entry-proof ledger (§4.J):** is the ≥45s first-entry gate extension wanted product behavior? If yes, relocate into the gate lifecycle and drop the ledger; if no, remove both. Needs product sign-off.
4. **Operator dashboard dependencies:** who (if anyone) consumes `stuck_handshake_count`, the queue-fairness views, `v_event_loop_drain_*`, and the launch-latency timeline panel? If no live dashboard reads them, #2 can include the view drops and §4.I can be demoted sooner.
5. **Phase D enum strategy:** atomic `ALTER TYPE … RENAME VALUE` vs additive add/retire (documented trade-off in `handshake-to-entry-audit.md` §1a), and whether `post_date` is dropped in the same rebuild.
6. **Server flag-row inlining (#4 follow-up):** for each of the 8 server-read flags, decide proven-on vs proven-off from the live catalog and production data, then inline. Requires per-flag `pg_get_functiondef` evidence; do not delete rows before that.
7. **Snapshot read consolidation (out of top 5 but real):** two parallel snapshot paths (`get_video_date_start_snapshot_v1` RPC vs `video-date-snapshot` Edge) serve overlapping route-truth needs across 22 consumer files. The lean-runtime-contract doc deferred this; decide whether `videoDateLeanRuntimeContract.ts` (§4.H) becomes the consolidation vehicle or is deleted.

---

## 8. Recommended PR Sequence

Safest aggressive order; one domain per PR per AGENTS.md; each PR carries its own branch delta + command-center entry:

1. **PR-1 (client):** delete web dual-hydration/shadow experiment (#3). No runtime behavior change; immediately de-risks lobby work.
2. **PR-2 (client+shared):** flag list + alias machinery purge (#4). Pure client; shrinks the decision surface for everything after.
3. **PR-3 (client):** verdict v3 hard-coding on web+native (#1 steps 1–2), plus `pendingMatch` param removal (§4.K) if `send-notification` payload check confirms no producer.
4. **PR-4 (Edge):** `post-date-verdict` v2→v3 coercion + deprecation logging (#1 step 3). Single Edge deploy.
5. **PR-5 (backend migration):** queued-vocabulary purge (#2) — migration + types regen + shared/client branch deletion + validation updates. First Supabase-cloud change of the sequence; verify linked project against `supabase/config.toml` first.
6. **PR-6 (backend migration, after release boundary from PR-4):** drop `submit_post_date_verdict` v1/v2 (+ base) (#1 step 4); regen types.
7. **— Acceptance gate —** run the fresh disposable two-user production flow (per `docs/fresh-smoke-proof-bootstrap.md` rules) and record it in the command center. PRs 1–6 do not require it to merge (behavior-preserving), but PRs 7+ must not start without it.
8. **PR-7+ (backend, one family each):** base-function onion flattening (#5), starting with `video_date_transition`, then `handle_swipe`, `ready_gate_transition`, `video_session_mark_ready_v2`, the Daily evidence RPCs, launch-latency.
9. **PR-N (cross-stack, own verification window):** handshake→entry Phase D (enum/phase flip + Edge migration + `post_date` drop) then Phase E (retire mirrors, wrapper RPCs, action aliases, `ENTER_HANDSHAKE_REMOVED` tombstone, `outbox_v2.continue_handshake` flag rename, `videoDateHandshakePersistence.ts` rename, validation/test sweep).
10. **PR-final (telemetry demotion, post-acceptance):** launch-latency checkpoint demotion (§4.I) and entry-proof ledger decision (§4.J) per product sign-off.

### Verification expectations (every PR above)
- `npm run typecheck`, `npm run lint`
- `npm run test:video-date-v4`, `npm run test:video-date:red-flags`, `npm run test:event-lobby-regression`
- Backend PRs additionally: `supabase migration list --linked`, `supabase db push --linked --dry-run`, `supabase db lint --linked --schema public --fail-on error`, error-level advisors, live `pg_get_functiondef` capture before/after
- Source-scope proofs: `rg` absence sweeps mirroring §3's evidence column
- **No Video Date acceptance claim from any of the above.** Acceptance only via the fresh two-user run through both persisted `date_feedback` rows.

### Audit-time verification of this report
- Repo state: `git rev-parse HEAD` = `449558f86…`, `git status --short` clean.
- All scope claims above were produced from `rg` sweeps over `src/`, `apps/mobile/`, `shared/`, `supabase/functions/`, `supabase/validation/`, and the generated `src/integrations/supabase/types.ts` at this commit; per-candidate file:line citations are in §4.
- `npm run typecheck` was started at audit time as tree-health evidence (result recorded by the session, not as any product claim).
- Cloud state was **not** mutated and not independently re-verified in this pass; treat "applied through `20260610130000`" as documented, to be re-confirmed with read-only `supabase migration list --linked` before PR-5.
