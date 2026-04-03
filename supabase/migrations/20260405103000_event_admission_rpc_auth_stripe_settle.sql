-- Stream: canonical event admission (confirmed vs paid waitlist) + capacity-safe attendees count
-- + SECURITY DEFINER caller binding for event-path mutations + Stripe ticket settlement idempotency.

-- ─── 1) Idempotency ledger for Stripe event-ticket checkout ─────────────────
CREATE TABLE IF NOT EXISTS public.stripe_event_ticket_settlements (
  checkout_session_id text PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  outcome text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_event_ticket_settlements ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.stripe_event_ticket_settlements IS
  'Idempotent record of Stripe event-ticket checkout.session.completed processing; service_role-only writes via settle_event_ticket_checkout.';

-- ─── 2) Admission status on registrations ───────────────────────────────────
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS admission_status text NOT NULL DEFAULT 'confirmed';

UPDATE public.event_registrations
SET admission_status = 'confirmed'
WHERE admission_status IS NULL;

ALTER TABLE public.event_registrations
  DROP CONSTRAINT IF EXISTS event_registrations_admission_status_check;

ALTER TABLE public.event_registrations
  ADD CONSTRAINT event_registrations_admission_status_check
  CHECK (admission_status IN ('confirmed', 'waitlisted', 'canceled'));

COMMENT ON COLUMN public.event_registrations.admission_status IS
  'confirmed = counts toward capacity; waitlist = paid but no seat; canceled reserved.';

-- ─── 3) Attendee counter: ONLY confirmed rows ────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_event_attendees()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.admission_status = 'confirmed' THEN
      UPDATE public.events
      SET current_attendees = current_attendees + 1
      WHERE id = NEW.event_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.admission_status = 'confirmed' THEN
      UPDATE public.events
      SET current_attendees = GREATEST(0, current_attendees - 1)
      WHERE id = OLD.event_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.admission_status IS DISTINCT FROM NEW.admission_status THEN
      IF OLD.admission_status = 'confirmed' AND NEW.admission_status <> 'confirmed' THEN
        UPDATE public.events
        SET current_attendees = GREATEST(0, current_attendees - 1)
        WHERE id = NEW.event_id;
      ELSIF OLD.admission_status <> 'confirmed' AND NEW.admission_status = 'confirmed' THEN
        UPDATE public.events
        SET current_attendees = current_attendees + 1
        WHERE id = NEW.event_id;
      END IF;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ─── 4) RLS: confirmed users see cohort rows; everyone sees own row ──────────
DROP POLICY IF EXISTS "Users can view registrations for shared events" ON public.event_registrations;

CREATE POLICY "Users can view registrations for shared events"
ON public.event_registrations
FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND (
    auth.uid() = profile_id
    OR EXISTS (
      SELECT 1
      FROM public.event_registrations er
      WHERE er.event_id = event_registrations.event_id
        AND er.profile_id = auth.uid()
        AND er.admission_status = 'confirmed'
    )
  )
);

-- ─── 5) is_registered_for_event = confirmed seat only (used by event_vibes etc.)
CREATE OR REPLACE FUNCTION public.is_registered_for_event(_user_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_registrations er
    WHERE er.profile_id = _user_id
      AND er.event_id = _event_id
      AND er.admission_status = 'confirmed'
  );
$$;

-- ─── 6) Canonical free admission (authenticated) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.register_for_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_visibility text;
  v_max_attendees integer;
  v_current_attendees integer;
  v_status text;
  v_already boolean;
  v_user_tier text;
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
    AND e.status NOT IN ('draft', 'cancelled', 'ended');

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

  IF v_visibility IS NOT NULL AND v_visibility <> 'all' THEN
    SELECT COALESCE(p.subscription_tier, 'free') INTO v_user_tier
    FROM public.profiles p
    WHERE p.id = v_user_id;

    IF v_visibility = 'premium' AND COALESCE(v_user_tier, 'free') NOT IN ('premium', 'vip') THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'This event requires a Premium subscription'
      );
    END IF;

    IF v_visibility = 'vip' AND COALESCE(v_user_tier, 'free') <> 'vip' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'This event requires a VIP subscription'
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

GRANT EXECUTE ON FUNCTION public.register_for_event(uuid) TO authenticated;

