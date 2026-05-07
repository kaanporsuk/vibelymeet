import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260506103000_admin_p2_backend_authoritative_hardening.sql");
const overviewMigration = read("supabase/migrations/20260506135000_admin_overview_dashboard_read_model.sql");
const overviewOperationalTruthMigration = read("supabase/migrations/20260507211000_admin_overview_operational_truth.sql");
const adminPostPublishGrantsAndCancelCutoffMigration = read(
  "supabase/migrations/20260508094500_admin_post_publish_grants_and_live_cancel_cutoff.sql",
);
const badgeCountsMigration = read("supabase/migrations/20260507103000_admin_dashboard_badge_counts.sql");
const countReadModelsMigration = read("supabase/migrations/20260507110000_admin_panel_count_read_models.sql");
const readModelSweepMigration = read("supabase/migrations/20260507112000_admin_panel_read_model_sweep.sql");
const eventLifecycleFeedMigration = read("supabase/migrations/20260507113000_admin_event_lifecycle_feed.sql");
const reviewCommentFollowupMigration = read("supabase/migrations/20260507123000_admin_review_comment_followup.sql");
const accountDeletionsMigration = read("supabase/migrations/20260507140000_admin_account_deletions_backend_authoritative.sql");
const adminUsersLifecycleMigration = read("supabase/migrations/20260507143000_admin_users_lifecycle_read_models.sql");
const pushTelemetryViewRedactionMigration = read("supabase/migrations/20260507154000_push_notification_events_admin_null_preserving_redaction.sql");
const eventAnalyticsReadModelsMigration = read("supabase/migrations/20260507163000_admin_event_analytics_backend_read_models.sql");
const photoVerificationHardeningMigration = read("supabase/migrations/20260507170000_photo_verification_admin_hardening.sql");
const photoVerificationSupersededFollowupMigration = read(
  "supabase/migrations/20260508100000_photo_verification_superseded_preservation_followup.sql",
);
const supportInboxMigration = read("supabase/migrations/20260507180000_admin_support_inbox_governed.sql");
const supportInboxLiveDriftGuardMigration = read(
  "supabase/migrations/20260508093000_admin_support_inbox_live_drift_guard.sql",
);
const tierConfigAuthorityMigration = read("supabase/migrations/20260507190000_tier_config_backend_authority.sql");
const tierConfigConcurrencyRepairMigration = read(
  "supabase/migrations/20260507193000_tier_config_backend_authority_concurrency_repair.sql",
);
const tierConfigSwipeIdempotencyRepairMigration = read(
  "supabase/migrations/20260507194000_tier_config_swipe_idempotency_repair.sql",
);
const tierConfigSwipeLimitRetryRecheckMigration = read(
  "supabase/migrations/20260507195000_tier_config_swipe_limit_retry_recheck.sql",
);
const tierConfigOverrideAuditLockdownMigration = read(
  "supabase/migrations/20260507200000_tier_config_override_audit_lockdown.sql",
);
const engagementAnalyticsMigration = read("supabase/migrations/20260507201000_admin_engagement_analytics_read_model.sql");
const engagementAnalyticsIndexesMigration = read("supabase/migrations/20260507204000_admin_engagement_analytics_read_model_indexes.sql");
const badgeLegacyFeedbackCleanupMigration = read(
  "supabase/migrations/20260507214000_admin_dashboard_remove_legacy_feedback_badge.sql",
);
const validation = read("supabase/validation/admin_p2_backend_authoritative_hardening.sql");
const accountDeletionsValidation = read("supabase/validation/admin_account_deletions_backend_authoritative.sql");
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
const adminDeletions = read("src/components/admin/AdminDeletionsPanel.tsx");
const adminProfilePreview = read("src/components/admin/AdminProfilePreview.tsx");
const support = read("src/components/admin/SupportInbox.tsx");
const stats = read("src/components/admin/AdminStatsCards.tsx");
const overviewHook = read("src/hooks/useAdminOverviewDashboard.ts");
const analyticsCharts = read("src/components/admin/AdminAnalyticsCharts.tsx");
const quickActions = read("src/components/admin/AdminQuickActionsCards.tsx");
const dailyDrop = read("src/components/admin/AdminDailyDropCard.tsx");
const adminEngagement = read("src/components/admin/AdminEngagementAnalytics.tsx");
const adminEngagementHook = read("src/hooks/useAdminEngagementAnalytics.ts");
const adminUsers = read("src/components/admin/AdminUsersPanel.tsx");
const eventAnalytics = read("src/components/admin/AdminLiveEventMetrics.tsx");
const pushAnalytics = read("src/hooks/usePushAnalytics.ts");
const verificationFunction = read("supabase/functions/admin-review-verification/index.ts");
const generateDailyDropsFunction = read("supabase/functions/generate-daily-drops/index.ts");
const sendSupportReplyFunction = read("supabase/functions/send-support-reply/index.ts");
const createEventCheckoutFunction = read("supabase/functions/create-event-checkout/index.ts");
const dateSuggestionActionsFunction = read("supabase/functions/date-suggestion-actions/index.ts");
const webEntitlementsContext = read("src/contexts/EntitlementsContext.tsx");
const mobileEntitlementsContext = read("apps/mobile/context/EntitlementsContext.tsx");

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

function overviewOperationalTruthFnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = overviewOperationalTruthMigration.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const next = overviewOperationalTruthMigration.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const end = next === -1 ? overviewOperationalTruthMigration.length : next;
  return overviewOperationalTruthMigration.slice(start, end);
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

function photoVerificationHardeningFnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = photoVerificationHardeningMigration.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const next = photoVerificationHardeningMigration.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const revoke = photoVerificationHardeningMigration.indexOf("\nREVOKE ALL ON FUNCTION", start + marker.length);
  const candidates = [next, revoke].filter((i) => i !== -1);
  const end = candidates.length ? Math.min(...candidates) : photoVerificationHardeningMigration.length;
  return photoVerificationHardeningMigration.slice(start, end);
}

function eventAnalyticsReadModelsFnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = eventAnalyticsReadModelsMigration.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const next = eventAnalyticsReadModelsMigration.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const revoke = eventAnalyticsReadModelsMigration.indexOf("\nREVOKE ALL ON FUNCTION", start + marker.length);
  const candidates = [next, revoke].filter((i) => i !== -1);
  const end = candidates.length ? Math.min(...candidates) : eventAnalyticsReadModelsMigration.length;
  return eventAnalyticsReadModelsMigration.slice(start, end);
}

function engagementAnalyticsFnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = engagementAnalyticsMigration.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const revoke = engagementAnalyticsMigration.indexOf("\nREVOKE ALL ON FUNCTION", start + marker.length);
  const classification = engagementAnalyticsMigration.indexOf(
    "\nINSERT INTO public.migration_classifications",
    start + marker.length,
  );
  const candidates = [revoke, classification].filter((i) => i !== -1);
  const end = candidates.length ? Math.min(...candidates) : engagementAnalyticsMigration.length;
  return engagementAnalyticsMigration.slice(start, end);
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

function badgeLegacyFeedbackCleanupFnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = badgeLegacyFeedbackCleanupMigration.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const revoke = badgeLegacyFeedbackCleanupMigration.indexOf("\nREVOKE ALL ON FUNCTION", start + marker.length);
  const classification = badgeLegacyFeedbackCleanupMigration.indexOf(
    "\nINSERT INTO public.migration_classifications",
    start + marker.length,
  );
  const candidates = [revoke, classification].filter((i) => i !== -1);
  const end = candidates.length ? Math.min(...candidates) : badgeLegacyFeedbackCleanupMigration.length;
  return badgeLegacyFeedbackCleanupMigration.slice(start, end);
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

function accountDeletionsFnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = accountDeletionsMigration.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const next = accountDeletionsMigration.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const revoke = accountDeletionsMigration.indexOf("\nREVOKE ALL ON FUNCTION", start + marker.length);
  const candidates = [next, revoke].filter((i) => i !== -1);
  const end = candidates.length ? Math.min(...candidates) : accountDeletionsMigration.length;
  return accountDeletionsMigration.slice(start, end);
}

function supportInboxFnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = supportInboxMigration.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const next = supportInboxMigration.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const revoke = supportInboxMigration.indexOf("\nREVOKE ALL ON FUNCTION", start + marker.length);
  const classification = supportInboxMigration.indexOf("\nINSERT INTO public.migration_classifications", start + marker.length);
  const candidates = [next, revoke, classification].filter((i) => i !== -1);
  const end = candidates.length ? Math.min(...candidates) : supportInboxMigration.length;
  return supportInboxMigration.slice(start, end);
}

function tierConfigAuthorityFnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = tierConfigAuthorityMigration.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const next = tierConfigAuthorityMigration.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const revoke = tierConfigAuthorityMigration.indexOf("\nREVOKE ALL ON FUNCTION", start + marker.length);
  const classification = tierConfigAuthorityMigration.indexOf("\nINSERT INTO public.migration_classifications", start + marker.length);
  const candidates = [next, revoke, classification].filter((i) => i !== -1);
  const end = candidates.length ? Math.min(...candidates) : tierConfigAuthorityMigration.length;
  return tierConfigAuthorityMigration.slice(start, end);
}

function tierConfigConcurrencyRepairFnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = tierConfigConcurrencyRepairMigration.indexOf(marker);
  assert.notEqual(start, -1, `Missing concurrency repair function ${fnName}`);
  const next = tierConfigConcurrencyRepairMigration.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const revoke = tierConfigConcurrencyRepairMigration.indexOf("\nREVOKE ALL ON FUNCTION", start + marker.length);
  const classification = tierConfigConcurrencyRepairMigration.indexOf(
    "\nINSERT INTO public.migration_classifications",
    start + marker.length,
  );
  const candidates = [next, revoke, classification].filter((i) => i !== -1);
  const end = candidates.length ? Math.min(...candidates) : tierConfigConcurrencyRepairMigration.length;
  return tierConfigConcurrencyRepairMigration.slice(start, end);
}

function tierConfigSwipeIdempotencyRepairFnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = tierConfigSwipeIdempotencyRepairMigration.indexOf(marker);
  assert.notEqual(start, -1, `Missing swipe idempotency repair function ${fnName}`);
  const revoke = tierConfigSwipeIdempotencyRepairMigration.indexOf("\nREVOKE ALL ON FUNCTION", start + marker.length);
  const classification = tierConfigSwipeIdempotencyRepairMigration.indexOf(
    "\nINSERT INTO public.migration_classifications",
    start + marker.length,
  );
  const candidates = [revoke, classification].filter((i) => i !== -1);
  const end = candidates.length ? Math.min(...candidates) : tierConfigSwipeIdempotencyRepairMigration.length;
  return tierConfigSwipeIdempotencyRepairMigration.slice(start, end);
}

function tierConfigSwipeLimitRetryRecheckFnSection(fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = tierConfigSwipeLimitRetryRecheckMigration.indexOf(marker);
  assert.notEqual(start, -1, `Missing swipe limit retry recheck function ${fnName}`);
  const revoke = tierConfigSwipeLimitRetryRecheckMigration.indexOf("\nREVOKE ALL ON FUNCTION", start + marker.length);
  const classification = tierConfigSwipeLimitRetryRecheckMigration.indexOf(
    "\nINSERT INTO public.migration_classifications",
    start + marker.length,
  );
  const candidates = [revoke, classification].filter((i) => i !== -1);
  const end = candidates.length ? Math.min(...candidates) : tierConfigSwipeLimitRetryRecheckMigration.length;
  return tierConfigSwipeLimitRetryRecheckMigration.slice(start, end);
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
    assert.match(
      source,
      /public\.(has_role\(v_admin_id, 'admin'::public\.app_role\)|admin_user_has_permission\(v_admin_id, '[^']+'\))/,
      `${fn} must verify an admin role or scoped admin permission`,
    );
    assert.match(source, /log_admin_action/, `${fn} must write admin_activity_logs`);
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`), `${fn} must be revoked from PUBLIC`);
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`), `${fn} must be granted to authenticated`);
  }
});

