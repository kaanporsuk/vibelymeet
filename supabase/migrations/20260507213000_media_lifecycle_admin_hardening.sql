-- Media lifecycle admin hardening
--
-- Fixes operator truthfulness and scaling for the Admin Dashboard media
-- lifecycle tab:
--   1. Aggregate snapshot RPC so the Edge Function does not full-scan rows.
--   2. Family-filtered promotion for worker dry rollout/isolation.
--   3. Retry abandoned jobs in a claimable state.
--   4. Structured cron status with run ids and explicit missing/error states.

-- 1. Aggregate snapshot used by admin-media-lifecycle-controls.

CREATE OR REPLACE FUNCTION public.summarize_media_lifecycle_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_asset_status_counts jsonb := '[]'::jsonb;
  v_job_status_counts jsonb := '[]'::jsonb;
  v_orphan_like_counts jsonb := '[]'::jsonb;
  v_ready_by_family jsonb := '[]'::jsonb;
  v_failed_job_total integer := 0;
  v_orphan_like_total integer := 0;
  v_promotable_assets integer := 0;
  v_queued_jobs integer := 0;
BEGIN
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'media_family', media_family,
        'status', status,
        'job_type', NULL,
        'count', cnt
      )
      ORDER BY media_family, status
    ),
    '[]'::jsonb
  )
  INTO v_asset_status_counts
  FROM (
    SELECT media_family, status, count(*)::integer AS cnt
    FROM public.media_assets
    GROUP BY media_family, status
  ) t;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'media_family', media_family,
        'status', status,
        'job_type', job_type,
        'count', cnt
      )
      ORDER BY media_family, status, job_type
    ),
    '[]'::jsonb
  )
  INTO v_job_status_counts
  FROM (
    SELECT coalesce(a.media_family, 'unknown') AS media_family,
           j.status,
           j.job_type,
           count(*)::integer AS cnt
    FROM public.media_delete_jobs j
    LEFT JOIN public.media_assets a ON a.id = j.asset_id
    GROUP BY coalesce(a.media_family, 'unknown'), j.status, j.job_type
  ) t;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'bucket', bucket,
        'media_family', media_family,
        'count', cnt
      )
      ORDER BY bucket, media_family
    ),
    '[]'::jsonb
  ),
  coalesce(sum(cnt), 0)::integer
  INTO v_orphan_like_counts, v_orphan_like_total
  FROM (
    SELECT CASE
             WHEN a.status = 'active' THEN 'active_without_refs'
             ELSE 'stale_uploading'
           END AS bucket,
           a.media_family,
           count(*)::integer AS cnt
    FROM public.media_assets a
    WHERE (a.status = 'active'
           OR (a.status = 'uploading' AND a.created_at <= now() - interval '24 hours'))
      AND NOT EXISTS (
        SELECT 1
        FROM public.media_references r
        WHERE r.asset_id = a.id
          AND r.is_active = true
      )
    GROUP BY 1, a.media_family
  ) t;

  SELECT count(*)::integer
  INTO v_failed_job_total
  FROM public.media_delete_jobs
  WHERE status IN ('failed', 'abandoned');

  WITH promotable AS (
    SELECT a.media_family, count(*)::integer AS cnt
    FROM public.media_assets a
    JOIN public.media_retention_settings s ON s.media_family = a.media_family
    WHERE a.status = 'soft_deleted'
      AND a.purge_after IS NOT NULL
      AND a.purge_after <= now()
      AND s.worker_enabled = true
      AND NOT EXISTS (
        SELECT 1
        FROM public.media_references r
        WHERE r.asset_id = a.id
          AND r.is_active = true
      )
    GROUP BY a.media_family
  ),
  queued AS (
    SELECT a.media_family, count(*)::integer AS cnt
    FROM public.media_delete_jobs j
    JOIN public.media_assets a ON a.id = j.asset_id
    JOIN public.media_retention_settings s ON s.media_family = a.media_family
    WHERE j.status IN ('pending', 'failed')
      AND j.next_attempt_at <= now()
      AND j.attempts < j.max_attempts
      AND s.worker_enabled = true
    GROUP BY a.media_family
  ),
  combined AS (
    SELECT coalesce(p.media_family, q.media_family) AS media_family,
           coalesce(p.cnt, 0) AS promotable_assets,
           coalesce(q.cnt, 0) AS queued_jobs
    FROM promotable p
    FULL OUTER JOIN queued q ON q.media_family = p.media_family
  )
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'media_family', media_family,
               'promotable_assets', promotable_assets,
               'queued_jobs', queued_jobs,
               'total_candidates', promotable_assets + queued_jobs
             )
             ORDER BY media_family
           ) FILTER (WHERE promotable_assets + queued_jobs > 0),
           '[]'::jsonb
         ),
         coalesce(sum(promotable_assets), 0)::integer,
         coalesce(sum(queued_jobs), 0)::integer
  INTO v_ready_by_family, v_promotable_assets, v_queued_jobs
  FROM combined;

  RETURN jsonb_build_object(
    'asset_status_counts', v_asset_status_counts,
    'job_status_counts', v_job_status_counts,
    'orphan_like_counts', v_orphan_like_counts,
    'orphan_like_total', v_orphan_like_total,
    'failed_job_total', v_failed_job_total,
    'would_process_now', jsonb_build_object(
      'promotable_assets', v_promotable_assets,
      'queued_jobs', v_queued_jobs,
      'total_candidates', v_promotable_assets + v_queued_jobs,
      'by_family', v_ready_by_family,
      'explanation', 'Read-only aggregate preview that combines claimable pending/failed jobs with soft_deleted assets a real run would promote before claiming. No mutations are performed.'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.summarize_media_lifecycle_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.summarize_media_lifecycle_snapshot() TO service_role;


-- 2. Add a family filter to purgeable promotion. Drop the old one-argument
-- function first so PostgREST RPC resolution remains unambiguous.

DROP FUNCTION IF EXISTS public.promote_purgeable_assets(integer);

CREATE OR REPLACE FUNCTION public.promote_purgeable_assets(
  p_limit integer DEFAULT 100,
  p_family_filter text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count integer := 0;
  v_asset record;
BEGIN
  IF p_limit < 1 THEN
    RAISE EXCEPTION 'p_limit must be >= 1';
  END IF;

  IF p_family_filter IS NOT NULL THEN
    PERFORM 1 FROM public.media_retention_settings WHERE media_family = p_family_filter;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown media family: %', p_family_filter;
    END IF;
  END IF;

  FOR v_asset IN
    SELECT a.id
    FROM public.media_assets a
    JOIN public.media_retention_settings s ON s.media_family = a.media_family
    WHERE a.status = 'soft_deleted'
      AND a.purge_after IS NOT NULL
      AND a.purge_after <= now()
      AND s.worker_enabled = true
      AND (p_family_filter IS NULL OR a.media_family = p_family_filter)
      AND NOT EXISTS (
        SELECT 1 FROM public.media_references r
        WHERE r.asset_id = a.id AND r.is_active = true
      )
    ORDER BY a.purge_after ASC
    LIMIT p_limit
    FOR UPDATE OF a SKIP LOCKED
  LOOP
    UPDATE public.media_assets SET status = 'purge_ready' WHERE id = v_asset.id;
    PERFORM public.enqueue_media_delete(v_asset.id, 'purge');
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_purgeable_assets(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_purgeable_assets(integer, text) TO service_role;


-- 3. Make abandoned retries claimable. The old RPC kept attempts at max, which
-- returned success but left abandoned jobs excluded by claim_media_delete_jobs.

DROP FUNCTION IF EXISTS public.retry_failed_media_delete_jobs(text, integer, boolean);

CREATE OR REPLACE FUNCTION public.retry_failed_media_delete_jobs(
  p_family         text    DEFAULT NULL,
  p_limit          integer DEFAULT 50,
  p_reset_attempts boolean DEFAULT false,
  p_status         text    DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 500';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('failed', 'abandoned') THEN
    RAISE EXCEPTION 'p_status must be failed, abandoned, or null';
  END IF;

  IF p_family IS NOT NULL THEN
    PERFORM 1 FROM public.media_retention_settings WHERE media_family = p_family;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown media family: %', p_family;
    END IF;
  END IF;

  UPDATE public.media_delete_jobs AS target_job
  SET
    status          = 'pending',
    next_attempt_at = now(),
    attempts        = CASE
                        WHEN p_reset_attempts OR target_job.status = 'abandoned' THEN 0
                        WHEN target_job.attempts >= target_job.max_attempts THEN GREATEST(target_job.max_attempts - 1, 0)
                        ELSE target_job.attempts
                      END,
    last_error      = NULL,
    worker_id       = NULL,
    started_at      = NULL,
    updated_at      = now()
  WHERE target_job.id IN (
    SELECT j.id
    FROM public.media_delete_jobs j
    JOIN public.media_assets a ON a.id = j.asset_id
    WHERE j.status IN ('failed', 'abandoned')
      AND (p_status IS NULL OR j.status = p_status)
      AND (p_family IS NULL OR a.media_family = p_family)
    ORDER BY j.created_at
    LIMIT p_limit
  );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.retry_failed_media_delete_jobs(text, integer, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retry_failed_media_delete_jobs(text, integer, boolean, text) TO service_role;


-- 4. Structured cron status and stable run ids for the admin panel.

CREATE OR REPLACE FUNCTION public.get_media_worker_cron_status(
  p_job_name  text    DEFAULT 'media-delete-worker-every-15m',
  p_run_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_job_id     bigint;
  v_jobname    text;
  v_schedule   text;
  v_active     boolean;
  v_runs_arr   jsonb  := '[]'::jsonb;
  v_runid      bigint;
  v_run_status text;
  v_run_start  timestamptz;
  v_run_end    timestamptz;
  v_dur_ms     numeric;
  v_runs_available boolean := true;
  v_runs_error text := NULL;

  v_last_succeeded  text    := NULL;
  v_last_failed     text    := NULL;
  v_consec_fail     integer := 0;
  v_stop_counting   boolean := false;
BEGIN
  IF p_run_limit < 0 OR p_run_limit > 100 THEN
    RAISE EXCEPTION 'p_run_limit must be between 0 and 100';
  END IF;

  SELECT jobid, jobname, schedule, active
  INTO v_job_id, v_jobname, v_schedule, v_active
  FROM cron.job
  WHERE jobname = p_job_name
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'found', false,
      'status', 'missing_job',
      'jobname', p_job_name,
      'recent_runs', '[]'::jsonb
    );
  END IF;

  BEGIN
    FOR v_runid, v_run_status, v_run_start, v_run_end IN
      SELECT runid, status, start_time, end_time
      FROM cron.job_run_details
      WHERE jobid = v_job_id
      ORDER BY runid DESC
      LIMIT p_run_limit
    LOOP
      v_dur_ms := CASE
        WHEN v_run_end IS NOT NULL
        THEN extract(epoch FROM (v_run_end - v_run_start)) * 1000
        ELSE NULL
      END;

      v_runs_arr := v_runs_arr || jsonb_build_array(
        jsonb_build_object(
          'runid',       v_runid,
          'status',      v_run_status,
          'start_time',  to_char(v_run_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'end_time',    CASE WHEN v_run_end IS NOT NULL
                           THEN to_char(v_run_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                           ELSE NULL END,
          'duration_ms', v_dur_ms
        )
      );

      IF v_last_succeeded IS NULL AND v_run_status = 'succeeded' THEN
        v_last_succeeded := to_char(v_run_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
      END IF;

      IF NOT v_stop_counting THEN
        IF v_run_status = 'succeeded' THEN
          v_stop_counting := true;
        ELSE
          v_consec_fail := v_consec_fail + 1;
          IF v_last_failed IS NULL THEN
            v_last_failed := to_char(v_run_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
          END IF;
        END IF;
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    v_runs_available := false;
    v_runs_error := SQLERRM;
    v_runs_arr := '[]'::jsonb;
  END;

  RETURN jsonb_build_object(
    'found',                true,
    'status',               CASE
                              WHEN NOT v_active THEN 'inactive'
                              WHEN NOT v_runs_available THEN 'recent_runs_unavailable'
                              ELSE 'found'
                            END,
    'job_id',               v_job_id,
    'jobname',              v_jobname,
    'schedule',             v_schedule,
    'active',               v_active,
    'recent_runs',          v_runs_arr,
    'recent_runs_error',    v_runs_error,
    'last_succeeded_at',    v_last_succeeded,
    'last_failed_at',       v_last_failed,
    'consecutive_failures', v_consec_fail
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_media_worker_cron_status(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_media_worker_cron_status(text, integer) TO service_role;