-- ─── 7) Stripe settlement (service_role only) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_event_ticket_checkout(
  p_checkout_session_id text,
  p_profile_id uuid,
  p_event_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_existing record;
  v_visibility text;
  v_max int;
  v_current int;
  v_status text;
  v_archived timestamptz;
  v_user_tier text;
  v_reg record;
  v_full boolean;
  v_result jsonb;
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

  IF v_visibility IS NOT NULL AND v_visibility <> 'all' THEN
    SELECT COALESCE(p.subscription_tier, 'free') INTO v_user_tier
    FROM public.profiles p WHERE p.id = p_profile_id;

    IF v_visibility = 'premium' AND COALESCE(v_user_tier, 'free') NOT IN ('premium', 'vip') THEN
      v_result := jsonb_build_object(
        'success', false, 'error', 'tier_mismatch_premium', 'code', 'TIER_MISMATCH'
      );
      UPDATE public.stripe_event_ticket_settlements SET outcome = 'rejected_tier', result = v_result
      WHERE checkout_session_id = p_checkout_session_id;
      RETURN v_result;
    END IF;

    IF v_visibility = 'vip' AND COALESCE(v_user_tier, 'free') <> 'vip' THEN
      v_result := jsonb_build_object(
        'success', false, 'error', 'tier_mismatch_vip', 'code', 'TIER_MISMATCH'
      );
      UPDATE public.stripe_event_ticket_settlements SET outcome = 'rejected_tier', result = v_result
      WHERE checkout_session_id = p_checkout_session_id;
      RETURN v_result;
    END IF;
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

REVOKE ALL ON FUNCTION public.settle_event_ticket_checkout(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_event_ticket_checkout(text, uuid, uuid) TO service_role;

-- ─── 8) handle_swipe: bind actor to JWT + confirmed-only participants ────────
CREATE OR REPLACE FUNCTION public.handle_swipe(
  p_event_id uuid, p_actor_id uuid, p_target_id uuid, p_swipe_type text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_mutual boolean := false;
  v_session_id uuid;
  v_actor_status text;
  v_target_status text;
  v_super_count integer;
  v_recent_super boolean;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id THEN
    RETURN jsonb_build_object('result', 'unauthorized');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM event_registrations
    WHERE event_id = p_event_id AND profile_id = p_actor_id AND admission_status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('result', 'not_registered');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM event_registrations
    WHERE event_id = p_event_id AND profile_id = p_target_id AND admission_status = 'confirmed'
  ) THEN
    RETURN jsonb_build_object('result', 'target_not_found');
  END IF;

  IF is_blocked(p_actor_id, p_target_id) THEN
    RETURN jsonb_build_object('result', 'blocked');
  END IF;
  IF EXISTS (SELECT 1 FROM user_reports WHERE reporter_id = p_actor_id AND reported_id = p_target_id) THEN
    RETURN jsonb_build_object('result', 'reported');
  END IF;

  IF public.is_profile_hidden(p_actor_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'account_paused',
      'message', 'Your account is currently on a break'
    );
  END IF;

  IF public.is_profile_hidden(p_target_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'target_unavailable',
      'message', 'This profile is no longer available'
    );
  END IF;

  IF p_swipe_type = 'pass' THEN
    INSERT INTO event_swipes (event_id, actor_id, target_id, swipe_type)
    VALUES (p_event_id, p_actor_id, p_target_id, 'pass')
    ON CONFLICT (event_id, actor_id, target_id) DO NOTHING;
    RETURN jsonb_build_object('result', 'pass_recorded');
  END IF;

  IF p_swipe_type = 'super_vibe' THEN
    SELECT COUNT(*) INTO v_super_count FROM event_swipes
    WHERE event_id = p_event_id AND actor_id = p_actor_id AND swipe_type = 'super_vibe';
    IF v_super_count >= 3 THEN
      RETURN jsonb_build_object('result', 'limit_reached');
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM event_swipes
      WHERE actor_id = p_actor_id AND target_id = p_target_id AND swipe_type = 'super_vibe'
        AND created_at > now() - interval '30 days'
    ) INTO v_recent_super;
    IF v_recent_super THEN
      RETURN jsonb_build_object('result', 'already_super_vibed_recently');
    END IF;
  END IF;

  INSERT INTO event_swipes (event_id, actor_id, target_id, swipe_type)
  VALUES (p_event_id, p_actor_id, p_target_id, p_swipe_type)
  ON CONFLICT (event_id, actor_id, target_id) DO NOTHING;

  SELECT EXISTS (
    SELECT 1 FROM event_swipes
    WHERE event_id = p_event_id AND actor_id = p_target_id AND target_id = p_actor_id
      AND swipe_type IN ('vibe', 'super_vibe')
  ) INTO v_mutual;

  IF v_mutual THEN
    SELECT queue_status INTO v_actor_status FROM event_registrations
    WHERE event_id = p_event_id AND profile_id = p_actor_id AND admission_status = 'confirmed'
    FOR UPDATE;

    SELECT queue_status INTO v_target_status FROM event_registrations
    WHERE event_id = p_event_id AND profile_id = p_target_id AND admission_status = 'confirmed'
    FOR UPDATE;

    INSERT INTO video_sessions (
      event_id, participant_1_id, participant_2_id, ready_gate_status, ready_gate_expires_at
    ) VALUES (
      p_event_id,
      LEAST(p_actor_id, p_target_id),
      GREATEST(p_actor_id, p_target_id),
      CASE WHEN v_actor_status IN ('browsing', 'idle') AND v_target_status IN ('browsing', 'idle')
        THEN 'ready' ELSE 'queued' END,
      CASE WHEN v_actor_status IN ('browsing', 'idle') AND v_target_status IN ('browsing', 'idle')
        THEN now() + interval '30 seconds' ELSE NULL END
    )
    ON CONFLICT (event_id, participant_1_id, participant_2_id) DO NOTHING
    RETURNING id INTO v_session_id;

    IF v_session_id IS NULL THEN
      RETURN jsonb_build_object('result', 'already_matched');
    END IF;

    IF v_actor_status IN ('browsing', 'idle') AND v_target_status IN ('browsing', 'idle') THEN
      UPDATE event_registrations
      SET queue_status = 'in_ready_gate',
          current_room_id = v_session_id,
          current_partner_id = CASE WHEN profile_id = p_actor_id THEN p_target_id ELSE p_actor_id END,
          last_active_at = now()
      WHERE event_id = p_event_id AND profile_id IN (p_actor_id, p_target_id);

      RETURN jsonb_build_object(
        'result', 'match',
        'match_id', v_session_id,
        'video_session_id', v_session_id,
        'event_id', p_event_id,
        'immediate', true
      );
    ELSE
      RETURN jsonb_build_object(
        'result', 'match_queued',
        'match_id', v_session_id,
        'video_session_id', v_session_id,
        'event_id', p_event_id
      );
    END IF;
  END IF;

  IF p_swipe_type = 'super_vibe' THEN
    RETURN jsonb_build_object('result', 'super_vibe_sent');
  END IF;
  RETURN jsonb_build_object('result', 'vibe_recorded');
