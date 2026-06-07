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

Current implementation baseline: routeable `both_ready` entry protection work with migration `20260607123952_video_date_routeable_both_ready_entry_protection.sql` and `daily-room` Edge Function version 860, building on PR #1225 (`dc96df5c8c93d96d2b37e79c16212b782156bbae`) for provider-backed joined/absence-terminal recovery, PR #1223 (`0579ef7ce3845d07444918658f822f7d190ee88a`) for Mutual Match handoff closure, PR #1218 (`a7b8cb7dc05a47262a4c7c7dcd31e5972ed4d0c4`) for provider-terminal recovery, PR #1216 (`3ae7f196749f2229d66da6f0ef73ae2f76f30768`) for provider-authoritative presence, PR #1212 (`0a85449a0384f257d314a77c5a7fe455a71e2003`) for shared entry/Daily owner and stable-copresence gating, PR #1213 (`a3c34dd2b2400908c3cf529d8c3146a141b7ebb8`) for rollout documentation, and the earlier PR #1194-#1200 recovery chain, plus the PR #1205-#1216 review-comments follow-up. Supabase project `schdyxcunwcvddlcshwd` is applied/aligned through `20260607123952_video_date_routeable_both_ready_entry_protection.sql`, after `20260606180000_video_date_stable_copresence_handshake_guard.sql`, `20260606203000_video_date_provider_authoritative_presence.sql`, `20260606205211_video_date_provider_participant_id_presence_repair.sql`, `20260606212727_review_comments_1205_1216_followups.sql`, `20260606224200_video_date_provider_terminal_recovery.sql`, `20260607103000_video_date_mutual_match_handoff_closure.sql`, and `20260607103100_video_date_provider_joined_absence_terminal.sql`. Verify current Git main, `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase migration list --linked`, `SUPABASE_CLI_TELEMETRY_OPTOUT=1 supabase db push --linked --dry-run`, and live catalog markers before assuming cloud state. The latest stabilization work adds shared date-entry ownership, route/session Daily ownership, `mark_video_date_daily_alive(...)` owner heartbeats, service-only `video_date_presence_events`, provider-authoritative stable copresence, Daily alive/joined stamping only with current provider proof, `provider_participant_id`-first Daily webhook identity extraction, web/native/mobile `owner_state='joined'` only from Daily `joined-meeting` plus local provider session id, no-provider Daily alive calls bounded to throttled telemetry, first provider-backed join evidence preservation, client-side Daily alive/joined RPC skips until local provider proof exists, terminal heartbeat shutdown on server/provider truth, provider-absence reconciliation from Daily webhooks and reconnect-grace expiry, routeable `both_ready` prepare-entry lease protection even when deterministic Daily room metadata already exists, route confirmation before Daily provider verification/token minting, web/native Ready Gate navigation when canonical truth is routeable after retryable prepare failure, terminal-survey recovery from authenticated `queue_status='in_survey'` registrations when the session-row fetch fails, caller-bound confirmed-encounter promotion, success-aware surface-claim audit derivation, event-wide inactive Ready Gate cleanup before decisive mark-ready delegation, visible-empty-state Mystery Match polling, and native prejoin waiting for surface client identity. That is not acceptance proof. Do not claim Video Date is fixed from static tests, CI, route entry, `both_ready`, Daily room creation, brief warm-up UI, visible short media, PR checks, Supabase alignment, or a survey-required terminal row alone; the acceptance bar is a fresh end-to-end run from match through survey completion across the relevant web/native/mobile path.

Latest documentation/guidance syncs started with PR #1219 (`849fc3ed5bbec87cf8575fd217a58e8ed3db9834`) and PR #1220 to correct stale handoff guidance after the CTO audit, with PR #1226 (`cdd42333f608738961425f6b3469adef46d419ea`) recording the PR #1225/Supabase deployment state. Docs-only PRs can advance source `main` without changing the latest implementation baseline; verify exact nested source with `git rev-parse HEAD` and `git ls-remote origin refs/heads/main`. The parent workspace has no remote and tracks `Git/vibelymeet` as a nested gitlink; verify it with `git ls-tree HEAD Git/vibelymeet` instead of hardcoding a local parent pointer hash.

