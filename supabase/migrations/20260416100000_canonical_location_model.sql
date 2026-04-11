-- Canonical location model: server-side enforcement + atomic update RPC.
--
-- Product rules being enforced:
-- 1. Users without valid coordinates (no location_data lat/lng) CANNOT see local events.
--    Previously `v_effective_lat IS NULL` allowed all local events through — removed.
-- 2. `update_profile_location` RPC is the single validated channel for post-onboarding
--    location updates (all three fields written atomically: location, location_data, country).
--    Clients MUST NOT write location/locationData/country separately or as free text.


-- ─── 1. get_visible_events: remove local-scope bypass for no-coords users ───────
--
-- Change: `OR v_effective_lat IS NULL` is removed from the local scope predicate.
-- Effect: users with no effective coordinates (no device coords and no stored location_data)
-- will no longer match any `scope = 'local'` event.
-- Global and regional events are unaffected.

DROP FUNCTION IF EXISTS public.get_visible_events(uuid, double precision, double precision, boolean, double precision, double precision, double precision);

CREATE OR REPLACE FUNCTION public.get_visible_events(
  p_user_id         uuid,
  p_user_lat        double precision DEFAULT NULL,
  p_user_lng        double precision DEFAULT NULL,
  p_is_premium      boolean          DEFAULT false,
  p_browse_lat      double precision DEFAULT NULL,
  p_browse_lng      double precision DEFAULT NULL,
  p_filter_radius_km double precision DEFAULT NULL
)
RETURNS TABLE(
  id                  uuid,
  title               text,
  description         text,
  cover_image         text,
  event_date          timestamptz,
  duration_minutes    integer,
  max_attendees       integer,
  current_attendees   integer,
  tags                text[],
  status              text,
  city                text,
  country             text,
  scope               text,
  latitude            double precision,
  longitude           double precision,
  radius_km           integer,
  distance_km         double precision,
  is_registered       boolean,
  computed_status     text,
  is_recurring        boolean,
  parent_event_id     uuid,
  occurrence_number   integer,
  language            text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sub_active        boolean;
  v_is_admin          boolean;
  v_profile_premium   boolean;
  v_can_premium_browse boolean;
  v_browse_lat_eff    double precision;
  v_browse_lng_eff    double precision;
  v_effective_lat     double precision;
  v_effective_lng     double precision;
BEGIN
  -- Server-side premium: active/trialing subscription.
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = p_user_id
      AND s.status IN ('active', 'trialing')
  ) INTO v_sub_active;

  -- Admin override.
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_user_id AND ur.role = 'admin'::public.app_role
  ) INTO v_is_admin;

  -- Profile-level premium grant (is_premium flag / premium_until date).
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id
      AND (
        p.is_premium = true
        OR (p.premium_until IS NOT NULL AND p.premium_until > now())
      )
  ) INTO v_profile_premium;

  -- p_is_premium from clients is intentionally ignored to prevent spoofing.
  v_can_premium_browse :=
    COALESCE(v_sub_active, false)
    OR COALESCE(v_is_admin, false)
    OR COALESCE(v_profile_premium, false);

  -- Premium city-browse coordinates (only honoured for premium users).
  v_browse_lat_eff := CASE
    WHEN v_can_premium_browse
         AND p_browse_lat IS NOT NULL
         AND p_browse_lng IS NOT NULL
    THEN p_browse_lat
    ELSE NULL
  END;
  v_browse_lng_eff := CASE
    WHEN v_can_premium_browse
         AND p_browse_lat IS NOT NULL
         AND p_browse_lng IS NOT NULL
    THEN p_browse_lng
    ELSE NULL
  END;

  -- Effective reference point: premium browse coord > device/profile coord.
  v_effective_lat := COALESCE(v_browse_lat_eff, p_user_lat);
  v_effective_lng := COALESCE(v_browse_lng_eff, p_user_lng);

  RETURN QUERY
  SELECT
    e.id, e.title, e.description, e.cover_image, e.event_date,
    e.duration_minutes, e.max_attendees, e.current_attendees, e.tags,
    e.status, e.city, e.country, e.scope, e.latitude, e.longitude,
    e.radius_km,
    CASE
      WHEN e.latitude IS NOT NULL AND v_effective_lat IS NOT NULL
      THEN haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
      ELSE NULL
    END AS distance_km,
    EXISTS (
      SELECT 1 FROM event_registrations er
      WHERE er.event_id = e.id AND er.profile_id = p_user_id
    ) AS is_registered,
    CASE
      WHEN e.status = 'cancelled' THEN 'cancelled'
      WHEN e.status = 'ended' OR e.ended_at IS NOT NULL THEN 'ended'
      WHEN now() >= e.event_date
           AND now() < (e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute')
        THEN 'live'
      WHEN now() >= (e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute')
        THEN 'ended'
      ELSE 'upcoming'
    END AS computed_status,
    e.is_recurring, e.parent_event_id, e.occurrence_number,
    e.language
  FROM events e
  WHERE e.archived_at IS NULL
    AND e.status != 'draft'
    AND COALESCE(e.is_recurring, false) = false
    -- ── Scope visibility ──────────────────────────────────────────────────────
    AND (
      -- Global events: always visible.
      e.scope = 'global'
      OR e.scope IS NULL

      -- Regional events: visible when country matches or user is premium.
      OR (e.scope = 'regional' AND (
        e.country IS NULL
        OR e.country = (SELECT p.country FROM profiles p WHERE p.id = p_user_id)
        OR v_can_premium_browse
      ))

      -- Local events: REQUIRE the user to have a valid reference point.
      -- Removed `OR v_effective_lat IS NULL` — users without coordinates
      -- must not see location-specific events.
      OR (
        e.scope = 'local'
        AND e.latitude IS NOT NULL
        AND e.longitude IS NOT NULL
        AND v_effective_lat IS NOT NULL
        AND v_effective_lng IS NOT NULL
        AND haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
              <= COALESCE(e.radius_km, 50)::double precision
      )
    )
    -- ── User radius filter (optional, applied on top of scope) ───────────────
    AND (
      p_filter_radius_km IS NULL
      OR v_effective_lat IS NULL
      -- Global and regional events bypass the radius filter.
      OR COALESCE(e.scope, 'global') IN ('global', 'regional')
      -- Local events must be within the user-chosen radius.
      OR (
        e.latitude IS NOT NULL
        AND e.longitude IS NOT NULL
        AND haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
              <= p_filter_radius_km
      )
    )
  ORDER BY
    CASE
      WHEN now() >= e.event_date
           AND now() < (e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute')
        THEN 0
      WHEN now() < e.event_date THEN 1
      ELSE 2
    END,
    e.event_date ASC;
END;
$function$;

COMMENT ON FUNCTION public.get_visible_events IS
  'Returns events visible to p_user_id based on scope + location. '
  'Global/regional events always visible. Local events REQUIRE valid coordinates (device or stored profile). '
  'Users with no effective lat/lng receive only global/regional events — never local ones. '
  'Premium browse coords honoured for city-browse (server-verified, client p_is_premium ignored).';


-- ─── 2. update_profile_location: atomic validated location update RPC ───────────
--
-- All post-onboarding profile location changes MUST flow through this RPC.
-- It ensures location, location_data, and country are always written together and validated.
-- Prevents free-text location strings from landing in the DB without corresponding coordinates.

CREATE OR REPLACE FUNCTION public.update_profile_location(
  p_user_id   uuid,
  p_location  text,             -- normalized display label, e.g. "Adana, Türkiye"
  p_lat       double precision, -- device/geocoded latitude  (-90 .. 90)
  p_lng       double precision, -- device/geocoded longitude (-180 .. 180)
  p_country   text              -- country name from geocode, e.g. "Türkiye"
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Auth guard.
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  -- Validate all three location fields are present and non-empty.
  IF p_location IS NULL OR trim(p_location) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'location_label_required');
  END IF;

  IF p_country IS NULL OR trim(p_country) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'country_required');
  END IF;

  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'coordinates_required');
  END IF;

  -- Validate coordinate ranges.
  IF p_lat NOT BETWEEN -90 AND 90 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_latitude');
  END IF;

  IF p_lng NOT BETWEEN -180 AND 180 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_longitude');
  END IF;

  -- Atomic write of all three location fields.
  UPDATE public.profiles
  SET
    location      = trim(p_location),
    location_data = jsonb_build_object('lat', p_lat, 'lng', p_lng),
    country       = trim(p_country),
    updated_at    = now()
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.update_profile_location IS
  'Canonical post-onboarding location update. Atomically writes location (display label), '
  'location_data ({lat,lng}), and country. Validates all three fields and coordinate ranges. '
  'All clients (web + native) MUST use this RPC for location refreshes — never direct table writes.';
