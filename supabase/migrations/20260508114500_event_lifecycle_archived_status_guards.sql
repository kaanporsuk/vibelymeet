-- Event lifecycle archived-status guards.
--
-- Follow-up to 20260508103000_event_lifecycle_auto_finalization.
-- Some legacy/admin surfaces can represent archived rows with status = 'archived'
-- even when archived_at is absent. Re-apply the lifecycle functions with that raw
-- status treated as terminal/non-live everywhere scheduled-end logic runs.

ALTER TABLE public.admin_activity_logs
  ALTER COLUMN admin_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.finalize_due_events(
  p_limit integer DEFAULT 100,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_now timestamptz := COALESCE(p_now, now());
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_finalized_count integer := 0;
  v_event_ids jsonb := '[]'::jsonb;
BEGIN
  WITH candidates AS (
    SELECT
      e.id,
      e.title,
      e.status AS before_status,
      e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute' AS scheduled_end
    FROM public.events e
    WHERE e.archived_at IS NULL
      AND e.ended_at IS NULL
      AND e.event_date IS NOT NULL
      AND lower(COALESCE(e.status, 'upcoming')) NOT IN ('draft', 'cancelled', 'archived')
      AND e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute' + interval '10 minutes' <= v_now
    ORDER BY e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute' ASC, e.id ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.events e
    SET status = 'ended',
        ended_at = candidates.scheduled_end,
        updated_at = v_now
    FROM candidates
    WHERE e.id = candidates.id
    RETURNING
      e.id,
      candidates.title,
      candidates.before_status,
      e.status AS after_status,
      candidates.scheduled_end,
      e.ended_at
  ),
  audit AS (
    INSERT INTO public.admin_activity_logs (
      admin_id,
      action_type,
      target_type,
      target_id,
      details,
      created_at
    )
    SELECT
      NULL,
      'event.auto_finalize',
      'event',
      updated.id,
      jsonb_build_object(
        'actor_type', 'system',
        'source', 'finalize_due_events',
        'title', updated.title,
        'before_status', updated.before_status,
        'after_status', updated.after_status,
        'scheduled_end', updated.scheduled_end,
        'auto_finalize_at', updated.scheduled_end + interval '10 minutes',
        'ended_at', updated.ended_at,
        'grace_minutes', 10
      ),
      v_now
    FROM updated
    RETURNING id
  )
  SELECT
    count(*)::integer,
    COALESCE(jsonb_agg(updated.id ORDER BY updated.scheduled_end ASC, updated.id ASC), '[]'::jsonb)
  INTO v_finalized_count, v_event_ids
  FROM updated;

  RETURN jsonb_build_object(
    'success', true,
    'finalized_count', v_finalized_count,
    'event_ids', v_event_ids,
    'grace_minutes', 10
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_due_events(integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_due_events(integer, timestamptz) TO service_role;

COMMENT ON FUNCTION public.finalize_due_events(integer, timestamptz) IS
  'Cron-safe automatic event lifecycle finalizer. Writes ended_at at scheduled_end after a 10 minute operator grace and audits rows as system event.auto_finalize actions.';

DO $$
DECLARE
  v_job_id integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT jobid INTO v_job_id
    FROM cron.job
    WHERE jobname = 'event-lifecycle-auto-finalize'
    LIMIT 1;

    IF v_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
      'event-lifecycle-auto-finalize',
      '* * * * *',
      'SELECT public.finalize_due_events(100, now())'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'event-lifecycle-auto-finalize cron not scheduled: %', SQLERRM;
END $$;

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
  v_now timestamptz := now();
  v_scheduled_end timestamptz;
  v_end_at timestamptz;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_end_event', p_idempotency_key, jsonb_build_object('event_id', p_event_id, 'reason', p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_before FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.'); END IF;
  IF v_before.archived_at IS NOT NULL OR v_before.ended_at IS NOT NULL OR lower(COALESCE(v_before.status, '')) IN ('draft', 'cancelled', 'archived') THEN
    RETURN public.admin_json_error('INVALID_TRANSITION', 'Event is archived or already terminal.', jsonb_build_object('status', v_before.status));
  END IF;

  v_scheduled_end := CASE
    WHEN v_before.event_date IS NOT NULL
      THEN v_before.event_date + COALESCE(v_before.duration_minutes, 60) * interval '1 minute'
    ELSE NULL
  END;
  v_end_at := CASE
    WHEN v_scheduled_end IS NOT NULL AND v_now >= v_scheduled_end THEN v_scheduled_end
    ELSE v_now
  END;

  UPDATE public.events
  SET status = 'ended',
      ended_at = v_end_at,
      updated_at = v_now
  WHERE id = p_event_id
  RETURNING * INTO v_after;

  v_audit_id := public.log_admin_action(
    'event.end',
    'event',
    p_event_id,
    jsonb_build_object(
      'reason', p_reason,
      'before', to_jsonb(v_before),
      'after', to_jsonb(v_after),
      'scheduled_end', v_scheduled_end,
      'manual_end_at', v_now
    )
  );
  v_response := public.admin_json_success(jsonb_build_object('event_id', p_event_id, 'event', to_jsonb(v_after), 'audit_log_id', v_audit_id, 'broadcast_required', true));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_end_event', p_idempotency_key, v_response);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_extend_event(
  p_event_id uuid,
  p_minutes integer,
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
  v_now timestamptz := now();
  v_scheduled_end timestamptz;
  v_extended_end timestamptz;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;
  IF p_minutes IS NULL OR p_minutes < 1 OR p_minutes > 180 THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Extension minutes must be between 1 and 180.'); END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_extend_event', p_idempotency_key, jsonb_build_object('event_id', p_event_id, 'minutes', p_minutes, 'reason', p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_before FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.'); END IF;
  IF v_before.archived_at IS NOT NULL OR v_before.ended_at IS NOT NULL OR lower(COALESCE(v_before.status, '')) IN ('draft', 'completed', 'cancelled', 'archived') THEN
    RETURN public.admin_json_error('INVALID_TRANSITION', 'Event cannot be extended from its current state.', jsonb_build_object('status', v_before.status));
  END IF;
  IF v_before.event_date IS NULL THEN
    RETURN public.admin_json_error('INVALID_TRANSITION', 'Event cannot be extended without a scheduled start.');
  END IF;

  v_scheduled_end := v_before.event_date + COALESCE(v_before.duration_minutes, 60) * interval '1 minute';
  IF v_now >= v_scheduled_end + interval '10 minutes' THEN
    RETURN public.admin_json_error(
      'INVALID_TRANSITION',
      'Event can only be extended during its live window or 10 minute finalization grace.',
      jsonb_build_object('scheduled_end', v_scheduled_end, 'auto_finalize_at', v_scheduled_end + interval '10 minutes')
    );
  END IF;

  v_extended_end := v_scheduled_end + p_minutes * interval '1 minute';
  IF v_extended_end <= v_now THEN
    RETURN public.admin_json_error(
      'INVALID_TRANSITION',
      'Extension must move the scheduled event end into the future.',
      jsonb_build_object(
        'scheduled_end_before', v_scheduled_end,
        'scheduled_end_after', v_extended_end,
        'now', v_now
      )
    );
  END IF;

  UPDATE public.events
  SET duration_minutes = COALESCE(duration_minutes, 60) + p_minutes,
      status = CASE
        WHEN v_now >= event_date AND v_now < v_extended_end THEN 'live'
        ELSE status
      END,
      updated_at = v_now
  WHERE id = p_event_id
  RETURNING * INTO v_after;

  v_audit_id := public.log_admin_action(
    'event.extend',
    'event',
    p_event_id,
    jsonb_build_object(
      'reason', p_reason,
      'minutes', p_minutes,
      'before', to_jsonb(v_before),
      'after', to_jsonb(v_after),
      'scheduled_end_before', v_scheduled_end,
      'scheduled_end_after', v_extended_end,
      'grace_minutes', 10
    )
  );
  v_response := public.admin_json_success(jsonb_build_object('event_id', p_event_id, 'event', to_jsonb(v_after), 'audit_log_id', v_audit_id));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_extend_event', p_idempotency_key, v_response);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_send_event_reminder(
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
  v_event public.events%ROWTYPE;
  v_audit_id uuid;
  v_response jsonb;
  v_scheduled_end timestamptz;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_send_event_reminder', p_idempotency_key, jsonb_build_object('event_id', p_event_id, 'reason', p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.'); END IF;
  IF v_event.archived_at IS NOT NULL OR v_event.ended_at IS NOT NULL OR lower(COALESCE(v_event.status, '')) IN ('draft', 'cancelled', 'archived') THEN
    RETURN public.admin_json_error('INVALID_TRANSITION', 'Reminders cannot be sent for archived or terminal events.');
  END IF;
  IF v_event.event_date IS NULL THEN
    RETURN public.admin_json_error('INVALID_TRANSITION', 'Reminders cannot be sent for unscheduled events.');
  END IF;

  v_scheduled_end := v_event.event_date + COALESCE(v_event.duration_minutes, 60) * interval '1 minute';
  IF now() >= v_scheduled_end THEN
    RETURN public.admin_json_error(
      'INVALID_TRANSITION',
      'Reminders cannot be sent after the scheduled event end.',
      jsonb_build_object('scheduled_end', v_scheduled_end)
    );
  END IF;

  v_audit_id := public.log_admin_action('event.reminder_requested', 'event', p_event_id, jsonb_build_object('reason', p_reason, 'notifications_not_queued', true));
  v_response := public.admin_json_success(jsonb_build_object('event_id', p_event_id, 'audit_log_id', v_audit_id, 'notifications_not_queued', true));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_send_event_reminder', p_idempotency_key, v_response);
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

  IF v_before.ended_at IS NOT NULL
     OR v_before.archived_at IS NOT NULL
     OR lower(COALESCE(v_before.status, '')) = 'archived'
     OR lower(COALESCE(v_before.status, '')) IN ('ended', 'completed')
     OR (
       v_before.event_date IS NOT NULL
       AND now() >= v_before.event_date + COALESCE(v_before.duration_minutes, 60) * interval '1 minute'
     ) THEN
    SELECT array_agg(key ORDER BY key)
    INTO v_disallowed_finalized_keys
    FROM jsonb_object_keys(p_payload) AS keys(key)
    WHERE key NOT IN ('title', 'description', 'cover_image', 'language', 'tags', 'vibes');

    IF COALESCE(array_length(v_disallowed_finalized_keys, 1), 0) > 0 THEN
      RETURN public.admin_json_error(
        'INVALID_TRANSITION',
        'Closed events only allow content corrections.',
        jsonb_build_object('disallowed_keys', v_disallowed_finalized_keys)
      );
    END IF;
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

CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_visibility text;
  v_max_attendees integer;
  v_current_attendees integer;
  v_status text;
  v_archived_at timestamptz;
  v_ended_at timestamptz;
  v_event_date timestamptz;
  v_duration_minutes integer;
  v_already boolean;
  v_monthly_limit integer;
  v_monthly_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT e.visibility, e.max_attendees, e.current_attendees, e.status, e.archived_at, e.ended_at, e.event_date, e.duration_minutes
  INTO v_visibility, v_max_attendees, v_current_attendees, v_status, v_archived_at, v_ended_at, v_event_date, v_duration_minutes
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_archived_at IS NOT NULL
     OR v_ended_at IS NOT NULL
     OR v_event_date IS NULL
     OR lower(COALESCE(v_status, '')) IN ('draft', 'cancelled', 'archived')
     OR now() >= v_event_date + COALESCE(v_duration_minutes, 60) * interval '1 minute' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event not found or not open for registration');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.event_registrations er
    WHERE er.event_id = p_event_id AND er.profile_id = v_user_id
  ) INTO v_already;

  IF v_already THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already registered');
  END IF;

  IF v_max_attendees IS NOT NULL
     AND v_current_attendees IS NOT NULL
     AND v_current_attendees >= v_max_attendees THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event is full');
  END IF;

  IF NOT public._user_can_access_event_visibility_unchecked(v_user_id, COALESCE(v_visibility, 'all')) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', CASE WHEN v_visibility = 'vip' THEN 'This event requires a VIP subscription' ELSE 'This event requires a Premium subscription' END,
      'code', 'TIER_MISMATCH'
    );
  END IF;

  v_monthly_limit := public._get_user_tier_capability_int_unchecked(v_user_id, 'monthlyEventJoins');
  IF v_monthly_limit IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext('monthlyEventJoins'));
    v_monthly_count := public._user_monthly_event_join_count_unchecked(v_user_id);
    IF v_monthly_count >= v_monthly_limit THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Monthly event join limit reached',
        'code', 'MONTHLY_EVENT_JOIN_LIMIT_REACHED',
        'limit', v_monthly_limit
      );
    END IF;
  END IF;

  INSERT INTO public.event_registrations (event_id, profile_id, admission_status, payment_status)
  VALUES (p_event_id, v_user_id, 'confirmed', 'free');

  RETURN jsonb_build_object('success', true, 'admission_status', 'confirmed');
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already registered');
END;
$function$;

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
  v_visibility text;
  v_max int;
  v_current int;
  v_status text;
  v_archived timestamptz;
  v_ended_at timestamptz;
  v_event_date timestamptz;
  v_duration_minutes integer;
  v_reg record;
  v_full boolean;
  v_result jsonb;
  v_monthly_limit integer;
  v_monthly_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden', 'code', 'FORBIDDEN');
  END IF;

  IF p_checkout_session_id IS NULL OR p_profile_id IS NULL OR p_event_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_args', 'code', 'INVALID_ARGS');
  END IF;

  SELECT outcome, result
  INTO v_existing
  FROM public.stripe_event_ticket_settlements
  WHERE checkout_session_id = p_checkout_session_id;

  IF FOUND AND v_existing.outcome IS DISTINCT FROM 'in_progress' THEN
    RETURN v_existing.result || jsonb_build_object('idempotent', true, 'outcome', v_existing.outcome);
  END IF;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.stripe_event_ticket_settlements (checkout_session_id, profile_id, event_id, outcome, result)
      VALUES (p_checkout_session_id, p_profile_id, p_event_id, 'in_progress', '{}'::jsonb);
    EXCEPTION
      WHEN unique_violation THEN
        SELECT outcome, result INTO v_existing
        FROM public.stripe_event_ticket_settlements
        WHERE checkout_session_id = p_checkout_session_id;
        IF FOUND AND v_existing.outcome IS DISTINCT FROM 'in_progress' THEN
          RETURN v_existing.result || jsonb_build_object('idempotent', true);
        END IF;
    END;
  END IF;

  SELECT e.visibility, e.max_attendees, e.current_attendees, e.status, e.archived_at, e.ended_at, e.event_date, e.duration_minutes
  INTO v_visibility, v_max, v_current, v_status, v_archived, v_ended_at, v_event_date, v_duration_minutes
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND OR v_archived IS NOT NULL
     OR v_ended_at IS NOT NULL
     OR v_event_date IS NULL
     OR lower(COALESCE(v_status, '')) IN ('draft', 'cancelled', 'archived')
     OR now() >= v_event_date + COALESCE(v_duration_minutes, 60) * interval '1 minute' THEN
    v_result := jsonb_build_object(
      'success', false,
      'admission_status', null,
      'error', 'event_not_admissible',
      'code', 'EVENT_CLOSED'
    );
    UPDATE public.stripe_event_ticket_settlements
    SET outcome = 'rejected_event', result = v_result
    WHERE checkout_session_id = p_checkout_session_id;
    RETURN v_result;
  END IF;

  IF NOT public._user_can_access_event_visibility_unchecked(p_profile_id, COALESCE(v_visibility, 'all')) THEN
    v_result := jsonb_build_object(
      'success', false,
      'error', CASE WHEN v_visibility = 'vip' THEN 'tier_mismatch_vip' ELSE 'tier_mismatch_premium' END,
      'code', 'TIER_MISMATCH'
    );
    UPDATE public.stripe_event_ticket_settlements SET outcome = 'rejected_tier', result = v_result
    WHERE checkout_session_id = p_checkout_session_id;
    RETURN v_result;
  END IF;

  SELECT * INTO v_reg
  FROM public.event_registrations
  WHERE event_id = p_event_id AND profile_id = p_profile_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_reg.admission_status = 'confirmed' THEN
      IF v_reg.payment_status IS DISTINCT FROM 'paid' THEN
        UPDATE public.event_registrations
        SET payment_status = 'paid'
        WHERE event_id = p_event_id AND profile_id = p_profile_id;
      END IF;
      v_result := jsonb_build_object(
        'success', true,
        'admission_status', 'confirmed',
        'code', 'ALREADY_CONFIRMED'
      );
      UPDATE public.stripe_event_ticket_settlements SET outcome = 'noop_already_confirmed', result = v_result
      WHERE checkout_session_id = p_checkout_session_id;
      RETURN v_result;
    END IF;

    IF v_reg.admission_status = 'waitlisted' THEN
      UPDATE public.event_registrations
      SET payment_status = 'paid'
      WHERE event_id = p_event_id AND profile_id = p_profile_id;

      v_full := (v_max IS NOT NULL AND v_current IS NOT NULL AND v_current >= v_max);
      IF NOT v_full THEN
        UPDATE public.event_registrations
        SET admission_status = 'confirmed'
        WHERE event_id = p_event_id AND profile_id = p_profile_id;
        v_result := jsonb_build_object(
          'success', true,
          'admission_status', 'confirmed',
          'code', 'PROMOTED_FROM_WAITLIST'
        );
        UPDATE public.stripe_event_ticket_settlements SET outcome = 'promoted_waitlist', result = v_result
        WHERE checkout_session_id = p_checkout_session_id;
        RETURN v_result;
      END IF;

      v_result := jsonb_build_object(
        'success', true,
        'admission_status', 'waitlisted',
        'code', 'STILL_WAITLISTED'
      );
      UPDATE public.stripe_event_ticket_settlements SET outcome = 'waitlisted_existing', result = v_result
      WHERE checkout_session_id = p_checkout_session_id;
      RETURN v_result;
    END IF;

    v_result := jsonb_build_object(
      'success', false,
      'error', 'existing_registration_state',
      'code', 'CONFLICT'
    );
    UPDATE public.stripe_event_ticket_settlements SET outcome = 'rejected_conflict', result = v_result
    WHERE checkout_session_id = p_checkout_session_id;
    RETURN v_result;
  END IF;

  v_monthly_limit := public._get_user_tier_capability_int_unchecked(p_profile_id, 'monthlyEventJoins');
  IF v_monthly_limit IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_profile_id::text), hashtext('monthlyEventJoins'));
    v_monthly_count := public._user_monthly_event_join_count_unchecked(p_profile_id);
    IF v_monthly_count >= v_monthly_limit THEN
      v_result := jsonb_build_object(
        'success', false,
        'error', 'monthly_event_join_limit_reached',
        'code', 'MONTHLY_EVENT_JOIN_LIMIT_REACHED',
        'limit', v_monthly_limit
      );
      UPDATE public.stripe_event_ticket_settlements SET outcome = 'rejected_monthly_limit', result = v_result
      WHERE checkout_session_id = p_checkout_session_id;
      RETURN v_result;
    END IF;
  END IF;

  v_full := (v_max IS NOT NULL AND v_current IS NOT NULL AND v_current >= v_max);

  IF v_full THEN
    INSERT INTO public.event_registrations (
      event_id, profile_id, admission_status, payment_status
    ) VALUES (
      p_event_id, p_profile_id, 'waitlisted', 'paid'
    );
    v_result := jsonb_build_object(
      'success', true,
      'admission_status', 'waitlisted',
      'code', 'PAID_WAITLIST'
    );
  ELSE
    INSERT INTO public.event_registrations (
      event_id, profile_id, admission_status, payment_status
    ) VALUES (
      p_event_id, p_profile_id, 'confirmed', 'paid'
    );
    v_result := jsonb_build_object(
      'success', true,
      'admission_status', 'confirmed',
      'code', 'CONFIRMED'
    );
  END IF;

  UPDATE public.stripe_event_ticket_settlements
  SET outcome = v_result->>'admission_status',
      result = v_result
  WHERE checkout_session_id = p_checkout_session_id;

  RETURN v_result;
