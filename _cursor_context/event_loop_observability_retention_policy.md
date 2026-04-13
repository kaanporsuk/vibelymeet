# Event loop observability — retention & storage policy (design only)

**Status:** policy / architecture (Phase 3b). **No** cron jobs, deletion SQL, Edge Functions, or admin UI in this phase unless explicitly approved after review.

**Scope:** `public.event_loop_observability_events` and its dependent `public.v_event_loop_*` views (views are non-materialized; they reflect whatever rows remain in the base table).

---

## 1. Goals

- Cap unbounded growth of append-only observability rows without changing product behavior.
- Keep operator SQL (`v_event_loop_*`, ad-hoc queries) fast enough for incident triage.
- Preserve enough history to debug promotion/drain/expiry regressions (days to low weeks, not years).
- Avoid treating this stream as durable analytics — it is **operational telemetry**, not a warehouse fact table.

---

## 2. Data characteristics

- **Volume driver:** one row per instrumented RPC invocation (promote, drain, expire, mark lobby, mutual swipe paths).
- **PII:** intentionally minimal (UUIDs for `event_id`, `actor_id`, `session_id`); still treat as internal ops data.
- **Retention impact on views:** hourly rollups are computed at query time from surviving rows. Deleting old base-table rows removes them from rollups automatically; there is no separate “rollup table” to backfill unless we add one later.

---

## 3. Retention window (proposal)

| Tier | Retention | Use case |
|------|-----------|----------|
| **Default (recommended starting point)** | **30 days** live in Postgres | On-call triage, recent regression analysis |
| **Extended** | **90 days** | If incident patterns need a longer lookback before cold export exists |

**Decision rule:** after Phase 3 has been live, compare approximate daily insert rate × row size to project storage and backup budgets. If 30 days is too tight for your mean-time-to-detect issues, move to 90 days before adding operational complexity (partitioning, exports).

**Explicit non-goals for this stream:** multi-year retention, user-facing exports, GDPR “delete my telemetry” (handled by broader account deletion policy if ever required).

---

## 4. Partitioning vs simple retention

### Option A — Single table + periodic `DELETE`

- **Pros:** simplest; matches current schema; one migration + one job later.
- **Cons:** large deletes can bloat indexes and cause long transactions unless batched (e.g. by `created_at` range in chunks).

**Fit:** low to moderate insert rates and moderate total rows at the chosen retention window.

### Option B — Time-based partitioning (e.g. monthly on `created_at`)

- **Pros:** drop or detach old partitions quickly with minimal vacuum pain; aligns with cold archival (export partition, then drop).
- **Cons:** migration complexity; must validate all queries and views; Supabase/Postgres operational discipline for partition maintenance.

**Fit:** sustained high write volume or strict operational windows for bulk removal.

**Recommendation:** start with **Option A** and a **batch delete** design in a future implementation phase; revisit partitioning if inserts/day exceed a threshold agreed with ops (document the threshold when known).

---

## 5. Rollups and “backfill” expectations

- **`v_event_loop_*` hourly views:** derived from the append-only log. There is **no** persisted rollup table in Phase 3.
- **After raw data older than the retention cutoff is removed:** corresponding hours disappear from hourly views — this is expected; it is not “misstated,” it reflects retained data only.
- **If long-lived KPIs are ever needed:** introduce an explicit **materialized** or **warehouse** pipeline (out of scope here) rather than extending Postgres retention indefinitely.

---

## 6. Export / cold storage

- **Optional:** before aggressive truncation or partition drop, export a window (e.g. last 7 days of incidents) to object storage (Parquet/CSV) for postmortems.
- **Triggers:** major incident, schema change to logging, or migration from Option A → B.
- **Not required** for day-one retention if 30–90 days in Postgres is sufficient and storage costs are acceptable.

---

## 7. Security and access (unchanged)

- Retention must **not** widen access: same as Phase 2/3 — **service role** / SQL editor; no `anon`/`authenticated` grants on telemetry or views.
- Any future job that deletes rows should run with a dedicated role and least privilege (implementation phase).

---

## 8. Implementation gate (future, not in Phase 3b doc)

Do **not** schedule deletes until:

1. This policy is reviewed (window, Option A vs B, export yes/no).
2. Approximate growth is observed on the linked project.
3. Batching strategy and monitoring (rows deleted, job duration) are specified.

---

## 9. Related repo artifacts

- Phase 2 table + RPC instrumentation: `supabase/migrations/20260423120000_event_loop_observability.sql`
- Phase 3 read model: `supabase/migrations/20260424120000_event_loop_read_model_views.sql`
- Operator queries: `_cursor_context/vibely_migration_manifest.md` (Phase 3 SQL pack)
