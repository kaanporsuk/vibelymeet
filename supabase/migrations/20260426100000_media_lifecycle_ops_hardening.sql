-- ─────────────────────────────────────────────────────────────────────────────
-- Media Lifecycle — Ops Hardening (Sprint 4 follow-up)
-- Migration: 20260426100000_media_lifecycle_ops_hardening.sql
--
-- Adds three service-role-only operator RPCs:
--   1. summarize_media_lifecycle_health()
--   2. requeue_stale_media_delete_jobs(p_stale_minutes int DEFAULT 30)
--   3. retry_failed_media_delete_jobs(p_family, p_limit, p_reset_attempts)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. summarize_media_lifecycle_health ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.summarize_media_lifecycle_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset_counts       jsonb;
  v_job_counts         jsonb;
  v_failed_count       bigint := 0;
  v_abandoned_count    bigint := 0;
  v_stale_claimed      bigint := 0;
  v_promotable_now     bigint := 0;
  v_pending_jobs       bigint := 0;
  v_disabled_families  jsonb;
BEGIN
  SELECT coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
  INTO v_asset_counts
  FROM (SELECT status, count(*) AS cnt FROM media_assets GROUP BY status) t;

  SELECT coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
  INTO v_job_counts
  FROM (SELECT status, count(*) AS cnt FROM media_delete_jobs GROUP BY status) t;

  SELECT count(*) INTO v_failed_count
  FROM media_delete_jobs WHERE status = 'failed';

  SELECT count(*) INTO v_abandoned_count
  FROM media_delete_jobs WHERE status = 'abandoned';

  SELECT count(*) INTO v_stale_claimed
  FROM media_delete_jobs
  WHERE status = 'claimed' AND started_at < now() - interval '30 minutes';

  SELECT count(*) INTO v_promotable_now
  FROM media_assets a
  JOIN media_retention_settings mrs ON mrs.media_family = a.media_family
  WHERE a.status = 'soft_deleted'
    AND a.purge_after IS NOT NULL
    AND a.purge_after <= now()
    AND mrs.worker_enabled = true;

  SELECT count(*) INTO v_pending_jobs
  FROM media_delete_jobs WHERE status = 'pending';

  SELECT coalesce(jsonb_agg(media_family ORDER BY media_family), '[]'::jsonb)
  INTO v_disabled_families
  FROM media_retention_settings WHERE worker_enabled = false;

  RETURN jsonb_build_object(
    'healthy',             (v_failed_count = 0 AND v_abandoned_count = 0 AND v_stale_claimed = 0),
    'asset_counts',        v_asset_counts,
    'job_counts',          v_job_counts,
    'failed_count',        v_failed_count,
    'abandoned_count',     v_abandoned_count,
    'stale_claimed_count', v_stale_claimed,
    'promotable_now',      v_promotable_now,
    'pending_jobs',        v_pending_jobs,
    'disabled_families',   v_disabled_families,
    'snapshot_at',         to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.summarize_media_lifecycle_health() TO service_role;
REVOKE EXECUTE ON FUNCTION public.summarize_media_lifecycle_health() FROM anon, authenticated;


-- ── 2. requeue_stale_media_delete_jobs ──────────────────────────────────────
-- Moves claimed jobs whose started_at is older than p_stale_minutes back to
-- pending. Safe to call repeatedly (idempotent on the same stuck jobs).

CREATE OR REPLACE FUNCTION public.requeue_stale_media_delete_jobs(
  p_stale_minutes integer DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_stale_minutes < 1 THEN
    RAISE EXCEPTION 'p_stale_minutes must be >= 1';
  END IF;

  UPDATE media_delete_jobs
  SET
    status     = 'pending',
    worker_id  = NULL,
    started_at = NULL,
    updated_at = now()
  WHERE
    status     = 'claimed'
    AND started_at < now() - (p_stale_minutes || ' minutes')::interval;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.requeue_stale_media_delete_jobs(integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.requeue_stale_media_delete_jobs(integer) FROM anon, authenticated;


-- ── 3. retry_failed_media_delete_jobs ───────────────────────────────────────
-- Resets failed/abandoned jobs to pending so the next worker run picks them
-- up. p_reset_attempts=true resets the counter (use only when the provider
-- error is known-resolved). p_family narrows to one family.

CREATE OR REPLACE FUNCTION public.retry_failed_media_delete_jobs(
  p_family         text    DEFAULT NULL,
  p_limit          integer DEFAULT 50,
  p_reset_attempts boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 500';
  END IF;

  IF p_family IS NOT NULL THEN
    PERFORM 1 FROM media_retention_settings WHERE media_family = p_family;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown media family: %', p_family;
    END IF;
  END IF;

  UPDATE media_delete_jobs
  SET
    status          = 'pending',
    next_attempt_at = now(),
    attempts        = CASE WHEN p_reset_attempts THEN 0 ELSE attempts END,
    last_error      = NULL,
    worker_id       = NULL,
    updated_at      = now()
  WHERE id IN (
    SELECT j.id
    FROM media_delete_jobs j
    JOIN media_assets a ON a.id = j.asset_id
    WHERE j.status IN ('failed', 'abandoned')
      AND (p_family IS NULL OR a.media_family = p_family)
    ORDER BY j.created_at
    LIMIT p_limit
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.retry_failed_media_delete_jobs(text, integer, boolean) TO service_role;
REVOKE EXECUTE ON FUNCTION public.retry_failed_media_delete_jobs(text, integer, boolean) FROM anon, authenticated;
