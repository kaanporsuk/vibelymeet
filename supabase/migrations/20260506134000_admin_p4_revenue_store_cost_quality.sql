-- P4 revenue intelligence, compliance workflows, native store ops, cost, and quality budgets.
--
-- Migration class: schema + policy + RPC.
-- Intent: add admin-readable company-system maturity surfaces. Export jobs are
-- queued/audited metadata only in this slice; no provider dashboard mutation.

-- ─────────────────────────────────────────────────────────────────────────────
-- Compliance, export, and consent primitives
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.data_subject_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  request_type text NOT NULL CHECK (request_type IN ('access', 'export', 'deletion_proof', 'rectification', 'consent_history')),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'in_review', 'queued', 'fulfilled', 'rejected', 'expired')),
  reason text NOT NULL,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  fulfilled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  fulfilled_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.data_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.data_subject_requests(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN ('user', 'reports', 'support', 'analytics', 'audit')),
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'ready', 'failed', 'expired')),
  pii_classification text NOT NULL DEFAULT 'sensitive'
    CHECK (pii_classification IN ('aggregate', 'pseudonymous', 'sensitive', 'special_category')),
  row_count_estimate integer NOT NULL DEFAULT 0 CHECK (row_count_estimate >= 0),
  storage_path text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text
);

CREATE TABLE IF NOT EXISTS public.consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  consent_type text NOT NULL,
  consent_state text NOT NULL CHECK (consent_state IN ('granted', 'revoked', 'unknown')),
  source text NOT NULL DEFAULT 'app',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.retention_policy_registry (
  policy_key text PRIMARY KEY,
  data_domain text NOT NULL,
  retention_days integer CHECK (retention_days IS NULL OR retention_days >= 0),
  legal_basis text NOT NULL,
  enforcement_surface text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Native/store operations and cost/quality primitives
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.native_release_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_version text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'all')),
  channel text NOT NULL CHECK (channel IN ('dev', 'internal', 'testflight', 'play_internal', 'production')),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'building', 'testing', 'submitted', 'approved', 'rolled_out', 'rolled_back', 'blocked')),
  build_number text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  release_version text,
  rating integer CHECK (rating BETWEEN 1 AND 5),
  sentiment text CHECK (sentiment IN ('positive', 'neutral', 'negative', 'unknown')),
  category text,
  action_status text NOT NULL DEFAULT 'new'
    CHECK (action_status IN ('new', 'triaged', 'responded', 'escalated', 'closed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_metadata_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  checklist_key text NOT NULL,
  status text NOT NULL DEFAULT 'missing'
    CHECK (status IN ('missing', 'draft', 'ready', 'submitted', 'approved')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(platform, checklist_key)
);

CREATE TABLE IF NOT EXISTS public.provider_cost_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  cost_amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (cost_amount >= 0),
  currency text NOT NULL DEFAULT 'EUR',
  source text NOT NULL DEFAULT 'manual',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.provider_usage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  metric_key text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  usage_value numeric(14, 2) NOT NULL DEFAULT 0 CHECK (usage_value >= 0),
  unit text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quality_budget_definitions (
  budget_key text PRIMARY KEY,
  domain text NOT NULL,
  label text NOT NULL,
  target_value numeric(12, 2) NOT NULL,
  comparison text NOT NULL CHECK (comparison IN ('lte', 'gte')),
  unit text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quality_budget_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_key text NOT NULL REFERENCES public.quality_budget_definitions(budget_key) ON DELETE CASCADE,
  release_version text,
  observed_value numeric(12, 2) NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.data_subject_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_policy_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.native_release_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_metadata_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_cost_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_usage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quality_budget_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quality_budget_observations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admins_select_data_subject_requests ON public.data_subject_requests;
CREATE POLICY admins_select_data_subject_requests ON public.data_subject_requests
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'compliance.manage'));

DROP POLICY IF EXISTS admins_select_data_export_jobs ON public.data_export_jobs;
CREATE POLICY admins_select_data_export_jobs ON public.data_export_jobs
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'compliance.manage'));

DROP POLICY IF EXISTS admins_select_consent_events ON public.consent_events;
CREATE POLICY admins_select_consent_events ON public.consent_events
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'compliance.manage'));

DROP POLICY IF EXISTS admins_select_retention_policy_registry ON public.retention_policy_registry;
CREATE POLICY admins_select_retention_policy_registry ON public.retention_policy_registry
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'compliance.manage'));

DROP POLICY IF EXISTS admins_select_native_release_runs ON public.native_release_runs;
CREATE POLICY admins_select_native_release_runs ON public.native_release_runs
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'store_ops.read'));

