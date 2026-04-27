-- Reschedule video-date-room-cleanup with Vault-backed URL/auth.
--
-- The original scheduler used app.supabase_url / app.cron_secret database
-- settings. Hosted production does not have those settings populated, which
-- produced a NULL URL and empty Bearer token. Keep this repair forward-only and
-- reuse the Vault secret names already proven by post-date-verdict-reminders:
--   - project_url
--   - cron_secret

DO $$
DECLARE
  v_job_id integer;
  v_project_url text;
  v_cron_secret text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN

    SELECT trim(decrypted_secret) INTO v_project_url
    FROM vault.decrypted_secrets
    WHERE name = 'project_url'
    LIMIT 1;

    SELECT trim(decrypted_secret) INTO v_cron_secret
    FROM vault.decrypted_secrets
    WHERE name = 'cron_secret'
    LIMIT 1;

    IF NULLIF(v_project_url, '') IS NULL OR NULLIF(v_cron_secret, '') IS NULL THEN
      RAISE NOTICE 'video-date-room-cleanup cron not scheduled: missing Vault project_url or cron_secret';
      RETURN;
    END IF;

    SELECT jobid INTO v_job_id
    FROM cron.job
    WHERE jobname = 'video-date-room-cleanup'
    LIMIT 1;

    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
      'video-date-room-cleanup',
      '*/5 * * * *',
      $cmd$
      SELECT net.http_post(
        url := trim((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1))
          || '/functions/v1/video-date-room-cleanup',
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
    RAISE NOTICE 'video-date-room-cleanup cron not scheduled: %', SQLERRM;
END $$;
