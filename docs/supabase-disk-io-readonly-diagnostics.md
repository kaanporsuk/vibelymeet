# Supabase Disk IO — Read-Only Live Evidence Queries

> **Purpose:** collect the live database evidence that the static audit ([supabase-disk-io-diagnosis.md](supabase-disk-io-diagnosis.md)) could not collect. Every query in this file is **read-only**. Nothing here mutates rows, schema, indexes, jobs, or extensions.
>
> **Where to run:** Supabase Studio → SQL editor (or any read-only `psql` session). Project ref: `schdyxcunwcvddlcshwd`.
>
> **What this file is NOT:** an implementation plan. It does not propose `CREATE`, `ALTER`, `DROP`, `DELETE`, `UPDATE`, `INSERT`, `TRUNCATE`, `VACUUM`, `ANALYZE`, `REINDEX`, `pg_terminate_backend`, or `cron.schedule/unschedule`. If you need any of those, it belongs in a separate, reviewed migration — not in this diagnostic pass.

---

## 0. Pre-flight — extension and privilege check (read-only)

```sql
-- Confirm pg_stat_statements is installed. If not, do NOT enable it from this file.
-- Supabase usually has it on; if missing, surface a separate request to the operator.
SELECT extname, extversion
FROM   pg_extension
WHERE  extname IN ('pg_stat_statements', 'pg_cron', 'pg_net', 'pgstattuple');

-- What roles can I read these stats as? The Supabase Studio SQL editor runs
-- as a privileged role; pg_stat_statements requires pg_read_all_stats or
-- ownership in many setups.
SELECT current_user, current_role, session_user;
```

**If `pg_stat_statements` is missing:** stop and ask the operator to enable it via the Supabase dashboard. Do **not** enable it from a SQL file.

---

## 1. Top IO-heavy queries (the headline evidence)

```sql
-- 1a. Top 25 queries by total shared block reads (rough proxy for Disk IO).
SELECT
    substring(query, 1, 240)            AS query_excerpt,
    calls,
    rows,
    total_exec_time::int                AS total_ms,
    mean_exec_time::numeric(10,2)       AS mean_ms,
    shared_blks_read,
    shared_blks_hit,
    shared_blks_dirtied,
    temp_blks_read,
    temp_blks_written
FROM   pg_stat_statements
ORDER BY shared_blks_read DESC
LIMIT  25;

-- 1b. Top 25 by total execution time (catches CPU-heavy + IO mixed).
SELECT
    substring(query, 1, 240)            AS query_excerpt,
    calls,
    total_exec_time::int                AS total_ms,
    mean_exec_time::numeric(10,2)       AS mean_ms,
    shared_blks_read,
    shared_blks_hit
FROM   pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT  25;

-- 1c. Slowest average query (high mean, possibly low call count — surfaces tail latency).
SELECT
    substring(query, 1, 240)            AS query_excerpt,
    calls,
    mean_exec_time::numeric(10,2)       AS mean_ms,
    max_exec_time::numeric(10,2)        AS max_ms,
    stddev_exec_time::numeric(10,2)     AS stddev_ms,
    shared_blks_read
FROM   pg_stat_statements
WHERE  calls >= 50              -- exclude rare one-shots
ORDER BY mean_exec_time DESC
LIMIT  25;

-- 1d. Highest temp file usage by query (memory spill → disk).
SELECT
    substring(query, 1, 240)            AS query_excerpt,
    calls,
    temp_blks_read,
    temp_blks_written,
    mean_exec_time::numeric(10,2)       AS mean_ms
FROM   pg_stat_statements
WHERE  temp_blks_written > 0
ORDER BY temp_blks_written DESC
LIMIT  25;
```

**What to compare to the static audit:**

- The hypotheses for `admin_get_engagement_analytics`, `finalize_due_events`, `claim_due_event_reminder_queue_rows`, `handle_swipe`, and `get_event_deck` should appear (or **not**) in 1a/1b. Whichever does not appear is a likely false alarm; whichever appears at top of 1a is the real cost driver.

---

## 2. Cache hit ratio (database-wide and per-table)

