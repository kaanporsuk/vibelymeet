-- P4 growth-scale intelligence validation pack.
-- File: admin_p4_growth_scale_intelligence.sql
-- Read-only assertions for schema/RPC presence, ACL posture, permission rows,
-- RLS enablement, and deterministic score bounds.

DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(permission_key ORDER BY permission_key)
  INTO v_missing
  FROM (
    VALUES
      ('intelligence.read'),
      ('experiments.manage'),
      ('growth.read'),
      ('trust.triage'),
      ('revenue.read'),
      ('compliance.manage'),
      ('support.manage'),
      ('store_ops.read'),
      ('cost.read')
  ) expected(permission_key)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.admin_permissions ap WHERE ap.permission = expected.permission_key
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing P4 admin permissions: %', v_missing;
  END IF;
END $$;

DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(table_name ORDER BY table_name)
  INTO v_missing
  FROM (
    VALUES
      ('product_metric_definitions'),
      ('moderation_policy_categories'),
      ('trust_triage_snapshots'),
      ('moderation_recommendations'),
      ('moderation_appeals'),
      ('support_response_templates'),
      ('support_ticket_events'),
      ('support_internal_notes'),
      ('feature_flags'),
      ('experiments'),
      ('experiment_variants'),
      ('experiment_assignments'),
      ('experiment_exposures'),
      ('growth_attribution_events'),
      ('invite_attribution_claims'),
      ('referral_quality_snapshots'),
      ('data_subject_requests'),
      ('data_export_jobs'),
      ('consent_events'),
      ('retention_policy_registry'),
      ('native_release_runs'),
      ('store_review_events'),
      ('store_metadata_checklists'),
      ('provider_cost_snapshots'),
      ('provider_usage_snapshots'),
      ('quality_budget_definitions'),
      ('quality_budget_observations')
  ) expected(table_name)
  WHERE to_regclass('public.' || expected.table_name) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing P4 tables: %', v_missing;
  END IF;
END $$;

DO $$
DECLARE
  v_unprotected text[];
BEGIN
  SELECT array_agg(relname ORDER BY relname)
  INTO v_unprotected
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname IN (
      'product_metric_definitions',
      'moderation_policy_categories',
      'trust_triage_snapshots',
      'moderation_recommendations',
      'moderation_appeals',
      'support_response_templates',
      'support_ticket_events',
      'support_internal_notes',
      'feature_flags',
      'experiments',
      'experiment_variants',
      'experiment_assignments',
      'experiment_exposures',
      'growth_attribution_events',
      'invite_attribution_claims',
      'referral_quality_snapshots',
      'data_subject_requests',
      'data_export_jobs',
      'consent_events',
      'retention_policy_registry',
      'native_release_runs',
      'store_review_events',
      'store_metadata_checklists',
      'provider_cost_snapshots',
      'provider_usage_snapshots',
      'quality_budget_definitions',
      'quality_budget_observations'
    )
    AND c.relrowsecurity IS DISTINCT FROM true;

  IF v_unprotected IS NOT NULL THEN
    RAISE EXCEPTION 'P4 tables without RLS: %', v_unprotected;
  END IF;
END $$;

DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(function_name ORDER BY function_name)
  INTO v_missing
  FROM (
    VALUES
      ('admin_get_product_intelligence_metrics'),
      ('admin_get_event_liquidity_metrics'),
      ('admin_get_match_quality_metrics'),
      ('admin_get_retention_activation_metrics'),
      ('admin_get_trust_triage_queue'),
      ('admin_get_user_trust_timeline'),
      ('admin_get_authenticity_operations'),
      ('admin_record_moderation_recommendation_decision'),
      ('admin_get_support_timeline'),
      ('admin_resolve_report_with_policy'),
      ('resolve_experiment_assignment'),
      ('record_experiment_exposure'),
      ('admin_get_experiment_metrics'),
      ('admin_update_experiment_status'),
      ('record_growth_attribution_event'),
      ('claim_growth_attribution'),
      ('admin_get_revenue_intelligence'),
      ('admin_get_entitlement_reconciliation'),
      ('admin_create_data_export_job'),
      ('admin_list_data_export_jobs'),
      ('admin_get_data_export_job'),
      ('admin_get_cost_capacity_metrics'),
      ('admin_get_quality_scorecard'),
      ('admin_get_store_operations_metrics')
  ) expected(function_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = expected.function_name
      AND p.prosecdef IS TRUE
      AND array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_catalog%'
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing or unpinned P4 SECURITY DEFINER functions: %', v_missing;
  END IF;
END $$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_get_product_intelligence_metrics(timestamptz,timestamptz,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_get_product_intelligence_metrics is executable by anon';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.admin_get_product_intelligence_metrics(timestamptz,timestamptz,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_get_product_intelligence_metrics is not executable by authenticated users';
  END IF;

  IF has_function_privilege('anon', 'public.admin_create_data_export_job(text,jsonb,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_create_data_export_job is executable by anon';
  END IF;

  IF has_function_privilege('anon', 'public.admin_list_data_export_jobs(integer,integer,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_list_data_export_jobs is executable by anon';
  END IF;

  IF has_function_privilege('anon', 'public.admin_get_data_export_job(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_get_data_export_job is executable by anon';
  END IF;

  IF NOT has_function_privilege('anon', 'public.record_growth_attribution_event(text,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'record_growth_attribution_event is not executable by anon';
  END IF;
END $$;

DO $$
DECLARE
  v_constraint text;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
  INTO v_constraint
  FROM pg_constraint c
  WHERE c.conname = 'data_export_jobs_scope_type_check'
    AND c.conrelid = 'public.data_export_jobs'::regclass;

  IF v_constraint IS NULL
    OR v_constraint NOT LIKE '%events%'
    OR v_constraint NOT LIKE '%revenue%'
    OR v_constraint NOT LIKE '%messages%'
    OR v_constraint NOT LIKE '%notifications%'
    OR v_constraint NOT LIKE '%operations%'
    OR v_constraint NOT LIKE '%intelligence%'
    OR v_constraint NOT LIKE '%compliance%' THEN
    RAISE EXCEPTION 'data_export_jobs scope constraint does not include expanded P4 export scopes';
  END IF;
END $$;

DO $$
DECLARE
  v_invalid_count integer;
BEGIN
  SELECT count(*)::integer
  INTO v_invalid_count
  FROM public.quality_budget_definitions
  WHERE active IS TRUE
    AND (
      target_value < 0
      OR comparison NOT IN ('lte', 'gte')
      OR budget_key = ''
    );

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Invalid quality budget definitions: %', v_invalid_count;
  END IF;
END $$;
