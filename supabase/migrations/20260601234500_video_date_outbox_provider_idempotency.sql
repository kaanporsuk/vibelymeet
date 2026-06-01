-- Stable provider idempotency keys for video-date side effects.
--
-- The logical outbox dedupe_key prevents duplicate rows. This column prevents
-- duplicate provider sends when a claimed row is retried after an ambiguous
-- network/function failure.

ALTER TABLE public.video_date_provider_outbox
  ADD COLUMN IF NOT EXISTS provider_idempotency_key uuid;

UPDATE public.video_date_provider_outbox
SET provider_idempotency_key = gen_random_uuid()
WHERE provider_idempotency_key IS NULL;

ALTER TABLE public.video_date_provider_outbox
  ALTER COLUMN provider_idempotency_key SET DEFAULT gen_random_uuid(),
  ALTER COLUMN provider_idempotency_key SET NOT NULL;

COMMENT ON COLUMN public.video_date_provider_outbox.provider_idempotency_key IS
  'Stable provider idempotency key reused across retries for the same outbox row.';

DROP FUNCTION IF EXISTS public.claim_video_date_provider_outbox_v2(text, integer, integer);

CREATE OR REPLACE FUNCTION public.claim_video_date_provider_outbox_v2(
  p_worker_id text,
  p_limit integer DEFAULT 25,
  p_lease_seconds integer DEFAULT 60
)
RETURNS TABLE(
  id bigint,
  session_id uuid,
  kind text,
  payload jsonb,
  attempts integer,
  dedupe_key text,
  provider_idempotency_key uuid,
  claim_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_worker text := left(btrim(COALESCE(p_worker_id, '')), 120);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 60), 5), 300);
BEGIN
  IF v_worker = '' THEN
    RAISE EXCEPTION 'worker_id_required';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT o.id
    FROM public.video_date_provider_outbox o
    WHERE (
        o.state = 'pending'
        AND o.next_attempt_at <= now()
      )
      OR (
        o.state = 'claimed'
        AND o.claim_expires_at IS NOT NULL
        AND o.claim_expires_at <= now()
      )
    ORDER BY o.next_attempt_at ASC, o.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ),
  updated AS (
    UPDATE public.video_date_provider_outbox o
    SET
      state = 'claimed',
      attempts = o.attempts + 1,
      claimed_at = now(),
      claim_expires_at = now() + (v_lease_seconds * interval '1 second'),
      claimed_by = v_worker,
      updated_at = now()
    FROM due
    WHERE o.id = due.id
    RETURNING
      o.id,
      o.session_id,
      o.kind,
      o.payload,
      o.attempts,
      o.dedupe_key,
      o.provider_idempotency_key,
      o.claim_expires_at
  )
  SELECT
    updated.id,
    updated.session_id,
    updated.kind,
    updated.payload,
    updated.attempts,
    updated.dedupe_key,
    updated.provider_idempotency_key,
    updated.claim_expires_at
  FROM updated;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_video_date_provider_outbox_v2(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_video_date_provider_outbox_v2(text, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.claim_video_date_provider_outbox_v2(text, integer, integer) IS
  'Claims due provider outbox rows with leases and stable provider idempotency keys.';
