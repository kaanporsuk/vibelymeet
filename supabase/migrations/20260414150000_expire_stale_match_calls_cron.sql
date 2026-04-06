-- Expire stale ringing match_calls to prevent orphaned rows.
--
-- A call is considered stale if it has been in 'ringing' status for longer than 90 seconds
-- without being answered, declined, or missed by the client. This is a conservative threshold:
-- - Client auto-miss fires at 30s; pg_cron fires at most every 60s.
-- - 90s gives enough margin to avoid racing with a valid late answer arriving just before cron runs.
--
-- Only 'ringing' rows are touched. Active, ended, declined, and missed rows are never modified.

CREATE OR REPLACE FUNCTION public.expire_stale_match_calls()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now  timestamptz := now();
  v_cutoff timestamptz := v_now - interval '90 seconds';
  r      record;
  n      int := 0;
BEGIN
  FOR r IN
    SELECT id
    FROM public.match_calls
    WHERE status = 'ringing'
      AND created_at <= v_cutoff
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.match_calls
    SET status = 'missed', ended_at = v_now
    WHERE id = r.id
      AND status = 'ringing';  -- re-check inside lock to prevent races

    IF FOUND THEN
      n := n + 1;
    END IF;
  END LOOP;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_match_calls() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_stale_match_calls() FROM authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_match_calls() FROM anon;

COMMENT ON FUNCTION public.expire_stale_match_calls IS
  'Marks long-stuck ringing match_calls as missed. Called by pg_cron every minute. Conservative 90s threshold avoids races with valid late answers.';

-- Idempotent pg_cron schedule (same pattern as expire-video-date-reconnect-graces).
DO $$
DECLARE
  v_job_id integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'expire-stale-match-calls' LIMIT 1;
    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
      'expire-stale-match-calls',
      '* * * * *',
      'SELECT public.expire_stale_match_calls()'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'expire-stale-match-calls cron not scheduled: %', SQLERRM;
END $$;