EXCEPTION
  WHEN unique_violation THEN
    v_result := jsonb_build_object('success', false, 'error', 'already_registered', 'code', 'UNIQUE');
    UPDATE public.stripe_event_ticket_settlements
    SET outcome = 'rejected_unique', result = v_result
    WHERE checkout_session_id = p_checkout_session_id;
    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_go_live_event(
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
  v_now timestamptz := now();
  v_scheduled_end timestamptz;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_go_live_event', p_idempotency_key, jsonb_build_object('event_id', p_event_id, 'reason', p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_before FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.'); END IF;
  IF v_before.archived_at IS NOT NULL OR v_before.ended_at IS NOT NULL OR lower(COALESCE(v_before.status, '')) IN ('draft', 'cancelled', 'completed', 'archived') THEN
    RETURN public.admin_json_error('INVALID_TRANSITION', 'Event cannot go live from its current state.', jsonb_build_object('status', v_before.status));
  END IF;
  IF v_before.event_date IS NULL THEN
    RETURN public.admin_json_error('INVALID_TRANSITION', 'Event cannot go live without a scheduled start.');
  END IF;

  v_scheduled_end := v_before.event_date + COALESCE(v_before.duration_minutes, 60) * interval '1 minute';
  IF v_now < v_before.event_date OR v_now >= v_scheduled_end THEN
    RETURN public.admin_json_error(
      'INVALID_TRANSITION',
      'Event can only be marked live during its scheduled event window.',
      jsonb_build_object('scheduled_end', v_scheduled_end)
    );
  END IF;

  UPDATE public.events
  SET status = 'live',
      updated_at = v_now
  WHERE id = p_event_id
  RETURNING * INTO v_after;

  v_audit_id := public.log_admin_action(
    'event.go_live',
    'event',
    p_event_id,
    jsonb_build_object(
      'reason', p_reason,
      'before', to_jsonb(v_before),
      'after', to_jsonb(v_after),
      'scheduled_end', v_scheduled_end,
      'notifications_not_queued', true
    )
  );
  v_response := public.admin_json_success(jsonb_build_object('event_id', p_event_id, 'event', to_jsonb(v_after), 'audit_log_id', v_audit_id, 'notifications_not_queued', true));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_go_live_event', p_idempotency_key, v_response);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_cancel_event(
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
  v_scheduled_end timestamptz;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_cancel_event', p_idempotency_key, jsonb_build_object('event_id', p_event_id, 'reason', p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_before FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.'); END IF;
  IF v_before.archived_at IS NOT NULL OR v_before.ended_at IS NOT NULL OR lower(COALESCE(v_before.status, '')) IN ('cancelled', 'completed', 'archived') THEN
    RETURN public.admin_json_error('INVALID_TRANSITION', 'Event is archived or already terminal.', jsonb_build_object('status', v_before.status));
  END IF;

  IF v_before.event_date IS NOT NULL THEN
    v_scheduled_end := v_before.event_date + COALESCE(v_before.duration_minutes, 60) * interval '1 minute';
    IF now() >= v_scheduled_end THEN
      RETURN public.admin_json_error(
        'INVALID_TRANSITION',
        'Events cannot be cancelled after their scheduled end.',
        jsonb_build_object('scheduled_end', v_scheduled_end)
      );
    END IF;
  END IF;

  UPDATE public.events
  SET status = 'cancelled',
      updated_at = now()
  WHERE id = p_event_id
  RETURNING * INTO v_after;

  v_audit_id := public.log_admin_action(
    'event.cancel',
    'event',
    p_event_id,
    jsonb_build_object(
      'reason', p_reason,
      'before', to_jsonb(v_before),
      'after', to_jsonb(v_after),
      'scheduled_end', v_scheduled_end,
      'notifications_not_queued', true
    )
  );
  v_response := public.admin_json_success(jsonb_build_object('event_id', p_event_id, 'event', to_jsonb(v_after), 'audit_log_id', v_audit_id, 'notifications_not_queued', true));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_cancel_event', p_idempotency_key, v_response);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_end_event(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_extend_event(uuid, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_go_live_event(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cancel_event(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_send_event_reminder(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_event(uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_for_event(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_event_ticket_checkout(text, uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_end_event(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_extend_event(uuid, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_go_live_event(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_event(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_send_event_reminder(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_event(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_event_ticket_checkout(text, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_overview_dashboard(p_now timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_now timestamptz := COALESCE(p_now, now());
  v_today_start timestamptz;
  v_window_start timestamptz;
  v_stats jsonb;
  v_quick_actions jsonb;
  v_daily_drop jsonb;
  v_user_growth jsonb;
  v_match_trends jsonb;
  v_event_fill_rows jsonb;
  v_gender_distribution jsonb;
  v_possible_test_event_rows integer;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;

  v_today_start := date_trunc('day', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_window_start := v_today_start - interval '29 days';

  WITH event_lifecycle AS (
    SELECT
      e.*,
      e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute' AS scheduled_end,
      e.event_date + COALESCE(e.duration_minutes, 60) * interval '1 minute' + interval '10 minutes' AS auto_finalize_at
    FROM public.events e
  )
  SELECT jsonb_build_object(
    'total_users', (SELECT count(*)::integer FROM public.profiles),
    'today_users', (SELECT count(*)::integer FROM public.profiles WHERE created_at >= v_today_start),
    'total_matches', (SELECT count(*)::integer FROM public.matches),
    'total_messages', (SELECT count(*)::integer FROM public.messages),
    'verified_users', (SELECT count(*)::integer FROM public.profiles WHERE photo_verified IS TRUE),
    'matches_per_user', (
      SELECT CASE
        WHEN count_profiles.total_users > 0
          THEN round(((SELECT count(*)::numeric FROM public.matches) / count_profiles.total_users::numeric), 2)
        ELSE 0
      END
      FROM (SELECT count(*)::integer AS total_users FROM public.profiles) count_profiles
    ),
    'events', jsonb_build_object(
      'total', count(*)::integer,
      'live', count(*) FILTER (
        WHERE archived_at IS NULL
          AND ended_at IS NULL
          AND lower(COALESCE(status, 'upcoming')) NOT IN ('draft', 'cancelled', 'archived')
          AND event_date IS NOT NULL
          AND v_now >= event_date
          AND v_now < scheduled_end
      )::integer,
      'upcoming', count(*) FILTER (
        WHERE archived_at IS NULL
          AND ended_at IS NULL
          AND lower(COALESCE(status, 'upcoming')) NOT IN ('draft', 'cancelled', 'archived')
          AND event_date IS NOT NULL
          AND v_now < event_date
      )::integer,
      'wrap_up_grace', count(*) FILTER (
        WHERE archived_at IS NULL
          AND ended_at IS NULL
          AND lower(COALESCE(status, 'upcoming')) NOT IN ('draft', 'cancelled', 'archived')
          AND event_date IS NOT NULL
          AND v_now >= scheduled_end
          AND v_now < auto_finalize_at
      )::integer,
      'needs_finalization_repair', count(*) FILTER (
        WHERE archived_at IS NULL
          AND ended_at IS NULL
          AND lower(COALESCE(status, 'upcoming')) NOT IN ('draft', 'cancelled', 'archived')
          AND event_date IS NOT NULL
          AND v_now >= auto_finalize_at
      )::integer,
      'draft', count(*) FILTER (WHERE status = 'draft')::integer,
      'cancelled', count(*) FILTER (WHERE status = 'cancelled')::integer,
      'archived', count(*) FILTER (WHERE archived_at IS NOT NULL OR lower(COALESCE(status, '')) = 'archived')::integer,
      'ended', count(*) FILTER (
        WHERE ended_at IS NOT NULL
           OR lower(COALESCE(status, '')) = 'completed'
           OR (
             archived_at IS NULL
             AND lower(COALESCE(status, 'upcoming')) NOT IN ('draft', 'cancelled', 'archived')
             AND event_date IS NOT NULL
             AND v_now >= scheduled_end
           )
      )::integer
    )
  ) INTO v_stats
  FROM event_lifecycle;

  WITH actionable AS (
    SELECT
      id,
      title,
      event_date,
      status,
      current_attendees,
      max_attendees
    FROM public.events
    WHERE event_date >= v_now
      AND archived_at IS NULL
      AND ended_at IS NULL
      AND lower(COALESCE(status, 'upcoming')) NOT IN ('draft', 'cancelled', 'archived')
      AND v_now < event_date + COALESCE(duration_minutes, 60) * interval '1 minute'
    ORDER BY event_date ASC
  ),
  preview AS (
    SELECT * FROM actionable LIMIT 3
  )
  SELECT jsonb_build_object(
    'pending_reports_count', (SELECT count(*)::integer FROM public.user_reports WHERE status = 'pending'),
    'new_users_today_count', (SELECT count(*)::integer FROM public.profiles WHERE created_at >= v_today_start),
    'actionable_upcoming_events', jsonb_build_object(
      'count', (SELECT count(*)::integer FROM actionable),
      'rows', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', id,
            'title', title,
            'event_date', event_date,
            'status', status,
            'current_attendees', current_attendees,
            'max_attendees', max_attendees
          )
          ORDER BY event_date ASC
        )
        FROM preview
      ), '[]'::jsonb)
    )
  ) INTO v_quick_actions;

  WITH last_run AS (
    SELECT
      id,
      run_started_at,
      run_finished_at,
      status,
      source,
      force,
      pairs_created,
      users_notified,
      unpaired_users,
      reason,
      error
    FROM public.daily_drop_generation_runs
    ORDER BY run_started_at DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'today_pairs', (
      SELECT count(*)::integer
      FROM public.daily_drops
      WHERE drop_date = (v_today_start AT TIME ZONE 'UTC')::date
    ),
    'today_date_utc', ((v_today_start AT TIME ZONE 'UTC')::date)::text,
    'last_generated_at', (SELECT max(starts_at) FROM public.daily_drops),
    'last_run', (
      SELECT jsonb_build_object(
        'id', id,
        'started_at', run_started_at,
        'finished_at', run_finished_at,
        'status', status,
        'source', source,
        'force', force,
        'pairs_created', pairs_created,
        'users_notified', users_notified,
        'unpaired_users', unpaired_users,
        'reason', reason,
        'error', error
      )
      FROM last_run
    )
  ) INTO v_daily_drop;

  WITH days AS (
    SELECT generate_series(v_window_start, v_today_start, interval '1 day') AS day_start
  ),
  counted AS (
    SELECT
      days.day_start,
      count(profiles.id)::integer AS users
    FROM days
    LEFT JOIN public.profiles
      ON profiles.created_at >= days.day_start
     AND profiles.created_at < days.day_start + interval '1 day'
    GROUP BY days.day_start
    ORDER BY days.day_start ASC
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'day', (day_start AT TIME ZONE 'UTC')::date::text,
      'date', to_char(day_start, 'Mon FMDD'),
      'users', users
    )
    ORDER BY day_start ASC
  ), '[]'::jsonb)
  INTO v_user_growth
  FROM counted;

  WITH days AS (
    SELECT generate_series(v_window_start, v_today_start, interval '1 day') AS day_start
  ),
  counted AS (
    SELECT
      days.day_start,
      count(matches.id)::integer AS matches
    FROM days
    LEFT JOIN public.matches
      ON matches.matched_at >= days.day_start
     AND matches.matched_at < days.day_start + interval '1 day'
    GROUP BY days.day_start
    ORDER BY days.day_start ASC
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'day', (day_start AT TIME ZONE 'UTC')::date::text,
      'date', to_char(day_start, 'Mon FMDD'),
      'matches', matches
    )
    ORDER BY day_start ASC
  ), '[]'::jsonb)
  INTO v_match_trends
  FROM counted;

  WITH latest_events AS (
    SELECT
      id,
      title,
      event_date,
      status,
      current_attendees,
      COALESCE(NULLIF(max_attendees, 0), 50) AS capacity,
      archived_at,
      ended_at,
      event_date + COALESCE(duration_minutes, 60) * interval '1 minute' AS scheduled_end,
      event_date + COALESCE(duration_minutes, 60) * interval '1 minute' + interval '10 minutes' AS auto_finalize_at
    FROM public.events
    ORDER BY event_date DESC NULLS LAST
    LIMIT 10
  ),
  latest_with_lifecycle AS (
    SELECT
      *,
      CASE
        WHEN archived_at IS NOT NULL OR lower(COALESCE(status, '')) = 'archived' THEN 'archived'
        WHEN lower(COALESCE(status, '')) = 'draft' THEN 'draft'
        WHEN lower(COALESCE(status, '')) = 'cancelled' THEN 'cancelled'
        WHEN ended_at IS NOT NULL THEN 'finalized'
        WHEN event_date IS NOT NULL AND v_now >= auto_finalize_at THEN 'needs_finalization_repair'
        WHEN event_date IS NOT NULL AND v_now >= scheduled_end THEN 'wrap_up_grace'
        WHEN event_date IS NOT NULL AND v_now >= event_date AND v_now < scheduled_end THEN 'live'
        ELSE 'upcoming'
      END AS lifecycle_status
    FROM latest_events
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'title', title,
      'name', CASE WHEN length(title) > 15 THEN substring(title from 1 for 15) || '...' ELSE title END,
      'attendees', COALESCE(current_attendees, 0),
      'capacity', capacity,
      'fillRate', round((COALESCE(current_attendees, 0)::numeric / capacity::numeric) * 100)::integer,
      'status', status,
      'lifecycle_status', lifecycle_status,
      'scheduled_end_at', scheduled_end,
      'auto_finalize_at', auto_finalize_at,
      'is_finalized', ended_at IS NOT NULL,
      'is_in_finalization_grace', lifecycle_status = 'wrap_up_grace',
      'needs_finalization_repair', lifecycle_status = 'needs_finalization_repair',
      'archived', archived_at IS NOT NULL OR lower(COALESCE(status, '')) = 'archived',
      'ended', ended_at IS NOT NULL OR (event_date IS NOT NULL AND v_now >= scheduled_end)
    )
    ORDER BY event_date DESC NULLS LAST
  ), '[]'::jsonb)
  INTO v_event_fill_rows
  FROM latest_with_lifecycle;

  WITH gender_counts AS (
    SELECT
      COALESCE(NULLIF(gender, ''), 'Unknown') AS raw_gender,
      count(*)::integer AS value
    FROM public.profiles
    GROUP BY COALESCE(NULLIF(gender, ''), 'Unknown')
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'raw_gender', raw_gender,
      'name', initcap(replace(raw_gender, '_', ' ')),
      'value', value
    )
    ORDER BY value DESC, raw_gender ASC
  ), '[]'::jsonb)
  INTO v_gender_distribution
  FROM gender_counts;

  SELECT count(*)::integer
  INTO v_possible_test_event_rows
  FROM public.events
  WHERE title ILIKE ANY (ARRAY['%test%', '%codex%', '%prewarm%', '%smoke%']);

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', v_now,
    'reporting_timezone', 'UTC',
    'window_start_today', v_today_start,
    'stats', v_stats,
    'quick_actions', v_quick_actions,
    'daily_drop', v_daily_drop,
    'charts', jsonb_build_object(
      'user_growth_30d', v_user_growth,
      'match_trends_30d', v_match_trends,
      'latest_event_fill_rows', v_event_fill_rows,
      'gender_distribution', v_gender_distribution
    ),
    'data_hygiene', jsonb_build_object(
      'possible_test_event_rows', v_possible_test_event_rows
    )
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_overview_dashboard(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_overview_dashboard(timestamptz) TO authenticated;

COMMENT ON FUNCTION public.admin_get_overview_dashboard(timestamptz) IS
  'Read-only backend-authoritative /kaan Overview payload with scheduled-window event lifecycle counts, finalization grace, and repair metadata.';

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260508114500',
  'Event lifecycle archived-status guards',
  'schema+policy',
  'Re-applies event lifecycle/admin registration/payment/read functions so raw status=archived rows are treated as archived even when archived_at is absent. No event rows are rewritten by the migration itself.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
