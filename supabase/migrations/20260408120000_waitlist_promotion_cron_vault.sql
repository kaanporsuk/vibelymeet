-- Waitlist promotion notify: reschedule pg_cron job to use Supabase Vault instead of DB GUCs
-- (app.supabase_url / app.cron_secret are not settable on hosted Supabase for many roles).
--
-- Prerequisites (run in SQL Editor or Vault UI before or after this migration):
--   Vault secrets named exactly:
--     - project_url  → https://schdyxcunwcvddlcshwd.supabase.co (no trailing slash)
--     - cron_secret  → same value as Edge Function secret CRON_SECRET
--   If these rows are missing, the scheduled HTTP call will fail until they exist.

DO $$
DECLARE
  v_job_id integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND EXISTS (
       SELECT 1 FROM information_schema.views
       WHERE table_schema = 'vault' AND table_name = 'decrypted_secrets'
     ) THEN

    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'waitlist-promotion-notify-queue' LIMIT 1;
    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
      'waitlist-promotion-notify-queue',
      '* * * * *',
      $cmd$
      SELECT net.http_post(
        url := trim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1))
          || '/functions/v1/process-waitlist-promotion-notify-queue',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || trim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1))
        ),
        body := '{}'::jsonb
      );
      $cmd$
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'waitlist-promotion-notify-queue (vault-backed) cron not scheduled: %', SQLERRM;
END $$;
