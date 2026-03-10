
-- Fix 1: Protect sensitive profile columns from user self-modification
-- Create a trigger that prevents non-service-role users from modifying admin-managed columns
CREATE OR REPLACE FUNCTION public.protect_sensitive_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Allow service role (used by edge functions/admin) to modify anything
  -- current_setting('role') will be 'authenticated' for normal users
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Allow admins
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;

  -- Block changes to sensitive columns for regular users
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

CREATE TRIGGER protect_profile_sensitive_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_sensitive_profile_columns();

-- Fix 2: Remove user INSERT/UPDATE policies on user_credits
-- Users should only read their credits; modifications happen via deduct_credit RPC or service role
DROP POLICY IF EXISTS "Users can create own credits" ON public.user_credits;
DROP POLICY IF EXISTS "Users can update own credits" ON public.user_credits;

-- Fix 3: Remove user INSERT policy on matches
-- Matches are created exclusively via SECURITY DEFINER functions (check_mutual_vibe_and_match, handle_swipe)
DROP POLICY IF EXISTS "Users can create matches" ON public.matches;
DROP POLICY IF EXISTS "Users can insert own matches" ON public.matches;

-- Fix 4: Revoke SELECT on PII columns from authenticated role
-- Edge functions using service_role key are unaffected
REVOKE SELECT (phone_number, verified_email) ON public.profiles FROM authenticated;
REVOKE SELECT (phone_number, verified_email) ON public.profiles FROM anon;
