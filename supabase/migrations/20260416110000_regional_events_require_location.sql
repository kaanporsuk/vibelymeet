-- Tighten regional event visibility: require valid location (coordinates) — not just a country match.
--
-- Locked product rule:
--   "If the user does not grant location permission, or the app does not have valid usable location
--    data, the user may participate in and see ONLY global events."
--
-- The prior migration (20260416100000) correctly blocked local events when v_effective_lat IS NULL,
-- but regional events were still returned for any user whose profiles.country matched the event —
-- even legacy users with stale free-text location and no valid location_data.
--
-- This migration makes regional events behave identically to local events in terms of the
-- "must have coordinates" prerequisite, while still using country-match (not radius) for the
-- actual regional eligibility check.
--
-- Result after this migration:
--   scope = 'global' (or NULL)  → always visible
--   scope = 'regional'          → REQUIRES v_effective_lat/lng IS NOT NULL + country match (or premium)
--   scope = 'local'             → REQUIRES v_effective_lat/lng IS NOT NULL + within radius
--   (no location at all)        → global events ONLY — zero regional, zero local

DROP FUNCTION IF EXISTS public.get_visible_events(uuid, double precision, double precision, boolean, double precision, double precision, double precision);

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
SET search_path TO 'public'
AS $function$
DECLARE
  v_sub_active         boolean;
  v_is_admin           boolean;
  v_profile_premium    boolean;
  v_can_premium_browse boolean;
  v_browse_lat_eff     double precision;
  v_browse_lng_eff     double precision;
  v_effective_lat      double precision;
  v_effective_lng      double precision;
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
    -- RULE: No valid location (v_effective_lat IS NULL) → global events ONLY.
    AND (
      -- Global events: always visible to everyone.
      e.scope = 'global'
      OR e.scope IS NULL

      -- Regional events: REQUIRE valid location + country match (or premium browse).
      -- A matching profiles.country alone (without coordinates) is NOT sufficient.
      OR (
        e.scope = 'regional'
        AND v_effective_lat IS NOT NULL
        AND v_effective_lng IS NOT NULL
        AND (
          e.country IS NULL
          OR e.country = (SELECT p.country FROM profiles p WHERE p.id = p_user_id)
          OR v_can_premium_browse
        )
      )

      -- Local events: REQUIRE valid location + within event radius.
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
    -- When the user has chosen a distance filter, apply it to local events.
    -- Global events always pass. Regional events use country-match not radius.
    AND (
      p_filter_radius_km IS NULL
      OR v_effective_lat IS NULL
      OR COALESCE(e.scope, 'global') IN ('global', 'regional')
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
  'Returns events visible to p_user_id. '
  'Visibility rules: '
  '  global/NULL scope → always visible. '
  '  regional scope    → requires valid coordinates (v_effective_lat IS NOT NULL) + country match or premium. '
  '  local scope       → requires valid coordinates + within event radius_km. '
  'Users with no effective lat/lng (no device coords, no stored location_data) receive ONLY global events. '
  'Zero regional, zero local events without valid location. '
  'Premium browse coords honoured for city-browse (server-verified; client p_is_premium ignored). '
  'Legacy users with stale text-only location but no location_data: treated as no-location — global only.';
