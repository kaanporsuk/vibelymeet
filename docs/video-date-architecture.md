# Video Date Architecture (post-rebuild)

Date: 2026-06-12 (rebuild PR 10). This is the single current architecture doc for
Vibely Video Date after the 2026-06 staged re-foundation (rebuild PRs 1–9).
Superseded narratives live under `docs/archive/video-date/`; operations live in
`docs/video-date-runbook.md`.

## Scope boundary

Video Date STARTS where a mutual swipe creates/returns a Ready Gate
`video_sessions` row and ENDS at persisted `date_feedback` plus post-survey
next-surface navigation. Deck/swipe internals, event registration, payments,
chat, and profile browse are adjacent systems, not part of this flow.
`public.event_registrations.queue_status` (text, default `'idle'`, CHECK
`valid_queue_status`, allows `'in_survey'`) is survey-route continuity owned by
this flow — never remove it.

## Ownership model

- **The server owns session truth.** `public.video_sessions` is the only state
  machine: `ready` → `both_ready` → entry → `date` → ended/survey. Clients render
  truth and submit evidence; they never decide transitions. One active session
  per user is enforced by the `enforce_one_active_video_session` trigger.
- **The `daily-room` Edge Function is the sole Daily room/token minter.**
  `prepare_date_entry` runs: actionability precheck
  (`video_date_ready_gate_actionability_v1`) → prepare-lease protection
  (`video_date_protect_both_ready_entry_v1`, 90s lease on a virgin `both_ready`
  gate) → deterministic room creation → `confirm_video_date_entry_prepared` →
  meeting token. No other surface mints rooms or tokens
  (`video-date-token-refresh` refreshes tokens for an existing room behind both
  rate limiters).
- **Entry → date promotion is evidence-gated.** Promotion requires
  provider-proofed remote-seen (`mark_video_date_remote_seen` demands current
  owner/call/provider identity plus render-bound media evidence) or the stable
  bilateral media gate (durable heartbeat-backed copresence). Promotion runs
  through the evidence single bodies `video_date_promote_confirmed_encounter_v1`
  / `video_date_promote_provider_overlap_v1`. Pre-stable provider absence
  downgrades to `pre_stable_media_failed` with `survey_required = false`.
- **The Daily webhook ledger is provider truth.** `video-date-daily-webhook`
  appends to `video_date_daily_webhook_events`; joined/absence reconciliation
  and copresence checks read provider participant/session ids from the ledger,
  not client claims. Since 2026-06-12 the function also materializes Daily's
  nested `payload.payload.session_id` into `provider_participant_id`,
  mirroring the tail of `video_date_daily_provider_session_id_from_event_v1`
  (which already COALESCEd the column with that payload key — additive, not
  behavior-changing; webhook fn v40).
- **Post-date is durable and idempotent.** Web and native enqueue verdicts into
  a durable outbox and send `transition_version: 'v3'` plus an idempotency key
  through the `post-date-verdict` Edge Function, which calls only
  `submit_post_date_verdict_v3`. The survey UI confirms the actor's own
  `date_feedback` row before advancing. Survey eligibility is
  `video_date_session_is_post_date_survey_eligible_v2` (confirmed encounter;
  v1 dropped 2026-06-12, all six callers on v2).

## Backend RPC layer (rebuilt 2026-06)

The 2026-06 rebuild collapsed the generational wrapper onions into single
self-contained bodies, pinned against live-catalog fixtures:

| Surface | Canonical RPC(s) | Single-body migration |
|---|---|---|
| Lifecycle transitions | `video_date_transition(uuid, text, text)` | `20260611175511_video_date_transition_single_body.sql` |
| Evidence + promotion | `mark_video_date_daily_alive`, `mark_video_date_daily_joined`, `mark_video_date_remote_seen`, `claim_video_date_surface`, promote bodies | `20260611190852_video_date_evidence_single_bodies.sql` |
| Ready Gate | `ready_gate_transition`, `video_session_mark_ready_v2` | `20260611201927_video_date_ready_gate_single_bodies.sql` |
| Entry vocabulary + maintenance | entry-named actions/columns (`complete_entry`, `continue_entry`, `entry_started_at`, …) | `20260611215259_video_date_entry_vocab_flip_maintenance_single_bodies.sql` |
| Frozen v2 family dropped | `video_session_continue_entry_v2`, `video_session_entry_auto_promote_v2`, `video_session_date_timeout_v2`, `video_session_forfeit_v2` removed | `20260612134101_vd_rebuild_pr8_drop_frozen_v2_transition_rpcs.sql` |