END;
$function$;

-- ─── 9) drain_match_queue: JWT user only ───────────────────────────────────────
DROP FUNCTION IF EXISTS public.drain_match_queue(uuid, uuid);

CREATE OR REPLACE FUNCTION public.drain_match_queue(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_match record;
  v_partner_id uuid;
  v_partner_status text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_match FROM video_sessions
  WHERE event_id = p_event_id
    AND ready_gate_status = 'queued'
    AND ((participant_1_id = v_uid) OR (participant_2_id = v_uid))
    AND created_at > now() - interval '10 minutes'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_match IS NULL THEN
    UPDATE video_sessions SET ready_gate_status = 'expired', ended_at = now()
    WHERE event_id = p_event_id
      AND ready_gate_status = 'queued'
      AND created_at < now() - interval '10 minutes'
      AND ((participant_1_id = v_uid) OR (participant_2_id = v_uid));
    RETURN jsonb_build_object('found', false);
  END IF;

  v_partner_id := CASE WHEN v_match.participant_1_id = v_uid
    THEN v_match.participant_2_id ELSE v_match.participant_1_id END;

  SELECT queue_status INTO v_partner_status FROM event_registrations
  WHERE event_id = p_event_id AND profile_id = v_partner_id AND admission_status = 'confirmed';

  IF v_partner_status IN ('browsing', 'idle') THEN
    UPDATE video_sessions
    SET ready_gate_status = 'ready', ready_gate_expires_at = now() + interval '30 seconds'
    WHERE id = v_match.id;

    UPDATE event_registrations
    SET queue_status = 'in_ready_gate',
        current_room_id = v_match.id,
        current_partner_id = CASE WHEN profile_id = v_uid THEN v_partner_id ELSE v_uid END,
        last_active_at = now()
    WHERE event_id = p_event_id AND profile_id IN (v_uid, v_partner_id);

    RETURN jsonb_build_object(
      'found', true,
      'match_id', v_match.id,
      'video_session_id', v_match.id,
      'event_id', p_event_id,
      'partner_id', v_partner_id
    );
  END IF;

  RETURN jsonb_build_object('found', false, 'queued', true);
END;
$function$;

-- ─── 10) update_participant_status: JWT only (no spoofable user id) ───────────
DROP FUNCTION IF EXISTS public.update_participant_status(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.update_participant_status(
  p_event_id uuid,
  p_status text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.event_registrations
  SET queue_status = p_status, last_active_at = now()
  WHERE event_id = p_event_id AND profile_id = v_uid;
END;
$function$;

-- ─── 11) leave_matching_queue: JWT only ────────────────────────────────────────
DROP FUNCTION IF EXISTS public.leave_matching_queue(uuid, uuid);

CREATE OR REPLACE FUNCTION public.leave_matching_queue(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_partner_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT current_partner_id INTO v_partner_id
  FROM public.event_registrations
  WHERE event_id = p_event_id AND profile_id = v_uid;

  UPDATE public.event_registrations
  SET queue_status = 'idle',
      current_room_id = NULL,
      current_partner_id = NULL,
      dates_completed = dates_completed + CASE WHEN v_partner_id IS NOT NULL THEN 1 ELSE 0 END
  WHERE event_id = p_event_id AND profile_id = v_uid;

  IF v_partner_id IS NOT NULL THEN
    UPDATE public.event_registrations
    SET queue_status = 'idle',
        current_room_id = NULL,
        current_partner_id = NULL,
        dates_completed = dates_completed + 1
    WHERE event_id = p_event_id AND profile_id = v_partner_id;

    UPDATE public.video_sessions
    SET ended_at = now(),
        duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))::integer
    WHERE event_id = p_event_id
      AND ((participant_1_id = v_uid AND participant_2_id = v_partner_id)
        OR (participant_2_id = v_uid AND participant_1_id = v_partner_id))
      AND ended_at IS NULL;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- ─── 12) join_matching_queue hardened (legacy path; TS does not call) ───────
