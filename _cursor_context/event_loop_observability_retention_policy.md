# Event loop observability — retention decision brief

**Status:** Phase 3b decision brief + Phase 3c implementation notes. Phase 3c adds `prune_event_loop_observability_events` (migration `20260425120000_event_loop_observability_retention_prune.sql`). **Production scheduler (`pg_cron`) is documented, not committed.**

**Scope:** `public.event_loop_observability_events` and non-materialized `public.v_event_loop_*` read-model views (Phase 3).

---

## Executive recommendation

| Decision | Choice |
|----------|--------|
| **Raw retention window** | **30 calendar days** of rows in Postgres |
| **Partitioning** | **Not now** — introduce only if batched deletes become operationally painful |
| **Enforcement mechanism** | **`prune_event_loop_observability_events()`** — batched `DELETE` by `created_at` (Phase 3c migration); schedule with **`pg_cron`** or external SQL runner |
| **Cold export** | **Defer** — no standing export pipeline until a concrete trigger (see below) |

**Why this bundle:** It caps growth with minimal schema and ops surface area, matches the “operational telemetry, not analytics warehouse” intent, and keeps a month of signal for promotion/drain/expiry regressions. Higher cost/complexity options are reserved for measured need.

---

## 1. Raw retention window options

### 30 days (recommended)

- **Pros:** Strong default for ops telemetry; bounded storage; aligns with typical incident and release cadences; simplest to explain.
- **Cons:** Weak for rare, slow-burn bugs that surface after a month (acceptable trade-off for this table’s purpose).

### 90 days (alternative)

- **Pros:** Extra safety margin for intermittent issues and seasonal event patterns.
- **Cons:** ~3× more rows than 30d at steady state; larger backups and index footprint; marginal value if incidents are debugged within weeks.

### 7 days / 180 days / longer (not recommended as primary)

- **7d:** Too aggressive for meaningful post-release comparison unless storage is critically constrained.
- **180d+:** Treat as **analytics / compliance** territory — wrong store; use a warehouse or explicit export pipeline, not unbounded Postgres growth.

**Decision:** Adopt **30 days**. Revisit **90 days** only if, after observing real insert rates and on-call patterns, teams consistently need >30d lookback **and** storage cost remains acceptable.

---

## 2. Partitioning now vs later

### Now (declined)

- Convert `event_loop_observability_events` to a partitioned table (e.g. monthly on `created_at`), repoint views, validate indexes and planner behavior.
- **Operational risks:** Migration risk on a hot path’s log table; more moving parts for a system not yet proven to need it; engineer time better spent on measured batch deletes first.

### Later (default plan)

- Stay on a **single table** until evidence appears: e.g. batch deletes routinely exceed a tolerable duration, cause lock/VACUUM pain, or row counts at 30d retention stress I/O.
- **Then** consider partitioning or table swap — as a **second** implementation phase, not a prerequisite.

---

## 3. Scheduled deletion vs partition-based retention

| Approach | Mechanism | Pros | Cons / risks |
|----------|-----------|------|----------------|
| **Batched `DELETE`** (recommended first) | Job deletes `WHERE created_at < cutoff` in chunks (time ranges or `LIMIT`) | No schema change; works with current DDL; easy to tune batch size | Long deletes without batching can lock/bloat; must monitor duration and dead tuples |
| **Drop old partitions** | Only after partitioning exists | Fast removal of old data; clean for archival | Requires partitioning migration first; wrong partition key or cadence causes operational pain |

**Decision:** Plan for **batched scheduled deletion** against the existing table. **Reject partition-based retention as the first implementation** — it couples retention to a heavier schema migration upfront.

---

## 4. Cold export — now or defer

### Defer (recommended)

- This stream is not legal-hold or revenue reporting; **30d in Postgres** is the primary operator window.
- Standing exports add buckets, credentials, monitoring, and failure modes without proven need.

### When to add export (triggers)

- Major production incident where postmortem needs raw rows older than retained window (one-off manual export may suffice).
- Impending **breaking change** to logging shape or table lifecycle (optional snapshot before cutover).
- Future **compliance** requirement explicitly covering this telemetry (then design warehouse or policy-specific store).

**Decision:** **No cold export pipeline now.** Document triggers above for a future branch.

---

## 5. Hourly rollups and read-model views

- All **`v_event_loop_*` views are non-materialized** — they read from `event_loop_observability_events` (and aggregate in SQL for hourly views).
- **Retention deletes raw rows** → hourly and row-level views **automatically reflect only surviving data**. Older hours “disappear” from rollups; that is correct behavior, not data loss in a separate rollup store.
- **No separate “rollup retention” policy** is required unless we later add **materialized** or external aggregates (out of scope).