The 2026-06-12 acceptance-run follow-up (migration
`20260612211818_vd_accept_followup_transition_survey_feedback_guard.sql`)
feedback-guards `video_date_transition`'s terminal in_survey re-stamp: the pair
is stamped only while at least one participant still lacks a `date_feedback`
row (same guard semantics as `mark_video_date_remote_seen`); once both rows
exist the branch releases instead (observability reason
`terminal_survey_already_complete`), so revisiting a dead session can no longer
re-open the partner's survey state. Clients close the loop for stale stamps:
web/native terminal recovery releases a feedback-complete registration through
`update_participant_status` before navigating away, and both lobbies damp
same-session forced-survey re-navigation (10s window).

The round-2 follow-up (2026-06-12, migrations `20260612221535`–`20260612221538`)
tightened the same surfaces: survey stamping is now per-participant (a user
whose own `date_feedback` row exists is never re-stamped `in_survey`, even
while the partner is incomplete — guard in both `video_date_transition` stamp
sites and `mark_video_date_remote_seen`); `update_participant_status` clears
`current_room_id`/`current_partner_id` when releasing onto a terminal session
(no dangling room pointers); historical webhook ledger rows were backfilled
with `provider_participant_id` via the canonical extractor; and
`mark_lobby_foreground` records reason `lobby_foreground_stamped` (the
vestigial queue-era reason retired).

Contract truth for this layer is pinned by
`shared/matching/videoDateBackendTruthPinContracts.test.ts` against raw
`pg_get_functiondef()` fixtures in `supabase/contract-fixtures/2026-06/`, plus
the three `*SingleBodyContracts` suites and
`shared/matching/videoDateAcceptFollowupContracts.test.ts` (terminal-stamp
guard, client release/damper, webhook provider-id mapping, benign-failure alert
classification, lobby-foreground throttle). Lifecycle RPCs stay outermost
fail-soft: stale/duplicate/terminal calls return sanitized retryable JSON, never
raw 500s.

Ready Gate hot paths keep the convoy hardening: `ALTER ROLE authenticated SET
statement_timeout = '15s'` plus NOWAIT row claims
(`20260610201512_video_date_ready_gate_convoy_hardening.sql`; pinned in
`readyGateEntryProofRemovalContracts` + `readyGate57014ReliabilityContracts`).
Mark-ready is a decisive direct commit with a deterministic idempotency key;
Ready Gate mount telemetry must never mutate the session row.

## Durable side-effects: outbox + crons

`video_date_provider_outbox` is the transactional outbox. DB writes enqueue;
the minutely `video-date-outbox-drainer` Edge Function drains exactly three
kinds: `daily.ensure_video_date_room`, `daily.delete_video_date_room`,
`notification.send`. Concurrency safety is per-row claim/lease RPCs
(`claim_video_date_provider_outbox_v2`, `refresh_video_date_provider_outbox_claim_v1`);
the deadline lane uses `claim_video_session_deadlines_v2` /
`refresh_video_session_deadline_claim_v1` from `video-date-deadline-finalizer`.
There is no worker-run mutex layer (dropped in PR 9). The full cron set is in
the runbook.

Daily room deletion outside the outbox has one owner: `video-date-room-cleanup`
runs the session pass every minute and, marker-gated to a 10-minute cadence
(`reconciliation_run` rows in `video_date_orphan_room_cleanup_audit`), the
provider-reconciliation pass transplanted from the orphan lane (cron-merge
stage 1, 2026-06-13; `reconciliation.ts` beside the function entrypoint). The
legacy `video-date-orphan-room-cleanup` lane remains only for the stage-2
observation window. Contract suite:
`shared/matching/videoDateRoomCleanupReconciliationContracts.test.ts`.

## Realtime

Session updates broadcast over private per-session topics via DB-triggered
Realtime Broadcast; clients subscribe with session-scoped authorization. RLS
posture and the private broadcast topics were preserved exactly through the
rebuild; the runtime proofs are
`videoDateRealtimeRlsRuntime` / `videoDatePublicApiRlsRuntime` /
`videoDateLifecycleRpcPostgrestRuntime` (env-gated) and the static posture pack
`videoDatePhase5RlsContracts`.

## Client controller (shared, ported to web + native)

`shared/videoDate/` is the platform-agnostic session controller (pure TS — no
React, no supabase-js):

- `types.ts` — controller vocabulary: phases (`hydrate`, `ready_gate`,
  `preparing_entry`, `joining`, `entry`, `date`, `reconnecting`,
  `parked_remount`, `ending`, `survey_required`, `done`), normalized Daily
  adapter events, timer events.