```sql
-- 2a. Database-wide cache hit ratio. Healthy is > 0.99.
SELECT
    datname,
    blks_read,
    blks_hit,
    CASE WHEN blks_hit + blks_read = 0 THEN NULL
         ELSE round(blks_hit::numeric / (blks_hit + blks_read), 4)
    END AS cache_hit_ratio
FROM   pg_stat_database
WHERE  datname = current_database();

-- 2b. Per-table cache hit ratio for hot tables identified in the static audit.
SELECT
    relname,
    heap_blks_read,
    heap_blks_hit,
    idx_blks_read,
    idx_blks_hit,
    CASE WHEN heap_blks_hit + heap_blks_read = 0 THEN NULL
         ELSE round(heap_blks_hit::numeric / (heap_blks_hit + heap_blks_read), 4)
    END AS heap_hit_ratio
FROM   pg_statio_user_tables
WHERE  relname IN (
    'profiles','events','event_registrations','event_swipes',
    'matches','messages','daily_drops','user_notifications',
    'event_reminder_queue','admin_activity_logs','video_sessions',
    'match_calls','support_tickets','support_ticket_replies',
    'notification_log','notifications_inbox'
)
ORDER  BY heap_blks_read DESC;
```

**What to compare:** if any hot table has `heap_hit_ratio` < 0.95, it is paying a real disk read penalty — corroborates §2/§3 hypotheses in the static audit.

---

## 3. Sequential scan pressure on hot tables

```sql
SELECT
    relname,
    seq_scan,
    seq_tup_read,
    idx_scan,
    idx_tup_fetch,
    n_live_tup,
    n_dead_tup,
    n_mod_since_analyze,
    last_autovacuum,
    last_autoanalyze
FROM   pg_stat_user_tables
WHERE  relname IN (
    'profiles','events','event_registrations','event_swipes',
    'matches','messages','daily_drops','user_notifications',
    'event_reminder_queue','admin_activity_logs','video_sessions',
    'match_calls','support_tickets','notification_log',
    'notifications_inbox','date_plans','date_suggestions',
    'media_delete_jobs','media_assets','payment_observability_logs'
)
ORDER  BY seq_tup_read DESC;
```

**What to look for:**

- High `seq_scan` and `seq_tup_read` on `events`, `profiles`, or `event_reminder_queue` → confirms suspected per-minute seq scans (rows §2.3, §2.6 of static audit).
- Large `n_dead_tup` relative to `n_live_tup` → table bloat from heavy UPDATE traffic; confirms write amplification on `daily_drops`, `user_notifications`, `event_reminder_queue`.

---

## 4. Index usage (find unused or rarely-used indexes — informational only)

```sql
-- 4a. Index scans per index on hot tables. idx_scan = 0 means the index is unused
-- since stats reset; that is informational, not a deletion mandate.
SELECT
    s.relname           AS table_name,
    i.indexrelname      AS index_name,
    i.idx_scan,
    i.idx_tup_read,
    i.idx_tup_fetch,
    pg_size_pretty(pg_relation_size(i.indexrelid)) AS index_size
FROM   pg_stat_user_indexes i
JOIN   pg_stat_user_tables  s USING (relid)
WHERE  s.relname IN (
    'profiles','events','event_registrations','event_swipes',
    'matches','messages','daily_drops','user_notifications',
    'event_reminder_queue','admin_activity_logs','video_sessions',
    'match_calls','support_tickets','notification_log','notifications_inbox'
)
ORDER  BY s.relname, i.idx_scan ASC;

-- 4b. Detect duplicate indexes (same column set; informational only).
SELECT  pg_size_pretty(SUM(pg_relation_size(idx))::bigint)         AS total_dupe_size,
        (array_agg(idx))[1]                                         AS idx1,
        (array_agg(idx))[2]                                         AS idx2,
        (array_agg(TABLE_NAME))[1]                                  AS table_name
FROM (
    SELECT  indexrelid::regclass AS idx,
            indrelid::regclass   AS TABLE_NAME,
            (indrelid::text || E'\n' || indclass::text || E'\n'
             || indkey::text || E'\n' || COALESCE(indexprs::text,'')
             || E'\n' || COALESCE(indpred::text,'')) AS KEY
    FROM    pg_index
) sub
GROUP  BY KEY HAVING COUNT(*) > 1
ORDER  BY SUM(pg_relation_size(idx)) DESC;
```

**Action policy:** the output of 4a/4b is **informational**. Do not drop any index from this evidence alone. An index with `idx_scan = 0` may be needed for an infrequent admin path. Flag candidates for a separate, reviewed migration.

---

## 5. Largest tables and indexes (capacity sense-check)

```sql
SELECT
    relname,
    pg_size_pretty(pg_relation_size(C.oid))                                 AS table_size,
    pg_size_pretty(pg_indexes_size(C.oid))                                  AS indexes_size,
    pg_size_pretty(pg_total_relation_size(C.oid) - pg_relation_size(C.oid)) AS toast_and_idx,
    pg_size_pretty(pg_total_relation_size(C.oid))                           AS total_size
FROM   pg_class C
LEFT JOIN pg_namespace N ON N.oid = C.relnamespace
WHERE  N.nspname = 'public'
AND    C.relkind = 'r'
ORDER  BY pg_total_relation_size(C.oid) DESC
LIMIT  30;
```

