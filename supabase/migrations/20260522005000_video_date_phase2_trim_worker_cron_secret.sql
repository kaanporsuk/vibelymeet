-- Reschedule Phase 2 Video Date workers with trimmed Vault values. The
-- original scheduler validated trimmed secrets but built Authorization from
-- the raw Vault value, so leading/trailing whitespace could make pg_cron calls
-- fail CRON_SECRET auth.

DO $$
DECLARE
  v_project_url text;
  v_cron_secret text;
  v_has_vault boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    v_has_vault := EXISTS (
      SELECT 1
      FROM information_schema.views
      WHERE table_schema = 'vault'
        AND table_name = 'decrypted_secrets'
    );

    IF v_has_vault THEN
      SELECT trim(decrypted_secret)
      INTO v_project_url
      FROM vault.decrypted_secrets
      WHERE name = 'project_url'
      LIMIT 1;

      SELECT trim(decrypted_secret)
      INTO v_cron_secret
      FROM vault.decrypted_secrets
      WHERE name = 'cron_secret'
      LIMIT 1;
    END IF;

    IF NULLIF(v_project_url, '') IS NOT NULL AND NULLIF(v_cron_secret, '') IS NOT NULL THEN
      PERFORM cron.unschedule(jobid)
      FROM cron.job
      WHERE jobname IN ('video-date-outbox-drainer', 'video-date-deadline-finalizer');

      PERFORM cron.schedule(
        'video-date-outbox-drainer',
        '* * * * *',
        $cron$
        SELECT net.http_post(
          url := trim((select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1))
            || '/functions/v1/video-date-outbox-drainer',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || trim((select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1))
          ),
          body := jsonb_build_object('source', 'pg_cron', 'batch_size', 25)
        );
        $cron$
      );

      PERFORM cron.schedule(
        'video-date-deadline-finalizer',
        '* * * * *',
        $cron$
        SELECT net.http_post(
          url := trim((select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1))
            || '/functions/v1/video-date-deadline-finalizer',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || trim((select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1))
          ),
          body := jsonb_build_object('source', 'pg_cron', 'batch_size', 25)
        );
        $cron$
      );
    ELSE
      RAISE NOTICE 'video-date phase2 workers not rescheduled: missing Vault project_url or cron_secret';
    END IF;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'video-date phase2 worker cron trim reschedule skipped: %', SQLERRM;
END $$;
