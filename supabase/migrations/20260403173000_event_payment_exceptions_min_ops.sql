-- Event payment exceptions: thin manual support/operator layer.
-- This stream does NOT change settlement, admission, waitlist, or FIFO behavior.

-- 1) Exception table (manual/operator truth only)
CREATE TABLE IF NOT EXISTS public.event_payment_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  checkout_session_id text,
  support_ticket_id uuid REFERENCES public.support_tickets(id) ON DELETE SET NULL,

  exception_type text NOT NULL
    CHECK (exception_type IN (
      'refund_requested',
      'refund_handled_externally',
      'payment_mismatch',
      'registration_corrected',
      'cancelled_after_payment',
      'support_exception'
    )),
  exception_status text NOT NULL DEFAULT 'open'
    CHECK (exception_status IN ('open', 'in_review', 'awaiting_external', 'resolved', 'closed_no_action')),
  resolution text,

  settlement_outcome_snapshot text,
  registration_admission_snapshot text,
  event_status_snapshot text,

  refund_handled_externally boolean NOT NULL DEFAULT false,
  external_refund_reference text,
  notes text,

  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_event_payment_exceptions_event_id
  ON public.event_payment_exceptions(event_id);

CREATE INDEX IF NOT EXISTS idx_event_payment_exceptions_profile_id
  ON public.event_payment_exceptions(profile_id);

CREATE INDEX IF NOT EXISTS idx_event_payment_exceptions_status
  ON public.event_payment_exceptions(exception_status);

