-- pg_cron + pg_net: monthly credit replenish + per-minute date reminders
-- Same pattern as 20260322200100_daily_drop_cron.sql.
--
-- Remote DB must have (SQL editor, superuser), if not already from daily drops:
--   ALTER DATABASE postgres SET app.supabase_url = 'https://YOUR_PROJECT_REF.supabase.co';
--   ALTER DATABASE postgres SET app.cron_secret = 'YOUR_CRON_SECRET';

DO $$
DECLARE
  v_job_id integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN

    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'monthly-credit-replenish' LIMIT 1;
    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;

    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'date-reminder-cron' LIMIT 1;
    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
      'monthly-credit-replenish',
      '5 0 1 * *',
      $cmd$
      SELECT net.http_post(
        url := nullif(trim(current_setting('app.supabase_url', true)), '') || '/functions/v1/credit-replenish',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || coalesce(nullif(trim(current_setting('app.cron_secret', true)), ''), '')
        ),
        body := '{}'::jsonb
      );
      $cmd$
    );

    PERFORM cron.schedule(
      'date-reminder-cron',
      '* * * * *',
      $cmd$
      SELECT net.http_post(
        url := nullif(trim(current_setting('app.supabase_url', true)), '') || '/functions/v1/date-reminder-cron',
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
    RAISE NOTICE 'Credit/date reminder crons not scheduled: %', SQLERRM;
END $$;
