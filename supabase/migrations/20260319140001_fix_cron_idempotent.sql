-- Idempotent pg_cron scheduling for event reminder enqueue (avoid duplicate jobs on re-apply).
DO $$
DECLARE
  v_job_id integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'event-reminders-enqueue' LIMIT 1;
    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;
    PERFORM cron.schedule('event-reminders-enqueue', '* * * * *', 'SELECT public.send_event_reminders()');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available: %', SQLERRM;
END $$;
