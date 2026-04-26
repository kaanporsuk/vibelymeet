-- Distance visibility legacy cleanup.
--
-- Stage 2 made distance_visibility canonical and revoked raw coordinate access.
-- This follow-up removes the compatibility-only profiles.show_distance column
-- and its sync behavior while preserving the shared legacy sync trigger for
-- discoverable/discovery_mode and show_online_status/activity_status_visibility.

CREATE OR REPLACE FUNCTION public.get_profile_distance_label_for_viewer(
  p_target_id uuid
) RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_viewer_id uuid := auth.uid();
  v_is_admin boolean;
  v_allowed boolean;
  v_viewer_location jsonb;
  v_target RECORD;
  v_viewer_lat double precision;
  v_viewer_lng double precision;
  v_target_lat double precision;
  v_target_lng double precision;
  v_distance_km double precision;
BEGIN
  IF v_viewer_id IS NULL OR p_target_id IS NULL OR p_target_id = v_viewer_id THEN
    RETURN NULL;
  END IF;

  v_is_admin := public.has_role(v_viewer_id, 'admin'::public.app_role);

  IF NOT v_is_admin AND public.profiles_have_safety_block(p_target_id, v_viewer_id) THEN
    RETURN NULL;
  END IF;

  v_allowed :=
    v_is_admin
    OR public.profile_has_established_access(p_target_id, v_viewer_id)
    OR public.viewer_shares_event_with_profile(p_target_id);

  IF NOT v_allowed THEN
    RETURN NULL;
  END IF;

  SELECT
    p.location_data,
    COALESCE(p.distance_visibility, 'approximate') AS distance_visibility
  INTO v_target
  FROM public.profiles p
  WHERE p.id = p_target_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_target.distance_visibility = 'hidden' THEN
    RETURN NULL;
  END IF;

  SELECT p.location_data
  INTO v_viewer_location
  FROM public.profiles p
  WHERE p.id = v_viewer_id;

  v_viewer_lat := public.profile_location_coord(v_viewer_location, 'lat');
  v_viewer_lng := public.profile_location_coord(v_viewer_location, 'lng');
  v_target_lat := public.profile_location_coord(v_target.location_data, 'lat');
  v_target_lng := public.profile_location_coord(v_target.location_data, 'lng');

  IF v_viewer_lat IS NULL OR v_viewer_lng IS NULL OR v_target_lat IS NULL OR v_target_lng IS NULL THEN
    RETURN NULL;
  END IF;

  v_distance_km := public.haversine_distance(v_viewer_lat, v_viewer_lng, v_target_lat, v_target_lng);

  IF v_distance_km IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN CASE
    WHEN v_distance_km < 5 THEN '<5 km'
    WHEN v_distance_km < 10 THEN '5-10 km'
    WHEN v_distance_km < 25 THEN '10-25 km'
    WHEN v_distance_km < 50 THEN '25-50 km'
    ELSE '50+ km'
  END;
END;
$$;

COMMENT ON FUNCTION public.get_profile_distance_label_for_viewer(uuid) IS
  'Returns only a coarse backend-computed user-to-user distance bucket for auth.uid() -> target. Returns null for hidden distance, self, blocked pairs, inaccessible profiles, or missing/malformed coordinates.';

REVOKE ALL ON FUNCTION public.get_profile_distance_label_for_viewer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_profile_distance_label_for_viewer(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_profile_distance_label_for_viewer(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_legacy_to_privacy_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Legacy -> canonical
  IF OLD.discoverable IS DISTINCT FROM NEW.discoverable
     AND OLD.discovery_mode IS NOT DISTINCT FROM NEW.discovery_mode THEN
    IF NEW.discoverable = true THEN
      NEW.discovery_mode := 'visible';
      NEW.discovery_snooze_until := NULL;
    ELSE
      NEW.discovery_mode := 'hidden';
      NEW.discovery_snooze_until := NULL;
    END IF;
  END IF;

  IF OLD.show_online_status IS DISTINCT FROM NEW.show_online_status
     AND OLD.activity_status_visibility IS NOT DISTINCT FROM NEW.activity_status_visibility THEN
    NEW.activity_status_visibility := CASE WHEN NEW.show_online_status = true THEN 'matches' ELSE 'nobody' END;
  END IF;

  -- Canonical -> legacy
  IF OLD.discovery_mode IS DISTINCT FROM NEW.discovery_mode
     AND OLD.discoverable IS NOT DISTINCT FROM NEW.discoverable THEN
    NEW.discoverable := (NEW.discovery_mode = 'visible');
  END IF;

  IF OLD.activity_status_visibility IS DISTINCT FROM NEW.activity_status_visibility
     AND OLD.show_online_status IS NOT DISTINCT FROM NEW.show_online_status THEN
    NEW.show_online_status := (NEW.activity_status_visibility <> 'nobody');
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'show_distance'
  ) THEN
    EXECUTE 'REVOKE SELECT (show_distance) ON TABLE public.profiles FROM PUBLIC';
    EXECUTE 'REVOKE SELECT (show_distance) ON TABLE public.profiles FROM anon, authenticated';
  END IF;
END;
$$;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS show_distance;

NOTIFY pgrst, 'reload schema';
