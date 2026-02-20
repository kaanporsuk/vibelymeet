
-- ============================================
-- 1. ADD GEO-TARGETING COLUMNS TO EVENTS
-- ============================================
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS latitude double precision DEFAULT NULL;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS longitude double precision DEFAULT NULL;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS radius_km integer DEFAULT 50;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS city text DEFAULT NULL;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS country text DEFAULT NULL;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS scope text DEFAULT 'global'
  CHECK (scope IN ('local', 'regional', 'global'));

-- ============================================
-- 2. ADD ARCHIVING SUPPORT
-- ============================================
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS archived_at timestamptz DEFAULT NULL;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS archived_by uuid DEFAULT NULL;

-- ============================================
-- 3. ADD ENDED_AT TIMESTAMP
-- ============================================
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS ended_at timestamptz DEFAULT NULL;

-- ============================================
-- 4. RECURRING EVENTS SUPPORT
-- ============================================
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS is_recurring boolean DEFAULT false;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS recurrence_type text DEFAULT NULL
  CHECK (recurrence_type IS NULL OR recurrence_type IN (
    'weekly', 'biweekly', 'monthly_day', 'monthly_weekday', 'yearly'
  ));
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS recurrence_days integer[] DEFAULT NULL;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS recurrence_count integer DEFAULT NULL;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS recurrence_ends_at timestamptz DEFAULT NULL;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS parent_event_id uuid DEFAULT NULL
  REFERENCES public.events(id) ON DELETE SET NULL;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS occurrence_number integer DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_events_parent ON public.events (parent_event_id) WHERE parent_event_id IS NOT NULL;

-- ============================================
-- 4B. FUNCTION TO GENERATE RECURRING EVENT OCCURRENCES
-- ============================================
CREATE OR REPLACE FUNCTION public.generate_recurring_events(
  p_parent_id uuid,
  p_count integer DEFAULT 8
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_parent record;
  v_next_date timestamptz;
  v_generated integer := 0;
  v_occurrence integer;
  v_max_occurrence integer;
  v_target_dow integer;
  v_nth_weekday integer;
  v_month_start date;
  v_candidate date;
BEGIN
  SELECT * INTO v_parent FROM events WHERE id = p_parent_id AND is_recurring = true;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT COALESCE(MAX(occurrence_number), 0) INTO v_max_occurrence
  FROM events WHERE parent_event_id = p_parent_id;

  SELECT COALESCE(MAX(event_date), v_parent.event_date) INTO v_next_date
  FROM events WHERE parent_event_id = p_parent_id;

  FOR i IN 1..p_count LOOP
    v_occurrence := v_max_occurrence + i;

    IF v_parent.recurrence_count IS NOT NULL AND v_occurrence > v_parent.recurrence_count THEN
      EXIT;
    END IF;

    CASE v_parent.recurrence_type
      WHEN 'weekly' THEN
        v_next_date := v_next_date + interval '7 days';
      WHEN 'biweekly' THEN
        v_next_date := v_next_date + interval '14 days';
      WHEN 'monthly_day' THEN
        v_next_date := v_next_date + interval '1 month';
      WHEN 'monthly_weekday' THEN
        v_target_dow := EXTRACT(DOW FROM v_parent.event_date)::integer;
        v_nth_weekday := CEIL(EXTRACT(DAY FROM v_parent.event_date) / 7.0)::integer;
        v_month_start := date_trunc('month', v_next_date::date + interval '1 month')::date;
        v_candidate := v_month_start + ((v_target_dow - EXTRACT(DOW FROM v_month_start)::integer + 7) % 7) * interval '1 day';
        v_candidate := v_candidate + (v_nth_weekday - 1) * interval '7 days';
        v_next_date := v_candidate + (v_parent.event_date - date_trunc('day', v_parent.event_date));
      WHEN 'yearly' THEN
        v_next_date := v_next_date + interval '1 year';
      ELSE
        EXIT;
    END CASE;

    IF v_parent.recurrence_ends_at IS NOT NULL AND v_next_date > v_parent.recurrence_ends_at THEN
      EXIT;
    END IF;

    IF EXISTS (
      SELECT 1 FROM events
      WHERE parent_event_id = p_parent_id
        AND date_trunc('day', event_date) = date_trunc('day', v_next_date)
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO events (
      title, description, cover_image, event_date, duration_minutes, max_attendees,
      tags, status, vibes, max_male_attendees, max_female_attendees, max_nonbinary_attendees,
      visibility, is_free, price_amount, price_currency,
      scope, latitude, longitude, radius_km, city, country,
      parent_event_id, occurrence_number, is_recurring
    ) VALUES (
      v_parent.title, v_parent.description, v_parent.cover_image, v_next_date,
      v_parent.duration_minutes, v_parent.max_attendees, v_parent.tags, 'upcoming',
      v_parent.vibes, v_parent.max_male_attendees, v_parent.max_female_attendees, v_parent.max_nonbinary_attendees,
      v_parent.visibility, v_parent.is_free, v_parent.price_amount, v_parent.price_currency,
      v_parent.scope, v_parent.latitude, v_parent.longitude, v_parent.radius_km, v_parent.city, v_parent.country,
      p_parent_id, v_occurrence, false
    );

    v_generated := v_generated + 1;
  END LOOP;

  RETURN v_generated;
END;
$$;

-- ============================================
-- 5. UPDATE STATUS CHECK CONSTRAINT
-- ============================================
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE public.events ADD CONSTRAINT events_status_check
  CHECK (status IN ('upcoming', 'live', 'ended', 'completed', 'cancelled', 'draft'));

-- ============================================
-- 6. HAVERSINE DISTANCE FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION public.haversine_distance(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) RETURNS double precision
LANGUAGE sql IMMUTABLE
AS $$
  SELECT 6371 * 2 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) *
    sin(radians(lng2 - lng1) / 2) ^ 2
  ))
