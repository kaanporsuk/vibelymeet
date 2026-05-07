-- Admin event legacy location-scope follow-up.
--
-- Migration class: schema-only RPC correction.
-- Intent: ensure full-object admin clients cannot preserve a stale
-- is_location_specific=true flag when moving an event to regional/global.

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

  IF p_payload ? 'scope'
     AND COALESCE(NULLIF(lower(p_payload ->> 'scope'), ''), 'global') <> 'local' THEN
    v_effective := jsonb_set(v_effective, '{is_location_specific}', 'false'::jsonb, true);
  END IF;

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

  v_audit_id := public.log_admin_action(
    'event.update',
    'event',
    p_event_id,
    jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after), 'idempotency_key', p_idempotency_key)
  );

  v_response := jsonb_build_object(
    'success', true,
    'event_id', v_after.id,
    'event', to_jsonb(v_after),
    'audit_id', v_audit_id
  );
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_update_event', p_idempotency_key, v_response);
EXCEPTION WHEN others THEN
  RETURN public.admin_json_error('INTERNAL_ERROR', 'Failed to update event.', jsonb_build_object('sqlstate', SQLSTATE));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_event(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_event(uuid, jsonb, text) TO authenticated;

COMMENT ON FUNCTION public.admin_update_event(uuid, jsonb, text) IS
  'Admin-owned event update mutation. Forces legacy location-specific state off whenever scope moves away from local.';

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507210000',
  'Admin event non-local scope legacy flag repair',
  'schema-only',
  'Replaces admin_update_event so regional/global updates force stale legacy is_location_specific=true payloads back to false before validation and persistence. No user data is rewritten.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
