-- Stream 9: premium / credits / paid-event payment observability and Stripe webhook idempotency.
-- Additive only: no pricing, entitlement, credit, or registration semantics change.

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  stripe_event_id text PRIMARY KEY,
  event_type text NOT NULL,
  status text NOT NULL,
  checkout_session_id text,
  stripe_customer_id text,
  stripe_subscription_id text,
  user_id uuid,
  paid_event_id uuid,
  pack_id text,
  plan text,
  result text,
  error_code text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT stripe_webhook_events_status_check
    CHECK (status IN ('received', 'processing', 'processed', 'failed', 'duplicate_skipped', 'ignored'))
);

COMMENT ON TABLE public.stripe_webhook_events IS
  'Service-role Stripe webhook idempotency ledger keyed by Stripe event id. Stores safe operational metadata only, never raw Stripe payloads.';
COMMENT ON COLUMN public.stripe_webhook_events.metadata_summary IS
  'Redacted metadata summary for operator debugging. Do not store raw Stripe objects, card data, emails, URLs, or secrets.';

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_user_id
  ON public.stripe_webhook_events(user_id);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_type_status
  ON public.stripe_webhook_events(event_type, status);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_received_at
  ON public.stripe_webhook_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_checkout_session_id
  ON public.stripe_webhook_events(checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_subscription_id
  ON public.stripe_webhook_events(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.stripe_webhook_events FROM PUBLIC;
REVOKE ALL ON TABLE public.stripe_webhook_events FROM anon;
REVOKE ALL ON TABLE public.stripe_webhook_events FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.stripe_webhook_events TO service_role;

CREATE TABLE IF NOT EXISTS public.payment_observability_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  status text NOT NULL,
  result text,
  error_code text,
  stripe_event_id text,
  event_type text,
  checkout_session_id text,
  stripe_customer_id text,
  stripe_subscription_id text,
  user_id uuid,
  paid_event_id uuid,
  pack_id text,
  plan text,
  amount integer,
  currency text,
  metadata_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payment_observability_events IS
  'Append-only service-role payment observability ledger for checkout, portal, Stripe webhook, and settlement outcomes. Safe operational context only.';
COMMENT ON COLUMN public.payment_observability_events.amount IS
  'Minor-unit amount where already known from checkout/session context.';
COMMENT ON COLUMN public.payment_observability_events.metadata_summary IS
  'Redacted context summary. Do not store raw provider payloads, card/payment-method details, emails, URLs, or secrets.';

CREATE INDEX IF NOT EXISTS idx_payment_observability_events_created_at
  ON public.payment_observability_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_observability_events_category_status
  ON public.payment_observability_events(category, status);
CREATE INDEX IF NOT EXISTS idx_payment_observability_events_user_id
  ON public.payment_observability_events(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_observability_events_stripe_event_id
  ON public.payment_observability_events(stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_observability_events_checkout_session_id
  ON public.payment_observability_events(checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;

ALTER TABLE public.payment_observability_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payment_observability_events FROM PUBLIC;
REVOKE ALL ON TABLE public.payment_observability_events FROM anon;
REVOKE ALL ON TABLE public.payment_observability_events FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.payment_observability_events TO service_role;