CREATE INDEX IF NOT EXISTS idx_event_payment_exceptions_support_ticket_id
  ON public.event_payment_exceptions(support_ticket_id)
  WHERE support_ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_payment_exceptions_checkout_session_id
  ON public.event_payment_exceptions(checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;

ALTER TABLE public.event_payment_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_all_event_payment_exceptions"
  ON public.event_payment_exceptions
  FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_payment_exceptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_payment_exceptions TO service_role;

-- Keep updated_at current for operator state transitions.
DROP TRIGGER IF EXISTS event_payment_exceptions_updated_at ON public.event_payment_exceptions;
CREATE TRIGGER event_payment_exceptions_updated_at
  BEFORE UPDATE ON public.event_payment_exceptions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Support linkage to payment/event context (optional, backwards compatible)
ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS checkout_session_id text,
  ADD COLUMN IF NOT EXISTS event_payment_exception_id uuid REFERENCES public.event_payment_exceptions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_support_tickets_event_id
  ON public.support_tickets(event_id)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_tickets_checkout_session_id
  ON public.support_tickets(checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_support_tickets_exception_id
  ON public.support_tickets(event_payment_exception_id)
  WHERE event_payment_exception_id IS NOT NULL;

-- 3) Admin helper: create exception case with truth snapshots
CREATE OR REPLACE FUNCTION public.admin_create_event_payment_exception(
  p_event_id uuid,
  p_profile_id uuid,
  p_exception_type text,
  p_exception_status text DEFAULT 'open',
  p_checkout_session_id text DEFAULT NULL,
  p_support_ticket_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_settlement_outcome text;
  v_admission_status text;
  v_event_status text;
  v_id uuid;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF p_event_id IS NULL OR p_profile_id IS NULL OR p_exception_type IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_args');
  END IF;

  IF p_exception_type NOT IN (
    'refund_requested',
    'refund_handled_externally',
    'payment_mismatch',
    'registration_corrected',
    'cancelled_after_payment',
    'support_exception'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_exception_type');
  END IF;

  IF p_exception_status NOT IN ('open', 'in_review', 'awaiting_external', 'resolved', 'closed_no_action') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_exception_status');
  END IF;

  SELECT er.admission_status
  INTO v_admission_status
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = p_profile_id
  LIMIT 1;

  SELECT e.status
  INTO v_event_status
  FROM public.events e
  WHERE e.id = p_event_id;

  IF p_checkout_session_id IS NOT NULL THEN
    SELECT s.outcome
    INTO v_settlement_outcome
    FROM public.stripe_event_ticket_settlements s
    WHERE s.checkout_session_id = p_checkout_session_id
    LIMIT 1;
  ELSE
    SELECT s.outcome
    INTO v_settlement_outcome
    FROM public.stripe_event_ticket_settlements s
    WHERE s.event_id = p_event_id
      AND s.profile_id = p_profile_id
    ORDER BY s.created_at DESC
    LIMIT 1;
  END IF;

  INSERT INTO public.event_payment_exceptions (
    event_id,
    profile_id,
    checkout_session_id,
    support_ticket_id,
    exception_type,
    exception_status,
    settlement_outcome_snapshot,
    registration_admission_snapshot,
    event_status_snapshot,
    notes,
    created_by,
    resolved_by,
    resolved_at
  ) VALUES (
    p_event_id,
    p_profile_id,
    p_checkout_session_id,
    p_support_ticket_id,
    p_exception_type,
    p_exception_status,
    v_settlement_outcome,
    v_admission_status,
    v_event_status,
    p_notes,
    v_admin_id,
    CASE WHEN p_exception_status = 'resolved' THEN v_admin_id ELSE NULL END,
    CASE WHEN p_exception_status = 'resolved' THEN now() ELSE NULL END
  )
  RETURNING id INTO v_id;

  IF p_support_ticket_id IS NOT NULL THEN
    UPDATE public.support_tickets
    SET
      event_id = p_event_id,
      checkout_session_id = COALESCE(p_checkout_session_id, checkout_session_id),
      event_payment_exception_id = v_id
    WHERE id = p_support_ticket_id;
  END IF;

  INSERT INTO public.admin_activity_logs (
    admin_id,
    action_type,
    target_type,
    target_id,
    details
  ) VALUES (
    v_admin_id,
    'create_event_payment_exception',
    'event_payment_exception',
    v_id::text,
    jsonb_build_object(
      'event_id', p_event_id,
      'profile_id', p_profile_id,
      'checkout_session_id', p_checkout_session_id,
      'support_ticket_id', p_support_ticket_id,
      'exception_type', p_exception_type,
      'exception_status', p_exception_status,
      'settlement_outcome_snapshot', v_settlement_outcome,
      'registration_admission_snapshot', v_admission_status,
      'event_status_snapshot', v_event_status
    )
  );

  RETURN jsonb_build_object('success', true, 'exception_id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_create_event_payment_exception(uuid, uuid, text, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_event_payment_exception(uuid, uuid, text, text, text, uuid, text) TO authenticated;

-- 4) Admin helper: transition exception state + audit every transition
CREATE OR REPLACE FUNCTION public.admin_transition_event_payment_exception(
  p_exception_id uuid,
  p_exception_type text DEFAULT NULL,
  p_exception_status text DEFAULT NULL,
  p_resolution text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_refund_handled_externally boolean DEFAULT NULL,
  p_external_refund_reference text DEFAULT NULL,
  p_support_ticket_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_before record;
  v_after record;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO v_before
  FROM public.event_payment_exceptions
  WHERE id = p_exception_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  IF p_exception_type IS NOT NULL AND p_exception_type NOT IN (
    'refund_requested',
    'refund_handled_externally',
    'payment_mismatch',
    'registration_corrected',
    'cancelled_after_payment',
    'support_exception'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_exception_type');
  END IF;

  IF p_exception_status IS NOT NULL
     AND p_exception_status NOT IN ('open', 'in_review', 'awaiting_external', 'resolved', 'closed_no_action') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_exception_status');
  END IF;

  UPDATE public.event_payment_exceptions
  SET
    exception_type = COALESCE(p_exception_type, exception_type),
    exception_status = COALESCE(p_exception_status, exception_status),
    resolution = COALESCE(p_resolution, resolution),
    notes = COALESCE(p_notes, notes),
    refund_handled_externally = COALESCE(p_refund_handled_externally, refund_handled_externally),
    external_refund_reference = COALESCE(p_external_refund_reference, external_refund_reference),
    support_ticket_id = COALESCE(p_support_ticket_id, support_ticket_id),
    resolved_by = CASE
      WHEN COALESCE(p_exception_status, exception_status) = 'resolved' THEN v_admin_id
      ELSE resolved_by
    END,
    resolved_at = CASE
      WHEN COALESCE(p_exception_status, exception_status) = 'resolved' THEN now()
      ELSE resolved_at
    END,
    settlement_outcome_snapshot = COALESCE(
      (
        SELECT s.outcome
        FROM public.stripe_event_ticket_settlements s
        WHERE s.checkout_session_id = COALESCE(v_before.checkout_session_id, s.checkout_session_id)
          AND s.event_id = v_before.event_id
          AND s.profile_id = v_before.profile_id
        ORDER BY s.created_at DESC
        LIMIT 1
      ),
      settlement_outcome_snapshot
    ),
    registration_admission_snapshot = COALESCE(
      (
        SELECT er.admission_status
        FROM public.event_registrations er
        WHERE er.event_id = v_before.event_id
          AND er.profile_id = v_before.profile_id
        LIMIT 1
      ),
      registration_admission_snapshot
    ),
    event_status_snapshot = COALESCE(
      (
        SELECT e.status
        FROM public.events e
        WHERE e.id = v_before.event_id
      ),
      event_status_snapshot
    )
  WHERE id = p_exception_id;

  SELECT * INTO v_after
  FROM public.event_payment_exceptions
  WHERE id = p_exception_id;

  IF v_after.support_ticket_id IS NOT NULL THEN
    UPDATE public.support_tickets
    SET
      event_id = v_after.event_id,
      checkout_session_id = COALESCE(v_after.checkout_session_id, checkout_session_id),
      event_payment_exception_id = v_after.id
    WHERE id = v_after.support_ticket_id;
  END IF;

  INSERT INTO public.admin_activity_logs (
    admin_id,
    action_type,
    target_type,
    target_id,
    details
  ) VALUES (
    v_admin_id,
    'transition_event_payment_exception',
    'event_payment_exception',
    p_exception_id::text,
    jsonb_build_object(
      'before_exception_type', v_before.exception_type,
      'after_exception_type', v_after.exception_type,
      'before_exception_status', v_before.exception_status,
      'after_exception_status', v_after.exception_status,
      'before_resolution', v_before.resolution,
      'after_resolution', v_after.resolution,
      'before_refund_handled_externally', v_before.refund_handled_externally,
      'after_refund_handled_externally', v_after.refund_handled_externally,
      'before_external_refund_reference', v_before.external_refund_reference,
      'after_external_refund_reference', v_after.external_refund_reference,
      'event_id', v_after.event_id,
      'profile_id', v_after.profile_id,
      'support_ticket_id', v_after.support_ticket_id,
      'checkout_session_id', v_after.checkout_session_id
    )
  );

  RETURN jsonb_build_object('success', true, 'exception_id', p_exception_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_transition_event_payment_exception(uuid, text, text, text, text, boolean, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_transition_event_payment_exception(uuid, text, text, text, text, boolean, text, uuid) TO authenticated;
