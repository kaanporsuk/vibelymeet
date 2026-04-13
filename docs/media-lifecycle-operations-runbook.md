# Media Lifecycle Operations Runbook

Updated: 2026-04-14

This runbook is the operator guide for Vibely's live media lifecycle system, covering Sprints 1–4 plus ops hardening.

---

## Live system summary

| Item | Value |
|---|---|
| Linked project | `schdyxcunwcvddlcshwd` |
| Worker function | `process-media-delete-jobs` ACTIVE |
| Admin function | `admin-media-lifecycle-controls` ACTIVE |
| Cron job | `media-delete-worker-every-15m` (jobid 18) |
| Schedule | `*/15 * * * *` — every 15 minutes |
| Batch size | 200 (sent in body as `batch_size`) |
| Cron status | **ENABLED** (2026-04-14) |

---

## Admin controls

Sprint 4 added:
- Edge Function `admin-media-lifecycle-controls` — retention settings, ops summary, retry/requeue actions
- Web admin panel `AdminMediaLifecyclePanel` — live view of cron status, health, failed jobs, stale jobs, and all retention controls

The admin panel is at `/admin` → Media lifecycle.

### Admin panel surfaces (ops hardening, 2026-04-14)

| Section | What it shows |
|---|---|
| System health | healthy flag, failed+abandoned count, stale claimed count, promotable now |
| Cron scheduler | job name, ID, schedule, active/paused, last succeeded, consecutive failures |
| Recent worker runs | last 10 scheduled executions with status + duration |
| Failed/abandoned jobs | table with per-row error, attempts, family; Retry all + Retry by family buttons |
| Stale claimed jobs | table of jobs stuck >30m in claimed state; Requeue all stale button |
| Asset & job state counts | live counts by family × status for both assets and jobs |
| Owned media retention | per-family retention_days + worker_enabled toggle |
| Chat media policy | shared retention_mode + eligible_days + worker_enabled |

---

## Monitoring

### Healthy state check (SQL)

```sql
-- One-shot health summary
SELECT summarize_media_lifecycle_health();

-- Expected healthy output:
-- { "healthy": true, "failed_count": 0, "abandoned_count": 0,
--   "stale_claimed_count": 0, "promotable_now": 0, ... }
```

### Asset counts by family / status

```sql
SELECT media_family, status, count(*)
FROM media_assets
GROUP BY media_family, status
ORDER BY media_family, status;
```

### Job counts by status

```sql
SELECT status, count(*) FROM media_delete_jobs GROUP BY status;
```

### Failed / abandoned jobs

```sql
SELECT j.id, a.media_family, j.status, j.attempts, j.max_attempts,
       j.last_error, j.created_at
FROM media_delete_jobs j
JOIN media_assets a ON a.id = j.asset_id
WHERE j.status IN ('failed', 'abandoned')
ORDER BY j.created_at;
```

### Stale claimed jobs (stuck >30 min)

```sql
SELECT j.id, a.media_family, j.status, j.worker_id, j.started_at, j.attempts
FROM media_delete_jobs j
JOIN media_assets a ON a.id = j.asset_id
WHERE j.status = 'claimed'
  AND j.started_at < now() - interval '30 minutes'
ORDER BY j.started_at;
```

### Recent cron run history

```sql
SELECT runid, status, start_time, end_time,
       extract(epoch FROM (end_time - start_time)) * 1000 AS duration_ms
FROM cron.job_run_details
WHERE jobid = 18   -- media-delete-worker-every-15m
ORDER BY runid DESC
LIMIT 20;
```

### Promotable assets (would be picked up next run)

```sql
SELECT a.id, a.media_family, a.status, a.purge_after
FROM media_assets a
JOIN media_retention_settings mrs ON mrs.media_family = a.media_family
WHERE a.status = 'soft_deleted'
  AND a.purge_after IS NOT NULL
  AND a.purge_after <= now()
  AND mrs.worker_enabled = true
ORDER BY a.purge_after;
```

