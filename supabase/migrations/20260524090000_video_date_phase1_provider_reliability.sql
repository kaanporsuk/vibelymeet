-- Video Date Phase 1 provider reliability closure.
-- Additive hardening for cron workers, provider leases, rate limiting,
-- dead-letter visibility, and participant/safety event isolation.

CREATE TABLE IF NOT EXISTS public.video_date_worker_runs (
  worker_kind text PRIMARY KEY,
  claimed_by text,
  run_started_at timestamptz,
  heartbeat_at timestamptz,
  claim_expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_date_worker_runs_kind_nonempty CHECK (length(btrim(worker_kind)) BETWEEN 3 AND 120),
  CONSTRAINT video_date_worker_runs_claimed_by_nonempty CHECK (claimed_by IS NULL OR length(btrim(claimed_by)) BETWEEN 3 AND 160)
);

ALTER TABLE public.video_date_worker_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_date_worker_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_date_worker_runs TO service_role;

COMMENT ON TABLE public.video_date_worker_runs IS
  'Service-role-only cron worker mutexes with refreshable leases. Prevents overlapping video-date provider workers from pressuring the same queues.';

CREATE TABLE IF NOT EXISTS public.video_date_provider_rate_limits (
  provider text NOT NULL,
  bucket text NOT NULL,
  tokens numeric NOT NULL DEFAULT 0 CHECK (tokens >= 0),
  capacity integer NOT NULL CHECK (capacity > 0),
  refill_per_second numeric NOT NULL CHECK (refill_per_second > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, bucket),
  CONSTRAINT video_date_provider_rate_limits_provider_nonempty CHECK (length(btrim(provider)) BETWEEN 2 AND 80),
  CONSTRAINT video_date_provider_rate_limits_bucket_nonempty CHECK (length(btrim(bucket)) BETWEEN 2 AND 120)
);

ALTER TABLE public.video_date_provider_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_date_provider_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_date_provider_rate_limits TO service_role;

COMMENT ON TABLE public.video_date_provider_rate_limits IS
  'Service-role-only token buckets for external provider calls such as Daily and OneSignal.';

