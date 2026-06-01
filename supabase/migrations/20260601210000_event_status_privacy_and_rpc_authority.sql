-- Event status privacy and RPC authority hardening.
-- Draft rows must be private, and authenticated/admin clients must use audited
-- lifecycle RPCs instead of direct table writes.

UPDATE public.events
SET status = 'upcoming'
WHERE status IS NULL OR btrim(status) = '';

UPDATE public.events
SET status = lower(btrim(status))
WHERE status IS NOT NULL
  AND lower(btrim(status)) IN ('upcoming', 'live', 'ended', 'completed', 'cancelled', 'draft')
  AND status IS DISTINCT FROM lower(btrim(status));

ALTER TABLE public.events
  ALTER COLUMN status SET DEFAULT 'upcoming';

ALTER TABLE public.events
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE public.events ADD CONSTRAINT events_status_check
  CHECK (status IN ('upcoming', 'live', 'ended', 'completed', 'cancelled', 'draft'));

DROP POLICY IF EXISTS "Admins can create events" ON public.events;
DROP POLICY IF EXISTS "Admins can update events" ON public.events;
DROP POLICY IF EXISTS "Admins can delete events" ON public.events;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.events FROM anon, authenticated;

COMMENT ON TABLE public.events IS
  'Events are readable through RLS, but authenticated clients cannot write rows directly. Admin mutations must use audited SECURITY DEFINER RPCs.';

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
          AND ended_at IS NULL
          AND lower(status) IN ('upcoming', 'live')
        )
        OR (
          archived_at IS NULL
          AND lower(status) IN ('upcoming', 'live', 'cancelled', 'ended', 'completed')
          AND EXISTS (
            SELECT 1
            FROM public.event_registrations er
            WHERE er.event_id = events.id
              AND er.profile_id = auth.uid()
              AND er.admission_status IN ('confirmed', 'waitlisted')
          )
        )
      )
    )
  );

