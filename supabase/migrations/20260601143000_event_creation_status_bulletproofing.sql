-- Event creation/status hardening follow-up.
-- Keeps draft as a real lifecycle state while making backend creation,
-- discovery, direct reads, reminders, and notification eligibility use the same
-- conservative event-status truth.

ALTER TABLE public.event_reminder_queue
  ADD COLUMN IF NOT EXISTS discarded_at timestamptz;

COMMENT ON COLUMN public.event_reminder_queue.discarded_at IS
  'Set when a pending reminder is terminally suppressed because the event or registration is no longer notifiable. Distinct from delivered_at so skipped reminders do not inflate delivery analytics.';

DROP POLICY IF EXISTS "Anyone can view events" ON public.events;
CREATE POLICY "Anyone can view events" ON public.events
  FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (
      COALESCE(is_test_event, false) = false
      AND (
        (
          archived_at IS NULL
          AND lower(COALESCE(status, '')) NOT IN ('draft', 'cancelled', 'archived', 'ended', 'completed')
        )
        OR EXISTS (
          SELECT 1
          FROM public.event_registrations er
          WHERE er.event_id = events.id
            AND er.profile_id = auth.uid()
        )
      )
    )
  );

COMMENT ON POLICY "Anyone can view events" ON public.events IS
  'Public event reads exclude synthetic rows and suppress unpublished, archived, and terminal rows unless the user already has a registration. Admins can inspect all event rows.';

