-- P2 /kaan admin backend-authoritative hardening.
--
-- Migration class: schema + RPC + policy.
-- Intent: move high-impact admin mutations behind transactional, admin-checked,
-- idempotent, audited backend operations. No data backfill or destructive data
-- rewrite is performed by this migration.

-- ─────────────────────────────────────────────────────────────────────────────
-- Shared admin primitives
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admin_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_idempotency_keys_operation_not_blank CHECK (btrim(operation) <> ''),
  CONSTRAINT admin_idempotency_keys_key_not_blank CHECK (btrim(idempotency_key) <> ''),
  CONSTRAINT admin_idempotency_keys_unique UNIQUE (admin_id, operation, idempotency_key)
);

ALTER TABLE public.admin_idempotency_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_select_admin_idempotency_keys" ON public.admin_idempotency_keys;
CREATE POLICY "admins_select_admin_idempotency_keys"
  ON public.admin_idempotency_keys
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP TRIGGER IF EXISTS admin_idempotency_keys_updated_at ON public.admin_idempotency_keys;
CREATE TRIGGER admin_idempotency_keys_updated_at
  BEFORE UPDATE ON public.admin_idempotency_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.admin_json_success(p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT jsonb_build_object('success', true) || COALESCE(p_data, '{}'::jsonb);
$$;

CREATE OR REPLACE FUNCTION public.admin_json_error(
  p_error text,
  p_message text DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT jsonb_build_object(
    'success', false,
    'error', p_error,
    'message', COALESCE(p_message, p_error),
    'details', COALESCE(p_details, '{}'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_jsonb_text_array(p_value jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR jsonb_typeof(p_value) <> 'array' THEN NULL
    ELSE ARRAY(SELECT jsonb_array_elements_text(p_value))
  END;
$$;

CREATE OR REPLACE FUNCTION public.admin_jsonb_int_array(p_value jsonb)
RETURNS integer[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR jsonb_typeof(p_value) <> 'array' THEN NULL
    ELSE ARRAY(SELECT (jsonb_array_elements_text(p_value))::integer)
  END;
$$;

CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action_type text,
  p_target_type text,
  p_target_id uuid DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_log_id uuid;
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  INSERT INTO public.admin_activity_logs (
    admin_id,
    action_type,
    target_type,
    target_id,
    details
  ) VALUES (
    v_admin_id,
    p_action_type,
    p_target_type,
    p_target_id,
    COALESCE(p_details, '{}'::jsonb)
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_idempotency_begin(
  p_admin_id uuid,
  p_operation text,
  p_idempotency_key text,
  p_request jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_hash text;
  v_existing_hash text;
  v_existing_response jsonb;
BEGIN
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RETURN NULL;
  END IF;

  v_hash := md5(COALESCE(p_request, '{}'::jsonb)::text);
  PERFORM pg_advisory_xact_lock(hashtext('admin-p2:' || p_admin_id::text || ':' || p_operation || ':' || p_idempotency_key));

  SELECT request_hash, response
  INTO v_existing_hash, v_existing_response
  FROM public.admin_idempotency_keys
  WHERE admin_id = p_admin_id
    AND operation = p_operation
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing_hash IS DISTINCT FROM v_hash THEN
      RETURN public.admin_json_error(
        'CONFLICT',
        'Idempotency key was reused with a different request payload.',
        jsonb_build_object('operation', p_operation)
      );
    END IF;

    IF v_existing_response IS NULL THEN
      RETURN public.admin_json_error(
        'CONFLICT',
        'A matching admin operation is already in progress.',
        jsonb_build_object('operation', p_operation)
      );
    END IF;

    RETURN v_existing_response || jsonb_build_object('idempotent_replay', true);
  END IF;

  INSERT INTO public.admin_idempotency_keys (
    admin_id,
    operation,
    idempotency_key,
    request_hash,
    response
  ) VALUES (
    p_admin_id,
    p_operation,
    p_idempotency_key,
    v_hash,
    public.admin_json_error(
      'INTERNAL_ERROR',
      'Admin operation did not complete; retry with a new idempotency key.',
      jsonb_build_object('operation', p_operation)
    )
  );

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_idempotency_complete(
  p_admin_id uuid,
  p_operation text,
  p_idempotency_key text,
  p_response jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
    UPDATE public.admin_idempotency_keys
    SET response = p_response,
        updated_at = now()
    WHERE admin_id = p_admin_id
      AND operation = p_operation
      AND idempotency_key = p_idempotency_key;
  END IF;

  RETURN p_response;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_json_success(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_json_error(text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_jsonb_text_array(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_jsonb_int_array(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_admin_action(text, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_idempotency_begin(uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_idempotency_complete(uuid, text, text, jsonb) FROM PUBLIC;

COMMENT ON TABLE public.admin_idempotency_keys IS
  'Admin P2 idempotency ledger. Prevents duplicate high-impact /kaan operations on retry or double-click.';

-- ─────────────────────────────────────────────────────────────────────────────
-- User-state mutations: credits, premium, reports, direct moderation
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_adjust_user_credits(
  p_user_id uuid,
  p_adjustments jsonb,
  p_reason text,
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
  v_adj jsonb;
  v_type text;
  v_delta integer;
  v_before_extra integer;
  v_before_extended integer;
  v_after_extra integer;
  v_after_extended integer;
  v_adjustment_ids jsonb := '[]'::jsonb;
  v_adjustment_id uuid;
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;
  IF p_user_id IS NULL OR p_adjustments IS NULL OR jsonb_typeof(p_adjustments) <> 'array' OR jsonb_array_length(p_adjustments) = 0 THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Credit adjustment request is invalid.');
  END IF;

  v_cached := public.admin_idempotency_begin(
    v_admin_id,
    'admin_adjust_user_credits',
    p_idempotency_key,
    jsonb_build_object('user_id', p_user_id, 'adjustments', p_adjustments, 'reason', p_reason)
  );
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  INSERT INTO public.user_credits (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT extra_time_credits, extended_vibe_credits
  INTO v_before_extra, v_before_extended
  FROM public.user_credits
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public.admin_json_error('INTERNAL_ERROR', 'Could not load or create the credit row.');
  END IF;

  v_after_extra := COALESCE(v_before_extra, 0);
  v_after_extended := COALESCE(v_before_extended, 0);

  FOR v_adj IN SELECT * FROM jsonb_array_elements(p_adjustments)
  LOOP
    v_type := v_adj ->> 'credit_type';
    v_delta := COALESCE((v_adj ->> 'delta')::integer, 0);

    IF v_type NOT IN ('extra_time', 'extended_vibe') OR v_delta = 0 THEN
      RETURN public.admin_json_error(
        'VALIDATION_ERROR',
        'Only non-zero extra_time and extended_vibe adjustments are supported.',
        jsonb_build_object('credit_type', v_type)
      );
    END IF;

    IF v_type = 'extra_time' THEN
      IF v_after_extra + v_delta < 0 THEN
        RETURN public.admin_json_error('VALIDATION_ERROR', 'Extra Time credits cannot become negative.');
      END IF;
      INSERT INTO public.credit_adjustments (
        admin_id,
        user_id,
        credit_type,
        previous_value,
        new_value,
        adjustment_reason
      ) VALUES (
        v_admin_id,
        p_user_id,
        v_type,
        v_after_extra,
        v_after_extra + v_delta,
        NULLIF(btrim(COALESCE(p_reason, '')), '')
      )
      RETURNING id INTO v_adjustment_id;
      v_after_extra := v_after_extra + v_delta;
    ELSE
      IF v_after_extended + v_delta < 0 THEN
        RETURN public.admin_json_error('VALIDATION_ERROR', 'Extended Vibe credits cannot become negative.');
      END IF;
      INSERT INTO public.credit_adjustments (
        admin_id,
        user_id,
        credit_type,
        previous_value,
        new_value,
        adjustment_reason
      ) VALUES (
        v_admin_id,
        p_user_id,
        v_type,
        v_after_extended,
        v_after_extended + v_delta,
        NULLIF(btrim(COALESCE(p_reason, '')), '')
      )
      RETURNING id INTO v_adjustment_id;
      v_after_extended := v_after_extended + v_delta;
    END IF;

    v_adjustment_ids := v_adjustment_ids || jsonb_build_array(v_adjustment_id);
  END LOOP;

  UPDATE public.user_credits
  SET extra_time_credits = v_after_extra,
      extended_vibe_credits = v_after_extended,
      updated_at = now()
  WHERE user_id = p_user_id;

  v_audit_id := public.log_admin_action(
    'credit.adjust',
    'user',
    p_user_id,
    jsonb_build_object(
      'reason', p_reason,
      'adjustments', p_adjustments,
      'before', jsonb_build_object('extra_time', v_before_extra, 'extended_vibe', v_before_extended),
      'after', jsonb_build_object('extra_time', v_after_extra, 'extended_vibe', v_after_extended),
      'credit_adjustment_ids', v_adjustment_ids
    )
  );

  v_response := public.admin_json_success(jsonb_build_object(
    'user_id', p_user_id,
    'previous_balance', jsonb_build_object('extra_time', v_before_extra, 'extended_vibe', v_before_extended),
    'new_balance', jsonb_build_object('extra_time', v_after_extra, 'extended_vibe', v_after_extended),
    'adjustment_ids', v_adjustment_ids,
    'audit_log_id', v_audit_id
  ));

  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_adjust_user_credits', p_idempotency_key, v_response);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_premium_status(
  p_user_id uuid,
  p_action text,
  p_premium_until timestamptz DEFAULT NULL,
  p_subscription_tier text DEFAULT NULL,
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
  v_before jsonb;
  v_after jsonb;
  v_history_id uuid;
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;
  IF p_user_id IS NULL OR p_action NOT IN ('grant', 'extend', 'revoke', 'expire', 'correct_history') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Premium action request is invalid.');
  END IF;
  IF p_action IN ('grant', 'extend') AND p_premium_until IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'premium_until is required for grant/extend.');
  END IF;

  v_cached := public.admin_idempotency_begin(
    v_admin_id,
    'admin_set_premium_status',
    p_idempotency_key,
    jsonb_build_object(
      'user_id', p_user_id,
      'action', p_action,
      'premium_until', p_premium_until,
      'subscription_tier', p_subscription_tier,
      'reason', p_reason
    )
  );
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  SELECT jsonb_build_object(
    'is_premium', is_premium,
    'subscription_tier', subscription_tier,
    'premium_until', premium_until,
    'premium_granted_at', premium_granted_at,
    'premium_granted_by', premium_granted_by
  )
  INTO v_before
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public.admin_json_error('NOT_FOUND', 'User profile was not found.');
  END IF;

  IF p_action IN ('grant', 'extend') THEN
    UPDATE public.profiles
    SET is_premium = true,
        subscription_tier = COALESCE(NULLIF(btrim(COALESCE(p_subscription_tier, '')), ''), subscription_tier, 'premium'),
        premium_until = p_premium_until,
        premium_granted_by = v_admin_id,
        premium_granted_at = COALESCE(premium_granted_at, now()),
        updated_at = now()
    WHERE id = p_user_id;
  ELSIF p_action IN ('revoke', 'expire') THEN
    UPDATE public.profiles
    SET is_premium = false,
        subscription_tier = 'free',
        premium_until = NULL,
        updated_at = now()
    WHERE id = p_user_id;
  ELSE
    -- correct_history records an audit/history row without changing entitlement.
    UPDATE public.profiles
    SET updated_at = updated_at
    WHERE id = p_user_id;
  END IF;

  SELECT jsonb_build_object(
    'is_premium', is_premium,
    'subscription_tier', subscription_tier,
    'premium_until', premium_until,
    'premium_granted_at', premium_granted_at,
    'premium_granted_by', premium_granted_by
  )
  INTO v_after
  FROM public.profiles
  WHERE id = p_user_id;

  INSERT INTO public.premium_history (
    user_id,
    admin_id,
    action,
    premium_until,
    reason
  ) VALUES (
    p_user_id,
    v_admin_id,
    p_action,
    p_premium_until,
    NULLIF(btrim(COALESCE(p_reason, '')), '')
  )
  RETURNING id INTO v_history_id;

  v_audit_id := public.log_admin_action(
    'premium.' || p_action,
    'user',
    p_user_id,
    jsonb_build_object(
      'reason', p_reason,
      'before', v_before,
      'after', v_after,
      'premium_history_id', v_history_id
    )
  );

  v_response := public.admin_json_success(jsonb_build_object(
    'user_id', p_user_id,
    'before', v_before,
    'after', v_after,
    'premium_history_id', v_history_id,
    'audit_log_id', v_audit_id
  ));

  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_set_premium_status', p_idempotency_key, v_response);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_resolve_report(
  p_report_id uuid,
  p_action text,
  p_reason text,
  p_message text DEFAULT NULL,
  p_suspension_expires_at timestamptz DEFAULT NULL,
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
  v_report public.user_reports%ROWTYPE;
  v_warning_id uuid;
  v_suspension_id uuid;
  v_audit_id uuid;
  v_new_status text;
  v_action_taken text;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;
  IF p_report_id IS NULL OR p_action NOT IN ('dismiss', 'mark_reviewed', 'issue_warning', 'suspend_user', 'lift_suspension', 'ban_user', 'no_action') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Report resolution request is invalid.');
  END IF;

  v_cached := public.admin_idempotency_begin(
    v_admin_id,
    'admin_resolve_report',
    p_idempotency_key,
    jsonb_build_object(
      'report_id', p_report_id,
      'action', p_action,
      'reason', p_reason,
      'message', p_message,
      'suspension_expires_at', p_suspension_expires_at
    )
  );
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_report
  FROM public.user_reports
  WHERE id = p_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Report was not found.');
  END IF;

  IF v_report.status IN ('action_taken', 'dismissed') THEN
    RETURN public.admin_json_error(
      'INVALID_TRANSITION',
      'Report is already in a terminal admin status.',
      jsonb_build_object('status', v_report.status)
    );
  END IF;

  IF p_action = 'issue_warning' THEN
    IF NULLIF(btrim(COALESCE(p_message, p_reason, '')), '') IS NULL THEN
      RETURN public.admin_json_error('VALIDATION_ERROR', 'Warning message is required.');
    END IF;

    INSERT INTO public.user_warnings (
      user_id,
      issued_by,
      reason,
      message
    ) VALUES (
      v_report.reported_id,
      v_admin_id,
      COALESCE(NULLIF(btrim(p_reason), ''), v_report.reason),
      COALESCE(NULLIF(btrim(p_message), ''), p_reason)
    )
    RETURNING id INTO v_warning_id;
  ELSIF p_action IN ('suspend_user', 'ban_user') THEN
    IF NULLIF(btrim(COALESCE(p_reason, p_message, '')), '') IS NULL THEN
      RETURN public.admin_json_error('VALIDATION_ERROR', 'Suspension reason is required.');
    END IF;

    UPDATE public.profiles
    SET is_suspended = true,
        suspension_reason = COALESCE(NULLIF(btrim(p_reason), ''), NULLIF(btrim(p_message), ''), 'Report moderation action'),
        updated_at = now()
    WHERE id = v_report.reported_id;

    INSERT INTO public.user_suspensions (
      user_id,
      suspended_by,
      reason,
      expires_at,
      status
    ) VALUES (
      v_report.reported_id,
      v_admin_id,
      COALESCE(NULLIF(btrim(p_reason), ''), NULLIF(btrim(p_message), ''), 'Report moderation action'),
      CASE WHEN p_action = 'ban_user' THEN NULL ELSE p_suspension_expires_at END,
      'active'
    )
    RETURNING id INTO v_suspension_id;
  ELSIF p_action = 'lift_suspension' THEN
    UPDATE public.user_suspensions
    SET status = 'lifted',
        lifted_at = now(),
        lifted_by = v_admin_id
    WHERE user_id = v_report.reported_id
      AND status = 'active';

    UPDATE public.profiles
    SET is_suspended = false,
        suspension_reason = NULL,
        updated_at = now()
    WHERE id = v_report.reported_id;
  END IF;

  v_new_status := CASE
    WHEN p_action = 'dismiss' THEN 'dismissed'
    WHEN p_action IN ('mark_reviewed', 'no_action') THEN 'reviewed'
    ELSE 'action_taken'
  END;
  v_action_taken := p_action || CASE
    WHEN NULLIF(btrim(COALESCE(p_message, p_reason, '')), '') IS NULL THEN ''
    ELSE ': ' || COALESCE(NULLIF(btrim(p_message), ''), NULLIF(btrim(p_reason), ''))
  END;

  UPDATE public.user_reports
  SET status = v_new_status,
      action_taken = v_action_taken,
      reviewed_by = v_admin_id,
      reviewed_at = now()
  WHERE id = p_report_id;

  v_audit_id := public.log_admin_action(
    CASE
      WHEN p_action = 'dismiss' THEN 'report.dismiss'
      WHEN p_action = 'issue_warning' THEN 'report.warning_issued'
      WHEN p_action IN ('suspend_user', 'ban_user') THEN 'report.user_suspended'
      WHEN p_action = 'lift_suspension' THEN 'report.suspension_lifted'
      ELSE 'report.reviewed'
    END,
    'report',
    p_report_id,
    jsonb_build_object(
      'reported_id', v_report.reported_id,
      'reporter_id', v_report.reporter_id,
      'action', p_action,
      'reason', p_reason,
      'message', p_message,
      'warning_id', v_warning_id,
      'suspension_id', v_suspension_id,
      'new_status', v_new_status
    )
  );

  v_response := public.admin_json_success(jsonb_build_object(
    'report_id', p_report_id,
    'reported_id', v_report.reported_id,
    'status', v_new_status,
    'warning_id', v_warning_id,
    'suspension_id', v_suspension_id,
    'audit_log_id', v_audit_id
  ));

  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_resolve_report', p_idempotency_key, v_response);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_moderate_user(
  p_user_id uuid,
  p_action text,
  p_reason text,
  p_message text DEFAULT NULL,
  p_suspension_expires_at timestamptz DEFAULT NULL,
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
  v_warning_id uuid;
  v_suspension_id uuid;
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;
  IF p_user_id IS NULL OR p_action NOT IN ('issue_warning', 'suspend_user', 'lift_suspension', 'ban_user') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Moderation request is invalid.');
  END IF;

  v_cached := public.admin_idempotency_begin(
    v_admin_id,
    'admin_moderate_user',
    p_idempotency_key,
    jsonb_build_object(
      'user_id', p_user_id,
      'action', p_action,
      'reason', p_reason,
      'message', p_message,
      'suspension_expires_at', p_suspension_expires_at
    )
  );
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN public.admin_json_error('NOT_FOUND', 'User profile was not found.');
  END IF;

  IF p_action = 'issue_warning' THEN
    IF NULLIF(btrim(COALESCE(p_message, '')), '') IS NULL THEN
      RETURN public.admin_json_error('VALIDATION_ERROR', 'Warning message is required.');
    END IF;

    INSERT INTO public.user_warnings (user_id, issued_by, reason, message)
    VALUES (p_user_id, v_admin_id, COALESCE(NULLIF(btrim(p_reason), ''), 'Admin warning'), p_message)
    RETURNING id INTO v_warning_id;
  ELSIF p_action IN ('suspend_user', 'ban_user') THEN
    IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
      RETURN public.admin_json_error('VALIDATION_ERROR', 'Suspension reason is required.');
    END IF;

    INSERT INTO public.user_suspensions (
      user_id,
      suspended_by,
      reason,
      expires_at,
      status
    ) VALUES (
      p_user_id,
      v_admin_id,
      p_reason,
      CASE WHEN p_action = 'ban_user' THEN NULL ELSE p_suspension_expires_at END,
      'active'
    )
    RETURNING id INTO v_suspension_id;

    UPDATE public.profiles
    SET is_suspended = true,
        suspension_reason = p_reason,
        updated_at = now()
    WHERE id = p_user_id;

    INSERT INTO public.admin_notifications (
      type,
      title,
      message,
      data
    ) VALUES (
      'user_suspended',
      'User Suspended',
      'An admin suspended a user account.',
      jsonb_build_object('user_id', p_user_id, 'reason', p_reason, 'action', p_action)
    );
  ELSIF p_action = 'lift_suspension' THEN
    UPDATE public.user_suspensions
    SET status = 'lifted',
        lifted_at = now(),
        lifted_by = v_admin_id
    WHERE user_id = p_user_id
      AND status = 'active';

    UPDATE public.profiles
    SET is_suspended = false,
        suspension_reason = NULL,
        updated_at = now()
    WHERE id = p_user_id;
  END IF;

  v_audit_id := public.log_admin_action(
    CASE
      WHEN p_action = 'issue_warning' THEN 'moderation.warning_issued'
      WHEN p_action IN ('suspend_user', 'ban_user') THEN 'moderation.user_suspended'
      ELSE 'moderation.suspension_lifted'
    END,
    'user',
    p_user_id,
    jsonb_build_object(
      'action', p_action,
      'reason', p_reason,
      'message', p_message,
      'warning_id', v_warning_id,
      'suspension_id', v_suspension_id,
      'suspension_expires_at', p_suspension_expires_at
    )
  );

  v_response := public.admin_json_success(jsonb_build_object(
    'user_id', p_user_id,
    'action', p_action,
    'warning_id', v_warning_id,
    'suspension_id', v_suspension_id,
    'audit_log_id', v_audit_id
  ));

  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_moderate_user', p_idempotency_key, v_response);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Photo verification decision
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_review_photo_verification(
  p_verification_id uuid,
  p_action text,
  p_rejection_reason text DEFAULT NULL,
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
  v_verification public.photo_verifications%ROWTYPE;
  v_target_status text;
  v_expires_at timestamptz;
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.');
  END IF;
  IF p_verification_id IS NULL OR p_action NOT IN ('approve', 'reject') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Verification review request is invalid.');
  END IF;
  IF p_action = 'reject' AND NULLIF(btrim(COALESCE(p_rejection_reason, '')), '') IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Rejection reason is required.');
  END IF;

  v_cached := public.admin_idempotency_begin(
    v_admin_id,
    'admin_review_photo_verification',
    p_idempotency_key,
    jsonb_build_object('verification_id', p_verification_id, 'action', p_action, 'reason', p_rejection_reason)
  );
  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_verification
  FROM public.photo_verifications
  WHERE id = p_verification_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Verification was not found.');
  END IF;

  v_target_status := CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END;

  IF v_verification.status = v_target_status THEN
    v_response := public.admin_json_success(jsonb_build_object(
      'verification_id', p_verification_id,
      'user_id', v_verification.user_id,
      'status', v_target_status,
      'already_applied', true
    ));
    RETURN public.admin_idempotency_complete(v_admin_id, 'admin_review_photo_verification', p_idempotency_key, v_response);
  END IF;

  IF v_verification.status <> 'pending' THEN
    RETURN public.admin_json_error(
      'INVALID_TRANSITION',
      'Only pending verifications can receive a final decision.',
      jsonb_build_object('current_status', v_verification.status)
    );
  END IF;

  IF p_action = 'approve' THEN
    v_expires_at := now() + interval '180 days';

    UPDATE public.photo_verifications
    SET status = 'approved',
        reviewed_by = v_admin_id,
        reviewed_at = now(),
        rejection_reason = NULL
    WHERE id = p_verification_id;

    UPDATE public.profiles
    SET photo_verified = true,
        photo_verified_at = now(),
        photo_verification_expires_at = v_expires_at,
        updated_at = now()
    WHERE id = v_verification.user_id;
  ELSE
    UPDATE public.photo_verifications
    SET status = 'rejected',
        reviewed_by = v_admin_id,
        reviewed_at = now(),
        rejection_reason = p_rejection_reason
    WHERE id = p_verification_id;

    UPDATE public.profiles
    SET photo_verified = false,
        photo_verified_at = NULL,
        photo_verification_expires_at = NULL,
        updated_at = now()
    WHERE id = v_verification.user_id;
  END IF;

  v_audit_id := public.log_admin_action(
    CASE WHEN p_action = 'approve' THEN 'verification.approve' ELSE 'verification.reject' END,
    'user',
    v_verification.user_id,
    jsonb_build_object(
      'verification_id', p_verification_id,
      'before_status', v_verification.status,
      'after_status', v_target_status,
      'rejection_reason', p_rejection_reason
    )
  );

  v_response := public.admin_json_success(jsonb_build_object(
    'verification_id', p_verification_id,
    'user_id', v_verification.user_id,
    'status', v_target_status,
    'audit_log_id', v_audit_id
  ));

  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_review_photo_verification', p_idempotency_key, v_response);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Event admin mutations
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
  IF p_payload IS NULL OR NULLIF(btrim(COALESCE(p_payload ->> 'title', '')), '') IS NULL OR NULLIF(btrim(COALESCE(p_payload ->> 'event_date', '')), '') IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Event title and date are required.');
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
    p_payload ->> 'title',
    p_payload ->> 'description',
    COALESCE(NULLIF(p_payload ->> 'cover_image', ''), '/placeholder.svg'),
    p_payload ->> 'language',
    (p_payload ->> 'event_date')::timestamptz,
    COALESCE((p_payload ->> 'duration_minutes')::integer, 60),
    COALESCE((p_payload ->> 'max_attendees')::integer, 50),
    public.admin_jsonb_text_array(p_payload -> 'tags'),
    COALESCE(NULLIF(p_payload ->> 'status', ''), 'upcoming'),
    public.admin_jsonb_text_array(p_payload -> 'vibes'),
    (p_payload ->> 'max_male_attendees')::integer,
    (p_payload ->> 'max_female_attendees')::integer,
    (p_payload ->> 'max_nonbinary_attendees')::integer,
    COALESCE(NULLIF(p_payload ->> 'visibility', ''), 'public'),
    COALESCE((p_payload ->> 'is_free')::boolean, true),
    COALESCE((p_payload ->> 'price_amount')::numeric, 0),
    COALESCE(NULLIF(p_payload ->> 'price_currency', ''), 'USD'),
    COALESCE(NULLIF(p_payload ->> 'scope', ''), 'global'),
    (p_payload ->> 'latitude')::double precision,
    (p_payload ->> 'longitude')::double precision,
    (p_payload ->> 'radius_km')::double precision,
    p_payload ->> 'city',
    p_payload ->> 'country',
    p_payload ->> 'location_name',
    COALESCE((p_payload ->> 'is_location_specific')::boolean, false),
    COALESCE((p_payload ->> 'is_recurring')::boolean, false),
    p_payload ->> 'recurrence_type',
    public.admin_jsonb_int_array(p_payload -> 'recurrence_days'),
    (p_payload ->> 'recurrence_count')::integer,
    (p_payload ->> 'recurrence_ends_at')::timestamptz
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
  IF p_event_id IS NULL OR p_payload IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Event update request is invalid.');
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

  SELECT * INTO v_before
  FROM public.events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.');
  END IF;

  UPDATE public.events
  SET title = CASE WHEN p_payload ? 'title' THEN p_payload ->> 'title' ELSE title END,
      description = CASE WHEN p_payload ? 'description' THEN p_payload ->> 'description' ELSE description END,
      cover_image = CASE WHEN p_payload ? 'cover_image' THEN p_payload ->> 'cover_image' ELSE cover_image END,
      language = CASE WHEN p_payload ? 'language' THEN p_payload ->> 'language' ELSE language END,
      event_date = CASE WHEN p_payload ? 'event_date' THEN (p_payload ->> 'event_date')::timestamptz ELSE event_date END,
      duration_minutes = CASE WHEN p_payload ? 'duration_minutes' THEN (p_payload ->> 'duration_minutes')::integer ELSE duration_minutes END,
      max_attendees = CASE WHEN p_payload ? 'max_attendees' THEN (p_payload ->> 'max_attendees')::integer ELSE max_attendees END,
      tags = CASE WHEN p_payload ? 'tags' THEN public.admin_jsonb_text_array(p_payload -> 'tags') ELSE tags END,
      vibes = CASE WHEN p_payload ? 'vibes' THEN public.admin_jsonb_text_array(p_payload -> 'vibes') ELSE vibes END,
      max_male_attendees = CASE WHEN p_payload ? 'max_male_attendees' THEN (p_payload ->> 'max_male_attendees')::integer ELSE max_male_attendees END,
      max_female_attendees = CASE WHEN p_payload ? 'max_female_attendees' THEN (p_payload ->> 'max_female_attendees')::integer ELSE max_female_attendees END,
      max_nonbinary_attendees = CASE WHEN p_payload ? 'max_nonbinary_attendees' THEN (p_payload ->> 'max_nonbinary_attendees')::integer ELSE max_nonbinary_attendees END,
      visibility = CASE WHEN p_payload ? 'visibility' THEN p_payload ->> 'visibility' ELSE visibility END,
      is_free = CASE WHEN p_payload ? 'is_free' THEN (p_payload ->> 'is_free')::boolean ELSE is_free END,
      price_amount = CASE WHEN p_payload ? 'price_amount' THEN (p_payload ->> 'price_amount')::numeric ELSE price_amount END,
      price_currency = CASE WHEN p_payload ? 'price_currency' THEN p_payload ->> 'price_currency' ELSE price_currency END,
      scope = CASE WHEN p_payload ? 'scope' THEN p_payload ->> 'scope' ELSE scope END,
      latitude = CASE WHEN p_payload ? 'latitude' THEN (p_payload ->> 'latitude')::double precision ELSE latitude END,
      longitude = CASE WHEN p_payload ? 'longitude' THEN (p_payload ->> 'longitude')::double precision ELSE longitude END,
      radius_km = CASE WHEN p_payload ? 'radius_km' THEN (p_payload ->> 'radius_km')::double precision ELSE radius_km END,
      city = CASE WHEN p_payload ? 'city' THEN p_payload ->> 'city' ELSE city END,
      country = CASE WHEN p_payload ? 'country' THEN p_payload ->> 'country' ELSE country END,
      location_name = CASE WHEN p_payload ? 'location_name' THEN p_payload ->> 'location_name' ELSE location_name END,
      is_location_specific = CASE WHEN p_payload ? 'is_location_specific' THEN (p_payload ->> 'is_location_specific')::boolean ELSE is_location_specific END,
      is_recurring = CASE WHEN p_payload ? 'is_recurring' THEN (p_payload ->> 'is_recurring')::boolean ELSE is_recurring END,
      recurrence_type = CASE WHEN p_payload ? 'recurrence_type' THEN p_payload ->> 'recurrence_type' ELSE recurrence_type END,
      recurrence_days = CASE WHEN p_payload ? 'recurrence_days' THEN public.admin_jsonb_int_array(p_payload -> 'recurrence_days') ELSE recurrence_days END,
      recurrence_count = CASE WHEN p_payload ? 'recurrence_count' THEN (p_payload ->> 'recurrence_count')::integer ELSE recurrence_count END,
      recurrence_ends_at = CASE WHEN p_payload ? 'recurrence_ends_at' THEN (p_payload ->> 'recurrence_ends_at')::timestamptz ELSE recurrence_ends_at END,
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
  IF v_before.archived_at IS NOT NULL OR v_before.ended_at IS NOT NULL OR COALESCE(v_before.status, '') IN ('ended', 'completed', 'cancelled') THEN
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
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;
  IF p_minutes IS NULL OR p_minutes < 1 OR p_minutes > 180 THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Extension minutes must be between 1 and 180.'); END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_extend_event', p_idempotency_key, jsonb_build_object('event_id', p_event_id, 'minutes', p_minutes, 'reason', p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_before FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.'); END IF;
  IF v_before.archived_at IS NOT NULL OR v_before.ended_at IS NOT NULL OR COALESCE(v_before.status, '') IN ('ended', 'completed', 'cancelled') THEN
    RETURN public.admin_json_error('INVALID_TRANSITION', 'Event cannot be extended from its current state.', jsonb_build_object('status', v_before.status));
  END IF;

  UPDATE public.events
  SET duration_minutes = COALESCE(duration_minutes, 60) + p_minutes,
      updated_at = now()
  WHERE id = p_event_id
  RETURNING * INTO v_after;

  v_audit_id := public.log_admin_action('event.extend', 'event', p_event_id, jsonb_build_object('reason', p_reason, 'minutes', p_minutes, 'before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
  v_response := public.admin_json_success(jsonb_build_object('event_id', p_event_id, 'event', to_jsonb(v_after), 'audit_log_id', v_audit_id));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_extend_event', p_idempotency_key, v_response);
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
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_go_live_event', p_idempotency_key, jsonb_build_object('event_id', p_event_id, 'reason', p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_before FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.'); END IF;
  IF v_before.archived_at IS NOT NULL OR v_before.ended_at IS NOT NULL OR COALESCE(v_before.status, '') IN ('draft', 'cancelled', 'ended', 'completed') THEN
    RETURN public.admin_json_error('INVALID_TRANSITION', 'Event cannot go live from its current state.', jsonb_build_object('status', v_before.status));
  END IF;
  IF now() < v_before.event_date OR now() > (v_before.event_date + make_interval(mins => COALESCE(v_before.duration_minutes, 60))) THEN
    RETURN public.admin_json_error('INVALID_TRANSITION', 'Event can only be marked live during its scheduled event window.');
  END IF;

  UPDATE public.events
  SET status = 'live',
      updated_at = now()
  WHERE id = p_event_id
  RETURNING * INTO v_after;

  v_audit_id := public.log_admin_action('event.go_live', 'event', p_event_id, jsonb_build_object('reason', p_reason, 'before', to_jsonb(v_before), 'after', to_jsonb(v_after), 'notifications_not_queued', true));
  v_response := public.admin_json_success(jsonb_build_object('event_id', p_event_id, 'event', to_jsonb(v_after), 'audit_log_id', v_audit_id, 'notifications_not_queued', true));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_go_live_event', p_idempotency_key, v_response);
END;
$function$;

DROP FUNCTION IF EXISTS public.admin_cancel_event(uuid);
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
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_cancel_event', p_idempotency_key, jsonb_build_object('event_id', p_event_id, 'reason', p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_before FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.'); END IF;
  IF v_before.archived_at IS NOT NULL OR v_before.ended_at IS NOT NULL OR COALESCE(v_before.status, '') IN ('cancelled', 'ended', 'completed') THEN
    RETURN public.admin_json_error('INVALID_TRANSITION', 'Event is archived or already terminal.', jsonb_build_object('status', v_before.status));
  END IF;

  UPDATE public.events
  SET status = 'cancelled',
      updated_at = now()
  WHERE id = p_event_id
  RETURNING * INTO v_after;

  v_audit_id := public.log_admin_action('event.cancel', 'event', p_event_id, jsonb_build_object('reason', p_reason, 'before', to_jsonb(v_before), 'after', to_jsonb(v_after), 'notifications_not_queued', true));
  v_response := public.admin_json_success(jsonb_build_object('event_id', p_event_id, 'event', to_jsonb(v_after), 'audit_log_id', v_audit_id, 'notifications_not_queued', true));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_cancel_event', p_idempotency_key, v_response);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_archive_event(
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

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_archive_event', p_idempotency_key, jsonb_build_object('event_id', p_event_id, 'reason', p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_before FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.'); END IF;

  UPDATE public.events
  SET archived_at = COALESCE(archived_at, now()),
      archived_by = COALESCE(archived_by, v_admin_id),
      updated_at = now()
  WHERE id = p_event_id
  RETURNING * INTO v_after;

  v_audit_id := public.log_admin_action('event.archive', 'event', p_event_id, jsonb_build_object('reason', p_reason, 'before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
  v_response := public.admin_json_success(jsonb_build_object('event_id', p_event_id, 'event', to_jsonb(v_after), 'audit_log_id', v_audit_id));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_archive_event', p_idempotency_key, v_response);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_unarchive_event(
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

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_unarchive_event', p_idempotency_key, jsonb_build_object('event_id', p_event_id, 'reason', p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_before FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.'); END IF;

  UPDATE public.events
  SET archived_at = NULL,
      archived_by = NULL,
      updated_at = now()
  WHERE id = p_event_id
  RETURNING * INTO v_after;

  v_audit_id := public.log_admin_action('event.unarchive', 'event', p_event_id, jsonb_build_object('reason', p_reason, 'before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
  v_response := public.admin_json_success(jsonb_build_object('event_id', p_event_id, 'event', to_jsonb(v_after), 'audit_log_id', v_audit_id));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_unarchive_event', p_idempotency_key, v_response);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_bulk_archive_events(
  p_event_ids uuid[],
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
  v_count integer;
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;
  IF p_event_ids IS NULL OR array_length(p_event_ids, 1) IS NULL THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'At least one event id is required.'); END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_bulk_archive_events', p_idempotency_key, jsonb_build_object('event_ids', p_event_ids, 'reason', p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  PERFORM 1 FROM public.events WHERE id = ANY(p_event_ids) FOR UPDATE;

  UPDATE public.events
  SET archived_at = COALESCE(archived_at, now()),
      archived_by = COALESCE(archived_by, v_admin_id),
      updated_at = now()
  WHERE id = ANY(p_event_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  v_audit_id := public.log_admin_action('event.bulk_archive', 'event', NULL, jsonb_build_object('reason', p_reason, 'event_ids', p_event_ids, 'archived_count', v_count));
  v_response := public.admin_json_success(jsonb_build_object('archived_count', v_count, 'event_ids', p_event_ids, 'audit_log_id', v_audit_id));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_bulk_archive_events', p_idempotency_key, v_response);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_archive_event_series(
  p_parent_event_id uuid,
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
  v_event_ids uuid[];
  v_count integer;
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;
  IF p_parent_event_id IS NULL THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Parent event id is required.'); END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_archive_event_series', p_idempotency_key, jsonb_build_object('parent_event_id', p_parent_event_id, 'reason', p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  PERFORM 1
  FROM public.events
  WHERE id = p_parent_event_id
     OR parent_event_id = p_parent_event_id
  FOR UPDATE;

  SELECT ARRAY(
    SELECT id
    FROM public.events
    WHERE id = p_parent_event_id
       OR parent_event_id = p_parent_event_id
    ORDER BY event_date
  )
  INTO v_event_ids;

  IF v_event_ids IS NULL OR array_length(v_event_ids, 1) IS NULL THEN
    RETURN public.admin_json_error('NOT_FOUND', 'Recurring event series was not found.');
  END IF;

  UPDATE public.events
  SET archived_at = COALESCE(archived_at, now()),
      archived_by = COALESCE(archived_by, v_admin_id),
      updated_at = now()
  WHERE id = ANY(v_event_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  v_audit_id := public.log_admin_action('event.archive_series', 'event', p_parent_event_id, jsonb_build_object('reason', p_reason, 'event_ids', v_event_ids, 'archived_count', v_count));
  v_response := public.admin_json_success(jsonb_build_object('archived_count', v_count, 'event_ids', v_event_ids, 'audit_log_id', v_audit_id));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_archive_event_series', p_idempotency_key, v_response);
END;
$function$;

DROP FUNCTION IF EXISTS public.admin_delete_event(uuid);
CREATE OR REPLACE FUNCTION public.admin_delete_event(
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
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_delete_event', p_idempotency_key, jsonb_build_object('event_id', p_event_id, 'reason', p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_before FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.'); END IF;

  v_audit_id := public.log_admin_action('event.delete', 'event', p_event_id, jsonb_build_object('reason', p_reason, 'before', to_jsonb(v_before)));

  DELETE FROM public.event_swipes WHERE event_id = p_event_id;
  DELETE FROM public.video_sessions WHERE event_id = p_event_id;
  DELETE FROM public.event_vibes WHERE event_id = p_event_id;
  DELETE FROM public.event_registrations WHERE event_id = p_event_id;
  DELETE FROM public.events WHERE id = p_event_id;

  v_response := public.admin_json_success(jsonb_build_object('event_id', p_event_id, 'audit_log_id', v_audit_id));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_delete_event', p_idempotency_key, v_response);
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_recurring_events(uuid, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.admin_generate_recurring_events(
  p_parent_event_id uuid,
  p_count integer,
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
  v_parent public.events%ROWTYPE;
  v_before_ids uuid[];
  v_generated_count integer;
  v_generated_ids uuid[];
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;
  IF p_parent_event_id IS NULL OR p_count IS NULL OR p_count < 1 OR p_count > 52 THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Recurring generation count must be between 1 and 52.');
  END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_generate_recurring_events', p_idempotency_key, jsonb_build_object('parent_event_id', p_parent_event_id, 'count', p_count));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_parent FROM public.events WHERE id = p_parent_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Parent event was not found.'); END IF;
  IF COALESCE(v_parent.is_recurring, false) IS NOT TRUE THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Parent event is not recurring.');
  END IF;

  SELECT ARRAY(SELECT id FROM public.events WHERE parent_event_id = p_parent_event_id)
  INTO v_before_ids;

  v_generated_count := public.generate_recurring_events(p_parent_event_id, p_count);

  SELECT ARRAY(
    SELECT id
    FROM public.events
    WHERE parent_event_id = p_parent_event_id
      AND NOT (id = ANY(COALESCE(v_before_ids, ARRAY[]::uuid[])))
    ORDER BY event_date
  )
  INTO v_generated_ids;

  v_audit_id := public.log_admin_action(
    'event.generate_recurring',
    'event',
    p_parent_event_id,
    jsonb_build_object('requested_count', p_count, 'generated_count', v_generated_count, 'generated_ids', v_generated_ids)
  );

  v_response := public.admin_json_success(jsonb_build_object(
    'parent_event_id', p_parent_event_id,
    'generated_count', v_generated_count,
    'generated_ids', COALESCE(v_generated_ids, ARRAY[]::uuid[]),
    'audit_log_id', v_audit_id
  ));

  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_generate_recurring_events', p_idempotency_key, v_response);
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
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_send_event_reminder', p_idempotency_key, jsonb_build_object('event_id', p_event_id, 'reason', p_reason));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.'); END IF;
  IF v_event.archived_at IS NOT NULL OR v_event.ended_at IS NOT NULL OR COALESCE(v_event.status, '') IN ('draft', 'cancelled', 'ended', 'completed') THEN
    RETURN public.admin_json_error('INVALID_TRANSITION', 'Reminders cannot be sent for archived or terminal events.');
  END IF;

  v_audit_id := public.log_admin_action('event.reminder_requested', 'event', p_event_id, jsonb_build_object('reason', p_reason, 'notifications_not_queued', true));
  v_response := public.admin_json_success(jsonb_build_object('event_id', p_event_id, 'audit_log_id', v_audit_id, 'notifications_not_queued', true));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_send_event_reminder', p_idempotency_key, v_response);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Admin notification listing/counts/bulk actions
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_list_notifications(
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0,
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_rows jsonb;
  v_total integer;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;

  SELECT count(*)::integer INTO v_total
  FROM public.admin_notifications n
  WHERE (p_filters ->> 'type' IS NULL OR n.type = p_filters ->> 'type')
    AND (p_filters ->> 'read' IS NULL OR n.read IS NOT DISTINCT FROM (p_filters ->> 'read')::boolean);

  SELECT COALESCE(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT *
    FROM public.admin_notifications n
    WHERE (p_filters ->> 'type' IS NULL OR n.type = p_filters ->> 'type')
      AND (p_filters ->> 'read' IS NULL OR n.read IS NOT DISTINCT FROM (p_filters ->> 'read')::boolean)
    ORDER BY n.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) row_data;

  RETURN public.admin_json_success(jsonb_build_object('rows', v_rows, 'total_count', v_total, 'limit', v_limit, 'offset', v_offset));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_notification_counts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_total integer;
  v_unread integer;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;

  SELECT count(*)::integer INTO v_total FROM public.admin_notifications;
  SELECT count(*)::integer INTO v_unread FROM public.admin_notifications WHERE read IS NOT TRUE;
  RETURN public.admin_json_success(jsonb_build_object('total_count', v_total, 'unread_count', v_unread));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_mark_notifications_read(
  p_scope text,
  p_ids uuid[] DEFAULT NULL,
  p_filters jsonb DEFAULT '{}'::jsonb,
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
  v_count integer := 0;
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;
  IF p_scope NOT IN ('selected', 'loaded_page', 'all_unread', 'all_matching_filter', 'all') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Unsupported notification scope.');
  END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_mark_notifications_read', p_idempotency_key, jsonb_build_object('scope', p_scope, 'ids', p_ids, 'filters', p_filters));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF p_scope IN ('selected', 'loaded_page') THEN
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Selected scope requires ids.'); END IF;
    UPDATE public.admin_notifications SET read = true WHERE id = ANY(p_ids);
  ELSIF p_scope = 'all_unread' THEN
    UPDATE public.admin_notifications SET read = true WHERE read IS NOT TRUE;
  ELSIF p_scope = 'all_matching_filter' THEN
    UPDATE public.admin_notifications
    SET read = true
    WHERE (p_filters ->> 'type' IS NULL OR type = p_filters ->> 'type')
      AND (p_filters ->> 'read' IS NULL OR read IS NOT DISTINCT FROM (p_filters ->> 'read')::boolean);
  ELSE
    UPDATE public.admin_notifications SET read = true;
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  v_audit_id := public.log_admin_action('notification.mark_read', 'admin_notifications', NULL, jsonb_build_object('scope', p_scope, 'ids', p_ids, 'filters', p_filters, 'affected_count', v_count));
  v_response := public.admin_json_success(jsonb_build_object('affected_count', v_count, 'audit_log_id', v_audit_id));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_mark_notifications_read', p_idempotency_key, v_response);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_notifications(
  p_scope text,
  p_ids uuid[] DEFAULT NULL,
  p_filters jsonb DEFAULT '{}'::jsonb,
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
  v_count integer := 0;
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;
  IF p_scope NOT IN ('selected', 'loaded_page', 'all_unread', 'all_matching_filter', 'all') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Unsupported notification scope.');
  END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_delete_notifications', p_idempotency_key, jsonb_build_object('scope', p_scope, 'ids', p_ids, 'filters', p_filters));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  IF p_scope IN ('selected', 'loaded_page') THEN
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Selected scope requires ids.'); END IF;
    DELETE FROM public.admin_notifications WHERE id = ANY(p_ids);
  ELSIF p_scope = 'all_unread' THEN
    DELETE FROM public.admin_notifications WHERE read IS NOT TRUE;
  ELSIF p_scope = 'all_matching_filter' THEN
    DELETE FROM public.admin_notifications
    WHERE (p_filters ->> 'type' IS NULL OR type = p_filters ->> 'type')
      AND (p_filters ->> 'read' IS NULL OR read IS NOT DISTINCT FROM (p_filters ->> 'read')::boolean);
  ELSE
    DELETE FROM public.admin_notifications;
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  v_audit_id := public.log_admin_action('notification.delete', 'admin_notifications', NULL, jsonb_build_object('scope', p_scope, 'ids', p_ids, 'filters', p_filters, 'affected_count', v_count));
  v_response := public.admin_json_success(jsonb_build_object('affected_count', v_count, 'audit_log_id', v_audit_id));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_delete_notifications', p_idempotency_key, v_response);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Support exception RPC hardening: keep old signatures, add idempotent overloads
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.admin_create_event_payment_exception(uuid, uuid, text, text, text, uuid, text);
CREATE OR REPLACE FUNCTION public.admin_create_event_payment_exception(
  p_event_id uuid,
  p_profile_id uuid,
  p_exception_type text,
  p_exception_status text DEFAULT 'open',
  p_checkout_session_id text DEFAULT NULL,
  p_support_ticket_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
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
  v_settlement_outcome text;
  v_admission_status text;
  v_event_status text;
  v_id uuid;
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;
  IF p_event_id IS NULL OR p_profile_id IS NULL OR p_exception_type IS NULL THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Missing exception context.'); END IF;
  IF p_exception_type NOT IN ('refund_requested', 'refund_handled_externally', 'payment_mismatch', 'registration_corrected', 'cancelled_after_payment', 'support_exception') THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Invalid exception type.'); END IF;
  IF p_exception_status NOT IN ('open', 'in_review', 'awaiting_external', 'resolved', 'closed_no_action') THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Invalid exception status.'); END IF;
  IF p_exception_type IN ('refund_requested', 'refund_handled_externally') AND NULLIF(btrim(COALESCE(p_notes, '')), '') IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Refund-related exception cases require notes.');
  END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_create_event_payment_exception', p_idempotency_key, jsonb_build_object('event_id', p_event_id, 'profile_id', p_profile_id, 'type', p_exception_type, 'status', p_exception_status, 'checkout_session_id', p_checkout_session_id, 'support_ticket_id', p_support_ticket_id, 'notes', p_notes));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  PERFORM 1 FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Event was not found.'); END IF;
  PERFORM 1 FROM public.profiles WHERE id = p_profile_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Profile was not found.'); END IF;

  SELECT er.admission_status INTO v_admission_status
  FROM public.event_registrations er
  WHERE er.event_id = p_event_id
    AND er.profile_id = p_profile_id
  LIMIT 1;

  SELECT e.status INTO v_event_status FROM public.events e WHERE e.id = p_event_id;

  SELECT s.outcome INTO v_settlement_outcome
  FROM public.stripe_event_ticket_settlements s
  WHERE (p_checkout_session_id IS NOT NULL AND s.checkout_session_id = p_checkout_session_id)
     OR (p_checkout_session_id IS NULL AND s.event_id = p_event_id AND s.profile_id = p_profile_id)
  ORDER BY s.created_at DESC
  LIMIT 1;

  INSERT INTO public.event_payment_exceptions (
    event_id,
    profile_id,
    checkout_session_id,
    support_ticket_id,
    exception_type,
    exception_status,
    settlement_outcome_snapshot,
    registration_admission_snapshot,
    event_status_snapshot,
    notes,
    created_by,
    resolved_by,
    resolved_at
  ) VALUES (
    p_event_id,
    p_profile_id,
    p_checkout_session_id,
    p_support_ticket_id,
    p_exception_type,
    p_exception_status,
    v_settlement_outcome,
    v_admission_status,
    v_event_status,
    p_notes,
    v_admin_id,
    CASE WHEN p_exception_status = 'resolved' THEN v_admin_id ELSE NULL END,
    CASE WHEN p_exception_status = 'resolved' THEN now() ELSE NULL END
  )
  RETURNING id INTO v_id;

  IF p_support_ticket_id IS NOT NULL THEN
    UPDATE public.support_tickets
    SET event_id = p_event_id,
        checkout_session_id = COALESCE(p_checkout_session_id, checkout_session_id),
        event_payment_exception_id = v_id
    WHERE id = p_support_ticket_id;
  END IF;

  v_audit_id := public.log_admin_action(
    'support.exception_create',
    'event_payment_exception',
    v_id,
    jsonb_build_object(
      'event_id', p_event_id,
      'profile_id', p_profile_id,
      'checkout_session_id', p_checkout_session_id,
      'support_ticket_id', p_support_ticket_id,
      'exception_type', p_exception_type,
      'exception_status', p_exception_status,
      'settlement_outcome_snapshot', v_settlement_outcome,
      'registration_admission_snapshot', v_admission_status,
      'event_status_snapshot', v_event_status
    )
  );

  v_response := public.admin_json_success(jsonb_build_object('exception_id', v_id, 'audit_log_id', v_audit_id));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_create_event_payment_exception', p_idempotency_key, v_response);
END;
$function$;

DROP FUNCTION IF EXISTS public.admin_transition_event_payment_exception(uuid, text, text, text, text, boolean, text, uuid);
CREATE OR REPLACE FUNCTION public.admin_transition_event_payment_exception(
  p_exception_id uuid,
  p_exception_type text DEFAULT NULL,
  p_exception_status text DEFAULT NULL,
  p_resolution text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_refund_handled_externally boolean DEFAULT NULL,
  p_external_refund_reference text DEFAULT NULL,
  p_support_ticket_id uuid DEFAULT NULL,
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
  v_before public.event_payment_exceptions%ROWTYPE;
  v_after public.event_payment_exceptions%ROWTYPE;
  v_audit_id uuid;
  v_response jsonb;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;

  v_cached := public.admin_idempotency_begin(v_admin_id, 'admin_transition_event_payment_exception', p_idempotency_key, jsonb_build_object('exception_id', p_exception_id, 'type', p_exception_type, 'status', p_exception_status, 'resolution', p_resolution, 'notes', p_notes, 'refund_handled_externally', p_refund_handled_externally, 'external_refund_reference', p_external_refund_reference, 'support_ticket_id', p_support_ticket_id));
  IF v_cached IS NOT NULL THEN RETURN v_cached; END IF;

  SELECT * INTO v_before
  FROM public.event_payment_exceptions
  WHERE id = p_exception_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN public.admin_json_error('NOT_FOUND', 'Payment exception case was not found.'); END IF;
  IF p_exception_type IS NOT NULL AND p_exception_type NOT IN ('refund_requested', 'refund_handled_externally', 'payment_mismatch', 'registration_corrected', 'cancelled_after_payment', 'support_exception') THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Invalid exception type.'); END IF;
  IF p_exception_status IS NOT NULL AND p_exception_status NOT IN ('open', 'in_review', 'awaiting_external', 'resolved', 'closed_no_action') THEN RETURN public.admin_json_error('VALIDATION_ERROR', 'Invalid exception status.'); END IF;
  IF COALESCE(p_refund_handled_externally, false) AND NULLIF(btrim(COALESCE(p_external_refund_reference, '')), '') IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'External refund reference is required when refund_handled_externally is set.');
  END IF;

  UPDATE public.event_payment_exceptions
  SET exception_type = COALESCE(p_exception_type, exception_type),
      exception_status = COALESCE(p_exception_status, exception_status),
      resolution = COALESCE(p_resolution, resolution),
      notes = COALESCE(p_notes, notes),
      refund_handled_externally = COALESCE(p_refund_handled_externally, refund_handled_externally),
      external_refund_reference = COALESCE(p_external_refund_reference, external_refund_reference),
      support_ticket_id = COALESCE(p_support_ticket_id, support_ticket_id),
      resolved_by = CASE WHEN COALESCE(p_exception_status, exception_status) = 'resolved' THEN v_admin_id ELSE resolved_by END,
      resolved_at = CASE WHEN COALESCE(p_exception_status, exception_status) = 'resolved' THEN now() ELSE resolved_at END
  WHERE id = p_exception_id
  RETURNING * INTO v_after;

  IF v_after.support_ticket_id IS NOT NULL THEN
    UPDATE public.support_tickets
    SET event_id = v_after.event_id,
        checkout_session_id = COALESCE(v_after.checkout_session_id, checkout_session_id),
        event_payment_exception_id = v_after.id
    WHERE id = v_after.support_ticket_id;
  END IF;

  v_audit_id := public.log_admin_action(
    'support.exception_update',
    'event_payment_exception',
    p_exception_id,
    jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after))
  );

  v_response := public.admin_json_success(jsonb_build_object('exception_id', p_exception_id, 'audit_log_id', v_audit_id));
  RETURN public.admin_idempotency_complete(v_admin_id, 'admin_transition_event_payment_exception', p_idempotency_key, v_response);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Authoritative admin read RPCs
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_get_overview_metrics(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_today_start timestamptz;
  v_users integer;
  v_today_users integer;
  v_matches integer;
  v_messages integer;
  v_events_total integer;
  v_events_live integer;
  v_events_upcoming integer;
  v_events_draft integer;
  v_events_cancelled integer;
  v_events_archived integer;
  v_events_ended integer;
  v_verified integer;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;

  v_today_start := date_trunc('day', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  SELECT count(*)::integer INTO v_users FROM public.profiles;
  SELECT count(*)::integer INTO v_today_users FROM public.profiles WHERE created_at >= v_today_start;
  SELECT count(*)::integer INTO v_matches FROM public.matches;
  SELECT count(*)::integer INTO v_messages FROM public.messages;
  SELECT count(*)::integer INTO v_events_total FROM public.events;
  SELECT count(*)::integer INTO v_events_live FROM public.events WHERE archived_at IS NULL AND ended_at IS NULL AND status = 'live';
  SELECT count(*)::integer INTO v_events_upcoming FROM public.events WHERE archived_at IS NULL AND ended_at IS NULL AND status = 'upcoming' AND event_date >= p_now;
  SELECT count(*)::integer INTO v_events_draft FROM public.events WHERE status = 'draft';
  SELECT count(*)::integer INTO v_events_cancelled FROM public.events WHERE status = 'cancelled';
  SELECT count(*)::integer INTO v_events_archived FROM public.events WHERE archived_at IS NOT NULL;
  SELECT count(*)::integer INTO v_events_ended FROM public.events WHERE ended_at IS NOT NULL OR status IN ('ended', 'completed');
  SELECT count(*)::integer INTO v_verified FROM public.profiles WHERE photo_verified IS TRUE;

  RETURN public.admin_json_success(jsonb_build_object(
    'reporting_timezone', 'UTC',
    'window_start_today', v_today_start,
    'total_users', v_users,
    'today_users', v_today_users,
    'total_matches', v_matches,
    'total_messages', v_messages,
    'events', jsonb_build_object(
      'total', v_events_total,
      'live', v_events_live,
      'upcoming', v_events_upcoming,
      'draft', v_events_draft,
      'cancelled', v_events_cancelled,
      'archived', v_events_archived,
      'ended', v_events_ended
    ),
    'verified_users', v_verified,
    'matches_per_user', CASE WHEN v_users > 0 THEN round((v_matches::numeric / v_users::numeric), 2) ELSE 0 END
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_search_users(
  p_search text DEFAULT NULL,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_sort text DEFAULT 'created_at_desc',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_rows jsonb;
  v_total integer;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;

  WITH filtered AS (
    SELECT p.*
    FROM public.profiles p
    WHERE (NULLIF(btrim(COALESCE(p_search, '')), '') IS NULL OR p.name ILIKE '%' || p_search || '%' OR p.location ILIKE '%' || p_search || '%')
      AND (p_filters ->> 'photo_verified' IS NULL OR p.photo_verified IS NOT DISTINCT FROM (p_filters ->> 'photo_verified')::boolean)
      AND (p_filters ->> 'is_suspended' IS NULL OR p.is_suspended IS NOT DISTINCT FROM (p_filters ->> 'is_suspended')::boolean)
      AND (p_filters ->> 'gender' IS NULL OR p.gender = p_filters ->> 'gender')
  ),
  counted AS (
    SELECT count(*)::integer AS total_count FROM filtered
  ),
  page AS (
    SELECT
      p.id,
      p.name,
      p.age,
      p.gender,
      p.birth_date,
      p.location,
      p.height_cm,
      p.looking_for,
      p.relationship_intent,
      p.avatar_url,
      p.photos,
      p.email_verified,
      p.photo_verified,
      p.is_premium,
      p.is_suspended,
      p.created_at,
      p.updated_at,
      p.total_matches,
      COALESCE(reg.registration_count, 0) AS event_registrations,
      COALESCE(reg.attended_count, 0) AS confirmed_attendance,
      COALESCE(vibes.vibes, '[]'::jsonb) AS vibes
    FROM filtered p
    LEFT JOIN LATERAL (
      SELECT
        count(*)::integer AS registration_count,
        count(*) FILTER (WHERE er.attendance_marked IS TRUE OR er.attended IS TRUE)::integer AS attended_count
      FROM public.event_registrations er
      WHERE er.profile_id = p.id
    ) reg ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('label', vt.label, 'emoji', vt.emoji)), '[]'::jsonb) AS vibes
      FROM public.profile_vibes pv
      JOIN public.vibe_tags vt ON vt.id = pv.vibe_tag_id
      WHERE pv.profile_id = p.id
    ) vibes ON true
    ORDER BY
      CASE WHEN p_sort = 'name_asc' THEN p.name END ASC NULLS LAST,
      CASE WHEN p_sort = 'name_desc' THEN p.name END DESC NULLS LAST,
      CASE WHEN p_sort = 'age_asc' THEN p.age END ASC NULLS LAST,
      CASE WHEN p_sort = 'age_desc' THEN p.age END DESC NULLS LAST,
      CASE WHEN p_sort = 'registrations_asc' THEN COALESCE(reg.registration_count, 0) END ASC,
      CASE WHEN p_sort = 'registrations_desc' THEN COALESCE(reg.registration_count, 0) END DESC,
      CASE WHEN p_sort = 'created_at_asc' THEN p.created_at END ASC,
      p.created_at DESC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT
    COALESCE((SELECT total_count FROM counted), 0),
    COALESCE(jsonb_agg(to_jsonb(page)), '[]'::jsonb)
  INTO v_total, v_rows
  FROM page;

  RETURN public.admin_json_success(jsonb_build_object(
    'rows', v_rows,
    'total_count', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'registration_semantics', 'event_registrations counts event_registrations rows; confirmed_attendance uses explicit attendance markers only.'
  ));
END;
$function$;

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
  SELECT count(*)::integer INTO v_attended FROM public.event_registrations WHERE event_id = p_event_id AND (attendance_marked IS TRUE OR attended IS TRUE);
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
    'persistent_matches', v_matches,
    'participant_reports_near_event_window', v_participant_reports,
    'report_scope', 'participant_reports_near_event_window'
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_push_delivery_metrics(
  p_window_start timestamptz,
  p_window_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_push_queued integer;
  v_push_sent integer;
  v_push_delivered integer;
  v_push_opened integer;
  v_push_clicked integer;
  v_app_logs integer;
  v_app_delivered integer;
  v_app_suppressed integer;
BEGIN
  IF v_admin_id IS NULL THEN RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.'); END IF;
  IF NOT public.has_role(v_admin_id, 'admin'::public.app_role) THEN RETURN public.admin_json_error('FORBIDDEN', 'Admin role is required.'); END IF;
  IF p_window_start IS NULL OR p_window_end IS NULL OR p_window_start >= p_window_end THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Push metrics window is invalid.');
  END IF;

  SELECT count(*)::integer INTO v_push_queued FROM public.push_notification_events_admin WHERE created_at >= p_window_start AND created_at < p_window_end;
  SELECT count(*)::integer INTO v_push_sent FROM public.push_notification_events_admin WHERE created_at >= p_window_start AND created_at < p_window_end AND sent_at IS NOT NULL;
  SELECT count(*)::integer INTO v_push_delivered FROM public.push_notification_events_admin WHERE created_at >= p_window_start AND created_at < p_window_end AND (delivered_at IS NOT NULL OR status IN ('delivered', 'opened', 'clicked'));
  SELECT count(*)::integer INTO v_push_opened FROM public.push_notification_events_admin WHERE created_at >= p_window_start AND created_at < p_window_end AND (opened_at IS NOT NULL OR status IN ('opened', 'clicked'));
  SELECT count(*)::integer INTO v_push_clicked FROM public.push_notification_events_admin WHERE created_at >= p_window_start AND created_at < p_window_end AND (clicked_at IS NOT NULL OR status = 'clicked');

  SELECT count(*)::integer INTO v_app_logs FROM public.notification_log WHERE created_at >= p_window_start AND created_at < p_window_end;
  SELECT count(*)::integer INTO v_app_delivered FROM public.notification_log WHERE created_at >= p_window_start AND created_at < p_window_end AND delivered IS TRUE;
  SELECT count(*)::integer INTO v_app_suppressed FROM public.notification_log WHERE created_at >= p_window_start AND created_at < p_window_end AND delivered IS NOT TRUE;

  RETURN public.admin_json_success(jsonb_build_object(
    'window_start', p_window_start,
    'window_end', p_window_end,
    'push_telemetry', jsonb_build_object(
      'queued_rows', v_push_queued,
      'sent_rows', v_push_sent,
      'delivered_rows', v_push_delivered,
      'opened_rows', v_push_opened,
      'clicked_rows', v_push_clicked,
      'source', 'push_notification_events_admin'
    ),
    'app_notification_log', jsonb_build_object(
      'log_rows', v_app_logs,
      'delivered_rows', v_app_delivered,
      'suppressed_rows', v_app_suppressed,
      'source', 'notification_log'
    ),
    'semantics', 'App notification logs and push provider telemetry are intentionally separate.'
  ));
END;
$function$;

-- Grants for public admin RPC contract.
REVOKE ALL ON FUNCTION public.admin_adjust_user_credits(uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_premium_status(uuid, text, timestamptz, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_resolve_report(uuid, text, text, text, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_moderate_user(uuid, text, text, text, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_review_photo_verification(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_event(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_event(uuid, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_end_event(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_extend_event(uuid, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_go_live_event(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cancel_event(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_archive_event(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_unarchive_event(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_bulk_archive_events(uuid[], text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_archive_event_series(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_event(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_generate_recurring_events(uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_send_event_reminder(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_notifications(integer, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_notification_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_mark_notifications_read(text, uuid[], jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_notifications(text, uuid[], jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_event_payment_exception(uuid, uuid, text, text, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_transition_event_payment_exception(uuid, text, text, text, text, boolean, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_overview_metrics(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_search_users(text, jsonb, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_event_metrics(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_push_delivery_metrics(timestamptz, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_adjust_user_credits(uuid, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_premium_status(uuid, text, timestamptz, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_resolve_report(uuid, text, text, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_moderate_user(uuid, text, text, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_review_photo_verification(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_event(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_event(uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_end_event(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_extend_event(uuid, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_go_live_event(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_event(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_archive_event(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unarchive_event(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bulk_archive_events(uuid[], text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_archive_event_series(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_event(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_generate_recurring_events(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_send_event_reminder(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_notifications(integer, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_notification_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_mark_notifications_read(text, uuid[], jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_notifications(text, uuid[], jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_event_payment_exception(uuid, uuid, text, text, text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_transition_event_payment_exception(uuid, text, text, text, text, boolean, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_overview_metrics(timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_users(text, jsonb, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_event_metrics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_push_delivery_metrics(timestamptz, timestamptz) TO authenticated;

COMMENT ON FUNCTION public.admin_get_overview_metrics(timestamptz) IS
  'Admin-only overview metrics computed server-side using UTC reporting boundaries.';
