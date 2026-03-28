-- Canonical subscription tier for product gates (free | premium | vip). Code defaults + DB overrides merge in app.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_tier text NOT NULL DEFAULT 'free';

UPDATE public.profiles
SET subscription_tier = CASE
  WHEN subscription_tier IS NOT NULL AND subscription_tier <> 'free' THEN subscription_tier
  WHEN is_premium = true THEN 'premium'
  ELSE 'free'
END;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_subscription_tier_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_subscription_tier_check
  CHECK (subscription_tier IN ('free', 'premium', 'vip'));

CREATE OR REPLACE FUNCTION public.get_user_tier(p_user_id uuid)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    (SELECT p.subscription_tier FROM public.profiles p WHERE p.id = p_user_id),
    'free'
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_user_tier(uuid) TO authenticated;

-- Block self-service edits to subscription_tier (admins + service_role exempt inside trigger)
CREATE OR REPLACE FUNCTION public.protect_sensitive_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF NEW.is_premium IS DISTINCT FROM OLD.is_premium THEN
    RAISE EXCEPTION 'Cannot modify is_premium';
  END IF;
  IF NEW.premium_until IS DISTINCT FROM OLD.premium_until THEN
    RAISE EXCEPTION 'Cannot modify premium_until';
  END IF;
  IF NEW.premium_granted_at IS DISTINCT FROM OLD.premium_granted_at THEN
    RAISE EXCEPTION 'Cannot modify premium_granted_at';
  END IF;
  IF NEW.premium_granted_by IS DISTINCT FROM OLD.premium_granted_by THEN
    RAISE EXCEPTION 'Cannot modify premium_granted_by';
  END IF;
  IF NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier THEN
    RAISE EXCEPTION 'Cannot modify subscription_tier';
  END IF;
  IF NEW.is_suspended IS DISTINCT FROM OLD.is_suspended THEN
    RAISE EXCEPTION 'Cannot modify is_suspended';
  END IF;
  IF NEW.suspension_reason IS DISTINCT FROM OLD.suspension_reason THEN
    RAISE EXCEPTION 'Cannot modify suspension_reason';
  END IF;
  IF NEW.phone_verified IS DISTINCT FROM OLD.phone_verified THEN
    RAISE EXCEPTION 'Cannot modify phone_verified';
  END IF;
  IF NEW.phone_verified_at IS DISTINCT FROM OLD.phone_verified_at THEN
    RAISE EXCEPTION 'Cannot modify phone_verified_at';
  END IF;
  IF NEW.email_verified IS DISTINCT FROM OLD.email_verified THEN
    RAISE EXCEPTION 'Cannot modify email_verified';
  END IF;
  IF NEW.photo_verified IS DISTINCT FROM OLD.photo_verified THEN
    RAISE EXCEPTION 'Cannot modify photo_verified';
  END IF;
  IF NEW.photo_verified_at IS DISTINCT FROM OLD.photo_verified_at THEN
    RAISE EXCEPTION 'Cannot modify photo_verified_at';
  END IF;

  RETURN NEW;
END;
$$;
