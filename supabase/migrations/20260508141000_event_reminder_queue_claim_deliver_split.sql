-- Definitive crash-recovery for the event reminder queue.
-- Migration classification: schema+policy.
--
-- Background:
--   The queue table previously used a single `sent_at` column for both "I have
--   started processing this row" and "I have delivered this notification". When
--   the Edge Function crashed after claiming a row but before recording success
--   or failure, the row stayed claimed indefinitely, and the index that drives
--   the worker (created_at WHERE sent_at IS NULL) hid it from future runs.
--
--   This migration introduces an explicit `claimed_at` / `delivered_at` /
--   `delivery_attempts` / `last_error_reason` split, backfills the existing
--   column semantics, and adds `unclaim_stale_event_reminder_queue_rows` for
--   the worker to call before each claim. `sent_at` is retained as a generated
--   alias of `delivered_at` so any external consumers reading the historical
--   column still observe correct delivery timestamps with no migration surprise.

ALTER TABLE public.event_reminder_queue
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error_reason text,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz;

-- Backfill: any pre-migration row whose sent_at is non-null was, by the old
-- semantics, both claimed and delivered. Mirror that into the new columns so
-- pending-row predicates do not retroactively re-deliver historical rows.
UPDATE public.event_reminder_queue
SET claimed_at = COALESCE(claimed_at, sent_at),
    delivered_at = COALESCE(delivered_at, sent_at)
WHERE sent_at IS NOT NULL;

-- Drop the historical pending index that anchored on (created_at WHERE sent_at IS NULL)
-- and replace it with one that anchors on the new claim/deliver semantics.
DROP INDEX IF EXISTS public.idx_event_reminder_queue_pending;

CREATE INDEX IF NOT EXISTS idx_event_reminder_queue_pending
  ON public.event_reminder_queue (created_at)
  WHERE delivered_at IS NULL AND claimed_at IS NULL;

-- An additional partial index for the sweeper: claimed but not delivered rows
-- whose claim has aged past the threshold are the recovery target.
CREATE INDEX IF NOT EXISTS idx_event_reminder_queue_stale_claims
  ON public.event_reminder_queue (claimed_at)
  WHERE delivered_at IS NULL AND claimed_at IS NOT NULL;

COMMENT ON COLUMN public.event_reminder_queue.claimed_at IS
  'Set when a worker has begun processing this row. Reset to NULL by unclaim_stale_event_reminder_queue_rows after the stale claim threshold so a crashed worker never permanently hides a reminder.';
COMMENT ON COLUMN public.event_reminder_queue.delivered_at IS
  'Set only after a successful upstream notification dispatch. Once non-null the row is terminal and will not be re-delivered.';
COMMENT ON COLUMN public.event_reminder_queue.delivery_attempts IS
  'Monotonic count of claim attempts. Surface for ops dashboards and back-pressure decisions.';
COMMENT ON COLUMN public.event_reminder_queue.last_error_reason IS
  'Free-form last upstream failure reason; persisted for ops observability across reclaims.';
COMMENT ON COLUMN public.event_reminder_queue.last_error_at IS
  'Timestamp of last_error_reason for ops observability.';

-- Sweeper: unclaim rows whose claim age has exceeded the threshold but were
-- never delivered. Bounded scan, FOR UPDATE SKIP LOCKED so it never contends
-- with active workers. Returns the count of rows recovered.
CREATE OR REPLACE FUNCTION public.unclaim_stale_event_reminder_queue_rows(
  p_stale_after_seconds integer DEFAULT 120,
  p_limit integer DEFAULT 500
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_threshold timestamptz;
  v_recovered integer := 0;
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 500), 5000));
  v_seconds integer := GREATEST(30, COALESCE(p_stale_after_seconds, 120));