CREATE OR REPLACE FUNCTION public.admin_validate_event_payload(
  p_payload jsonb,
  p_is_create boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_payload jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_errors text[] := ARRAY[]::text[];
  v_title text;
  v_event_date_text text;
  v_event_date timestamptz;
  v_status text;
  v_visibility text;
  v_scope text;
  v_duration_text text;
  v_duration integer;
  v_capacity_text text;
  v_capacity integer;
  v_cap_text text;
  v_cap integer;
  v_price_text text;
  v_price numeric;
  v_currency text;
  v_is_free_text text;
  v_is_free boolean := true;
  v_is_location_specific_text text;
  v_is_location_specific boolean := false;
  v_lat_text text;
  v_lng_text text;
  v_radius_text text;
  v_lat double precision;
  v_lng double precision;
  v_radius integer;
  v_category_keys text[];
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Event payload must be a JSON object.');
  END IF;

  v_title := NULLIF(btrim(COALESCE(v_payload ->> 'title', '')), '');
  IF v_title IS NULL THEN v_errors := array_append(v_errors, 'title is required'); END IF;

  v_event_date_text := NULLIF(btrim(COALESCE(v_payload ->> 'event_date', '')), '');
  IF v_event_date_text IS NULL THEN
    v_errors := array_append(v_errors, 'event_date is required');
  ELSE
    BEGIN
      v_event_date := v_event_date_text::timestamptz;
    EXCEPTION WHEN others THEN
      v_errors := array_append(v_errors, 'event_date must be a valid timestamp');
    END;
  END IF;
  IF p_is_create AND v_event_date IS NOT NULL AND v_event_date <= now() THEN
    v_errors := array_append(v_errors, 'event_date must be in the future when creating events');
  END IF;

  v_status := COALESCE(lower(NULLIF(btrim(COALESCE(v_payload ->> 'status', '')), '')), 'upcoming');
  IF p_is_create AND v_status NOT IN ('draft', 'upcoming') THEN
    v_errors := array_append(v_errors, 'status must be draft or upcoming when creating events');
  ELSIF NOT p_is_create AND v_status NOT IN ('draft', 'upcoming', 'live', 'ended', 'completed', 'cancelled') THEN
    v_errors := array_append(v_errors, 'status is invalid');
  END IF;

  v_visibility := COALESCE(lower(NULLIF(btrim(COALESCE(v_payload ->> 'visibility', '')), '')), 'all');
  IF v_visibility NOT IN ('all', 'premium', 'vip') THEN v_errors := array_append(v_errors, 'visibility must be all, premium, or vip'); END IF;

  v_scope := COALESCE(lower(NULLIF(btrim(COALESCE(v_payload ->> 'scope', '')), '')), 'global');
  IF v_scope NOT IN ('global', 'regional', 'local') THEN v_errors := array_append(v_errors, 'scope must be global, regional, or local'); END IF;

  v_duration_text := NULLIF(btrim(COALESCE(v_payload ->> 'duration_minutes', '')), '');
  IF v_duration_text IS NULL THEN v_duration := 60;
  ELSE
    BEGIN
      v_duration := v_duration_text::integer;
      IF v_duration < 15 OR v_duration > 480 THEN v_errors := array_append(v_errors, 'duration_minutes must be between 15 and 480'); END IF;
    EXCEPTION WHEN others THEN v_errors := array_append(v_errors, 'duration_minutes must be an integer');
    END;
  END IF;

  v_capacity_text := NULLIF(btrim(COALESCE(v_payload ->> 'max_attendees', '')), '');
  IF v_capacity_text IS NULL THEN v_capacity := 50;
  ELSE
    BEGIN
      v_capacity := v_capacity_text::integer;
      IF v_capacity < 1 OR v_capacity > 10000 THEN v_errors := array_append(v_errors, 'max_attendees must be between 1 and 10000'); END IF;
    EXCEPTION WHEN others THEN v_errors := array_append(v_errors, 'max_attendees must be an integer');
    END;
  END IF;

  FOREACH v_cap_text IN ARRAY ARRAY[
    NULLIF(btrim(COALESCE(v_payload ->> 'max_male_attendees', '')), ''),
    NULLIF(btrim(COALESCE(v_payload ->> 'max_female_attendees', '')), ''),
    NULLIF(btrim(COALESCE(v_payload ->> 'max_nonbinary_attendees', '')), '')
  ]
  LOOP
    IF v_cap_text IS NOT NULL THEN
      BEGIN
        v_cap := v_cap_text::integer;
        IF v_cap < 0 OR v_cap > 10000 THEN v_errors := array_append(v_errors, 'gender capacity caps must be between 0 and 10000'); END IF;
      EXCEPTION WHEN others THEN v_errors := array_append(v_errors, 'gender capacity caps must be integers');
      END;
    END IF;
  END LOOP;

  v_price_text := NULLIF(btrim(COALESCE(v_payload ->> 'price_amount', '')), '');
  IF v_price_text IS NULL THEN v_price := 0;
  ELSE
    BEGIN
      v_price := v_price_text::numeric;
      IF v_price < 0 THEN v_errors := array_append(v_errors, 'price_amount must be non-negative'); END IF;
    EXCEPTION WHEN others THEN v_errors := array_append(v_errors, 'price_amount must be numeric');
    END;
  END IF;

  v_currency := COALESCE(upper(NULLIF(btrim(COALESCE(v_payload ->> 'price_currency', '')), '')), 'EUR');
  IF v_currency NOT IN ('EUR', 'USD', 'GBP', 'PLN') THEN v_errors := array_append(v_errors, 'price_currency must be EUR, USD, GBP, or PLN'); END IF;

  v_is_free_text := lower(NULLIF(btrim(COALESCE(v_payload ->> 'is_free', '')), ''));
  IF v_is_free_text IS NOT NULL THEN
    IF v_is_free_text NOT IN ('true', 'false') THEN v_errors := array_append(v_errors, 'is_free must be boolean');
    ELSE v_is_free := v_is_free_text::boolean;
    END IF;
  END IF;
  IF v_is_free IS FALSE AND COALESCE(v_price, 0) <= 0 THEN v_errors := array_append(v_errors, 'paid events require price_amount greater than 0'); END IF;

  v_is_location_specific_text := lower(NULLIF(btrim(COALESCE(v_payload ->> 'is_location_specific', '')), ''));
  IF v_is_location_specific_text IS NOT NULL THEN
    IF v_is_location_specific_text NOT IN ('true', 'false') THEN v_errors := array_append(v_errors, 'is_location_specific must be boolean');
    ELSE v_is_location_specific := v_is_location_specific_text::boolean;
    END IF;
  END IF;

  v_lat_text := NULLIF(btrim(COALESCE(v_payload ->> 'latitude', '')), '');
  IF v_lat_text IS NOT NULL THEN
    BEGIN
      v_lat := v_lat_text::double precision;
      IF v_lat < -90 OR v_lat > 90 THEN v_errors := array_append(v_errors, 'latitude must be between -90 and 90'); END IF;
    EXCEPTION WHEN others THEN v_errors := array_append(v_errors, 'latitude must be numeric');
    END;
  END IF;

  v_lng_text := NULLIF(btrim(COALESCE(v_payload ->> 'longitude', '')), '');
  IF v_lng_text IS NOT NULL THEN
    BEGIN
      v_lng := v_lng_text::double precision;
      IF v_lng < -180 OR v_lng > 180 THEN v_errors := array_append(v_errors, 'longitude must be between -180 and 180'); END IF;
    EXCEPTION WHEN others THEN v_errors := array_append(v_errors, 'longitude must be numeric');
    END;
  END IF;

  v_radius_text := NULLIF(btrim(COALESCE(v_payload ->> 'radius_km', '')), '');
  IF v_radius_text IS NOT NULL THEN
    BEGIN
      v_radius := v_radius_text::integer;
      IF v_radius < 5 OR v_radius > 500 THEN v_errors := array_append(v_errors, 'radius_km must be between 5 and 500'); END IF;
    EXCEPTION WHEN others THEN v_errors := array_append(v_errors, 'radius_km must be an integer');
    END;
  END IF;

  IF v_scope = 'regional' AND NULLIF(btrim(COALESCE(v_payload ->> 'country', '')), '') IS NULL THEN v_errors := array_append(v_errors, 'regional events require country'); END IF;
  IF v_scope = 'local' THEN
    IF v_lat IS NULL OR v_lng IS NULL THEN v_errors := array_append(v_errors, 'local events require latitude and longitude'); END IF;
    IF v_radius IS NULL THEN v_errors := array_append(v_errors, 'local events require radius_km'); END IF;
    IF NULLIF(btrim(COALESCE(v_payload ->> 'city', '')), '') IS NULL THEN v_errors := array_append(v_errors, 'local events require city'); END IF;
  END IF;
  IF v_is_location_specific AND (v_lat IS NULL OR v_lng IS NULL) THEN v_errors := array_append(v_errors, 'location-specific events require latitude and longitude'); END IF;

  IF v_payload ? 'category_keys' THEN
    IF jsonb_typeof(v_payload -> 'category_keys') <> 'array' THEN
      v_errors := array_append(v_errors, 'category_keys must be an array');
    END IF;
    v_category_keys := public.admin_jsonb_text_array(v_payload -> 'category_keys');
    IF NOT public.event_category_keys_are_valid(v_category_keys) THEN
      v_errors := array_append(v_errors, 'category_keys contains an unknown category');
    END IF;
  END IF;

  IF array_length(v_errors, 1) IS NOT NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Event payload failed validation.', jsonb_build_object('errors', v_errors));
  END IF;

  RETURN NULL;
END;
$function$;

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
  category_keys       text[],
  categories          jsonb,
  vibes               text[],
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
  v_is_admin            boolean;
  v_can_city_browse     boolean;
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
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT
    p.country,
    public.profile_location_coord(p.location_data, 'lat'),
    public.profile_location_coord(p.location_data, 'lng')
  INTO
    v_profile_country,
    v_profile_lat,
    v_profile_lng
  FROM public.profiles p
  WHERE p.id = p_user_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.role = 'admin'::public.app_role
  ) INTO v_is_admin;

  v_can_city_browse :=
    COALESCE(v_is_admin, false)
    OR COALESCE(public._get_user_tier_capability_bool_unchecked(p_user_id, 'canCityBrowse'), false);

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

  IF NOT v_can_city_browse AND v_browse_requested THEN
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
    WHEN v_can_city_browse AND v_valid_browse_coords THEN p_browse_lat
    ELSE NULL
  END;
  v_browse_lng_eff := CASE
    WHEN v_can_city_browse AND v_valid_browse_coords THEN p_browse_lng
    ELSE NULL
  END;

  v_effective_lat := COALESCE(v_browse_lat_eff, v_user_lat_eff);
  v_effective_lng := COALESCE(v_browse_lng_eff, v_user_lng_eff);

  RETURN QUERY
  SELECT
    e.id, e.title, e.description, e.cover_image, e.event_date,
    e.duration_minutes, e.max_attendees, e.current_attendees, e.tags,
    e.category_keys,
    COALESCE(cat.categories, '[]'::jsonb) AS categories,
    e.vibes,
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
      WHEN lower(COALESCE(e.status, '')) = 'cancelled' THEN 'cancelled'
      WHEN lower(COALESCE(e.status, '')) = 'draft' THEN 'draft'
      WHEN lower(COALESCE(e.status, '')) = 'archived' OR e.archived_at IS NOT NULL THEN 'archived'
      WHEN lower(COALESCE(e.status, '')) IN ('ended', 'completed') THEN 'ended'
      WHEN e.ended_at IS NOT NULL THEN 'ended'
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
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object('key', ec.key, 'label', ec.label, 'emoji', ec.emoji)
      ORDER BY ec.sort_order, ec.label
    ) AS categories
    FROM public.event_categories ec
    WHERE ec.key = ANY(COALESCE(e.category_keys, ARRAY[]::text[]))
  ) cat ON true
  WHERE e.archived_at IS NULL
    AND COALESCE(e.is_test_event, false) = false
    AND (
      lower(COALESCE(e.status, 'upcoming')) NOT IN ('draft', 'cancelled', 'archived', 'ended', 'completed')
      OR (
        lower(COALESCE(e.status, 'upcoming')) IN ('ended', 'completed')
        AND COALESCE(
          e.ended_at,
          e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute'
        ) <= now()
      )
    )
    AND COALESCE(e.is_recurring, false) = false
    AND public._user_can_access_event_visibility_unchecked(p_user_id, COALESCE(e.visibility, 'all'))
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
          OR v_can_city_browse
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

