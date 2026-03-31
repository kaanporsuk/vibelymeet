-- Extend protect_sensitive_profile_columns (single trigger) to:
-- 1) Force onboarding_complete / onboarding_stage on client INSERTs
-- 2) Block direct client UPDATEs to onboarding columns (allowed when current_user is postgres/supabase_admin, e.g. SET LOCAL ROLE inside RPCs)

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

  IF TG_OP = 'INSERT' THEN
    NEW.onboarding_complete := false;
    NEW.onboarding_stage := 'none';
    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE'
  IF NEW.onboarding_complete IS DISTINCT FROM OLD.onboarding_complete
     OR NEW.onboarding_stage IS DISTINCT FROM OLD.onboarding_stage THEN
    IF current_user::regrole::text IN ('postgres', 'supabase_admin') THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Cannot modify onboarding_complete or onboarding_stage';
    END IF;
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

DROP TRIGGER IF EXISTS protect_profile_sensitive_columns ON public.profiles;
CREATE TRIGGER protect_profile_sensitive_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_sensitive_profile_columns();

COMMENT ON FUNCTION public.protect_sensitive_profile_columns IS 'Blocks self-service edits to premium, verification, subscription, suspension, and onboarding columns. Onboarding columns may change when current_user is postgres/supabase_admin (e.g. complete_onboarding / update_onboarding_stage RPCs).';
