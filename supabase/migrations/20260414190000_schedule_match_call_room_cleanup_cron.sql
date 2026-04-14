-- Optional pg_cron: POST match-call-room-cleanup every 5 minutes (when pg_cron + pg_net exist).
-- Deletes Daily.co rooms for terminal match_calls whose client-side delete_room may have been skipped.
-- Requires app.supabase_url and app.cron_secret (same pattern as process-waitlist-promotion-notify-queue).

DO $$
DECLARE
  v_job_id integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN

    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'match-call-room-cleanup' LIMIT 1;
    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
      'match-call-room-cleanup',
      '*/5 * * * *',
      $cmd$
      SELECT net.http_post(
        url := nullif(trim(current_setting('app.supabase_url', true)), '') || '/functions/v1/match-call-room-cleanup',
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
    RAISE NOTICE 'match-call-room-cleanup cron not scheduled: %', SQLERRM;
END $$;