### Upcoming purge backlog (next 30 days)

```sql
SELECT media_family, count(*), min(purge_after) AS earliest
FROM media_assets
WHERE status = 'soft_deleted' AND purge_after IS NOT NULL
GROUP BY media_family
ORDER BY earliest;
```

---

## Scheduler settings

### View / change cadence

The schedule lives in `cron.job`. To inspect:

```sql
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'media-delete-worker-every-15m';
```

To change cadence (e.g., hourly):

```sql
SELECT cron.unschedule('media-delete-worker-every-15m');
SELECT cron.schedule(
  'media-delete-worker-every-15m',
  '0 * * * *',  -- hourly
  $$
  SELECT net.http_post(
    url := trim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1))
      || '/functions/v1/process-media-delete-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || trim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1))
    ),
    body := '{"batch_size": 200}'::jsonb
  );
  $$
);
```

### Disable the scheduler

```sql
-- Soft disable (keeps row, re-enable later):
UPDATE cron.job SET active = false WHERE jobname = 'media-delete-worker-every-15m';

-- Re-enable:
UPDATE cron.job SET active = true WHERE jobname = 'media-delete-worker-every-15m';

-- Full removal:
SELECT cron.unschedule('media-delete-worker-every-15m');
```

---

## Retry and recovery

### Retry failed / abandoned jobs

Via admin panel: Failed jobs section → **Retry all** or **Retry [family]**.

Via SQL (operator direct):

```sql
-- Retry all failed + abandoned (keeps attempt count, resets next_attempt_at to now)
SELECT retry_failed_media_delete_jobs();

-- Retry one family only
SELECT retry_failed_media_delete_jobs(p_family := 'vibe_video');

-- Retry with attempt counter reset (use only when provider error is resolved)
SELECT retry_failed_media_delete_jobs(p_reset_attempts := true);
```

### Requeue stale claimed jobs

Via admin panel: Stale claimed jobs section → **Requeue all stale**.

Via SQL:

```sql
-- Requeue jobs stuck in claimed for >30 min
SELECT requeue_stale_media_delete_jobs(30);

-- More aggressive: requeue stuck for >5 min
SELECT requeue_stale_media_delete_jobs(5);
```

### Pause a specific media family

Via admin panel: Owned media retention → toggle **Worker** off → Save.

Via SQL (direct):

```sql
UPDATE media_retention_settings
SET worker_enabled = false, updated_at = now()
WHERE media_family = 'vibe_video';  -- or any family
```

To re-enable:

```sql
UPDATE media_retention_settings
SET worker_enabled = true, updated_at = now()
WHERE media_family = 'vibe_video';
```

### Reduce batch size

The batch size is sent in the cron job body. To change it temporarily:

```sql
-- View current command
SELECT command FROM cron.job WHERE jobname = 'media-delete-worker-every-15m';

-- Rebuild with smaller batch (e.g., 10)
SELECT cron.unschedule('media-delete-worker-every-15m');
SELECT cron.schedule(
  'media-delete-worker-every-15m',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := trim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1))
      || '/functions/v1/process-media-delete-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || trim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1))
    ),
    body := '{"batch_size": 10}'::jsonb
  );
  $$
);
```

---

## Healthy state verification checklist

Run this after any incident or configuration change:

