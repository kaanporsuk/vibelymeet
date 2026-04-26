-- Self-service saved location clearing.
--
-- Location writes are centralized through update_profile_location(). This RPC is
-- the matching user-controlled clear path, so clients do not directly write
-- profiles.location / profiles.location_data / profiles.country.

CREATE OR REPLACE FUNCTION public.clear_my_location_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  UPDATE public.profiles
  SET
    location = NULL,
    location_data = NULL,
    country = NULL,
    updated_at = now()
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.clear_my_location_data IS
  'Authenticated self-only RPC for clearing saved profile location fields. '
  'Clients must use this instead of direct profiles.location_data writes.';

REVOKE ALL ON FUNCTION public.clear_my_location_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_my_location_data() TO authenticated;

NOTIFY pgrst, 'reload schema';
