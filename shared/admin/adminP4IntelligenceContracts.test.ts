import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeProductIntelligenceProperties } from "../analytics/productIntelligence";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const p4Migrations = [
  "supabase/migrations/20260506130000_admin_p4_intelligence_foundation.sql",
  "supabase/migrations/20260506131000_admin_p4_event_match_intelligence.sql",
  "supabase/migrations/20260506132000_admin_p4_trust_support_compliance.sql",
  "supabase/migrations/20260506133000_admin_p4_experiments_growth.sql",
  "supabase/migrations/20260506134000_admin_p4_revenue_store_cost_quality.sql",
  "supabase/migrations/20260507100000_admin_governed_export_queue_read_model.sql",
].map(read).join("\n");

const validation = read("supabase/validation/admin_p4_growth_scale_intelligence.sql");
const dashboard = read("src/pages/admin/AdminDashboard.tsx");
const sidebar = read("src/components/admin/AdminSidebar.tsx");
const intelligencePanel = read("src/components/admin/AdminP4IntelligencePanel.tsx");
const exportPanel = read("src/components/admin/AdminExportPanel.tsx");
const reportsPanel = read("src/components/admin/AdminReportsPanel.tsx");
const taxonomy = read("shared/analytics/productIntelligence.ts");
const webAnalytics = read("src/lib/analytics.ts");
const nativeAnalytics = read("apps/mobile/lib/analytics.ts");
const growthFunction = read("supabase/functions/record-growth-attribution/index.ts");
const exportFunction = read("supabase/functions/admin-data-export/index.ts");
const functionConfig = read("supabase/config.toml");
const packageJson = read("package.json");
const branchDelta = read("docs/branch-deltas/admin-p4-growth-scale-intelligence.md");

function fnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = p4Migrations.lastIndexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const next = p4Migrations.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const revoke = p4Migrations.indexOf("\nREVOKE ALL ON FUNCTION", start + marker.length);
  const migrationEnd = p4Migrations.indexOf("\nINSERT INTO public.migration_classifications", start + marker.length);
  const candidates = [next, revoke, migrationEnd].filter((index) => index !== -1);
  const end = candidates.length ? Math.min(...candidates) : p4Migrations.length;
  return p4Migrations.slice(start, end);
}

const adminReadRpcs = [
  "admin_get_product_intelligence_metrics",
  "admin_get_event_liquidity_metrics",
  "admin_get_match_quality_metrics",
  "admin_get_retention_activation_metrics",
  "admin_get_trust_triage_queue",
  "admin_get_user_trust_timeline",
  "admin_get_authenticity_operations",
  "admin_get_support_timeline",
  "admin_get_revenue_intelligence",
  "admin_get_entitlement_reconciliation",
  "admin_list_data_export_jobs",
  "admin_get_data_export_job",
  "admin_get_cost_capacity_metrics",
  "admin_get_quality_scorecard",
  "admin_get_store_operations_metrics",
];

test("P4 migrations add permissions, tables, validation, and rebuild delta", () => {
  for (const permission of [
    "intelligence.read",
    "experiments.manage",
    "growth.read",
    "trust.triage",
    "revenue.read",
    "compliance.manage",
    "support.manage",
    "store_ops.read",
    "cost.read",
  ]) {
    assert.match(p4Migrations, new RegExp(`'${permission}'`));
    assert.match(validation, new RegExp(permission.replace(".", "\\.")));
  }

  for (const table of [
    "product_metric_definitions",
    "moderation_policy_categories",
    "trust_triage_snapshots",
    "moderation_recommendations",
    "moderation_appeals",
    "support_response_templates",
    "support_ticket_events",
    "support_internal_notes",
    "feature_flags",
    "experiments",
    "experiment_variants",
    "experiment_assignments",
    "experiment_exposures",
    "growth_attribution_events",
    "invite_attribution_claims",
    "referral_quality_snapshots",
    "data_subject_requests",
    "data_export_jobs",
    "consent_events",
    "retention_policy_registry",
    "native_release_runs",
    "store_review_events",
    "store_metadata_checklists",
    "provider_cost_snapshots",
    "provider_usage_snapshots",
    "quality_budget_definitions",
    "quality_budget_observations",
  ]) {
    assert.match(p4Migrations, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`), `missing table ${table}`);
    assert.match(p4Migrations, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`), `${table} must enable RLS`);
  }

  assert.match(validation, /admin_p4_growth_scale_intelligence/);
  assert.match(validation, /ap\.permission = expected\.permission_key/);
  assert.doesNotMatch(validation, /ap\.permission_key/);
  assert.match(branchDelta, /Admin P4 Growth-Scale Intelligence Rebuild Delta/);
});