```sql
-- 1. Health summary
SELECT summarize_media_lifecycle_health();
-- Expect: healthy=true, failed_count=0, abandoned_count=0, stale_claimed_count=0

-- 2. No stuck jobs
SELECT status, count(*) FROM media_delete_jobs GROUP BY status;
-- Expect: only completed rows (or pending if a run just happened)

-- 3. No purge_ready assets stuck without jobs
SELECT a.id, a.media_family FROM media_assets a
WHERE a.status = 'purge_ready'
  AND NOT EXISTS (SELECT 1 FROM media_delete_jobs j WHERE j.asset_id = a.id AND j.status IN ('pending','claimed'));
-- Expect: 0 rows

-- 4. Cron still active
SELECT active FROM cron.job WHERE jobname = 'media-delete-worker-every-15m';
-- Expect: true

-- 5. Retention settings unchanged
SELECT media_family, worker_enabled FROM media_retention_settings ORDER BY media_family;
-- Expect: verification_selfie = false, all others = true

-- 6. Recent runs all succeeded
SELECT status, count(*) FROM cron.job_run_details WHERE jobid = 18 ORDER BY status;
-- Expect: mostly succeeded
```

---

## Incident response

### Worker runs failing (status=failed in cron.job_run_details)

1. Check function logs: `npx supabase functions logs process-media-delete-jobs --project-ref schdyxcunwcvddlcshwd`
2. Check `media_delete_jobs` for job-level errors: `SELECT last_error FROM media_delete_jobs WHERE status = 'failed' LIMIT 10;`
3. If a provider (Bunny) is down: pause the affected family via admin panel
4. Once provider is back: retry via admin panel or `retry_failed_media_delete_jobs(p_reset_attempts := true)`

### Jobs stuck in claimed (worker crash)

1. Check stale claimed: `SELECT requeue_stale_media_delete_jobs(30);`
2. If jobs are still claimed after requeue, investigate worker_id for which pod crashed
3. If issue persists, reduce batch size and re-run

### Unexpected asset deletions

1. Check `media_assets` for assets purged in the last 24h: `SELECT * FROM media_assets WHERE status = 'purged' AND purged_at > now() - interval '24 hours';`
2. Check `media_delete_jobs` for the corresponding job records
3. If wrong assets were deleted: restore from Bunny storage or Bunny stream recycle bin if available
4. Investigate whether `release_media_reference` was called with wrong parameters

### Cron stops running

1. Check `cron.job`: `SELECT active FROM cron.job WHERE jobname = 'media-delete-worker-every-15m';`
2. If inactive: `UPDATE cron.job SET active = true WHERE jobname = 'media-delete-worker-every-15m';`
3. Check pg_cron extension is enabled: `SELECT * FROM pg_extension WHERE extname = 'pg_cron';`

---

## Rollback commands

```sql
-- Disable cron (soft):
UPDATE cron.job SET active = false WHERE jobname = 'media-delete-worker-every-15m';

-- Remove cron entirely:
SELECT cron.unschedule('media-delete-worker-every-15m');

-- Pause all media worker families:
UPDATE media_retention_settings SET worker_enabled = false WHERE media_family != 'verification_selfie';

-- Re-enable all (except verification_selfie which stays false):
UPDATE media_retention_settings SET worker_enabled = true WHERE media_family NOT IN ('verification_selfie');
```

---

## New RPCs added in ops hardening (2026-04-14)

| RPC | Caller | Purpose |
|---|---|---|
| `summarize_media_lifecycle_health()` | service_role | Returns JSONB health snapshot with counts, failures, stale claims, promotable backlog |
| `requeue_stale_media_delete_jobs(p_stale_minutes int)` | service_role | Releases stuck claimed jobs back to pending |
| `retry_failed_media_delete_jobs(p_family, p_limit, p_reset_attempts)` | service_role | Resets failed/abandoned jobs to pending for re-processing |

---

## Deploy notes

```bash
# Deploy worker
npx supabase functions deploy process-media-delete-jobs --project-ref schdyxcunwcvddlcshwd

# Deploy admin controls
npx supabase functions deploy admin-media-lifecycle-controls --project-ref schdyxcunwcvddlcshwd

# Manual dry-run test
curl -X POST "https://schdyxcunwcvddlcshwd.supabase.co/functions/v1/process-media-delete-jobs" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true}'
```

Cron enabled 2026-04-14 as `media-delete-worker-every-15m` (jobid 18, `*/15 * * * *`).