test("account deletion admin RPCs are guarded, audited, and ACL pinned", () => {
  const listSource = accountDeletionsFnSection("admin_list_account_deletions");
  const completeSource = accountDeletionsFnSection("admin_mark_account_deletion_completed");

  for (const [fn, source] of [
    ["admin_list_account_deletions", listSource],
    ["admin_mark_account_deletion_completed", completeSource],
  ] as const) {
    assert.match(source, /SECURITY DEFINER/, `${fn} must be security definer`);
    assert.match(source, /SET search_path = public, pg_catalog/, `${fn} must pin search_path`);
    assert.match(source, /auth\.uid\(\)/, `${fn} must derive admin identity from auth.uid()`);
    assert.match(source, /public\.has_role\(v_admin_id, 'admin'::public\.app_role\)/, `${fn} must verify admin role`);
    assert.match(accountDeletionsMigration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`), `${fn} must be revoked from PUBLIC`);
    assert.match(accountDeletionsMigration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]+\\) FROM PUBLIC, anon, authenticated;`), `${fn} must clear stale explicit anon/authenticated grants before regrant`);
    assert.match(accountDeletionsMigration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`), `${fn} must be granted to authenticated`);
  }

  assert.match(listSource, /public\.account_deletion_requests/);
  assert.match(listSource, /LEFT JOIN public\.profiles/);
  assert.match(listSource, /can_mark_completed/);
  assert.match(listSource, /v_other_count/);
  assert.match(listSource, /'other', v_other_count/);

  assert.match(completeSource, /admin_idempotency_begin/);
  assert.match(completeSource, /admin_idempotency_complete/);
  assert.match(completeSource, /log_admin_action/);
  assert.match(completeSource, /v_before\.status/);
  assert.match(completeSource, /scheduled_deletion_at > now\(\)/);
  assert.match(completeSource, /completed_at = now\(\)/);
  assert.match(completeSource, /cancelled_at = NULL/);
  assert.match(completeSource, /auth_user_deleted', false/);
  assert.match(completeSource, /profile_deleted', false/);
  assert.match(accountDeletionsMigration, /DROP POLICY IF EXISTS "Admins can view all deletion requests"/);
  assert.match(accountDeletionsMigration, /DROP POLICY IF EXISTS "Admins can update deletion requests"/);
  assert.match(accountDeletionsValidation, /admin_account_deletions_rpcs_acl_and_security_definer/);
  assert.match(accountDeletionsValidation, /account_deletion_requests_rls_enabled/);
  assert.match(accountDeletionsValidation, /account_deletion_completion_requires_pending_due_and_checkpoint_invariants/);
  assert.match(accountDeletionsValidation, /account_deletion_list_reports_hidden_statuses/);
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
  assert.match(adminDeletions, /callAdminRpc<AccountDeletionListPayload>\("admin_list_account_deletions"/);
  assert.match(adminDeletions, /callAdminRpc\("admin_mark_account_deletion_completed"/);
  assert.match(adminDeletions, /createAdminIdempotencyKey\("admin_mark_account_deletion_completed"\)/);
  assert.match(support, /callAdminRpc<SupportInboxPayload>\("admin_get_support_inbox"/);
  assert.match(support, /callAdminRpc<SupportThreadPayload>\("admin_get_support_ticket_thread"/);
  assert.match(support, /callAdminRpc\("admin_update_support_ticket"/);
  assert.match(support, /supabase\.functions\.invoke<SendSupportReplyResponse>\("send-support-reply"/);
  assert.match(support, /callAdminRpc\("admin_create_event_payment_exception"/);
  assert.match(support, /callAdminRpc\("admin_transition_event_payment_exception"/);
  assert.match(overviewHook, /callAdminRpc<AdminOverviewDashboardPayload>\("admin_get_overview_dashboard"/);
  assert.match(stats, /useAdminOverviewDashboard/);
  assert.match(adminUsers, /callAdminRpc<AdminSearchUsersPayload>\("admin_search_users"/);
  assert.match(eventAnalytics, /callAdminRpc<AdminEventAnalyticsOptionsPayload>\("admin_list_event_analytics_options"/);
  assert.match(eventAnalytics, /callAdminRpc<AdminEventLiveAnalyticsPayload>\("admin_get_event_live_analytics"/);
  assert.match(eventAnalytics, /callAdminRpc<AdminEventPostAnalyticsPayload>\("admin_get_event_post_analytics"/);
  assert.match(eventAnalytics, /callAdminRpc<AdminEventLifecycleFeedPayload>\("admin_get_event_lifecycle_feed"/);
  assert.doesNotMatch(eventAnalytics, /callAdminRpc<AdminEventMetricsPayload>\("admin_get_event_metrics"/);
  assert.doesNotMatch(eventAnalytics, /supabase\s*\.\s*from\(/);
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

test("Support Inbox admin RPCs are governed, audited, ACL pinned, and lifecycle-aware", () => {
  const writeStatement = /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\s/im;

  for (const fn of ["admin_get_support_inbox", "admin_get_support_ticket_thread"]) {
    const source = supportInboxFnSection(fn);
    assert.match(source, /SECURITY DEFINER/, `${fn} must be security definer`);
    assert.match(source, /SET search_path = public, pg_catalog/, `${fn} must pin search_path`);
    assert.match(source, /auth\.uid\(\)/, `${fn} must derive admin identity from auth.uid()`);
    assert.match(source, /public\.admin_user_has_permission\(v_admin_id, 'support\.manage'\)/, `${fn} must require support.manage`);
    assert.match(source, /public\.admin_json_success/, `${fn} must return the admin JSON envelope`);
    assert.doesNotMatch(source, writeStatement, `${fn} must stay read-only`);
    assert.doesNotMatch(source, /SELECT\s+\*/, `${fn} must avoid wide table projection`);
    assert.doesNotMatch(source, /to_jsonb\(/, `${fn} must avoid implicit row JSON projection`);
    assert.match(supportInboxMigration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]+\\) FROM PUBLIC, anon, authenticated;`), `${fn} must clear stale grants`);
    assert.match(supportInboxMigration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`), `${fn} must be granted to authenticated`);
  }

  for (const fn of ["admin_update_support_ticket", "admin_create_support_reply"]) {
    const source = supportInboxFnSection(fn);
    assert.match(source, /SECURITY DEFINER/, `${fn} must be security definer`);
    assert.match(source, /SET search_path = public, pg_catalog/, `${fn} must pin search_path`);
    assert.match(source, /auth\.uid\(\)/, `${fn} must derive admin identity from auth.uid()`);
    assert.match(source, /public\.admin_user_has_permission\(v_admin_id, 'support\.manage'\)/, `${fn} must require support.manage`);
    assert.match(source, /admin_idempotency_begin/, `${fn} must start the idempotency ledger`);
    assert.match(source, /admin_idempotency_complete/, `${fn} must complete the idempotency ledger`);
    assert.match(source, /log_admin_action/, `${fn} must write admin_activity_logs`);
    assert.match(source, /public\.support_ticket_events/, `${fn} must leave a support event trail`);
    assert.match(supportInboxMigration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]+\\) FROM PUBLIC, anon, authenticated;`), `${fn} must clear stale grants`);
    assert.match(supportInboxMigration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`), `${fn} must be granted to authenticated`);
  }

  assert.match(supportInboxFnSection("admin_create_support_reply"), /v_ticket\.status = 'resolved'/);
  assert.match(supportInboxFnSection("admin_create_support_reply"), /Reopen the support ticket before sending another reply/);
  assert.match(supportInboxFnSection("admin_create_support_reply"), /SET status = 'waiting_on_user'/);
  assert.match(supportInboxFnSection("admin_update_support_ticket"), /p_set_event_id/);
  assert.match(supportInboxFnSection("admin_update_support_ticket"), /p_set_checkout_session_id/);

  const triggerSource = supportInboxFnSection("support_ticket_reply_status_sync");
  assert.match(triggerSource, /SECURITY DEFINER/);
  assert.match(triggerSource, /SET search_path = public, pg_catalog/);
  assert.match(triggerSource, /NEW\.sender_type = 'user'/);
  assert.match(triggerSource, /WHEN status = 'resolved' THEN status/);
  assert.match(triggerSource, /ELSE 'in_review'/);
  assert.match(supportInboxMigration, /CREATE TRIGGER support_ticket_replies_status_sync[\s\S]*AFTER INSERT ON public\.support_ticket_replies/);
  assert.match(supportInboxMigration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.support_tickets/);
  assert.match(supportInboxMigration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.support_ticket_replies/);
  assert.match(supportInboxMigration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.support_ticket_events/);
  assert.match(supportInboxMigration, /GRANT SELECT ON public\.support_ticket_events TO authenticated/);
  assert.match(supportInboxMigration, /'20260507180000'/);
  assert.match(supportInboxMigration, /No support tickets are seeded or backfilled/);
});

test("Support Inbox live drift guard reasserts realtime and least-privilege grants", () => {
  assert.match(supportInboxLiveDriftGuardMigration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.support_tickets/);
  assert.match(supportInboxLiveDriftGuardMigration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.support_ticket_replies/);
  assert.match(supportInboxLiveDriftGuardMigration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.support_ticket_events/);
  assert.match(supportInboxLiveDriftGuardMigration, /WHEN duplicate_object OR undefined_object THEN NULL/);

  for (const table of [
    "support_tickets",
    "support_ticket_replies",
    "support_ticket_attachments",
    "support_ticket_events",
  ]) {
    assert.match(
      supportInboxLiveDriftGuardMigration,
      new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`),
      `${table} must keep RLS enabled`,
    );
    assert.match(
      supportInboxLiveDriftGuardMigration,
      new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated;`),
      `${table} must clear broad stale grants`,
    );
  }

  assert.match(supportInboxLiveDriftGuardMigration, /GRANT SELECT, INSERT ON TABLE public\.support_tickets TO authenticated/);
  assert.match(supportInboxLiveDriftGuardMigration, /GRANT SELECT, INSERT ON TABLE public\.support_ticket_replies TO authenticated/);
  assert.match(supportInboxLiveDriftGuardMigration, /GRANT SELECT, INSERT ON TABLE public\.support_ticket_attachments TO authenticated/);
  assert.match(supportInboxLiveDriftGuardMigration, /GRANT SELECT ON TABLE public\.support_ticket_events TO authenticated/);
  assert.doesNotMatch(supportInboxLiveDriftGuardMigration, /GRANT .*ON TABLE public\.support_ticket_events TO anon/);
  assert.match(supportInboxLiveDriftGuardMigration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.support_ticket_events TO service_role/);
  assert.match(supportInboxLiveDriftGuardMigration, /'20260508093000'/);
  assert.match(supportInboxLiveDriftGuardMigration, /No support data is rewritten or deleted/);
});

test("send-support-reply saves through the governed admin reply RPC before notification side effects", () => {
  const saveIndex = sendSupportReplyFunction.indexOf('userClient.rpc("admin_create_support_reply"');
  const notificationIndex = sendSupportReplyFunction.indexOf("/functions/v1/send-notification");

  assert.ok(saveIndex > -1, "send-support-reply must call admin_create_support_reply");
  assert.ok(notificationIndex > saveIndex, "reply save must happen before notification delivery");
  assert.match(sendSupportReplyFunction, /idempotent_replay/);
  assert.match(sendSupportReplyFunction, /notification_warning/);
  assert.match(sendSupportReplyFunction, /email_warning/);
  assert.match(sendSupportReplyFunction, /sanitizeErrorMessage/);
  assert.match(sendSupportReplyFunction, /case "INVALID_TRANSITION":[\s\S]{0,80}return 409/);
  assert.match(sendSupportReplyFunction, /send-notification error for support reply:", sanitizeErrorMessage\(notifyError\)/);
  assert.match(sendSupportReplyFunction, /Resend email failed for support reply:", sanitizeErrorMessage\(emailError\)/);
  assert.match(sendSupportReplyFunction, /send-support-reply:", sanitizeErrorMessage\(e\)/);
  assert.doesNotMatch(sendSupportReplyFunction, /jsonResponse\(\{ error: String\(e\) \}/);
  assert.doesNotMatch(sendSupportReplyFunction, /from\(["']support_ticket_replies["']\)[\s\S]{0,300}\.insert\(/);
  assert.doesNotMatch(sendSupportReplyFunction, /from\(["']support_tickets["']\)[\s\S]{0,300}\.update\(/);
});

test("tier config authority migration validates overrides and enforces backend entitlements", () => {
  assert.match(tierConfigAuthorityMigration, /INSERT INTO public\.migration_classifications/);
  assert.match(tierConfigAuthorityMigration, /'20260507190000'/);
  assert.match(tierConfigConcurrencyRepairMigration, /INSERT INTO public\.migration_classifications/);
  assert.match(tierConfigConcurrencyRepairMigration, /'20260507193000'/);
  assert.match(tierConfigSwipeIdempotencyRepairMigration, /INSERT INTO public\.migration_classifications/);
  assert.match(tierConfigSwipeIdempotencyRepairMigration, /'20260507194000'/);
  assert.match(tierConfigSwipeLimitRetryRecheckMigration, /INSERT INTO public\.migration_classifications/);
  assert.match(tierConfigSwipeLimitRetryRecheckMigration, /'20260507195000'/);
  assert.match(tierConfigOverrideAuditLockdownMigration, /INSERT INTO public\.migration_classifications/);
  assert.match(tierConfigOverrideAuditLockdownMigration, /'20260507200000'/);
  assert.match(tierConfigOverrideAuditLockdownMigration, /'schema\+policy'/);
  assert.doesNotMatch(tierConfigOverrideAuditLockdownMigration, /'policy'/);
  assert.match(tierConfigOverrideAuditLockdownMigration, /DROP POLICY IF EXISTS "Admins can manage tier config"/);
  assert.match(tierConfigOverrideAuditLockdownMigration, /CREATE POLICY "Service role can manage tier config overrides"/);
  assert.match(tierConfigOverrideAuditLockdownMigration, /auth\.role\(\) = 'service_role'/);
  assert.match(tierConfigAuthorityMigration, /tier_config_overrides_capability_key_check/);
  assert.match(tierConfigAuthorityMigration, /tier_config_overrides_value_check/);
  assert.match(tierConfigAuthorityMigration, /tier_config_override_value_is_valid/);
  assert.match(tierConfigAuthorityMigration, /2147483647/);
  assert.match(tierConfigAuthorityMigration, /DELETE FROM public\.tier_config_overrides[\s\S]*capability_key NOT IN/);
  assert.match(tierConfigAuthorityMigration, /DELETE FROM public\.tier_config_overrides[\s\S]*tier_config_override_value_is_valid\(capability_key, value\)/);
  assert.match(tierConfigAuthorityMigration, /v_access_value jsonb/);
  assert.match(tierConfigAuthorityMigration, /COALESCE\(\([\s\S]*SELECT jsonb_agg\(tier[\s\S]*'\[\]'::jsonb\)/);

  const getUserCaps = tierConfigAuthorityFnSection("get_user_tier_capabilities");
  assert.match(getUserCaps, /SECURITY DEFINER/);
  assert.match(getUserCaps, /auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  assert.match(getUserCaps, /v_uid IS DISTINCT FROM p_user_id/);
  assert.match(getUserCaps, /public\.has_role\(v_uid, 'admin'::public\.app_role\)/);

  for (const fn of ["set_tier_config_override", "reset_tier_config_override"]) {
    const source = tierConfigAuthorityFnSection(fn);
    assert.match(source, /SECURITY DEFINER/, `${fn} must be security definer`);
    assert.match(source, /SET search_path = public, pg_catalog/, `${fn} must pin search_path`);
    assert.match(source, /public\.has_role\(v_admin, 'admin'::public\.app_role\)/, `${fn} must require admin role`);
    assert.match(source, /public\.tier_config_audit/, `${fn} must audit override changes`);
    assert.match(tierConfigAuthorityMigration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`), `${fn} must be revoked from PUBLIC`);
    assert.match(tierConfigAuthorityMigration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`), `${fn} must be granted to authenticated`);
  }

  assert.match(tierConfigAuthorityFnSection("set_tier_config_override"), /assert_tier_config_override_valid/);
  assert.match(tierConfigAuthorityFnSection("get_visible_events"), /_user_can_access_event_visibility_unchecked/);
  assert.match(tierConfigAuthorityFnSection("register_for_event"), /monthlyEventJoins/);
  assert.match(tierConfigConcurrencyRepairFnSection("register_for_event"), /pg_advisory_xact_lock/);
  assert.match(tierConfigAuthorityFnSection("settle_event_ticket_checkout"), /MONTHLY_EVENT_JOIN_LIMIT_REACHED/);
  assert.match(tierConfigConcurrencyRepairFnSection("settle_event_ticket_checkout"), /pg_advisory_xact_lock/);
  assert.match(tierConfigConcurrencyRepairFnSection("replenish_monthly_credits"), /GET DIAGNOSTICS[\s\S]*ROW_COUNT/);
  assert.match(tierConfigAuthorityFnSection("handle_swipe"), /dailySwipeLimit/);
  assert.match(tierConfigAuthorityFnSection("handle_swipe"), /maxActiveConversations/);
  assert.match(tierConfigConcurrencyRepairFnSection("handle_swipe"), /pg_advisory_xact_lock/);
  assert.match(
    tierConfigSwipeIdempotencyRepairFnSection("handle_swipe"),
    /FROM public\.event_swipes es[\s\S]*RETURN public\.handle_swipe_20260507190000_tier_authority_base[\s\S]*v_daily_limit :=/,
  );
  assert.match(tierConfigSwipeIdempotencyRepairFnSection("handle_swipe"), /pg_advisory_xact_lock/);
  assert.match(
    tierConfigSwipeLimitRetryRecheckFnSection("handle_swipe"),
    /pg_advisory_xact_lock\(hashtext\(p_actor_id::text\), hashtext\('dailySwipeLimit'\)\);[\s\S]*FROM public\.event_swipes es[\s\S]*RETURN public\.handle_swipe_20260507190000_tier_authority_base[\s\S]*SELECT count\(\*\)::integer/,
  );
  assert.match(tierConfigAuthorityFnSection("date_suggestion_apply_v2"), /canSuggestDate/);
  assert.match(tierConfigAuthorityFnSection("enforce_user_schedule_tier_capability"), /canUseVibeSchedule/);
  assert.match(tierConfigAuthorityMigration, /public\.get_user_tier_capabilities\(auth\.uid\(\)\)->>'canSeeLikedYou'/);
  assert.match(createEventCheckoutFunction, /get_user_tier_capabilities/);
  assert.match(createEventCheckoutFunction, /MONTHLY_EVENT_JOIN_LIMIT_REACHED/);
  assert.match(dateSuggestionActionsFunction, /date_suggestion_apply_v2/);
  assert.match(dateSuggestionActionsFunction, /get_user_tier_capabilities/);
  assert.match(dateSuggestionActionsFunction, /canSuggestDate/);
  assert.match(dateSuggestionActionsFunction, /canUseVibeSchedule/);
  assert.match(dateSuggestionActionsFunction, /truthyFlag/);
  for (const source of [webEntitlementsContext, mobileEntitlementsContext]) {
    assert.match(source, /get_user_tier_capabilities/);
    assert.match(source, /showEntitlementsError/);
    assert.match(source, /Premium gates are using safe defaults/);
    assert.match(source, /query\.refetch/);
    assert.doesNotMatch(source, /from\(["']profiles["']\)/);
    assert.doesNotMatch(source, /from\(["']tier_config_overrides["']\)/);
  }
  assert.match(webEntitlementsContext, /role="alert"/);
  assert.match(mobileEntitlementsContext, /accessibilityRole="alert"/);
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
    adminDeletions,
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
    /from\(["']account_deletion_requests["']\)[\s\S]{0,300}\.(insert|update|upsert|delete)\(/,
    /from\(["']support_tickets["']\)[\s\S]{0,300}\.(insert|update|upsert|delete)\(/,
    /from\(["']support_ticket_replies["']\)[\s\S]{0,300}\.(insert|update|upsert|delete)\(/,
    /from\(["']event_payment_exceptions["']\)[\s\S]{0,300}\.(insert|update|upsert|delete)\(/,
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
  const operationalOverview = overviewOperationalTruthFnSection("admin_get_overview_dashboard");
  assert.match(operationalOverview, /p_now timestamptz DEFAULT NULL/);
  assert.match(operationalOverview, /STABLE/);
  assert.match(operationalOverview, /v_now timestamptz := COALESCE\(p_now, now\(\)\)/);
  assert.match(operationalOverview, /'generated_at', v_now/);
  assert.match(operationalOverview, /public\.daily_drop_generation_runs/);
  assert.match(operationalOverview, /'last_run'/);
  assert.match(overviewMigration, /REVOKE ALL ON FUNCTION public\.admin_get_overview_dashboard\(timestamptz\) FROM PUBLIC/);
  assert.match(overviewOperationalTruthMigration, /REVOKE ALL ON FUNCTION public\.admin_get_overview_dashboard\(timestamptz\) FROM PUBLIC/);
  assert.match(overviewMigration, /GRANT EXECUTE ON FUNCTION public\.admin_get_overview_dashboard\(timestamptz\) TO authenticated/);
  assert.match(overviewOperationalTruthMigration, /GRANT EXECUTE ON FUNCTION public\.admin_get_overview_dashboard\(timestamptz\) TO authenticated/);
  assert.match(overviewMigration, /'20260506135000'/);
  assert.match(overviewMigration, /Admin Overview dashboard read model/);
  assert.match(overviewOperationalTruthMigration, /'20260507211000'/);
  assert.match(overviewOperationalTruthMigration, /Admin Overview operational truth/);
  assert.match(fnSection("admin_search_users"), /count\(\*\)::integer AS total_count/);
  assert.match(fnSection("admin_get_event_metrics"), /participant_reports_near_event_window/);
  assert.match(fnSection("admin_get_push_delivery_metrics"), /app_notification_log/);
  assert.match(fnSection("admin_get_push_delivery_metrics"), /push_telemetry/);
  for (const fn of [
    "admin_list_event_analytics_options",
    "admin_get_event_live_analytics",
    "admin_get_event_post_analytics",
    "admin_get_event_lifecycle_feed",
  ]) {
    const source = eventAnalyticsReadModelsFnSection(fn);
    assert.match(source, /SECURITY DEFINER/, `${fn} must be security definer`);
    assert.match(source, /SET search_path = public, pg_catalog/, `${fn} must pin search_path`);
    assert.match(source, /auth\.uid\(\)/, `${fn} must derive admin identity from auth.uid()`);
    assert.match(source, /public\.admin_user_has_permission\(v_admin_id, 'intelligence\.read'\)/, `${fn} must require intelligence.read`);
    assert.match(source, /public\.admin_json_success/, `${fn} must return the admin JSON envelope`);
    assert.doesNotMatch(source, /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\s/im, `${fn} must stay read-only`);
    assert.doesNotMatch(source, /SELECT\s+\*/, `${fn} must avoid wide table projection`);
    assert.doesNotMatch(source, /to_jsonb\(/, `${fn} must avoid implicit row JSON projection`);
    assert.match(eventAnalyticsReadModelsMigration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(`), `${fn} must be revoked from PUBLIC`);
    assert.match(eventAnalyticsReadModelsMigration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]+\\) FROM PUBLIC, anon, authenticated;`), `${fn} must clear stale explicit anon/authenticated grants before regrant`);
    assert.match(eventAnalyticsReadModelsMigration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(`), `${fn} must be granted to authenticated`);
  }

  assert.match(eventAnalyticsReadModelsFnSection("admin_list_event_analytics_options"), /jsonb_build_object\(\s*'id', filtered\.id/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_list_event_analytics_options"), /'archived_at', filtered\.archived_at/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_live_analytics"), /public\.event_registrations/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_live_analytics"), /public\.video_sessions/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_live_analytics"), /public\.matches/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_live_analytics"), /public\.user_reports/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_live_analytics"), /er\.attended IS TRUE/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_live_analytics"), /'attendance_marked_count', v_attendance_marked/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_live_analytics"), /'no_show_count', v_no_show/);
  assert.doesNotMatch(eventAnalyticsReadModelsFnSection("admin_get_event_live_analytics"), /attendance_marked IS TRUE OR er\.attended IS TRUE/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_post_analytics"), /public\.date_feedback/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_post_analytics"), /EXCEPTION WHEN others/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_post_analytics"), /'post_metrics', 'null'::jsonb/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_post_analytics"), /'post_metrics_status', 'unavailable'/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_lifecycle_feed"), /public\.event_reminder_queue/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_lifecycle_feed"), /public\.notification_log/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_lifecycle_feed"), /public\.waitlist_promotion_notify_queue/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_lifecycle_feed"), /public\.stripe_event_ticket_settlements/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_lifecycle_feed"), /public\.event_swipes/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_lifecycle_feed"), /public\.video_sessions/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_lifecycle_feed"), /public\.admin_activity_logs/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_lifecycle_feed"), /public\.event_payment_exceptions/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_lifecycle_feed"), /vs\.state::text/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_lifecycle_feed"), /EXCEPTION WHEN others/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_lifecycle_feed"), /'payment_exceptions', v_payment_exceptions/);
  assert.match(eventAnalyticsReadModelsFnSection("admin_get_event_lifecycle_feed"), /'payment_exception_status_counts', v_payment_exception_status_counts/);
  assert.doesNotMatch(eventAnalyticsReadModelsFnSection("admin_get_event_lifecycle_feed"), /'user_id'/);
  assert.match(eventLifecycleFeedMigration, /'20260507113000'/);
  assert.match(eventAnalyticsReadModelsMigration, /INSERT INTO public\.migration_classifications/);
  assert.match(eventAnalyticsReadModelsMigration, /'20260507163000'/);
  assert.match(eventAnalyticsReadModelsMigration, /'schema-only'/);

  const engagementSource = engagementAnalyticsFnSection("admin_get_engagement_analytics");
  assert.match(engagementSource, /SECURITY DEFINER/);
  assert.match(engagementSource, /SET search_path = public, pg_catalog/);
  assert.match(engagementSource, /auth\.uid\(\)/);
  assert.match(engagementSource, /public\.has_role\(v_admin_id, 'admin'::public\.app_role\)/);
  assert.match(engagementSource, /public\.admin_json_success/);
  assert.match(engagementSource, /date_trunc\('day', p_window_start AT TIME ZONE 'UTC'\)/);
  assert.match(engagementSource, /generate_series\(v_window_start, v_window_end - interval '1 day', interval '1 day'\)/);
  assert.match(engagementSource, /public\.push_notification_events_admin/);
  assert.match(engagementSource, /public\.notification_log/);
  assert.match(engagementSource, /public\.daily_drops/);
  assert.match(engagementSource, /public\.messages/);
  assert.match(engagementSource, /public\.matches/);
  assert.match(engagementSource, /public\.event_registrations/);
  assert.match(engagementSource, /'reporting_timezone', 'UTC'/);
  assert.match(engagementSource, /'active_unopened'/);
  assert.match(engagementSource, /'active_viewed'/);
  assert.match(engagementSource, /'active_opener_sent'/);
  assert.match(engagementSource, /'expired_no_action'/);
  assert.match(engagementSource, /'expired_no_reply'/);
  assert.match(engagementSource, /'invalidated'/);
  assert.match(engagementSource, /'engagement_rate'/);
  assert.match(engagementSource, /'match_conversion_rate'/);
  assert.match(engagementSource, /'app_by_category'/);
  assert.doesNotMatch(engagementSource, /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\s/im);
  assert.doesNotMatch(engagementSource, /SELECT\s+\*/);
  assert.doesNotMatch(engagementSource, /to_jsonb\(/);
  assert.doesNotMatch(engagementSource, /status = 'pending'/);
  assert.doesNotMatch(engagementSource, /status = 'liked'/);
  assert.doesNotMatch(engagementSource, /status = 'expired'/);
  assert.match(engagementAnalyticsMigration, /REVOKE ALL ON FUNCTION public\.admin_get_engagement_analytics\(timestamptz, timestamptz\) FROM PUBLIC, anon, authenticated/);
  assert.match(engagementAnalyticsMigration, /GRANT EXECUTE ON FUNCTION public\.admin_get_engagement_analytics\(timestamptz, timestamptz\) TO authenticated/);
  assert.match(engagementAnalyticsMigration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.daily_drops/);
  assert.match(engagementAnalyticsMigration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.notification_log/);
  assert.match(engagementAnalyticsMigration, /WHEN duplicate_object OR undefined_object THEN NULL/);
  assert.match(engagementAnalyticsMigration, /INSERT INTO public\.migration_classifications/);
  assert.match(engagementAnalyticsMigration, /'20260507201000'/);
  assert.match(engagementAnalyticsMigration, /'schema-only'/);
  assert.match(engagementAnalyticsIndexesMigration, /CREATE INDEX IF NOT EXISTS idx_admin_engagement_daily_drops_starts_at[\s\S]*ON public\.daily_drops \(starts_at\)/);
  assert.match(engagementAnalyticsIndexesMigration, /CREATE INDEX IF NOT EXISTS idx_admin_engagement_daily_drops_status_starts_at[\s\S]*ON public\.daily_drops \(status, starts_at\)/);
  assert.match(engagementAnalyticsIndexesMigration, /CREATE INDEX IF NOT EXISTS idx_admin_engagement_messages_created_at[\s\S]*ON public\.messages \(created_at\)/);
  assert.match(engagementAnalyticsIndexesMigration, /CREATE INDEX IF NOT EXISTS idx_admin_engagement_matches_matched_at[\s\S]*ON public\.matches \(matched_at\)/);
  assert.match(engagementAnalyticsIndexesMigration, /CREATE INDEX IF NOT EXISTS idx_admin_engagement_event_registrations_registered_at[\s\S]*ON public\.event_registrations \(registered_at\)/);
  assert.match(engagementAnalyticsIndexesMigration, /CREATE INDEX IF NOT EXISTS idx_admin_engagement_notification_log_created_category[\s\S]*ON public\.notification_log \(created_at, category\)/);
  assert.match(engagementAnalyticsIndexesMigration, /'20260507204000'/);
  assert.match(engagementAnalyticsIndexesMigration, /'schema-only'/);
  assert.doesNotMatch(engagementAnalyticsIndexesMigration, /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\s+(?!INTO public\.migration_classifications\b)/im);
  assert.match(adminEngagementHook, /callAdminRpc<AdminEngagementAnalyticsPayload>\("admin_get_engagement_analytics"/);
  assert.match(adminEngagementHook, /queryKey: \[\.\.\.ADMIN_ENGAGEMENT_ANALYTICS_QUERY_KEY, days\]/);
  assert.match(adminEngagementHook, /queryFn: \(\) => \{\s*const window = getUtcWindow\(days\)/);
  assert.match(adminEngagementHook, /refetchInterval: 30_000/);
  assert.doesNotMatch(adminEngagementHook, /useMemo/);
  assert.match(adminEngagement, /useAdminEngagementAnalytics\(30\)/);
  assert.doesNotMatch(adminEngagement, /supabase\s*\.\s*from\(/);
  assert.doesNotMatch(adminEngagement, /\.from\(['"](admin_notifications|daily_drops|messages|matches|event_registrations|push_notification_events(?:_admin)?|notification_log)['"]\)/);
  assert.doesNotMatch(adminUsers, /\.from\(['"]profiles['"]\)/);
  assert.doesNotMatch(adminUsers, /\.from\(['"]event_registrations['"]\)/);
  assert.doesNotMatch(adminUsers, /\.from\(['"]profile_vibes['"]\)/);
  assert.doesNotMatch(eventAnalytics, /\.from\("user_reports"\)/);
  assert.doesNotMatch(eventAnalytics, /supabase\s*\.\s*from\(/);
  assert.doesNotMatch(eventAnalytics, /\.from\("events"\)/);
  assert.doesNotMatch(eventAnalytics, /\.from\("event_registrations"\)/);
  assert.doesNotMatch(eventAnalytics, /\.from\("video_sessions"\)/);
  assert.doesNotMatch(eventAnalytics, /\.from\("date_feedback"\)/);
  assert.doesNotMatch(eventAnalytics, /\.from\("event_payment_exceptions"\)/);
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
  assert.match(reviewCommentFollowupFnSection("admin_get_dashboard_badge_counts"), /public\.feedback/);

  const badgeCounts = badgeLegacyFeedbackCleanupFnSection("admin_get_dashboard_badge_counts");
  assert.match(badgeCounts, /SECURITY DEFINER/);
  assert.match(badgeCounts, /SET search_path = public, pg_catalog/);
  assert.match(badgeCounts, /auth\.uid\(\)/);
  assert.match(badgeCounts, /public\.has_role\(v_admin_id, 'admin'::public\.app_role\)/);
  assert.match(badgeCounts, /public\.admin_notifications/);
  assert.match(badgeCounts, /public\.support_tickets/);
  assert.match(badgeCounts, /status IN \('submitted', 'in_review'\)/);
  assert.doesNotMatch(badgeCounts, /waiting_on_user/);
  assert.doesNotMatch(badgeCounts, /public\.feedback/);
  assert.doesNotMatch(badgeCounts, /new_feedback/);
  assert.match(badgeLegacyFeedbackCleanupMigration, /REVOKE ALL ON FUNCTION public\.admin_get_dashboard_badge_counts\(\) FROM PUBLIC/);
  assert.match(badgeLegacyFeedbackCleanupMigration, /GRANT EXECUTE ON FUNCTION public\.admin_get_dashboard_badge_counts\(\) TO authenticated/);
  assert.match(adminDashboard, /callAdminRpc<AdminDashboardBadgeCountsPayload>\("admin_get_dashboard_badge_counts"/);
  assert.doesNotMatch(adminDashboard, /new_feedback/);
  assert.doesNotMatch(adminDashboard, /\.from\(['"]admin_notifications['"]\)/);
  assert.doesNotMatch(adminDashboard, /\.from\(['"]support_tickets['"]\)/);
  assert.doesNotMatch(adminDashboard, /\.from\(['"]feedback['"]\)/);
  assert.doesNotMatch(adminDashboard, /head:\s*true/);
  assert.doesNotMatch(adminDashboard, /admin_get_notification_counts/);
  assert.doesNotMatch(adminDashboard, /admin_get_system_health/);
});

test("Daily Drop generation exposes operational run truth and admin audit", () => {
  assert.match(overviewOperationalTruthMigration, /CREATE TABLE IF NOT EXISTS public\.daily_drop_generation_runs/);
  assert.match(overviewOperationalTruthMigration, /status IN \('started', 'succeeded', 'skipped', 'failed', 'partial'\)/);
  assert.match(overviewOperationalTruthMigration, /source IN \('cron', 'admin', 'unknown'\)/);
  assert.match(overviewOperationalTruthMigration, /admin_id uuid REFERENCES auth\.users\(id\) ON DELETE SET NULL/);
  assert.match(overviewOperationalTruthMigration, /ALTER TABLE public\.daily_drop_generation_runs ENABLE ROW LEVEL SECURITY/);
  assert.match(overviewOperationalTruthMigration, /GRANT SELECT ON public\.daily_drop_generation_runs TO authenticated/);
  assert.match(
    adminPostPublishGrantsAndCancelCutoffMigration,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.daily_drop_generation_runs TO service_role/,
  );
  assert.match(overviewOperationalTruthMigration, /admins_select_daily_drop_generation_runs/);
  assert.match(overviewOperationalTruthMigration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.daily_drop_generation_runs/);
  assert.match(overviewOperationalTruthMigration, /WHEN duplicate_object OR undefined_object THEN NULL/);
  assert.match(overviewOperationalTruthMigration, /idx_daily_drop_generation_runs_started_at/);
  assert.match(overviewOperationalTruthMigration, /idx_profiles_created_at/);
  assert.match(overviewOperationalTruthMigration, /idx_matches_matched_at/);
  assert.match(overviewOperationalTruthMigration, /idx_daily_drops_drop_date/);
  assert.match(overviewOperationalTruthMigration, /idx_events_admin_overview_actionable/);

  assert.match(generateDailyDropsFunction, /createGenerationRun/);
  assert.match(generateDailyDropsFunction, /completeGenerationRun/);
  assert.match(generateDailyDropsFunction, /\.from\("daily_drop_generation_runs"\)/);
  assert.match(generateDailyDropsFunction, /\.from\("admin_activity_logs"\)/);
  assert.match(generateDailyDropsFunction, /action_type: "generate_daily_drops"/);
  assert.match(generateDailyDropsFunction, /force_regenerate_requires_admin_jwt/);
  assert.match(generateDailyDropsFunction, /database_step_failed/);
  assert.match(generateDailyDropsFunction, /count_existing_today_drops/);
  assert.match(generateDailyDropsFunction, /delete_existing_today_drops/);
  assert.match(generateDailyDropsFunction, /select_existing_matches/);
  assert.match(generateDailyDropsFunction, /select_blocked_users/);
  assert.match(generateDailyDropsFunction, /select_user_reports/);
  assert.match(generateDailyDropsFunction, /select_active_cooldowns/);
  assert.match(generateDailyDropsFunction, /\[drop\.user_a_id, drop\.user_b_id\]\.sort\(\)/);
  assert.match(generateDailyDropsFunction, /\[c\.user_a_id, c\.user_b_id\]\.sort\(\)\.join\(":"\)/);
  assert.match(generateDailyDropsFunction, /notificationFailures/);
  assert.match(generateDailyDropsFunction, /notification_failures/);
  assert.match(generateDailyDropsFunction, /usersNotified: notifiedSuccessCount/);
  assert.match(generateDailyDropsFunction, /status: "failed"/);
  assert.match(generateDailyDropsFunction, /status: "partial"/);
  assert.match(generateDailyDropsFunction, /status: "skipped"/);
  assert.match(generateDailyDropsFunction, /source: generationSource/);
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

test("photo verification hardening constrains user submissions and preserves duplicate pending rows", () => {
  assert.match(photoVerificationHardeningMigration, /ADD CONSTRAINT photo_verifications_status_check/);
  assert.match(photoVerificationHardeningMigration, /CHECK \(status IN \('pending', 'approved', 'rejected', 'superseded'\)\)/);
  assert.match(photoVerificationHardeningMigration, /ADD CONSTRAINT photo_verifications_selfie_url_not_blank/);
  assert.match(photoVerificationHardeningMigration, /ADD CONSTRAINT photo_verifications_profile_photo_url_not_blank/);
  assert.match(photoVerificationHardeningMigration, /ADD CONSTRAINT photo_verifications_client_confidence_score_range/);
  assert.match(photoVerificationHardeningMigration, /client_confidence_score BETWEEN 0 AND 100/);
  assert.match(photoVerificationHardeningMigration, /ADD CONSTRAINT photo_verifications_pending_review_fields_null/);
  assert.match(photoVerificationHardeningMigration, /reviewed_by IS NULL/);
  assert.match(photoVerificationHardeningMigration, /reviewed_at IS NULL/);
  assert.match(photoVerificationHardeningMigration, /rejection_reason IS NULL/);
  assert.match(photoVerificationHardeningMigration, /ADD CONSTRAINT photo_verifications_final_review_metadata_present/);
  assert.match(photoVerificationHardeningMigration, /ADD CONSTRAINT photo_verifications_rejected_reason_not_blank/);
  assert.match(photoVerificationHardeningMigration, /ADD CONSTRAINT photo_verifications_superseded_reason_present/);
  assert.match(photoVerificationHardeningMigration, /WITH ranked_pending AS/);
  assert.match(photoVerificationHardeningMigration, /row_number\(\) OVER \(/);
  assert.match(photoVerificationHardeningMigration, /PARTITION BY user_id/);
  assert.match(photoVerificationHardeningMigration, /ORDER BY created_at DESC, id DESC/);
  assert.match(photoVerificationHardeningMigration, /UPDATE public\.photo_verifications pv/);
  assert.match(photoVerificationHardeningMigration, /SET status = 'superseded'/);
  assert.match(photoVerificationHardeningMigration, /Superseded by newer pending photo verification during migration\./);
  assert.doesNotMatch(photoVerificationHardeningMigration, /DELETE FROM public\.photo_verifications pv/);
  assert.ok(
    photoVerificationHardeningMigration.indexOf("WITH ranked_pending AS") <
      photoVerificationHardeningMigration.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_verifications_one_pending_per_user"),
    "duplicate pending rows must be collapsed before adding pending-per-user uniqueness",
  );
  assert.match(photoVerificationHardeningMigration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_photo_verifications_one_pending_per_user/);
  assert.match(photoVerificationHardeningMigration, /WHERE status = 'pending'/);
  assert.match(photoVerificationHardeningMigration, /DROP POLICY IF EXISTS "Users can submit verifications"/);
  assert.match(photoVerificationHardeningMigration, /CREATE POLICY "Users can submit pending verifications"/);
  assert.match(photoVerificationHardeningMigration, /auth\.uid\(\) = user_id/);
  assert.match(photoVerificationHardeningMigration, /AND status = 'pending'/);
  assert.match(photoVerificationHardeningMigration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.photo_verifications/);
  assert.match(photoVerificationHardeningMigration, /INSERT INTO public\.migration_classifications/);
  assert.match(photoVerificationHardeningMigration, /'20260507170000'/);
});

test("photo verification superseded follow-up is cloud-safe and non-destructive", () => {
  assert.match(photoVerificationSupersededFollowupMigration, /DROP CONSTRAINT IF EXISTS photo_verifications_status_check/);
  assert.match(photoVerificationSupersededFollowupMigration, /CHECK \(status IN \('pending', 'approved', 'rejected', 'superseded'\)\)/);
  assert.match(photoVerificationSupersededFollowupMigration, /ADD CONSTRAINT photo_verifications_superseded_reason_present/);
  assert.match(photoVerificationSupersededFollowupMigration, /UPDATE public\.photo_verifications pv/);
  assert.match(photoVerificationSupersededFollowupMigration, /SET status = 'superseded'/);
  assert.match(photoVerificationSupersededFollowupMigration, /Superseded by newer pending photo verification during migration\./);
  assert.doesNotMatch(photoVerificationSupersededFollowupMigration, /DELETE FROM public\.photo_verifications pv/);
  assert.match(photoVerificationSupersededFollowupMigration, /CREATE OR REPLACE FUNCTION public\.admin_list_photo_verifications/);
  assert.match(photoVerificationSupersededFollowupMigration, /IF v_status NOT IN \('pending', 'approved', 'rejected', 'superseded'\) THEN/);
  assert.match(photoVerificationSupersededFollowupMigration, /WHERE migration_version = '20260507170000'/);
  assert.match(photoVerificationSupersededFollowupMigration, /'20260508100000'/);
  assert.match(photoVerificationSupersededFollowupMigration, /No rows are deleted/);
});

test("latest photo verification admin list read model exposes reviewed_at and sorts reviewed rows by review time", () => {
  const source = photoVerificationHardeningFnSection("admin_list_photo_verifications");

  assert.match(source, /SECURITY DEFINER/);
  assert.match(source, /SET search_path = public, pg_catalog/);
  assert.match(source, /auth\.uid\(\)/);
  assert.match(source, /public\.has_role\(v_admin_id, 'admin'::public\.app_role\)/);
  assert.match(source, /pv\.reviewed_at/);
  assert.match(source, /'reviewed_at', reviewed_at/);
  assert.match(source, /CASE WHEN v_status = 'pending' THEN pv\.created_at END ASC NULLS LAST/);
  assert.match(source, /CASE WHEN v_status <> 'pending' THEN pv\.reviewed_at END DESC NULLS LAST/);
  assert.match(source, /OR pv\.reviewed_at >= p_reviewed_since/);
  assert.match(photoVerificationHardeningMigration, /REVOKE ALL ON FUNCTION public\.admin_list_photo_verifications\(text, timestamptz, integer\) FROM PUBLIC, anon, authenticated/);
  assert.match(photoVerificationHardeningMigration, /GRANT EXECUTE ON FUNCTION public\.admin_list_photo_verifications\(text, timestamptz, integer\) TO authenticated/);
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
  assert.match(reports, /p_search: reportSearchQuery \|\| null/);
  assert.match(reports, /resolveReportSearchQuery/);
  assert.match(pushCampaigns, /callAdminRpc<PushCampaignsReadModelPayload>\("admin_get_push_campaigns_read_model"/);
  assert.match(pushCampaigns, /callAdminRpc\("admin_upsert_push_campaign_draft"/);
  assert.match(pushCampaigns, /callAdminRpc\("admin_delete_push_campaign_draft"/);
  assert.match(adminUserDetail, /callAdminRpc<UserDetailReadModelPayload>\("admin_get_user_detail_read_model"/);
  assert.match(adminUserDetail, /<AdminProfilePreview[\s\S]*profile=\{profile\}[\s\S]*vibes=\{vibes\}/);
  assert.match(adminUserDetail, /moderation=\{moderation\}/);
  assert.match(adminUserDetail, /history=\{premiumHistory\}/);
  assert.match(adminDeletions, /callAdminRpc<AccountDeletionListPayload>\("admin_list_account_deletions"/);
  assert.match(adminDeletions, /callAdminRpc\("admin_mark_account_deletion_completed"/);
  assert.match(matchMessages, /callAdminRpc<MatchThreadsPayload>\("admin_get_user_match_threads"/);
  assert.match(matchMessages, /callAdminRpc<MatchThreadMessagesPayload>\("admin_get_match_thread_messages"/);
  assert.match(support, /callAdminRpc<SupportInboxPayload>\("admin_get_support_inbox"/);
  assert.match(support, /callAdminRpc<SupportThreadPayload>\("admin_get_support_ticket_thread"/);

  assert.doesNotMatch(verification, /\.from\(['"]photo_verifications['"]\)/);
  assert.doesNotMatch(verification, /\.from\(['"]profiles['"]\)/);
  assert.doesNotMatch(reports, /\.from\(['"]user_reports['"]\)/);
  assert.doesNotMatch(reports, /\.from\(['"]profiles['"]\)/);
  assert.doesNotMatch(pushCampaigns, /\.from\(['"]push_campaigns['"]\)/);
  assert.doesNotMatch(pushCampaigns, /\.from\(['"]push_notification_events(?:_admin)?['"]\)/);
  assert.doesNotMatch(adminDeletions, /\.from\(['"]account_deletion_requests['"]\)/);
  assert.doesNotMatch(adminDeletions, /\.from\(['"]profiles['"]\)/);
  assert.doesNotMatch(adminUserDetail, /\.from\(['"]/);
  assert.doesNotMatch(adminProfilePreview, /\.from\(['"]/);
  assert.doesNotMatch(moderation, /\.from\(['"]/);
  assert.doesNotMatch(premium, /\.from\(['"]/);
  assert.doesNotMatch(matchMessages, /\.from\(['"]/);
  assert.doesNotMatch(support, /\.from\(['"]/);
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
