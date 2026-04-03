-- Optional pg_cron: POST process-waitlist-promotion-notify-queue every minute (when pg_cron + pg_net exist).
-- Requires app.supabase_url and app.cron_secret (same as credit-replenish / date-reminder jobs).

DO $$
DECLARE
  v_job_id integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN

    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'waitlist-promotion-notify-queue' LIMIT 1;
    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
      'waitlist-promotion-notify-queue',
      '* * * * *',
      $cmd$
      SELECT net.http_post(
        url := nullif(trim(current_setting('app.supabase_url', true)), '') || '/functions/v1/process-waitlist-promotion-notify-queue',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(nullif(trim(current_setting('app.cron_secret', true)), ''), '')
        ),
        body := '{}'::jsonb
      );
      $cmd$
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'waitlist-promotion-notify-queue cron not scheduled: %', SQLERRM;
END $$;