**What to compare:** the static audit predicted `messages`, `event_swipes`, `user_notifications`, `event_reminder_queue`, `admin_activity_logs`, `payment_observability_logs`, `daily_drops` would dominate. The real top-10 may differ — that's the signal for retention prioritisation (informational; don't delete from this file).

---

## 6. Dead-tuple pressure (write amplification proxy)

```sql
SELECT
    relname,
    n_live_tup,
    n_dead_tup,
    CASE WHEN n_live_tup = 0 THEN NULL
         ELSE round(n_dead_tup::numeric / GREATEST(n_live_tup,1), 3)
    END AS dead_ratio,
    last_autovacuum,
    last_vacuum,
    last_analyze,
    last_autoanalyze,
    n_tup_ins,
    n_tup_upd,
    n_tup_hot_upd,
    n_tup_del
FROM   pg_stat_user_tables
WHERE  schemaname = 'public'
ORDER  BY n_dead_tup DESC
LIMIT  30;
```

**What to compare:** high `n_tup_upd` with low `n_tup_hot_upd` ratio means index maintenance on every UPDATE — corroborates the `user_notifications` 4-partial-index concern and the `event_reminder_queue` claim/deliver split.

---

## 7. Temp-file / sort spill pressure

```sql
SELECT
    datname,
    temp_files,
    pg_size_pretty(temp_bytes) AS temp_bytes_pretty,
    temp_bytes,
    deadlocks,
    blk_read_time,
    blk_write_time
FROM   pg_stat_database
WHERE  datname = current_database();
```

**What to look for:** large `temp_bytes` indicates queries spilling to disk — usually a sort/aggregate without enough work_mem. Common in admin analytics on long windows.

---

## 8. Cron job runtime history (Supabase pg_cron)

```sql
-- 8a. Job inventory.
SELECT jobid, jobname, schedule, command, active, database, username
FROM   cron.job
ORDER  BY jobname;

-- 8b. Last 200 runs across all jobs — find the slow ones.
SELECT  d.runid,
        j.jobname,
        d.start_time,
        d.end_time,
        (d.end_time - d.start_time)                       AS runtime,
        d.status,
        substring(d.return_message, 1, 160)               AS return_message
FROM    cron.job_run_details d
JOIN    cron.job             j USING (jobid)
ORDER   BY d.start_time DESC
LIMIT   200;

-- 8c. Per-job runtime distribution over the last 24h.
SELECT  j.jobname,
        COUNT(*)                                                          AS runs_24h,
        round(AVG(EXTRACT(EPOCH FROM d.end_time - d.start_time))::numeric, 2) AS avg_seconds,
        round(MAX(EXTRACT(EPOCH FROM d.end_time - d.start_time))::numeric, 2) AS max_seconds,
        SUM(CASE WHEN d.status = 'failed' THEN 1 ELSE 0 END)              AS failures
FROM    cron.job_run_details d
JOIN    cron.job             j USING (jobid)
WHERE   d.start_time >= now() - interval '24 hours'
GROUP   BY j.jobname
ORDER   BY avg_seconds DESC;
```

**What to compare:** cross-reference 8c with the cron table in the static audit (§5). The audit lists 6+ jobs at `* * * * *`; if any of them runs > ~5 s on average it is a high candidate for fix work — **but only after evidence and approval**, not in this pass.

---

## 9. Targeted EXPLAINs for the suspected hotspot queries

> These are `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` recipes. They actually execute the query — `ANALYZE` here is the EXPLAIN modifier, **not** the maintenance command — so they read tuples and may take real wall-clock time. They do not write.
>
> **Risk note for `EXPLAIN ANALYZE`:** for `INSERT/UPDATE/DELETE`, EXPLAIN ANALYZE *does* execute the write. **Do not** EXPLAIN ANALYZE write statements; only run the SELECTs below.

### 9a. `finalize_due_events()` predicate (events seq scan suspect)

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, event_date, duration_minutes, archived_at, ended_at
FROM   public.events
WHERE  archived_at IS NULL
AND    ended_at    IS NULL
AND    event_date + (COALESCE(duration_minutes,0) || ' minutes')::interval
                  + interval '10 minutes'
       <= now()