When investigating a Video Date failure, distinguish:

- Ready Gate readiness (`ready_*`, `both_ready`)
- routeability and lobby/date ownership
- Daily room metadata creation
- active Daily co-presence
- remote media evidence
- date start/end and survey completion

`participant_1_joined_at`, `participant_2_joined_at`, route-owner heartbeats, and client `client_daily_alive` rows are historical/telemetry evidence only unless they are backed by current Daily provider proof. They do not prove active co-presence if a later Daily `participant.left` / `participant_*_away_at` exists for the same provider participant. Inspect `video_date_daily_webhook_events.provider_participant_id`, provider event order, `video_date_presence_events.provider_session_id`, `participant_*_away_at`, `participant_*_remote_seen_at`, `handshake_started_at`, and `date_started_at` before concluding that both users were actually together. For duplicate-tab investigations, check both the profile-scoped local lease and server `video_date_surface_claims`, and record whether the two test users shared browser storage/profile context.

Latest `fd02e8ed-a272-46b1-a961-b130e83ce2a4` lesson: a long `both_ready` to stable-provider-copresence gap is abnormal, but do not automatically classify it as delayed room creation or delayed first Daily entry. In that session, both users initially joined Daily within 3-5 seconds of `both_ready`, both provider sessions left around +26 seconds, then users rejoined at +36/+55 seconds and stable handshake started at +61 seconds. The backend was correct to wait for stable current provider-backed copresence; the product failure signal was early provider join-left-rejoin route/Daily lifecycle churn.

Current failure theory has moved to the post-`both_ready` routeable-entry boundary plus provider-backed post-handoff Daily ownership, latest-state presence, immediate confirmed-encounter promotion, deadline fallback recovery, terminal survey persistence, and cross-surface ownership. `video_session_mark_ready_v2` must protect a routeable handoff even when deterministic Daily room metadata is already present, and `daily-room` must persist routeable handshake state before outbound Daily provider verification or token work. Daily `participant-left` is not immediate backend partner-away authority; web and native should wait through the local 12s Daily transport grace before calling `mark_reconnect_partner_away` with `p_reason = daily_transport_grace_expired`. A same-session nonterminal Daily call should be reused or waited on, not rebuilt, and web unmount cleanup must not tear down a live same-session Daily call during React route/state churn. Browser `visibilitychange` is soft telemetry while Daily is joining/joined. Latest provider-backed client join must clear away state and reconnect grace only when Daily provider truth supports that provider session; provider-null or stale heartbeats are telemetry, not lifecycle authority. If both sides have confirmed remote media and current provider proof, server truth should promote to `date` immediately through `mark_video_date_remote_seen` or `video_session_handshake_auto_promote_v2`; `finalize_video_date_handshake_deadline` is fallback-only and must still preserve `confirmed_encounter_deadline_rescue` plus positive `handshake_deadline_extended_for_launch_evidence_v2` behavior. If active session truth is `kind=video`, including `queue_status = in_survey`, `/date/:sessionId` is the single owner across web/native/mobile and lobby/Ready Gate surfaces must yield to it; terminal-survey recovery must force past duplicate-navigation/manual-exit suppression on web and native while preserving same-route no-op protection. If server truth says the session ended with survey-required encounter evidence, `/date/:sessionId` must stop Daily/surface/reconnect/peer-wait churn immediately and open `PostDateSurvey`. Exposed lifecycle RPCs (`claim_video_date_surface`, `mark_video_date_daily_joined`, `mark_video_date_remote_seen`, `get_or_seed_video_session_vibe_questions`) should be outermost fail-soft and return retryable JSON instead of raw 500s under duplicate/stale/terminal calls. If review feedback arrives after a migration has been pushed to Supabase cloud, add a corrective migration rather than editing applied migration history, then rerun migration list, dry-run, and live catalog marker checks.

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
