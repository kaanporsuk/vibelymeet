-- Stripe credit-pack grants are logged to credit_adjustments by the webhook (service role).
-- No human admin actor exists for those rows.
ALTER TABLE public.credit_adjustments
  ALTER COLUMN admin_id DROP NOT NULL;
