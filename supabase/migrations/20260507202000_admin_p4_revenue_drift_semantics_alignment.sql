-- Align P4 revenue drift semantics across the metric card and reconciliation queue.
--
-- Migration class: schema-only RPC replacement.
-- Intent: make entitlement drift mean one thing everywhere:
-- profile is_premium differs from active subscription OR active admin premium_until.
-- No entitlement, provider, user, or payment state is mutated by these RPCs.

CREATE OR REPLACE FUNCTION public.admin_get_revenue_intelligence(
  p_window_start timestamptz DEFAULT NULL,
  p_window_end timestamptz DEFAULT NULL,
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_start timestamptz := COALESCE(p_window_start, now() - interval '30 days');
  v_end timestamptz := COALESCE(p_window_end, now());
  v_active_subscriptions integer := 0;
  v_stripe_active integer := 0;
  v_revenuecat_active integer := 0;
  v_premium_profiles integer := 0;
  v_credit_adjustments integer := 0;
  v_paid_registrations integer := 0;
  v_drift integer := 0;
  v_stripe_webhook_failures integer := 0;
  v_revenuecat_failures integer := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'revenue.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Revenue intelligence permission is required.');
  END IF;

  SELECT count(*)::integer INTO v_active_subscriptions
  FROM public.subscriptions
  WHERE status IN ('active', 'trialing');

  SELECT count(*)::integer INTO v_stripe_active
  FROM public.subscriptions
  WHERE status IN ('active', 'trialing')
    AND COALESCE(provider, 'stripe') = 'stripe';

  SELECT count(*)::integer INTO v_revenuecat_active
  FROM public.subscriptions
  WHERE status IN ('active', 'trialing')
    AND provider = 'revenuecat';

  SELECT count(*)::integer INTO v_premium_profiles
  FROM public.profiles
  WHERE is_premium IS TRUE;

  SELECT count(*)::integer INTO v_credit_adjustments
  FROM public.credit_adjustments
  WHERE created_at >= v_start AND created_at < v_end;

  SELECT count(*)::integer INTO v_paid_registrations
  FROM public.event_registrations
  WHERE registered_at >= v_start AND registered_at < v_end
    AND payment_status IN ('paid', 'settled', 'verified');

  WITH reconciliation AS (
    SELECT
      p.id,
      p.is_premium AS profile_is_premium,
      EXISTS (
        SELECT 1
        FROM public.subscriptions s
        WHERE s.user_id = p.id
          AND s.status IN ('active', 'trialing')
      ) AS has_active_subscription,
      (p.premium_until IS NOT NULL AND p.premium_until > now()) AS has_active_admin_grant
    FROM public.profiles p
  )
  SELECT count(*) FILTER (
    WHERE profile_is_premium IS DISTINCT FROM (has_active_subscription OR has_active_admin_grant)
  )::integer
  INTO v_drift
  FROM reconciliation;

  SELECT count(*)::integer INTO v_stripe_webhook_failures
  FROM public.stripe_webhook_events
  WHERE received_at >= v_start AND received_at < v_end
    AND status = 'failed';

  SELECT count(*)::integer INTO v_revenuecat_failures
  FROM public.revenuecat_webhook_events
  WHERE received_at >= v_start AND received_at < v_end
    AND status = 'failed';

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', now(),
    'reporting_timezone', 'UTC',
    'window_start', v_start,
    'window_end', v_end,
    'filters', COALESCE(p_filters, '{}'::jsonb),
    'metrics', jsonb_build_object(
      'active_subscriptions', v_active_subscriptions,
      'stripe_active_subscriptions', v_stripe_active,
      'revenuecat_active_subscriptions', v_revenuecat_active,
      'premium_profiles', v_premium_profiles,
      'entitlement_drift_users', v_drift,
      'credit_adjustments', v_credit_adjustments,
      'paid_event_registrations', v_paid_registrations,
      'stripe_webhook_failures', v_stripe_webhook_failures,
      'revenuecat_webhook_failures', v_revenuecat_failures
    ),
    'semantics', 'Stripe, RevenueCat, and active admin premium_until grants are reconciled in one read-only view; profile premium state remains backend truth only after subscription/profile synchronization.'
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_entitlement_reconciliation(
  p_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100,
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
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_rows jsonb;
  v_total integer;
  v_all_profiles integer;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'revenue.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Revenue intelligence permission is required.');
  END IF;

  WITH reconciliation AS (
    SELECT
      p.id AS user_id,
      p.name,
      p.is_premium AS profile_is_premium,
      p.subscription_tier,
      p.premium_until,
      EXISTS (
        SELECT 1
        FROM public.subscriptions s
        WHERE s.user_id = p.id
          AND s.status IN ('active', 'trialing')
      ) AS has_active_subscription,
      (p.premium_until IS NOT NULL AND p.premium_until > now()) AS has_active_admin_grant,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'provider', COALESCE(s.provider, 'stripe'),
            'status', s.status,
            'plan', s.plan,
            'current_period_end', s.current_period_end
          )
          ORDER BY s.updated_at DESC
        )
        FROM public.subscriptions s
        WHERE s.user_id = p.id
      ), '[]'::jsonb) AS subscriptions
    FROM public.profiles p
    WHERE p_user_id IS NULL OR p.id = p_user_id
  ),
  marked AS (
    SELECT
      *,
      (has_active_subscription OR has_active_admin_grant) AS entitlement_should_be_premium,
      profile_is_premium IS DISTINCT FROM (has_active_subscription OR has_active_admin_grant) AS drift
    FROM reconciliation
  )
  SELECT
    count(*) FILTER (WHERE drift IS TRUE)::integer,
    count(*)::integer
  INTO v_total, v_all_profiles
  FROM marked;

  WITH reconciliation AS (
    SELECT
      p.id AS user_id,
      p.name,
      p.is_premium AS profile_is_premium,
      p.subscription_tier,
      p.premium_until,
      EXISTS (
        SELECT 1
        FROM public.subscriptions s
        WHERE s.user_id = p.id
          AND s.status IN ('active', 'trialing')
      ) AS has_active_subscription,
      (p.premium_until IS NOT NULL AND p.premium_until > now()) AS has_active_admin_grant,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'provider', COALESCE(s.provider, 'stripe'),
            'status', s.status,
            'plan', s.plan,
            'current_period_end', s.current_period_end
          )
          ORDER BY s.updated_at DESC
        )
        FROM public.subscriptions s
        WHERE s.user_id = p.id
      ), '[]'::jsonb) AS subscriptions
    FROM public.profiles p
    WHERE p_user_id IS NULL OR p.id = p_user_id
  ),
  marked AS (
    SELECT
      *,
      (has_active_subscription OR has_active_admin_grant) AS entitlement_should_be_premium,
      profile_is_premium IS DISTINCT FROM (has_active_subscription OR has_active_admin_grant) AS drift
    FROM reconciliation
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.name NULLS LAST, page.user_id), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT *
    FROM marked
    WHERE drift IS TRUE
    ORDER BY name NULLS LAST, user_id
    LIMIT v_limit OFFSET v_offset
  ) page;

  RETURN public.admin_json_success(jsonb_build_object(
    'rows', v_rows,
    'total_count', COALESCE(v_total, 0),
    'all_profiles_count', COALESCE(v_all_profiles, 0),
    'limit', v_limit,
    'offset', v_offset,
    'semantics', 'Queue contains drift=true rows only. Drift means profile premium state differs from active subscription evidence or an active admin premium_until grant.'
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_revenue_intelligence(timestamptz, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_entitlement_reconciliation(uuid, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_get_revenue_intelligence(timestamptz, timestamptz, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_entitlement_reconciliation(uuid, integer, integer) TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507202000',
  'P4 revenue drift semantics alignment',
  'schema-only',
  'Replaces revenue read RPCs so entitlement drift consistently respects active subscriptions and active admin premium_until grants. No state mutation.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.admin_get_entitlement_reconciliation(uuid, integer, integer) IS
  'P4 entitlement drift queue. Returns drift=true rows only; active subscriptions and active admin premium_until grants are both premium evidence.';
