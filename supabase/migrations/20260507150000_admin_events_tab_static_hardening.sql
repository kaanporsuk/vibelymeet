-- Admin Events tab static hardening.
--
-- Adds backend-owned event table reads, audited attendee attendance writes, an
-- idempotent registration-removal overload, stricter admin event payload
-- validation, and corrected attendance metric semantics.

-- ─────────────────────────────────────────────────────────────────────────────
-- Shared event payload validation
-- ─────────────────────────────────────────────────────────────────────────────

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
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Event payload must be a JSON object.');
  END IF;

  v_title := NULLIF(btrim(COALESCE(v_payload ->> 'title', '')), '');
  IF v_title IS NULL THEN
    v_errors := array_append(v_errors, 'title is required');
  END IF;

  v_event_date_text := NULLIF(btrim(COALESCE(v_payload ->> 'event_date', '')), '');
  IF v_event_date_text IS NULL THEN
    v_errors := array_append(v_errors, 'event_date is required');
  ELSE
    BEGIN
      PERFORM v_event_date_text::timestamptz;
    EXCEPTION WHEN others THEN
      v_errors := array_append(v_errors, 'event_date must be a valid timestamp');
    END;
  END IF;

  v_status := lower(NULLIF(btrim(COALESCE(v_payload ->> 'status', '')), ''));
  v_status := COALESCE(v_status, 'upcoming');
  IF p_is_create AND v_status NOT IN ('draft', 'upcoming') THEN
    v_errors := array_append(v_errors, 'status must be draft or upcoming when creating events');
  ELSIF NOT p_is_create AND v_status NOT IN ('draft', 'upcoming', 'live', 'ended', 'completed', 'cancelled') THEN
    v_errors := array_append(v_errors, 'status is invalid');
  END IF;

  v_visibility := lower(NULLIF(btrim(COALESCE(v_payload ->> 'visibility', '')), ''));
  v_visibility := COALESCE(v_visibility, 'all');
  IF v_visibility NOT IN ('all', 'premium', 'vip') THEN
    v_errors := array_append(v_errors, 'visibility must be all, premium, or vip');
  END IF;

  v_scope := lower(NULLIF(btrim(COALESCE(v_payload ->> 'scope', '')), ''));
  v_scope := COALESCE(v_scope, 'global');
  IF v_scope NOT IN ('global', 'regional', 'local') THEN
    v_errors := array_append(v_errors, 'scope must be global, regional, or local');
  END IF;

  v_duration_text := NULLIF(btrim(COALESCE(v_payload ->> 'duration_minutes', '')), '');
  IF v_duration_text IS NULL THEN
    v_duration := 60;
  ELSE
    BEGIN
      v_duration := v_duration_text::integer;
      IF v_duration < 15 OR v_duration > 480 THEN
        v_errors := array_append(v_errors, 'duration_minutes must be between 15 and 480');
      END IF;
    EXCEPTION WHEN others THEN
      v_errors := array_append(v_errors, 'duration_minutes must be an integer');
    END;
  END IF;

  v_capacity_text := NULLIF(btrim(COALESCE(v_payload ->> 'max_attendees', '')), '');
  IF v_capacity_text IS NULL THEN
    v_capacity := 50;
  ELSE
    BEGIN
      v_capacity := v_capacity_text::integer;
      IF v_capacity < 1 OR v_capacity > 10000 THEN
        v_errors := array_append(v_errors, 'max_attendees must be between 1 and 10000');
      END IF;
    EXCEPTION WHEN others THEN
      v_errors := array_append(v_errors, 'max_attendees must be an integer');
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
        IF v_cap < 0 OR v_cap > 10000 THEN
          v_errors := array_append(v_errors, 'gender capacity caps must be between 0 and 10000');
        END IF;
      EXCEPTION WHEN others THEN
        v_errors := array_append(v_errors, 'gender capacity caps must be integers');
      END;
    END IF;
  END LOOP;

  v_price_text := NULLIF(btrim(COALESCE(v_payload ->> 'price_amount', '')), '');
  IF v_price_text IS NULL THEN
    v_price := 0;
  ELSE
    BEGIN
      v_price := v_price_text::numeric;
      IF v_price < 0 THEN
        v_errors := array_append(v_errors, 'price_amount must be non-negative');
      END IF;
    EXCEPTION WHEN others THEN
      v_errors := array_append(v_errors, 'price_amount must be numeric');
    END;
  END IF;

  v_currency := upper(NULLIF(btrim(COALESCE(v_payload ->> 'price_currency', '')), ''));
  v_currency := COALESCE(v_currency, 'EUR');
  IF v_currency NOT IN ('EUR', 'USD', 'GBP', 'PLN') THEN
    v_errors := array_append(v_errors, 'price_currency must be EUR, USD, GBP, or PLN');
  END IF;

  v_is_free_text := lower(NULLIF(btrim(COALESCE(v_payload ->> 'is_free', '')), ''));
  IF v_is_free_text IS NOT NULL THEN
    IF v_is_free_text NOT IN ('true', 'false') THEN
      v_errors := array_append(v_errors, 'is_free must be boolean');
    ELSE
      v_is_free := v_is_free_text::boolean;
    END IF;
  END IF;
  IF v_is_free IS FALSE AND COALESCE(v_price, 0) <= 0 THEN
    v_errors := array_append(v_errors, 'paid events require price_amount greater than 0');
  END IF;

  v_is_location_specific_text := lower(NULLIF(btrim(COALESCE(v_payload ->> 'is_location_specific', '')), ''));
  IF v_is_location_specific_text IS NOT NULL THEN
    IF v_is_location_specific_text NOT IN ('true', 'false') THEN
      v_errors := array_append(v_errors, 'is_location_specific must be boolean');
    ELSE
      v_is_location_specific := v_is_location_specific_text::boolean;
    END IF;
  END IF;

  v_lat_text := NULLIF(btrim(COALESCE(v_payload ->> 'latitude', '')), '');
  IF v_lat_text IS NOT NULL THEN
    BEGIN
      v_lat := v_lat_text::double precision;
      IF v_lat < -90 OR v_lat > 90 THEN
        v_errors := array_append(v_errors, 'latitude must be between -90 and 90');
      END IF;
    EXCEPTION WHEN others THEN
      v_errors := array_append(v_errors, 'latitude must be numeric');
    END;
  END IF;

  v_lng_text := NULLIF(btrim(COALESCE(v_payload ->> 'longitude', '')), '');
  IF v_lng_text IS NOT NULL THEN
    BEGIN
      v_lng := v_lng_text::double precision;
      IF v_lng < -180 OR v_lng > 180 THEN
        v_errors := array_append(v_errors, 'longitude must be between -180 and 180');
      END IF;
    EXCEPTION WHEN others THEN
      v_errors := array_append(v_errors, 'longitude must be numeric');
    END;
  END IF;

  v_radius_text := NULLIF(btrim(COALESCE(v_payload ->> 'radius_km', '')), '');
  IF v_radius_text IS NOT NULL THEN
    BEGIN
      v_radius := v_radius_text::integer;
      IF v_radius < 5 OR v_radius > 500 THEN
        v_errors := array_append(v_errors, 'radius_km must be between 5 and 500');
      END IF;
    EXCEPTION WHEN others THEN
      v_errors := array_append(v_errors, 'radius_km must be an integer');
    END;
  END IF;

  IF v_scope = 'regional' AND NULLIF(btrim(COALESCE(v_payload ->> 'country', '')), '') IS NULL THEN
    v_errors := array_append(v_errors, 'regional events require country');
  END IF;

  IF v_scope = 'local' THEN
    IF v_lat IS NULL OR v_lng IS NULL THEN
      v_errors := array_append(v_errors, 'local events require latitude and longitude');
    END IF;
    IF v_radius IS NULL THEN
      v_errors := array_append(v_errors, 'local events require radius_km');
    END IF;
    IF NULLIF(btrim(COALESCE(v_payload ->> 'city', '')), '') IS NULL THEN
      v_errors := array_append(v_errors, 'local events require city');
    END IF;
  END IF;

  IF v_is_location_specific AND (v_lat IS NULL OR v_lng IS NULL) THEN
    v_errors := array_append(v_errors, 'location-specific events require latitude and longitude');
  END IF;

  IF array_length(v_errors, 1) IS NOT NULL THEN
    RETURN public.admin_json_error(
      'VALIDATION_ERROR',
      'Event payload failed validation.',
      jsonb_build_object('errors', v_errors)
    );
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_validate_event_payload(jsonb, boolean) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- Backend-owned Events tab read model
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_list_events(
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_filters jsonb;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 1000), 1), 1000);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text;
  v_show_archived boolean := false;
  v_rows jsonb;
  v_total integer;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  v_filters := CASE
    WHEN p_filters IS NULL OR p_filters = 'null'::jsonb THEN '{}'::jsonb
    ELSE p_filters
  END;

  IF jsonb_typeof(v_filters) <> 'object' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Event filters must be a JSON object.');
  END IF;

  IF v_filters ? 'show_archived'
     AND lower(COALESCE(v_filters ->> 'show_archived', '')) NOT IN ('true', 'false') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'show_archived filter must be boolean.');
  END IF;

  v_search := NULLIF(btrim(COALESCE(v_filters ->> 'search', '')), '');
  v_show_archived := lower(COALESCE(v_filters ->> 'show_archived', 'false')) = 'true';

  WITH filtered AS (
    SELECT
      e.id,
      e.title,
      e.description,
      e.cover_image,
      e.language,
      e.event_date,
      e.duration_minutes,
      e.current_attendees,
      e.max_attendees,
      e.tags,
      e.vibes,
      e.status,
      e.ended_at,
      e.archived_at,
      e.archived_by,
      e.created_at,
      e.updated_at,
      e.city,
      e.country,
      e.scope,
      e.latitude,
      e.longitude,
      e.radius_km,
      e.location_name,
      e.location_address,
      e.is_location_specific,
      e.max_male_attendees,
      e.max_female_attendees,
      e.max_nonbinary_attendees,
      e.visibility,
      e.is_free,
      e.price_amount,
      e.price_currency,
      e.is_recurring,
      e.parent_event_id,
      e.occurrence_number,
      e.recurrence_type,
      e.recurrence_days,
      e.recurrence_count,
      e.recurrence_ends_at
    FROM public.events e
    WHERE (v_show_archived OR e.archived_at IS NULL)
      AND (
        v_search IS NULL
        OR position(lower(v_search) in lower(COALESCE(e.title, '') || ' ' || COALESCE(e.description, ''))) > 0
      )
  ),
  paged AS (
    SELECT f.*, count(*) OVER ()::integer AS total_count
    FROM filtered f
    ORDER BY f.event_date DESC, f.created_at DESC, f.id DESC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', paged.id,
        'title', paged.title,
        'description', paged.description,
        'cover_image', paged.cover_image,
        'language', paged.language,
        'event_date', paged.event_date,
        'duration_minutes', paged.duration_minutes,
        'current_attendees', paged.current_attendees,
        'max_attendees', paged.max_attendees,
        'tags', paged.tags,
        'vibes', paged.vibes,
        'status', paged.status,
        'ended_at', paged.ended_at,
        'archived_at', paged.archived_at,
        'archived_by', paged.archived_by,
        'created_at', paged.created_at,
        'updated_at', paged.updated_at,
        'city', paged.city,
        'country', paged.country,
        'scope', paged.scope,
        'latitude', paged.latitude,
        'longitude', paged.longitude,
        'radius_km', paged.radius_km,
        'location_name', paged.location_name,
        'location_address', paged.location_address,
        'is_location_specific', paged.is_location_specific,
        'max_male_attendees', paged.max_male_attendees,
        'max_female_attendees', paged.max_female_attendees,
        'max_nonbinary_attendees', paged.max_nonbinary_attendees,
        'visibility', paged.visibility,
        'is_free', paged.is_free,
        'price_amount', paged.price_amount,
        'price_currency', paged.price_currency,
        'is_recurring', paged.is_recurring,
        'parent_event_id', paged.parent_event_id,
        'occurrence_number', paged.occurrence_number,
        'recurrence_type', paged.recurrence_type,
        'recurrence_days', paged.recurrence_days,
        'recurrence_count', paged.recurrence_count,
        'recurrence_ends_at', paged.recurrence_ends_at
      )
      ORDER BY paged.event_date DESC, paged.created_at DESC, paged.id DESC
    ), '[]'::jsonb),
    COALESCE(max(paged.total_count), 0)
  INTO v_rows, v_total
  FROM paged;

  RETURN public.admin_json_success(jsonb_build_object(
    'events', v_rows,
    'total_count', v_total,
    'limit', v_limit,
    'offset', v_offset
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_list_events(jsonb, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_events(jsonb, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.admin_list_events(jsonb, integer, integer) IS
  'Admin-only Events tab read model. Keeps public events RLS unchanged while avoiding direct dashboard table reads.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Harden create/update validation while preserving RPC names
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_create_event(
  p_payload jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_cached jsonb;
  v_validation jsonb;
  v_event public.events%ROWTYPE;
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  v_validation := public.admin_validate_event_payload(p_payload, true);
  IF v_validation IS NOT NULL THEN
    RETURN v_validation;
  END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_create_event', p_idempotency_key, p_payload);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  INSERT INTO public.events (
    title,
    description,
    cover_image,
    language,
    event_date,
    duration_minutes,
    max_attendees,
    tags,
    status,
    vibes,
    max_male_attendees,
    max_female_attendees,
    max_nonbinary_attendees,
    visibility,
    is_free,
    price_amount,
    price_currency,
    scope,
    latitude,
    longitude,
    radius_km,
    city,
    country,
    location_name,
    is_location_specific,
    is_recurring,
    recurrence_type,
    recurrence_days,
    recurrence_count,
    recurrence_ends_at
  ) VALUES (
    NULLIF(btrim(p_payload ->> 'title'), ''),
    NULLIF(p_payload ->> 'description', ''),
    COALESCE(NULLIF(p_payload ->> 'cover_image', ''), '/placeholder.svg'),
    NULLIF(p_payload ->> 'language', ''),
    (p_payload ->> 'event_date')::timestamptz,
    COALESCE(NULLIF(p_payload ->> 'duration_minutes', '')::integer, 60),
    COALESCE(NULLIF(p_payload ->> 'max_attendees', '')::integer, 50),
    public.admin_jsonb_text_array(p_payload -> 'tags'),
    COALESCE(NULLIF(lower(p_payload ->> 'status'), ''), 'upcoming'),
    public.admin_jsonb_text_array(p_payload -> 'vibes'),
    NULLIF(p_payload ->> 'max_male_attendees', '')::integer,
    NULLIF(p_payload ->> 'max_female_attendees', '')::integer,
    NULLIF(p_payload ->> 'max_nonbinary_attendees', '')::integer,
    COALESCE(NULLIF(lower(p_payload ->> 'visibility'), ''), 'all'),
    COALESCE(NULLIF(p_payload ->> 'is_free', '')::boolean, true),
    COALESCE(NULLIF(p_payload ->> 'price_amount', '')::numeric, 0),
    COALESCE(NULLIF(upper(p_payload ->> 'price_currency'), ''), 'EUR'),
    COALESCE(NULLIF(lower(p_payload ->> 'scope'), ''), 'global'),
    NULLIF(p_payload ->> 'latitude', '')::double precision,
    NULLIF(p_payload ->> 'longitude', '')::double precision,
    NULLIF(p_payload ->> 'radius_km', '')::integer,
    NULLIF(p_payload ->> 'city', ''),
    NULLIF(p_payload ->> 'country', ''),
    NULLIF(p_payload ->> 'location_name', ''),
    COALESCE(NULLIF(p_payload ->> 'is_location_specific', '')::boolean, false),
    COALESCE(NULLIF(p_payload ->> 'is_recurring', '')::boolean, false),
    NULLIF(p_payload ->> 'recurrence_type', ''),
    public.admin_jsonb_int_array(p_payload -> 'recurrence_days'),
    NULLIF(p_payload ->> 'recurrence_count', '')::integer,
    NULLIF(p_payload ->> 'recurrence_ends_at', '')::timestamptz
  )
  RETURNING * INTO v_event;

  v_audit_id := public.log_admin_action(
    'event.create',
    'event',
    v_event.id,
    jsonb_build_object('event', to_jsonb(v_event))
  );

  v_response := public.admin_json_success(jsonb_build_object(
    'event_id', v_event.id,
    'event', to_jsonb(v_event),
    'audit_log_id', v_audit_id
  ));

  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_create_event', p_idempotency_key, v_response);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_event(
  p_event_id uuid,
  p_payload jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_cached jsonb;
  v_validation jsonb;
  v_effective jsonb;
  v_before public.events%ROWTYPE;
  v_after public.events%ROWTYPE;
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;
  IF p_event_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Event update request is invalid.');
  END IF;

  SELECT * INTO v_before
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.');
  END IF;

  v_effective := to_jsonb(v_before) || p_payload;
  v_validation := public.admin_validate_event_payload(v_effective, false);
  IF v_validation IS NOT NULL THEN
    RETURN v_validation;
  END IF;

  v_cached := public.admin_idempotency_begin(
    v_admin_id,
    'admin_update_event',
    p_idempotency_key,
    jsonb_build_object('event_id', p_event_id, 'payload', p_payload)
  );
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  UPDATE public.events
  SET title = CASE WHEN p_payload ? 'title' THEN NULLIF(btrim(p_payload ->> 'title'), '') ELSE title END,
      description = CASE WHEN p_payload ? 'description' THEN NULLIF(p_payload ->> 'description', '') ELSE description END,
      cover_image = CASE WHEN p_payload ? 'cover_image' THEN COALESCE(NULLIF(p_payload ->> 'cover_image', ''), cover_image) ELSE cover_image END,
      language = CASE WHEN p_payload ? 'language' THEN NULLIF(p_payload ->> 'language', '') ELSE language END,
      event_date = CASE WHEN p_payload ? 'event_date' THEN (p_payload ->> 'event_date')::timestamptz ELSE event_date END,
      duration_minutes = CASE WHEN p_payload ? 'duration_minutes' THEN COALESCE(NULLIF(p_payload ->> 'duration_minutes', '')::integer, 60) ELSE duration_minutes END,
      max_attendees = CASE WHEN p_payload ? 'max_attendees' THEN COALESCE(NULLIF(p_payload ->> 'max_attendees', '')::integer, 50) ELSE max_attendees END,
      tags = CASE WHEN p_payload ? 'tags' THEN public.admin_jsonb_text_array(p_payload -> 'tags') ELSE tags END,
      vibes = CASE WHEN p_payload ? 'vibes' THEN public.admin_jsonb_text_array(p_payload -> 'vibes') ELSE vibes END,
      max_male_attendees = CASE WHEN p_payload ? 'max_male_attendees' THEN NULLIF(p_payload ->> 'max_male_attendees', '')::integer ELSE max_male_attendees END,
      max_female_attendees = CASE WHEN p_payload ? 'max_female_attendees' THEN NULLIF(p_payload ->> 'max_female_attendees', '')::integer ELSE max_female_attendees END,
      max_nonbinary_attendees = CASE WHEN p_payload ? 'max_nonbinary_attendees' THEN NULLIF(p_payload ->> 'max_nonbinary_attendees', '')::integer ELSE max_nonbinary_attendees END,
      visibility = CASE WHEN p_payload ? 'visibility' THEN COALESCE(NULLIF(lower(p_payload ->> 'visibility'), ''), 'all') ELSE visibility END,
      is_free = CASE WHEN p_payload ? 'is_free' THEN COALESCE(NULLIF(p_payload ->> 'is_free', '')::boolean, true) ELSE is_free END,
      price_amount = CASE WHEN p_payload ? 'price_amount' THEN COALESCE(NULLIF(p_payload ->> 'price_amount', '')::numeric, 0) ELSE price_amount END,
      price_currency = CASE WHEN p_payload ? 'price_currency' THEN COALESCE(NULLIF(upper(p_payload ->> 'price_currency'), ''), 'EUR') ELSE price_currency END,
      scope = CASE WHEN p_payload ? 'scope' THEN COALESCE(NULLIF(lower(p_payload ->> 'scope'), ''), 'global') ELSE scope END,
      latitude = CASE WHEN p_payload ? 'latitude' THEN NULLIF(p_payload ->> 'latitude', '')::double precision ELSE latitude END,
      longitude = CASE WHEN p_payload ? 'longitude' THEN NULLIF(p_payload ->> 'longitude', '')::double precision ELSE longitude END,
      radius_km = CASE WHEN p_payload ? 'radius_km' THEN NULLIF(p_payload ->> 'radius_km', '')::integer ELSE radius_km END,
      city = CASE WHEN p_payload ? 'city' THEN NULLIF(p_payload ->> 'city', '') ELSE city END,
      country = CASE WHEN p_payload ? 'country' THEN NULLIF(p_payload ->> 'country', '') ELSE country END,
      location_name = CASE WHEN p_payload ? 'location_name' THEN NULLIF(p_payload ->> 'location_name', '') ELSE location_name END,
      is_location_specific = CASE WHEN p_payload ? 'is_location_specific' THEN COALESCE(NULLIF(p_payload ->> 'is_location_specific', '')::boolean, false) ELSE is_location_specific END,
      is_recurring = CASE WHEN p_payload ? 'is_recurring' THEN COALESCE(NULLIF(p_payload ->> 'is_recurring', '')::boolean, false) ELSE is_recurring END,
      recurrence_type = CASE WHEN p_payload ? 'recurrence_type' THEN NULLIF(p_payload ->> 'recurrence_type', '') ELSE recurrence_type END,
      recurrence_days = CASE WHEN p_payload ? 'recurrence_days' THEN public.admin_jsonb_int_array(p_payload -> 'recurrence_days') ELSE recurrence_days END,
      recurrence_count = CASE WHEN p_payload ? 'recurrence_count' THEN NULLIF(p_payload ->> 'recurrence_count', '')::integer ELSE recurrence_count END,
      recurrence_ends_at = CASE WHEN p_payload ? 'recurrence_ends_at' THEN NULLIF(p_payload ->> 'recurrence_ends_at', '')::timestamptz ELSE recurrence_ends_at END,
      updated_at = now()
  WHERE id = p_event_id
  RETURNING * INTO v_after;

  v_audit_id := public.log_admin_action(
    'event.update',
    'event',
    p_event_id,
    jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after))
  );

  v_response := public.admin_json_success(jsonb_build_object(
    'event_id', p_event_id,
    'event', to_jsonb(v_after),
    'audit_log_id', v_audit_id
  ));

  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_update_event', p_idempotency_key, v_response);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_create_event(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_event(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_event(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_event(uuid, jsonb, text) TO authenticated;

-- Finalize computed-ended rows even when a stale raw status is already 'ended'
-- but ended_at was never written.
CREATE OR REPLACE FUNCTION public.admin_end_event(
  p_event_id uuid,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_cached jsonb;
  v_before public.events%ROWTYPE;
  v_after public.events%ROWTYPE;
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_end_event', p_idempotency_key, jsonb_build_object('event_id', p_event_id, 'reason', p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_before FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.'); END IF;
  IF v_before.archived_at IS NOT NULL OR v_before.ended_at IS NOT NULL OR COALESCE(v_before.status, '') IN ('completed', 'cancelled') THEN
    RETURN public.admin_json_error('INVALID_TRANSITION', 'Event is archived or already terminal.', jsonb_build_object('status', v_before.status));
  END IF;

  UPDATE public.events
  SET status = 'ended',
      ended_at = now(),
      updated_at = now()
  WHERE id = p_event_id
  RETURNING * INTO v_after;

  v_audit_id := public.log_admin_action('event.end', 'event', p_event_id, jsonb_build_object('reason', p_reason, 'before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
  v_response := public.admin_json_success(jsonb_build_object('event_id', p_event_id, 'event', to_jsonb(v_after), 'audit_log_id', v_audit_id, 'broadcast_required', true));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_end_event', p_idempotency_key, v_response);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_end_event(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_end_event(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.admin_end_event(uuid, text, text) IS
  'Admin event lifecycle finalizer. Allows stale raw ended rows without ended_at to be finalized, while rejecting archived, completed, cancelled, and already-ended rows.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Audited attendee mutations
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_mark_event_attendance(
  p_event_id uuid,
  p_registration_ids uuid[],
  p_attended boolean,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_cached jsonb;
  v_target_count integer;
  v_updated integer;
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  v_cached := public.admin_idempotency_begin(
    v_admin_id,
    'admin_mark_event_attendance',
    p_idempotency_key,
    jsonb_build_object(
      'event_id', p_event_id,
      'registration_ids', p_registration_ids,
      'attended', p_attended,
      'reason', p_reason
    )
  );
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  IF p_event_id IS NULL OR p_registration_ids IS NULL OR cardinality(p_registration_ids) = 0 OR p_attended IS NULL THEN
    v_response := public.admin_json_error('VALIDATION_ERROR', 'Attendance mark request is invalid.');
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_event_attendance', p_idempotency_key, v_response);
  END IF;

  SELECT count(*)::integer
  INTO v_target_count
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.id = ANY(p_registration_ids);

  IF v_target_count <> cardinality(p_registration_ids) THEN
    v_response := public.admin_json_error(
      'VALIDATION_ERROR',
      'All registration ids must belong to the selected event.',
      jsonb_build_object('requested_count', cardinality(p_registration_ids), 'matched_count', v_target_count)
    );
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_event_attendance', p_idempotency_key, v_response);
  END IF;

  UPDATE public.event_registrations er
  SET attended = p_attended,
      attendance_marked = true,
      attendance_marked_at = now(),
      attendance_marked_by = v_admin_id
  WHERE er.event_id = p_event_id
    AND er.id = ANY(p_registration_ids);

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  v_audit_id := public.log_admin_action(
    'event_registration.mark_attendance',
    'event',
    p_event_id,
    jsonb_build_object(
      'registration_ids', p_registration_ids,
      'attended', p_attended,
      'affected_count', v_updated,
      'reason', p_reason
    )
  );

  v_response := public.admin_json_success(jsonb_build_object(
    'event_id', p_event_id,
    'affected_count', v_updated,
    'attended', p_attended,
    'audit_log_id', v_audit_id
  ));

  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_event_attendance', p_idempotency_key, v_response);
END;
$function$;

DROP FUNCTION IF EXISTS public.admin_remove_event_registration(uuid, uuid);

CREATE OR REPLACE FUNCTION public.admin_remove_event_registration(
  p_event_id uuid,
  p_profile_id uuid,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_cached jsonb;
  v_before public.event_registrations%ROWTYPE;
  v_deleted integer;
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  v_cached := public.admin_idempotency_begin(
    v_admin_id,
    'admin_remove_event_registration',
    p_idempotency_key,
    jsonb_build_object('event_id', p_event_id, 'profile_id', p_profile_id, 'reason', p_reason)
  );
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  IF p_event_id IS NULL OR p_profile_id IS NULL THEN
    v_response := public.admin_json_error('VALIDATION_ERROR', 'Registration removal request is invalid.');
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_remove_event_registration', p_idempotency_key, v_response);
  END IF;

  SELECT *
  INTO v_before
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = p_profile_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_response := public.admin_json_error('NOT_FOUND', 'Registration was not found.');
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_remove_event_registration', p_idempotency_key, v_response);
  END IF;

  DELETE FROM public.event_registrations er
  WHERE er.id = v_before.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  v_audit_id := public.log_admin_action(
    'event_registration.remove',
    'event_registration',
    v_before.id,
    jsonb_build_object(
      'event_id', p_event_id,
      'profile_id', p_profile_id,
      'registration', to_jsonb(v_before),
      'rows_deleted', v_deleted,
      'reason', p_reason
    )
  );

  v_response := public.admin_json_success(jsonb_build_object(
    'event_id', p_event_id,
    'profile_id', p_profile_id,
    'rows_deleted', v_deleted,
    'audit_log_id', v_audit_id
  ));

  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_remove_event_registration', p_idempotency_key, v_response);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_mark_event_attendance(uuid, uuid[], boolean, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_remove_event_registration(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_mark_event_attendance(uuid, uuid[], boolean, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_event_registration(uuid, uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.admin_mark_event_attendance(uuid, uuid[], boolean, text, text) IS
  'Admin-only audited attendance marking. Owns attended, attendance_marked, attendance_marked_at, and attendance_marked_by writes.';

COMMENT ON FUNCTION public.admin_remove_event_registration(uuid, uuid, text, text) IS
  'Admin-only audited registration removal. Keeps the original RPC name with optional reason and idempotency arguments.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Correct attendance metric semantics
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_get_event_metrics(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_event public.events%ROWTYPE;
  v_video_sessions integer;
  v_completed_sessions integer;
  v_registrations integer;
  v_confirmed integer;
  v_waitlisted integer;
  v_attended integer;
  v_attendance_marked integer;
  v_no_show integer;
  v_matches integer;
  v_participant_reports integer;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.'); END IF;

  SELECT count(*)::integer INTO v_video_sessions FROM public.video_sessions WHERE event_id = p_event_id;
  SELECT count(*)::integer INTO v_completed_sessions FROM public.video_sessions WHERE event_id = p_event_id AND ended_at IS NOT NULL;
  SELECT count(*)::integer INTO v_registrations FROM public.event_registrations WHERE event_id = p_event_id;
  SELECT count(*)::integer INTO v_confirmed FROM public.event_registrations WHERE event_id = p_event_id AND admission_status = 'confirmed';
  SELECT count(*)::integer INTO v_waitlisted FROM public.event_registrations WHERE event_id = p_event_id AND admission_status = 'waitlisted';
  SELECT count(*)::integer INTO v_attended FROM public.event_registrations WHERE event_id = p_event_id AND attended IS TRUE;
  SELECT count(*)::integer INTO v_attendance_marked FROM public.event_registrations WHERE event_id = p_event_id AND attendance_marked IS TRUE;
  SELECT count(*)::integer INTO v_no_show FROM public.event_registrations WHERE event_id = p_event_id AND attendance_marked IS TRUE AND attended IS NOT TRUE;
  SELECT count(*)::integer INTO v_matches FROM public.matches WHERE event_id = p_event_id;

  SELECT count(*)::integer
  INTO v_participant_reports
  FROM public.user_reports ur
  WHERE ur.created_at >= v_event.event_date - interval '1 day'
    AND ur.created_at <= v_event.event_date + make_interval(mins => COALESCE(v_event.duration_minutes, 60)) + interval '1 day'
    AND (
      ur.reporter_id IN (SELECT profile_id FROM public.event_registrations WHERE event_id = p_event_id)
      OR ur.reported_id IN (SELECT profile_id FROM public.event_registrations WHERE event_id = p_event_id)
    );

  RETURN public.admin_json_success(jsonb_build_object(
    'event_id', p_event_id,
    'video_sessions', v_video_sessions,
    'completed_video_sessions', v_completed_sessions,
    'registrations', v_registrations,
    'confirmed_registrations', v_confirmed,
    'waitlisted_registrations', v_waitlisted,
    'confirmed_attendance', v_attended,
    'attendance_marked_count', v_attendance_marked,
    'no_show_count', v_no_show,
    'persistent_matches', v_matches,
    'participant_reports_near_event_window', v_participant_reports,
    'report_scope', 'participant_reports_near_event_window'
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_event_metrics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_event_metrics(uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_get_event_metrics(uuid) IS
  'Admin event metrics read model. confirmed_attendance counts attended IS TRUE; reviewed/no-show totals are exposed separately.';
