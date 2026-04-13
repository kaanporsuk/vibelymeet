-- ─────────────────────────────────────────────────────────────────────────────
-- Media lifecycle — cron status helper RPC
-- Migration: 20260426110000_media_cron_status_rpc.sql
--
-- The cron schema is not exposed by PostgREST, so the Edge Function cannot
-- query cron.job or cron.job_run_details through the JS client .schema() path.
-- This SECURITY DEFINER RPC wraps both queries so service_role can call it
-- via supabase.rpc() from inside the Edge Function.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_media_worker_cron_status(
  p_job_name  text    DEFAULT 'media-delete-worker-every-15m',
  p_run_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  v_job_id     bigint;
  v_jobname    text;
  v_schedule   text;
  v_active     boolean;
  v_runs_arr   jsonb  := '[]'::jsonb;
  v_run_status text;
  v_run_start  timestamptz;
  v_run_end    timestamptz;
  v_dur_ms     numeric;

  v_last_succeeded  text    := NULL;
  v_last_failed     text    := NULL;
  v_consec_fail     integer := 0;
  v_stop_counting   boolean := false;
BEGIN
  -- Fetch the cron job row
  SELECT jobid, jobname, schedule, active
  INTO v_job_id, v_jobname, v_schedule, v_active
  FROM cron.job
  WHERE jobname = p_job_name
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'jobname', p_job_name);
  END IF;

  -- Build recent_runs array and compute derived fields in one pass
  FOR v_run_status, v_run_start, v_run_end IN
    SELECT status, start_time, end_time
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
        'status',      v_run_status,
        'start_time',  to_char(v_run_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'end_time',    CASE WHEN v_run_end IS NOT NULL
                         THEN to_char(v_run_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                         ELSE NULL END,
        'duration_ms', v_dur_ms
      )
    );

    -- Track last_succeeded_at (first succeeded in DESC order = most recent)
    IF v_last_succeeded IS NULL AND v_run_status = 'succeeded' THEN
      v_last_succeeded := to_char(v_run_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
    END IF;

    -- Count consecutive failures from most recent run backwards
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

  RETURN jsonb_build_object(
    'found',                true,
    'job_id',               v_job_id,
    'jobname',              v_jobname,
    'schedule',             v_schedule,
    'active',               v_active,
    'recent_runs',          v_runs_arr,
    'last_succeeded_at',    v_last_succeeded,
    'last_failed_at',       v_last_failed,
    'consecutive_failures', v_consec_fail
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_media_worker_cron_status(text, integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_media_worker_cron_status(text, integer) FROM anon, authenticated;
