-- Daily Drop cron observability + canonical schedule.
--
-- Migration class: schema + read-only RPC + cron rewire.
-- Why: the cron originally introduced in 20260322200100_daily_drop_cron.sql
-- relied on GUCs (app.supabase_url / app.cron_secret). In production those
-- GUCs were never set; the cron was hot-patched on the database to read from
-- vault secrets (project_url / date_suggestion_cron_secret), but no migration
-- captured that state. Re-applying the original migration would overwrite the
-- working schedule and silently 401 every cron invocation.
--
-- This migration:
--   1. Re-asserts the canonical Vault-based schedule so future re-applies
--      don't regress to the broken GUC pattern. Surfaces install failures via
--      RAISE WARNING (not RAISE NOTICE).
--   2. Adds a daily_drop_cron_health() RPC for the admin dashboard so a stale
--      run is visible at a glance.
--   3. Schedules a 5-minute lag retry. Step 3 of generate-daily-drops is
--      idempotent (skips when drops already exist for today), so the retry is
--      safe and self-healing if the 18:00 invocation 5xxs.

-- 1. Canonical schedule (vault-based, matches production live state)
DO $$
DECLARE
  v_job_id integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE WARNING 'Daily drop cron not (re)scheduled: pg_cron or pg_net missing';
    RETURN;
  END IF;

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'generate-daily-drops' LIMIT 1;
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'generate-daily-drops',
    '0 18 * * *',
    $cmd$
    SELECT net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/generate-daily-drops',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'date_suggestion_cron_secret'
        )
      ),
      body := '{}'::jsonb
    );
    $cmd$
  );

  -- 5-minute lag self-healing retry. Idempotent because generate-daily-drops
  -- skips when today's pairs already exist (force=false default).
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'generate-daily-drops-retry' LIMIT 1;
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'generate-daily-drops-retry',
    '5 18 * * *',
    $cmd$
    SELECT net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/generate-daily-drops',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'date_suggestion_cron_secret'
        )
      ),
      body := '{}'::jsonb
    );
    $cmd$
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Daily drop cron schedule failed: %', SQLERRM;
END $$;

-- 2. Admin-visible health check
CREATE OR REPLACE FUNCTION public.daily_drop_cron_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_now timestamptz := now();
  v_today_utc date := (v_now AT TIME ZONE 'UTC')::date;
  v_last_run record;
  v_today_pairs integer;
  v_recent_cron_attempts jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHENTICATED');
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT id, run_started_at, run_finished_at, status, source, pairs_created,
         users_notified, unpaired_users, reason, error
  INTO v_last_run
  FROM public.daily_drop_generation_runs
  ORDER BY run_started_at DESC
  LIMIT 1;

  SELECT count(*)::integer INTO v_today_pairs
  FROM public.daily_drops
  WHERE drop_date = v_today_utc;

  -- pg_cron attempt history (read-only) - last 5 invocations of the daily drop job.
  -- Use dynamic SQL so the admin health RPC still returns a useful snapshot if
  -- cron metadata is unavailable in a non-production database.
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      EXECUTE $sql$
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'runid', d.runid,
          'status', d.status,
          'return_message', d.return_message,
          'start_time', d.start_time,
          'end_time', d.end_time
        ) ORDER BY d.start_time DESC), '[]'::jsonb)
        FROM (
          SELECT runid, status, return_message, start_time, end_time
          FROM cron.job_run_details
          WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname IN ('generate-daily-drops','generate-daily-drops-retry'))
          ORDER BY start_time DESC
          LIMIT 5
        ) d
      $sql$
      INTO v_recent_cron_attempts;
    EXCEPTION
      WHEN OTHERS THEN
        v_recent_cron_attempts := jsonb_build_array(jsonb_build_object(
          'status', 'unavailable',
          'return_message', SQLERRM
        ));
    END;
  END IF;

  RETURN jsonb_build_object(
    'now_utc', v_now,
    'today_utc', v_today_utc::text,
    'today_pairs', v_today_pairs,
    'last_run', CASE WHEN v_last_run.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_last_run.id,
      'started_at', v_last_run.run_started_at,
      'finished_at', v_last_run.run_finished_at,
      'status', v_last_run.status,
      'source', v_last_run.source,
      'pairs_created', v_last_run.pairs_created,
      'users_notified', v_last_run.users_notified,
      'unpaired_users', v_last_run.unpaired_users,
      'reason', v_last_run.reason,
      'error', v_last_run.error,
      'age_minutes', EXTRACT(EPOCH FROM (v_now - v_last_run.run_started_at)) / 60
    ) END,
    'recent_cron_attempts', v_recent_cron_attempts
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.daily_drop_cron_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daily_drop_cron_health() TO authenticated;

COMMENT ON FUNCTION public.daily_drop_cron_health() IS
  'Admin-only Daily Drop cron health snapshot: last_run from daily_drop_generation_runs + recent cron.job_run_details for 18:00 UTC schedule.';

-- 3. Migration manifest entry (matches pattern used by existing migrations)
INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260509210000',
  'Daily Drop cron observability',
  'schema-only',
  'Re-asserts cron schedule with vault-secret auth (matching prod hot-patch), adds 5-min retry, adds daily_drop_cron_health admin RPC. Unschedules and reschedules existing generate-daily-drops job; no data rewrite.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
