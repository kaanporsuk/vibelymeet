-- Phase 2: event-ticket checkout snapshots, automatic refund queue, and
-- caller-scoped payment status read model.

ALTER TABLE public.stripe_event_ticket_checkout_intents
  ADD COLUMN IF NOT EXISTS tier_at_checkout text,
  ADD COLUMN IF NOT EXISTS entitlement_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS event_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.stripe_event_ticket_checkout_intents
  DROP CONSTRAINT IF EXISTS stripe_event_ticket_checkout_intents_status_check;

ALTER TABLE public.stripe_event_ticket_checkout_intents
  ADD CONSTRAINT stripe_event_ticket_checkout_intents_status_check
  CHECK (
    status IN (
      'created',
      'verified',
      'settled',
      'amount_mismatch',
      'settlement_failed',
      'ignored',
      'refund_pending',
      'refunded',
      'refund_failed',
      'support_needed'
    )
  );

COMMENT ON COLUMN public.stripe_event_ticket_checkout_intents.tier_at_checkout IS
  'User tier id captured when the paid event checkout was created.';
COMMENT ON COLUMN public.stripe_event_ticket_checkout_intents.entitlement_snapshot IS
  'Caller entitlement/capability snapshot captured at checkout creation for settlement diagnostics.';
COMMENT ON COLUMN public.stripe_event_ticket_checkout_intents.event_snapshot IS
  'Event policy/price snapshot captured at checkout creation for settlement diagnostics.';

ALTER TABLE public.stripe_event_ticket_settlements
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.stripe_event_ticket_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_session_id text NOT NULL,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  payment_intent_id text,
  amount integer CHECK (amount IS NULL OR amount >= 0),
  currency text,
  reason_code text NOT NULL,
  settlement_outcome text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'processing',
      'refunded',
      'failed_retryable',
      'failed_permanent',
      'support_needed',
      'noop_already_refunded'
    )),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_by text,
  claim_expires_at timestamptz,
  stripe_refund_id text,
  stripe_refund_status text,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  refunded_at timestamptz,
  UNIQUE (checkout_session_id)
);

ALTER TABLE public.stripe_event_ticket_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stripe_event_ticket_refunds FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.stripe_event_ticket_refunds TO service_role;

DROP POLICY IF EXISTS stripe_event_ticket_refunds_service_role_all
  ON public.stripe_event_ticket_refunds;