CREATE OR REPLACE FUNCTION public.join_matching_queue(
  p_event_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_registered boolean;
  v_current_status text;
  v_event_start timestamptz;
  v_event_end timestamptz;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.event_registrations
    WHERE event_id = p_event_id AND profile_id = p_user_id AND admission_status = 'confirmed'
  ) INTO v_is_registered;

  IF NOT v_is_registered THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not registered for this event');
  END IF;

  SELECT event_date, event_date + (duration_minutes || ' minutes')::interval
  INTO v_event_start, v_event_end
  FROM public.events WHERE id = p_event_id;

  IF now() < v_event_start THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event has not started yet');
  END IF;

  IF now() > v_event_end THEN
    RETURN jsonb_build_object('success', false, 'error', 'Event has ended');
  END IF;

  SELECT queue_status INTO v_current_status
  FROM public.event_registrations
  WHERE event_id = p_event_id AND profile_id = p_user_id;

  IF v_current_status IN ('matched', 'in_date') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already in a date or matched');
  END IF;

  UPDATE public.event_registrations
  SET queue_status = 'searching',
      joined_queue_at = now(),
      current_room_id = NULL,
      current_partner_id = NULL
  WHERE event_id = p_event_id AND profile_id = p_user_id;

  RETURN find_video_date_match(p_event_id, p_user_id);
END;
$function$;

