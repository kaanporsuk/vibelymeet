# Vibely Engineering Hygiene Operating Standard

## Context

Vibely is a production social/dating app with Git, Supabase, Edge Functions, native/mobile build config, provider integrations, and product/backend/security-sensitive workflows. The repo must not become an unstructured memory system.

## Core Principle

Main is sacred. Stashes are temporary. Branches need owners and expiry. Broad WIP becomes decision packs. Supabase is verified remotely and non-mutating first. Generated artifacts are cleaned separately. Every squash merge has a cleanup step. Every risky idea becomes a sprint, not a stash.

## 0. Video Date Recovery Documentation Gate

Before touching any Ready Gate, Video Date, Daily.co, event-lobby match handoff, notification outbox, or post-date survey code, start with:

- `docs/video-date-success-command-center.md`
- `docs/active-doc-map.md`
- `AGENTS.md`
- `CODEX.md`
- `CLAUDE.md`

`docs/video-date-success-command-center.md` is the active source of truth for the currently failing Video Date recovery effort. It must capture every material symptom, hypothesis, rejected hypothesis, session ID, migration, deployment, test, manual QA result, and unresolved gap.

Current Video Date implementation top, 2026-06-11: legacy post-date verdict RPC compatibility is removed. Active web/native post-date outboxes send `transition_version: 'v3'` plus idempotency keys through `post-date-verdict`; deployed `post-date-verdict` active version `601` calls only `submit_post_date_verdict_v3` and rejects stale/non-v3 verdict requests with `unsupported_transition_version` and keyless verdict requests with `missing_idempotency_key`. Linked Supabase migrations `20260611094913_remove_legacy_post_date_verdict_rpcs.sql` and `20260611101241_remove_v3_verdict_unused_lint_variable.sql` are applied; the first recreates `submit_post_date_verdict_v3` with the full persistence path inline, then drops `submit_post_date_verdict`, `submit_post_date_verdict_v2`, and `submit_post_date_verdict_20260603090000_remote_seen_base`, while the second lint-cleans the live v3 body without changing the signature. Generated types expose only `submit_post_date_verdict_v3`. This is not Video Date product acceptance; the runtime proof bar remains a fresh two-user run through persisted `date_feedback`.

