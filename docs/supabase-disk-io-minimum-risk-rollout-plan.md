# Supabase Disk IO — Minimum-Risk Rollout Plan

> **Posture:** safety first. Production users must not experience a slower UI, stale core data, missed notifications, missed chat messages, delayed matching, broken event lobby, changed Daily Drop behaviour, broken Ready Gate / video date flow, changed auth/onboarding behaviour, or any product regression as a result of this work.
>
> **Companion docs:**
> - Static audit: [supabase-disk-io-diagnosis.md](supabase-disk-io-diagnosis.md)
> - Read-only diagnostics queries: [supabase-disk-io-readonly-diagnostics.md](supabase-disk-io-readonly-diagnostics.md)
> - Future-phase prompts (templates only): [supabase-disk-io-safe-fix-prompts.md](supabase-disk-io-safe-fix-prompts.md)

---

## A. Executive summary

The static audit found a plausible mix of contributors (admin realtime fan-out, per-minute crons, daily-drops batch, several client polls). It did **not** collect live database evidence: no `pg_stat_statements`, no per-table seq-scan counts, no cache-hit ratios, no cron runtime history, no `EXPLAIN` plans. **No user-facing code or production system has been changed by either pass.**

Because the live evidence is missing, **the only safe immediate work is non-mutating**: read-only diagnostics, dashboard observation, alert configuration, and an optional capacity bump that the operator chooses outside the repo. Any code or schema change today is speculative — it could regress UX, miss notifications, slow lobbies, break Ready Gate, or hide a real cause behind a placebo fix.

What this plan does:

1. Classifies every prior finding by **user-impact bucket**.
2. Defines a **phased rollout** that gates code work behind live evidence.
3. Specifies **production safety gates** every future PR must pass.
4. Specifies **UX guardrails** — explicit do-not-touch surfaces.

What this plan does **not** do: change behaviour, deploy anything, alter migrations or crons, add or drop indexes, delete data, or "optimize" any user-facing path.

---

## B. Risk matrix (every prior finding, classified)

Buckets:
- **0 — Zero user impact** — read-only diagnostics, docs, monitoring, capacity decisions made outside the repo.
- **1 — Admin-only, low risk** — only affects admin dashboards/staff; normal users cannot be affected.
- **2 — User-facing, do not touch yet** — touches lobby, deck, chat, notifications, badges, Daily Drops, Ready Gate, video date, matches, profile, payments.
- **3 — Database / cron / migration, do not touch yet** — indexes, retention, cron schedules, RPCs, schema.
- **Capacity** — operator decision, executed in Supabase dashboard, not in repo.