test("P4 admin read RPCs are security definer, permission checked, ACL pinned, and read-only", () => {
  const writeStatement = /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\s/im;
  for (const fn of adminReadRpcs) {
    const source = fnSection(fn);
    assert.match(source, /SECURITY DEFINER/, `${fn} must be security definer`);
    assert.match(source, /SET search_path = public, pg_catalog/, `${fn} must pin search_path`);
    assert.match(source, /auth\.uid\(\)/, `${fn} must derive caller from auth.uid()`);
    assert.match(source, /admin_user_has_permission/, `${fn} must check backend permission`);
    assert.match(p4Migrations, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`), `${fn} must revoke PUBLIC`);
    assert.match(p4Migrations, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`), `${fn} must grant authenticated`);
    assert.doesNotMatch(source, writeStatement, `${fn} must stay read-only`);
  }
});

test("P4 scoring RPCs are deterministic advisory signals only", () => {
  const eventLiquidity = fnSection("admin_get_event_liquidity_metrics");
  const matchQuality = fnSection("admin_get_match_quality_metrics");
  const trustQueue = fnSection("admin_get_trust_triage_queue");

  assert.match(eventLiquidity, /score_semantics/);
  assert.match(eventLiquidity, /does not alter event visibility, matching, ranking, or enforcement/);
  assert.match(eventLiquidity, /registrations/);
  assert.match(eventLiquidity, /participant_reports/);
  assert.match(matchQuality, /quality_score/);
  assert.match(matchQuality, /does not alter matching\/ranking in P4/);
  assert.match(trustQueue, /er\.attended IS NOT TRUE/);
  assert.match(trustQueue, /er\.attendance_marked IS NOT TRUE/);
  assert.match(trustQueue, /OR active_suspensions > 0/);
  assert.match(trustQueue, /Advisory triage only/);
  assert.match(trustQueue, /Suspensions, warnings, bans, refunds, deletes, and revocations remain human-confirmed/);
});

