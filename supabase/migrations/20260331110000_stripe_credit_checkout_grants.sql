-- Idempotency ledger for Stripe credit-pack checkouts (service role / webhook only).

CREATE TABLE IF NOT EXISTS public.stripe_credit_checkout_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkout_session_id text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_credit_checkout_grants_user_id
  ON public.stripe_credit_checkout_grants(user_id);

ALTER TABLE public.stripe_credit_checkout_grants ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.stripe_credit_checkout_grants FROM PUBLIC;
REVOKE ALL ON TABLE public.stripe_credit_checkout_grants FROM anon;
REVOKE ALL ON TABLE public.stripe_credit_checkout_grants FROM authenticated;
