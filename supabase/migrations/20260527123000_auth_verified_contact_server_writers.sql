-- Verified contact server writers.
--
-- Email and phone verification Edge Functions should not write verified
-- contact fields directly. These narrow RPCs set the transaction-local
-- verification flag before touching backend-owned profile trust columns.

CREATE OR REPLACE FUNCTION public.mark_profile_email_verified_from_server(
  p_user_id uuid,
  p_verified_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_request_role text := COALESCE(NULLIF(auth.role(), ''), current_setting('role', true));
  v_verified_email text := NULLIF(btrim(p_verified_email), '');
BEGIN
  IF v_request_role <> 'service_role' THEN
    RAISE EXCEPTION 'server verification context required'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_verified_email IS NULL THEN
    RAISE EXCEPTION 'verified email is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('vibely.verification_server_update', '1', true);

  BEGIN
    UPDATE public.profiles
    SET
      email_verified = true,
      verified_email = v_verified_email
    WHERE id = p_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'profile not found for verified email update'
        USING ERRCODE = 'P0002';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('vibely.verification_server_update', NULL, true);
    RAISE;
  END;

  PERFORM set_config('vibely.verification_server_update', NULL, true);
END;
$$;

COMMENT ON FUNCTION public.mark_profile_email_verified_from_server(uuid, text) IS
  'Service-role-only writer for verified profile email state. Sets transaction-local vibely.verification_server_update before updating backend-owned trust columns.';

CREATE OR REPLACE FUNCTION public.mark_profile_phone_verified_from_server(
  p_user_id uuid,
  p_phone_number text,
  p_verified_at timestamptz DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_request_role text := COALESCE(NULLIF(auth.role(), ''), current_setting('role', true));
  v_phone_number text := NULLIF(btrim(p_phone_number), '');
  v_verified_at timestamptz := COALESCE(p_verified_at, now());
BEGIN
  IF v_request_role <> 'service_role' THEN
    RAISE EXCEPTION 'server verification context required'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_phone_number IS NULL THEN
    RAISE EXCEPTION 'phone number is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('vibely.verification_server_update', '1', true);

  BEGIN
    UPDATE public.profiles
    SET
      phone_number = v_phone_number,
      phone_verified = true,
      phone_verified_at = v_verified_at
    WHERE id = p_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'profile not found for verified phone update'
        USING ERRCODE = 'P0002';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('vibely.verification_server_update', NULL, true);
    RAISE;
  END;

  PERFORM set_config('vibely.verification_server_update', NULL, true);
END;
$$;

COMMENT ON FUNCTION public.mark_profile_phone_verified_from_server(uuid, text, timestamptz) IS
  'Service-role-only writer for verified profile phone state. Sets transaction-local vibely.verification_server_update before updating backend-owned trust columns.';

REVOKE ALL ON FUNCTION public.mark_profile_email_verified_from_server(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_profile_phone_verified_from_server(uuid, text, timestamptz)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mark_profile_email_verified_from_server(uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_profile_phone_verified_from_server(uuid, text, timestamptz)
  TO service_role;

NOTIFY pgrst, 'reload schema';