CREATE TABLE IF NOT EXISTS public.video_date_provider_outbox_failure_log (
  id bigserial PRIMARY KEY,
  target_kind text NOT NULL CHECK (target_kind IN ('outbox', 'deadline', 'worker', 'provider')),
  outbox_id bigint REFERENCES public.video_date_provider_outbox(id) ON DELETE SET NULL,
  deadline_id bigint REFERENCES public.video_session_deadlines(id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.video_sessions(id) ON DELETE SET NULL,
  provider text,
  operation text,
  error_code text,
  error_message text,
  retry_after_seconds integer,
  permanent boolean NOT NULL DEFAULT false,
  lease_lost boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vdpo_failure_log_created
  ON public.video_date_provider_outbox_failure_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vdpo_failure_log_outbox
  ON public.video_date_provider_outbox_failure_log(outbox_id, created_at DESC)
  WHERE outbox_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vdpo_failure_log_deadline
  ON public.video_date_provider_outbox_failure_log(deadline_id, created_at DESC)
  WHERE deadline_id IS NOT NULL;

ALTER TABLE public.video_date_provider_outbox_failure_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_date_provider_outbox_failure_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_date_provider_outbox_failure_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.video_date_provider_outbox_failure_log_id_seq TO service_role;

COMMENT ON TABLE public.video_date_provider_outbox_failure_log IS
  'Service-role-only audit stream for provider worker retries, timeouts, rate limits, permanent failures, and lease loss.';

CREATE TABLE IF NOT EXISTS public.video_date_provider_dead_letters (
  id bigserial PRIMARY KEY,
  target_kind text NOT NULL CHECK (target_kind IN ('outbox', 'deadline', 'webhook', 'provider')),
  outbox_id bigint REFERENCES public.video_date_provider_outbox(id) ON DELETE SET NULL,
  deadline_id bigint REFERENCES public.video_session_deadlines(id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.video_sessions(id) ON DELETE SET NULL,
  provider text,
  operation text,
  reason text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vdpo_dead_letters_created
  ON public.video_date_provider_dead_letters(created_at DESC);

ALTER TABLE public.video_date_provider_dead_letters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.video_date_provider_dead_letters FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.video_date_provider_dead_letters TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.video_date_provider_dead_letters_id_seq TO service_role;

COMMENT ON TABLE public.video_date_provider_dead_letters IS
  'Service-role-only dead-letter store for terminal provider side-effect failures and malformed provider/webhook payloads.';

CREATE OR REPLACE FUNCTION public.begin_video_date_worker_run_v1(
  p_worker_kind text,
  p_worker_id text,
  p_lease_seconds integer DEFAULT 120,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_worker_kind text := left(btrim(COALESCE(p_worker_kind, '')), 120);
  v_worker_id text := left(btrim(COALESCE(p_worker_id, '')), 160);
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 120), 10), 600);
  v_now timestamptz := now();
  v_row public.video_date_worker_runs%ROWTYPE;
BEGIN
  IF v_worker_kind = '' OR v_worker_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_worker_claim');
  END IF;

  INSERT INTO public.video_date_worker_runs (
    worker_kind,
    claimed_by,
    run_started_at,
    heartbeat_at,
    claim_expires_at,
    metadata,
    updated_at
  )
  VALUES (
    v_worker_kind,
    NULL,
    NULL,
    NULL,
    NULL,
    '{}'::jsonb,
    v_now
  )
  ON CONFLICT (worker_kind) DO NOTHING;

  SELECT *
  INTO v_row
  FROM public.video_date_worker_runs
  WHERE worker_kind = v_worker_kind
  FOR UPDATE;

  IF v_row.claimed_by IS NOT NULL
     AND v_row.claimed_by IS DISTINCT FROM v_worker_id
     AND v_row.claim_expires_at IS NOT NULL
     AND v_row.claim_expires_at > v_now THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'worker_already_running',
      'claimedBy', v_row.claimed_by,
      'claimExpiresAt', v_row.claim_expires_at
    );
  END IF;

  UPDATE public.video_date_worker_runs
  SET
    claimed_by = v_worker_id,
    run_started_at = v_now,
    heartbeat_at = v_now,
    claim_expires_at = v_now + (v_lease_seconds * interval '1 second'),
    metadata = COALESCE(p_metadata, '{}'::jsonb),
    updated_at = v_now
  WHERE worker_kind = v_worker_kind;

  RETURN jsonb_build_object(
    'ok', true,
    'workerKind', v_worker_kind,
    'workerId', v_worker_id,
    'claimExpiresAt', v_now + (v_lease_seconds * interval '1 second')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.begin_video_date_worker_run_v1(text, text, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_video_date_worker_run_v1(text, text, integer, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_video_date_worker_run_v1(
  p_worker_kind text,
  p_worker_id text,
  p_lease_seconds integer DEFAULT 120,
  p_metadata jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_worker_kind text := left(btrim(COALESCE(p_worker_kind, '')), 120);
  v_worker_id text := left(btrim(COALESCE(p_worker_id, '')), 160);
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 120), 10), 600);
  v_now timestamptz := now();
  v_row public.video_date_worker_runs%ROWTYPE;
BEGIN
  IF v_worker_kind = '' OR v_worker_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_worker_refresh');
  END IF;

  SELECT *
  INTO v_row
  FROM public.video_date_worker_runs
  WHERE worker_kind = v_worker_kind
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'worker_run_not_found');
  END IF;

  IF v_row.claimed_by IS DISTINCT FROM v_worker_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'worker_lease_mismatch', 'claimedBy', v_row.claimed_by);
  END IF;

  IF v_row.claim_expires_at IS NULL OR v_row.claim_expires_at <= v_now THEN
    RETURN jsonb_build_object('ok', false, 'error', 'worker_lease_expired');
  END IF;

  UPDATE public.video_date_worker_runs
  SET
    heartbeat_at = v_now,
    claim_expires_at = v_now + (v_lease_seconds * interval '1 second'),
    metadata = CASE WHEN p_metadata IS NULL THEN metadata ELSE p_metadata END,
    updated_at = v_now
  WHERE worker_kind = v_worker_kind;

  RETURN jsonb_build_object(
    'ok', true,
    'claimExpiresAt', v_now + (v_lease_seconds * interval '1 second')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_video_date_worker_run_v1(text, text, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_video_date_worker_run_v1(text, text, integer, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finish_video_date_worker_run_v1(
  p_worker_kind text,
  p_worker_id text,
  p_metadata jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_worker_kind text := left(btrim(COALESCE(p_worker_kind, '')), 120);
  v_worker_id text := left(btrim(COALESCE(p_worker_id, '')), 160);
  v_row public.video_date_worker_runs%ROWTYPE;
BEGIN
  IF v_worker_kind = '' OR v_worker_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_worker_finish');
  END IF;

  SELECT *
  INTO v_row
  FROM public.video_date_worker_runs
  WHERE worker_kind = v_worker_kind
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'worker_run_not_found');
  END IF;

  IF v_row.claimed_by IS DISTINCT FROM v_worker_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'worker_lease_mismatch', 'claimedBy', v_row.claimed_by);
  END IF;

  UPDATE public.video_date_worker_runs
  SET
    claimed_by = NULL,
    heartbeat_at = now(),
    claim_expires_at = NULL,
    metadata = CASE WHEN p_metadata IS NULL THEN metadata ELSE p_metadata END,
    updated_at = now()
  WHERE worker_kind = v_worker_kind;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.finish_video_date_worker_run_v1(text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_video_date_worker_run_v1(text, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_video_date_provider_outbox_claim_v1(
  p_outbox_id bigint,
  p_worker_id text,
  p_lease_seconds integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_worker text := left(btrim(COALESCE(p_worker_id, '')), 120);
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 60), 5), 300);
  v_now timestamptz := now();
  v_row public.video_date_provider_outbox%ROWTYPE;
BEGIN
  IF p_outbox_id IS NULL OR v_worker = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_outbox_refresh');
  END IF;

  SELECT *
  INTO v_row
  FROM public.video_date_provider_outbox
  WHERE id = p_outbox_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'outbox_not_found');
  END IF;

  IF v_row.state IS DISTINCT FROM 'claimed' OR v_row.claimed_by IS DISTINCT FROM v_worker THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lease_lost', 'state', v_row.state, 'claimedBy', v_row.claimed_by);
  END IF;

  IF v_row.claim_expires_at IS NULL OR v_row.claim_expires_at <= v_now THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lease_expired');
  END IF;

  UPDATE public.video_date_provider_outbox
  SET
    claim_expires_at = v_now + (v_lease_seconds * interval '1 second'),
    updated_at = v_now
  WHERE id = p_outbox_id;

  RETURN jsonb_build_object('ok', true, 'claimExpiresAt', v_now + (v_lease_seconds * interval '1 second'));
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_video_date_provider_outbox_claim_v1(bigint, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_video_date_provider_outbox_claim_v1(bigint, text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_video_session_deadline_claim_v1(
  p_deadline_id bigint,
  p_worker_id text,
  p_lease_seconds integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_worker text := left(btrim(COALESCE(p_worker_id, '')), 120);
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 60), 5), 300);
  v_now timestamptz := now();
  v_row public.video_session_deadlines%ROWTYPE;
BEGIN
  IF p_deadline_id IS NULL OR v_worker = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_deadline_refresh');
  END IF;

  SELECT *
  INTO v_row
  FROM public.video_session_deadlines
  WHERE id = p_deadline_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'deadline_not_found');
  END IF;

  IF v_row.state IS DISTINCT FROM 'claimed' OR v_row.claimed_by IS DISTINCT FROM v_worker THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lease_lost', 'state', v_row.state, 'claimedBy', v_row.claimed_by);
  END IF;

  IF v_row.claim_expires_at IS NULL OR v_row.claim_expires_at <= v_now THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lease_expired');
  END IF;

  UPDATE public.video_session_deadlines
  SET
    claim_expires_at = v_now + (v_lease_seconds * interval '1 second'),
    updated_at = v_now
  WHERE id = p_deadline_id;

  RETURN jsonb_build_object('ok', true, 'claimExpiresAt', v_now + (v_lease_seconds * interval '1 second'));
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_video_session_deadline_claim_v1(bigint, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_video_session_deadline_claim_v1(bigint, text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.take_provider_rate_limit_token_v1(
  p_provider text,
  p_bucket text,
  p_cost integer DEFAULT 1,
  p_capacity integer DEFAULT 10,
  p_refill_per_second numeric DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_provider text := left(btrim(lower(COALESCE(p_provider, ''))), 80);
  v_bucket text := left(btrim(lower(COALESCE(p_bucket, ''))), 120);
  v_cost numeric := GREATEST(COALESCE(p_cost, 1), 1);
  v_capacity integer := LEAST(GREATEST(COALESCE(p_capacity, 10), 1), 10000);
  v_refill numeric := GREATEST(COALESCE(p_refill_per_second, 1), 0.001);
  v_now timestamptz := now();
  v_row public.video_date_provider_rate_limits%ROWTYPE;
  v_elapsed_seconds numeric;
  v_tokens numeric;
  v_retry_after integer;
BEGIN
  IF v_provider = '' OR v_bucket = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_rate_limit_bucket', 'retryAfterSeconds', 30);
  END IF;

  INSERT INTO public.video_date_provider_rate_limits (
    provider,
    bucket,
    tokens,
    capacity,
    refill_per_second,
    updated_at
  )
  VALUES (
    v_provider,
    v_bucket,
    v_capacity,
    v_capacity,
    v_refill,
    v_now
  )
  ON CONFLICT (provider, bucket) DO NOTHING;

  SELECT *
  INTO v_row
  FROM public.video_date_provider_rate_limits
  WHERE provider = v_provider
    AND bucket = v_bucket
  FOR UPDATE;

  v_elapsed_seconds := GREATEST(EXTRACT(EPOCH FROM (v_now - v_row.updated_at)), 0);
  v_tokens := LEAST(v_capacity::numeric, v_row.tokens + (v_elapsed_seconds * v_refill));

  IF v_tokens >= v_cost THEN
    UPDATE public.video_date_provider_rate_limits
    SET
      tokens = v_tokens - v_cost,
      capacity = v_capacity,
      refill_per_second = v_refill,
      updated_at = v_now
    WHERE provider = v_provider
      AND bucket = v_bucket;

    RETURN jsonb_build_object(
      'ok', true,
      'provider', v_provider,
      'bucket', v_bucket,
      'tokensRemaining', v_tokens - v_cost
    );
  END IF;

  v_retry_after := LEAST(300, GREATEST(1, CEIL((v_cost - v_tokens) / v_refill)::integer));

  UPDATE public.video_date_provider_rate_limits
  SET
    tokens = v_tokens,
    capacity = v_capacity,
    refill_per_second = v_refill,
    updated_at = v_now
  WHERE provider = v_provider
    AND bucket = v_bucket;

  RETURN jsonb_build_object(
    'ok', false,
    'error', 'provider_rate_limited',
    'provider', v_provider,
    'bucket', v_bucket,
    'retryAfterSeconds', v_retry_after,
    'tokensRemaining', v_tokens
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.take_provider_rate_limit_token_v1(text, text, integer, integer, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_provider_rate_limit_token_v1(text, text, integer, integer, numeric)
  TO service_role;

CREATE OR REPLACE FUNCTION public.take_video_date_token_refresh_rate_limit_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_user_result jsonb;
  v_provider_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated', 'retryAfterSeconds', 30);
  END IF;

  v_user_result := public.take_provider_rate_limit_token_v1(
    'daily',
    'meeting_token_refresh_user:' || v_uid::text,
    1,
    6,
    0.2
  );

  IF COALESCE((v_user_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'user_rate_limited',
      'scope', 'user',
      'retryAfterSeconds', COALESCE((v_user_result->>'retryAfterSeconds')::integer, 30)
    );
  END IF;

  v_provider_result := public.take_provider_rate_limit_token_v1(
    'daily',
    'meeting_token_refresh',
    1,
    20,
    10
  );

  IF COALESCE((v_provider_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', COALESCE(v_provider_result->>'error', 'provider_rate_limited'),
      'scope', 'provider',
      'retryAfterSeconds', COALESCE((v_provider_result->>'retryAfterSeconds')::integer, 30)
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'scope', 'provider');
END;
$function$;

REVOKE ALL ON FUNCTION public.take_video_date_token_refresh_rate_limit_v1()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.take_video_date_token_refresh_rate_limit_v1()
  TO authenticated, service_role;

DROP POLICY IF EXISTS "Staff can read internal video session events"
  ON public.video_session_events;
CREATE POLICY "Staff can read internal video session events"
  ON public.video_session_events
  FOR SELECT
  TO authenticated
  USING (
    visibility IN ('internal', 'safety_review')
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'moderator'::public.app_role)
    )
  );

DROP POLICY IF EXISTS "Video session internal events require staff"
  ON public.video_session_events;
CREATE POLICY "Video session internal events require staff"
  ON public.video_session_events
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    visibility NOT IN ('internal', 'safety_review')
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'moderator'::public.app_role)
  );

CREATE OR REPLACE FUNCTION public.broadcast_video_session_event_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'realtime', 'pg_catalog'
AS $function$
DECLARE
  v_sanitized_payload jsonb;
  v_payload jsonb;
BEGIN
  IF TG_OP <> 'INSERT' OR NEW.visibility IS DISTINCT FROM 'participants' THEN
    RETURN NULL;
  END IF;

  IF public.video_date_broadcast_batched_v2_enabled() THEN
    RETURN NULL;
  END IF;

  v_sanitized_payload := CASE
    WHEN jsonb_typeof(COALESCE(NEW.sanitized_payload, '{}'::jsonb)) = 'object'
      THEN COALESCE(NEW.sanitized_payload, '{}'::jsonb)
    ELSE '{}'::jsonb
  END;

  v_payload := jsonb_build_object(
    'schemaVersion', 1,
    'id', NEW.id,
    'sessionId', NEW.session_id,
    'sessionSeq', NEW.session_seq,
    'kind', NEW.kind,
    'at', NEW.at,
    'actor', NEW.actor,
    'payload', v_sanitized_payload,
    'correlationId', NEW.correlation_id
  );

  PERFORM realtime.send(
    v_payload,
    'video_session_event',
    'session:' || NEW.session_id::text,
    true
  );

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.broadcast_video_session_event_v2() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.broadcast_video_session_event_v2() TO service_role;

COMMENT ON FUNCTION public.broadcast_video_session_event_v2() IS
  'Broadcasts only sanitized participant-visible video_session_events to private session:{uuid} Realtime channels.';
