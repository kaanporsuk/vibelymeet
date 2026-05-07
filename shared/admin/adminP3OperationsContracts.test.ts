import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260506120000_admin_p3_operations_foundation.sql");
const validation = read("supabase/validation/admin_p3_operations_foundation.sql");
const operationsCenter = read("src/components/admin/AdminOperationsCenter.tsx");
const activityLog = read("src/components/admin/AdminActivityLog.tsx");
const dashboard = read("src/pages/admin/AdminDashboard.tsx");
const sidebar = read("src/components/admin/AdminSidebar.tsx");
const packageJson = read("package.json");

function fnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = migration.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const next = migration.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const grantBlock = migration.indexOf("\n-- ─", start + marker.length);
  const candidates = [next, grantBlock].filter((index) => index !== -1);
  const end = candidates.length ? Math.min(...candidates) : migration.length;
  return migration.slice(start, end);
}

const readRpcs = [
  "admin_get_admin_permissions",
  "admin_has_permission",
  "admin_get_system_health",
  "admin_get_provider_health",
  "admin_get_rebuild_status",
  "admin_get_incident_signals",
  "admin_search_admin_audit_logs",
];

const writeStatement = /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\s/im;

test("P3 migration adds operations, permissions, and rebuild governance primitives", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.admin_permissions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.admin_role_permissions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.migration_classifications/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.rebuild_rehearsal_runs/);
  assert.match(migration, /'ops\.read'/);
  assert.match(migration, /'providers\.read'/);
  assert.match(migration, /'rebuild\.read'/);
  assert.match(migration, /'audit\.read'/);
  assert.match(migration, /'20260506120000'/);
  assert.match(validation, /admin_p3_operations_foundation/);
});

test("P3 read RPCs are security definer, permission checked, ACL pinned, and read-only", () => {
  for (const fn of readRpcs) {
    const source = fnSection(fn);
    assert.match(source, /SECURITY DEFINER/, `${fn} must be security definer`);
    assert.match(source, /SET search_path = public, pg_catalog/, `${fn} must pin search_path`);
    assert.match(source, /auth\.uid\(\)/, `${fn} must derive caller from auth.uid()`);
    assert.match(source, /admin_user_has_permission|admin session is required|Admin session is required/, `${fn} must participate in the P3 permission model`);
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`), `${fn} must be revoked from PUBLIC`);
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`), `${fn} must be granted to authenticated`);
    assert.doesNotMatch(source, writeStatement, `${fn} must stay read-only`);
  }
});

test("P3 provider health separates app truth from provider truth without provider API calls", () => {
  const providerHealth = fnSection("admin_get_provider_health");
  assert.match(providerHealth, /provider_checks_are_app_layer_only/);
  assert.match(providerHealth, /app_truth/);
  assert.match(providerHealth, /provider_truth/);
  assert.match(providerHealth, /not_contacted_by_this_rpc/);
  assert.match(providerHealth, /stripe_webhook_events/);
  assert.match(providerHealth, /media_delete_jobs/);
  assert.match(providerHealth, /video_sessions/);
  assert.match(providerHealth, /notification_preferences/);
});

test("P3 migration keeps P2 user search backend aligned with Users panel filters", () => {
  const userSearch = fnSection("admin_search_users");
  assert.match(userSearch, /gender_bucket/);
  assert.match(userSearch, /relationship_intents/);
  assert.match(userSearch, /location_asc/);
  assert.match(userSearch, /total_matches_desc/);
  assert.match(userSearch, /registrations_desc/);
  assert.match(userSearch, /row_number\(\) OVER/);
  assert.match(userSearch, /jsonb_agg\(to_jsonb\(page\) - 'sort_index' ORDER BY page\.sort_index\)/);
  assert.match(userSearch, /filter_semantics/);
});

test("P3 Operations Center is wired into /kaan dashboard and sidebar", () => {
  assert.match(dashboard, /AdminOperationsCenter/);
  assert.match(dashboard, /'operations'/);
  assert.match(dashboard, /Production health, provider reconciliation, incidents, audit, and rebuild state/);
  assert.match(sidebar, /label: 'Operations'/);
  assert.match(sidebar, /id: 'operations'/);
});