DROP POLICY IF EXISTS admins_select_store_review_events ON public.store_review_events;
CREATE POLICY admins_select_store_review_events ON public.store_review_events
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'store_ops.read'));

DROP POLICY IF EXISTS admins_select_store_metadata_checklists ON public.store_metadata_checklists;
CREATE POLICY admins_select_store_metadata_checklists ON public.store_metadata_checklists
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'store_ops.read'));

DROP POLICY IF EXISTS admins_select_provider_cost_snapshots ON public.provider_cost_snapshots;
CREATE POLICY admins_select_provider_cost_snapshots ON public.provider_cost_snapshots
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'cost.read'));

DROP POLICY IF EXISTS admins_select_provider_usage_snapshots ON public.provider_usage_snapshots;
CREATE POLICY admins_select_provider_usage_snapshots ON public.provider_usage_snapshots
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'cost.read'));

DROP POLICY IF EXISTS admins_select_quality_budget_definitions ON public.quality_budget_definitions;
CREATE POLICY admins_select_quality_budget_definitions ON public.quality_budget_definitions
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'cost.read'));

DROP POLICY IF EXISTS admins_select_quality_budget_observations ON public.quality_budget_observations;
CREATE POLICY admins_select_quality_budget_observations ON public.quality_budget_observations
  FOR SELECT USING (public.admin_user_has_permission(auth.uid(), 'cost.read'));

