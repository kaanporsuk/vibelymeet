-- Operational visibility: log to PostgreSQL server logs when stale ringing rows are expired (non-zero only).

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
      AND status = 'ringing';

    IF FOUND THEN
      n := n + 1;
    END IF;
  END LOOP;

  IF n > 0 THEN
    RAISE LOG 'expire_stale_match_calls expired_count=%', n;
  END IF;

  RETURN n;
END;
$$;

COMMENT ON FUNCTION public.expire_stale_match_calls IS
  'Marks long-stuck ringing match_calls as missed. Called by pg_cron every minute. Logs expired_count to server logs when n > 0.';