test("P3 Operations Center calls backend read RPCs and exposes incident/audit/rebuild sections", () => {
  assert.match(operationsCenter, /callAdminRpc<SystemHealthPayload>\("admin_get_system_health"/);
  assert.match(operationsCenter, /callAdminRpc<ProviderHealthPayload>\("admin_get_provider_health"/);
  assert.match(operationsCenter, /callAdminRpc<RebuildStatusPayload>\("admin_get_rebuild_status"/);
  assert.match(operationsCenter, /callAdminRpc<IncidentSignalsPayload>\("admin_get_incident_signals"/);
  assert.match(operationsCenter, /callAdminRpc<PermissionsPayload>\("admin_get_admin_permissions"/);
  assert.match(operationsCenter, /callAdminRpc<AuditPayload>\("admin_search_admin_audit_logs"/);
  assert.match(operationsCenter, /Provider Reconciliation/);
  assert.match(operationsCenter, /Incident Signals/);
  assert.match(operationsCenter, /Rebuild Governance/);
  assert.match(operationsCenter, /Admin Audit Explorer/);
  assert.match(operationsCenter, /Admin Permissions/);
});

test("P3 Operations Center renders partial data when a backend read RPC fails", () => {
  assert.match(operationsCenter, /Promise\.allSettled/);
  assert.doesNotMatch(operationsCenter, /Promise\.all\(/);
  assert.match(operationsCenter, /type OperationsFailure/);
  assert.match(operationsCenter, /Successful RPC sections are still shown below/);
  assert.match(operationsCenter, /failureFor\("admin_get_system_health"/);
  assert.match(operationsCenter, /failureFor\("admin_get_provider_health"/);
  assert.match(operationsCenter, /failureFor\("admin_get_rebuild_status"/);
  assert.match(operationsCenter, /failureFor\("admin_get_incident_signals"/);
  assert.match(operationsCenter, /failureFor\("admin_get_admin_permissions"/);
});

test("P3 Operations Center has no direct writes or browser-side provider calls", () => {
  assert.doesNotMatch(operationsCenter, /\.from\([^)]*\)[\s\S]{0,300}\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(operationsCenter, /\bfetch\(/);
  assert.doesNotMatch(operationsCenter, /STRIPE|BUNNY|DAILY_API|ONESIGNAL|RESEND|TWILIO/);
  assert.doesNotMatch(operationsCenter, /secret|api[_-]?key/i);
});

test("Activity Log tab uses the governed audit RPC instead of direct table reads", () => {
  assert.match(activityLog, /callAdminRpc<AdminActivityLogPayload>\("admin_search_admin_audit_logs"/);
  assert.doesNotMatch(activityLog, /\.from\(["']admin_activity_logs["']\)/);
  assert.doesNotMatch(activityLog, /\.from\([^)]*\)[\s\S]{0,300}\.(insert|update|upsert|delete)\(/);
  assert.match(activityLog, /p_action_type: filterAction === "all" \? null : filterAction/);
  assert.match(activityLog, /p_target_type: filterTarget === "all" \? null : filterTarget/);
  assert.match(activityLog, /p_from: fromBoundary/);
  assert.match(activityLog, /p_to: toBoundary/);
  assert.match(activityLog, /p_limit: ACTIVITY_LOG_PAGE_SIZE/);
  assert.match(activityLog, /p_offset: pageIndex \* ACTIVITY_LOG_PAGE_SIZE/);
  assert.match(activityLog, /enabled: !hasInvalidDateRange/);
  assert.match(activityLog, /sanitizeAdminRpcErrorMessage\(error\)/);
  assert.match(activityLog, /Array\.isArray\(activityPayload\?\.rows\)/);
  assert.match(activityLog, /Number\.isFinite\(reportedTotalCount\)/);
  assert.match(fnSection("admin_search_admin_audit_logs"), /ORDER BY al\.created_at DESC, al\.id DESC/);
  assert.match(fnSection("admin_search_admin_audit_logs"), /jsonb_agg\(to_jsonb\(page\) ORDER BY page\.created_at DESC, page\.id DESC\)/);
});

test("Activity Log tab presents current dotted actions, legacy fallbacks, and pagination states", () => {
  assert.match(activityLog, /"event\.delete"/);
  assert.match(activityLog, /"event\.create"/);
  assert.match(activityLog, /"event\.end"/);
  assert.match(activityLog, /"credit\.adjust"/);
  assert.match(activityLog, /"moderation\.user_suspended"/);
  assert.match(activityLog, /"report\.dismiss"/);
  assert.match(activityLog, /"notification\.mark_read"/);
  assert.match(activityLog, /"support\.exception_create"/);
  assert.match(activityLog, /"compliance\.export_queued"/);
  assert.match(activityLog, /"premium\.correct_history"/);
  assert.match(activityLog, /"report\.policy_context_attached"/);
  assert.match(activityLog, /"experiment\.status_update"/);
  assert.match(activityLog, /"trust\.recommendation_decision"/);
  assert.match(activityLog, /"event_registration\.mark_attendance"/);
  assert.match(activityLog, /"event_registration\.remove"/);
  assert.match(activityLog, /event_registration/);
  assert.match(activityLog, /media_jobs_requeue_stale/);
  assert.match(activityLog, /media_jobs_retry_failed/);
  assert.match(activityLog, /media_retention_setting_updated/);
  assert.match(activityLog, /media_retention_chat_policy_updated/);
  assert.match(activityLog, /media_retention_settings/);
  assert.match(activityLog, /create_event_payment_exception/);
  assert.match(activityLog, /transition_event_payment_exception/);
  assert.match(activityLog, /delete_event/);
  assert.match(activityLog, /formatUnknownActionLabel/);
  assert.match(activityLog, /formatDetailsSummary/);
  assert.match(activityLog, /boundary\.setDate\(boundary\.getDate\(\) \+ 1\)/);
  assert.match(activityLog, /Start date must be before the end date/);
  assert.match(activityLog, /Showing \{firstVisibleLog\}-\{lastVisibleLog\} of \{totalCount\} logs/);
  assert.match(activityLog, /Previous/);
  assert.match(activityLog, /Next/);
  assert.match(activityLog, /Refresh/);
  assert.match(activityLog, /Unable to read activity logs from admin_search_admin_audit_logs/);
});

test("package exposes P3 source-contract test script", () => {
  assert.match(packageJson, /test:admin-p3-operations/);
});
