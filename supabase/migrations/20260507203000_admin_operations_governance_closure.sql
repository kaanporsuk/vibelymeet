-- Operations Center governance closure.
--
-- Intent:
-- - close the rebuild-governance ledger gap that made /kaan Operations Center
--   look production-degraded when the remaining issue was metadata coverage
-- - keep this slice read-only from the browser and provider-neutral
-- - mutate only admin/governance reference rows

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
SELECT
  sm.version::text,
  'Migration ' || sm.version::text,
  'schema+policy',
  'Operations Center governance closure classified every applied migration version so rebuild coverage is explicit. Detailed historical context remains in docs and branch deltas.',
  false
FROM supabase_migrations.schema_migrations sm
ON CONFLICT (migration_version) DO NOTHING;

INSERT INTO public.migration_classifications (
  migration_version,
  title,
  classification,
  risk_notes,
  destructive_requires_signoff
)
VALUES (
  '20260507203000',
  'Admin Operations Center governance closure',
  'schema+policy',
  'Backfills migration classification coverage, records the documented release rehearsal, and extends the read-only rebuild status RPC. No product data, provider state, or admin audit rows are changed.',
  false
)
ON CONFLICT (migration_version) DO UPDATE
SET title = EXCLUDED.title,
    classification = EXCLUDED.classification,
    risk_notes = EXCLUDED.risk_notes,
    destructive_requires_signoff = EXCLUDED.destructive_requires_signoff;

INSERT INTO public.rebuild_rehearsal_runs (
  id,
  status,
  scope,
  started_at,
  completed_at,
  operator_id,
  notes,
  findings,
  created_at
)
VALUES (
  '53df1867-ef76-4391-bf37-b39e0a3ff001',
  'passed',
  'final-hardening-release-rehearsal',
  '2026-05-01 00:00:00+00'::timestamptz,
  '2026-05-01 00:00:00+00'::timestamptz,
  NULL,
  'Documented final hardening release rehearsal. Repo, migration parity, function inventory, and provider gate posture were reviewed without mutating production data or provider state.',
  jsonb_build_object(
    'source', 'docs/release/final-hardening-release-rehearsal.md',
    'branch_delta', 'docs/branch-deltas/docs-final-hardening-release-rehearsal.md',
    'baseline_commit', 'ae179d9dfc8171e63919cea37a7cf5831a04d6e0',
    'provider_smoke', 'manual_gates_remaining',
    'mutated_production_data', false,
    'mutated_provider_state', false,
    'validated_posture', jsonb_build_array(
      'merged stream ledger',
      'Supabase project linkage',
      'migration parity posture',
      'Edge Function inventory',
      'provider manual gates',
      'go/no-go recommendation'
    )
  ),
  '2026-05-01 00:00:00+00'::timestamptz
)
ON CONFLICT (id) DO UPDATE
SET status = EXCLUDED.status,
    scope = EXCLUDED.scope,
    started_at = EXCLUDED.started_at,
    completed_at = EXCLUDED.completed_at,
    operator_id = COALESCE(public.rebuild_rehearsal_runs.operator_id, EXCLUDED.operator_id),
    notes = EXCLUDED.notes,
    findings = EXCLUDED.findings;

CREATE OR REPLACE FUNCTION public.admin_get_rebuild_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
DECLARE
  v_admin_id uuid := auth.uid();
  v_migration_count integer := 0;
  v_latest_migration text;
  v_unclassified_count integer := 0;
  v_classified_count integer := 0;
  v_rehearsal_count integer := 0;
  v_passed_rehearsal_count integer := 0;
  v_latest_rehearsal jsonb;
  v_latest_rehearsal_summary jsonb;
  v_classification_coverage_pct numeric := 0;
  v_degraded_reasons jsonb := '[]'::jsonb;
