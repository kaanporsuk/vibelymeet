import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260506103000_admin_p2_backend_authoritative_hardening.sql");
const validation = read("supabase/validation/admin_p2_backend_authoritative_hardening.sql");
const adminRpc = read("src/lib/adminRpc.ts");
const grantCredits = read("src/components/admin/AdminGrantCreditsModal.tsx");
const premium = read("src/components/admin/AdminPremiumModal.tsx");
const reports = read("src/components/admin/AdminReportsPanel.tsx");
const moderation = read("src/components/admin/UserModerationActions.tsx");
const eventControls = read("src/components/admin/AdminEventControls.tsx");
const events = read("src/components/admin/AdminEventsPanel.tsx");
const eventForm = read("src/components/admin/AdminEventFormModal.tsx");
const batchImport = read("src/components/admin/BatchEventImportModal.tsx");
const notifications = read("src/components/admin/AdminNotificationsPanel.tsx");
const verification = read("src/components/admin/AdminPhotoVerificationPanel.tsx");
const support = read("src/components/admin/SupportInbox.tsx");
const stats = read("src/components/admin/AdminStatsCards.tsx");
const pushAnalytics = read("src/hooks/usePushAnalytics.ts");
const verificationFunction = read("supabase/functions/admin-review-verification/index.ts");

function fnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = migration.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const next = migration.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const grantBlock = migration.indexOf("\n-- ─", start + marker.length);
  const candidates = [next, grantBlock].filter((i) => i !== -1);
  const end = candidates.length ? Math.min(...candidates) : migration.length;
  return migration.slice(start, end);
}

const mutationRpcs = [
  "admin_adjust_user_credits",
  "admin_set_premium_status",
  "admin_resolve_report",
  "admin_moderate_user",
  "admin_review_photo_verification",
  "admin_create_event",
  "admin_update_event",
  "admin_end_event",
  "admin_extend_event",
  "admin_go_live_event",
  "admin_cancel_event",
  "admin_archive_event",
  "admin_unarchive_event",
  "admin_bulk_archive_events",
  "admin_archive_event_series",
  "admin_delete_event",
  "admin_generate_recurring_events",
  "admin_send_event_reminder",
  "admin_mark_notifications_read",
  "admin_delete_notifications",
  "admin_create_event_payment_exception",
  "admin_transition_event_payment_exception",
];

test("P2 migration adds shared backend admin primitives", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.admin_idempotency_keys/);
  assert.match(migration, /UNIQUE \(admin_id, operation, idempotency_key\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.log_admin_action/);
  assert.match(migration, /public\.has_role\(v_admin_id, 'admin'::public\.app_role\)/);
  assert.match(migration, /UNAUTHENTICATED/);
  assert.match(migration, /FORBIDDEN/);
  assert.match(migration, /VALIDATION_ERROR/);
  assert.match(migration, /INVALID_TRANSITION/);
  assert.match(migration, /CONFLICT/);
  assert.match(migration, /INTERNAL_ERROR/);
  assert.match(validation, /admin_p2_backend_authoritative_hardening/);
  assert.match(validation, /premium_history/);
  assert.match(validation, /push_notification_events_admin/);
});

test("P2 admin RPCs are security definer, admin checked, audited, and ACL pinned", () => {
  for (const fn of mutationRpcs) {
    const source = fnSection(fn);
    assert.match(source, /SECURITY DEFINER/, `${fn} must be security definer`);
    assert.match(source, /SET search_path = public, pg_catalog/, `${fn} must pin search_path`);
    assert.match(source, /auth\.uid\(\)/, `${fn} must derive admin identity from auth.uid()`);
    assert.match(source, /public\.has_role\(v_admin_id, 'admin'::public\.app_role\)/, `${fn} must verify admin role`);
    assert.match(source, /log_admin_action/, `${fn} must write admin_activity_logs`);
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`), `${fn} must be revoked from PUBLIC`);
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`), `${fn} must be granted to authenticated`);
  }
});

test("retry-prone P2 mutations use idempotency ledger", () => {
  for (const fn of mutationRpcs) {
    const source = fnSection(fn);
    assert.match(source, /admin_idempotency_begin/, `${fn} must check idempotency before writing`);
    assert.match(source, /admin_idempotency_complete/, `${fn} must save idempotent response`);
  }
});

