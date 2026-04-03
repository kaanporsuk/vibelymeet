-- Paid waitlist promotion: FIFO by waitlisted_at, tier revalidation, notify outbox.
-- Also: extend registration trigger to fire on admission_status UPDATE (required for counter correctness).

-- ─── 1) Columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.event_registrations
  ADD COLUMN IF NOT EXISTS waitlisted_at timestamptz,
  ADD COLUMN IF NOT EXISTS promoted_at timestamptz;

COMMENT ON COLUMN public.event_registrations.waitlisted_at IS
  'When this row first entered waitlisted admission; FIFO promotion ordering with profile_id tie-break.';
COMMENT ON COLUMN public.event_registrations.promoted_at IS
  'When waitlisted->confirmed via automated promotion or settlement.';

UPDATE public.event_registrations er
SET waitlisted_at = COALESCE(er.registered_at, now())
WHERE er.admission_status = 'waitlisted'
  AND er.waitlisted_at IS NULL;

-- ─── 2) Notify outbox (drained by Edge process-waitlist-promotion-notify-queue)
CREATE TABLE IF NOT EXISTS public.waitlist_promotion_notify_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_waitlist_promo_notify_pending
  ON public.waitlist_promotion_notify_queue(created_at)
  WHERE processed_at IS NULL;

COMMENT ON TABLE public.waitlist_promotion_notify_queue IS
  'Pending push/email fanout for waitlist->confirmed; processed by Edge function with service role.';

ALTER TABLE public.waitlist_promotion_notify_queue ENABLE ROW LEVEL SECURITY;

-- ─── 3) Attendee counter trigger must run on admission_status UPDATE ─────────
DROP TRIGGER IF EXISTS on_registration_change ON public.event_registrations;

CREATE TRIGGER on_registration_change
  AFTER INSERT OR DELETE OR UPDATE OF admission_status ON public.event_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_event_attendees();

