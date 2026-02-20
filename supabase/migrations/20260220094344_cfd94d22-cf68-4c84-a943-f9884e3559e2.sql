
-- Fix 2: Correct interval arithmetic in get_visible_events
-- Fix 4: Add country column to profiles for regional matching

-- Add country column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS country text DEFAULT NULL;

-- Update get_visible_events with correct interval syntax, country matching, and new return columns
CREATE OR REPLACE FUNCTION public.get_visible_events(
  p_user_id uuid,
  p_user_lat double precision DEFAULT NULL,
  p_user_lng double precision DEFAULT NULL,
  p_is_premium boolean DEFAULT false,
  p_browse_lat double precision DEFAULT NULL,
  p_browse_lng double precision DEFAULT NULL
) RETURNS TABLE (
  id uuid,
  title text,
  description text,
  cover_image text,
  event_date timestamptz,
  duration_minutes integer,
  max_attendees integer,
  current_attendees integer,
  tags text[],
  status text,
  city text,
  country text,
  scope text,
  latitude double precision,
  longitude double precision,
  radius_km integer,
  distance_km double precision,
  is_registered boolean,
  computed_status text,
  is_recurring boolean,
  parent_event_id uuid,
  occurrence_number integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_effective_lat double precision;
  v_effective_lng double precision;
BEGIN
  v_effective_lat := COALESCE(
    CASE WHEN p_is_premium THEN p_browse_lat ELSE NULL END,
    p_user_lat
  );
  v_effective_lng := COALESCE(
    CASE WHEN p_is_premium THEN p_browse_lng ELSE NULL END,
    p_user_lng
  );

  RETURN QUERY
  SELECT
    e.id,
    e.title,
    e.description,
    e.cover_image,
    e.event_date,
    e.duration_minutes,
    e.max_attendees,
    e.current_attendees,
    e.tags,
    e.status,
    e.city,
    e.country,
    e.scope,
    e.latitude,
    e.longitude,
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
    e.is_recurring,
    e.parent_event_id,
    e.occurrence_number
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
        OR p_is_premium
      ))
      OR (e.scope = 'local' AND (
        e.latitude IS NULL
        OR v_effective_lat IS NULL
        OR haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude) <= COALESCE(e.radius_km, 50)
        OR (p_is_premium AND p_browse_lat IS NOT NULL)
      ))
    )
  ORDER BY
    CASE
      WHEN now() >= e.event_date AND now() < (e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute') THEN 0
      WHEN now() < e.event_date THEN 1
      ELSE 2
    END,
    e.event_date ASC;
END;
$$;
