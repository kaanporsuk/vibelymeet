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

`docs/video-date-success-command-center.md` is the active source of truth for the currently failing Video Date recovery effort. It must capture every material symptom, hypothesis, rejected hypothesis, session ID, migration, deployment, test, manual QA result, and unresolved gap.

Current recovery baseline: PR #1190 is merged on `main` at `b72e487d65972566e63f508d023cf2e1e886734a`, and Supabase migration `20260604142017_video_date_active_presence_join_guard.sql` is applied to project `schdyxcunwcvddlcshwd`. That is not acceptance proof. Do not claim Video Date is fixed from static tests, CI, route entry, `both_ready`, or Daily room creation alone; the acceptance bar is a fresh end-to-end run from match through survey completion across the relevant web/native/mobile path.

When investigating a Video Date failure, distinguish:

- Ready Gate readiness (`ready_*`, `both_ready`)
- routeability and lobby/date ownership
- Daily room metadata creation
- active Daily co-presence
- remote media evidence
- date start/end and survey completion

`participant_1_joined_at` and `participant_2_joined_at` are historical evidence only. They do not prove active co-presence if a later Daily `participant.left` / `participant_*_away_at` exists. Inspect `video_date_daily_webhook_events`, `participant_*_away_at`, `participant_*_remote_seen_at`, `handshake_started_at`, and `date_started_at` before concluding that both users were actually together. For duplicate-tab investigations, check both the profile-scoped local lease and server `video_date_surface_claims`, and record whether the two test users shared browser storage/profile context.

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
