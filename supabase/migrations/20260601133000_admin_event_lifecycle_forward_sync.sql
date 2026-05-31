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
  v_child_status text;
BEGIN
  SELECT * INTO v_parent
  FROM events
  WHERE id = p_parent_id
    AND is_recurring = true
    AND archived_at IS NULL
    AND lower(COALESCE(status, '')) NOT IN ('archived', 'cancelled');
  IF NOT FOUND THEN RETURN 0; END IF;

  v_child_status := CASE WHEN lower(COALESCE(v_parent.status, '')) = 'draft' THEN 'draft' ELSE 'upcoming' END;

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
      title, description, cover_image, language, event_date, duration_minutes, max_attendees,
      tags, category_keys, status, vibes, max_male_attendees, max_female_attendees, max_nonbinary_attendees,
      visibility, is_free, price_amount, price_currency,
      scope, latitude, longitude, radius_km, city, country, location_name, location_address,
      is_location_specific, is_test_event,
      parent_event_id, occurrence_number, is_recurring
    ) VALUES (
      v_parent.title, v_parent.description, v_parent.cover_image, v_parent.language, v_next_date,
      v_parent.duration_minutes, v_parent.max_attendees, v_parent.tags,
      COALESCE(v_parent.category_keys, ARRAY[]::text[]), v_child_status,
      v_parent.vibes, v_parent.max_male_attendees, v_parent.max_female_attendees, v_parent.max_nonbinary_attendees,
      v_parent.visibility, v_parent.is_free, v_parent.price_amount, v_parent.price_currency,
      v_parent.scope, v_parent.latitude, v_parent.longitude, v_parent.radius_km, v_parent.city, v_parent.country,
      v_parent.location_name, v_parent.location_address,
      COALESCE(v_parent.is_location_specific, false), COALESCE(v_parent.is_test_event, false),
      p_parent_id, v_occurrence, false
    );

    v_generated := v_generated + 1;
  END LOOP;

  RETURN v_generated;
END;
$$;

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
  v_disallowed_lifecycle_keys text[];
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;
  IF p_event_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Event update request is invalid.'); END IF;

  SELECT array_agg(key ORDER BY key)
  INTO v_disallowed_lifecycle_keys
  FROM unnest(ARRAY['archived_at', 'archived_by', 'ended_at', 'status']) AS disallowed(key)
  WHERE p_payload ? key;

  IF COALESCE(array_length(v_disallowed_lifecycle_keys, 1), 0) > 0 THEN
    RETURN public.admin_json_error(
      'INVALID_TRANSITION',
      'Event lifecycle fields must be changed through lifecycle admin actions.',
      jsonb_build_object('disallowed_keys', v_disallowed_lifecycle_keys)
    );
  END IF;

  SELECT * INTO v_before FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.'); END IF;

  IF v_before.ended_at IS NOT NULL
     OR v_before.archived_at IS NOT NULL
     OR lower(COALESCE(v_before.status, '')) = 'archived'
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

REVOKE ALL ON FUNCTION public.generate_recurring_events(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_event(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_update_event(uuid, jsonb, text) TO authenticated;
