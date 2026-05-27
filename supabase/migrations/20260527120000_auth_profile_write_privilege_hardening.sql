-- Auth profile write privilege hardening.
--
-- Normal clients may update only owner-editable profile columns. Trust fields
-- that derive from Auth, provider verification, moderation, billing, media
-- backends, or server-side onboarding remain backend-owned.

DO $$
DECLARE
  v_column text;
  v_safe_update_columns text[] := ARRAY[
    'name',
    'birth_date',
    'age',
    'gender',
    'interested_in',
    'tagline',
    'height_cm',
    'job',
    'company',
    'about_me',
    'bio',
    'looking_for',
    'relationship_intent',
    'lifestyle',
    'prompts',
    'photos',
    'avatar_url',
    'vibe_caption',
    'preferred_age_min',
    'preferred_age_max',
    'event_discovery_prefs',
    'account_paused',
    'account_paused_until',
    'is_paused',
    'paused_until',
    'paused_at',
    'pause_reason',
    'discoverable',
    'discovery_mode',
    'discovery_snooze_until',
    'discovery_audience',
    'activity_status_visibility',
    'distance_visibility',
    'event_attendance_visibility',
    'show_online_status',
    'email_unsubscribed',
    'community_agreed_at'
  ];
  v_grant_columns text;
BEGIN
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE public.profiles
    FROM PUBLIC, anon, authenticated;

  -- Table-level revokes do not clear legacy column-level grants.
  FOR v_column IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
  LOOP
    EXECUTE format(
      'REVOKE INSERT (%I) ON TABLE public.profiles FROM PUBLIC, anon, authenticated',
      v_column
    );
    EXECUTE format(
      'REVOKE UPDATE (%I) ON TABLE public.profiles FROM PUBLIC, anon, authenticated',
      v_column
    );
  END LOOP;

  SELECT string_agg(format('%I', safe.column_name), ', ' ORDER BY safe.ordinality)
  INTO v_grant_columns
  FROM unnest(v_safe_update_columns) WITH ORDINALITY AS safe(column_name, ordinality)
  JOIN information_schema.columns c
    ON c.table_schema = 'public'
    AND c.table_name = 'profiles'
    AND c.column_name = safe.column_name;

  IF v_grant_columns IS NOT NULL THEN
    EXECUTE format(
      'GRANT UPDATE (%s) ON TABLE public.profiles TO authenticated',
      v_grant_columns
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_sensitive_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_verification_writer boolean :=
    current_setting('vibely.verification_server_update', true) = '1';
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT v_verification_writer THEN
      RAISE EXCEPTION 'Cannot insert profiles directly';
    END IF;

    NEW.onboarding_complete := false;
    NEW.onboarding_stage := 'none';
    RETURN NEW;
  END IF;

  -- TG_OP = 'UPDATE'
  IF NEW.onboarding_complete IS DISTINCT FROM OLD.onboarding_complete
     OR NEW.onboarding_stage IS DISTINCT FROM OLD.onboarding_stage THEN
    IF current_setting('vibely.onboarding_server_update', true) = '1' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Cannot modify onboarding_complete or onboarding_stage';
    END IF;
  END IF;

  IF NEW.phone_number IS DISTINCT FROM OLD.phone_number THEN
    IF v_verification_writer THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Cannot modify phone_number';
    END IF;
  END IF;
  IF NEW.verified_email IS DISTINCT FROM OLD.verified_email THEN
    IF v_verification_writer THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Cannot modify verified_email';
    END IF;
  END IF;
  IF NEW.phone_verified IS DISTINCT FROM OLD.phone_verified THEN
    IF v_verification_writer THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Cannot modify phone_verified';
    END IF;
  END IF;
  IF NEW.phone_verified_at IS DISTINCT FROM OLD.phone_verified_at THEN
    IF v_verification_writer THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Cannot modify phone_verified_at';
    END IF;
  END IF;
  IF NEW.email_verified IS DISTINCT FROM OLD.email_verified THEN
    IF v_verification_writer THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Cannot modify email_verified';
    END IF;
  END IF;
  IF NEW.photo_verified IS DISTINCT FROM OLD.photo_verified THEN
    IF v_verification_writer THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Cannot modify photo_verified';
    END IF;
  END IF;
  IF NEW.photo_verified_at IS DISTINCT FROM OLD.photo_verified_at THEN
    IF v_verification_writer THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Cannot modify photo_verified_at';
    END IF;
  END IF;
  IF NEW.photo_verification_expires_at IS DISTINCT FROM OLD.photo_verification_expires_at THEN
    IF v_verification_writer THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Cannot modify photo_verification_expires_at';
    END IF;
  END IF;
  IF NEW.proof_selfie_url IS DISTINCT FROM OLD.proof_selfie_url THEN
    IF v_verification_writer THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Cannot modify proof_selfie_url';
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

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.protect_sensitive_profile_columns IS
  'Blocks self-service edits to premium, verification destination/status, subscription, suspension, and onboarding columns. Onboarding columns may change from trusted onboarding RPCs; verification destination/status columns may change from trusted backend verification writers (transaction-local vibely.verification_server_update) or service_role.';

DROP TRIGGER IF EXISTS protect_profile_sensitive_columns ON public.profiles;
DROP TRIGGER IF EXISTS protect_sensitive_profile_columns_trigger ON public.profiles;
CREATE TRIGGER protect_profile_sensitive_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_sensitive_profile_columns();

CREATE OR REPLACE FUNCTION public.bootstrap_profile_from_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_name text;
  v_phone text;
BEGIN
  v_name := trim(COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name', ''));
  v_phone := NULLIF(trim(COALESCE(NEW.phone, '')), '');

  PERFORM set_config('vibely.verification_server_update', '1', true);

  BEGIN
    INSERT INTO public.profiles (
      id,
      name,
      age,
      gender,
      birth_date,
      phone_number,
      phone_verified,
      phone_verified_at
    )
    VALUES (
      NEW.id,
      v_name,
      18,
      'prefer_not_to_say',
      NULL,
      v_phone,
      v_phone IS NOT NULL,
      CASE WHEN v_phone IS NOT NULL THEN now() ELSE NULL END
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('vibely.verification_server_update', NULL, true);
    RAISE;
  END;

  PERFORM set_config('vibely.verification_server_update', NULL, true);
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.bootstrap_profile_from_auth_user IS
  'Creates the canonical profiles row for each new auth.users record. Backend-owned auth bootstrap; idempotent on duplicate delivery. Sets the transaction-local verification writer flag so profile insert protection stays least-privilege.';

REVOKE ALL ON FUNCTION public.bootstrap_profile_from_auth_user()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.resolve_entry_state()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_entry_state()
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
