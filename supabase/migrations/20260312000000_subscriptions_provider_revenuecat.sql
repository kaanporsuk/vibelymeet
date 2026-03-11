-- Sprint 6: Canonical entitlement model — subscriptions can come from Stripe (web) or RevenueCat (native).
-- Additive: existing rows become provider='stripe'; new RevenueCat webhook will insert provider='revenuecat'.
-- Premium flag (profiles.is_premium) is derived from any active subscription via trigger.

-- 1) Add provider column; default 'stripe' for existing rows
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe';

-- 2) Allow multiple rows per user (one per provider)
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_user_id_key;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_user_id_provider_key UNIQUE (user_id, provider);

-- 3) RevenueCat-specific columns (nullable for Stripe rows)
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS rc_product_id text,
  ADD COLUMN IF NOT EXISTS rc_original_app_user_id text;

-- 4) Sync profiles.is_premium from any active subscription (trigger)
CREATE OR REPLACE FUNCTION public.sync_profiles_is_premium_from_subscriptions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_is_premium boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_user_id := OLD.user_id;
  ELSE
    v_user_id := NEW.user_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = v_user_id
      AND status IN ('active', 'trialing')
  ) INTO v_is_premium;

  UPDATE public.profiles
  SET is_premium = v_is_premium
  WHERE id = v_user_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_profiles_is_premium_trigger ON public.subscriptions;
CREATE TRIGGER sync_profiles_is_premium_trigger
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profiles_is_premium_from_subscriptions();

-- 5) Backfill: ensure all existing rows have provider = 'stripe'
UPDATE public.subscriptions SET provider = 'stripe' WHERE provider IS NULL OR provider = '';

-- 6) get_user_subscription_status: return effective status (any active/trialing = active)
CREATE OR REPLACE FUNCTION public.get_user_subscription_status(p_user_id uuid)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    (SELECT status FROM public.subscriptions
     WHERE user_id = p_user_id AND status IN ('active', 'trialing')
     ORDER BY current_period_end DESC NULLS LAST
     LIMIT 1),
    (SELECT status FROM public.subscriptions WHERE user_id = p_user_id LIMIT 1),
    'inactive'
  );
$$;

-- 7) check_premium_status: true if any subscription is active or trialing (or profile already has is_premium from admin grant)
CREATE OR REPLACE FUNCTION public.check_premium_status(p_user_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    (SELECT EXISTS (
      SELECT 1 FROM public.subscriptions
      WHERE user_id = p_user_id AND status IN ('active', 'trialing')
    ))
    OR (SELECT is_premium FROM public.profiles WHERE id = p_user_id),
    false
  );
$$;