test("P4 experiment and growth contracts avoid client-owned authority", () => {
  const resolveExperiment = fnSection("resolve_experiment_assignment");
  const exposure = fnSection("record_experiment_exposure");
  const growthCapture = fnSection("record_growth_attribution_event");
  const growthClaim = fnSection("claim_growth_attribution");

  assert.match(resolveExperiment, /auth\.uid\(\)/);
  assert.match(resolveExperiment, /hashtext/);
  assert.match(resolveExperiment, /rollout_percentage/);
  assert.match(resolveExperiment, /ON CONFLICT \(experiment_id, user_id\) DO NOTHING/);
  assert.match(resolveExperiment, /existing_assignment', true/);
  assert.match(exposure, /experiment_exposures/);
  assert.match(exposure, /auth\.uid\(\)/);
  assert.match(exposure, /Exposure surface must be a stable non-PII token/);
  assert.match(growthCapture, /md5\(v_token\)/);
  assert.doesNotMatch(growthCapture, /p_user_id/);
  assert.match(growthCapture, /Referral token must be an opaque non-PII token/);
  assert.match(growthCapture, /v_surface := 'unknown'/);
  assert.match(growthClaim, /auth\.uid\(\)/);
  assert.match(growthClaim, /apply_referral_attribution/);
  assert.match(p4Migrations, /GRANT EXECUTE ON FUNCTION public\.record_growth_attribution_event\(text, text, text, jsonb\) TO anon, authenticated/);
});

test("P4 compliance export queue requires reason, permission, audit, and expiry", () => {
  const exportJob = fnSection("admin_create_data_export_job");
  assert.match(exportJob, /compliance\.manage/);
  assert.match(exportJob, /A reason is required for governed exports/);
  assert.match(exportJob, /User export scope requires user_id/);
  assert.match(exportJob, /User export scope user_id is invalid/);
  assert.match(exportJob, /requires special_category PII classification/);
  assert.match(exportJob, /requires sensitive PII classification or higher/);
  assert.match(exportJob, /requires pseudonymous PII classification or higher/);
  for (const scope of [
    "events",
    "revenue",
    "messages",
    "notifications",
    "operations",
    "intelligence",
    "compliance",
  ]) {
    assert.match(exportJob, new RegExp(`'${scope}'`), `missing governed export scope ${scope}`);
  }
  assert.match(exportJob, /data_subject_requests/);
  assert.match(exportJob, /data_export_jobs/);
  assert.match(exportJob, /log_admin_action/);
  assert.match(exportJob, /expires_in_days/);
  assert.match(exportJob, /File generation\/storage delivery remains a controlled worker step/);
  assert.match(p4Migrations, /REVOKE ALL ON FUNCTION public\.admin_create_data_export_job\(text, jsonb, text, text\) FROM PUBLIC/);
  assert.match(p4Migrations, /REVOKE ALL ON FUNCTION public\.admin_list_data_export_jobs\(integer, integer, jsonb\) FROM PUBLIC/);
  assert.match(p4Migrations, /REVOKE ALL ON FUNCTION public\.admin_get_data_export_job\(uuid\) FROM PUBLIC/);
  assert.match(exportPanel, /supabase\.functions\.invoke\("admin-data-export"/);
  assert.match(exportPanel, /admin_list_data_export_jobs/);
  assert.match(exportPanel, /admin_has_permission/);
  assert.match(exportPanel, /compliance\.manage/);
  assert.match(exportPanel, /Compliance permission unavailable/);
  assert.match(exportPanel, /hasCompliancePermission !== true/);
  assert.match(exportPanel, /sanitizeAdminRpcErrorMessage/);
  assert.match(exportPanel, /Governed export queue is the only export path/);
  assert.match(exportPanel, /isPiiAllowedForScope/);
  assert.match(exportPanel, /Minimum for this scope/);
  assert.match(exportPanel, /T00:00:00\.000Z/);
  assert.match(exportPanel, /T23:59:59\.999Z/);
  assert.match(exportPanel, /hasInvalidDateRange/);
  assert.match(exportPanel, /will not fall back to all-time data/);
  assert.match(exportPanel, /Printable HTML \/ Save as PDF/);
  assert.match(dashboard, /Queue governed audited exports/);
  assert.doesNotMatch(exportPanel, /Legacy Quick Local Export/);
  assert.doesNotMatch(exportPanel, /not compliance-grade/);
  assert.doesNotMatch(exportPanel, /not the compliance export-of-record/);
  assert.doesNotMatch(exportPanel, /CSV_FORMULA_PREFIXES/);
  assert.doesNotMatch(exportPanel, /trimStart\(\)/);
  assert.doesNotMatch(exportPanel, /fetchAllPages/);
  assert.doesNotMatch(exportPanel, /Event Registration Count/);
  assert.doesNotMatch(exportPanel, /supabase\s*\.\s*from\(/);
  assert.doesNotMatch(exportPanel, /new Blob|URL\.createObjectURL|window\.open/);
  assert.doesNotMatch(exportPanel, /AdminConfirmDialog/);
  assert.doesNotMatch(exportPanel, /Events Attended/);
  assert.doesNotMatch(exportPanel, /Event Attendance/);
  assert.doesNotMatch(dashboard, /Queue audited exports or run legacy CSV\/printable HTML/);
  assert.doesNotMatch(dashboard, /Download platform data as CSV\/PDF/);
});

test("P4 /kaan Intelligence panel is wired through admin RPCs only", () => {
  assert.match(dashboard, /AdminP4IntelligencePanel/);
  assert.match(dashboard, /'intelligence'/);
  assert.match(sidebar, /label: 'Intelligence'/);
  assert.match(intelligencePanel, /callAdminRpc<AdminMetricPayload>\("admin_get_product_intelligence_metrics"/);
  assert.match(intelligencePanel, /callAdminRpc<AdminMetricPayload>\("admin_get_event_liquidity_metrics"/);
  assert.match(intelligencePanel, /callAdminRpc<AdminMetricPayload>\("admin_get_match_quality_metrics"/);
  assert.match(intelligencePanel, /callAdminRpc<AdminMetricPayload>\("admin_get_revenue_intelligence"/);
  assert.match(intelligencePanel, /callAdminRpc<AdminMetricPayload>\("admin_get_trust_triage_queue"/);
  assert.match(intelligencePanel, /callAdminRpc<AdminMetricPayload>\("admin_get_cost_capacity_metrics"/);
  assert.match(intelligencePanel, /Scores are advisory/);
  assert.match(intelligencePanel, /verified_new_profiles/);
  assert.match(intelligencePanel, /profile_photo_users/);
  assert.match(intelligencePanel, /event_registered_users/);
  assert.match(intelligencePanel, /d7_retained_users/);
  assert.match(intelligencePanel, /completed_sessions/);
  assert.match(intelligencePanel, /data\?\.authenticity\?\.queue/);
  assert.match(intelligencePanel, /return "Unavailable"/);
  for (const stalePayloadKey of [
    "verified_signups",
    "mutual_matches",
    "reports_submitted",
    "activated_users",
    "d1_returned",
    "d30_returned",
    "completed_video_dates",
    "report_block_penalty",
    "authenticity.queues",
  ]) {
    assert.doesNotMatch(intelligencePanel, new RegExp(stalePayloadKey.replace(".", "\\.")), `stale P4 payload key still present: ${stalePayloadKey}`);
  }
  assert.doesNotMatch(intelligencePanel, /\.from\(["']/);
  assert.doesNotMatch(intelligencePanel, /\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(intelligencePanel, /\bfetch\(/);
});

test("P4 /kaan Intelligence panel renders partial data when one read RPC fails", () => {
  assert.match(intelligencePanel, /Promise\.allSettled/);
  assert.doesNotMatch(intelligencePanel, /Promise\.all\(/);
  assert.match(intelligencePanel, /type P4Failure/);
  assert.match(intelligencePanel, /sanitizeAdminRpcErrorMessage/);
  assert.match(intelligencePanel, /P4 intelligence data is partially unavailable/);
  assert.match(intelligencePanel, /Successful RPC sections are still shown below/);
});

test("report moderation UI attaches P4 policy context without automated enforcement", () => {
  assert.match(reportsPanel, /policyCategories/);
  assert.match(reportsPanel, /admin_resolve_report_with_policy/);
  assert.match(reportsPanel, /p_policy_category: policyCategory/);
  assert.match(reportsPanel, /p_recommendation_id: null/);
  assert.match(reportsPanel, /P4 attaches policy context for triage and audit/);
  assert.match(reportsPanel, /It does not automate enforcement/);
  assert.match(p4Migrations, /Recommendation does not belong to this pending report action/);
});

test("shared analytics taxonomy and wrappers block PII/freeform payloads", () => {
  assert.match(taxonomy, /ProductIntelligenceEvents/);
  assert.match(taxonomy, /activation\.signup_completed/);
  assert.match(taxonomy, /events\.event_registered/);
  assert.match(taxonomy, /matching\.quality_signal/);
  assert.match(taxonomy, /trust\.triage_recommendation_shown/);
  assert.match(taxonomy, /experiments\.exposure_recorded/);
  assert.match(taxonomy, /sanitizeProductIntelligenceProperties/);
  assert.match(taxonomy, /email/);
  assert.match(taxonomy, /phone/);
  assert.match(taxonomy, /message/);
  assert.match(taxonomy, /token/);
  assert.match(taxonomy, /safeStringKeys/);
  assert.match(taxonomy, /permission_state/);
  assert.match(taxonomy, /sdk_status/);
  assert.match(taxonomy, /client_health_status/);
  assert.match(taxonomy, /sync_result_code/);
  assert.match(taxonomy, /reason_code/);
  assert.match(taxonomy, /latency_bucket/);
  assert.match(taxonomy, /"state"/);
  assert.doesNotMatch(taxonomy, /event_title/);

  const diagnostics = sanitizeProductIntelligenceProperties(
    {
      state: "incomplete",
      reason_code: "resolver_exception",
      latency_bucket: "5_15s",
      email: "admin@example.com",
      freeform_note: "contains free text",
    },
    { platform: "web" },
  );

  assert.deepEqual(diagnostics, {
    platform: "web",
    state: "incomplete",
    reason_code: "resolver_exception",
    latency_bucket: "5_15s",
  });

  assert.match(webAnalytics, /sanitizeProductIntelligenceProperties\(properties, \{ platform: "web" \}\)/);
  assert.match(nativeAnalytics, /sanitizeProductIntelligenceProperties\(props, \{ platform: 'native' \}\)/);
  assert.doesNotMatch(webAnalytics, /posthog\?\.capture\(eventName, properties\)/);
  assert.doesNotMatch(nativeAnalytics, /client\?\.capture\(eventName, properties\)/);
});

test("P4 Edge Function wrappers are configured and delegate to constrained RPCs", () => {
  assert.match(functionConfig, /\[functions\.record-growth-attribution\]\nverify_jwt = false/);
  assert.match(functionConfig, /\[functions\.admin-data-export\]\nverify_jwt = true/);
  assert.match(growthFunction, /record_growth_attribution_event/);
  assert.match(growthFunction, /SUPABASE_ANON_KEY/);
  assert.doesNotMatch(growthFunction, /SERVICE_ROLE/);
  assert.match(exportFunction, /admin_create_data_export_job/);
  assert.match(exportFunction, /Authorization: authHeader/);
  assert.match(exportFunction, /scope_type_and_reason_required/);
  assert.doesNotMatch(exportFunction, /SERVICE_ROLE/);
});

test("package exposes P4 source-contract script", () => {
  assert.match(packageJson, /test:admin-p4-intelligence/);
});