LIMIT  100;
```

### 9b. `claim_due_event_reminder_queue_rows()` predicate

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, event_id, profile_id, reminder_type, created_at
FROM   public.event_reminder_queue
WHERE  delivered_at IS NULL
AND    claimed_at  IS NULL
ORDER  BY created_at
LIMIT  100;
```

### 9c. `unclaim_stale_event_reminder_queue_rows()` predicate

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, claimed_at
FROM   public.event_reminder_queue
WHERE  delivered_at IS NULL
AND    claimed_at  IS NOT NULL
AND    claimed_at  < now() - interval '120 seconds'
ORDER  BY claimed_at
LIMIT  500;
```

### 9d. `generate-daily-drops` profiles predicate (full-scan suspect)

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, gender, interested_in, age, last_seen_at, updated_at,
       is_suspended, account_paused, discoverable, discovery_mode
FROM   public.profiles
WHERE  COALESCE(is_suspended, false) = false
AND    (last_seen_at >= now() - interval '7 days'
        OR (last_seen_at IS NULL AND updated_at >= now() - interval '7 days'));
```

### 9e. `daily_drops` expire candidate

```sql
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, status, expires_at
FROM   public.daily_drops
WHERE  expires_at < now()
AND    status     IN ('active_unopened','active_viewed','active_opener_sent')
LIMIT  500;
```

### 9f. `user_notifications` unread count for a sample user

```sql
-- Replace :user_id with a real id only when reviewing privately.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT count(*)
FROM   public.user_notifications
WHERE  user_id      = :user_id
AND    read_at      IS NULL
AND    dismissed_at IS NULL;
```

**What to look for in EXPLAIN output:**

- `Seq Scan on <hot_table>` with high `actual rows` is the smoking gun for a missing partial index.
- `Buffers: shared read=…` is the disk-read attribution. Compare with `shared hit=…`.
- `Index Scan using <existing_index>` confirms the existing index is doing its job — do not propose a new one.

---

## 10. Realtime subscription fan-out (informational)

```sql
-- pg_publication contents — confirms which tables the Supabase Realtime
-- publication is broadcasting. Useful for sanity-checking the §2 row 1
-- claim that admin clients receive every mutation.
SELECT  pubname, schemaname, tablename
FROM    pg_publication_tables
ORDER   BY pubname, schemaname, tablename;

-- WAL retention pressure (high lag can indicate slow replicas / heavy writes).
SELECT  pid, application_name, state, sync_state,
        pg_wal_lsn_diff(pg_current_wal_lsn(), sent_lsn)   AS sent_lag_bytes,
        pg_wal_lsn_diff(pg_current_wal_lsn(), write_lsn)  AS write_lag_bytes,
        pg_wal_lsn_diff(pg_current_wal_lsn(), flush_lsn)  AS flush_lag_bytes,
        pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS replay_lag_bytes
FROM    pg_stat_replication;
```

---

## 11. Connection / pooler sanity (informational)

```sql
SELECT  state,
        COUNT(*)                                          AS connections,
        max(now() - state_change)                         AS oldest_in_state,
        max(now() - xact_start)                           AS oldest_xact
FROM    pg_stat_activity
WHERE   datname = current_database()
GROUP   BY state
ORDER   BY connections DESC;
```

---

## 12. Output checklist for the operator

When the operator runs this file, capture:

1. The top 10 rows from §1a and §1b (paste into the rollout plan as evidence).
2. Database-wide cache hit ratio from §2a.
3. Any table from §3 with `seq_tup_read > 1e7` over the lifetime stats window.
4. Any table from §6 with `dead_ratio > 0.2`.
5. The 5 largest tables and 5 largest indexes from §5.
6. The §8c cron runtime distribution.
7. The EXPLAIN output for §9a–9e.

These outputs become the input to **Phase 0 evidence gate** in [supabase-disk-io-minimum-risk-rollout-plan.md](supabase-disk-io-minimum-risk-rollout-plan.md). Until that gate passes, no implementation work begins.

---

## What this file deliberately does not include

- `CREATE INDEX` / `DROP INDEX`
- `DELETE`, `UPDATE`, `INSERT`, `TRUNCATE`
- `ALTER TABLE` / `ALTER FUNCTION` / `ALTER ROLE`
- `VACUUM`, `ANALYZE` (the maintenance commands; `EXPLAIN ANALYZE` modifier is allowed for SELECTs only)
- `REINDEX`
- `cron.schedule`, `cron.unschedule`
- `pg_terminate_backend`, `pg_cancel_backend`
- Any extension `CREATE EXTENSION` / `ALTER EXTENSION`
- Any function/RPC redefinition

If a future fix requires any of these, it goes through a separate reviewed migration — never from this diagnostics file.