test("browser mutation surfaces call semantic admin RPCs", () => {
  assert.match(adminRpc, /createAdminIdempotencyKey/);
  assert.match(adminRpc, /payload\.success === false \|\| payload\.ok === false/);
  assert.match(grantCredits, /callAdminRpc\("admin_adjust_user_credits"/);
  assert.match(premium, /callAdminRpc\("admin_set_premium_status"/);
  assert.match(reports, /callAdminRpc\("admin_resolve_report"/);
  assert.match(moderation, /callAdminRpc\("admin_moderate_user"/);
  assert.match(eventControls, /callAdminRpc\("admin_end_event"/);
  assert.match(eventControls, /callAdminRpc\("admin_extend_event"/);
  assert.match(eventControls, /callAdminRpc\("admin_go_live_event"/);
  assert.match(eventControls, /callAdminRpc\("admin_send_event_reminder"/);
  assert.match(events, /callAdminRpc\("admin_archive_event_series"/);
  assert.match(events, /callAdminRpc\("admin_bulk_archive_events"/);
  assert.match(events, /callAdminRpc\("admin_generate_recurring_events"/);
  assert.match(eventForm, /callAdminRpc\("admin_create_event"/);
  assert.match(eventForm, /callAdminRpc\("admin_update_event"/);
  assert.match(batchImport, /callAdminRpc\("admin_create_event"/);
  assert.match(notifications, /callAdminRpc\("admin_list_notifications"/);
  assert.match(notifications, /callAdminRpc\("admin_mark_notifications_read"/);
  assert.match(notifications, /callAdminRpc\("admin_delete_notifications"/);
  assert.match(verification, /callAdminRpc\("admin_review_photo_verification"/);
  assert.match(support, /callAdminRpc\("admin_create_event_payment_exception"/);
  assert.match(support, /callAdminRpc\("admin_transition_event_payment_exception"/);
  assert.match(stats, /callAdminRpc\("admin_get_overview_metrics"/);
  assert.match(pushAnalytics, /callAdminRpc\("admin_get_push_delivery_metrics"/);
});

test("covered admin UI no longer performs known multi-step browser writes", () => {
  const coveredSources = [
    grantCredits,
    premium,
    reports,
    moderation,
    eventControls,
    events,
    eventForm,
    batchImport,
    notifications,
    verification,
    support,
  ].join("\n");

  const forbiddenWriteSurfaces = [
    /from\(["']user_credits["']\)[\s\S]{0,300}\.(insert|update|upsert|delete)\(/,
    /from\(["']credit_adjustments["']\)[\s\S]{0,300}\.insert\(/,
    /from\(["']premium_history["']\)[\s\S]{0,300}\.insert\(/,
    /from\(["']user_warnings["']\)[\s\S]{0,300}\.insert\(/,
    /from\(["']user_suspensions["']\)[\s\S]{0,300}\.(insert|update)\(/,
    /from\(["']photo_verifications["']\)[\s\S]{0,300}\.update\(/,
    /from\(["']admin_notifications["']\)[\s\S]{0,300}\.(update|delete)\(/,
    /from\(["']events["']\)[\s\S]{0,300}\.(insert|update|delete)\(/,
    /rpc\(["']generate_recurring_events["']/,
  ];

  for (const pattern of forbiddenWriteSurfaces) {
    assert.doesNotMatch(coveredSources, pattern);
  }
});

test("verification Edge Function is a thin admin RPC wrapper", () => {
  assert.match(verificationFunction, /admin_review_photo_verification/);
  assert.match(verificationFunction, /Authorization: authHeader/);
  assert.doesNotMatch(verificationFunction, /from\(["']photo_verifications["']\)[\s\S]{0,300}\.update\(/);
  assert.doesNotMatch(verificationFunction, /from\(["']profiles["']\)[\s\S]{0,300}\.update\(/);
});

test("authoritative read surfaces are backend RPC based", () => {
  assert.match(fnSection("admin_get_overview_metrics"), /'reporting_timezone', 'UTC'/);
  assert.match(fnSection("admin_search_users"), /count\(\*\)::integer AS total_count/);
  assert.match(fnSection("admin_get_event_metrics"), /participant_reports_near_event_window/);
  assert.match(fnSection("admin_get_push_delivery_metrics"), /app_notification_log/);
  assert.match(fnSection("admin_get_push_delivery_metrics"), /push_telemetry/);
});