**Operator expectation:** “Last 30 days of telemetry” applies uniformly to raw queries and read-model views.

---

## 6. Operational risks by option

| Option | Risks |
|--------|--------|
| **30d + batch DELETE** | Misconfigured cutoff (timezone / off-by-one); job failure unnoticed → table grows; heavy single delete → locks/VACUUM — mitigated by **batched** deletes and alerts on row count / job success |
| **90d instead of 30d** | Higher steady-state cost and backup size for limited incremental insight |
| **Partitioning early** | Migration bugs, view/planner regressions, operational overhead before need is proven |
| **Cold export always-on** | Credential sprawl, partial exports, cost; not justified for this use case yet |
| **No retention** | Unbounded growth, slower scans, higher backup/restore cost — unacceptable |

---

## 7. Recommended policy (summary)

1. **Retain raw observability rows for 30 days** in `event_loop_observability_events`.
2. **Enforce with batched `DELETE`** scheduled only after a separate implementation approval (not in this brief).
3. **Do not partition** until batch deletion demonstrably fails operational SLOs.
4. **Do not build cold export** until a trigger in §4 fires.
5. **Treat `v_event_loop_*` as derived** — no extra retention rules; they track the raw table.

---

## Rejected alternatives (short list)

| Alternative | Why rejected |
|-------------|--------------|
| **90d as default** | Higher cost for telemetry whose value is front-loaded; can escalate later with data |
| **Partitioning first** | Complexity before volume evidence; batch delete is the right first lever |
| **Partition-only retention without trying DELETE** | Puts schema migration ahead of a simpler tool |
| **Standing cold export** | Cost and complexity without a driver; triggers are enough |
| **Long retention in Postgres (6–12mo+)** | Wrong store; use export/warehouse if ever required |

---

## Future implementation branch (name only)

When implementation is approved:

**`phase3c/event-loop-observability-retention`**

(Rationale: follows Phase 3 / 3b sequencing; name states scope — observability table retention enforcement.)

---

## DB objects likely touched in a future implementation

*No migrations in Phase 3b; this is an inventory for the implementation branch.*

| Object | Likely change |
|--------|----------------|
| `public.event_loop_observability_events` | **`DELETE`** of expired rows (batched by `created_at`); optional **new index** review if planner needs a tighter `(created_at)` path for deletes |
| `event_loop_observability_events_created_at_idx` (and related indexes) | **Bloat / REINDEX** consideration after sustained deletes — operational, not necessarily migration |
| `public.v_event_loop_*` (10 views) | **Typically no DDL change** — views keep working; only source row set shrinks |
| `public.record_event_loop_observability` | **No change** expected |
| RLS on `event_loop_observability_events` | **No change** expected |
| **Scheduler** | **Outside DB** (e.g. Supabase `pg_cron`, external cron, or worker) — **not** decided here; if `pg_cron` is used, extension enablement is project-level |

If **partitioning** is added in a *later* phase: same logical table name may become a **partitioned parent** + child tables; views would be repointed to the parent — that would be a **dedicated migration** after the DELETE-first approach is validated.

---

## Related artifacts

- Phase 2: `supabase/migrations/20260423120000_event_loop_observability.sql`
- Phase 3 views: `supabase/migrations/20260424120000_event_loop_read_model_views.sql`
- Operator SQL: `_cursor_context/vibely_migration_manifest.md` (Phase 3)

---

## Phase 3c — implementation (landed)

**Migration:** `supabase/migrations/20260425120000_event_loop_observability_retention_prune.sql`

| Item | Detail |
|------|--------|
| **Function** | `public.prune_event_loop_observability_events(p_batch_limit integer DEFAULT 5000, p_retention_days integer DEFAULT 30)` → `jsonb` with `deleted_count`, `cutoff_utc`, `batch_limit`, `retention_days`, `has_more_to_prune` |
| **Security** | `SECURITY DEFINER`; `EXECUTE` granted to **`service_role`** only (same as other operator-only RPCs) |
| **Index used** | Existing **`event_loop_observability_events_created_at_idx`** `(created_at DESC)` — no additional index added |
| **Views / write path** | **`v_event_loop_*` DDL unchanged**; `record_event_loop_observability` and instrumented RPCs unchanged |

**Post-implementation review — partitioning:** Still **unnecessary** for the 30d batched-delete design; the btree on `created_at` supports the prune subquery. Revisit only if measured delete latency or bloat exceeds tolerances.

**Production scheduler (not in git):** Enable **`pg_cron`** on the Supabase project (Dashboard → Database → Extensions) and schedule e.g. `SELECT public.prune_event_loop_observability_events();` **daily** (or hourly while `has_more_to_prune` is frequently true). Alternative: external runner invoking SQL with the service role. **Edge Functions not required.**