$$;

-- ============================================
-- 7. GET VISIBLE EVENTS RPC
-- ============================================
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
        AND now() < (e.event_date + (COALESCE(e.duration_minutes, 60) || ' minutes')::interval)
        THEN 'live'
      WHEN now() >= (e.event_date + (COALESCE(e.duration_minutes, 60) || ' minutes')::interval)
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
      WHEN now() >= e.event_date AND now() < (e.event_date + (COALESCE(e.duration_minutes, 60) || ' minutes')::interval) THEN 0
      WHEN now() < e.event_date THEN 1
      ELSE 2
    END,
    e.event_date ASC;
END;
$$;

-- ============================================
-- 8. GET OTHER CITY EVENTS RPC (PREMIUM UPSELL)
-- ============================================
CREATE OR REPLACE FUNCTION public.get_other_city_events(
  p_user_id uuid,
  p_user_lat double precision DEFAULT NULL,
  p_user_lng double precision DEFAULT NULL
) RETURNS TABLE (city text, country text, event_count bigint, sample_cover text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.city,
    e.country,
    COUNT(*)::bigint AS event_count,
    MIN(e.cover_image) AS sample_cover
  FROM events e
  WHERE e.archived_at IS NULL
    AND e.status NOT IN ('draft', 'cancelled', 'ended')
    AND COALESCE(e.is_recurring, false) = false
    AND e.event_date > now()
    AND e.scope = 'local'
    AND e.city IS NOT NULL
    AND e.latitude IS NOT NULL
    AND (
      p_user_lat IS NULL
      OR haversine_distance(p_user_lat, p_user_lng, e.latitude, e.longitude) > COALESCE(e.radius_km, 50)
    )
  GROUP BY e.city, e.country
  ORDER BY event_count DESC
  LIMIT 6;
END;
$$;

-- ============================================
-- 9. INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_events_geo ON public.events (latitude, longitude) WHERE latitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_scope ON public.events (scope);
CREATE INDEX IF NOT EXISTS idx_events_archived ON public.events (archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_events_city ON public.events (city);
CREATE INDEX IF NOT EXISTS idx_events_recurring ON public.events (is_recurring) WHERE is_recurring = true;
