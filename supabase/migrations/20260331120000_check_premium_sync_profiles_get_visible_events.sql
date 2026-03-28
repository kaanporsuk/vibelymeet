-- check_premium_status: two EXISTS branches ORed (no COALESCE-wrapped scalar subquery).
-- sync_profiles_is_premium: keep is_premium true when premium_until is still in the future.
-- get_visible_events: v_profile_premium — treat profile grants + future premium_until like premium browse.

CREATE OR REPLACE FUNCTION public.check_premium_status(p_user_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_catalog
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.user_id = p_user_id
        AND s.status IN ('active', 'trialing')
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = p_user_id
        AND (
          p.is_premium = true
          OR (p.premium_until IS NOT NULL AND p.premium_until > now())
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.sync_profiles_is_premium_from_subscriptions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_has_active_sub boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_user_id := OLD.user_id;
  ELSE
    v_user_id := NEW.user_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = v_user_id
      AND status IN ('active', 'trialing')
  ) INTO v_has_active_sub;

  UPDATE public.profiles p
  SET is_premium = v_has_active_sub
    OR (p.premium_until IS NOT NULL AND p.premium_until > now())
  WHERE p.id = v_user_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.get_visible_events(uuid, double precision, double precision, boolean, double precision, double precision, double precision);

CREATE OR REPLACE FUNCTION public.get_visible_events(
  p_user_id uuid,
  p_user_lat double precision DEFAULT NULL,
  p_user_lng double precision DEFAULT NULL,
  p_is_premium boolean DEFAULT false,
  p_browse_lat double precision DEFAULT NULL,
  p_browse_lng double precision DEFAULT NULL,
  p_filter_radius_km double precision DEFAULT NULL
)
RETURNS TABLE(
  id uuid, title text, description text, cover_image text,
  event_date timestamptz, duration_minutes integer, max_attendees integer,
  current_attendees integer, tags text[], status text, city text, country text,
  scope text, latitude double precision, longitude double precision,
  radius_km integer, distance_km double precision, is_registered boolean,
  computed_status text, is_recurring boolean, parent_event_id uuid,
  occurrence_number integer, language text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sub_active boolean;
  v_is_admin boolean;
  v_profile_premium boolean;
  v_can_premium_browse boolean;
  v_browse_lat_eff double precision;
  v_browse_lng_eff double precision;
  v_effective_lat double precision;
  v_effective_lng double precision;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = p_user_id
      AND s.status IN ('active', 'trialing')
  ) INTO v_sub_active;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_user_id AND ur.role = 'admin'::public.app_role
  ) INTO v_is_admin;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id
      AND (
        p.is_premium = true
        OR (p.premium_until IS NOT NULL AND p.premium_until > now())
      )
  ) INTO v_profile_premium;

  v_can_premium_browse := COALESCE(v_sub_active, false)
    OR COALESCE(v_is_admin, false)
    OR COALESCE(v_profile_premium, false);

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
    AND (
      e.scope = 'global'
      OR e.scope IS NULL
      OR (e.scope = 'regional' AND (
        e.country IS NULL
        OR e.country = (SELECT p.country FROM profiles p WHERE p.id = p_user_id)
        OR v_can_premium_browse
      ))
      OR (e.scope = 'local' AND e.latitude IS NOT NULL AND e.longitude IS NOT NULL AND (
        v_effective_lat IS NULL
        OR haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
          <= COALESCE(e.radius_km, 50)::double precision
      ))
    )
    AND (
      p_filter_radius_km IS NULL
      OR v_effective_lat IS NULL
      OR COALESCE(e.scope, 'global') IN ('global', 'regional')
      OR (e.latitude IS NOT NULL AND e.longitude IS NOT NULL
          AND haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
            <= p_filter_radius_km)
    )
  ORDER BY
    CASE
      WHEN now() >= e.event_date AND now() < (e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute') THEN 0
      WHEN now() < e.event_date THEN 1
      ELSE 2
    END,
    e.event_date ASC;
END;
$function$;
