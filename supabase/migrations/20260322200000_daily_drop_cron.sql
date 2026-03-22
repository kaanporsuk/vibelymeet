-- Daily Drop: RPC so clients can tell if today's batch ran (bypasses per-user RLS on counts).
-- + pg_cron + pg_net: HTTP POST to generate-daily-drops at 18:00 UTC daily (when extensions exist).
--
-- After apply, set database settings once (SQL editor, as superuser) if not already set:
--   ALTER DATABASE postgres SET app.supabase_url = 'https://YOUR_PROJECT_REF.supabase.co';
--   ALTER DATABASE postgres SET app.cron_secret = 'YOUR_CRON_SECRET';  -- same as Edge Function CRON_SECRET
-- Or use equivalent session/role settings your host supports.

CREATE OR REPLACE FUNCTION public.daily_drops_generation_ran_today()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.daily_drops
    WHERE drop_date = ((now() AT TIME ZONE 'UTC'))::date
    LIMIT 1
  );
$$;

REVOKE ALL ON FUNCTION public.daily_drops_generation_ran_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.daily_drops_generation_ran_today() TO authenticated;

-- Schedule Edge Function invoke (requires pg_cron + pg_net; same pattern as optional HTTP crons on Supabase).
DO $$
DECLARE
  v_job_id integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'generate-daily-drops' LIMIT 1;
    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;
    PERFORM cron.schedule(
      'generate-daily-drops',
      '0 18 * * *',
      $cmd$
      SELECT net.http_post(
        url := nullif(trim(current_setting('app.supabase_url', true)), '') || '/functions/v1/generate-daily-drops',
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
    RAISE NOTICE 'Daily drop cron not scheduled: %', SQLERRM;
END $$;

COMMENT ON FUNCTION public.daily_drops_generation_ran_today() IS 'True if at least one daily_drops row exists for current UTC date (any user).';
