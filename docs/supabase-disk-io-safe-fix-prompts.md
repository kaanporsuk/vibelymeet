# Supabase Disk IO — Safe-Fix Prompts (templates only; not for execution today)

> **Status:** templates. Each prompt below is intended to be pasted into a future Codex/Claude session **only after** the corresponding gate in [supabase-disk-io-minimum-risk-rollout-plan.md](supabase-disk-io-minimum-risk-rollout-plan.md) is satisfied and explicitly approved by the operator.
>
> Today's run did **not** execute any of these. Nothing in application code, migrations, crons, RPCs, RLS, or provider config has been changed.

Each prompt has the same shape:

- **Scope** — exactly what is in bounds.
- **Hard rules** — what the agent must refuse to do even if asked.
- **Forbidden changes** — explicit do-not-touch surfaces.
- **Validation** — how to prove the change works without regressions.
- **Rollback** — single revert path.
- **Expected impact** — best-case improvement.
- **User impact risk** — what could go wrong from a user's perspective.

---

## Prompt A — Read-only live DB evidence collection

> Run when: starting Phase 0. Pre-requisite: `pg_stat_statements` is enabled.

**Scope:**
- Run the SQL recipes in [supabase-disk-io-readonly-diagnostics.md](supabase-disk-io-readonly-diagnostics.md) in Supabase Studio against project ref `schdyxcunwcvddlcshwd`.
- Capture results into a new dated evidence file `docs/supabase-disk-io-evidence-YYYY-MM-DD.md`.
- Cross-check the evidence against the static audit's §2 ranking. Mark each prior finding as: confirmed / partially confirmed / not borne out / inconclusive.

