-- Forward fixes for review follow-ups after the Phase 2 cron trim and alert
-- dispatch claim migrations had already been applied to cloud.

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
      SELECT btrim(decrypted_secret, E' \t\n\r')
      INTO v_project_url
      FROM vault.decrypted_secrets
      WHERE name = 'project_url'
      LIMIT 1;

      SELECT btrim(decrypted_secret, E' \t\n\r')
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
          url := btrim((select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1), E' \t\n\r')
            || '/functions/v1/video-date-outbox-drainer',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || btrim((select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1), E' \t\n\r')
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
          url := btrim((select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1), E' \t\n\r')
            || '/functions/v1/video-date-deadline-finalizer',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || btrim((select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1), E' \t\n\r')
          ),
          body := jsonb_build_object('source', 'pg_cron', 'batch_size', 25)
        );
        $cron$
      );
    ELSE
      RAISE NOTICE 'video-date phase2 workers not rescheduled with btrim: missing Vault project_url or cron_secret';
    END IF;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'video-date phase2 worker cron btrim reschedule skipped: %', SQLERRM;
END $$;

UPDATE public.video_date_recovery_alert_dispatches
SET sentry_claimed_at = NULL
WHERE sentry_sent_at IS NULL
  AND sentry_claimed_at IS NOT NULL
  AND sentry_claimed_at <= now() - interval '15 minutes';

UPDATE public.video_date_recovery_alert_dispatches
SET slack_claimed_at = NULL
WHERE slack_sent_at IS NULL
  AND slack_claimed_at IS NOT NULL
  AND slack_claimed_at <= now() - interval '15 minutes';