-- ─── 13) get_event_deck: viewer + targets must be confirmed ─────────────────
CREATE OR REPLACE FUNCTION public.get_event_deck(
  p_event_id uuid,
  p_user_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  profile_id uuid,
  name text,
  age integer,
  gender text,
  avatar_url text,
  photos text[],
  about_me text,
  job text,
  location text,
  height_cm integer,
  tagline text,
  looking_for text,
  queue_status text,
  has_met_before boolean,
  is_already_connected boolean,
  has_super_vibed boolean,
  shared_vibe_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_registrations er0
    WHERE er0.event_id = p_event_id AND er0.profile_id = p_user_id AND er0.admission_status = 'confirmed'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id AS profile_id,
    p.name,
    p.age,
    p.gender,
    p.avatar_url,
    p.photos,
    COALESCE(NULLIF(trim(p.about_me), ''), NULLIF(trim(p.bio), '')) AS about_me,
    p.job,
    p.location,
    p.height_cm,
    p.tagline,
    COALESCE(p.relationship_intent, p.looking_for),
    er.queue_status,
    EXISTS (
      SELECT 1 FROM public.video_sessions vs
      WHERE vs.event_id != p_event_id
        AND ((vs.participant_1_id = p_user_id AND vs.participant_2_id = p.id)
          OR (vs.participant_2_id = p_user_id AND vs.participant_1_id = p.id))
    ) AS has_met_before,
    EXISTS (
      SELECT 1 FROM public.matches m
      WHERE ((m.profile_id_1 = p_user_id AND m.profile_id_2 = p.id)
          OR (m.profile_id_2 = p_user_id AND m.profile_id_1 = p.id))
    ) AS is_already_connected,
    EXISTS (
      SELECT 1 FROM public.event_swipes es
      WHERE es.event_id = p_event_id
        AND es.actor_id = p.id
        AND es.target_id = p_user_id
        AND es.swipe_type = 'super_vibe'
    ) AS has_super_vibed,
    COALESCE((
      SELECT COUNT(*)::integer
      FROM public.profile_vibes pv1
      INNER JOIN public.profile_vibes pv2
        ON pv1.vibe_tag_id = pv2.vibe_tag_id
      WHERE pv1.profile_id = p_user_id
        AND pv2.profile_id = p.id
    ), 0) AS shared_vibe_count
  FROM public.event_registrations er
  JOIN public.profiles p ON p.id = er.profile_id
  WHERE er.event_id = p_event_id
    AND er.profile_id != p_user_id
    AND er.admission_status = 'confirmed'
    AND public.is_profile_discoverable(p.id, p_user_id)
    AND EXISTS (
      SELECT 1 FROM public.profiles viewer WHERE viewer.id = p_user_id
      AND (viewer.interested_in IS NULL OR cardinality(viewer.interested_in) = 0
        OR p.gender = ANY(viewer.interested_in)
        OR (p.gender = 'woman' AND 'women' = ANY(viewer.interested_in))
        OR (p.gender = 'man' AND 'men' = ANY(viewer.interested_in))
        OR (p.gender = 'non-binary' AND 'non-binary' = ANY(viewer.interested_in)))
    )
    AND (p.interested_in IS NULL OR cardinality(p.interested_in) = 0
      OR EXISTS (
        SELECT 1 FROM public.profiles viewer WHERE viewer.id = p_user_id
        AND (viewer.gender = ANY(p.interested_in)
          OR (viewer.gender = 'woman' AND 'women' = ANY(p.interested_in))
          OR (viewer.gender = 'man' AND 'men' = ANY(p.interested_in))
          OR (viewer.gender = 'non-binary' AND 'non-binary' = ANY(p.interested_in)))
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.event_swipes es
      WHERE es.event_id = p_event_id
        AND es.actor_id = p_user_id
        AND es.target_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.blocked_users bu
      WHERE (bu.blocker_id = p_user_id AND bu.blocked_id = p.id)
         OR (bu.blocker_id = p.id AND bu.blocked_id = p_user_id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_reports ur
      WHERE ur.reporter_id = p_user_id AND ur.reported_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.matches m
      WHERE ((m.profile_id_1 = p_user_id AND m.profile_id_2 = p.id)
          OR (m.profile_id_2 = p_user_id AND m.profile_id_1 = p.id))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND ((vs.participant_1_id = p_user_id AND vs.participant_2_id = p.id)
          OR (vs.participant_2_id = p_user_id AND vs.participant_1_id = p.id))
    )
  ORDER BY
    (EXISTS (
      SELECT 1 FROM public.event_swipes es
      WHERE es.event_id = p_event_id
        AND es.actor_id = p.id
        AND es.target_id = p_user_id
        AND es.swipe_type = 'super_vibe'
    )) DESC,
    COALESCE((
      SELECT COUNT(*)::integer
      FROM public.profile_vibes pv1
      INNER JOIN public.profile_vibes pv2
        ON pv1.vibe_tag_id = pv2.vibe_tag_id
      WHERE pv1.profile_id = p_user_id
        AND pv2.profile_id = p.id
    ), 0) DESC,
    random()
  LIMIT p_limit;
END;
$function$;

-- ─── 14) get_visible_events: confirmed vs waitlisted flags + auth guard ──────
DROP FUNCTION IF EXISTS public.get_visible_events(uuid, double precision, double precision, boolean, double precision, double precision, double precision);

CREATE OR REPLACE FUNCTION public.get_visible_events(
  p_user_id uuid,
  p_user_lat double precision DEFAULT NULL,
  p_user_lng double precision DEFAULT NULL,
  p_is_premium boolean DEFAULT false,
  p_browse_lat double precision DEFAULT NULL,
  p_browse_lng double precision DEFAULT NULL,
  p_filter_radius_km double precision DEFAULT NULL
)
RETURNS TABLE(
  id uuid, title text, description text, cover_image text,
  event_date timestamptz, duration_minutes integer, max_attendees integer,
  current_attendees integer, tags text[], status text, city text, country text,
  scope text, latitude double precision, longitude double precision,
  radius_km integer, distance_km double precision, is_registered boolean,
  is_waitlisted boolean,
  computed_status text, is_recurring boolean, parent_event_id uuid,
  occurrence_number integer, language text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sub_active boolean;
  v_is_admin boolean;
  v_profile_premium boolean;
  v_can_premium_browse boolean;
  v_browse_lat_eff double precision;
  v_browse_lng_eff double precision;
  v_effective_lat double precision;
  v_effective_lng double precision;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = p_user_id
      AND s.status IN ('active', 'trialing')
  ) INTO v_sub_active;

  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_user_id AND ur.role = 'admin'::public.app_role
  ) INTO v_is_admin;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = p_user_id
      AND (
        p.is_premium = true
        OR (p.premium_until IS NOT NULL AND p.premium_until > now())
      )
  ) INTO v_profile_premium;

  v_can_premium_browse := COALESCE(v_sub_active, false)
    OR COALESCE(v_is_admin, false)
    OR COALESCE(v_profile_premium, false);

  v_browse_lat_eff := CASE
    WHEN v_can_premium_browse
      AND p_browse_lat IS NOT NULL
      AND p_browse_lng IS NOT NULL
    THEN p_browse_lat
    ELSE NULL
  END;
  v_browse_lng_eff := CASE
    WHEN v_can_premium_browse
      AND p_browse_lat IS NOT NULL
      AND p_browse_lng IS NOT NULL
    THEN p_browse_lng
    ELSE NULL
  END;

  v_effective_lat := COALESCE(v_browse_lat_eff, p_user_lat);
  v_effective_lng := COALESCE(v_browse_lng_eff, p_user_lng);

  RETURN QUERY
  SELECT
    e.id, e.title, e.description, e.cover_image, e.event_date,
    e.duration_minutes, e.max_attendees, e.current_attendees, e.tags,
    e.status, e.city, e.country, e.scope, e.latitude, e.longitude,
    e.radius_km,
    CASE
      WHEN e.latitude IS NOT NULL AND v_effective_lat IS NOT NULL
      THEN haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
      ELSE NULL
    END AS distance_km,
    EXISTS (
      SELECT 1 FROM event_registrations er
      WHERE er.event_id = e.id AND er.profile_id = p_user_id
        AND er.admission_status = 'confirmed'
    ) AS is_registered,
    EXISTS (
      SELECT 1 FROM event_registrations er
      WHERE er.event_id = e.id AND er.profile_id = p_user_id
        AND er.admission_status = 'waitlisted'
    ) AS is_waitlisted,
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
    e.is_recurring, e.parent_event_id, e.occurrence_number,
    e.language
  FROM events e
  WHERE e.archived_at IS NULL
    AND e.status != 'draft'
    AND COALESCE(e.is_recurring, false) = false
    AND (
      e.scope = 'global'
      OR e.scope IS NULL
      OR (e.scope = 'regional' AND (
        e.country IS NULL
        OR e.country = (SELECT pr.country FROM profiles pr WHERE pr.id = p_user_id)
        OR v_can_premium_browse
      ))
      OR (e.scope = 'local' AND e.latitude IS NOT NULL AND e.longitude IS NOT NULL AND (
        v_effective_lat IS NULL
        OR haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
          <= COALESCE(e.radius_km, 50)::double precision
      ))
    )
    AND (
      p_filter_radius_km IS NULL
      OR v_effective_lat IS NULL
      OR COALESCE(e.scope, 'global') IN ('global', 'regional')
      OR (e.latitude IS NOT NULL AND e.longitude IS NOT NULL
          AND haversine_distance(v_effective_lat, v_effective_lng, e.latitude, e.longitude)
            <= p_filter_radius_km)
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

-- ─── 15) get_event_visible_attendees: confirmed attendees only; viewer confirmed
CREATE OR REPLACE FUNCTION public.get_event_visible_attendees(
  p_event_id uuid,
  p_viewer_id uuid
) RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_viewer_id THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.event_registrations er0
    WHERE er0.event_id = p_event_id
      AND er0.profile_id = p_viewer_id
      AND er0.admission_status = 'confirmed'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT er.profile_id
  FROM public.event_registrations er
  JOIN public.profiles p ON p.id = er.profile_id
  WHERE er.event_id = p_event_id
    AND er.admission_status = 'confirmed'
    AND er.profile_id <> p_viewer_id
    AND NOT (
      COALESCE(p.is_paused, false)
      AND (p.paused_until IS NULL OR p.paused_until > now())
    )
    AND NOT (
      COALESCE(p.account_paused, false)
      AND (p.account_paused_until IS NULL OR p.account_paused_until > now())
    )
    AND (
      COALESCE(p.event_attendance_visibility, 'attendees') = 'attendees'
      OR (
        COALESCE(p.event_attendance_visibility, 'attendees') = 'matches_only'
        AND EXISTS (
          SELECT 1
          FROM public.matches m
          WHERE
            (m.profile_id_1 = er.profile_id AND m.profile_id_2 = p_viewer_id)
            OR
            (m.profile_id_2 = er.profile_id AND m.profile_id_1 = p_viewer_id)
        )
      )
    );
