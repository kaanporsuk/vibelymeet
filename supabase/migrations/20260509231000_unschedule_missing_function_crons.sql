-- Unschedule stale HTTP crons whose Edge Function targets are retired/absent.
--
-- Migration class: cron cleanup only (no schema, no data).
-- Why: the live project still had active pg_cron jobs for Edge Functions that
-- are not present in current source/config/live function inventory:
--   - email-drip-hourly -> /functions/v1/email-drip
--   - process-notification-outbox -> /functions/v1/process-notification-outbox
-- Those jobs were Vault-authenticated but returned pg_net 404 responses every
-- run. Current notification delivery no longer uses notification_outbox in the
-- active send path, and email-drip is intentionally retired until deliberately
-- restored with a function, scheduler, templates, and provider QA.

DO $$
DECLARE
  v_job record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE WARNING 'Missing-function cron cleanup skipped: pg_cron missing';
    RETURN;
  END IF;

  FOR v_job IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE (
      jobname = 'process-notification-outbox'
      AND command ILIKE '%/functions/v1/process-notification-outbox%'
    )
    OR (
      jobname = 'email-drip-hourly'
      AND command ILIKE '%/functions/v1/email-drip%'
    )
  LOOP
    PERFORM cron.unschedule(v_job.jobid);
    RAISE NOTICE 'Unscheduled stale missing-function cron % (jobid=%)', v_job.jobname, v_job.jobid;
  END LOOP;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Missing-function cron cleanup failed: %', SQLERRM;
END $$;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260509231000',
  'Unschedule missing-function HTTP crons',
  'schema-only',
  'Unschedules active pg_cron jobs that call retired or absent Edge Function slugs: email-drip-hourly and process-notification-outbox. No tables, data rows, provider secrets, or healthy cron jobs are changed.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