| # | Finding (from static audit §2) | Surface | User-impact risk if changed today | Risk if left alone | Confidence | Evidence still required | Bucket | Rollback strategy |
|---|---|---|---|---|---|---|---|---|
| 1 | Admin realtime fan-out (14 channels, no filter) — `useAdminRealtime.ts` | Admin dashboard | **None** if scoped strictly to admin UI | Steady-state extra reads while staff dashboards are open | Medium-high (code-confirmed) | `pg_stat_statements` for `admin_get_engagement_analytics` and `admin_get_overview_dashboard` call rate; cache hit on `messages`/`matches`/`daily_drops` | **1** | Revert hook to current 14-channel fan-out via single Git revert; admin UI fully restored |
| 2 | `event-reminders-sweep-stale-claims` `* * * * *` | Cron (sweeper) | Medium — slowing the sweeper risks delayed reminders if not replaced safely | Per-minute UPDATE traffic on `event_reminder_queue` | Medium | EXPLAIN on §9c; sweep runtime in `cron.job_run_details` | **3** | Revert `cron.alter_job` to `* * * * *` |
| 3 | `event-lifecycle-auto-finalize` per-minute scan of `events` | Cron + DB | Medium — wrong predicate can leave events un-finalised | Possible per-minute seq scan | Medium | EXPLAIN §9a | **3** | Drop the new index; revert RPC if changed |
| 4 | `date-reminder-cron` N+1 lookup of `date_suggestions` | Cron + Edge | Medium — could miss reminders if denormalisation has bugs | Many small queries × 1440/day | Medium | `pg_stat_statements` row for the suggestion SELECT; runtime/run from §8 | **3** | Revert Edge Function deployment |
| 5 | `event-reminders` per-row `event_registrations` lookup | Cron + Edge | Medium-high — touches notification delivery | Same as 4 | Medium | Same as 4; plus delivery-success rate baseline | **3** | Revert Edge Function deployment |
| 6 | `generate-daily-drops` full `profiles` scan + 25-concurrent fan-out | Daily batch + Edge | **High** — Daily Drops is a user-visible product surface; any miss is a user complaint | Daily IO spike at 18:00 UTC | Medium-high (code-confirmed) | EXPLAIN §9d; `daily_drop_generation_runs` runtime; pg_stat read counts on each dependent table | **3** | Revert function + drop the queue table if introduced |
| 7 | Event deck polling 15 s (`useEventDeck.ts`) | **Lobby — user-facing** | **High** — UX (deck freshness) | Steady RPC volume during peak | High | RPC count from logs; user-perceived staleness perception study | **2** | Revert hook |
| 8 | Web chat outbox 4 s tick (`WebChatOutboxContext.tsx`) | **Chat — user-facing** | **High** — message reliability | Always-on tick on every web tab | High | Message-delivery success metrics, hydration timing | **2** | Revert context |
| 9 | Mobile badge AppState refetch (no debounce) | **Badge — user-facing** | Medium | 3 count queries per foreground | High | iOS/Android badge accuracy metric pre-change | **2** | Revert hook |
| 10 | Global `events-realtime` channel (`useEvents.ts`) | **Home — user-facing** | **High** — events freshness app-wide | Per-minute global fan-out at peak | High | Realtime payloads/session from logs | **2** | Revert hook |
| 11 | `match-call-room-cleanup` / `video-date-room-cleanup` `*/5` scans + per-row Daily.co API | Cron | Medium — touches video session state | Bounded; mostly external API | Medium | EXPLAIN; cron runtime | **3** | Revert function or schedule |
| 12 | `user_notifications` retention gap | DB | **High** — wrong delete predicate could lose notifications a user still expects | Unbounded growth on a brand-new hot table | High | Distribution of `dismissed_at`, `read_at` ages; row count growth/day | **3** | Restore from PITR; halt the worker via `cron.alter_job` |
| 13 | Notification inbox 3-query refetch (`useNotificationInbox.ts`) | **Inbox — user-facing** | Medium — counts/timeline freshness | Cascading refetches per realtime event | High | Realtime → refetch ratio in browser logs | **2** | Revert hook |
| 14 | Admin engagement analytics 30 s polling (`useAdminEngagementAnalytics.ts`) | Admin dashboard | **None** if scoped to admin UI | 30 s loop on heavy aggregation | High | RPC runtime; admin tab time-on-page | **1** | Revert hook |
| 15 | Ready Gate fallback 1–2 s poll (`ReadyGateOverlay.tsx`) | **Ready Gate — user-facing, FORBIDDEN** | **Highest** — directly between user and video date | Only during realtime degradation | High (code-confirmed) | None at this stage — explicitly out of scope | **2 (do not touch)** | n/a |
| 16 | `payment_observability_logs` retention | DB | Low | Unbounded growth | Medium | Table size + write rate from §5/§6 | **3** | Restore from PITR |

**Bucket 0 entries (always safe):**
- Run [supabase-disk-io-readonly-diagnostics.md](supabase-disk-io-readonly-diagnostics.md) in Studio.
- Configure dashboard alerts (Disk IO, CPU, connection pool saturation, cron failures).
- Decide on a temporary compute upgrade in the Supabase dashboard (operator decision; outside the repo).
- Snapshot baseline metrics for any future change.

---

## C. Recommended phases

The phases are **strictly sequential**. Each phase has an evidence gate; do not begin a phase until the gate of the prior phase is satisfied and explicitly signed off by the operator.

### Phase 0 — No-code, no-user-impact (start here)

**Scope (allowed):**
- Run the read-only SQL in [supabase-disk-io-readonly-diagnostics.md](supabase-disk-io-readonly-diagnostics.md) in Supabase Studio.
- Capture: top-10 by `shared_blks_read`; top-10 by `total_exec_time`; database-wide cache hit ratio; per-table cache hit on hot tables; `cron.job_run_details` distribution; EXPLAIN output for §9a–9e.
- Configure (dashboard-only, not in repo): Disk IO alert at the threshold the operator picks; CPU alert; failed-cron alert.
- (Operator-only, optional) Bump compute one tier as a shock absorber. **No code changes accompany the bump.**
- File a copy of the captured evidence in `docs/supabase-disk-io-evidence-YYYY-MM-DD.md` (operator-authored) so future PRs cite real numbers.

