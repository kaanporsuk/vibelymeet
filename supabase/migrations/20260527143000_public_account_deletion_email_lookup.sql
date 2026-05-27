-- Public account-deletion requests are intentionally enumeration-safe at the
-- Edge boundary, but the Edge Function still needs a supported service-role
-- path to resolve an email to an auth user id before creating the durable
-- account_deletion_requests row.

CREATE OR REPLACE FUNCTION public.resolve_account_deletion_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, auth, public
AS $$
DECLARE
  v_request_role text := COALESCE(NULLIF(auth.role(), ''), current_setting('role', true));
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_user_id uuid;
BEGIN
  IF v_request_role <> 'service_role' THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF v_email = '' OR position('@' in v_email) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT u.id
  INTO v_user_id
  FROM auth.users u
  WHERE lower(u.email) = v_email
  ORDER BY u.created_at ASC
  LIMIT 1;

  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_account_deletion_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_account_deletion_user_id_by_email(text) TO service_role;

COMMENT ON FUNCTION public.resolve_account_deletion_user_id_by_email(text)
  IS 'Service-role-only auth.users email lookup used by the public account deletion request Edge Function.';

NOTIFY pgrst, 'reload schema';
