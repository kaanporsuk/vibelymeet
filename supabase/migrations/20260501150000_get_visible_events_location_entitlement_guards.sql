-- get_visible_events location/entitlement hardening.
--
-- Forward-only replacement of the canonical event discovery RPC.
-- No data backfill; preserves the existing function signature and returned columns.

CREATE OR REPLACE FUNCTION public.get_visible_events(
  p_user_id          uuid,
  p_user_lat         double precision DEFAULT NULL,
  p_user_lng         double precision DEFAULT NULL,
  p_is_premium       boolean          DEFAULT false,
  p_browse_lat       double precision DEFAULT NULL,
  p_browse_lng       double precision DEFAULT NULL,
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
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_sub_active          boolean;
  v_is_admin            boolean;
  v_profile_premium     boolean;
  v_can_premium_browse  boolean;
  v_profile_country     text;
  v_profile_lat         double precision;
  v_profile_lng         double precision;
  v_user_lat_eff        double precision;
  v_user_lng_eff        double precision;
  v_browse_lat_eff      double precision;
  v_browse_lng_eff      double precision;
  v_effective_lat       double precision;
  v_effective_lng       double precision;
  v_browse_requested    boolean;
  v_valid_user_coords   boolean;
  v_valid_browse_coords boolean;
BEGIN
  -- Authenticated clients may only request their own discovery rows. Service-role
  -- backend jobs keep the previous ability to pass an explicit profile id.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT
    p.country,
    public.profile_location_coord(p.location_data, 'lat'),
    public.profile_location_coord(p.location_data, 'lng'),
    (
      p.is_premium = true
      OR (p.premium_until IS NOT NULL AND p.premium_until > now())
    )
  INTO
    v_profile_country,
    v_profile_lat,
    v_profile_lng,
    v_profile_premium
  FROM public.profiles p
  WHERE p.id = p_user_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = p_user_id
      AND s.status IN ('active', 'trialing')
  ) INTO v_sub_active;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.role = 'admin'::public.app_role
  ) INTO v_is_admin;

  -- p_is_premium is intentionally ignored. City browse is derived only from
  -- subscriptions, admin role, or profile-level premium grants in Postgres.
  v_can_premium_browse :=
    COALESCE(v_sub_active, false)
    OR COALESCE(v_is_admin, false)
    OR COALESCE(v_profile_premium, false);

  v_browse_requested := p_browse_lat IS NOT NULL OR p_browse_lng IS NOT NULL;

  v_valid_user_coords :=
    p_user_lat IS NOT NULL
    AND p_user_lng IS NOT NULL
    AND p_user_lat BETWEEN -90 AND 90
    AND p_user_lng BETWEEN -180 AND 180;

  v_valid_browse_coords :=
    p_browse_lat IS NOT NULL
    AND p_browse_lng IS NOT NULL
    AND p_browse_lat BETWEEN -90 AND 90
    AND p_browse_lng BETWEEN -180 AND 180;

  -- Nearby/user point. When a non-premium caller supplies browse coordinates,
  -- treat that as an attempted city-browse request and fall back to the stored
  -- profile point only; do not accept arbitrary client coordinates in the same
  -- request as a replacement remote city.
  IF NOT v_can_premium_browse AND v_browse_requested THEN
    v_user_lat_eff := v_profile_lat;
    v_user_lng_eff := v_profile_lng;
  ELSE
    v_user_lat_eff := COALESCE(
      CASE WHEN v_valid_user_coords THEN p_user_lat ELSE NULL END,
      v_profile_lat
    );
    v_user_lng_eff := COALESCE(
      CASE WHEN v_valid_user_coords THEN p_user_lng ELSE NULL END,
      v_profile_lng
    );
  END IF;

  v_browse_lat_eff := CASE
    WHEN v_can_premium_browse AND v_valid_browse_coords THEN p_browse_lat
    ELSE NULL
  END;
  v_browse_lng_eff := CASE
    WHEN v_can_premium_browse AND v_valid_browse_coords THEN p_browse_lng
    ELSE NULL
  END;

  v_effective_lat := COALESCE(v_browse_lat_eff, v_user_lat_eff);
  v_effective_lng := COALESCE(v_browse_lng_eff, v_user_lng_eff);

  RETURN QUERY
  SELECT
    e.id, e.title, e.description, e.cover_image, e.event_date,
    e.duration_minutes, e.max_attendees, e.current_attendees, e.tags,
    e.status, e.city, e.country, e.scope, e.latitude, e.longitude,
    e.radius_km,
    CASE
      WHEN e.latitude IS NOT NULL
           AND e.longitude IS NOT NULL
           AND v_effective_lat IS NOT NULL
           AND v_effective_lng IS NOT NULL
      THEN public.haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
      ELSE NULL
    END AS distance_km,
    EXISTS (
      SELECT 1
      FROM public.event_registrations er
      WHERE er.event_id = e.id
        AND er.profile_id = p_user_id
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
  FROM public.events e
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN e.scope = 'regional' THEN 'regional'
      WHEN e.scope = 'local' OR COALESCE(e.is_location_specific, false) THEN 'local'
      WHEN e.scope = 'global' THEN 'global'
      WHEN e.scope IS NULL AND (e.latitude IS NOT NULL OR e.longitude IS NOT NULL) THEN 'local'
      ELSE 'global'
    END AS discovery_scope
  ) ds
  WHERE e.archived_at IS NULL
    AND e.status != 'draft'
    AND e.status IS DISTINCT FROM 'cancelled'
    AND COALESCE(e.is_recurring, false) = false
    AND now() <= COALESCE(
      e.ended_at,
      e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute'
    ) + interval '6 hours'

    AND (
      ds.discovery_scope = 'global'

      OR (
        ds.discovery_scope = 'regional'
        AND v_effective_lat IS NOT NULL
        AND v_effective_lng IS NOT NULL
        AND (
          e.country IS NULL
          OR e.country = v_profile_country
          OR v_can_premium_browse
        )
      )

      OR (
        ds.discovery_scope = 'local'
        AND e.latitude IS NOT NULL
        AND e.longitude IS NOT NULL
        AND v_effective_lat IS NOT NULL
        AND v_effective_lng IS NOT NULL
        AND public.haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
              <= COALESCE(e.radius_km, 50)::double precision
      )
    )

    AND (
      p_filter_radius_km IS NULL
      OR v_effective_lat IS NULL
      OR ds.discovery_scope IN ('global', 'regional')
      OR (
        ds.discovery_scope = 'local'
        AND e.latitude IS NOT NULL
        AND e.longitude IS NOT NULL
        AND public.haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
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

COMMENT ON FUNCTION public.get_visible_events(uuid, double precision, double precision, boolean, double precision, double precision, double precision) IS
  'Returns discover/home-visible events for the authenticated p_user_id. '
  'Non-service callers must match auth.uid(); p_is_premium is ignored. '
  'Premium/city browse is server-derived from subscriptions, admin role, or profile premium grants. '
  'Rejected non-premium browse coordinates fall back to stored profile coordinates only. '
  'Local/location-specific rows require event latitude/longitude and an effective reference point; radius filters apply only to local rows. '
  'Global rows and regional rows intentionally bypass strict radius only through explicit scope semantics.';