CREATE INDEX IF NOT EXISTS idx_data_export_jobs_creator_time ON public.data_export_jobs(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_events_user_type_time ON public.consent_events(user_id, consent_type, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_cost_snapshots_window ON public.provider_cost_snapshots(provider, window_start, window_end);
CREATE INDEX IF NOT EXISTS idx_quality_budget_observations_budget_time ON public.quality_budget_observations(budget_key, observed_at DESC);

DROP TRIGGER IF EXISTS data_subject_requests_updated_at ON public.data_subject_requests;
CREATE TRIGGER data_subject_requests_updated_at
  BEFORE UPDATE ON public.data_subject_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.retention_policy_registry (policy_key, data_domain, retention_days, legal_basis, enforcement_surface)
VALUES
  ('verification_selfie_review', 'verification_selfie', 180, 'trust_and_safety_review', 'photo_verifications + media lifecycle'),
  ('support_ticket_history', 'support', 730, 'support_and_legal_claims', 'support_tickets'),
  ('moderation_evidence', 'moderation', 730, 'safety_and_legal_claims', 'user_reports + warnings + suspensions'),
  ('notification_logs', 'notifications', 180, 'service_delivery_diagnostics', 'notification_log'),
  ('admin_audit_logs', 'admin_audit', NULL, 'security_and_accountability', 'admin_activity_logs')
ON CONFLICT (policy_key) DO UPDATE
SET data_domain = EXCLUDED.data_domain,
    retention_days = EXCLUDED.retention_days,
    legal_basis = EXCLUDED.legal_basis,
    enforcement_surface = EXCLUDED.enforcement_surface,
    active = true,
    updated_at = now();

INSERT INTO public.quality_budget_definitions (budget_key, domain, label, target_value, comparison, unit)
VALUES
  ('web.app_shell_ready_ms', 'web', 'Web app shell ready', 3000, 'lte', 'ms'),
  ('native.cold_start_ms', 'native', 'Native cold start', 3500, 'lte', 'ms'),
  ('events.list_visible_ms', 'events', 'Event list visible', 2000, 'lte', 'ms'),
  ('media.profile_video_play_ms', 'media', 'Profile video playback start', 2500, 'lte', 'ms'),
  ('video_date.join_ms', 'video_date', 'Video date join', 8000, 'lte', 'ms'),
  ('chat.send_ms', 'chat', 'Chat send latency', 1200, 'lte', 'ms'),
  ('push.send_to_receive_ms', 'push', 'Push send to receive', 15000, 'lte', 'ms'),
  ('release.crash_free_sessions_pct', 'release', 'Crash-free sessions', 99, 'gte', 'percent')
ON CONFLICT (budget_key) DO UPDATE
SET domain = EXCLUDED.domain,
    label = EXCLUDED.label,
    target_value = EXCLUDED.target_value,
    comparison = EXCLUDED.comparison,
    unit = EXCLUDED.unit,
    active = true,
    updated_at = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- Revenue, compliance, cost, and store RPCs
-- ─────────────────────────────────────────────────────────────────────────────

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

  SELECT count(*)::integer INTO v_drift
  FROM public.profiles p
  WHERE p.is_premium IS DISTINCT FROM EXISTS (
    SELECT 1
    FROM public.subscriptions s
    WHERE s.user_id = p.id
      AND s.status IN ('active', 'trialing')
  );

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
    'semantics', 'Stripe and RevenueCat are reconciled into one entitlement view; profile premium state remains backend truth only after subscription/profile synchronization.'
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
        SELECT 1 FROM public.subscriptions s
        WHERE s.user_id = p.id AND s.status IN ('active', 'trialing')
      ) AS has_active_subscription,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('provider', COALESCE(s.provider, 'stripe'), 'status', s.status, 'plan', s.plan, 'current_period_end', s.current_period_end) ORDER BY s.updated_at DESC)
        FROM public.subscriptions s
        WHERE s.user_id = p.id
      ), '[]'::jsonb) AS subscriptions
    FROM public.profiles p
    WHERE p_user_id IS NULL OR p.id = p_user_id
  ),
  marked AS (
    SELECT *,
      profile_is_premium IS DISTINCT FROM has_active_subscription
        AND (premium_until IS NULL OR premium_until <= now()) AS drift
    FROM reconciliation
  )
  SELECT count(*)::integer INTO v_total FROM marked;

  WITH reconciliation AS (
    SELECT
      p.id AS user_id,
      p.name,
      p.is_premium AS profile_is_premium,
      p.subscription_tier,
      p.premium_until,
      EXISTS (
        SELECT 1 FROM public.subscriptions s
        WHERE s.user_id = p.id AND s.status IN ('active', 'trialing')
      ) AS has_active_subscription,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('provider', COALESCE(s.provider, 'stripe'), 'status', s.status, 'plan', s.plan, 'current_period_end', s.current_period_end) ORDER BY s.updated_at DESC)
        FROM public.subscriptions s
        WHERE s.user_id = p.id
      ), '[]'::jsonb) AS subscriptions
    FROM public.profiles p
    WHERE p_user_id IS NULL OR p.id = p_user_id
  ),
  marked AS (
    SELECT *,
      profile_is_premium IS DISTINCT FROM has_active_subscription
        AND (premium_until IS NULL OR premium_until <= now()) AS drift
    FROM reconciliation
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.drift DESC, page.name NULLS LAST), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT *
    FROM marked
    ORDER BY drift DESC, name NULLS LAST
    LIMIT v_limit OFFSET v_offset
  ) page;

  RETURN public.admin_json_success(jsonb_build_object(
    'rows', v_rows,
    'total_count', COALESCE(v_total, 0),
    'limit', v_limit,
    'offset', v_offset,
    'semantics', 'Drift means profile premium state differs from active subscription evidence and no active admin premium_until covers the user.'
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_create_data_export_job(
  p_scope_type text,
  p_scope jsonb,
  p_reason text,
  p_pii_classification text DEFAULT 'sensitive'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_request_id uuid;
  v_job_id uuid;
  v_user_id uuid;
  v_user_id_text text;
  v_rows integer := 0;
  v_audit_id uuid;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'compliance.manage') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Compliance permission is required.');
  END IF;
  IF p_scope_type NOT IN ('user', 'reports', 'support', 'analytics', 'audit') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'Export scope is invalid.');
  END IF;
  IF p_pii_classification NOT IN ('aggregate', 'pseudonymous', 'sensitive', 'special_category') THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'PII classification is invalid.');
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RETURN public.admin_json_error('VALIDATION_ERROR', 'A reason is required for governed exports.');
  END IF;

  v_user_id_text := NULLIF(COALESCE(p_scope, '{}'::jsonb) ->> 'user_id', '');
  IF p_scope_type = 'user' THEN
    IF v_user_id_text IS NULL THEN
      RETURN public.admin_json_error('VALIDATION_ERROR', 'User export scope requires user_id.');
    END IF;
    IF v_user_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
      RETURN public.admin_json_error('VALIDATION_ERROR', 'User export scope user_id is invalid.');
    END IF;

    v_user_id := v_user_id_text::uuid;
    SELECT
      (SELECT count(*) FROM public.profiles WHERE id = v_user_id)
      + (SELECT count(*) FROM public.support_tickets WHERE user_id = v_user_id)
      + (SELECT count(*) FROM public.user_reports WHERE reporter_id = v_user_id OR reported_id = v_user_id)
      + (SELECT count(*) FROM public.event_registrations WHERE profile_id = v_user_id)
    INTO v_rows;
  ELSIF p_scope_type = 'reports' THEN
    SELECT count(*)::integer INTO v_rows FROM public.user_reports;
  ELSIF p_scope_type = 'support' THEN
    SELECT count(*)::integer INTO v_rows FROM public.support_tickets;
  ELSIF p_scope_type = 'audit' THEN
    SELECT count(*)::integer INTO v_rows FROM public.admin_activity_logs;
  ELSE
    v_rows := 0;
  END IF;

  INSERT INTO public.data_subject_requests (
    user_id,
    request_type,
    status,
    reason,
    requested_by,
    metadata
  ) VALUES (
    v_user_id,
    CASE WHEN p_scope_type = 'user' THEN 'export' ELSE 'access' END,
    'queued',
    p_reason,
    v_admin_id,
    jsonb_build_object('scope_type', p_scope_type, 'scope', COALESCE(p_scope, '{}'::jsonb))
  )
  RETURNING id INTO v_request_id;

  INSERT INTO public.data_export_jobs (
    request_id,
    created_by,
    scope_type,
    scope,
    reason,
    pii_classification,
    row_count_estimate
  ) VALUES (
    v_request_id,
    v_admin_id,
    p_scope_type,
    COALESCE(p_scope, '{}'::jsonb),
    p_reason,
    p_pii_classification,
    COALESCE(v_rows, 0)
  )
  RETURNING id INTO v_job_id;

  v_audit_id := public.log_admin_action(
    'compliance.export_queued',
    'data_export_job',
    v_job_id,
    jsonb_build_object(
      'request_id', v_request_id,
      'scope_type', p_scope_type,
      'scope', COALESCE(p_scope, '{}'::jsonb),
      'pii_classification', p_pii_classification,
      'row_count_estimate', COALESCE(v_rows, 0),
      'expires_in_days', 7
    )
  );

  RETURN public.admin_json_success(jsonb_build_object(
    'request_id', v_request_id,
    'job_id', v_job_id,
    'status', 'queued',
    'row_count_estimate', COALESCE(v_rows, 0),
    'expires_at', (now() + interval '7 days'),
    'audit_log_id', v_audit_id,
    'storage_path', NULL,
    'generation_semantics', 'P4 queues an audited governed export job. File generation/storage delivery remains a controlled worker step.'
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_cost_capacity_metrics(
  p_window_start timestamptz DEFAULT NULL,
  p_window_end timestamptz DEFAULT NULL
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
  v_costs jsonb;
  v_usage jsonb;
  v_active_users integer := 0;
  v_events integer := 0;
  v_matches integer := 0;
  v_video_minutes numeric := 0;
  v_total_cost numeric := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'cost.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Cost permission is required.');
  END IF;

  SELECT COALESCE(sum(cost_amount), 0) INTO v_total_cost
  FROM public.provider_cost_snapshots
  WHERE window_start >= v_start AND window_end <= v_end;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('provider', provider, 'cost_amount', cost_amount, 'currency', currency, 'window_start', window_start, 'window_end', window_end, 'source', source) ORDER BY provider), '[]'::jsonb)
  INTO v_costs
  FROM public.provider_cost_snapshots
  WHERE window_start >= v_start AND window_end <= v_end;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('provider', provider, 'metric_key', metric_key, 'usage_value', usage_value, 'unit', unit, 'source', source) ORDER BY provider, metric_key), '[]'::jsonb)
  INTO v_usage
  FROM public.provider_usage_snapshots
  WHERE window_start >= v_start AND window_end <= v_end;

  SELECT count(*)::integer INTO v_active_users
  FROM public.profiles
  WHERE last_seen_at >= v_start AND last_seen_at < v_end;

  SELECT count(*)::integer INTO v_events
  FROM public.events
  WHERE event_date >= v_start AND event_date < v_end;

  SELECT count(*)::integer INTO v_matches
  FROM public.matches
  WHERE matched_at >= v_start AND matched_at < v_end;

  SELECT COALESCE(sum(duration_seconds)::numeric / 60, 0) INTO v_video_minutes
  FROM public.video_sessions
  WHERE started_at >= v_start AND started_at < v_end;

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', now(),
    'reporting_timezone', 'UTC',
    'window_start', v_start,
    'window_end', v_end,
    'provider_costs', v_costs,
    'provider_usage', v_usage,
    'derived_usage', jsonb_build_object(
      'active_users', v_active_users,
      'events', v_events,
      'matches', v_matches,
      'video_minutes', round(v_video_minutes, 2)
    ),
    'unit_economics', jsonb_build_object(
      'cost_per_active_user', CASE WHEN v_active_users > 0 THEN round(v_total_cost / v_active_users, 2) ELSE NULL END,
      'cost_per_event', CASE WHEN v_events > 0 THEN round(v_total_cost / v_events, 2) ELSE NULL END,
      'cost_per_match', CASE WHEN v_matches > 0 THEN round(v_total_cost / v_matches, 2) ELSE NULL END,
      'cost_per_video_minute', CASE WHEN v_video_minutes > 0 THEN round(v_total_cost / v_video_minutes, 2) ELSE NULL END
    ),
    'semantics', 'Provider cost snapshots are manually/provider-imported evidence and are never product-state truth.'
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_quality_scorecard(p_release_version text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_rows jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'cost.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Cost and quality permission is required.');
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'budget_key', qbd.budget_key,
      'domain', qbd.domain,
      'label', qbd.label,
      'target_value', qbd.target_value,
      'comparison', qbd.comparison,
      'unit', qbd.unit,
      'latest_observed_value', latest.observed_value,
      'latest_release_version', latest.release_version,
      'latest_observed_at', latest.observed_at,
      'status', CASE
        WHEN latest.observed_value IS NULL THEN 'missing'
        WHEN qbd.comparison = 'lte' AND latest.observed_value <= qbd.target_value THEN 'within_budget'
        WHEN qbd.comparison = 'gte' AND latest.observed_value >= qbd.target_value THEN 'within_budget'
        ELSE 'over_budget'
      END
    )
    ORDER BY qbd.domain, qbd.budget_key
  ), '[]'::jsonb)
  INTO v_rows
  FROM public.quality_budget_definitions qbd
  LEFT JOIN LATERAL (
    SELECT qbo.*
    FROM public.quality_budget_observations qbo
    WHERE qbo.budget_key = qbd.budget_key
      AND (p_release_version IS NULL OR qbo.release_version = p_release_version)
    ORDER BY qbo.observed_at DESC
    LIMIT 1
  ) latest ON true
  WHERE qbd.active IS TRUE;

  RETURN public.admin_json_success(jsonb_build_object(
    'release_version', p_release_version,
    'rows', v_rows,
    'semantics', 'Quality budgets are release evidence. Missing observations are not passes.'
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_store_operations_metrics(
  p_window_start timestamptz DEFAULT NULL,
  p_window_end timestamptz DEFAULT NULL
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
  v_releases jsonb;
  v_reviews jsonb;
  v_checklists jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;
  IF NOT public.admin_user_has_permission(v_admin_id, 'store_ops.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Store operations permission is required.');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(nrr) ORDER BY nrr.created_at DESC), '[]'::jsonb)
  INTO v_releases
  FROM (
    SELECT * FROM public.native_release_runs
    WHERE created_at >= v_start AND created_at < v_end
    ORDER BY created_at DESC
    LIMIT 25
  ) nrr;

  SELECT COALESCE(jsonb_agg(to_jsonb(sre) ORDER BY sre.observed_at DESC), '[]'::jsonb)
  INTO v_reviews
  FROM (
    SELECT * FROM public.store_review_events
    WHERE observed_at >= v_start AND observed_at < v_end
    ORDER BY observed_at DESC
    LIMIT 50
  ) sre;

  SELECT COALESCE(jsonb_agg(to_jsonb(smc) ORDER BY smc.platform, smc.checklist_key), '[]'::jsonb)
  INTO v_checklists
  FROM public.store_metadata_checklists smc;

  RETURN public.admin_json_success(jsonb_build_object(
    'generated_at', now(),
    'window_start', v_start,
    'window_end', v_end,
    'release_runs', v_releases,
    'review_events', v_reviews,
    'metadata_checklists', v_checklists,
    'semantics', 'Store operations are manual evidence ledgers for TestFlight/Play/App Review readiness; they do not modify store/provider dashboards.'
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_revenue_intelligence(timestamptz, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_entitlement_reconciliation(uuid, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_data_export_job(text, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_cost_capacity_metrics(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_quality_scorecard(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_store_operations_metrics(timestamptz, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_get_revenue_intelligence(timestamptz, timestamptz, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_entitlement_reconciliation(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_data_export_job(text, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_cost_capacity_metrics(timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_quality_scorecard(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_store_operations_metrics(timestamptz, timestamptz) TO authenticated;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260506134000',
  'P4 revenue compliance store cost quality',
  'schema+policy',
  'Adds revenue intelligence, governed export job metadata, store ops evidence, cost snapshots, and quality budgets. Export file generation is queued/deferred; no provider mutation.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

COMMENT ON FUNCTION public.admin_create_data_export_job(text, jsonb, text, text) IS
  'P4 governed export queue. Requires compliance permission, reason, scope, PII classification, audit log, and expiry.';