CREATE OR REPLACE FUNCTION public.get_other_city_events(
  p_user_id uuid,
  p_user_lat double precision DEFAULT NULL,
  p_user_lng double precision DEFAULT NULL
) RETURNS TABLE (city text, country text, event_count bigint, sample_cover text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    e.city,
    e.country,
    COUNT(*)::bigint AS event_count,
    MIN(e.cover_image) AS sample_cover
  FROM public.events e
  WHERE e.archived_at IS NULL
    AND COALESCE(e.is_test_event, false) = false
    AND lower(COALESCE(e.status, 'upcoming')) NOT IN ('draft', 'cancelled', 'ended', 'completed', 'archived')
    AND COALESCE(e.is_recurring, false) = false
    AND e.event_date > now()
    AND e.scope = 'local'
    AND e.city IS NOT NULL
    AND e.latitude IS NOT NULL
    AND (
      p_user_lat IS NULL
      OR public.haversine_distance(p_user_lat, p_user_lng, e.latitude, e.longitude) > COALESCE(e.radius_km, 50)
    )
  GROUP BY e.city, e.country
  ORDER BY event_count DESC
  LIMIT 6;
END;
$function$;

CREATE OR REPLACE FUNCTION public.send_event_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  INSERT INTO public.event_reminder_queue (profile_id, event_id, event_title, reminder_type)
  SELECT er.profile_id, e.id, e.title, 'event_reminder_30m'
  FROM public.event_registrations er
  JOIN public.events e ON e.id = er.event_id
  WHERE e.event_date BETWEEN now() + interval '29 minutes' AND now() + interval '31 minutes'
    AND er.admission_status = 'confirmed'
    AND e.archived_at IS NULL
    AND e.ended_at IS NULL
    AND COALESCE(e.is_test_event, false) = false
    AND lower(COALESCE(e.status, 'upcoming')) NOT IN ('draft', 'cancelled', 'archived', 'ended', 'completed')
  ON CONFLICT (profile_id, event_id, reminder_type) DO NOTHING;

  INSERT INTO public.event_reminder_queue (profile_id, event_id, event_title, reminder_type)
  SELECT er.profile_id, e.id, e.title, 'event_reminder_5m'
  FROM public.event_registrations er
  JOIN public.events e ON e.id = er.event_id
  WHERE e.event_date BETWEEN now() + interval '4 minutes' AND now() + interval '6 minutes'
    AND er.admission_status = 'confirmed'
    AND e.archived_at IS NULL
    AND e.ended_at IS NULL
    AND COALESCE(e.is_test_event, false) = false
    AND lower(COALESCE(e.status, 'upcoming')) NOT IN ('draft', 'cancelled', 'archived', 'ended', 'completed')
  ON CONFLICT (profile_id, event_id, reminder_type) DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_due_event_reminder_queue_rows(
  p_limit integer DEFAULT 100,
  p_stale_after_seconds integer DEFAULT 120
) RETURNS TABLE(
  id uuid,
  profile_id uuid,
  event_id uuid,
  event_title text,
  reminder_type text,
  delivery_attempts integer,
  last_error_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 1000));