-- ─── 4) Core promotion worker (no direct GRANT; called by triggers + wrappers)
CREATE OR REPLACE FUNCTION public.promote_waitlist_for_event_worker(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_visibility text;
  v_max int;
  v_current int;
  v_status text;
  v_archived timestamptz;
  v_user_tier text;
  v_reg record;
  v_promoted jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_attempts int := 0;
  v_exclude uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_event_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_event');
  END IF;

  SELECT e.visibility, e.max_attendees, e.current_attendees, e.status, e.archived_at
  INTO v_visibility, v_max, v_current, v_status, v_archived
  FROM public.events e
  WHERE e.id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'event_not_found');
  END IF;

  IF v_archived IS NOT NULL
     OR v_status IS NULL
     OR v_status IN ('draft', 'cancelled', 'ended') THEN
    RETURN jsonb_build_object(
      'success', true,
      'skipped', true,
      'reason', 'event_not_admissible',
      'promoted', v_promoted,
      'skipped_ineligible', v_skipped
    );
  END IF;

  <<promo_loop>>
  LOOP
    IF v_max IS NOT NULL AND v_current IS NOT NULL AND v_current >= v_max THEN
      EXIT promo_loop;
    END IF;
    IF v_attempts >= 500 THEN
      EXIT promo_loop;
    END IF;

    SELECT er.id, er.profile_id, er.waitlisted_at
    INTO v_reg
    FROM public.event_registrations er
    WHERE er.event_id = p_event_id
      AND er.admission_status = 'waitlisted'
      AND er.payment_status = 'paid'
      AND NOT (er.profile_id = ANY(v_exclude))
    ORDER BY er.waitlisted_at ASC NULLS LAST, er.profile_id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF NOT FOUND THEN
      EXIT promo_loop;
    END IF;

    v_attempts := v_attempts + 1;

    IF v_visibility IS NOT NULL AND v_visibility <> 'all' THEN
      SELECT COALESCE(p.subscription_tier, 'free') INTO v_user_tier
      FROM public.profiles p
      WHERE p.id = v_reg.profile_id;

      IF v_visibility = 'premium' AND COALESCE(v_user_tier, 'free') NOT IN ('premium', 'vip') THEN
        v_skipped := v_skipped || jsonb_build_object(
          'profile_id', v_reg.profile_id,
          'reason', 'tier_premium'
        );
        v_exclude := array_append(v_exclude, v_reg.profile_id);
        CONTINUE promo_loop;
      END IF;

      IF v_visibility = 'vip' AND COALESCE(v_user_tier, 'free') <> 'vip' THEN
        v_skipped := v_skipped || jsonb_build_object(
          'profile_id', v_reg.profile_id,
          'reason', 'tier_vip'
        );
        v_exclude := array_append(v_exclude, v_reg.profile_id);
        CONTINUE promo_loop;
      END IF;
    END IF;

    UPDATE public.event_registrations er
    SET
      admission_status = 'confirmed',
      promoted_at = now()
    WHERE er.id = v_reg.id;

    v_promoted := v_promoted || jsonb_build_array(
      jsonb_build_object('profile_id', v_reg.profile_id)
    );

    INSERT INTO public.waitlist_promotion_notify_queue (user_id, event_id)
    VALUES (v_reg.profile_id, p_event_id);

    SELECT e.current_attendees INTO v_current
    FROM public.events e
    WHERE e.id = p_event_id;
  END LOOP promo_loop;

  RETURN jsonb_build_object(
    'success', true,
    'promoted', v_promoted,
    'skipped_ineligible', v_skipped,
    'attempts', v_attempts
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.promote_waitlist_for_event_worker(uuid) FROM PUBLIC;

-- ─── 5) Public entry: admin or service_role
CREATE OR REPLACE FUNCTION public.promote_waitlist_for_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF p_event_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_event');
  END IF;

  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'::public.app_role
    ) THEN
      RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN public.promote_waitlist_for_event_worker(p_event_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.promote_waitlist_for_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_waitlist_for_event(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.promote_waitlist_for_event(uuid) TO authenticated;

-- ─── 6) Authenticated self-cancel (replaces raw DELETE for API clients)
CREATE OR REPLACE FUNCTION public.cancel_event_registration(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_deleted int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  DELETE FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = v_uid;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', v_deleted > 0,
    'rows_deleted', v_deleted
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_event_registration(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_event_registration(uuid) TO authenticated;

-- ─── 7) Admin remove any registration (confirmed removal frees capacity → trigger promotes)
CREATE OR REPLACE FUNCTION public.admin_remove_event_registration(
  p_event_id uuid,
  p_profile_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_deleted int;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role = 'admin'::public.app_role
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF p_event_id IS NULL OR p_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_args');
  END IF;

  DELETE FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = p_profile_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', v_deleted > 0,
    'rows_deleted', v_deleted
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_remove_event_registration(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_remove_event_registration(uuid, uuid) TO authenticated;

-- ─── 8) AFTER DELETE: promote when a confirmed seat is removed
CREATE OR REPLACE FUNCTION public.trg_registration_delete_promote_waitlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF OLD.admission_status = 'confirmed' THEN
    PERFORM public.promote_waitlist_for_event_worker(OLD.event_id);
  END IF;
  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS registration_delete_promote_waitlist ON public.event_registrations;

CREATE TRIGGER registration_delete_promote_waitlist
  AFTER DELETE ON public.event_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_registration_delete_promote_waitlist();

-- ─── 9) AFTER capacity increase on events
CREATE OR REPLACE FUNCTION public.trg_event_capacity_increase_promote_waitlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF NEW.max_attendees IS DISTINCT FROM OLD.max_attendees THEN
    IF NEW.max_attendees IS NULL
       OR OLD.max_attendees IS NULL
       OR NEW.max_attendees > OLD.max_attendees THEN
      PERFORM public.promote_waitlist_for_event_worker(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS event_capacity_increase_promote_waitlist ON public.events;

CREATE TRIGGER event_capacity_increase_promote_waitlist
  AFTER UPDATE OF max_attendees ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_event_capacity_increase_promote_waitlist();

-- ─── 10) Stripe settle: set waitlisted_at / promoted_at on insert or promotion
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
        SET admission_status = 'confirmed',
            promoted_at = now()
        WHERE event_id = p_event_id AND profile_id = p_profile_id;
        INSERT INTO public.waitlist_promotion_notify_queue (user_id, event_id)
        VALUES (p_profile_id, p_event_id);
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
      event_id, profile_id, admission_status, payment_status, waitlisted_at
    ) VALUES (
      p_event_id, p_profile_id, 'waitlisted', 'paid', now()
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
