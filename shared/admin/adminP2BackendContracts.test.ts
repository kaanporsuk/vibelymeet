import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260506103000_admin_p2_backend_authoritative_hardening.sql");
const overviewMigration = read("supabase/migrations/20260506135000_admin_overview_dashboard_read_model.sql");
const badgeCountsMigration = read("supabase/migrations/20260507103000_admin_dashboard_badge_counts.sql");
const countReadModelsMigration = read("supabase/migrations/20260507110000_admin_panel_count_read_models.sql");
const readModelSweepMigration = read("supabase/migrations/20260507112000_admin_panel_read_model_sweep.sql");
const eventLifecycleFeedMigration = read("supabase/migrations/20260507113000_admin_event_lifecycle_feed.sql");
const reviewCommentFollowupMigration = read("supabase/migrations/20260507123000_admin_review_comment_followup.sql");
const adminUsersLifecycleMigration = read("supabase/migrations/20260507143000_admin_users_lifecycle_read_models.sql");
const pushTelemetryViewRedactionMigration = read("supabase/migrations/20260507154000_push_notification_events_admin_null_preserving_redaction.sql");
const validation = read("supabase/validation/admin_p2_backend_authoritative_hardening.sql");
const adminRpc = read("src/lib/adminRpc.ts");
const adminDashboard = read("src/pages/admin/AdminDashboard.tsx");
const staleBundleNotice = read("src/components/admin/AdminStaleBundleNotice.tsx");
const grantCredits = read("src/components/admin/AdminGrantCreditsModal.tsx");
const premium = read("src/components/admin/AdminPremiumModal.tsx");
const reports = read("src/components/admin/AdminReportsPanel.tsx");
const moderation = read("src/components/admin/UserModerationActions.tsx");
const eventControls = read("src/components/admin/AdminEventControls.tsx");
const events = read("src/components/admin/AdminEventsPanel.tsx");
const eventAttendees = read("src/components/admin/AdminEventAttendeesModal.tsx");
const eventForm = read("src/components/admin/AdminEventFormModal.tsx");
const batchImport = read("src/components/admin/BatchEventImportModal.tsx");
const notifications = read("src/components/admin/AdminNotificationsPanel.tsx");
const verification = read("src/components/admin/AdminPhotoVerificationPanel.tsx");
const reportsSummary = read("src/components/admin/AdminReportsSummary.tsx");
const pushCampaigns = read("src/components/admin/AdminPushCampaignsPanel.tsx");
const matchMessages = read("src/components/admin/AdminMatchMessagesDrawer.tsx");
const adminUserDetail = read("src/components/admin/AdminUserDetailDrawer.tsx");
const adminProfilePreview = read("src/components/admin/AdminProfilePreview.tsx");
const support = read("src/components/admin/SupportInbox.tsx");
const stats = read("src/components/admin/AdminStatsCards.tsx");
const overviewHook = read("src/hooks/useAdminOverviewDashboard.ts");
const analyticsCharts = read("src/components/admin/AdminAnalyticsCharts.tsx");
const quickActions = read("src/components/admin/AdminQuickActionsCards.tsx");
const dailyDrop = read("src/components/admin/AdminDailyDropCard.tsx");
const adminUsers = read("src/components/admin/AdminUsersPanel.tsx");
const eventAnalytics = read("src/components/admin/AdminLiveEventMetrics.tsx");
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

function overviewFnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = overviewMigration.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const next = overviewMigration.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const end = next === -1 ? overviewMigration.length : next;
  return overviewMigration.slice(start, end);
}

function badgeCountsFnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = badgeCountsMigration.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const next = badgeCountsMigration.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const end = next === -1 ? badgeCountsMigration.length : next;
  return badgeCountsMigration.slice(start, end);
}

function countReadModelFnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = countReadModelsMigration.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const next = countReadModelsMigration.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const revoke = countReadModelsMigration.indexOf("\nREVOKE ALL ON FUNCTION", start + marker.length);
  const candidates = [next, revoke].filter((i) => i !== -1);
  const end = candidates.length ? Math.min(...candidates) : countReadModelsMigration.length;
  return countReadModelsMigration.slice(start, end);
}

function readModelSweepFnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = readModelSweepMigration.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const next = readModelSweepMigration.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const revoke = readModelSweepMigration.indexOf("\nREVOKE ALL ON FUNCTION", start + marker.length);
  const candidates = [next, revoke].filter((i) => i !== -1);
  const end = candidates.length ? Math.min(...candidates) : readModelSweepMigration.length;
  return readModelSweepMigration.slice(start, end);
}

function eventLifecycleFeedFnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = eventLifecycleFeedMigration.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const next = eventLifecycleFeedMigration.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const revoke = eventLifecycleFeedMigration.indexOf("\nREVOKE ALL ON FUNCTION", start + marker.length);
  const candidates = [next, revoke].filter((i) => i !== -1);
  const end = candidates.length ? Math.min(...candidates) : eventLifecycleFeedMigration.length;
  return eventLifecycleFeedMigration.slice(start, end);
}

function reviewCommentFollowupFnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = reviewCommentFollowupMigration.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const next = reviewCommentFollowupMigration.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const revoke = reviewCommentFollowupMigration.indexOf("\nREVOKE ALL ON FUNCTION", start + marker.length);
  const candidates = [next, revoke].filter((i) => i !== -1);
  const end = candidates.length ? Math.min(...candidates) : reviewCommentFollowupMigration.length;
  return reviewCommentFollowupMigration.slice(start, end);
}

function adminUsersLifecycleFnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = adminUsersLifecycleMigration.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const next = adminUsersLifecycleMigration.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const revoke = adminUsersLifecycleMigration.indexOf("\nREVOKE ALL ON FUNCTION", start + marker.length);
  const candidates = [next, revoke].filter((i) => i !== -1);
  const end = candidates.length ? Math.min(...candidates) : adminUsersLifecycleMigration.length;
  return adminUsersLifecycleMigration.slice(start, end);
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

const panelCountReadRpcs = [
  "admin_get_photo_verification_counts",
  "admin_get_reports_summary_counts",
  "admin_estimate_push_campaign_reach",
  "admin_get_user_detail_counts",
  "admin_get_match_message_counts",
];

const panelReadModelRpcs = [
  "admin_list_photo_verifications",
  "admin_get_reports_read_model",
  "admin_get_push_campaigns_read_model",
  "admin_get_user_detail_read_model",
  "admin_get_user_match_threads",
  "admin_get_match_thread_messages",
];