**Forbidden:**
- Any code change, migration, cron change, index change, retention worker, Edge Function deploy, or RLS change.
- Any modification of polling intervals or realtime behaviour.

**Gate to Phase 1:**
- Top-10 IO consumers documented.
- Cache hit ratio recorded.
- Cron runtime distribution recorded.
- EXPLAIN plans for §9a–9e captured.
- The static audit's hypotheses ranked **against measured evidence**, not just code.

### Phase 1 — Admin-only low-risk changes (only if Phase 0 confirms)

**Scope (allowed):**
- Add a debounce to admin-only invalidations in `useAdminRealtime.ts` (mirror the existing 750 ms `invalidateOverview` pattern).
- Increase `refetchInterval` on admin-only analytics polls (`useAdminEngagementAnalytics.ts`, `useAdminOverviewDashboard.ts`, `AdminLiveEventMetrics.tsx`).
- Each change must be **gated by a feature flag** controlled at the admin-shell level so it can be flipped off without a deploy.
- Each change ships with a measurement log: before/after RPC rate, admin tab load time.

**Forbidden in Phase 1:**
- Anything visible to non-admin users.
- Any DB / cron / index / retention change.
- Removing realtime subscriptions outright (filter only — do not remove channels).

**Gate to Phase 2:**
- One full week of admin telemetry shows the IO reduction the static audit predicted.
- Admin staff have signed off that dashboards still feel current.
- No regression in `pg_stat_statements` for the admin RPCs.

### Phase 2 — Non-critical background optimizations (cron smoothing / queue patterns)

**Scope (allowed; only with operator approval and live evidence):**
- Add **jitter** to cron schedules that today fire at `:00` (e.g., move `event-reminders-sweep-stale-claims` to `1 * * * *`, `event-lifecycle-auto-finalize` to `2 * * * *`, etc.). Schedule changes only — not RPC rewrites.
- Design (not yet implement) a fan-out queue for `generate-daily-drops` that mirrors the `event-reminders` claim/deliver pattern.

**Forbidden in Phase 2:**
- Deletion / retention workers.
- New indexes.
- RPC rewrites.
- Any user-facing surface change.

**Gate to Phase 3:**
- Phase 2 changes have run for one full daily cycle without cron failures.
- Designs for queue / retention patterns have been written and reviewed.

### Phase 3 — User-facing optimization candidates (explicit approval required)

**Scope (allowed only with explicit per-change approval from the operator and with explicit rollback):**
- Increase event-deck `refetchInterval` from 15 s to a measured value, **only after** product review and an A/B with measurable freshness criteria.
- Replace web chat outbox `setInterval` with realtime-INSERT-driven hydration, **only after** a delivery-reliability test plan is in hand.
- Debounce mobile badge AppState refetch, **only after** confirming OneSignal still receives the right counts.
- Filter the global events realtime channel by visible scope, **only after** confirming dashboard freshness for all common locales.

**Forbidden in Phase 3:**
- Touching Ready Gate (`ReadyGateOverlay.tsx`).
- Touching Daily Drops state machine (`useDailyDrop.ts`).
- Touching video date lifecycle.
- Touching swipe / match / handle_swipe paths.
- Touching auth / onboarding / billing paths.
- Bundling more than one user-facing surface in a single PR.

### Phase 4 — Database / index changes

**Scope (allowed only after EXPLAIN evidence and DB review):**
- Propose a partial index on `events` for `finalize_due_events()` **only if** §9a EXPLAIN confirms a seq scan.
- Propose retention workers for `user_notifications`, `event_reminder_queue`, `payment_observability_logs` **only with** explicit deletion predicates, dry-run mode, batch limits, and an off-switch.

**Forbidden in Phase 4:**
- Any RLS change.
- Any change to `auth.*` schema.
- Any destructive operation outside the explicit deletion predicate.
- Any operation that can outrun PITR retention.

---

## D. Production safety gates (mandatory for any future implementation PR)

Every PR that ships out of Phase 1+ must include in its description:

