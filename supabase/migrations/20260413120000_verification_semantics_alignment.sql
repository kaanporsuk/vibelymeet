-- Verification semantics cleanup:
-- 1) email verification now means the CURRENT auth email on the account was
--    confirmed through Vibely's in-app email verification flow
-- 2) stale email verification state is cleared when auth.users.email changes
-- 3) trusted backend verification writers can update protected verification flags

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
    ELSIF current_setting('vibely.onboarding_server_update', true) = '1' THEN
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
    IF current_setting('vibely.verification_server_update', true) = '1' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Cannot modify phone_verified';
    END IF;
  END IF;
  IF NEW.phone_verified_at IS DISTINCT FROM OLD.phone_verified_at THEN
    IF current_setting('vibely.verification_server_update', true) = '1' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Cannot modify phone_verified_at';
    END IF;
  END IF;
  IF NEW.email_verified IS DISTINCT FROM OLD.email_verified THEN
    IF current_setting('vibely.verification_server_update', true) = '1' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Cannot modify email_verified';
    END IF;
  END IF;
  IF NEW.photo_verified IS DISTINCT FROM OLD.photo_verified THEN
    IF current_setting('vibely.verification_server_update', true) = '1' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Cannot modify photo_verified';
    END IF;
  END IF;
  IF NEW.photo_verified_at IS DISTINCT FROM OLD.photo_verified_at THEN
    IF current_setting('vibely.verification_server_update', true) = '1' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Cannot modify photo_verified_at';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.protect_sensitive_profile_columns IS 'Blocks self-service edits to premium, verification, subscription, suspension, and onboarding columns. Onboarding columns may change from trusted finalize_onboarding / complete_onboarding / update_onboarding_stage RPCs (transaction-local vibely.onboarding_server_update). Verification columns may change from trusted backend verification writers (transaction-local vibely.verification_server_update) or service_role.';


CREATE OR REPLACE FUNCTION public.sync_profile_email_verification_from_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_auth_email text;
BEGIN
  v_auth_email := NULLIF(lower(trim(COALESCE(NEW.email, ''))), '');

  PERFORM set_config('vibely.verification_server_update', '1', true);

  BEGIN
    UPDATE public.profiles p
        SET email_verified = CASE
          WHEN p.email_verified = true
            AND v_auth_email IS NOT NULL
            AND NEW.email_confirmed_at IS NOT NULL
            AND NULLIF(lower(trim(COALESCE(p.verified_email, ''))), '') = v_auth_email
          THEN true
          ELSE false
        END,
        verified_email = CASE
          WHEN p.email_verified = true
            AND v_auth_email IS NOT NULL
            AND NEW.email_confirmed_at IS NOT NULL
            AND NULLIF(lower(trim(COALESCE(p.verified_email, ''))), '') = v_auth_email
          THEN NEW.email
          ELSE NULL
        END,
        updated_at = now()
    WHERE p.id = NEW.id;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('vibely.verification_server_update', NULL, true);
    RAISE;
  END;

  PERFORM set_config('vibely.verification_server_update', NULL, true);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_profile_email_verification_from_auth_user IS
  'Keeps profiles.email_verified / verified_email aligned to the current auth.users.email. If the account email changes, stale in-app email verification is cleared.';

DROP TRIGGER IF EXISTS on_auth_user_email_changed_sync_profile_verification ON auth.users;
CREATE TRIGGER on_auth_user_email_changed_sync_profile_verification
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.sync_profile_email_verification_from_auth_user();

DO $$
BEGIN
  PERFORM set_config('vibely.verification_server_update', '1', true);

  BEGIN
    WITH canonical AS (
      SELECT
        p.id,
        CASE
          WHEN p.email_verified = true
            AND NULLIF(lower(trim(COALESCE(au.email, ''))), '') IS NOT NULL
            AND au.email_confirmed_at IS NOT NULL
            AND NULLIF(lower(trim(COALESCE(p.verified_email, ''))), '') = NULLIF(lower(trim(COALESCE(au.email, ''))), '')
          THEN true
          ELSE false
        END AS next_email_verified,
        CASE
          WHEN p.email_verified = true
            AND NULLIF(lower(trim(COALESCE(au.email, ''))), '') IS NOT NULL
            AND au.email_confirmed_at IS NOT NULL
            AND NULLIF(lower(trim(COALESCE(p.verified_email, ''))), '') = NULLIF(lower(trim(COALESCE(au.email, ''))), '')
          THEN au.email
          ELSE NULL
        END AS next_verified_email
      FROM public.profiles p
      INNER JOIN auth.users au ON au.id = p.id
    )
    UPDATE public.profiles p
    SET email_verified = c.next_email_verified,
        verified_email = c.next_verified_email,
        updated_at = now()
    FROM canonical c
    WHERE c.id = p.id
      AND (
        p.email_verified IS DISTINCT FROM c.next_email_verified
        OR p.verified_email IS DISTINCT FROM c.next_verified_email
      );
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('vibely.verification_server_update', NULL, true);
    RAISE;
  END;

  PERFORM set_config('vibely.verification_server_update', NULL, true);
END;
$$;
