-- Admin-managed event categories for discovery filters.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.event_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  emoji text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 1000,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_categories_key_format CHECK (key ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  CONSTRAINT event_categories_label_not_blank CHECK (btrim(label) <> ''),
  CONSTRAINT event_categories_emoji_not_blank CHECK (btrim(emoji) <> '')
);

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS category_keys text[] NOT NULL DEFAULT ARRAY[]::text[];

CREATE INDEX IF NOT EXISTS idx_events_category_keys_gin
  ON public.events USING gin (category_keys);

CREATE INDEX IF NOT EXISTS idx_event_categories_active_sort
  ON public.event_categories (active, sort_order, label);

ALTER TABLE public.event_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_categories_authenticated_select ON public.event_categories;
CREATE POLICY event_categories_authenticated_select
  ON public.event_categories
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON public.event_categories FROM PUBLIC, anon;
GRANT SELECT ON public.event_categories TO authenticated;

CREATE OR REPLACE FUNCTION public.event_category_slug(p_label text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, extensions, pg_catalog
AS $function$
  SELECT regexp_replace(
    regexp_replace(
      regexp_replace(unaccent(lower(btrim(COALESCE(p_label, '')))), '&', ' ', 'g'),
      '[^a-z0-9]+',
      '_',
      'g'
    ),
    '^_+|_+$',
    '',
    'g'
  );
$function$;

CREATE OR REPLACE FUNCTION public.event_category_keys_are_valid(p_keys text[])
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $function$
  SELECT COALESCE(
    (
      SELECT bool_and(k IS NOT NULL AND k <> '' AND EXISTS (
        SELECT 1 FROM public.event_categories ec WHERE ec.key = k
      ))
      FROM unnest(COALESCE(p_keys, ARRAY[]::text[])) AS keys(k)
    ),
    true
  );
$function$;

ALTER TABLE public.events
  DROP CONSTRAINT IF EXISTS events_category_keys_valid;
ALTER TABLE public.events
  ADD CONSTRAINT events_category_keys_valid
  CHECK (public.event_category_keys_are_valid(category_keys));

INSERT INTO public.event_categories (key, label, emoji, sort_order)
VALUES
  ('music_nightlife', 'Music & Nightlife', '🎵', 10),
  ('tech_startups', 'Tech & Startups', '💻', 20),
  ('art_creative', 'Art & Creative', '🎨', 30),
  ('gaming', 'Gaming', '🎮', 40),
  ('food_drink', 'Food & Drink', '🍷', 50),
  ('wellness_fitness', 'Wellness & Fitness', '💪', 60),
  ('outdoor_adventure', 'Outdoor & Adventure', '🌿', 70),
  ('travel', 'Travel', '✈️', 80),
  ('books_film', 'Books & Film', '📚', 90),
  ('social_mixer', 'Social Mixer', '🦋', 100),
  ('dating', 'Dating', '💕', 110),
  ('professional_networking', 'Professional Networking', '🤝', 120)
ON CONFLICT (key) DO UPDATE
SET label = EXCLUDED.label,
    emoji = EXCLUDED.emoji,
    sort_order = EXCLUDED.sort_order,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.infer_event_category_keys_from_legacy_tags(p_tags text[])
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $function$
  WITH normalized AS (
    SELECT public.event_category_slug(tag) AS token
    FROM unnest(COALESCE(p_tags, ARRAY[]::text[])) AS tags(tag)
  ),
  mapped AS (
    SELECT DISTINCT CASE
      WHEN token IN ('music', 'nightlife', 'techno', 'live_music', 'music_nightlife') THEN 'music_nightlife'
      WHEN token IN ('tech', 'technology', 'startups', 'founders') THEN 'tech_startups'
      WHEN token IN ('networking', 'young_professionals', 'professional_networking') THEN 'professional_networking'
      WHEN token IN ('art', 'artsy', 'creative', 'creatives') THEN 'art_creative'
      WHEN token IN ('gaming', 'games') THEN 'gaming'
      WHEN token IN ('food', 'foodie', 'foodies', 'brunch', 'wine', 'drink', 'drinks') THEN 'food_drink'
      WHEN token IN ('fitness', 'wellness', 'wellness_fitness') THEN 'wellness_fitness'
      WHEN token IN ('outdoor', 'outdoors', 'outdoorsy', 'adventure') THEN 'outdoor_adventure'
      WHEN token IN ('travel', 'traveler', 'travelers') THEN 'travel'
      WHEN token IN ('books', 'book', 'bookworm', 'film', 'movies') THEN 'books_film'
      WHEN token IN ('social', 'social_mixer', 'social_butterfly', 'casual', 'chill') THEN 'social_mixer'
      WHEN token IN ('dating', 'speed_dating', 'speed_date') THEN 'dating'
      ELSE NULL
    END AS key
    FROM normalized
  )
  SELECT COALESCE(array_agg(key ORDER BY key), ARRAY[]::text[])
  FROM mapped
  WHERE key IS NOT NULL;
$function$;

UPDATE public.events e
SET category_keys = inferred.keys
FROM (
  SELECT
    id,
    public.infer_event_category_keys_from_legacy_tags(tags) AS keys
  FROM public.events
) inferred
WHERE e.id = inferred.id
  AND COALESCE(array_length(e.category_keys, 1), 0) = 0
  AND COALESCE(array_length(inferred.keys, 1), 0) > 0;

CREATE OR REPLACE FUNCTION public.admin_create_event_category(
  p_label text,
  p_emoji text,
  p_sort_order integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_label text := NULLIF(btrim(COALESCE(p_label, '')), '');
  v_emoji text := NULLIF(btrim(COALESCE(p_emoji, '')), '');
  v_base_key text;
  v_key text;
  v_suffix integer := 1;
  v_category public.event_categories%ROWTYPE;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;
  IF v_label IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Category label is required.');
  END IF;
  IF v_emoji IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Category emoji is required.');
  END IF;

  v_base_key := public.event_category_slug(v_label);
  IF v_base_key IS NULL OR v_base_key = '' THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Category label must contain letters or numbers.');
  END IF;
  v_key := v_base_key;
  WHILE EXISTS (SELECT 1 FROM public.event_categories WHERE key = v_key) LOOP
    v_suffix := v_suffix + 1;
    v_key := v_base_key || '_' || v_suffix::text;
  END LOOP;

  INSERT INTO public.event_categories (key, label, emoji, active, sort_order, created_by, updated_by)
  VALUES (
    v_key,
    v_label,
    v_emoji,
    true,
    COALESCE(p_sort_order, (SELECT COALESCE(max(sort_order), 0) + 10 FROM public.event_categories)),
    v_admin_id,
    v_admin_id
  )
  RETURNING * INTO v_category;

  PERFORM public.log_admin_action(
    'event_category.create',
    'event_category',
    v_category.id,
    jsonb_build_object('category', to_jsonb(v_category))
  );

  RETURN public.admin_json_success(jsonb_build_object('category', to_jsonb(v_category)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_event_category(
  p_category_key text,
  p_label text DEFAULT NULL,
  p_emoji text DEFAULT NULL,
  p_active boolean DEFAULT NULL,
  p_sort_order integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_before public.event_categories%ROWTYPE;
  v_after public.event_categories%ROWTYPE;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;
  IF NULLIF(btrim(COALESCE(p_category_key, '')), '') IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Category key is required.');
  END IF;

  SELECT * INTO v_before
  FROM public.event_categories
  WHERE key = p_category_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Category was not found.');
  END IF;
  IF p_label IS NOT NULL AND NULLIF(btrim(p_label), '') IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Category label cannot be blank.');
  END IF;
  IF p_emoji IS NOT NULL AND NULLIF(btrim(p_emoji), '') IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Category emoji cannot be blank.');
  END IF;

  UPDATE public.event_categories
  SET label = CASE WHEN p_label IS NULL THEN label ELSE btrim(p_label) END,
      emoji = CASE WHEN p_emoji IS NULL THEN emoji ELSE btrim(p_emoji) END,
      active = COALESCE(p_active, active),
      sort_order = COALESCE(p_sort_order, sort_order),
      updated_by = v_admin_id,
      updated_at = now()
  WHERE key = p_category_key
  RETURNING * INTO v_after;

  PERFORM public.log_admin_action(
    'event_category.update',
    'event_category',
    v_after.id,
    jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after))
  );

  RETURN public.admin_json_success(jsonb_build_object('category', to_jsonb(v_after)));
END;
$function$;

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
    BEGIN PERFORM v_event_date_text::timestamptz;
    EXCEPTION WHEN others THEN v_errors := array_append(v_errors, 'event_date must be a valid timestamp');
    END;
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
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;

  v_validation := public.admin_validate_event_payload(p_payload, true);
  IF v_validation IS NOT NULL THEN RETURN v_validation; END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_create_event', p_idempotency_key, p_payload);
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  INSERT INTO public.events (
    title, description, cover_image, language, event_date, duration_minutes, max_attendees,
    tags, category_keys, status, vibes, max_male_attendees, max_female_attendees, max_nonbinary_attendees,
    visibility, is_free, price_amount, price_currency, scope, latitude, longitude, radius_km,
    city, country, location_name, is_location_specific, is_recurring, recurrence_type,
    recurrence_days, recurrence_count, recurrence_ends_at
  ) VALUES (
    NULLIF(btrim(p_payload ->> 'title'), ''),
    NULLIF(p_payload ->> 'description', ''),
    COALESCE(NULLIF(p_payload ->> 'cover_image', ''), '/placeholder.svg'),
    NULLIF(p_payload ->> 'language', ''),
    (p_payload ->> 'event_date')::timestamptz,
    COALESCE(NULLIF(p_payload ->> 'duration_minutes', '')::integer, 60),
    COALESCE(NULLIF(p_payload ->> 'max_attendees', '')::integer, 50),
    public.admin_jsonb_text_array(p_payload -> 'tags'),
    COALESCE(public.admin_jsonb_text_array(p_payload -> 'category_keys'), ARRAY[]::text[]),
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

  v_audit_id := public.log_admin_action('event.create', 'event', v_event.id, jsonb_build_object('event', to_jsonb(v_event)));
  v_response := public.admin_json_success(jsonb_build_object('event_id', v_event.id, 'event', to_jsonb(v_event), 'audit_log_id', v_audit_id));
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
  v_disallowed_finalized_keys text[];
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;
  IF p_event_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Event update request is invalid.'); END IF;

  SELECT * INTO v_before FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.'); END IF;

  IF v_before.ended_at IS NOT NULL
     OR lower(COALESCE(v_before.status, '')) IN ('ended', 'completed')
     OR (v_before.event_date IS NOT NULL AND now() >= v_before.event_date + COALESCE(v_before.duration_minutes, 60) * interval '1 minute') THEN
    SELECT array_agg(key ORDER BY key)
    INTO v_disallowed_finalized_keys
    FROM jsonb_object_keys(p_payload) AS keys(key)
    WHERE key NOT IN ('title', 'description', 'cover_image', 'language', 'tags', 'vibes', 'category_keys');

    IF COALESCE(array_length(v_disallowed_finalized_keys, 1), 0) > 0 THEN
      RETURN public.admin_json_error('INVALID_TRANSITION', 'Closed events only allow content corrections.', jsonb_build_object('disallowed_keys', v_disallowed_finalized_keys));
    END IF;
  END IF;

  v_effective := to_jsonb(v_before) || p_payload;
  IF p_payload ? 'scope' AND COALESCE(NULLIF(lower(p_payload ->> 'scope'), ''), 'global') <> 'local' THEN
    v_effective := jsonb_set(v_effective, '{is_location_specific}', 'false'::jsonb, true);
  END IF;

  v_validation := public.admin_validate_event_payload(v_effective, false);
  IF v_validation IS NOT NULL THEN RETURN v_validation; END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_update_event', p_idempotency_key, jsonb_build_object('event_id', p_event_id, 'payload', p_payload));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  UPDATE public.events
  SET title = CASE WHEN p_payload ? 'title' THEN NULLIF(btrim(p_payload ->> 'title'), '') ELSE title END,
      description = CASE WHEN p_payload ? 'description' THEN NULLIF(p_payload ->> 'description', '') ELSE description END,
      cover_image = CASE WHEN p_payload ? 'cover_image' THEN COALESCE(NULLIF(p_payload ->> 'cover_image', ''), cover_image) ELSE cover_image END,
      language = CASE WHEN p_payload ? 'language' THEN NULLIF(p_payload ->> 'language', '') ELSE language END,
      event_date = CASE WHEN p_payload ? 'event_date' THEN (p_payload ->> 'event_date')::timestamptz ELSE event_date END,
      duration_minutes = CASE WHEN p_payload ? 'duration_minutes' THEN COALESCE(NULLIF(p_payload ->> 'duration_minutes', '')::integer, 60) ELSE duration_minutes END,
      max_attendees = CASE WHEN p_payload ? 'max_attendees' THEN COALESCE(NULLIF(p_payload ->> 'max_attendees', '')::integer, 50) ELSE max_attendees END,
      tags = CASE WHEN p_payload ? 'tags' THEN public.admin_jsonb_text_array(p_payload -> 'tags') ELSE tags END,
      category_keys = CASE WHEN p_payload ? 'category_keys' THEN COALESCE(public.admin_jsonb_text_array(p_payload -> 'category_keys'), ARRAY[]::text[]) ELSE category_keys END,
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
      is_location_specific = CASE
        WHEN p_payload ? 'scope' AND COALESCE(NULLIF(lower(p_payload ->> 'scope'), ''), 'global') <> 'local' THEN false
        WHEN p_payload ? 'is_location_specific' THEN COALESCE(NULLIF(p_payload ->> 'is_location_specific', '')::boolean, false)
        ELSE is_location_specific
      END,
      is_recurring = CASE WHEN p_payload ? 'is_recurring' THEN COALESCE(NULLIF(p_payload ->> 'is_recurring', '')::boolean, false) ELSE is_recurring END,
      recurrence_type = CASE WHEN p_payload ? 'recurrence_type' THEN NULLIF(p_payload ->> 'recurrence_type', '') ELSE recurrence_type END,
      recurrence_days = CASE WHEN p_payload ? 'recurrence_days' THEN public.admin_jsonb_int_array(p_payload -> 'recurrence_days') ELSE recurrence_days END,
      recurrence_count = CASE WHEN p_payload ? 'recurrence_count' THEN NULLIF(p_payload ->> 'recurrence_count', '')::integer ELSE recurrence_count END,
      recurrence_ends_at = CASE WHEN p_payload ? 'recurrence_ends_at' THEN NULLIF(p_payload ->> 'recurrence_ends_at', '')::timestamptz ELSE recurrence_ends_at END,
      updated_at = now()
  WHERE id = p_event_id
  RETURNING * INTO v_after;

  v_audit_id := public.log_admin_action('event.update', 'event', p_event_id, jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after), 'idempotency_key', p_idempotency_key));
  v_response := jsonb_build_object('success', true, 'event_id', v_after.id, 'event', to_jsonb(v_after), 'audit_id', v_audit_id);
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_update_event', p_idempotency_key, v_response);
EXCEPTION WHEN others THEN
  RETURN public.admin_json_error('INTERNAL_ERROR', 'Failed to update event.', jsonb_build_object('sqlstate', SQLSTATE));
END;
$function$;

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
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;

  v_filters := CASE WHEN p_filters IS NULL OR p_filters = 'null'::jsonb THEN '{}'::jsonb ELSE p_filters END;
  IF jsonb_typeof(v_filters) <> 'object' THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Event filters must be a JSON object.'); END IF;
  IF v_filters ? 'show_archived' AND lower(COALESCE(v_filters ->> 'show_archived', '')) NOT IN ('true', 'false') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'show_archived filter must be boolean.');
  END IF;

  v_search := NULLIF(btrim(COALESCE(v_filters ->> 'search', '')), '');
  v_show_archived := lower(COALESCE(v_filters ->> 'show_archived', 'false')) = 'true';

  WITH filtered AS (
    SELECT e.*
    FROM public.events e
    WHERE (v_show_archived OR e.archived_at IS NULL)
      AND (v_search IS NULL OR position(lower(v_search) in lower(COALESCE(e.title, '') || ' ' || COALESCE(e.description, ''))) > 0)
  ),
  paged AS (
    SELECT f.*, count(*) OVER ()::integer AS total_count
    FROM filtered f
    ORDER BY f.event_date DESC, f.created_at DESC, f.id DESC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(paged) - 'total_count' ORDER BY paged.event_date DESC, paged.created_at DESC, paged.id DESC), '[]'::jsonb),
         COALESCE(max(paged.total_count), 0)
  INTO v_rows, v_total
  FROM paged;

  RETURN public.admin_json_success(jsonb_build_object('events', v_rows, 'total_count', v_total, 'limit', v_limit, 'offset', v_offset));