**Hard rules:**
- Read-only. No `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `CREATE`, `ALTER`, `DROP`, `VACUUM`, `ANALYZE` (the maintenance command), `REINDEX`, `cron.schedule`, `cron.unschedule`, `pg_terminate_backend`.
- `EXPLAIN ANALYZE` is allowed only for SELECT statements. Never `EXPLAIN ANALYZE` an INSERT/UPDATE/DELETE.
- Do not enable any extension. If `pg_stat_statements` is missing, stop and ask the operator.

**Forbidden changes:**
- Application code, migrations, cron, Edge Functions, RLS, auth, billing.

**Validation:**
- Evidence file contains all sections from the diagnostics doc with timestamps.
- Each prior-audit finding has an updated confidence label.

**Rollback:**
- N/A — read-only.

**Expected impact:**
- Replaces the static audit's hypotheses with measured numbers. Unblocks Phase 1 if (and only if) the evidence corroborates the predicted contributors.

**User impact risk:**
- None. Pure observation.

---

## Prompt B — Admin-only dashboard realtime debounce (Phase 1)

> Run when: Phase 0 evidence gate is satisfied AND admin staff have a measurable baseline.

**Scope:**
- File: `src/hooks/useAdminRealtime.ts`.
- Add a 1.5–3 s debounce around `invalidateEngagement` (mirror the existing 750 ms `invalidateOverview` debounce).
- Filter or drop the `messages` INSERT subscription so it does **not** trigger overview/engagement refetches.
- Add an environment-flag escape hatch (e.g. `VITE_ADMIN_REALTIME_DEBOUNCE_MS` falling back to current behaviour when unset) so the change can be reverted without a deploy.

**Hard rules:**
- Edits limited to `src/hooks/useAdminRealtime.ts` and an env flag wiring point.
- No removal of realtime channels — filter or debounce only.
- No change to `useAdminOverviewDashboard.ts` polling cadence in this PR.
- No change to RLS or any RPC.
- Do not touch any non-admin code path.

**Forbidden changes:**
- Anything in `src/components/admin/*` that affects layout/UX without staff sign-off.
- Anything outside `src/hooks/useAdminRealtime.ts`.
- All Bucket 2 surfaces (lobby, deck, chat, notifications, badges, Daily Drops, Ready Gate, video date, matches, profile, payments).
- Any DB/cron/migration change.

**Validation:**
- Pre-change baseline: capture `admin_get_engagement_analytics` and `admin_get_overview_dashboard` invocation rate from `pg_stat_statements` and admin tab load time.
- After-change measurement: same metrics for one week.
- Admin staff sign-off: dashboards feel current; no missed updates reported.

**Rollback:**
- Single revert of the PR commit, or flip the env flag to disable the debounce.

**Expected impact:**
- Reduce admin-driven refetch pressure on heavy aggregation RPCs.
- Net reduction in `pg_stat_statements.calls` and `total_exec_time` for the admin RPCs during staff hours.

**User impact risk:**
- **None for normal users.** Admin-only path. Worst-case: admin staff perceive a small (1.5–3 s) delay before stats refresh — acceptable per Phase 1 design.

---

## Prompt C — Admin analytics polling reduction (Phase 1)

> Run when: Prompt B has soaked for ≥ 1 week with no regressions.

**Scope:**
- Files: `src/hooks/useAdminEngagementAnalytics.ts`, `src/hooks/useAdminOverviewDashboard.ts`, `src/components/admin/AdminLiveEventMetrics.tsx`.
- Increase `refetchInterval`s on admin-only queries: 30 s → 60–120 s; 10 s → 30 s; 15 s → 30 s. Keep tab-focus refetch enabled so a returning admin sees current data within the staleTime window.
- No change to query shape or RPC signature.

**Hard rules:**
- Admin paths only.
- No change to Bucket 2 hooks.
- Do not introduce new env flags beyond what Prompt B added.

**Forbidden changes:**
- Anything user-facing.
- Any DB / cron / RPC / migration change.

**Validation:**
- Before/after RPC call rate from `pg_stat_statements`.
- Admin staff sign-off after one full work-week.

**Rollback:**
- Single revert of the polling values.

**Expected impact:**
- 2–4× reduction in admin RPC load during staff hours.

**User impact risk:**
- **None for normal users.** Admin staff: stats up to 60–120 s old instead of 30 s old. Confirm the longer cadence is acceptable to the staff using the dashboard before merging.

---

## Prompt D — Cron evidence review only (Phase 2 prep)

> Run when: Phase 0 evidence is captured and `cron.job_run_details` has 7 days of history.

**Scope:**
- Read [supabase-disk-io-readonly-diagnostics.md](supabase-disk-io-readonly-diagnostics.md) §8 output.
- For each `* * * * *` job, document: average runtime, max runtime, failure rate, peak hour. Cross-reference with the static audit's cron table (§5).
- Propose **schedule offsets only** (e.g. `* * * * *` → `1 * * * *`, `2 * * * *`, …) so the same logic still runs once per minute but without thundering-herd alignment.
- Output a single review doc `docs/supabase-disk-io-cron-evidence-YYYY-MM-DD.md` with the proposed offsets and estimated IO smoothing.
- **Do not** apply any change. This is a written proposal only.

**Hard rules:**
- No `cron.schedule`, `cron.unschedule`, or `cron.alter_job` execution.
- No Edge Function deploy.
- No RPC rewrite.
- No new index.

**Forbidden changes:**
- All buckets except docs.

**Validation:**
- Proposal compiles a runtime distribution table per job and an estimated cron-misalignment cost.
- Operator reviews the proposal before any later prompt runs.

**Rollback:**
- N/A — docs only.

**Expected impact:**
- Documented evidence to support (or reject) the static audit's "thundering herd at `:00`" hypothesis.

**User impact risk:**
- None at this stage. The proposal is words on paper.

---

## Prompt E — Retention design only (Phase 2 / 4 prep)

> Run when: Phase 0 + Prompt D evidence is in hand and the table-size data confirms unbounded growth.

**Scope:**
- For each candidate table (`user_notifications`, `event_reminder_queue`, `payment_observability_logs`, optionally `messages`, `event_swipes`, `daily_drops`):
  - Define the deletion predicate explicitly (column-level, with date offset).
  - Define a batch limit (`LIMIT N`) and a max-rows-per-run cap.
  - Define a dry-run mode that returns counts without deleting.
  - Define an explicit kill-switch (e.g. an env flag the worker reads each iteration).
  - Define a rollback strategy for accidental deletion (PITR window for the project, with the exact `pg_dump` / point-in-time restore procedure).
- Output a design doc `docs/supabase-disk-io-retention-design.md`. **Do not implement.**

**Hard rules:**
- No `DELETE` execution.
- No new cron registration.
- No new Edge Function deploy.
- No migration.
- The design must specify how the predicate is unit-tested against synthetic data before touching production.

**Forbidden changes:**
- Anything that runs on production.

**Validation:**
- Design includes: predicate, batch size, dry-run, kill-switch, rollback, expected daily delete volume, expected table-size trajectory after 30/90/180 days.

**Rollback:**
- N/A — docs only.

**Expected impact:**
- Replaces the static audit's "needs retention" hand-wave with a concrete, reviewable plan.

**User impact risk:**
- None at design stage. **Retention can lose data**, so implementation must wait for explicit operator approval and a separate, narrowly scoped Prompt F-style implementation prompt.

---

## Prompt F — User-facing optimization PROPOSAL only (Phase 3 gate)

> Run when: Phase 0/1/2 are complete, evidence supports the change, and the operator explicitly approves a single user-facing surface for review.

**Scope:**
- Pick exactly **one** Bucket-2 finding (event deck poll, web chat outbox tick, mobile badge AppState, global events realtime, notification inbox refetch).
- Produce a written proposal `docs/supabase-disk-io-userfacing-<surface>-YYYY-MM-DD.md` containing:
  - Code-level diff outline (no actual edits).
  - Pre-change baseline metrics: RPC call rate, payload size, user-perceived latency.
  - Test plan: what manual flows exercise the surface end-to-end (lobby join, send message, see notification badge).
  - Acceptance criteria: max acceptable freshness lag (e.g. "deck no more than 30 s stale during peak").
  - Rollback plan.
  - Risk register: what could regress, what bug pattern to watch for, who is on-call.

**Hard rules:**
- **No code changes** in this prompt.
- The surface is one of: deck poll, chat outbox, mobile badge, events realtime, notification inbox. No others.
- **Forbidden surfaces** (do not propose changes to): Ready Gate, video date lifecycle, swipe / handle_swipe, Daily Drop state machine, auth/onboarding, billing, payments.

**Forbidden changes:**
- Anything outside the chosen single surface.
- Bundling multiple surfaces.

**Validation:**
- Proposal is reviewed by the operator and (where relevant) a product stakeholder before any implementation prompt is written.

**Rollback:**
- N/A — proposal only.

**Expected impact:**
- Clear, minimum-blast-radius spec for one surface.

**User impact risk:**
- None at proposal stage. Implementation, when it follows, must come with a flag and a fast rollback.

---

## Prompt G — Index proposal after EXPLAIN only (Phase 4 prep)

> Run when: §9 EXPLAIN evidence in [supabase-disk-io-readonly-diagnostics.md](supabase-disk-io-readonly-diagnostics.md) shows a Seq Scan or high `Buffers: shared read` on the predicate.

**Scope:**
- For each EXPLAIN output that demonstrates a seq scan or excessive buffer reads:
  - Identify the candidate index (column list, `WHERE` clause for partial index, expected size estimate).
  - Estimate write-amplification cost on the underlying table (use §6 dead-tuple/UPDATE counts).
  - Propose a `CREATE INDEX CONCURRENTLY` migration **as text in a doc**, not as a `.sql` file in `supabase/migrations/`.
  - Specify how the index will be verified post-creation (`EXPLAIN ANALYZE` re-run; `pg_stat_user_indexes.idx_scan` > 0).
  - Specify the rollback (`DROP INDEX CONCURRENTLY`).
- Output `docs/supabase-disk-io-index-proposals-YYYY-MM-DD.md`. **Do not commit any migration.**

**Hard rules:**
- No `CREATE INDEX` executed.
- No file added to `supabase/migrations/`.
- No `npx supabase db push`.
- Each proposed index must be partial when the predicate allows; full indexes on hot tables require explicit additional justification.

**Forbidden changes:**
- All non-doc files.

**Validation:**
- For each proposal: EXPLAIN before/after expectation; expected `pg_stat_user_indexes.idx_scan` after one day.
- Operator review before any later prompt creates the migration.

**Rollback:**
- N/A — docs only.

**Expected impact:**
- Concrete index proposals tied to live evidence, not speculation.

**User impact risk:**
- None at proposal stage. Implementation later must use `CREATE INDEX CONCURRENTLY` and watch for any regression in write throughput on the affected table.

---

## Common rules across all future prompts

The agent executing any of the prompts above must:

1. **Refuse** to run if the prerequisite gate has not been satisfied. (E.g. Prompt B refuses if there is no Phase 0 evidence file.)
2. **Refuse** to bundle multiple prompts in a single PR.
3. **Refuse** to alter RLS, auth, payments, billing, swipe/match, Ready Gate, video date, Daily Drops, or chat reliability paths under any circumstances unless an operator explicitly issues a prompt scoped to that surface.
4. **Refuse** to skip hooks (`--no-verify`), bypass signing, or force-push.
5. **Refuse** to deploy Edge Functions, push migrations, set secrets, or modify provider config without explicit operator instruction.
6. **Always** include a one-paragraph user-facing impact statement in the PR body.
7. **Always** include a single-command rollback in the PR body.
8. **Always** capture before metrics and after metrics with the same query, against the same window.

If any future prompt is missing one of these, treat the omission as a request to add the safety scaffolding before proceeding — not as license to skip it.