- `routeDecision.ts` — single owner of surface/route dominance (active session
  including `queue_status = 'in_survey'` owns `/date/:sessionId`; lobby and
  Ready Gate yield).
- `navigationIntents.ts` — explicit navigation intents instead of ad-hoc
  router calls.
- `sessionController.ts` — the state machine binding session truth + provider
  events + timers to phases and intents.

Web binds it through `src/hooks/useVideoCall.ts` (orchestration body, ~480 LOC)
plus extracted sub-hooks, with `src/pages/VideoDate.tsx` as the stable
single-owner route shell. Native binds the same controller through
`apps/mobile/app/date/[id].tsx` with module-scope split sub-hooks and the
canonical `video_sessions` row projection in
`apps/mobile/lib/videoDateSessionRow.ts`. The date-route guard decision is
shared (canonical, not advisory) across both platforms. Parity is pinned by
`nativeReadyGateParityContract` and the controller unit tests.

## Flow (golden path)

1. **Mutual swipe** (`swipe-actions` Edge) creates/returns a Ready Gate
   `video_sessions` row — direct `ready` creation, no queue.
2. **Ready Gate**: both users mark ready (`video_session_mark_ready_v2`,
   idempotent decisive commit) → `both_ready` with deterministic room metadata.
3. **Prepare entry**: `daily-room` / `prepare_date_entry` (precheck → lease →
   room → confirm → token); prewarm may pre-authenticate but never joins from
   the lobby — the real join is owned by the `/date` route.
4. **Entry**: both clients join Daily; webhook ledger + heartbeats accumulate
   provider proof; clients stamp remote-seen only with render-bound evidence.
5. **Date**: evidence gate promotes to `date` (`date_started_at` stamps).
   Reconnect/parking are controller states; live same-session calls survive
   remount churn; cleanup is destructive only on explicit end/abort/timeout.
6. **End → survey**: terminal truth sets `survey_required` and
   `queue_status = 'in_survey'`; the survey route dominates; verdicts flow
   through the durable outbox → `post-date-verdict` →
   `submit_post_date_verdict_v3`; the client confirms its own `date_feedback`
   row, then navigates to the next surface (`resolve_post_date_next_surface`).
7. **Failure before stable media** → `pre_stable_media_failed`,
   `survey_required = false`, user is released without a survey.

## Contract → test map (the curated battery)

`npm run test:video-date-v4` (every file maps to a live behavior):

| Contract | Test file(s) |
|---|---|
| Daily-room Edge contract | `supabase/functions/daily-room/dailyRoomContracts.test.ts`, `shared/matching/videoDateFailsoftDateRoomRpcs.test.ts` |
| Golden-flow certification | `videoDateGoldenFlowCertificationContracts`, `videoDateGoldenFlowLeanPass` |
| RPC payload truth pins (PR 1, updated through PR 8) | `videoDateBackendTruthPinContracts`, `videoDateTransitionSingleBodyContracts`, `videoDateEvidenceSingleBodyContracts`, `videoDateReadyGateSingleBodyContracts` |
| Ready Gate (incl. 15s statement_timeout pin) | `readyGateDecisiveMarkReadyCommit`, `readyGateMarkReadyActionabilitySafety`, `readyGatePartialReadyDefinitiveClosure`, `bothReadyCanonicalDailyRoomDefinitiveOwner`, `readyGate57014ReliabilityContracts`, `readyGateEntryProofRemovalContracts` |
| Evidence / promotion | `videoDateStrictDailyJoinRemoteSeen`, `videoDateStableBilateralMediaGateContracts`, `videoDateProviderOverlapPromotion` |
| Survey / feedback | `videoDateVerdictConfirmationContracts`, `videoDateSurveyFeedbackDrainGuard`, `videoDateTerminalSurveyLifecycleHardening` |
| RLS (static posture + runtime) | `videoDatePhase5RlsContracts`, `videoDateRealtimeRlsRuntime`, `videoDatePublicApiRlsRuntime`, `videoDateLifecycleRpcPostgrestRuntime` |
| Provider operational QA | `dailyProviderOperationalQa`, `bunnyProviderOperationalQa`, `onesignalProviderOperationalQa` |
| Web/native parity | `nativeReadyGateParityContract` |
| Shared controller | `shared/videoDate/videoDateNavigationIntents.test.ts`, `videoDateSessionController.test.ts`, `videoDateSurfaceRouteDecision.test.ts` |

`npm run test:video-date:red-flags` is the fast subset (ready-gate, evidence,
survey, truth pins, controller). Static tests are never product acceptance —
see the acceptance bar in `docs/video-date-runbook.md`.