const pushCampaignDraftMutationRpcs = [
  "admin_upsert_push_campaign_draft",
  "admin_delete_push_campaign_draft",
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
  assert.match(reports, /callAdminRpc\("admin_resolve_report(_with_policy)?"/);
  assert.match(moderation, /callAdminRpc\("admin_moderate_user"/);
  assert.match(eventControls, /callAdminRpc\("admin_end_event"/);
  assert.match(eventControls, /callAdminRpc\("admin_extend_event"/);
  assert.match(eventControls, /callAdminRpc\("admin_go_live_event"/);
  assert.match(eventControls, /callAdminRpc\("admin_send_event_reminder"/);
  assert.match(eventAttendees, /callAdminRpc\("admin_send_event_reminder"/);
  assert.match(eventAttendees, /callAdminRpc\("admin_remove_event_registration"/);
  assert.match(eventAttendees, /callAdminRpc<\{ affected_count\?: number \}>\("admin_mark_event_attendance"/);
  assert.match(eventAttendees, /AdminConfirmDialog/);
  assert.match(eventAttendees, /no browser-side notification loop runs from this panel/);
  assert.match(eventAttendees, /Remove Registration/);
  assert.doesNotMatch(eventAttendees, /window\.confirm/);
  assert.doesNotMatch(eventAttendees, /sendNotification/);
  assert.doesNotMatch(eventAttendees, /send-notification/);
  assert.match(events, /callAdminRpc\("admin_archive_event_series"/);
  assert.match(events, /callAdminRpc\("admin_bulk_archive_events"/);
  assert.match(events, /callAdminRpc\("admin_generate_recurring_events"/);
  assert.match(eventForm, /callAdminRpc\("admin_create_event"/);
  assert.match(eventForm, /callAdminRpc\("admin_update_event"/);
  assert.match(batchImport, /callAdminRpc\("admin_create_event"/);
  assert.match(batchImport, /successfulIndexes/);
  assert.match(batchImport, /failedRows/);
  assert.match(batchImport, /Confirmed successful rows were deselected to prevent duplicate retries/);
  assert.doesNotMatch(batchImport, /Promise\.all\(\s*rows\.map/);
  assert.match(notifications, /callAdminRpc\("admin_list_notifications"/);
  assert.match(notifications, /callAdminRpc\("admin_get_notification_counts"/);
  assert.match(notifications, /callAdminRpc\("admin_mark_notifications_read"/);
  assert.match(notifications, /callAdminRpc\("admin_delete_notifications"/);
  assert.match(verification, /callAdminRpc\("admin_review_photo_verification"/);
  assert.match(support, /callAdminRpc\("admin_create_event_payment_exception"/);
  assert.match(support, /callAdminRpc\("admin_transition_event_payment_exception"/);
  assert.match(overviewHook, /callAdminRpc<AdminOverviewDashboardPayload>\("admin_get_overview_dashboard"/);
  assert.match(stats, /useAdminOverviewDashboard/);
  assert.match(adminUsers, /callAdminRpc<AdminSearchUsersPayload>\("admin_search_users"/);
  assert.match(eventAnalytics, /callAdminRpc<AdminEventMetricsPayload>\("admin_get_event_metrics"/);
  assert.match(eventAnalytics, /callAdminRpc<AdminEventLifecycleFeedPayload>\("admin_get_event_lifecycle_feed"/);
  assert.match(pushAnalytics, /callAdminRpc<PushDeliveryMetricsPayload>\("admin_get_push_delivery_metrics"/);
});

test("admin RPC helper preserves Supabase client binding", () => {
  assert.doesNotMatch(adminRpc, /const\s+rpc\s*=\s*supabase\.rpc\b(?!\.bind)/);
  assert.doesNotMatch(adminRpc, /await\s+rpc\(/);
  assert.match(adminRpc, /supabase\.rpc\(|supabase\.rpc\.bind\(supabase\)/);
  assert.match(adminRpc, /sanitizeAdminRpcErrorMessage/);
  assert.match(adminRpc, /\[url\]/);
  assert.match(adminRpc, /\[email\]/);
  assert.match(adminRpc, /\[token\]/);
});

test("covered admin UI no longer performs known multi-step browser writes", () => {
  const coveredSources = [
    grantCredits,
    premium,
    reports,
    moderation,
    eventControls,
    eventAttendees,
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
    /from\(["']event_registrations["']\)[\s\S]{0,300}\.update\(/,
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
  assert.match(overviewFnSection("admin_get_overview_dashboard"), /SECURITY DEFINER/);
  assert.match(overviewFnSection("admin_get_overview_dashboard"), /SET search_path = public, pg_catalog/);
  assert.match(overviewFnSection("admin_get_overview_dashboard"), /auth\.uid\(\)/);
  assert.match(overviewFnSection("admin_get_overview_dashboard"), /public\.has_role\(v_admin_id, 'admin'::public\.app_role\)/);
  assert.match(overviewFnSection("admin_get_overview_dashboard"), /generate_series\(v_window_start, v_today_start, interval '1 day'\)/);
  assert.match(overviewMigration, /REVOKE ALL ON FUNCTION public\.admin_get_overview_dashboard\(timestamptz\) FROM PUBLIC/);
  assert.match(overviewMigration, /GRANT EXECUTE ON FUNCTION public\.admin_get_overview_dashboard\(timestamptz\) TO authenticated/);
  assert.match(overviewMigration, /'20260506135000'/);
  assert.match(overviewMigration, /Admin Overview dashboard read model/);
  assert.match(fnSection("admin_search_users"), /count\(\*\)::integer AS total_count/);
  assert.match(fnSection("admin_get_event_metrics"), /participant_reports_near_event_window/);
  assert.match(fnSection("admin_get_push_delivery_metrics"), /app_notification_log/);
  assert.match(fnSection("admin_get_push_delivery_metrics"), /push_telemetry/);
  assert.match(eventLifecycleFeedFnSection("admin_get_event_lifecycle_feed"), /SECURITY DEFINER/);
  assert.match(eventLifecycleFeedFnSection("admin_get_event_lifecycle_feed"), /SET search_path = public, pg_catalog/);
  assert.match(eventLifecycleFeedFnSection("admin_get_event_lifecycle_feed"), /auth\.uid\(\)/);
  assert.match(
    eventLifecycleFeedFnSection("admin_get_event_lifecycle_feed"),
    /public\.has_role\(v_admin_id, 'admin'::public\.app_role\)/,
  );
  assert.match(eventLifecycleFeedFnSection("admin_get_event_lifecycle_feed"), /public\.event_reminder_queue/);
  assert.match(eventLifecycleFeedFnSection("admin_get_event_lifecycle_feed"), /public\.notification_log/);
  assert.match(eventLifecycleFeedFnSection("admin_get_event_lifecycle_feed"), /public\.waitlist_promotion_notify_queue/);
  assert.match(eventLifecycleFeedFnSection("admin_get_event_lifecycle_feed"), /public\.stripe_event_ticket_settlements/);
  assert.match(eventLifecycleFeedFnSection("admin_get_event_lifecycle_feed"), /public\.event_swipes/);
  assert.match(eventLifecycleFeedFnSection("admin_get_event_lifecycle_feed"), /public\.video_sessions/);
  assert.match(eventLifecycleFeedFnSection("admin_get_event_lifecycle_feed"), /public\.admin_activity_logs/);
  assert.doesNotMatch(eventLifecycleFeedFnSection("admin_get_event_lifecycle_feed"), /'user_id'/);
  assert.match(eventLifecycleFeedMigration, /REVOKE ALL ON FUNCTION public\.admin_get_event_lifecycle_feed\(uuid\) FROM PUBLIC/);
  assert.match(eventLifecycleFeedMigration, /GRANT EXECUTE ON FUNCTION public\.admin_get_event_lifecycle_feed\(uuid\) TO authenticated/);
  assert.match(eventLifecycleFeedMigration, /INSERT INTO public\.migration_classifications/);
  assert.match(eventLifecycleFeedMigration, /'20260507113000'/);
  assert.match(eventLifecycleFeedMigration, /'schema-only'/);
  assert.doesNotMatch(adminUsers, /\.from\(['"]profiles['"]\)/);
  assert.doesNotMatch(adminUsers, /\.from\(['"]event_registrations['"]\)/);
  assert.doesNotMatch(adminUsers, /\.from\(['"]profile_vibes['"]\)/);
  assert.doesNotMatch(eventAnalytics, /\.from\("user_reports"\)/);
  assert.doesNotMatch(eventAnalytics, /\.from\("matches"\)[\s\S]{0,160}\.select\("\*", \{ count: "exact", head: true \}\)/);
  assert.doesNotMatch(eventAnalytics, /\.from\("event_reminder_queue"\)/);
  assert.doesNotMatch(eventAnalytics, /\.from\("notification_log"\)/);
  assert.doesNotMatch(eventAnalytics, /\.from\("waitlist_promotion_notify_queue"\)/);
  assert.doesNotMatch(eventAnalytics, /\.from\("stripe_event_ticket_settlements"\)/);
  assert.doesNotMatch(eventAnalytics, /\.from\("event_swipes"\)/);
  assert.doesNotMatch(eventAnalytics, /\.from\("admin_activity_logs"\)/);
  assert.doesNotMatch(analyticsCharts, /\.from\(['"]profiles['"]\)/);
  assert.doesNotMatch(analyticsCharts, /\.from\(['"]events['"]\)/);
  assert.doesNotMatch(analyticsCharts, /\.from\(['"]matches['"]\)/);
  assert.doesNotMatch(quickActions, /\.from\(['"]user_reports['"]\)/);
  assert.doesNotMatch(quickActions, /\.from\(['"]events['"]\)/);
  assert.doesNotMatch(dailyDrop, /\.from\(['"]daily_drops['"]\)/);
});

test("latest admin Users search read model exposes lifecycle fields and filters", () => {
  const userSearch = adminUsersLifecycleFnSection("admin_search_users");

  assert.match(userSearch, /SECURITY DEFINER/);
  assert.match(userSearch, /SET search_path = public, pg_catalog/);
  assert.match(userSearch, /public\.has_role\(v_admin_id, 'admin'::public\.app_role\)/);
  assert.match(userSearch, /v_filters := CASE/);
  assert.match(userSearch, /User filters must be a JSON object/);
  assert.match(userSearch, /photo_verified filter must be boolean/);
  assert.match(userSearch, /is_suspended filter must be boolean/);
  assert.match(userSearch, /relationship_intents filter must be an array/);
  assert.match(userSearch, /v_lifecycle_filter/);
  assert.match(userSearch, /NOT IN \('all', 'complete', 'incomplete', 'bootstrap_fresh', 'suspended'\)/);
  assert.match(userSearch, /v_filters ->> 'lifecycle_status'/);
  assert.match(userSearch, /lifecycle_status IN \('bootstrap_fresh', 'incomplete', 'incomplete_active'\)/);
  assert.match(userSearch, /COALESCE\(vibes\.vibe_count, 0\) = 0/);
  assert.match(userSearch, /p\.lifestyle IS NULL OR p\.lifestyle = '\{\}'::jsonb/);
  assert.match(userSearch, /p\.prompts IS NULL OR p\.prompts = '\[\]'::jsonb/);
  assert.match(userSearch, /'onboarding_complete', page\.onboarding_complete/);
  assert.match(userSearch, /'onboarding_stage', page\.onboarding_stage/);
  assert.match(userSearch, /'last_seen_at', page\.last_seen_at/);
  assert.match(userSearch, /'is_bootstrap_fresh', page\.is_bootstrap_fresh/);
  assert.match(userSearch, /'has_activity', page\.has_activity/);
  assert.match(userSearch, /'lifecycle_status', page\.lifecycle_status/);
  assert.match(userSearch, /'age_is_placeholder', page\.age_is_placeholder/);
  assert.match(userSearch, /count\(\*\) FILTER \(WHERE er\.attended IS TRUE\)::integer AS attended_count/);
  assert.match(userSearch, /confirmed_attendance counts attended IS TRUE only/);
  assert.doesNotMatch(userSearch, /attendance_marked IS TRUE OR er\.attended IS TRUE/);
  assert.match(userSearch, /'filter_semantics'[\s\S]*complete, incomplete, bootstrap_fresh, and suspended/);
  assert.doesNotMatch(userSearch, /SELECT\s+p\.\*/);
  assert.doesNotMatch(userSearch, /to_jsonb\(p\)/);
  assert.doesNotMatch(userSearch, /to_jsonb\(page\)/);
  assert.match(adminUsersLifecycleMigration, /REVOKE ALL ON FUNCTION public\.admin_search_users\(text, jsonb, text, integer, integer\) FROM PUBLIC/);
  assert.match(adminUsersLifecycleMigration, /GRANT EXECUTE ON FUNCTION public\.admin_search_users\(text, jsonb, text, integer, integer\) TO authenticated/);
});

test("dashboard badge counts are backend RPC based and avoid direct HEAD counts", () => {
  assert.match(badgeCountsFnSection("admin_get_dashboard_badge_counts"), /public\.support_tickets/);

  const badgeCounts = reviewCommentFollowupFnSection("admin_get_dashboard_badge_counts");
  assert.match(badgeCounts, /SECURITY DEFINER/);
  assert.match(badgeCounts, /SET search_path = public, pg_catalog/);
  assert.match(badgeCounts, /auth\.uid\(\)/);
  assert.match(badgeCounts, /public\.has_role\(v_admin_id, 'admin'::public\.app_role\)/);
  assert.match(badgeCounts, /public\.admin_notifications/);
  assert.match(badgeCounts, /public\.support_tickets/);
  assert.match(badgeCounts, /status IN \('submitted', 'in_review'\)/);
  assert.doesNotMatch(badgeCounts, /waiting_on_user/);
  assert.match(badgeCounts, /public\.feedback/);
  assert.match(reviewCommentFollowupMigration, /REVOKE ALL ON FUNCTION public\.admin_get_dashboard_badge_counts\(\) FROM PUBLIC/);
  assert.match(reviewCommentFollowupMigration, /GRANT EXECUTE ON FUNCTION public\.admin_get_dashboard_badge_counts\(\) TO authenticated/);
  assert.match(adminDashboard, /callAdminRpc<AdminDashboardBadgeCountsPayload>\("admin_get_dashboard_badge_counts"/);
  assert.doesNotMatch(adminDashboard, /\.from\(['"]admin_notifications['"]\)/);
  assert.doesNotMatch(adminDashboard, /\.from\(['"]support_tickets['"]\)/);
  assert.doesNotMatch(adminDashboard, /\.from\(['"]feedback['"]\)/);
  assert.doesNotMatch(adminDashboard, /head:\s*true/);
  assert.doesNotMatch(adminDashboard, /admin_get_notification_counts/);
  assert.doesNotMatch(adminDashboard, /admin_get_system_health/);
});

test("admin panel count read RPCs are security definer, admin checked, ACL pinned, and read-only", () => {
  const writeStatement = /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\s/im;

  for (const fn of panelCountReadRpcs) {
    const source = countReadModelFnSection(fn);
    assert.match(source, /SECURITY DEFINER/, `${fn} must be security definer`);
    assert.match(source, /SET search_path = public, pg_catalog/, `${fn} must pin search_path`);
    assert.match(source, /auth\.uid\(\)/, `${fn} must derive admin identity from auth.uid()`);
    assert.match(source, /public\.has_role\(v_admin_id, 'admin'::public\.app_role\)/, `${fn} must verify admin role`);
    assert.match(source, /public\.admin_json_success/, `${fn} must return the admin JSON envelope`);
    assert.match(countReadModelsMigration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`), `${fn} must be revoked from PUBLIC`);
    assert.match(countReadModelsMigration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`), `${fn} must be granted to authenticated`);
    assert.doesNotMatch(source, writeStatement, `${fn} must stay read-only`);
  }

  assert.match(countReadModelFnSection("admin_get_photo_verification_counts"), /public\.photo_verifications/);
  assert.match(countReadModelFnSection("admin_get_reports_summary_counts"), /public\.user_reports/);
  assert.match(countReadModelFnSection("admin_get_reports_summary_counts"), /public\.user_suspensions/);
  assert.match(countReadModelFnSection("admin_estimate_push_campaign_reach"), /gender/);
  assert.match(countReadModelFnSection("admin_estimate_push_campaign_reach"), /isVerified/);
  assert.match(countReadModelFnSection("admin_estimate_push_campaign_reach"), /ageRange/);
  assert.match(countReadModelFnSection("admin_get_user_detail_counts"), /public\.event_registrations/);
  assert.match(countReadModelFnSection("admin_get_match_message_counts"), /array_length\(v_ids, 1\)/);
  assert.match(countReadModelFnSection("admin_get_match_message_counts"), /LEFT JOIN public\.messages/);
});

test("admin panel list/detail read model RPCs are security definer, admin checked, ACL pinned, and read-only", () => {
  const writeStatement = /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\s/im;

  for (const fn of panelReadModelRpcs) {
    const source = readModelSweepFnSection(fn);
    assert.match(source, /SECURITY DEFINER/, `${fn} must be security definer`);
    assert.match(source, /SET search_path = public, pg_catalog/, `${fn} must pin search_path`);
    assert.match(source, /auth\.uid\(\)/, `${fn} must derive admin identity from auth.uid()`);
    assert.match(source, /public\.has_role\(v_admin_id, 'admin'::public\.app_role\)/, `${fn} must verify admin role`);
    assert.match(source, /public\.admin_json_success/, `${fn} must return the admin JSON envelope`);
    assert.match(readModelSweepMigration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`), `${fn} must be revoked from PUBLIC`);
    assert.match(readModelSweepMigration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`), `${fn} must be granted to authenticated`);
    assert.doesNotMatch(source, writeStatement, `${fn} must stay read-only`);
  }

  assert.match(readModelSweepFnSection("admin_list_photo_verifications"), /public\.photo_verifications/);
  assert.match(readModelSweepFnSection("admin_list_photo_verifications"), /public\.profiles/);
  assert.match(readModelSweepFnSection("admin_get_reports_read_model"), /public\.user_reports/);
  assert.match(readModelSweepFnSection("admin_get_reports_read_model"), /reporter_profile/);
  assert.match(readModelSweepFnSection("admin_get_reports_read_model"), /reported_profile/);
  assert.match(readModelSweepFnSection("admin_get_push_campaigns_read_model"), /public\.push_campaigns/);
  assert.match(readModelSweepFnSection("admin_get_push_campaigns_read_model"), /public\.push_notification_events/);
  assert.match(readModelSweepFnSection("admin_get_user_detail_read_model"), /public\.event_registrations/);
  assert.match(readModelSweepFnSection("admin_get_user_detail_read_model"), /public\.profile_vibes/);
  assert.match(readModelSweepFnSection("admin_get_user_detail_read_model"), /public\.daily_drops/);
  assert.match(readModelSweepFnSection("admin_get_user_match_threads"), /LEFT JOIN public\.messages/);
  assert.match(readModelSweepFnSection("admin_get_match_thread_messages"), /WHERE msg\.match_id = p_match_id/);

  const userDetailProjection = adminUsersLifecycleFnSection("admin_get_user_detail_read_model");
  assert.match(userDetailProjection, /SECURITY DEFINER/);
  assert.match(userDetailProjection, /SET search_path = public, pg_catalog/);
  assert.match(userDetailProjection, /public\.has_role\(v_admin_id, 'admin'::public\.app_role\)/);
  assert.match(userDetailProjection, /jsonb_build_object\(\s*'id', p\.id/);
  assert.doesNotMatch(userDetailProjection, /to_jsonb\(p\)/);
  assert.doesNotMatch(userDetailProjection, /proof_selfie_url/);
  assert.doesNotMatch(userDetailProjection, /location_data/);
  assert.doesNotMatch(userDetailProjection, /referred_by/);
  assert.doesNotMatch(userDetailProjection, /phone_number/);
  assert.doesNotMatch(userDetailProjection, /phone_verified/);
  assert.match(userDetailProjection, /'lifestyle', p\.lifestyle/);
  assert.match(userDetailProjection, /'prompts', p\.prompts/);
  assert.match(userDetailProjection, /'moderation', v_moderation/);
  assert.match(userDetailProjection, /'premium_history', v_premium_history/);
  assert.match(userDetailProjection, /'credits', v_credits/);
  assert.match(userDetailProjection, /public\.user_suspensions/);
  assert.match(userDetailProjection, /public\.user_warnings/);
  assert.match(userDetailProjection, /public\.premium_history/);
  assert.match(userDetailProjection, /public\.user_credits/);
  assert.match(adminUsersLifecycleMigration, /REVOKE ALL ON FUNCTION public\.admin_get_user_detail_read_model\(uuid\) FROM PUBLIC/);
  assert.match(adminUsersLifecycleMigration, /GRANT EXECUTE ON FUNCTION public\.admin_get_user_detail_read_model\(uuid\) TO authenticated/);

  const reportsFollowup = reviewCommentFollowupFnSection("admin_get_reports_read_model");
  assert.match(reviewCommentFollowupMigration, /DROP FUNCTION IF EXISTS public\.admin_get_reports_read_model\(text, text, text, integer\)/);
  assert.match(reportsFollowup, /SECURITY DEFINER/);
  assert.match(reportsFollowup, /SET search_path = public, pg_catalog/);
  assert.match(reportsFollowup, /p_search text DEFAULT NULL/);
  assert.match(reportsFollowup, /v_search text := NULLIF/);
  assert.match(reportsFollowup, /position\(v_search in lower\(COALESCE\(reporter\.name/);
  assert.match(reportsFollowup, /position\(v_search in lower\(COALESCE\(reported\.name/);
  assert.match(reviewCommentFollowupMigration, /REVOKE ALL ON FUNCTION public\.admin_get_reports_read_model\(text, text, text, integer, text\) FROM PUBLIC/);
  assert.match(reviewCommentFollowupMigration, /GRANT EXECUTE ON FUNCTION public\.admin_get_reports_read_model\(text, text, text, integer, text\) TO authenticated/);
});

test("push campaign draft write RPCs are governed, idempotent, audited, and draft-only", () => {
  for (const fn of pushCampaignDraftMutationRpcs) {
    const source = readModelSweepFnSection(fn);
    const followupSource = reviewCommentFollowupFnSection(fn);
    assert.match(source, /SECURITY DEFINER/, `${fn} must be security definer`);
    assert.match(source, /SET search_path = public, pg_catalog/, `${fn} must pin search_path`);
    assert.match(source, /auth\.uid\(\)/, `${fn} must derive admin identity from auth.uid()`);
    assert.match(source, /public\.has_role\(v_admin_id, 'admin'::public\.app_role\)/, `${fn} must verify admin role`);
    assert.match(source, /public\.push_campaigns/, `${fn} must mutate push_campaigns server-side`);
    assert.match(source, /admin_idempotency_begin/, `${fn} must start the idempotency ledger`);
    assert.match(source, /admin_idempotency_complete/, `${fn} must complete the idempotency ledger`);
    assert.match(source, /log_admin_action/, `${fn} must write admin_activity_logs`);
    assert.match(source, /v_existing_status <> 'draft'/, `${fn} must reject non-draft mutation`);
    assert.match(readModelSweepMigration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`), `${fn} must be revoked from PUBLIC`);
    assert.match(readModelSweepMigration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`), `${fn} must be granted to authenticated`);
    assert.match(followupSource, /v_response := public\.admin_json_error\('NOT_FOUND'[\s\S]*admin_idempotency_complete/, `${fn} must complete idempotency for not-found validation errors`);
    assert.match(followupSource, /v_response := public\.admin_json_error\('INVALID_TRANSITION'[\s\S]*admin_idempotency_complete/, `${fn} must complete idempotency for non-draft validation errors`);
    assert.match(reviewCommentFollowupMigration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`), `${fn} follow-up must be revoked from PUBLIC`);
    assert.match(reviewCommentFollowupMigration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`), `${fn} follow-up must be granted to authenticated`);
  }

  assert.match(reviewCommentFollowupFnSection("admin_upsert_push_campaign_draft"), /jsonb_object_keys\(v_segment\)/);
  assert.match(reviewCommentFollowupFnSection("admin_upsert_push_campaign_draft"), /keys\.key NOT IN \('gender', 'isVerified', 'ageRange'\)/);
  assert.match(reviewCommentFollowupFnSection("admin_delete_push_campaign_draft"), /DELETE FROM public\.push_campaigns/);
});

test("push telemetry admin view preserves nullness while redacting sensitive identifiers", () => {
  assert.match(pushTelemetryViewRedactionMigration, /DROP VIEW IF EXISTS public\.push_notification_events_admin/);
  assert.match(pushTelemetryViewRedactionMigration, /CREATE VIEW public\.push_notification_events_admin/);
  assert.match(pushTelemetryViewRedactionMigration, /base table RLS/);
  assert.match(pushTelemetryViewRedactionMigration, /WITH \(security_barrier = true\)/);
  assert.doesNotMatch(pushTelemetryViewRedactionMigration, /security_invoker = true/);
  assert.match(pushTelemetryViewRedactionMigration, /CASE WHEN fcm_message_id IS NULL THEN NULL ELSE '\[REDACTED\]'::text END AS fcm_message_id/);
  assert.match(pushTelemetryViewRedactionMigration, /CASE WHEN apns_message_id IS NULL THEN NULL ELSE '\[REDACTED\]'::text END AS apns_message_id/);
  assert.match(pushTelemetryViewRedactionMigration, /CASE WHEN device_token IS NULL THEN NULL ELSE '\[REDACTED\]'::text END AS device_token/);
  assert.match(pushTelemetryViewRedactionMigration, /FROM public\.push_notification_events/);
  assert.match(pushTelemetryViewRedactionMigration, /WHERE public\.has_role\(auth\.uid\(\), 'admin'::public\.app_role\)/);
  assert.match(pushTelemetryViewRedactionMigration, /REVOKE ALL ON public\.push_notification_events_admin FROM PUBLIC/);
  assert.match(pushTelemetryViewRedactionMigration, /GRANT SELECT ON public\.push_notification_events_admin TO authenticated/);
  assert.match(pushTelemetryViewRedactionMigration, /INSERT INTO public\.migration_classifications/);
  assert.match(pushTelemetryViewRedactionMigration, /'20260507154000'/);
  assert.match(pushTelemetryViewRedactionMigration, /'schema-only'/);
  assert.match(pushTelemetryViewRedactionMigration, /destructive_requires_signoff = EXCLUDED\.destructive_requires_signoff/);
});

test("named residual admin panels use backend read models instead of browser table reads", () => {
  assert.match(verification, /callAdminRpc<PhotoVerificationListPayload>\("admin_list_photo_verifications"/);
  assert.match(reports, /callAdminRpc<ReportsReadModelPayload>\("admin_get_reports_read_model"/);
  assert.match(reports, /p_search: normalizedSearchQuery \|\| null/);
  assert.match(pushCampaigns, /callAdminRpc<PushCampaignsReadModelPayload>\("admin_get_push_campaigns_read_model"/);
  assert.match(pushCampaigns, /callAdminRpc\("admin_upsert_push_campaign_draft"/);
  assert.match(pushCampaigns, /callAdminRpc\("admin_delete_push_campaign_draft"/);
  assert.match(adminUserDetail, /callAdminRpc<UserDetailReadModelPayload>\("admin_get_user_detail_read_model"/);
  assert.match(adminUserDetail, /<AdminProfilePreview[\s\S]*profile=\{profile\}[\s\S]*vibes=\{vibes\}/);
  assert.match(adminUserDetail, /moderation=\{moderation\}/);
  assert.match(adminUserDetail, /history=\{premiumHistory\}/);
  assert.match(matchMessages, /callAdminRpc<MatchThreadsPayload>\("admin_get_user_match_threads"/);
  assert.match(matchMessages, /callAdminRpc<MatchThreadMessagesPayload>\("admin_get_match_thread_messages"/);

  assert.doesNotMatch(verification, /\.from\(['"]photo_verifications['"]\)/);
  assert.doesNotMatch(verification, /\.from\(['"]profiles['"]\)/);
  assert.doesNotMatch(reports, /\.from\(['"]user_reports['"]\)/);
  assert.doesNotMatch(reports, /\.from\(['"]profiles['"]\)/);
  assert.doesNotMatch(pushCampaigns, /\.from\(['"]push_campaigns['"]\)/);
  assert.doesNotMatch(pushCampaigns, /\.from\(['"]push_notification_events(?:_admin)?['"]\)/);
  assert.doesNotMatch(adminUserDetail, /\.from\(['"]/);
  assert.doesNotMatch(adminProfilePreview, /\.from\(['"]/);
  assert.doesNotMatch(moderation, /\.from\(['"]/);
  assert.doesNotMatch(premium, /\.from\(['"]/);
  assert.doesNotMatch(matchMessages, /\.from\(['"]/);
  assert.doesNotMatch(adminUserDetail, /admin_get_user_detail_counts/);
  assert.doesNotMatch(matchMessages, /admin_get_match_message_counts/);
});

test("remaining admin panel count surfaces call backend RPCs instead of HEAD counts", () => {
  const countSurfaceSources = [
    verification,
    reportsSummary,
    pushCampaigns,
    matchMessages,
    adminUserDetail,
  ].join("\n");

  assert.match(verification, /callAdminRpc<PhotoVerificationCountsPayload>\("admin_get_photo_verification_counts"/);
  assert.match(reportsSummary, /callAdminRpc<ReportsSummaryCountsPayload>\("admin_get_reports_summary_counts"/);
  assert.match(pushCampaigns, /callAdminRpc<PushCampaignReachPayload>\("admin_estimate_push_campaign_reach"/);
  assert.match(adminUserDetail, /event_registrations_unavailable/);
  assert.match(matchMessages, /message_count/);
  assert.match(matchMessages, /Messages unavailable/);
  assert.doesNotMatch(countSurfaceSources, /head:\s*true/);
  assert.doesNotMatch(matchMessages, /for\s*\(const match of matches\)[\s\S]{0,260}\.from\(["']messages["']\)/);
});

test("admin dashboard surfaces stale hashed bundles before more admin work", () => {
  assert.match(adminDashboard, /AdminStaleBundleNotice/);
  assert.match(staleBundleNotice, /ENTRY_MODULE_PATTERN/);
  assert.match(staleBundleNotice, /vibely_bundle_check/);
  assert.match(staleBundleNotice, /cache: "no-store"/);
  assert.match(staleBundleNotice, /window\.location\.reload\(\)/);
});
