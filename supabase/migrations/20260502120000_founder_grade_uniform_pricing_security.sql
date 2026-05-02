-- Founder-grade remediation: uniform paid-event pricing, checkout amount verification,
-- entitlement single-writer support, deletion abuse controls, and legacy media lockdown.

CREATE TABLE IF NOT EXISTS public.stripe_event_ticket_checkout_intents (
  checkout_session_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  expected_amount integer NOT NULL CHECK (expected_amount >= 0),
  expected_currency text NOT NULL,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'verified', 'settled', 'amount_mismatch', 'settlement_failed', 'ignored')),
  stripe_event_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  settled_at timestamptz
);

ALTER TABLE public.stripe_event_ticket_checkout_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stripe_event_ticket_checkout_intents_service_role_all
  ON public.stripe_event_ticket_checkout_intents;
CREATE POLICY stripe_event_ticket_checkout_intents_service_role_all
  ON public.stripe_event_ticket_checkout_intents
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_stripe_event_ticket_checkout_intents_user_event
  ON public.stripe_event_ticket_checkout_intents (user_id, event_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.verify_event_ticket_checkout_intent(
  p_checkout_session_id text,
  p_profile_id uuid,
  p_event_id uuid,
  p_amount_total integer,
  p_currency text,
  p_stripe_event_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent public.stripe_event_ticket_checkout_intents%ROWTYPE;
  v_currency text := lower(coalesce(p_currency, ''));
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'forbidden');
  END IF;

  IF p_checkout_session_id IS NULL OR p_profile_id IS NULL OR p_event_id IS NULL
     OR p_amount_total IS NULL OR p_currency IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_ARGS', 'error', 'invalid_args');
  END IF;

  SELECT *
  INTO v_intent
  FROM public.stripe_event_ticket_checkout_intents
  WHERE checkout_session_id = p_checkout_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'INTENT_NOT_FOUND', 'error', 'checkout_intent_not_found');
  END IF;

  IF v_intent.user_id IS DISTINCT FROM p_profile_id OR v_intent.event_id IS DISTINCT FROM p_event_id THEN
    UPDATE public.stripe_event_ticket_checkout_intents
    SET status = 'amount_mismatch',
        stripe_event_id = p_stripe_event_id,
        updated_at = now(),
        metadata = metadata || jsonb_build_object(
          'mismatch_reason', 'metadata_mismatch',
          'received_user_id', p_profile_id,
          'received_event_id', p_event_id
        )
    WHERE checkout_session_id = p_checkout_session_id;

    RETURN jsonb_build_object('success', false, 'code', 'INTENT_METADATA_MISMATCH', 'error', 'metadata_mismatch');
  END IF;

  IF v_intent.expected_amount <> p_amount_total
     OR lower(v_intent.expected_currency) <> v_currency THEN
    v_result := jsonb_build_object(
      'success', false,
      'code', 'AMOUNT_MISMATCH',
      'error', 'amount_or_currency_mismatch',
      'expected_amount', v_intent.expected_amount,
      'received_amount', p_amount_total,
      'expected_currency', lower(v_intent.expected_currency),
      'received_currency', v_currency
    );

    UPDATE public.stripe_event_ticket_checkout_intents
    SET status = 'amount_mismatch',
        stripe_event_id = p_stripe_event_id,
        updated_at = now(),
        metadata = metadata || v_result
    WHERE checkout_session_id = p_checkout_session_id;

    RETURN v_result;
  END IF;

  UPDATE public.stripe_event_ticket_checkout_intents
  SET status = 'verified',
      stripe_event_id = p_stripe_event_id,
      verified_at = COALESCE(verified_at, now()),
      updated_at = now()
  WHERE checkout_session_id = p_checkout_session_id;

  RETURN jsonb_build_object('success', true, 'code', 'VERIFIED');
END;
$$;

