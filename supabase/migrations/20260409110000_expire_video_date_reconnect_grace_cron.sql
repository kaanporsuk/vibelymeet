-- Authoritative reconnect-grace expiry without relying on client polling alone.
-- pg_cron (runs as postgres) calls this every minute; logic matches video_date_transition grace-expiry branch.

CREATE OR REPLACE FUNCTION public.expire_video_date_reconnect_graces()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT id, event_id, participant_1_id, participant_2_id, started_at, duration_seconds
    FROM public.video_sessions
    WHERE ended_at IS NULL
      AND reconnect_grace_ends_at IS NOT NULL
      AND reconnect_grace_ends_at <= v_now
    ORDER BY id
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.video_sessions
    SET
      state = 'ended',
      phase = 'ended',
      ended_at = v_now,
      ended_reason = 'reconnect_grace_expired',
      reconnect_grace_ends_at = NULL,
      participant_1_away_at = NULL,
      participant_2_away_at = NULL,
      duration_seconds = COALESCE(
        r.duration_seconds,
        GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - r.started_at)))::int)
      ),
      state_updated_at = v_now
    WHERE id = r.id;

    UPDATE public.event_registrations
    SET
      queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      last_active_at = v_now
    WHERE event_id = r.event_id
      AND profile_id IN (r.participant_1_id, r.participant_2_id);

    n := n + 1;
  END LOOP;

  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_video_date_reconnect_graces() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_video_date_reconnect_graces() FROM authenticated;
REVOKE ALL ON FUNCTION public.expire_video_date_reconnect_graces() FROM anon;

COMMENT ON FUNCTION public.expire_video_date_reconnect_graces() IS
  'Ends video sessions whose reconnect_grace_ends_at has passed; resets participant registrations. Called from pg_cron and safe to run concurrently.';

-- Idempotent pg_cron schedule (same pattern as event-reminders-enqueue).
DO $$
DECLARE
  v_job_id integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'expire-video-date-reconnect-graces' LIMIT 1;
    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
      'expire-video-date-reconnect-graces',
      '* * * * *',
      'SELECT public.expire_video_date_reconnect_graces()'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'expire-video-date-reconnect-graces cron not scheduled: %', SQLERRM;
END $$;