END;
$$;

-- ─── 16) find_video_date_match: caller binding + confirmed cohort (legacy queue)
CREATE OR REPLACE FUNCTION public.find_video_date_match(
  p_event_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_gender text;
  v_user_interested_in text[];
  v_partner_id uuid;
  v_partner_gender text;
  v_room_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT gender, interested_in INTO v_user_gender, v_user_interested_in
  FROM public.profiles WHERE id = p_user_id;

  IF v_user_gender IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User profile not found');
  END IF;

  SELECT er.profile_id, p.gender INTO v_partner_id, v_partner_gender
  FROM public.event_registrations er
  JOIN public.profiles p ON p.id = er.profile_id
  WHERE er.event_id = p_event_id
    AND er.admission_status = 'confirmed'
    AND er.queue_status = 'searching'
    AND er.profile_id != p_user_id
    AND (v_user_interested_in IS NULL OR cardinality(v_user_interested_in) = 0 OR p.gender = ANY(v_user_interested_in))
    AND (p.interested_in IS NULL OR cardinality(p.interested_in) = 0 OR v_user_gender = ANY(p.interested_in))
    AND NOT is_blocked(p_user_id, er.profile_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.video_sessions vs
      WHERE vs.event_id = p_event_id
        AND ((vs.participant_1_id = p_user_id AND vs.participant_2_id = er.profile_id)
          OR (vs.participant_2_id = p_user_id AND vs.participant_1_id = er.profile_id))
    )
  ORDER BY er.joined_queue_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_partner_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'waiting', true, 'message', 'Searching for a match...');
  END IF;

  v_room_id := gen_random_uuid();

  UPDATE public.event_registrations
  SET queue_status = 'matched',
      current_room_id = v_room_id,
      current_partner_id = v_partner_id,
      last_matched_at = now()
  WHERE event_id = p_event_id AND profile_id = p_user_id AND admission_status = 'confirmed';

  UPDATE public.event_registrations
  SET queue_status = 'matched',
      current_room_id = v_room_id,
      current_partner_id = p_user_id,
      last_matched_at = now()
  WHERE event_id = p_event_id AND profile_id = v_partner_id AND admission_status = 'confirmed';

  INSERT INTO public.video_sessions (event_id, participant_1_id, participant_2_id)
  VALUES (p_event_id, p_user_id, v_partner_id);

  RETURN jsonb_build_object(
    'success', true,
    'matched', true,
    'room_id', v_room_id,
    'partner_id', v_partner_id
  );
END;
$$;
