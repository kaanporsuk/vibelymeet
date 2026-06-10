# Video Date Simplification — Top-5 Execution Pass

Date: 2026-06-10
Branch: `claude/video-date-simplification-top5`
Source audit: `docs/audits/video-date-next-simplification-candidates-2026-06-10.md`

## Scope

Executes the audit's Top-5 removals #1–#4 in full plus the part-(a) legacy sweeps, scoped to Video Date only. #5 (base-function onion flattening) and the heavy backend half of #2 stay gated (see "Deferred" below) per the audit's acceptance-run boundary.

Golden flow preserved and unchanged: Event Lobby -> pass/vibe -> immediate mutual match -> Ready Gate -> both ready -> one `prepare_date_entry`/`prepare_entry` -> `/date/:sessionId` -> decision period -> post-date survey -> persisted `date_feedback` -> return.

## 1. Verdict path collapsed to v3 (audit #1)

- Web/native `PostDateSurvey` and `apps/mobile/lib/videoDateApi.ts` no longer read `video_date.outbox_v2.submit_verdict` or select a verdict version; the `SubmitVerdictOptions`/`submitVerdictV3` plumbing and `backendVersion` payload field (`shared/postDateOutbox/types.ts`) are removed.
- Both outbox executors (`src/lib/postDateOutbox/execute.ts`, `apps/mobile/lib/postDateOutbox/execute.ts`) always send `transition_version: "v3"`. Pre-update queued outbox items that still carry a stored `backendVersion` are simply ignored (executors no longer read it).
- `supabase/functions/post-date-verdict/index.ts` now has a single verdict RPC path: `submit_post_date_verdict_v3`. Stale clients sending `"v2"` or keyless requests are coerced onto v3 (keyless callers get a deterministic `stableUuidFromParts([userId, sessionId, "verdict-legacy-keyless"])` idempotency key) with a `deprecated_version_coerced_to_v3` lifecycle log.
- **Live precondition verified before hard-coding:** `video_date.outbox_v2.submit_verdict` is `enabled = true` on linked project `schdyxcunwcvddlcshwd`, so v3 was already the production behavior; this change removes the dormant v2/v1 branches, not live behavior.
- **Not done yet (deliberate):** dropping RPCs `submit_post_date_verdict` / `submit_post_date_verdict_v2` (+ remote-seen base) and deleting the flag row. That follows after the updated `post-date-verdict` Edge Function is deployed and a release boundary passes (audit PR-6).

## 2. Client flag list + alias machinery purged (audit #4)

