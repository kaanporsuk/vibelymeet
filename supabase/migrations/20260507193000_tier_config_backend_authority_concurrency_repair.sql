-- Tier Config backend authority concurrency repair.
-- Migration classification: schema+policy.

CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_visibility text;
  v_max_attendees integer;
  v_current_attendees integer;
  v_status text;
  v_already boolean;
  v_monthly_limit integer;
  v_monthly_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT e.visibility, e.max_attendees, e.current_attendees, e.status
  INTO v_visibility, v_max_attendees, v_current_attendees, v_status
  FROM public.events e
  WHERE e.id = p_event_id
    AND e.archived_at IS NULL
    AND e.status IS NOT NULL
    AND e.status NOT IN ('draft', 'cancelled', 'ended')
  FOR UPDATE;

  IF NOT FOUND THEN
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
$$;

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

  SELECT e.visibility, e.max_attendees, e.current_attendees, e.status, e.archived_at
  INTO v_visibility, v_max, v_current, v_status, v_archived
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND OR v_archived IS NOT NULL
     OR v_status IS NULL
     OR v_status IN ('draft', 'cancelled', 'ended') THEN
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

CREATE OR REPLACE FUNCTION public.replenish_monthly_credits()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_processed int := 0;
  v_changed int := 0;
  v_extra int;
  v_extended int;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT p.id AS user_id
    FROM public.profiles p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_credits uc
      WHERE uc.user_id = p.id
        AND uc.last_replenished_at >= v_month_start
    )
  LOOP
    v_extra := COALESCE(public._get_user_tier_capability_int_unchecked(rec.user_id, 'monthlyExtraTimeCredits'), 0);
    v_extended := COALESCE(public._get_user_tier_capability_int_unchecked(rec.user_id, 'monthlyExtendedVibeCredits'), 0);

    IF v_extra <= 0 AND v_extended <= 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.user_credits (user_id, extra_time_credits, extended_vibe_credits, last_replenished_at)
    VALUES (rec.user_id, v_extra, v_extended, now())
    ON CONFLICT (user_id) DO UPDATE SET
      extra_time_credits = public.user_credits.extra_time_credits + v_extra,
      extended_vibe_credits = public.user_credits.extended_vibe_credits + v_extended,
      last_replenished_at = now()
    WHERE public.user_credits.last_replenished_at IS NULL
       OR public.user_credits.last_replenished_at < v_month_start;

    GET DIAGNOSTICS v_changed = ROW_COUNT;
    IF v_changed > 0 THEN
      v_processed := v_processed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'month', v_month_start);
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_swipe(
  p_event_id uuid,
  p_actor_id uuid,
  p_target_id uuid,
  p_swipe_type text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_day_start timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_daily_limit integer;
  v_daily_count integer;
  v_actor_conversation_limit integer;
  v_target_conversation_limit integer;
  v_actor_conversation_count integer;
  v_target_conversation_count integer;
  v_would_create_match boolean := false;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RETURN public.handle_swipe_20260507190000_tier_authority_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  IF p_swipe_type NOT IN ('pass', 'vibe', 'super_vibe') THEN
    RETURN public.handle_swipe_20260507190000_tier_authority_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.event_registrations
    WHERE event_id = p_event_id
      AND profile_id = p_actor_id
      AND admission_status = 'confirmed'
  ) THEN
    RETURN public.handle_swipe_20260507190000_tier_authority_base(
      p_event_id, p_actor_id, p_target_id, p_swipe_type
    );
  END IF;

  v_daily_limit := public._get_user_tier_capability_int_unchecked(p_actor_id, 'dailySwipeLimit');
  IF v_daily_limit IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_actor_id::text), hashtext('dailySwipeLimit'));
    SELECT count(*)::integer
    INTO v_daily_count
    FROM public.event_swipes es
    WHERE es.actor_id = p_actor_id
      AND es.created_at >= v_day_start;

    IF v_daily_count >= v_daily_limit THEN
      RETURN jsonb_build_object(
        'success', false,
        'outcome', 'daily_swipe_limit_reached',
        'result', 'daily_swipe_limit_reached',
        'error', 'daily_swipe_limit_reached',
        'code', 'DAILY_SWIPE_LIMIT_REACHED',
        'limit', v_daily_limit
      );
    END IF;
  END IF;

  IF p_swipe_type IN ('vibe', 'super_vibe') THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(LEAST(p_actor_id::text, p_target_id::text)),
      hashtext(GREATEST(p_actor_id::text, p_target_id::text))
    );

    SELECT EXISTS (
      SELECT 1
      FROM public.event_swipes es
      WHERE es.event_id = p_event_id
        AND es.actor_id = p_target_id
        AND es.target_id = p_actor_id
        AND es.swipe_type IN ('vibe', 'super_vibe')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.matches m
      WHERE (m.profile_id_1 = LEAST(p_actor_id, p_target_id)
             AND m.profile_id_2 = GREATEST(p_actor_id, p_target_id))
         OR (m.profile_id_1 = GREATEST(p_actor_id, p_target_id)
             AND m.profile_id_2 = LEAST(p_actor_id, p_target_id))
    )
    INTO v_would_create_match;

    IF v_would_create_match THEN
      PERFORM pg_advisory_xact_lock(
        hashtext(LEAST(p_actor_id::text, p_target_id::text)),
        hashtext('maxActiveConversations')
      );
      PERFORM pg_advisory_xact_lock(
        hashtext(GREATEST(p_actor_id::text, p_target_id::text)),
        hashtext('maxActiveConversations')
      );

      v_actor_conversation_limit := public._get_user_tier_capability_int_unchecked(p_actor_id, 'maxActiveConversations');
      v_target_conversation_limit := public._get_user_tier_capability_int_unchecked(p_target_id, 'maxActiveConversations');
      v_actor_conversation_count := public._user_active_conversation_count_unchecked(p_actor_id);
      v_target_conversation_count := public._user_active_conversation_count_unchecked(p_target_id);

      IF v_actor_conversation_limit IS NOT NULL
         AND v_actor_conversation_count >= v_actor_conversation_limit THEN
        RETURN jsonb_build_object(
          'success', false,
          'outcome', 'active_conversation_limit_reached',
          'result', 'active_conversation_limit_reached',
          'error', 'active_conversation_limit_reached',
          'code', 'ACTIVE_CONVERSATION_LIMIT_REACHED',
          'limit', v_actor_conversation_limit
        );
      END IF;

      IF v_target_conversation_limit IS NOT NULL
         AND v_target_conversation_count >= v_target_conversation_limit THEN
        RETURN jsonb_build_object(
          'success', false,
          'outcome', 'target_active_conversation_limit_reached',
          'result', 'target_active_conversation_limit_reached',
          'error', 'target_active_conversation_limit_reached',
          'code', 'TARGET_ACTIVE_CONVERSATION_LIMIT_REACHED',
          'limit', v_target_conversation_limit
        );
      END IF;
    END IF;
  END IF;

  RETURN public.handle_swipe_20260507190000_tier_authority_base(
    p_event_id, p_actor_id, p_target_id, p_swipe_type
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.register_for_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.settle_event_ticket_checkout(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_event_ticket_checkout(text, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.replenish_monthly_credits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replenish_monthly_credits() TO service_role;
REVOKE ALL ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.handle_swipe(uuid, uuid, uuid, text) TO authenticated, service_role;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507193000',
  'Tier Config backend authority concurrency repair',
  'schema+policy',
  'Adds transaction-level advisory locks around tier-limited event joins, swipe limits, match conversation limits, and monthly credit replenishment so concurrent requests cannot overrun backend-enforced capability ceilings.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;