BEGIN
  v_threshold := now() - make_interval(secs => v_seconds);

  WITH stale AS (
    SELECT id
    FROM public.event_reminder_queue
    WHERE delivered_at IS NULL
      AND claimed_at IS NOT NULL
      AND claimed_at <= v_threshold
    ORDER BY claimed_at
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.event_reminder_queue q
  SET claimed_at = NULL,
      last_error_reason = COALESCE(q.last_error_reason, 'stale_claim_recovered'),
      last_error_at = COALESCE(q.last_error_at, now())
  FROM stale
  WHERE q.id = stale.id;

  GET DIAGNOSTICS v_recovered = ROW_COUNT;

  RETURN v_recovered;
END;
$function$;

REVOKE ALL ON FUNCTION public.unclaim_stale_event_reminder_queue_rows(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unclaim_stale_event_reminder_queue_rows(integer, integer) TO service_role;

COMMENT ON FUNCTION public.unclaim_stale_event_reminder_queue_rows(integer, integer) IS
  'Recovers event_reminder_queue rows whose claim has aged past the threshold without delivery. Bounded, idempotent, FOR UPDATE SKIP LOCKED so it never contends with healthy workers. Service-role only.';

-- Atomic claim helper: consolidates the worker hot-path so the claim, the
-- attempt-count bump, and the optional sweep happen on the server.
CREATE OR REPLACE FUNCTION public.claim_due_event_reminder_queue_rows(
  p_limit integer DEFAULT 100,
  p_stale_after_seconds integer DEFAULT 120
) RETURNS TABLE(
  id uuid,
  profile_id uuid,
  event_id uuid,
  event_title text,
  reminder_type text,
  delivery_attempts integer,
  last_error_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 1000));
BEGIN
  -- Always sweep first so a partial worker outage is healed before we claim.
  PERFORM public.unclaim_stale_event_reminder_queue_rows(
    GREATEST(30, COALESCE(p_stale_after_seconds, 120)),
    v_limit * 2
  );

  RETURN QUERY
  WITH due AS (
    SELECT q.id
    FROM public.event_reminder_queue q
    WHERE q.delivered_at IS NULL
      AND q.claimed_at IS NULL
    ORDER BY q.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.event_reminder_queue q
  SET claimed_at = v_now,
      delivery_attempts = COALESCE(q.delivery_attempts, 0) + 1
  FROM due
  WHERE q.id = due.id
  RETURNING q.id,
            q.profile_id,
            q.event_id,
            q.event_title,
            q.reminder_type,
            q.delivery_attempts,
            q.last_error_reason;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_due_event_reminder_queue_rows(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_event_reminder_queue_rows(integer, integer) TO service_role;

COMMENT ON FUNCTION public.claim_due_event_reminder_queue_rows(integer, integer) IS
  'Atomic claim for event_reminder_queue. Sweeps stale claims first, then claims up to p_limit pending rows. SKIP LOCKED so concurrent workers never block each other. Service-role only.';

-- Mark delivered (terminal) helper: the worker calls this after a successful
-- upstream send. Idempotent on already-delivered rows.
CREATE OR REPLACE FUNCTION public.mark_event_reminder_queue_row_delivered(
  p_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_rows integer := 0;
BEGIN
  UPDATE public.event_reminder_queue
  SET delivered_at = v_now,
      sent_at = COALESCE(sent_at, v_now),
      last_error_reason = NULL,
      last_error_at = NULL
  WHERE id = p_id
    AND delivered_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_event_reminder_queue_row_delivered(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_event_reminder_queue_row_delivered(uuid) TO service_role;

COMMENT ON FUNCTION public.mark_event_reminder_queue_row_delivered(uuid) IS
  'Marks an event_reminder_queue row delivered. Idempotent. Mirrors delivered_at into legacy sent_at to keep any historical readers consistent.';

-- Release-on-failure helper: the worker calls this when an upstream attempt
-- fails so the row immediately becomes pending again instead of waiting for
-- the sweeper threshold.
CREATE OR REPLACE FUNCTION public.release_event_reminder_queue_row_on_failure(
  p_id uuid,
  p_error_reason text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_rows integer := 0;
BEGIN
  UPDATE public.event_reminder_queue
  SET claimed_at = NULL,
      last_error_reason = COALESCE(NULLIF(btrim(p_error_reason), ''), 'unspecified_failure'),
      last_error_at = now()
  WHERE id = p_id
    AND delivered_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_event_reminder_queue_row_on_failure(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_event_reminder_queue_row_on_failure(uuid, text) TO service_role;

COMMENT ON FUNCTION public.release_event_reminder_queue_row_on_failure(uuid, text) IS
  'Releases a claim on an event_reminder_queue row after a delivery failure. Records the last error reason for ops observability.';

-- Schedule the sweeper independently of the worker so even a totally crashed
-- worker fleet does not strand reminders.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('event-reminders-sweep-stale-claims');
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
    PERFORM cron.schedule(
      'event-reminders-sweep-stale-claims',
      '* * * * *',
      'SELECT public.unclaim_stale_event_reminder_queue_rows(120, 500)'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron not available for sweep schedule: %.', SQLERRM;
END;
$$;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260508141000',
  'Event reminder queue claim / deliver split with stale-claim sweeper',
  'schema+policy',
  'Splits event_reminder_queue.sent_at into explicit claimed_at / delivered_at columns plus delivery_attempts + last_error_reason for ops. Adds claim_due_event_reminder_queue_rows / mark_event_reminder_queue_row_delivered / release_event_reminder_queue_row_on_failure / unclaim_stale_event_reminder_queue_rows helpers and a pg_cron schedule that recovers stale claims every minute. Backfills historical sent_at into the new columns and keeps sent_at populated for legacy readers.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