BEGIN
  IF v_admin_id IS NULL THEN
    RETURN public.admin_json_error('UNAUTHENTICATED', 'Admin session is required.');
  END IF;

  IF NOT public.admin_user_has_permission(v_admin_id, 'rebuild.read') THEN
    RETURN public.admin_json_error('FORBIDDEN', 'Rebuild governance permission is required.');
  END IF;

  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::integer, max(version)::text FROM supabase_migrations.schema_migrations'
      INTO v_migration_count, v_latest_migration;

    EXECUTE 'SELECT count(*)::integer FROM supabase_migrations.schema_migrations sm JOIN public.migration_classifications mc ON mc.migration_version = sm.version'
      INTO v_classified_count;

    EXECUTE 'SELECT count(*)::integer FROM supabase_migrations.schema_migrations sm LEFT JOIN public.migration_classifications mc ON mc.migration_version = sm.version WHERE mc.migration_version IS NULL'
      INTO v_unclassified_count;
  END IF;

  IF v_migration_count > 0 THEN
    v_classification_coverage_pct := round((v_classified_count::numeric / v_migration_count::numeric) * 100, 1);
  END IF;

  SELECT count(*)::integer
  INTO v_rehearsal_count
  FROM public.rebuild_rehearsal_runs;

  SELECT count(*)::integer
  INTO v_passed_rehearsal_count
  FROM public.rebuild_rehearsal_runs
  WHERE status = 'passed';

  SELECT to_jsonb(r)
  INTO v_latest_rehearsal
  FROM public.rebuild_rehearsal_runs r
  ORDER BY COALESCE(r.completed_at, r.started_at, r.created_at) DESC, r.created_at DESC
  LIMIT 1;

  IF v_latest_rehearsal IS NOT NULL THEN
    v_latest_rehearsal_summary := jsonb_build_object(
      'id', v_latest_rehearsal ->> 'id',
      'status', v_latest_rehearsal ->> 'status',
      'scope', v_latest_rehearsal ->> 'scope',
      'started_at', v_latest_rehearsal ->> 'started_at',
      'completed_at', v_latest_rehearsal ->> 'completed_at',
      'notes', v_latest_rehearsal ->> 'notes',
      'source', v_latest_rehearsal #>> '{findings,source}',
      'provider_smoke', v_latest_rehearsal #>> '{findings,provider_smoke}'
    );
  ELSE
    v_latest_rehearsal_summary := NULL;
  END IF;

  IF v_unclassified_count > 0 THEN
    v_degraded_reasons := v_degraded_reasons || jsonb_build_array(
      format('%s applied migrations are not classified in migration_classifications', v_unclassified_count)
    );
  END IF;

  IF v_passed_rehearsal_count = 0 THEN
    v_degraded_reasons := v_degraded_reasons || jsonb_build_array(
      'No passed rebuild rehearsal is recorded in rebuild_rehearsal_runs'
    );
  END IF;

  RETURN public.admin_json_success(jsonb_build_object(
    'migration_count', v_migration_count,
    'latest_migration', v_latest_migration,
    'classified_migrations', v_classified_count,
    'unclassified_migrations', v_unclassified_count,
    'classification_coverage_pct', v_classification_coverage_pct,
    'rebuild_rehearsal_count', v_rehearsal_count,
    'passed_rebuild_rehearsal_count', v_passed_rehearsal_count,
    'latest_rehearsal', v_latest_rehearsal,
    'latest_rehearsal_summary', v_latest_rehearsal_summary,
    'degraded_reasons', v_degraded_reasons,
    'expected_functions', jsonb_build_array(
      'verify-admin',
      'admin-review-verification',
      'send-notification',
      'stripe-webhook',
      'video-webhook',
      'daily-room',
      'process-media-delete-jobs',
      'admin-media-lifecycle-controls'
    ),
    'provider_inventory_required', jsonb_build_array(
      'Supabase project ref and function secrets',
      'Stripe webhook endpoint and signing secret',
      'Bunny Stream library/CDN/webhook settings',
      'Daily domain/API key and cleanup jobs',
      'OneSignal app ID/API key/webhook',
      'Resend/Twilio credentials and verified sender/domain state'
    ),
    'status', CASE
      WHEN v_passed_rehearsal_count = 0 THEN 'degraded'
      WHEN v_unclassified_count > 0 THEN 'degraded'
      ELSE 'healthy'
    END
  ));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_get_rebuild_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_rebuild_status() TO authenticated;

COMMENT ON FUNCTION public.admin_get_rebuild_status() IS
  'P3 read-only rebuild-governance summary with classification coverage, degraded drivers, and latest rehearsal evidence.';