END;
$function$;

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
  v_is_admin boolean;
  v_can_city_browse boolean;
  v_profile_country text;
  v_profile_lat double precision;
  v_profile_lng double precision;
  v_user_lat_eff double precision;
  v_user_lng_eff double precision;
  v_browse_lat_eff double precision;
  v_browse_lng_eff double precision;
  v_effective_lat double precision;
  v_effective_lng double precision;
  v_browse_requested boolean;
  v_valid_user_coords boolean;
  v_valid_browse_coords boolean;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT p.country, public.profile_location_coord(p.location_data, 'lat'), public.profile_location_coord(p.location_data, 'lng')
  INTO v_profile_country, v_profile_lat, v_profile_lng
  FROM public.profiles p
  WHERE p.id = p_user_id;

  SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p_user_id AND ur.role = 'admin'::public.app_role)
  INTO v_is_admin;

  v_can_city_browse := COALESCE(v_is_admin, false) OR COALESCE(public._get_user_tier_capability_bool_unchecked(p_user_id, 'canCityBrowse'), false);
  v_browse_requested := p_browse_lat IS NOT NULL OR p_browse_lng IS NOT NULL;
  v_valid_user_coords := p_user_lat IS NOT NULL AND p_user_lng IS NOT NULL AND p_user_lat BETWEEN -90 AND 90 AND p_user_lng BETWEEN -180 AND 180;
  v_valid_browse_coords := p_browse_lat IS NOT NULL AND p_browse_lng IS NOT NULL AND p_browse_lat BETWEEN -90 AND 90 AND p_browse_lng BETWEEN -180 AND 180;

  IF NOT v_can_city_browse AND v_browse_requested THEN
    v_user_lat_eff := v_profile_lat;
    v_user_lng_eff := v_profile_lng;
  ELSE
    v_user_lat_eff := COALESCE(CASE WHEN v_valid_user_coords THEN p_user_lat ELSE NULL END, v_profile_lat);
    v_user_lng_eff := COALESCE(CASE WHEN v_valid_user_coords THEN p_user_lng ELSE NULL END, v_profile_lng);
  END IF;

  v_browse_lat_eff := CASE WHEN v_can_city_browse AND v_valid_browse_coords THEN p_browse_lat ELSE NULL END;
  v_browse_lng_eff := CASE WHEN v_can_city_browse AND v_valid_browse_coords THEN p_browse_lng ELSE NULL END;
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
      WHEN e.latitude IS NOT NULL AND e.longitude IS NOT NULL AND v_effective_lat IS NOT NULL AND v_effective_lng IS NOT NULL
      THEN public.haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
      ELSE NULL
    END AS distance_km,
    EXISTS (SELECT 1 FROM public.event_registrations er WHERE er.event_id = e.id AND er.profile_id = p_user_id) AS is_registered,
    CASE
      WHEN e.status = 'cancelled' THEN 'cancelled'
      WHEN e.status = 'draft' THEN 'draft'
      WHEN e.ended_at IS NOT NULL THEN 'ended'
      WHEN now() >= e.event_date AND now() < (e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute') THEN 'live'
      WHEN now() >= (e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute') THEN 'ended'
      ELSE 'upcoming'
    END AS computed_status,
    e.is_recurring, e.parent_event_id, e.occurrence_number, e.language
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
    SELECT jsonb_agg(jsonb_build_object('key', ec.key, 'label', ec.label, 'emoji', ec.emoji) ORDER BY ec.sort_order, ec.label) AS categories
    FROM public.event_categories ec
    WHERE ec.key = ANY(COALESCE(e.category_keys, ARRAY[]::text[]))
  ) cat ON true
  WHERE e.archived_at IS NULL
    AND e.status != 'draft'
    AND e.status IS DISTINCT FROM 'cancelled'
    AND COALESCE(e.is_recurring, false) = false
    AND public._user_can_access_event_visibility_unchecked(p_user_id, COALESCE(e.visibility, 'all'))
    AND now() <= COALESCE(e.ended_at, e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute') + interval '6 hours'
    AND (
      ds.discovery_scope = 'global'
      OR (
        ds.discovery_scope = 'regional'
        AND v_effective_lat IS NOT NULL
        AND v_effective_lng IS NOT NULL
        AND (e.country IS NULL OR e.country = v_profile_country OR v_can_city_browse)
      )
      OR (
        ds.discovery_scope = 'local'
        AND e.latitude IS NOT NULL
        AND e.longitude IS NOT NULL
        AND v_effective_lat IS NOT NULL
        AND v_effective_lng IS NOT NULL
        AND public.haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude) <= COALESCE(e.radius_km, 50)::double precision
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
        AND public.haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude) <= p_filter_radius_km
      )
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

REVOKE ALL ON FUNCTION public.event_category_slug(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_category_slug(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.event_category_keys_are_valid(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_category_keys_are_valid(text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.infer_event_category_keys_from_legacy_tags(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.infer_event_category_keys_from_legacy_tags(text[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_create_event_category(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_event_category(text, text, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_update_event_category(text, text, text, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_event_category(text, text, text, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_visible_events(uuid, double precision, double precision, boolean, double precision, double precision, double precision) TO authenticated, service_role;

COMMENT ON TABLE public.event_categories IS
  'Admin-managed user-facing event discovery categories. Emoji + label are displayed in admin, web, and native filters.';
COMMENT ON COLUMN public.events.category_keys IS
  'Canonical event discovery category keys. Legacy tags remain freeform and vibes remain personalization metadata.';