1. **Files changed** — exact paths.
2. **User-facing impact statement** — explicitly call out whether non-admin users can perceive any difference. If the answer is "yes," the PR cannot land without product approval.
3. **Rollback plan** — single-command revert. Migrations must be paired with a forward-and-backward script.
4. **Before/after metrics** — baseline captured in Phase 0; after-metrics measured the same way.
5. **Test plan** — what passes, what was checked manually, what was deferred.
6. **No unrelated changes** — one concern per PR.
7. **No deploy without operator approval.** No `vercel deploy --prod`, `supabase db push`, `supabase functions deploy`, or `supabase secrets set` from the agent — operator runs these.
8. **No migration without review.** Migrations land via `npx supabase migration new` per `CLAUDE.md`; reviewer must inspect the SQL.
9. **No Edge Function deploy without explicit instruction.**
10. **No `--no-verify`, `--no-gpg-sign`, force-push, or hook bypass** anywhere.

---

## E. User-experience guardrails (explicit do-not-touch)

Until each guardrail is **separately, explicitly lifted by the operator** with documented evidence, do not:

- Reduce freshness of:
  - Lobby (event deck, attendee count, queue size).
  - Chat (message visibility, hydration, read receipts).
  - Matches list.
  - Ready Gate / video date.
  - Notifications inbox or unread/unseen counts.
  - Daily Drops state.
  - Profile / onboarding / billing screens.
- Change `useEventDeck.ts` `refetchInterval` or RPC payload.
- Change `WebChatOutboxContext.tsx` tick or hydration policy.
- Touch `useDailyDrop.ts`, `daily_drop_*` RPCs, or daily-drop Edge Functions.
- Touch `ReadyGateOverlay.tsx` or video-date lifecycle.
- Touch `handle_swipe()` or any RPC under `swipe-actions`.
- Change auth listeners, session refresh, or onboarding redirect logic.
- Modify `stripe-webhook`, `revenuecat-webhook`, `payment_observability_logs`, or any subscription/credits path.
- Add or alter realtime subscriptions that any non-admin user can subscribe to.
- Delete any row from a production table.
- Schedule, unschedule, or alter any pg_cron job.

If a proposal would cross any of these lines, treat it as a candidate only and add it to the review queue in [supabase-disk-io-safe-fix-prompts.md](supabase-disk-io-safe-fix-prompts.md).

---

## F. Capacity recommendation (operator decision, outside the repo)

A one-tier compute bump on the Supabase dashboard is a reasonable **temporary** shock absorber while Phase 0 evidence is collected. It is **not** a fix and does not unlock Phase 1+ on its own. After bumping:

- Confirm Disk IO % drops below the alert threshold.
- Capture a fresh `pg_stat_statements` snapshot (cumulative stats persist; an explicit reset is *optional* and is an operator decision).
- Re-run §1, §2, §6, §7, §8 of the diagnostics doc 24 hours later.
- Decide whether the underlying findings still warrant Phase 1 work.

The bump must be performed via the Supabase dashboard by the operator. The agent must **not** invoke billing or compute changes through the CLI.

---

## G. What this plan changes today

- **Application code:** none.
- **Migrations:** none.
- **Cron schedules:** none.
- **Edge Functions:** none.
- **RLS / auth / payments:** none.
- **Provider config:** none.
- **Docs created/updated:**
  - `docs/supabase-disk-io-readonly-diagnostics.md`
  - `docs/supabase-disk-io-minimum-risk-rollout-plan.md` *(this file)*
  - `docs/supabase-disk-io-safe-fix-prompts.md`

---

## H. Top zero-risk next operator actions

1. Run [supabase-disk-io-readonly-diagnostics.md](supabase-disk-io-readonly-diagnostics.md) §1, §2, §3, §6, §8 in Supabase Studio. Paste the top 10 results back into a fresh `docs/supabase-disk-io-evidence-YYYY-MM-DD.md`.
2. Configure (or confirm) dashboard alerts for Disk IO %, CPU %, and pooler saturation.
3. Decide whether to bump compute one tier as a temporary shock absorber.
4. Re-rank the §B risk matrix against the captured evidence; mark any row whose hypothesis wasn't borne out as "deprioritised."

## I. Top actions that need explicit approval before any work starts

- Phase 1 admin debounce + admin polling reduction (after Phase 0 evidence).
- Phase 2 cron jitter (schedule-only, no RPC change).
- Phase 4 partial-index proposal for `events` *only if* §9a EXPLAIN shows a seq scan.
- Any retention worker (each requires explicit predicate, dry-run mode, off-switch, and rollback plan).
- Any user-facing change in Phase 3.