Previous Video Date simplification baseline, 2026-06-10: the Top-5 simplification pass is merged to `main` (PR #1286, squash `93e73c9948bf2ffb3bb40327b9139b91e16290b1`; docs close-out PR #1287, `57f87dcd7`) and deployed. Post-date verdict submission is v3-only: web/native surveys, `apps/mobile/lib/videoDateApi.ts`, and both post-date outbox executors always send `transition_version: 'v3'` (the `backendVersion`/`submitVerdictV3` plumbing and the `video_date.outbox_v2.submit_verdict` flag read are gone), and `post-date-verdict` (deployed active version `600` at that time) had a single `submit_post_date_verdict_v3` path with temporary stale/keyless v3 coercion. Do not reintroduce `transition_version` selection or `backendVersion`; the later 2026-06-11 cleanup drops the legacy verdict RPCs and removes stale/keyless Edge coercion. The client feature-flag list (`shared/featureFlags/videoDateV4Flags.ts`) is now client-read flags only: 8 server-read rollout keys (`deck_deal_v2`, `broadcast_batched_v2`, `outbox_lease_refresh_v2`, `deadline_partial_unique_v2`, `orphan_safety_interlock_v2`, `circuit_breaker_v2`, `daily_webhooks_v2`, `daily_pool_v2`), the 4 retired v1 alias keys (`ready_gate_resilient_clock_v1`, `push_open_dedupe_v1`, `verdict_confirm_v1`, `deck_optimistic_v1`), and `outbox_v2.submit_verdict` are removed from it, and the alias dual-read helper `shared/featureFlags/featureFlagAliasResolution.ts` plus `VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS` are deleted — clients read the canonical v2 flag's `.enabled` directly. DB `client_feature_flags` rows are untouched (the 8 server-read keys still drive DB functions). The web Event Lobby has a single active-session hydration owner (`useActiveSession`); the default-off single-owner/shadow experiment, its `src/lib/runtimeFlags.ts` flags, the `useEventActiveSession` helper, and the `useActiveSession` shadow-compare instrumentation are removed (`SessionHydrationProvider`/`useSessionHydration` are kept — live app-shell infra). Legacy `pendingMatch` deep-link consumers, the unconsumed `shared/matching/videoDateLeanRuntimeContract.ts` module, and the `video-date-outbox-drainer` kind aliases are removed; `video-date-outbox-drainer` (deployed active version `47`) dispatches only canonical kinds `daily.ensure_video_date_room` / `daily.delete_video_date_room` / `notification.send`. Migration `20260610182520_remove_dead_event_loop_drain_views.sql` (applied) drops the dead `v_event_loop_drain_events` / `v_event_loop_drain_outcomes_hourly` operator views. Branch delta: `docs/branch-deltas/video-date-simplification-top5.md`; source audit: `docs/audits/video-date-next-simplification-candidates-2026-06-10.md`. Deferred with live evidence and gated behind a real two-user acceptance run: the physical queued-vocabulary purge (`video_sessions.queued_expires_at` is still referenced by 15 live functions including the `enforce_one_active_video_session` trigger; client `'queued'` is the Ready Gate pre-hydration placeholder, not dead parsing), the queue-fairness views (26 live dependents), base-function onion flattening, and handshake→entry Phase D/E. This is behavior-preserving simplification, not Video Date product acceptance.

Current Video Date implementation top, 2026-06-09: source and linked Supabase cloud include the stable bilateral media gate, definitive active media ownership, and pre-stable survey eligibility closure through migrations `20260609014410_video_date_stable_bilateral_media_gate.sql`, `20260609022729_video_date_auto_promote_stable_bilateral_media_gate.sql`, `20260609031421_video_date_stable_bilateral_media_one_sided_guard.sql`, `20260609035833_video_date_definitive_active_media_ownership.sql`, and `20260609045533_video_date_pre_stable_survey_eligibility.sql`. The active branch delta is `docs/branch-deltas/fix-video-date-stable-bilateral-media-gate.md`, and the core regression contract is `shared/matching/videoDateStableBilateralMediaGateContracts.test.ts`, wired into both `npm run test:video-date:red-flags` and `npm run test:video-date-v4`.

Current Event Lobby simplification, 2026-06-09: Mystery Match is removed from the active product and backend path. Do not propose restoring web/native parity for it unless the product decision changes. The supported creation path is swipe/direct mutual match into Ready Gate. Verification must show deleted `src/hooks/useMysteryMatch.ts` and `apps/mobile/lib/useMysteryMatch.ts`, zero active source/generated-type hits for `useMysteryMatch`, `find_mystery_match`, `MYSTERY_MATCH`, `Mystery Match`, `showMysteryMatch`, and `mystery_match`, and linked Supabase markers showing migration `20260609152000` plus zero `find_mystery_match%` routines. Residual references are allowed only in old applied migrations, `_cursor_context` snapshots, historical/archive/audit docs, current removal docs, or tests/validation asserting absence. Active source, generated types, validation that requires the RPC, or tests preserving the feature are blockers. Optional `npm run test:video-date-v4` may stop on an unrelated split-line prewarm room-name/URL regex in `shared/matching/videoDateSprint3DailyHandoffContracts.test.ts`; treat that as a source-shape baseline issue, not a Mystery Match blocker, when the underlying two-condition guard remains present.

Current Event Lobby leaner-path cleanup, 2026-06-09: direct legacy queue/session RPCs `find_video_date_match(uuid,uuid)` and `join_matching_queue(uuid,uuid)` are removed from the active backend contract by migration `20260609163130_remove_legacy_queue_session_rpcs.sql`, and the remaining legacy cleanup RPC `leave_matching_queue(uuid)` is removed by migration `20260609165218_remove_leave_matching_queue.sql`. The temporary `video_sessions.session_source` marker is also removed by migration `20260609171950_remove_video_sessions_session_source.sql`; generated Supabase types and active Edge/shared payload contracts must not expose it. The later post-date instant-next cleanup `20260610000100_remove_post_date_instant_next.sql` also removes queued auto-promotion helpers `drain_match_queue`, `drain_match_queue_v2`, `get_video_date_queue_hint_v1`, and `promote_ready_gate_if_eligible`. Current clients must use `/event/:eventId/lobby` deck/swipe through `swipe-actions`, direct mutual match, Ready Gate, then Video Date. Generated Supabase types and active validation must assert all deprecated queue/session RPCs, the session-source column, the old reciprocal-swipe-only constraint, and the queued auto-promotion RPCs are absent. Keep Ready Gate, Video Date state-machine behavior, and post-date survey behavior intact.

Current 2026-06-09 lessons to preserve:

- Web `/date/:sessionId` must be the stable single-owner shell from allowed date-route access. `useVideoCall` must not rely on component-local state to protect active Daily start/join; prewarm, route entry, retry, and remount recovery need the same per-session/user start promise.
- Same-tab web surface-claim bridging is recovery-only for hot remount/reload. Terminal survey, explicit end, manual exit, and ended route cleanup must release server surface claims. Cleanup bridge decisions must be synchronized before passive cleanup.
- Native/mobile date ownership begins pre-join and active surface ownership spans eligible entry, handshake/date, joining, connecting, and local Daily room presence.
- Backend date promotion requires active bilateral `video_date` surface claims plus durable heartbeat-backed stable copresence or explicit bilateral render-bound remote-seen proof. `state = 'date'`, provider overlap, Daily room creation, or brief media are not sufficient without stable certification.
- Pre-stable provider absence becomes `pre_stable_media_failed` with `survey_required = false`; both database survey eligibility helpers must keep that reason survey-ineligible.
- Web/native `PostDateSurvey` must confirm the actor's own `date_feedback` row before advancing. A verdict RPC response alone is not completion proof.
- Live catalog marker checks are evidence, not gospel. If a marker disagrees with expected behavior, inspect `pg_get_functiondef(...)`; the deployed Daily joined wrapper now uses `video_date_lifecycle_exception_payload_v2(...)` and `video_date_lifecycle_enrich_and_sanitize_payload_v2(...)`.
- Refresh generated Supabase types with `npm run regen:supabase-types`, not hand edits or raw typegen output.
- Final no-build audit evidence for this baseline: stable-media contract, red-flag suite, typecheck, lint, full `npm run test:video-date-v4`, `git diff --check`, linked migration list, linked dry-run, linked public-schema DB lint, linked error-level advisors, and live catalog markers. No web or native build was triggered.

The PR #1245 provider-bound remote-seen baseline below is historical context. It is no longer the current top, but it remains useful provenance for the provider-proof layer.

Published implementation baseline: PR #1245 provider-bound remote-seen recovery after failed session `34ed864c-e6eb-4804-bc71-8aeba6bce9b1`, event `86dc1e15-d2cc-45f6-be81-628bd685a759`, landed as squash commit `a178e1265001f01d5beca0375c38a9cb8c0d4e59` on top of the PR #1232 through PR #1242 review-comments follow-up. Migrations `20260608120000_video_date_provider_bound_remote_seen.sql`, `20260608121834_video_date_remote_seen_identifier_hygiene.sql`, and `20260608122623_video_date_remote_seen_lint_cleanup.sql` make `mark_video_date_remote_seen(...)` require authenticated participant authority plus current Daily owner/call/provider proof before canonical remote-media evidence can change. Web and native/mobile callers now pass `owner_id`, `call_instance_id`, `provider_session_id`, `entry_attempt_id`, and `owner_state = 'joined'`; old session-only or stale-provider calls receive structured no-op JSON instead of mutating encounter truth. The corrective migrations restore short service-only `vd_daily_alive_remote_seen_base` and remove the new remote-seen lint warning. Supabase project `schdyxcunwcvddlcshwd` was verified aligned through `20260608122623_video_date_remote_seen_lint_cleanup.sql`; post-merge dry-run returned `Remote database is up to date`, DB lint exited 0 with the legacy warning backlog only, and live catalog markers confirmed public wrapper/service-only base grants plus the stale-provider guard. The parent workspace commit `7d1443e5a2d6dd93c3bc6df6a0a1810b102c1bc8` points `Git/vibelymeet` at `a178e1265001f01d5beca0375c38a9cb8c0d4e59`. Future sessions should still re-run current Git/Supabase verification before making claims. This is not acceptance proof.

Previous implementation baseline before provider-bound remote-seen: review-comments follow-up for PR #1232 through PR #1242 on top of the PR #1240 route lifecycle and last-resort lifecycle RPC fail-soft recovery. The current follow-up migrations are `20260608114500_review_comments_1232_1242_followups.sql` and corrective `20260608114600_review_comments_identifier_hygiene.sql`; they restore canonical Ready Gate redirects when `/date/:sessionId` is not date-capable, scope native parked Daily call reuse to the same session/room, harden Golden Flow certification scripts, exclude pre-date ended sessions from survey-required invariant failures, sanitize mark-ready safety-check client payloads, preserve idle resume status for inactive provider-absence terminalization, and rename the provider-absence base helper to short catalog name `vd_absence_review_1232_1242_base`. PR #1240 merged as `0b4d0db5ae37bea3e322b4de5935fce48362ff87` and adds migration `20260608080938_video_date_lifecycle_rpc_last_resort_failsoft.sql`, registration-driven `in_survey` route dominance, longer date-route ownership, web same-session Daily call-ref preservation with heartbeat transfer during live remount parking, native/mobile explicit active-handoff preservation, and final public sanitized fail-soft shells for `claim_video_date_surface(...)`, `mark_video_date_daily_alive(...)`, `mark_video_date_daily_joined(...)`, and `video_date_transition(...)`. Supabase project `schdyxcunwcvddlcshwd` should be verified/applied through `20260608114600_review_comments_identifier_hygiene.sql`; verify current cloud state with `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`, `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`, and live catalog marker checks before relying on this in a future session. This builds on PR #1235 Daily owner definitive recovery (`604ac8bc1c76c79035ac01311aa501f4e2ce2fe5`) and its migrations `20260607222923_video_date_daily_owner_definitive_recovery.sql` plus `20260608001000_video_date_base_failsoft_payload_sanitization.sql`, provider-overlap promotion, lifecycle RPC terminal contracts, Ready Gate entry proof, Video Session Created definitive contracts, routeable `both_ready` entry protection, provider-backed joined/absence-terminal recovery, Mutual Match handoff closure, provider-terminal recovery, provider-authoritative presence, shared entry/Daily owner, and the earlier PR #1194-#1200 recovery chain. That is not acceptance proof. Do not claim Video Date is fixed from static tests, CI, route entry, `both_ready`, Daily room creation, brief warm-up UI, visible short media, PR checks, Supabase alignment, or a survey-required terminal row alone; the acceptance bar is a fresh end-to-end run from match through survey completion across the relevant web/native/mobile path, plus short leave/rejoin and prolonged absence checks.

Prior 2026-06-07 review-comments follow-up for PR #1217 through #1231: Supabase cloud is applied/aligned through `20260607185652_review_comments_1217_1231_followups.sql` plus corrective lint repair `20260607190533_review_comments_1217_1231_lint_repair.sql`. The follow-up prechecks mark-ready participant/service authority before event cleanup, clears provider-absence reconnect grace on Daily rejoin, excludes queued sessions from drift validation/repair, limits terminal lifecycle context for nonparticipants, gates native routeable truth recovery to retryable prepare failures only, and repairs the invalid `video_date_surface_claims.release_reason` reference with existing surface-claim columns. If review feedback arrives after a migration has already been applied to Supabase cloud, add a corrective migration rather than editing applied migration history, then rerun migration list, dry-run, DB lint, and live catalog marker checks.

Latest documentation/guidance syncs started with PR #1219 (`849fc3ed5bbec87cf8575fd217a58e8ed3db9834`) and PR #1220 to correct stale handoff guidance after the CTO audit, with later syncs recording PR #1233 provider-overlap, PR #1235 Daily owner definitive recovery, PR #1240 route lifecycle / last-resort fail-soft recovery, and PR #1245 provider-bound remote-seen recovery. Docs-only PRs can advance source `main` without changing the latest implementation baseline; verify exact nested source with `git rev-parse HEAD` and `git ls-remote origin refs/heads/main`. The parent workspace has no remote and tracks `Git/vibelymeet` as a nested gitlink; verify it with `git ls-tree HEAD Git/vibelymeet` instead of hardcoding a local parent pointer hash.

When investigating a Video Date failure, distinguish:

- Ready Gate readiness (`ready_*`, `both_ready`)
- routeability and lobby/date ownership
- Daily room metadata creation
- active Daily co-presence
- remote media evidence
- date start/end and survey completion

`participant_1_joined_at`, `participant_2_joined_at`, route-owner heartbeats, and client `client_daily_alive` rows are historical/telemetry evidence only unless they are backed by current Daily provider proof. They do not prove active co-presence if a later Daily `participant.left` / `participant_*_away_at` exists for the same provider participant. Inspect `video_date_daily_webhook_events.provider_participant_id`, provider event order, `video_date_presence_events.provider_session_id`, `participant_*_away_at`, `participant_*_remote_seen_at`, `handshake_started_at`, and `date_started_at` before concluding that both users were actually together. For duplicate-tab investigations, check both the profile-scoped local lease and server `video_date_surface_claims`, and record whether the two test users shared browser storage/profile context.

Latest `fd02e8ed-a272-46b1-a961-b130e83ce2a4` lesson: a long `both_ready` to stable-provider-copresence gap is abnormal, but do not automatically classify it as delayed room creation or delayed first Daily entry. In that session, both users initially joined Daily within 3-5 seconds of `both_ready`, both provider sessions left around +26 seconds, then users rejoined at +36/+55 seconds and stable handshake started at +61 seconds. The backend was correct to wait for stable current provider-backed copresence; the product failure signal was early provider join-left-rejoin route/Daily lifecycle churn.

Current failure theory has moved to the post-`both_ready` routeable-entry boundary plus provider-backed post-handoff Daily ownership, latest-state presence, immediate confirmed-encounter promotion, deadline fallback recovery, terminal survey persistence, and cross-surface ownership. `video_session_mark_ready_v2` must protect a routeable handoff even when deterministic Daily room metadata is already present, and `daily-room` must persist routeable handshake state before outbound Daily provider verification or token work. Daily `participant-left` is not immediate backend partner-away authority; web and native should wait through the local 12s Daily transport grace before calling `mark_reconnect_partner_away` with `p_reason = daily_transport_grace_expired`. Same-session Daily calls in active date handoff are now treated as durable owner resources: web must park live same-session remount calls without idle destruction, and native/mobile must only preserve Daily through an explicit `preserve_active_handoff` cleanup mode before any `leave()`/destroy call. Manual abort, date end, background, and timeout paths remain destructive. Browser `visibilitychange` is soft telemetry while Daily is joining/joined. Latest provider-backed client join must clear away state and reconnect grace only when Daily provider truth supports that provider session; provider-null or stale heartbeats are telemetry, not lifecycle authority. If both sides have confirmed remote media and current provider proof, server truth should promote to `date` immediately through `mark_video_date_remote_seen` or `video_session_handshake_auto_promote_v2`; `finalize_video_date_handshake_deadline` is fallback-only and must still preserve `confirmed_encounter_deadline_rescue` plus positive `handshake_deadline_extended_for_launch_evidence_v2` behavior. If active session truth is `kind=video`, including `queue_status = in_survey`, `/date/:sessionId` is the single owner across web/native/mobile and lobby/Ready Gate surfaces must yield to it; terminal-survey recovery must force past duplicate-navigation/manual-exit suppression on web and native while preserving same-route no-op protection. If server truth says the session ended with survey-required encounter evidence, `/date/:sessionId` must stop Daily/surface/reconnect/peer-wait churn immediately and open `PostDateSurvey`. Client lifecycle classifiers must not treat generic `session_ended` as survey truth; `session_ended` is terminal-stop truth only, while survey recovery requires `queue_status = 'in_survey'`, `survey_required`, or `surveyRequired`. Exposed lifecycle RPCs should be outermost fail-soft and return retryable JSON instead of raw 500s under duplicate/stale/terminal calls; raw SQL diagnostics belong in service-side observability, not authenticated client payloads. If review feedback arrives after a migration has been pushed to Supabase cloud, add a corrective migration rather than editing applied migration history, then rerun migration list, dry-run, and live catalog marker checks.

## 1. No Long-Lived Stashes

Do not use Git stashes as product backlog, design memory, migration parking, native config archives, payment/auth/backend WIP storage, or audit memory.

Allowed stash use:

- temporary context switch
- same-day recovery
- clearly named intent
- cleared or converted before end of day

If work cannot be merged within 24 hours, convert it into one of:

- draft PR
- GitHub issue
- decision pack
- patch export
- branch with owner and expiry

Never recover a stash wholesale unless it is proven tiny, current-main-compatible, and low-risk.

## 2. Always Resolve Stashes by SHA

Never trust historical `stash@{N}` indices.

Before any stash inspection or deletion:

- run `git stash list --format='%gd %H %h %s'`
- resolve the target by full SHA
- re-resolve immediately before dropping
- drop only the exact target SHA

Never run old stash-drop commands from historical audit files.

## 3. Use Decision Packs for Broad or Risky WIP

If a stash or branch mixes product, backend, auth, payments, native config, Supabase, generated types, analytics, docs, or multiple domains, do not recover it as code.

Create a decision pack instead:

- `decision-summary.md`
- `domain-breakdown.md`
- `future-sprint-prompts.md`
- `drop-readiness.md`

Then:

- export final patch and name-status
- drop the stash by exact SHA only after approval
- treat the decision pack as the durable planning artifact

## 4. One Domain per PR / Branch

Do not mix unrelated domains in one PR.

Separate:

- UI copy
- backend function
- migration
- native config
- analytics taxonomy
- docs
- test hardening
- payment/entitlement logic
- push/notification behavior
- auth/session behavior

If a branch touches more than one high-risk domain, split before review.

## 5. Post-Merge Cleanup Is Mandatory

After every squash merge:

1. checkout `main`
2. pull `origin main`
3. confirm `HEAD == origin/main`
4. confirm clean working tree
5. delete the local source branch when safe
6. delete the remote source branch when policy allows
7. check whether a source stash exists
8. reclassify/drop the source stash by exact SHA if recovered
9. update triage/handoff if relevant

No workstream is complete until its source branch, stash, decision pack, and cleanup state are resolved.

## 6. Supabase Verification Is Remote-Only and Non-Mutating by Default

There is no Docker requirement.

For Supabase alignment checks, use:

- `supabase migration list --linked`
- `supabase db push --linked --dry-run`
- `supabase functions list`
- read-only remote inventory SQL
- Edge Function source download if supported by installed CLI
- typegen-to-temp only for comparison

Do not run:

- `supabase db push` without `--dry-run`
- `supabase db diff`
- `supabase status`
- deployments unless explicitly requested
- typegen into repo unless explicitly approved
- Docker-dependent checks
- destructive cloud commands

## 7. Edge Function Alignment Standard

When verifying Supabase Edge Functions:

- compare local deployable function slugs with remote active slugs
- exclude `_shared` from deployable slug counts
- if supported, download remote function source with `supabase functions download --use-api`
- compare downloaded deployed-source files byte-for-byte against local deployed-source files
- classify local-only tests/contracts/helpers separately
- never deploy during verification

Expected verification result format:

- local deployable slugs
- remote active slugs
- local-only slugs
- remote-only slugs
- downloaded source files
- source diffs
- missing local files
- local-only non-deployed files

## 8. Generated Supabase Types Standard

Never hand-edit generated Supabase types.

For final verification:

- generate remote types only to an audit temp file
- compare with `src/integrations/supabase/types.ts`
- allow intentional repo-local explanatory header differences
- report schema/content drift separately from header/comment drift
- do not write generated output into the repo unless explicitly approved

## 9. Generated and Local Artifacts Are Not Product Source

Safe local cleanup candidates:

- `dist/`
- `shared/vibely-games/dist/`
- `apps/mobile/.expo/`
- `test-results/`

Do not blindly delete:

- `.env*`
- `.vercel/`
- `node_modules/`
- `apps/mobile/node_modules/`
- `supabase/.temp/`
- `apps/mobile/ios/`
- preserved worktrees
- audit exports / bundles / patches / decision packs

Generated/local files must not be mistaken for product changes.

## 10. Native Config Requires Native-Owner Review

Never auto-recover stash code that touches:

- `apps/mobile/app.config.js`
- `apps/mobile/app.base.json`
- `apps/mobile/eas.json`
- `apps/mobile/package.json`
- `apps/mobile/package-lock.json`
- `apps/mobile/ios/**`
- `Info.plist`
- entitlements
- app permissions
- Expo config
- native dependency changes

Native config changes require a dedicated native build/config sprint.

## 11. Payment, Auth, Push, and Supabase Changes Require Owner Review

Never auto-recover code touching:

- Stripe checkout / webhook behavior
- RevenueCat entitlement truth
- premium tier gates
- auth/session hydration
- account lifecycle
- OneSignal/push delivery semantics
- notification outbox/inbox semantics
- Supabase migrations/RLS/RPC/functions
- generated Supabase types

These must become dedicated backend/product/security sprints.

## 12. Branches Need Owner, Purpose, and Expiry

Every non-main branch should have:

- owner
- purpose
- created date
- expected PR or decision outcome
- expiry / cleanup checkpoint

Weekly hygiene should classify branches as:

- active
- merged/recovered
- needs decision pack
- archive/keep
- delete candidate

## 13. Weekly Repo Hygiene Ritual

Run weekly:

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git rev-list --left-right --count HEAD...origin/main
git stash list --format='%gd %H %h %s'
git worktree list --porcelain
git branch --format='%(refname:short) %(upstream:track)'
```