REVOKE ALL ON FUNCTION public.verify_event_ticket_checkout_intent(text, uuid, uuid, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_event_ticket_checkout_intent(text, uuid, uuid, integer, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.recompute_profile_subscription_entitlement(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_active_sub boolean;
  v_sub_tier text;
  v_until timestamptz;
  v_current_tier text;
  v_is_premium boolean;
  v_final_tier text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN');
  END IF;

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_ARGS');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions
    WHERE user_id = p_user_id
      AND status IN ('active', 'trialing')
  ) INTO v_has_active_sub;

  SELECT CASE
    WHEN s.plan ILIKE '%vip%' OR s.rc_product_id ILIKE '%vip%' THEN 'vip'
    ELSE 'premium'
  END
  INTO v_sub_tier
  FROM public.subscriptions s
  WHERE s.user_id = p_user_id
    AND s.status IN ('active', 'trialing')
  ORDER BY
    CASE WHEN s.plan ILIKE '%vip%' OR s.rc_product_id ILIKE '%vip%' THEN 0 ELSE 1 END,
    s.updated_at DESC NULLS LAST
  LIMIT 1;

  SELECT premium_until, subscription_tier
  INTO v_until, v_current_tier
  FROM public.profiles
  WHERE id = p_user_id;

  v_is_premium := COALESCE(v_has_active_sub, false)
    OR (v_until IS NOT NULL AND v_until > now());

  IF COALESCE(v_has_active_sub, false) THEN
    v_final_tier := COALESCE(v_sub_tier, 'premium');
  ELSIF v_until IS NOT NULL AND v_until > now() THEN
    v_final_tier := CASE WHEN v_current_tier = 'vip' THEN 'vip' ELSE 'premium' END;
  ELSE
    v_final_tier := 'free';
  END IF;

  UPDATE public.profiles
  SET is_premium = v_is_premium,
      subscription_tier = v_final_tier
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'is_premium', v_is_premium,
    'subscription_tier', v_final_tier
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_profile_subscription_entitlement(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_profile_subscription_entitlement(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_profiles_is_premium_from_subscriptions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_user_id := OLD.user_id;
  ELSE
    v_user_id := NEW.user_id;
  END IF;

  PERFORM public.recompute_profile_subscription_entitlement(v_user_id);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.revenuecat_webhook_events (
  revenuecat_event_id text PRIMARY KEY,
  app_user_id uuid,
  event_type text,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed', 'ignored', 'failed')),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error_code text,
  metadata_summary jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.revenuecat_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS revenuecat_webhook_events_service_role_all ON public.revenuecat_webhook_events;
CREATE POLICY revenuecat_webhook_events_service_role_all
  ON public.revenuecat_webhook_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.public_account_deletion_request_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash text NOT NULL,
  email_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.public_account_deletion_request_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_account_deletion_request_log_service_role_all
  ON public.public_account_deletion_request_log;
CREATE POLICY public_account_deletion_request_log_service_role_all
  ON public.public_account_deletion_request_log
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_public_account_deletion_request_log_ip_time
  ON public.public_account_deletion_request_log (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_account_deletion_request_log_email_time
  ON public.public_account_deletion_request_log (email_hash, created_at DESC);

CREATE OR REPLACE FUNCTION public.record_public_account_deletion_request(
  p_ip_hash text,
  p_email_hash text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ip_hour_count integer;
  v_email_day_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'FORBIDDEN');
  END IF;

  IF coalesce(p_ip_hash, '') = '' OR coalesce(p_email_hash, '') = '' THEN
    RETURN jsonb_build_object('allowed', false, 'code', 'INVALID_ARGS');
  END IF;

  INSERT INTO public.public_account_deletion_request_log (ip_hash, email_hash)
  VALUES (p_ip_hash, p_email_hash);

  SELECT count(*) INTO v_ip_hour_count
  FROM public.public_account_deletion_request_log
  WHERE ip_hash = p_ip_hash
    AND created_at > now() - interval '1 hour';

  SELECT count(*) INTO v_email_day_count
  FROM public.public_account_deletion_request_log
  WHERE email_hash = p_email_hash
    AND created_at > now() - interval '1 day';

  RETURN jsonb_build_object(
    'allowed', v_ip_hour_count <= 3 AND v_email_day_count <= 5,
    'ip_hour_count', v_ip_hour_count,
    'email_day_count', v_email_day_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_public_account_deletion_request(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_public_account_deletion_request(text, text) TO service_role;

WITH ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY user_id ORDER BY requested_at DESC, id DESC) AS rn
  FROM public.account_deletion_requests
  WHERE status = 'pending'
)
UPDATE public.account_deletion_requests adr
SET status = 'superseded',
    cancelled_at = COALESCE(cancelled_at, now())
FROM ranked r
WHERE adr.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_requests_one_pending_per_user
  ON public.account_deletion_requests (user_id)
  WHERE status = 'pending';

UPDATE storage.buckets
SET public = false
WHERE id IN ('chat-videos', 'voice-messages');

DROP POLICY IF EXISTS "Anyone can view chat videos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can listen to voice messages" ON storage.objects;
DROP POLICY IF EXISTS "Public can view chat videos" ON storage.objects;
DROP POLICY IF EXISTS "Public can read voice messages" ON storage.objects;