- `shared/featureFlags/videoDateV4Flags.ts` now declares only flags with real client readers (23 keys). Removed from the client list: 8 server-read-only rollout keys (`deck_deal_v2`, `broadcast_batched_v2`, `outbox_lease_refresh_v2`, `deadline_partial_unique_v2`, `orphan_safety_interlock_v2`, `circuit_breaker_v2`, `daily_webhooks_v2`, `daily_pool_v2`), 4 retired v1 alias keys (`ready_gate_resilient_clock_v1`, `push_open_dedupe_v1`, `verdict_confirm_v1`, `deck_optimistic_v1`), and `outbox_v2.submit_verdict` (hard-coded v3 above).
- Deleted `shared/featureFlags/featureFlagAliasResolution.ts` and `VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS`; all five dual-read sites now read the canonical flag's `.enabled` directly (`src/hooks/useReadyGate.ts`, `apps/mobile/lib/readyGateApi.ts`, web/native lobby deck-polish, `apps/mobile/components/NotificationDeepLinkHandler.tsx`, web/native PostDateSurvey via single-arg `isVideoDateVerdictConfirmEnabled`). `isReadyGateResilientClockEnabled`/`isReadyGateResilientBroadcastEnabled` lost their `aliasEnabled` parameter.
- All affected canonical v2 flags were verified `enabled = true` in production before alias removal — behavior-preserving.
- **DB flag rows are untouched.** Deleting rows / inlining server-side flag branches needs per-flag live `pg_get_functiondef` evidence (audit decision #6).

## 3. Web dual-hydration / shadow-context experiment removed (audit #3)

- `src/pages/EventLobby.tsx` has one hydration owner: `useActiveSession(user?.id, { eventId })`. The default-false `isActiveSessionSingleOwnerEnabled` / `isActiveSessionContextShadowEnabled` runtime flags are deleted from `src/lib/runtimeFlags.ts`, the opt-in `useEventActiveSession` helper is removed from `src/contexts/SessionHydrationContext.tsx`, and the shadow-compare instrumentation (types, helpers, ref, effect, `get_active_session_context` shadow RPC call) is removed from `src/hooks/useActiveSession.ts`.
- `SessionHydrationProvider`/`useSessionHydration` are **kept** — they are live app-shell infrastructure (App, Dashboard, SessionRouteHydration), not part of the experiment.
- The `get_active_session_context` DB function (additive, read-only) remains in the catalog; only its unused web shadow caller is gone.
- Production behavior unchanged: the deleted branch was opt-in via env/localStorage and defaulted off.

## 4. Part-(a) legacy sweeps

- **Legacy deep-link param `pendingMatch`** removed from web (`src/pages/EventLobby.tsx`) and native (`apps/mobile/app/event/[eventId]/lobby.tsx`) consumers. Verified zero producers anywhere in source (notification builders only emit `pendingVideoSession`).
- **`shared/matching/videoDateLeanRuntimeContract.ts` deleted** (plus its test and the `test:video-date-v4` wiring). It had zero active client consumers — an unconsumed parallel state model. `docs/contracts/video-date-lean-runtime-contract.md` is now a tombstone.
- **Outbox drainer kind aliases removed** (`supabase/functions/video-date-outbox-drainer/index.ts`): only canonical `daily.ensure_video_date_room`, `daily.delete_video_date_room`, `notification.send` are dispatched. Verified all producers enqueue canonical kinds and the live outbox contains only `notification.send` rows. Unknown kinds still dead-letter with `unsupported_outbox_kind`.

## 5. Dead drain operator views dropped (safe slice of audit #2)

- Forward migration `supabase/migrations/20260610182520_remove_dead_event_loop_drain_views.sql` drops `v_event_loop_drain_outcomes_hourly` and `v_event_loop_drain_events` — observability over the removed drain/promotion subsystem. Live pre-checks: zero pg_depend dependents, zero repo readers. **Applied to linked cloud**; post-apply dry-run returns "Remote database is up to date". Generated types regenerated via `npm run regen:supabase-types` (−56 lines, exactly the two views).

## Deferred (explicitly, with reasons)

- **Audit #5 (base-function onion flattening)** and the **physical queued purge** (`video_sessions.queued_expires_at` drop, `p_queued_expires_at` signature change): live catalog shows 15 functions still referencing `queued_expires_at`, including the `enforce_one_active_video_session` trigger that runs on every session write. Dropping the column requires rewriting those bodies from live `pg_get_functiondef` in one migration — the same risk class as onion flattening. Gated behind a successful two-user acceptance run.
- **Queue-fairness views**: live `pg_depend` shows 26 dependents on `v_video_date_queue_fairness_candidates` (more entangled than the audit assumed); folded into the deferred backend pass.
- **Client `'queued'` placeholder vocabulary**: live inspection shows `ReadyGateStatus.Queued` / `'queued'` in `useReadyGate`/`readyGateApi`/route-decision is the client-side *pre-hydration placeholder state*, not dead parsing of removed server values. Renaming the placeholder is a behavior-adjacent Ready Gate refactor and joins the deferred queued purge.
- **Verdict v1/v2 RPC drop + flag-row delete** — after Edge deploy + release boundary (audit PR-6).
- **handshake→entry Phase D/E** — unchanged, separately gated.

## Follow-up deploys — COMPLETED 2026-06-10 (close-out after merge)

PR #1286 squash-merged to `main` as `93e73c9948bf2ffb3bb40327b9139b91e16290b1` with all CI checks green; the feature branch was deleted locally and remotely. Both changed Edge Functions were then deployed to project `schdyxcunwcvddlcshwd`:

- `post-date-verdict` → active version `600`, updated 2026-06-10 18:51:03 UTC (v3 coercion + single RPC path)
- `video-date-outbox-drainer` → active version `47`, updated 2026-06-10 18:52:33 UTC (canonical kinds only)

Post-deploy alignment evidence: `supabase migration list --linked` shows local == remote through `20260610182520`; `supabase db push --linked --dry-run` returns "Remote database is up to date"; `npm run regen:supabase-types` reproduces the committed generated types byte-identically; parent workspace gitlink committed at the merge commit. The verdict v1/v2 RPC drop can now proceed after a release boundary (audit PR-6).

## Tests / contracts updated

`scripts/request-reduction-contract.test.ts` (single hydration owner), `shared/featureFlags/clientFeatureFlagsContracts.test.ts` (client/server flag split + alias retirement), `videoDatePhase0Contracts`, `videoDatePhase5HardenedOutboxCleanupContracts`, `readyGateOrchestratorContracts`, `videoDateClosureIssuesContracts`, `videoDateInstantPremiumV2Contracts`, `videoDatePhase3RemainingContracts` (v3-only outbox), `videoDatePhase4TokenPushDedupContracts`, `videoDatePushOpenDedupePreloadContracts`, `videoDateVerdictConfirmationContracts`; deleted `videoDateLeanRuntimeContract.test.ts` and its `package.json` wiring. Migration-pinning assertions on historical migrations were intentionally left untouched.

## Verification

- Live read-only pre-checks against linked `schdyxcunwcvddlcshwd` (management API): zero `'queued'` rows; flag states; outbox kinds; view dependents; function references.
- `npm run typecheck`, `npm run lint`, `npm run test:video-date:red-flags`, `npm run test:event-lobby-regression`, `npm run test:video-date-v4` — results recorded in the command center entry for this pass.
- `supabase db push --linked --dry-run` before and after apply; post-apply: "Remote database is up to date".

## Proof boundary

This is a behavior-preserving simplification pass, not Video Date product acceptance. The acceptance bar remains a fresh disposable two-user production run: mutual swipe -> Ready Gate -> both ready -> one `prepare_date_entry` -> `/date/:sessionId` -> decision period -> post-date survey -> persisted `date_feedback` for both users.
