-- Optional pg_cron: detect one-sided post-date verdicts once per hour.
-- The detector is SECURITY DEFINER in 20260501103000 and only records an
-- observability row; it does not create matches or mutate user verdicts.

DO $$
DECLARE
  v_job_id integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO v_job_id
    FROM cron.job
    WHERE jobname = 'post-date-half-verdict-timeout-detection'
    LIMIT 1;

    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
      'post-date-half-verdict-timeout-detection',
      '17 * * * *',
      'SELECT public.detect_post_date_half_verdict_timeouts(interval ''24 hours'', 100)'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'post-date-half-verdict-timeout-detection cron not scheduled: %', SQLERRM;
END $$;