COMMENT ON POLICY "Anyone can view events" ON public.events IS
  'Public event reads exclude synthetic rows and expose only active upcoming/live rows for non-admins. Confirmed or waitlisted users can read explicit non-draft, non-archived lifecycle rows for cancellation/history access without exposing drafts.';

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
    NULLIF(btrim(p_payload ->> 'language'), ''),
    (p_payload ->> 'event_date')::timestamptz,
    COALESCE(NULLIF(btrim(p_payload ->> 'duration_minutes'), '')::integer, 60),
    COALESCE(NULLIF(btrim(p_payload ->> 'max_attendees'), '')::integer, 50),
    public.admin_jsonb_text_array(p_payload -> 'tags'),
    COALESCE(public.admin_jsonb_text_array(p_payload -> 'category_keys'), ARRAY[]::text[]),
    COALESCE(NULLIF(lower(btrim(p_payload ->> 'status')), ''), 'upcoming'),
    public.admin_jsonb_text_array(p_payload -> 'vibes'),
    NULLIF(btrim(p_payload ->> 'max_male_attendees'), '')::integer,
    NULLIF(btrim(p_payload ->> 'max_female_attendees'), '')::integer,
    NULLIF(btrim(p_payload ->> 'max_nonbinary_attendees'), '')::integer,
    COALESCE(NULLIF(lower(btrim(p_payload ->> 'visibility')), ''), 'all'),
    COALESCE(NULLIF(btrim(p_payload ->> 'is_free'), '')::boolean, true),
    COALESCE(NULLIF(btrim(p_payload ->> 'price_amount'), '')::numeric, 0),
    COALESCE(NULLIF(upper(btrim(p_payload ->> 'price_currency')), ''), 'EUR'),
    COALESCE(NULLIF(lower(btrim(p_payload ->> 'scope')), ''), 'global'),
    NULLIF(btrim(p_payload ->> 'latitude'), '')::double precision,
    NULLIF(btrim(p_payload ->> 'longitude'), '')::double precision,
    NULLIF(btrim(p_payload ->> 'radius_km'), '')::integer,
    NULLIF(btrim(p_payload ->> 'city'), ''),
    NULLIF(btrim(p_payload ->> 'country'), ''),
    NULLIF(btrim(p_payload ->> 'location_name'), ''),
    COALESCE(NULLIF(btrim(p_payload ->> 'is_location_specific'), '')::boolean, false),
    COALESCE(NULLIF(btrim(p_payload ->> 'is_recurring'), '')::boolean, false),
    NULLIF(btrim(p_payload ->> 'recurrence_type'), ''),
    public.admin_jsonb_int_array(p_payload -> 'recurrence_days'),
    NULLIF(btrim(p_payload ->> 'recurrence_count'), '')::integer,
    NULLIF(btrim(p_payload ->> 'recurrence_ends_at'), '')::timestamptz
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
  IF p_payload ? 'scope' AND COALESCE(NULLIF(lower(btrim(p_payload ->> 'scope')), ''), 'global') <> 'local' THEN
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
      language = CASE WHEN p_payload ? 'language' THEN NULLIF(btrim(p_payload ->> 'language'), '') ELSE language END,
      event_date = CASE WHEN p_payload ? 'event_date' THEN (p_payload ->> 'event_date')::timestamptz ELSE event_date END,
      duration_minutes = CASE WHEN p_payload ? 'duration_minutes' THEN COALESCE(NULLIF(btrim(p_payload ->> 'duration_minutes'), '')::integer, 60) ELSE duration_minutes END,
      max_attendees = CASE WHEN p_payload ? 'max_attendees' THEN COALESCE(NULLIF(btrim(p_payload ->> 'max_attendees'), '')::integer, 50) ELSE max_attendees END,
      tags = CASE WHEN p_payload ? 'tags' THEN public.admin_jsonb_text_array(p_payload -> 'tags') ELSE tags END,
      category_keys = CASE WHEN p_payload ? 'category_keys' THEN COALESCE(public.admin_jsonb_text_array(p_payload -> 'category_keys'), ARRAY[]::text[]) ELSE category_keys END,
      vibes = CASE WHEN p_payload ? 'vibes' THEN public.admin_jsonb_text_array(p_payload -> 'vibes') ELSE vibes END,
      max_male_attendees = CASE WHEN p_payload ? 'max_male_attendees' THEN NULLIF(btrim(p_payload ->> 'max_male_attendees'), '')::integer ELSE max_male_attendees END,
      max_female_attendees = CASE WHEN p_payload ? 'max_female_attendees' THEN NULLIF(btrim(p_payload ->> 'max_female_attendees'), '')::integer ELSE max_female_attendees END,
      max_nonbinary_attendees = CASE WHEN p_payload ? 'max_nonbinary_attendees' THEN NULLIF(btrim(p_payload ->> 'max_nonbinary_attendees'), '')::integer ELSE max_nonbinary_attendees END,
      visibility = CASE WHEN p_payload ? 'visibility' THEN COALESCE(NULLIF(lower(btrim(p_payload ->> 'visibility')), ''), 'all') ELSE visibility END,
      is_free = CASE WHEN p_payload ? 'is_free' THEN COALESCE(NULLIF(btrim(p_payload ->> 'is_free'), '')::boolean, true) ELSE is_free END,
      price_amount = CASE WHEN p_payload ? 'price_amount' THEN COALESCE(NULLIF(btrim(p_payload ->> 'price_amount'), '')::numeric, 0) ELSE price_amount END,
      price_currency = CASE WHEN p_payload ? 'price_currency' THEN COALESCE(NULLIF(upper(btrim(p_payload ->> 'price_currency')), ''), 'EUR') ELSE price_currency END,
      scope = CASE WHEN p_payload ? 'scope' THEN COALESCE(NULLIF(lower(btrim(p_payload ->> 'scope')), ''), 'global') ELSE scope END,
      latitude = CASE WHEN p_payload ? 'latitude' THEN NULLIF(btrim(p_payload ->> 'latitude'), '')::double precision ELSE latitude END,
      longitude = CASE WHEN p_payload ? 'longitude' THEN NULLIF(btrim(p_payload ->> 'longitude'), '')::double precision ELSE longitude END,
      radius_km = CASE WHEN p_payload ? 'radius_km' THEN NULLIF(btrim(p_payload ->> 'radius_km'), '')::integer ELSE radius_km END,
      city = CASE WHEN p_payload ? 'city' THEN NULLIF(btrim(p_payload ->> 'city'), '') ELSE city END,
      country = CASE WHEN p_payload ? 'country' THEN NULLIF(btrim(p_payload ->> 'country'), '') ELSE country END,
      location_name = CASE WHEN p_payload ? 'location_name' THEN NULLIF(btrim(p_payload ->> 'location_name'), '') ELSE location_name END,
      is_location_specific = CASE
        WHEN p_payload ? 'scope' AND COALESCE(NULLIF(lower(btrim(p_payload ->> 'scope')), ''), 'global') <> 'local' THEN false
        WHEN p_payload ? 'is_location_specific' THEN COALESCE(NULLIF(btrim(p_payload ->> 'is_location_specific'), '')::boolean, false)
        ELSE is_location_specific
      END,
      is_recurring = CASE WHEN p_payload ? 'is_recurring' THEN COALESCE(NULLIF(btrim(p_payload ->> 'is_recurring'), '')::boolean, false) ELSE is_recurring END,
      recurrence_type = CASE WHEN p_payload ? 'recurrence_type' THEN NULLIF(btrim(p_payload ->> 'recurrence_type'), '') ELSE recurrence_type END,
      recurrence_days = CASE WHEN p_payload ? 'recurrence_days' THEN public.admin_jsonb_int_array(p_payload -> 'recurrence_days') ELSE recurrence_days END,
      recurrence_count = CASE WHEN p_payload ? 'recurrence_count' THEN NULLIF(btrim(p_payload ->> 'recurrence_count'), '')::integer ELSE recurrence_count END,
      recurrence_ends_at = CASE WHEN p_payload ? 'recurrence_ends_at' THEN NULLIF(btrim(p_payload ->> 'recurrence_ends_at'), '')::timestamptz ELSE recurrence_ends_at END,
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

REVOKE ALL ON FUNCTION public.admin_create_event(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_update_event(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_create_event(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_event(uuid, jsonb, text) TO authenticated;

COMMENT ON FUNCTION public.admin_create_event(jsonb, text) IS
  'Admin-only audited event creation. Status/visibility/scope/currency and scalar text inputs are trimmed/normalized before insert; draft/upcoming are the only create lifecycle states.';
COMMENT ON FUNCTION public.admin_update_event(uuid, jsonb, text) IS
  'Admin-only audited event update. Lifecycle fields are rejected and scalar enum-like fields are trimmed/normalized before validation and persistence.';
