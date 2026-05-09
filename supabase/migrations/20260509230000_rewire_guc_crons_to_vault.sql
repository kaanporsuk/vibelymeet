-- Rewire GUC-based crons to Vault auth + schedule daily-drop health alert.
--
-- Migration class: cron rewire (no schema, no data).
-- Why: 3 crons (monthly-credit-replenish, date-reminder-cron,
-- match-call-room-cleanup) authenticate via GUCs
-- (current_setting('app.cron_secret', true)) which are unset on the database.
-- Every invocation since deploy has produced NULL URLs and silently failed.
-- This migration unschedules them and reschedules with the same cron expression
-- but the canonical Vault-secret pattern, matching generate-daily-drops.
--
-- Uses Vault `cron_secret`, the same value as the Edge Function CRON_SECRET.

CREATE OR REPLACE FUNCTION public._rewire_vault_cron(
  p_jobname text,
  p_schedule text,
  p_function text,
  p_body jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_existing integer;
BEGIN
  SELECT jobid INTO v_existing FROM cron.job WHERE jobname = p_jobname LIMIT 1;
  IF v_existing IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing);
  END IF;
  PERFORM cron.schedule(
    p_jobname,
    p_schedule,
    format(
      $tmpl$
      SELECT net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/%s',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := %L::jsonb
      );
      $tmpl$,
      p_function, p_body::text
    )
  );
END;
$function$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE WARNING 'Cron rewire skipped: pg_cron or pg_net missing';
    RETURN;
  END IF;

  -- Group B - GUC-pattern crons that have been silently failing
  PERFORM public._rewire_vault_cron('monthly-credit-replenish', '5 0 1 * *', 'credit-replenish');
  PERFORM public._rewire_vault_cron('date-reminder-cron',       '* * * * *', 'date-reminder-cron');
  PERFORM public._rewire_vault_cron('match-call-room-cleanup',  '*/5 * * * *', 'match-call-room-cleanup');

  -- Health alert cron - 30 minutes after the daily drop batch
  PERFORM public._rewire_vault_cron('daily-drop-health-alert', '30 18 * * *', 'check-daily-drop-health');
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Cron rewire failed: %', SQLERRM;
END $$;

DROP FUNCTION IF EXISTS public._rewire_vault_cron(text, text, text, jsonb);

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260509230000',
  'Rewire GUC crons to Vault + daily-drop health alert',
  'schema-only',
  'Unschedules and reschedules 3 GUC-based crons (monthly-credit-replenish, date-reminder-cron, match-call-room-cleanup) to use Vault cron_secret auth. Adds daily-drop-health-alert cron at 18:30 UTC and drops the temporary helper function.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