BEGIN
  PERFORM public.unclaim_stale_event_reminder_queue_rows(
    GREATEST(30, COALESCE(p_stale_after_seconds, 120)),
    v_limit * 2
  );

  WITH invalid AS (
    SELECT q.id
    FROM public.event_reminder_queue q
    LEFT JOIN public.events e ON e.id = q.event_id
    LEFT JOIN public.event_registrations er
      ON er.event_id = q.event_id
     AND er.profile_id = q.profile_id
     AND er.admission_status = 'confirmed'
    WHERE q.delivered_at IS NULL
      AND q.discarded_at IS NULL
      AND q.claimed_at IS NULL
      AND (
        e.id IS NULL
        OR er.id IS NULL
        OR e.archived_at IS NOT NULL
        OR e.ended_at IS NOT NULL
        OR COALESCE(e.is_test_event, false) = true
        OR lower(COALESCE(e.status, 'upcoming')) IN ('draft', 'cancelled', 'archived', 'ended', 'completed')
        OR e.event_date IS NULL
        OR v_now >= e.event_date
      )
    ORDER BY q.created_at
    FOR UPDATE OF q SKIP LOCKED
    LIMIT v_limit * 2
  )
  UPDATE public.event_reminder_queue q
  SET discarded_at = v_now,
      last_error_reason = 'event_not_notifiable',
      last_error_at = v_now
  FROM invalid
  WHERE q.id = invalid.id;

  RETURN QUERY
  WITH due AS (
    SELECT q.id
    FROM public.event_reminder_queue q
    JOIN public.events e ON e.id = q.event_id
    JOIN public.event_registrations er
      ON er.event_id = q.event_id
     AND er.profile_id = q.profile_id
     AND er.admission_status = 'confirmed'
    WHERE q.delivered_at IS NULL
      AND q.discarded_at IS NULL
      AND q.claimed_at IS NULL
      AND e.archived_at IS NULL
      AND e.ended_at IS NULL
      AND COALESCE(e.is_test_event, false) = false
      AND lower(COALESCE(e.status, 'upcoming')) NOT IN ('draft', 'cancelled', 'archived', 'ended', 'completed')
      AND e.event_date IS NOT NULL
      AND v_now < e.event_date
    ORDER BY q.created_at
    FOR UPDATE OF q SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.event_reminder_queue q
  SET claimed_at = v_now,
      delivery_attempts = COALESCE(q.delivery_attempts, 0) + 1
  FROM due
  WHERE q.id = due.id
  RETURNING q.id,
            q.profile_id,
            q.event_id,
            q.event_title,
            q.reminder_type,
            q.delivery_attempts,
            q.last_error_reason;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_lobby_active_state(
  p_event_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(
  is_active boolean,
  reason text,
  event_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_now timestamptz := COALESCE(p_now, now());
  v_status text;
  v_scheduled_end timestamptz;
BEGIN
  SELECT *
  INTO v_event
  FROM public.events
  WHERE id = p_event_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'event_not_found'::text, NULL::text;
    RETURN;
  END IF;

  v_status := lower(COALESCE(NULLIF(v_event.status, ''), 'upcoming'));

  IF v_status = 'draft' THEN
    RETURN QUERY SELECT false, 'event_draft'::text, v_event.status;
    RETURN;
  END IF;

  IF v_status = 'cancelled' THEN
    RETURN QUERY SELECT false, 'event_cancelled'::text, v_event.status;
    RETURN;
  END IF;

  IF v_event.archived_at IS NOT NULL OR v_status = 'archived' THEN
    RETURN QUERY SELECT false, 'event_archived'::text, v_event.status;
    RETURN;
  END IF;

  IF v_event.ended_at IS NOT NULL OR v_status IN ('ended', 'completed') THEN
    RETURN QUERY SELECT false, 'event_ended'::text, v_event.status;
    RETURN;
  END IF;

  IF v_status NOT IN ('upcoming', 'scheduled', 'live') THEN
    RETURN QUERY SELECT false, 'event_not_live'::text, v_event.status;
    RETURN;
  END IF;

  IF v_event.event_date IS NULL THEN
    RETURN QUERY SELECT false, 'event_outside_live_window'::text, v_event.status;
    RETURN;
  END IF;

  IF v_now < v_event.event_date THEN
    RETURN QUERY SELECT false, 'event_not_started'::text, v_event.status;
    RETURN;
  END IF;

  v_scheduled_end :=
    v_event.event_date + COALESCE(v_event.duration_minutes, 60) * interval '1 minute';

  IF v_now >= v_scheduled_end THEN
    RETURN QUERY SELECT false, 'event_outside_live_window'::text, v_event.status;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text, v_event.status;
END;
$function$;

DROP FUNCTION IF EXISTS public.register_for_event_20260601143000_terminal_base(uuid);
ALTER FUNCTION public.register_for_event(uuid)
  RENAME TO register_for_event_20260601143000_terminal_base;

CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_status text;
  v_archived_at timestamptz;
  v_ended_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT e.status, e.archived_at, e.ended_at
  INTO v_status, v_archived_at, v_ended_at
  FROM public.events e
  WHERE e.id = p_event_id;

  IF NOT FOUND
     OR v_archived_at IS NOT NULL
     OR v_ended_at IS NOT NULL
     OR lower(COALESCE(v_status, '')) IN ('draft', 'cancelled', 'archived', 'ended', 'completed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event not found or not open for registration');
  END IF;

  RETURN public.register_for_event_20260601143000_terminal_base(p_event_id);
END;
$function$;

DROP FUNCTION IF EXISTS public.settle_event_ticket_checkout_20260601143000_terminal_base(text, uuid, uuid);
ALTER FUNCTION public.settle_event_ticket_checkout(text, uuid, uuid)
  RENAME TO settle_event_ticket_checkout_20260601143000_terminal_base;

CREATE OR REPLACE FUNCTION public.settle_event_ticket_checkout(
  p_checkout_session_id text,
  p_profile_id uuid,
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_existing record;
  v_status text;
  v_archived_at timestamptz;
  v_ended_at timestamptz;
  v_result jsonb;
  v_final_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'FORBIDDEN');
  END IF;

  IF p_checkout_session_id IS NULL OR p_profile_id IS NULL OR p_event_id IS NULL THEN
    RETURN public.settle_event_ticket_checkout_20260601143000_terminal_base(
      p_checkout_session_id,
      p_profile_id,
      p_event_id
    );
  END IF;

  SELECT outcome, result
  INTO v_existing
  FROM public.stripe_event_ticket_settlements
  WHERE checkout_session_id = p_checkout_session_id
  FOR UPDATE;

  IF FOUND AND v_existing.outcome IS DISTINCT FROM 'in_progress' THEN
    RETURN COALESCE(v_existing.result, '{}'::jsonb)
      || jsonb_build_object('idempotent', true, 'outcome', v_existing.outcome);
  END IF;

  SELECT e.status, e.archived_at, e.ended_at
  INTO v_status, v_archived_at, v_ended_at
  FROM public.events e
  WHERE e.id = p_event_id;

  IF NOT FOUND
     OR v_archived_at IS NOT NULL
     OR v_ended_at IS NOT NULL
     OR lower(COALESCE(v_status, '')) IN ('draft', 'cancelled', 'archived', 'ended', 'completed') THEN
    v_result := jsonb_build_object(
      'success', false,
      'admission_status', null,
      'error', 'event_not_admissible',
      'code', 'EVENT_CLOSED'
    );

    INSERT INTO public.stripe_event_ticket_settlements (
      checkout_session_id,
      profile_id,
      event_id,
      outcome,
      result
    )
    VALUES (
      p_checkout_session_id,
      p_profile_id,
      p_event_id,
      'rejected_event',
      v_result
    )
    ON CONFLICT (checkout_session_id) DO UPDATE
    SET outcome = 'rejected_event',
        result = EXCLUDED.result,
        updated_at = now()
    WHERE public.stripe_event_ticket_settlements.outcome = 'in_progress'
       OR public.stripe_event_ticket_settlements.outcome IS NULL
    RETURNING result
    INTO v_final_result;

    RETURN COALESCE(v_final_result, v_result);
  END IF;

  RETURN public.settle_event_ticket_checkout_20260601143000_terminal_base(
    p_checkout_session_id,
    p_profile_id,
    p_event_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_validate_event_payload(jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_visible_events(uuid, double precision, double precision, boolean, double precision, double precision, double precision) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_other_city_events(uuid, double precision, double precision) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.send_event_reminders() FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.claim_due_event_reminder_queue_rows(integer, integer) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.get_event_lobby_active_state(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_for_event(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_for_event_20260601143000_terminal_base(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_event_ticket_checkout(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_event_ticket_checkout_20260601143000_terminal_base(text, uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_validate_event_payload(jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_visible_events(uuid, double precision, double precision, boolean, double precision, double precision, double precision) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_other_city_events(uuid, double precision, double precision) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.send_event_reminders() TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_event_reminder_queue_rows(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_event_lobby_active_state(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_event_ticket_checkout(text, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.admin_validate_event_payload(jsonb, boolean) IS
  'Admin event payload validator. Create payloads must schedule draft/upcoming events in the future; updates may preserve closed historical rows through guarded admin_update_event rules.';
COMMENT ON FUNCTION public.get_visible_events(uuid, double precision, double precision, boolean, double precision, double precision, double precision) IS
  'Returns discover/home-visible non-test events for the authenticated p_user_id. Draft, cancelled, archived, recurring parents, and rows outside the approved grace window are excluded.';
COMMENT ON FUNCTION public.get_other_city_events(uuid, double precision, double precision) IS
  'Premium teaser city rollup. Auth-bound and excludes draft/cancelled/ended/completed/archived/test rows.';
COMMENT ON FUNCTION public.send_event_reminders() IS
  'Queues 30m and 5m reminders only for confirmed registrations on currently notifiable upcoming/live event rows.';
COMMENT ON FUNCTION public.claim_due_event_reminder_queue_rows(integer, integer) IS
  'Claims event reminder rows after re-checking current event lifecycle and confirmed admission; invalid stale rows are discarded so unpublished/cancelled/archived events cannot send reminders or inflate delivery analytics.';
COMMENT ON FUNCTION public.get_event_lobby_active_state(uuid, timestamptz) IS
  'Internal canonical Event Lobby active-state helper. Raw ended/completed statuses, ended_at, archived_at, draft, cancelled, and out-of-window rows are inactive before any lobby/deck mutation can run.';
COMMENT ON FUNCTION public.register_for_event(uuid) IS
  'Authenticated free-event registration entrypoint with terminal status preflight; draft/cancelled/archived/ended/completed rows cannot create admissions.';
COMMENT ON FUNCTION public.settle_event_ticket_checkout(text, uuid, uuid) IS
  'Service-role paid event-ticket settlement entrypoint with terminal status preflight before admission or refund reconciliation.';