CREATE POLICY stripe_event_ticket_refunds_service_role_all
  ON public.stripe_event_ticket_refunds
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_stripe_event_ticket_refunds_claim
  ON public.stripe_event_ticket_refunds(status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed_retryable', 'processing');

CREATE INDEX IF NOT EXISTS idx_stripe_event_ticket_refunds_user_event
  ON public.stripe_event_ticket_refunds(profile_id, event_id, created_at DESC);

COMMENT ON TABLE public.stripe_event_ticket_refunds IS
  'Durable automatic Stripe refund queue for paid event-ticket checkouts rejected after payment succeeded.';

CREATE OR REPLACE FUNCTION public.ensure_event_ticket_refund_support_exception_v1(
  p_checkout_session_id text,
  p_profile_id uuid,
  p_event_id uuid,
  p_exception_type text DEFAULT 'support_exception',
  p_exception_status text DEFAULT 'awaiting_external',
  p_settlement_outcome text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_existing_id uuid;
  v_id uuid;
  v_settlement_outcome text;
  v_admission_status text;
  v_event_status text;
  v_type text := COALESCE(NULLIF(btrim(p_exception_type), ''), 'support_exception');
  v_status text := COALESCE(NULLIF(btrim(p_exception_status), ''), 'awaiting_external');
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_checkout_session_id IS NULL OR p_profile_id IS NULL OR p_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_args' USING ERRCODE = '22023';
  END IF;

  IF v_type NOT IN (
    'refund_requested',
    'refund_handled_externally',
    'payment_mismatch',
    'registration_corrected',
    'cancelled_after_payment',
    'support_exception'
  ) THEN
    v_type := 'support_exception';
  END IF;

  IF v_status NOT IN ('open', 'in_review', 'awaiting_external', 'resolved', 'closed_no_action') THEN
    v_status := 'awaiting_external';
  END IF;

  SELECT id
  INTO v_existing_id
  FROM public.event_payment_exceptions
  WHERE checkout_session_id = p_checkout_session_id
    AND profile_id = p_profile_id
    AND event_id = p_event_id
    AND exception_status IN ('open', 'in_review', 'awaiting_external')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.event_payment_exceptions
    SET
      exception_status = CASE
        WHEN exception_status = 'open' AND v_status = 'awaiting_external' THEN 'awaiting_external'
        ELSE exception_status
      END,
      notes = COALESCE(notes, p_notes),
      updated_at = now()
    WHERE id = v_existing_id
    RETURNING id
    INTO v_id;
    RETURN v_id;
  END IF;

  SELECT er.admission_status
  INTO v_admission_status
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = p_profile_id
  ORDER BY er.registered_at DESC NULLS LAST
  LIMIT 1;

  SELECT e.status
  INTO v_event_status
  FROM public.events e
  WHERE e.id = p_event_id;

  SELECT s.outcome
  INTO v_settlement_outcome
  FROM public.stripe_event_ticket_settlements s
  WHERE s.checkout_session_id = p_checkout_session_id
  ORDER BY s.created_at DESC
  LIMIT 1;

  INSERT INTO public.event_payment_exceptions (
    event_id,
    profile_id,
    checkout_session_id,
    exception_type,
    exception_status,
    settlement_outcome_snapshot,
    registration_admission_snapshot,
    event_status_snapshot,
    notes,
    created_by
  )
  VALUES (
    p_event_id,
    p_profile_id,
    p_checkout_session_id,
    v_type,
    v_status,
    COALESCE(NULLIF(btrim(COALESCE(p_settlement_outcome, '')), ''), v_settlement_outcome),
    v_admission_status,
    v_event_status,
    p_notes,
    NULL
  )
  RETURNING id
  INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.ensure_event_ticket_refund_support_exception_v1(text, uuid, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_event_ticket_refund_support_exception_v1(text, uuid, uuid, text, text, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_event_ticket_refund_v1(
  p_checkout_session_id text,
  p_profile_id uuid,
  p_event_id uuid,
  p_payment_intent_id text DEFAULT NULL,
  p_amount integer DEFAULT NULL,
  p_currency text DEFAULT NULL,
  p_reason_code text DEFAULT 'business_reject',
  p_settlement_outcome text DEFAULT NULL,
  p_stripe_event_id text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_status text;
  v_public_status text;
  v_job public.stripe_event_ticket_refunds%ROWTYPE;
  v_support_needed boolean;
  v_exception_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden', 'code', 'FORBIDDEN');
  END IF;

  IF p_checkout_session_id IS NULL OR p_profile_id IS NULL OR p_event_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_args', 'code', 'INVALID_ARGS');
  END IF;

  v_support_needed :=
    NULLIF(btrim(COALESCE(p_payment_intent_id, '')), '') IS NULL
    OR p_amount IS NULL
    OR p_amount <= 0
    OR NULLIF(btrim(COALESCE(p_currency, '')), '') IS NULL;
  v_status := CASE WHEN v_support_needed THEN 'support_needed' ELSE 'pending' END;

  INSERT INTO public.stripe_event_ticket_refunds (
    checkout_session_id,
    profile_id,
    event_id,
    payment_intent_id,
    amount,
    currency,
    reason_code,
    settlement_outcome,
    status,
    next_attempt_at,
    last_error,
    metadata
  )
  VALUES (
    p_checkout_session_id,
    p_profile_id,
    p_event_id,
    NULLIF(btrim(COALESCE(p_payment_intent_id, '')), ''),
    p_amount,
    lower(NULLIF(btrim(COALESCE(p_currency, '')), '')),
    COALESCE(NULLIF(btrim(p_reason_code), ''), 'business_reject'),
    NULLIF(btrim(COALESCE(p_settlement_outcome, '')), ''),
    v_status,
    now(),
    CASE WHEN v_support_needed THEN 'missing_refundable_payment_intent_or_amount' ELSE NULL END,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'stripe_event_id', p_stripe_event_id,
      'enqueued_at', now()
    )
  )
  ON CONFLICT (checkout_session_id) DO UPDATE
  SET
    profile_id = EXCLUDED.profile_id,
    event_id = EXCLUDED.event_id,
    payment_intent_id = COALESCE(EXCLUDED.payment_intent_id, public.stripe_event_ticket_refunds.payment_intent_id),
    amount = COALESCE(EXCLUDED.amount, public.stripe_event_ticket_refunds.amount),
    currency = COALESCE(EXCLUDED.currency, public.stripe_event_ticket_refunds.currency),
    reason_code = EXCLUDED.reason_code,
    settlement_outcome = COALESCE(EXCLUDED.settlement_outcome, public.stripe_event_ticket_refunds.settlement_outcome),
    status = CASE
      WHEN public.stripe_event_ticket_refunds.status IN ('refunded', 'noop_already_refunded', 'failed_permanent') THEN public.stripe_event_ticket_refunds.status
      WHEN EXCLUDED.status = 'pending' AND public.stripe_event_ticket_refunds.status <> 'processing' THEN 'pending'
      WHEN EXCLUDED.status = 'support_needed' AND public.stripe_event_ticket_refunds.status <> 'processing' THEN 'support_needed'
      ELSE public.stripe_event_ticket_refunds.status
    END,
    next_attempt_at = CASE
      WHEN EXCLUDED.status = 'pending'
        AND public.stripe_event_ticket_refunds.status IN ('pending', 'failed_retryable', 'support_needed', 'failed_permanent')
      THEN now()
      ELSE public.stripe_event_ticket_refunds.next_attempt_at
    END,
    last_error = CASE
      WHEN EXCLUDED.status = 'support_needed' THEN EXCLUDED.last_error
      WHEN public.stripe_event_ticket_refunds.status IN ('failed_permanent', 'support_needed') THEN public.stripe_event_ticket_refunds.last_error
      ELSE NULL
    END,
    metadata = public.stripe_event_ticket_refunds.metadata || EXCLUDED.metadata,
    updated_at = now()
  RETURNING *
  INTO v_job;

  v_public_status := CASE
    WHEN v_job.status = 'noop_already_refunded' THEN 'refunded'
    ELSE v_job.status
  END;

  IF v_job.status = 'support_needed' THEN
    v_exception_id := public.ensure_event_ticket_refund_support_exception_v1(
      v_job.checkout_session_id,
      v_job.profile_id,
      v_job.event_id,
      'support_exception',
      'awaiting_external',
      v_job.settlement_outcome,
      'Automatic refund requires manual support: ' || v_job.reason_code || '. ' || COALESCE(v_job.last_error, 'missing refundable payment intent or verified amount.')
    );
  END IF;

  UPDATE public.stripe_event_ticket_settlements
  SET
    result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
      'refund_status', v_public_status,
      'refund_reason', v_job.reason_code,
      'refund_job_id', v_job.id,
      'support_needed', v_job.status = 'support_needed',
      'event_payment_exception_id', v_exception_id
    ),
    updated_at = now()
  WHERE checkout_session_id = p_checkout_session_id;

  UPDATE public.stripe_event_ticket_checkout_intents
  SET
    status = CASE
      WHEN v_job.status IN ('pending', 'processing', 'failed_retryable') THEN 'refund_pending'
      WHEN v_job.status IN ('refunded', 'noop_already_refunded') THEN 'refunded'
      WHEN v_job.status = 'failed_permanent' THEN 'refund_failed'
      WHEN v_job.status = 'support_needed' THEN 'support_needed'
      ELSE status
    END,
    stripe_event_id = COALESCE(p_stripe_event_id, stripe_event_id),
    metadata = metadata || jsonb_build_object(
      'refund_status', v_public_status,
      'refund_reason', v_job.reason_code,
      'refund_job_id', v_job.id,
      'support_needed', v_job.status = 'support_needed',
      'event_payment_exception_id', v_exception_id
    ),
    updated_at = now()
  WHERE checkout_session_id = p_checkout_session_id;

  IF v_exception_id IS NOT NULL THEN
    UPDATE public.stripe_event_ticket_refunds
    SET metadata = metadata || jsonb_build_object('event_payment_exception_id', v_exception_id)
    WHERE id = v_job.id
    RETURNING *
    INTO v_job;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'refund_job_id', v_job.id,
    'checkout_session_id', v_job.checkout_session_id,
    'status', v_public_status,
    'support_needed', v_job.status = 'support_needed',
    'idempotent', v_job.attempts > 0 OR v_job.created_at < now() - interval '1 second'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_event_ticket_refund_v1(text, uuid, uuid, text, integer, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_event_ticket_refund_v1(text, uuid, uuid, text, integer, text, text, text, text, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_event_ticket_refund_jobs_v1(
  p_worker_id text,
  p_limit integer DEFAULT 25,
  p_lease_seconds integer DEFAULT 60
)
RETURNS TABLE (
  id uuid,
  checkout_session_id text,
  profile_id uuid,
  event_id uuid,
  payment_intent_id text,
  amount integer,
  currency text,
  reason_code text,
  settlement_outcome text,
  attempts integer,
  max_attempts integer,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
  v_lease_seconds integer := LEAST(GREATEST(COALESCE(p_lease_seconds, 60), 5), 300);
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'worker_id required' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT r.id
    FROM public.stripe_event_ticket_refunds r
    WHERE (
        r.status IN ('pending', 'failed_retryable')
        AND r.next_attempt_at <= now()
      )
      OR (
        r.status = 'processing'
        AND r.claim_expires_at <= now()
      )
    ORDER BY r.next_attempt_at ASC, r.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.stripe_event_ticket_refunds r
  SET
    status = 'processing',
    attempts = r.attempts + 1,
    claimed_by = p_worker_id,
    claim_expires_at = now() + (v_lease_seconds * interval '1 second'),
    updated_at = now()
  FROM candidate
  WHERE r.id = candidate.id
    AND r.payment_intent_id IS NOT NULL
    AND r.amount IS NOT NULL
    AND r.amount > 0
    AND r.currency IS NOT NULL
  RETURNING
    r.id,
    r.checkout_session_id,
    r.profile_id,
    r.event_id,
    r.payment_intent_id,
    r.amount,
    r.currency,
    r.reason_code,
    r.settlement_outcome,
    r.attempts,
    r.max_attempts,
    r.metadata;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_event_ticket_refund_jobs_v1(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_event_ticket_refund_jobs_v1(text, integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_event_ticket_refund_job_v1(
  p_job_id uuid,
  p_worker_id text,
  p_success boolean,
  p_provider_refund_id text DEFAULT NULL,
  p_provider_refund_status text DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_retry_after_seconds integer DEFAULT NULL,
  p_permanent boolean DEFAULT false,
  p_noop_already_refunded boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_job public.stripe_event_ticket_refunds%ROWTYPE;
  v_status text;
  v_public_status text;
  v_retry_after integer;
  v_support_needed boolean;
  v_exception_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden', 'code', 'FORBIDDEN');
  END IF;

  SELECT *
  INTO v_job
  FROM public.stripe_event_ticket_refunds
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'refund_job_not_found', 'code', 'NOT_FOUND');
  END IF;

  IF v_job.status = 'refunded' OR v_job.status = 'noop_already_refunded' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'refunded', 'idempotent', true);
  END IF;

  IF v_job.claimed_by IS DISTINCT FROM p_worker_id
     OR v_job.claim_expires_at IS NULL
     OR v_job.claim_expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lease_expired', 'code', 'LEASE_EXPIRED');
  END IF;

  IF p_success THEN
    v_status := CASE WHEN p_noop_already_refunded THEN 'noop_already_refunded' ELSE 'refunded' END;
  ELSIF COALESCE(p_permanent, false) OR v_job.attempts >= v_job.max_attempts THEN
    v_status := 'failed_permanent';
  ELSE
    v_status := 'failed_retryable';
  END IF;

  v_public_status := CASE WHEN v_status = 'noop_already_refunded' THEN 'refunded' ELSE v_status END;
  v_retry_after := LEAST(GREATEST(COALESCE(p_retry_after_seconds, 30 * GREATEST(v_job.attempts, 1)), 5), 3600);
  v_support_needed := v_status = 'failed_permanent';

  IF v_support_needed THEN
    v_exception_id := public.ensure_event_ticket_refund_support_exception_v1(
      v_job.checkout_session_id,
      v_job.profile_id,
      v_job.event_id,
      'support_exception',
      'awaiting_external',
      v_job.settlement_outcome,
      'Automatic Stripe refund permanently failed: ' || LEFT(COALESCE(p_error, 'refund_failed'), 400)
    );
  END IF;

  UPDATE public.stripe_event_ticket_refunds
  SET
    status = v_status,
    stripe_refund_id = COALESCE(NULLIF(btrim(COALESCE(p_provider_refund_id, '')), ''), stripe_refund_id),
    stripe_refund_status = COALESCE(NULLIF(btrim(COALESCE(p_provider_refund_status, '')), ''), stripe_refund_status),
    last_error = CASE WHEN p_success THEN NULL ELSE LEFT(COALESCE(p_error, 'refund_failed'), 500) END,
    next_attempt_at = CASE WHEN v_status = 'failed_retryable' THEN now() + make_interval(secs => v_retry_after) ELSE next_attempt_at END,
    claimed_by = NULL,
    claim_expires_at = NULL,
    refunded_at = CASE WHEN v_status IN ('refunded', 'noop_already_refunded') THEN COALESCE(refunded_at, now()) ELSE refunded_at END,
    updated_at = now(),
    metadata = metadata || jsonb_build_object(
      'last_completed_at', now(),
      'last_provider_status', p_provider_refund_status,
      'last_noop_already_refunded', COALESCE(p_noop_already_refunded, false),
      'event_payment_exception_id', v_exception_id
    )
  WHERE id = p_job_id
  RETURNING *
  INTO v_job;

  UPDATE public.stripe_event_ticket_settlements
  SET
    result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
      'refund_status', v_public_status,
      'refund_reason', v_job.reason_code,
      'refund_job_id', v_job.id,
      'refund_provider_id', v_job.stripe_refund_id,
      'refund_provider_status', v_job.stripe_refund_status,
      'support_needed', v_support_needed,
      'event_payment_exception_id', v_exception_id,
      'refund_error', CASE WHEN p_success THEN NULL ELSE LEFT(COALESCE(p_error, 'refund_failed'), 500) END
    ),
    updated_at = now()
  WHERE checkout_session_id = v_job.checkout_session_id;

  UPDATE public.stripe_event_ticket_checkout_intents
  SET
    status = CASE
      WHEN v_status IN ('refunded', 'noop_already_refunded') THEN 'refunded'
      WHEN v_status = 'failed_permanent' THEN 'refund_failed'
      WHEN v_status = 'failed_retryable' THEN 'refund_pending'
      ELSE status
    END,
    metadata = metadata || jsonb_build_object(
      'refund_status', v_public_status,
      'refund_provider_id', v_job.stripe_refund_id,
      'refund_provider_status', v_job.stripe_refund_status,
      'support_needed', v_support_needed,
      'event_payment_exception_id', v_exception_id
    ),
    updated_at = now()
  WHERE checkout_session_id = v_job.checkout_session_id;

  RETURN jsonb_build_object(
    'ok', true,
    'refund_job_id', v_job.id,
    'checkout_session_id', v_job.checkout_session_id,
    'status', v_public_status,
    'support_needed', v_support_needed
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_event_ticket_refund_job_v1(uuid, text, boolean, text, text, text, integer, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_event_ticket_refund_job_v1(uuid, text, boolean, text, text, text, integer, boolean, boolean)
  TO service_role;

DROP FUNCTION IF EXISTS public.settle_event_ticket_checkout_20260523200000_phase2_base(text, uuid, uuid);
ALTER FUNCTION public.settle_event_ticket_checkout(text, uuid, uuid)
  RENAME TO settle_event_ticket_checkout_20260523200000_phase2_base;

REVOKE ALL ON FUNCTION public.settle_event_ticket_checkout_20260523200000_phase2_base(text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_event_ticket_checkout_20260523200000_phase2_base(text, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.settle_event_ticket_checkout(
  p_checkout_session_id text,
  p_profile_id uuid,
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_result jsonb;
  v_final_result jsonb;
  v_intent record;
  v_event record;
  v_current_settlement record;
  v_prior_successful_checkout_session_id text;
  v_current_caps jsonb := '{}'::jsonb;
  v_snapshot_access boolean := false;
  v_current_access boolean := false;
  v_current_amount integer;
  v_policy_context jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'FORBIDDEN');
  END IF;

  SELECT
    checkout_session_id,
    tier_at_checkout,
    entitlement_snapshot,
    event_snapshot,
    expected_amount,
    expected_currency
  INTO v_intent
  FROM public.stripe_event_ticket_checkout_intents
  WHERE checkout_session_id = p_checkout_session_id;

  SELECT
    visibility,
    price_amount,
    price_currency,
    status,
    archived_at,
    ended_at
  INTO v_event
  FROM public.events
  WHERE id = p_event_id;

  IF FOUND THEN
    v_current_amount := CASE
      WHEN v_event.price_amount IS NULL THEN NULL
      ELSE round((v_event.price_amount::numeric) * 100)::integer
    END;
  END IF;

  v_current_caps := COALESCE(public._get_user_tier_capabilities_unchecked(p_profile_id), '{}'::jsonb);
  v_current_access := public._user_can_access_event_visibility_unchecked(
    p_profile_id,
    COALESCE(v_event.visibility, 'all')
  );

  IF COALESCE(v_event.visibility, 'all') = 'all' THEN
    v_snapshot_access := true;
  ELSIF v_intent.entitlement_snapshot ? 'accessibleEventTiers' THEN
    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(v_intent.entitlement_snapshot->'accessibleEventTiers') AS item(value)
      WHERE item.value = COALESCE(v_event.visibility, 'all')
    )
    INTO v_snapshot_access;
  END IF;

  v_policy_context := jsonb_build_object(
    'checkout_policy', jsonb_build_object(
      'checkout_snapshot_present', v_intent.checkout_session_id IS NOT NULL,
      'tier_at_checkout', v_intent.tier_at_checkout,
      'current_tier_id', v_current_caps->>'tierId',
      'visibility_at_checkout', v_intent.event_snapshot->>'visibility',
      'current_event_visibility', v_event.visibility,
      'access_at_checkout', COALESCE(v_snapshot_access, false),
      'access_at_settlement', COALESCE(v_current_access, false),
      'expected_amount_at_checkout', v_intent.expected_amount,
      'current_event_amount', v_current_amount,
      'expected_currency_at_checkout', lower(COALESCE(v_intent.expected_currency, '')),
      'current_event_currency', lower(COALESCE(v_event.price_currency, '')),
      'event_policy_changed',
        COALESCE(v_intent.event_snapshot->>'visibility', '') IS DISTINCT FROM COALESCE(v_event.visibility, '')
        OR v_intent.expected_amount IS DISTINCT FROM v_current_amount
        OR lower(COALESCE(v_intent.expected_currency, '')) IS DISTINCT FROM lower(COALESCE(v_event.price_currency, ''))
    )
  );

  PERFORM pg_advisory_xact_lock(hashtext(p_profile_id::text), hashtext(p_event_id::text));

  SELECT outcome, result
  INTO v_current_settlement
  FROM public.stripe_event_ticket_settlements
  WHERE checkout_session_id = p_checkout_session_id
  FOR UPDATE;

  IF FOUND AND v_current_settlement.outcome IS DISTINCT FROM 'in_progress' THEN
    v_final_result := COALESCE(v_current_settlement.result, '{}'::jsonb)
      || jsonb_build_object('idempotent', true, 'outcome', v_current_settlement.outcome)
      || v_policy_context;
    UPDATE public.stripe_event_ticket_settlements
    SET result = v_final_result,
        updated_at = now()
    WHERE checkout_session_id = p_checkout_session_id;
    RETURN v_final_result;
  END IF;

  SELECT s.checkout_session_id
  INTO v_prior_successful_checkout_session_id
  FROM public.stripe_event_ticket_settlements s
  WHERE s.profile_id = p_profile_id
    AND s.event_id = p_event_id
    AND s.checkout_session_id IS DISTINCT FROM p_checkout_session_id
    AND lower(COALESCE(s.result->>'success', 'false')) IN ('true', 't', '1', 'yes')
  ORDER BY s.created_at ASC
  LIMIT 1;

  IF v_prior_successful_checkout_session_id IS NOT NULL THEN
    v_result := jsonb_build_object(
      'success', false,
      'error', 'duplicate_paid_checkout',
      'code', 'DUPLICATE_PAID_CHECKOUT',
      'prior_checkout_session_id', v_prior_successful_checkout_session_id
    );
    v_final_result := v_result || v_policy_context;

    INSERT INTO public.stripe_event_ticket_settlements (
      checkout_session_id,
      profile_id,
      event_id,
      outcome,
      result
    )
    VALUES (
      p_checkout_session_id,
      p_profile_id,
      p_event_id,
      'rejected_duplicate',
      v_final_result
    )
    ON CONFLICT (checkout_session_id) DO UPDATE
    SET outcome = 'rejected_duplicate',
        result = EXCLUDED.result,
        updated_at = now()
    WHERE public.stripe_event_ticket_settlements.outcome = 'in_progress'
       OR public.stripe_event_ticket_settlements.outcome IS NULL
    RETURNING result
    INTO v_final_result;

    RETURN COALESCE(v_final_result, v_result || v_policy_context);
  END IF;

  v_result := public.settle_event_ticket_checkout_20260523200000_phase2_base(
    p_checkout_session_id,
    p_profile_id,
    p_event_id
  );

  UPDATE public.stripe_event_ticket_settlements
  SET
    result = COALESCE(result, '{}'::jsonb) || v_policy_context,
    updated_at = now()
  WHERE checkout_session_id = p_checkout_session_id
  RETURNING result
  INTO v_final_result;

  RETURN COALESCE(v_final_result, COALESCE(v_result, '{}'::jsonb) || v_policy_context);
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_event_ticket_checkout(text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_event_ticket_checkout(text, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.settle_event_ticket_checkout(text, uuid, uuid) IS
  'Phase 2 wrapper around paid event-ticket settlement: preserves existing admission policy while recording checkout snapshot vs current policy context for clear outcomes.';

CREATE OR REPLACE FUNCTION public.get_event_ticket_payment_status_v1(
  p_event_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_registration record;
  v_settlement record;
  v_checkout record;
  v_refund record;
  v_refund_status text := 'none';
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT er.admission_status, er.payment_status
  INTO v_registration
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_uid
  ORDER BY er.registered_at DESC NULLS LAST
  LIMIT 1;

  SELECT
    i.checkout_session_id,
    i.status,
    i.expected_amount,
    i.expected_currency,
    i.tier_at_checkout,
    i.entitlement_snapshot,
    i.event_snapshot,
    i.created_at,
    i.updated_at
  INTO v_checkout
  FROM public.stripe_event_ticket_checkout_intents i
  WHERE i.event_id = p_event_id
    AND i.user_id = v_uid
  ORDER BY i.created_at DESC
  LIMIT 1;

  SELECT s.checkout_session_id, s.outcome, s.result, s.created_at, s.updated_at
  INTO v_settlement
  FROM public.stripe_event_ticket_settlements s
  WHERE s.event_id = p_event_id
    AND s.profile_id = v_uid
    AND (
      v_checkout.checkout_session_id IS NULL
      OR s.checkout_session_id = v_checkout.checkout_session_id
    )
  ORDER BY s.created_at DESC
  LIMIT 1;

  SELECT
    r.id,
    r.checkout_session_id,
    r.status,
    r.reason_code,
    r.amount,
    r.currency,
    r.stripe_refund_id,
    r.stripe_refund_status,
    r.last_error,
    r.created_at,
    r.updated_at,
    r.refunded_at
  INTO v_refund
  FROM public.stripe_event_ticket_refunds r
  WHERE r.event_id = p_event_id
    AND r.profile_id = v_uid
    AND (
      v_checkout.checkout_session_id IS NULL
      OR r.checkout_session_id = v_checkout.checkout_session_id
    )
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF v_refund.id IS NOT NULL THEN
    v_refund_status := CASE
      WHEN v_refund.status = 'noop_already_refunded' THEN 'refunded'
      ELSE v_refund.status
    END;
  ELSIF v_settlement.checkout_session_id IS NOT NULL THEN
    v_refund_status := COALESCE(v_settlement.result->>'refund_status', 'none');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'event_id', p_event_id,
    'admission_status', v_registration.admission_status,
    'payment_status', v_registration.payment_status,
    'checkout', CASE
      WHEN v_checkout.checkout_session_id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'checkout_session_id', v_checkout.checkout_session_id,
        'status', v_checkout.status,
        'expected_amount', v_checkout.expected_amount,
        'expected_currency', v_checkout.expected_currency,
        'tier_at_checkout', v_checkout.tier_at_checkout,
        'tier_snapshot', jsonb_build_object(
          'tier_id', v_checkout.entitlement_snapshot->>'tierId',
          'tier_label', v_checkout.entitlement_snapshot->>'tierLabel',
          'accessible_event_tiers', COALESCE(v_checkout.entitlement_snapshot->'accessibleEventTiers', '[]'::jsonb),
          'monthly_event_joins', v_checkout.entitlement_snapshot->'monthlyEventJoins'
        ),
        'event_snapshot', v_checkout.event_snapshot,
        'created_at', v_checkout.created_at,
        'updated_at', v_checkout.updated_at
      )
    END,
    'settlement', CASE
      WHEN v_settlement.checkout_session_id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'checkout_session_id', v_settlement.checkout_session_id,
        'outcome', v_settlement.outcome,
        'code', v_settlement.result->>'code',
        'error', v_settlement.result->>'error',
        'admission_status', v_settlement.result->>'admission_status',
        'success', v_settlement.result->'success',
        'refund_status', v_refund_status,
        'support_needed', lower(COALESCE(v_settlement.result->>'support_needed', 'false')) IN ('true', 't', '1', 'yes') OR v_refund_status IN ('support_needed', 'failed_permanent'),
        'updated_at', COALESCE(v_settlement.updated_at, v_settlement.created_at),
        'created_at', v_settlement.created_at
      )
    END,
    'refund', CASE
      WHEN v_refund.id IS NULL THEN jsonb_build_object('status', v_refund_status)
      ELSE jsonb_build_object(
        'id', v_refund.id,
        'checkout_session_id', v_refund.checkout_session_id,
        'status', v_refund_status,
        'reason_code', v_refund.reason_code,
        'amount', v_refund.amount,
        'currency', v_refund.currency,
        'provider_refund_id', v_refund.stripe_refund_id,
        'provider_status', v_refund.stripe_refund_status,
        'support_needed', v_refund.status IN ('support_needed', 'failed_permanent'),
        'last_error', v_refund.last_error,
        'created_at', v_refund.created_at,
        'updated_at', v_refund.updated_at,
        'refunded_at', v_refund.refunded_at
      )
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_event_ticket_payment_status_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_ticket_payment_status_v1(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_event_ticket_payment_status_v1(uuid) IS
  'Authenticated caller read model for their own event-ticket checkout, settlement, and automatic refund state.';

DO $$
DECLARE
  v_project_url text;
  v_cron_secret text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
     AND to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    SELECT btrim(decrypted_secret, E' \t\n\r')
    INTO v_project_url
    FROM vault.decrypted_secrets
    WHERE name = 'project_url'
    LIMIT 1;

    SELECT btrim(decrypted_secret, E' \t\n\r')
    INTO v_cron_secret
    FROM vault.decrypted_secrets
    WHERE name = 'cron_secret'
    LIMIT 1;

    IF NULLIF(v_project_url, '') IS NOT NULL AND NULLIF(v_cron_secret, '') IS NOT NULL THEN
      PERFORM cron.unschedule(jobid)
      FROM cron.job
      WHERE jobname = 'event-ticket-refund-worker';

      PERFORM cron.schedule(
        'event-ticket-refund-worker',
        '* * * * *',
        $cron$
        SELECT net.http_post(
          url := (select btrim(decrypted_secret, E' \t\n\r') from vault.decrypted_secrets where name = 'project_url' limit 1)
            || '/functions/v1/process-event-ticket-refunds',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || btrim((select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1), E' \t\n\r')
          ),
          body := jsonb_build_object('source', 'pg_cron', 'batch_size', 25)
        );
        $cron$
      );
    ELSE
      RAISE NOTICE 'event-ticket refund worker cron not scheduled: missing Vault project_url or cron_secret';
    END IF;
  ELSE
    RAISE NOTICE 'event-ticket refund worker cron not scheduled: pg_cron, pg_net, or Vault unavailable';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'event-ticket refund worker cron scheduling skipped: %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';
