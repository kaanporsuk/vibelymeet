import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const adminConfirmDialog = read("src/components/admin/AdminConfirmDialog.tsx");
const adminNotifications = read("src/components/admin/AdminNotificationsPanel.tsx");
const adminGrantCredits = read("src/components/admin/AdminGrantCreditsModal.tsx");
const userModeration = read("src/components/admin/UserModerationActions.tsx");
const adminReports = read("src/components/admin/AdminReportsPanel.tsx");
const adminStats = read("src/components/admin/AdminStatsCards.tsx");
const adminAnalytics = read("src/components/admin/AdminAnalyticsCharts.tsx");
const adminQuickActions = read("src/components/admin/AdminQuickActionsCards.tsx");
const adminDailyDrop = read("src/components/admin/AdminDailyDropCard.tsx");
const adminRealtime = read("src/hooks/useAdminRealtime.ts");
const adminOverviewHook = read("src/hooks/useAdminOverviewDashboard.ts");
const usePushAnalytics = read("src/hooks/usePushAnalytics.ts");
const pushAnalyticsDashboard = read("src/components/admin/PushAnalyticsDashboard.tsx");
const adminUsers = read("src/components/admin/AdminUsersPanel.tsx");
const adminUserDetail = read("src/components/admin/AdminUserDetailDrawer.tsx");
const adminLiveEventMetrics = read("src/components/admin/AdminLiveEventMetrics.tsx");
const adminEvents = read("src/components/admin/AdminEventsPanel.tsx");
const adminEventControls = read("src/components/admin/AdminEventControls.tsx");
const adminPhotoVerification = read("src/components/admin/AdminPhotoVerificationPanel.tsx");
const supportInbox = read("src/components/admin/SupportInbox.tsx");
const adminPremium = read("src/components/admin/AdminPremiumModal.tsx");
const adminTierConfig = read("src/components/admin/AdminTierConfigPanel.tsx");
const adminMediaLifecycle = read("src/components/admin/AdminMediaLifecyclePanel.tsx");
const adminDeletions = read("src/components/admin/AdminDeletionsPanel.tsx");
const adminPushCampaigns = read("src/components/admin/AdminPushCampaignsPanel.tsx");
const adminEventForm = read("src/components/admin/AdminEventFormModal.tsx");

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing source section start: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing source section end: ${endMarker}`);
  return source.slice(start, end);
}

test("admin confirmation dialog uses AlertDialog primitives", () => {
  assert.match(adminConfirmDialog, /AlertDialog/);
  assert.match(adminConfirmDialog, /AlertDialogTitle/);
  assert.match(adminConfirmDialog, /AlertDialogDescription/);
  assert.match(adminConfirmDialog, /onConfirm/);
});

test("event form footer still submits through validation path", () => {
  const footer = section(adminEventForm, "{/* Footer */}", "</motion.div>");

  assert.match(adminEventForm, /<form id=\{formId\} onSubmit=\{handleSubmit\}/);
  assert.match(footer, /<Button type="submit" form=\{formId\}/);
  assert.doesNotMatch(footer, /saveEvent\.mutate\(\)/);
});

test("high-risk admin UI mutations route through confirmation copy", () => {
  assert.match(adminNotifications, /Delete this admin notification\?/);
  assert.match(adminNotifications, /Delete Selected/);
  assert.match(adminNotifications, /Mark all unread admin notifications as read\?/);
  assert.match(adminNotifications, /Delete every admin notification row\?/);

  assert.match(adminGrantCredits, /Grant credits to/);
  assert.match(adminGrantCredits, /admin_adjust_user_credits/);
  assert.match(adminGrantCredits, /balance update, credit_adjustments rows, and admin_activity_logs row commit together or fail together/);
  assert.match(userModeration, /Suspend .*?\?/);
  assert.match(userModeration, /Lift suspension/);
  assert.match(userModeration, /Send warning/);
  assert.match(userModeration, /admin_moderate_user/);
  assert.match(adminReports, /showActionConfirm/);
  assert.match(adminReports, /admin_resolve_report/);
  assert.match(adminReports, /same backend transaction/);

  assert.match(adminEventControls, /Set "\$?\{eventTitle\}" live\?/);
  assert.match(adminEventControls, /admin_go_live_event/);
  assert.match(adminEventControls, /events\.status = ended and ended_at/);
  assert.match(adminEventControls, /updates events\.duration_minutes/);
  assert.match(adminEventControls, /admin_send_event_reminder/);
  assert.match(adminEventControls, /reports whether a notification dispatcher queued user sends/);
  assert.match(adminEvents, /cancellation notifications may be recorded as not queued until a dispatcher is connected/);
  assert.doesNotMatch(adminEvents, /automatically send a push to each confirmed attendee/);
  assert.match(adminEvents, /Generate \$?\{pendingEventAction\.count\} more occurrences\?/);
  assert.match(adminEvents, /Archive recurring series/);
  assert.match(adminEvents, /Archive Selected/);

  assert.match(adminPhotoVerification, /Approve photo verification\?/);
  assert.match(adminPhotoVerification, /Reject photo verification\?/);
  assert.match(adminPhotoVerification, /records the reason/);
  assert.match(supportInbox, /Open payment exception case\?/);
  assert.match(supportInbox, /Save payment exception transition\?/);
  assert.match(supportInbox, /does not process a refund in-app/);
  assert.match(supportInbox, /error: updateErr/);
  assert.match(supportInbox, /if \(updateErr\) throw updateErr/);
  assert.match(adminPremium, /admin_set_premium_status/);
  assert.match(adminPremium, /Profile premium state, premium_history, and admin_activity_logs commit together or fail together/);

  assert.match(adminTierConfig, /requestSetOverride/);
  assert.match(adminTierConfig, /requestResetOverride/);
  assert.match(adminMediaLifecycle, /Retry all failed media delete jobs\?/);
  assert.match(adminMediaLifecycle, /Requeue all stale claimed jobs\?/);
  assert.match(adminMediaLifecycle, /Save chat media policy\?/);
  assert.match(adminDailyDrop, /Generate today's drops\?/);
  assert.match(adminDailyDrop, /can create production daily-drop pairs and notify users/);
  assert.match(adminDeletions, /Mark deletion request completed\?/);
  assert.match(adminPushCampaigns, /Delete push campaign\?/);

  for (const source of [
    adminNotifications,
    userModeration,
    adminTierConfig,
    adminMediaLifecycle,
    adminDeletions,
  ]) {
    assert.doesNotMatch(source, /onConfirm:\s*\(\) => [^\n]+\.mutate\(/);
  }
});

test("report actions use backend transaction instead of client side-effect orchestration", () => {
  assert.match(adminReports, /callAdminRpc\("admin_resolve_report(_with_policy)?"/);
  assert.match(adminReports, /p_action: rpcAction/);
  assert.match(adminReports, /p_idempotency_key: createAdminIdempotencyKey\("admin_resolve_report"\)/);
  assert.match(adminReports, /The required moderation side effect and report closure run in one backend transaction/);
  assert.doesNotMatch(adminReports, /\.from\("user_warnings"\)\.insert/);
  assert.doesNotMatch(adminReports, /\.from\("user_suspensions"\)\.insert/);

  const actionHandler = section(adminReports, "const handleTakeAction", "const requestReportActionConfirmation");
  assert.match(actionHandler, /await resolveReport\.mutateAsync/);
  assert.doesNotMatch(actionHandler, /await updateReport\.mutateAsync/);
  assert.doesNotMatch(actionHandler, /await suspendUser\.mutateAsync/);
  assert.doesNotMatch(actionHandler, /await issueWarning\.mutateAsync/);
});

test("overview metrics and event analytics labels match query semantics", () => {
  assert.match(adminOverviewHook, /admin_get_overview_dashboard/);
  assert.match(adminStats, /useAdminOverviewDashboard/);
  assert.match(adminStats, /Unable to load Overview metrics/);
  assert.match(adminStats, /not showing fallback zeroes/);
  assert.match(adminStats, /Last updated/);
  assert.match(adminStats, /formatAdminCount/);
  assert.doesNotMatch(adminStats, /Number\(metrics\?\./);
  assert.doesNotMatch(adminStats, /\|\| '0'/);
  assert.doesNotMatch(adminStats, /Active Events/);
  assert.match(adminStats, /Total Events/);
  assert.match(adminStats, /All event rows, including draft\/cancelled\/archived\/ended/);
  assert.doesNotMatch(adminStats, /Match Rate/);
  assert.match(adminStats, /Matches\/User/);
  assert.match(adminStats, /matches_per_user/);

  assert.match(adminLiveEventMetrics, /Participant Reports/);
  assert.match(adminLiveEventMetrics, /Participant reports near this event window; not direct event-report provenance/);
  assert.match(adminLiveEventMetrics, /admin_get_event_metrics/);
  assert.doesNotMatch(adminLiveEventMetrics, /\.from\("user_reports"\)/);
});

test("quick actions show only actionable upcoming events", () => {
  assert.match(adminQuickActions, /useAdminOverviewDashboard/);
  assert.match(adminQuickActions, /Unable to load Quick Actions/);
  assert.match(adminQuickActions, /Counts are hidden until the backend overview read succeeds/);
  assert.match(adminQuickActions, /Actionable Upcoming Events/);
  assert.match(adminQuickActions, /Registered seats/);
  assert.doesNotMatch(adminQuickActions, /resolveEventLifecycle/);
  assert.doesNotMatch(adminQuickActions, /\.from\(['"]events['"]\)/);
  assert.doesNotMatch(adminQuickActions, /admin-upcoming-events/);
});

test("overview charts and Daily Drop read from the backend overview surface", () => {
  assert.match(adminAnalytics, /useAdminOverviewDashboard/);
  assert.match(adminAnalytics, /Unable to load Overview charts/);
  assert.match(adminAnalytics, /Latest Event Rows \(Capacity Fill\)/);
  assert.match(adminAnalytics, /including archived\/ended rows when present/);
  assert.match(adminAnalytics, /look like test\/smoke data/);
  assert.doesNotMatch(adminAnalytics, /\.from\(['"]profiles['"]\)/);
  assert.doesNotMatch(adminAnalytics, /\.from\(['"]events['"]\)/);
  assert.doesNotMatch(adminAnalytics, /\.from\(['"]matches['"]\)/);
  assert.doesNotMatch(adminAnalytics, /admin-user-growth/);
  assert.doesNotMatch(adminAnalytics, /admin-event-attendance/);

  assert.match(adminDailyDrop, /useAdminOverviewDashboard/);
  assert.match(adminDailyDrop, /Unable to load Daily Drop status/);
  assert.match(adminDailyDrop, /Last generated \(UTC\)/);
  assert.match(adminDailyDrop, /Daily Drop status unavailable/);
  assert.doesNotMatch(adminDailyDrop, /\.from\(['"]daily_drops['"]\)/);
  assert.doesNotMatch(adminDailyDrop, /admin-daily-drops-today/);
});

test("overview realtime invalidates the active backend query key", () => {
  assert.match(adminRealtime, /ADMIN_OVERVIEW_DASHBOARD_QUERY_KEY/);
  assert.match(adminRealtime, /admin-daily-drops-realtime/);
  assert.match(adminRealtime, /invalidateOverview/);
  assert.doesNotMatch(adminRealtime, /admin-users-count/);
  assert.doesNotMatch(adminRealtime, /admin-matches-count/);
  assert.doesNotMatch(adminRealtime, /admin-event-attendance/);
});

test("push analytics uses the backend admin telemetry RPC and honest states", () => {
  assert.match(usePushAnalytics, /callAdminRpc\("admin_get_push_delivery_metrics"/);
  assert.match(usePushAnalytics, /telemetrySource: "admin_get_push_delivery_metrics"/);
  assert.doesNotMatch(usePushAnalytics, /\.from\("push_notification_events_admin"\)/);
  assert.doesNotMatch(usePushAnalytics, /\.from\("push_notification_events"\)/);

  assert.match(pushAnalyticsDashboard, /Unable to read push analytics from the backend admin metrics RPC/);
  assert.match(pushAnalyticsDashboard, /No telemetry available in this range; this does not prove no notifications were sent/);
  assert.match(pushAnalyticsDashboard, /provider sends may exist outside these rows/);
});

test("users panel labels registration-derived counts honestly", () => {
  assert.match(adminUsers, /admin_search_users/);
  assert.match(adminUsers, /USERS_PAGE_SIZE = 50/);
  assert.match(adminUsers, /p_offset: pageIndex \* USERS_PAGE_SIZE/);
  assert.match(adminUsers, /Previous/);
  assert.match(adminUsers, /Next/);
  assert.match(adminUsers, /Event registration counts are derived server-side from registration rows; they are not confirmed attendance/);
  assert.match(adminUsers, /Event registrations/);
  assert.doesNotMatch(adminUsers, /events_attended/);
  assert.match(adminUsers, /Could not load users or derived event registration counts/);
  assert.match(adminUsers, /Vibes unavailable/);
  assert.doesNotMatch(adminUsers, /\.from\(['"]profiles['"]\)/);
  assert.doesNotMatch(adminUsers, /\.from\(['"]event_registrations['"]\)/);
  assert.doesNotMatch(adminUsers, /\.from\(['"]profile_vibes['"]\)/);

  assert.match(adminUserDetail, /Event registrations/);
  assert.match(adminUserDetail, /Not confirmed attendance/);
  assert.doesNotMatch(adminUserDetail, /events_attended/);
});

test("notifications copy is scoped to the latest 100 and broad actions say so", () => {
  assert.match(adminNotifications, /admin_get_notification_counts/);
  assert.match(adminNotifications, /latest 100 loaded/);
  assert.match(adminNotifications, /including older rows that are not loaded in the latest 100/);
  assert.match(adminNotifications, /one admin_notifications row/);
  assert.match(adminNotifications, /selected loaded admin notification rows/);
  assert.match(adminNotifications, /This is a fetch failure, not proof that no notifications exist/);
});

test("password reset is visibly unavailable instead of toast-only fake action", () => {
  assert.doesNotMatch(userModeration, /const resetPassword = useMutation/);
  assert.doesNotMatch(userModeration, /resetPassword\.mutate/);
  assert.match(userModeration, /Unavailable — requires backend Admin API support/);
});

test("premium operations use backend transaction RPC", () => {
  assert.match(adminPremium, /callAdminRpc\("admin_set_premium_status"/);
  assert.match(adminPremium, /p_idempotency_key: createAdminIdempotencyKey\("admin_set_premium_status"\)/);
  assert.match(adminPremium, /profile state, premium_history, and admin audit logging are transactional/);
  assert.doesNotMatch(adminPremium, /\.from\("profiles"\)\.update/);
  assert.doesNotMatch(adminPremium, /\.from\("premium_history"\)\.insert/);
  assert.match(adminPremium, /AdminConfirmDialog/);
});

test("push campaigns are draft-only and do not enqueue browser notification events", () => {
  assert.doesNotMatch(adminPushCampaigns, /\.from\(['"]push_notification_events['"]\)[\s\S]*\.insert/);
  assert.doesNotMatch(adminPushCampaigns, /sendNotificationsToUsers/);
  assert.match(adminPushCampaigns, /status:\s*'draft'/);
  assert.match(adminPushCampaigns, /Delivery is disabled until a backend dispatcher exists/);
  assert.match(adminPushCampaigns, /Save Draft/);
  assert.match(adminPushCampaigns, /Update Campaign/);
  assert.doesNotMatch(adminPushCampaigns, /Update Draft/);

  assert.doesNotMatch(adminPushCampaigns, />Send Now</);
  assert.doesNotMatch(adminPushCampaigns, />Schedule</);
  assert.doesNotMatch(adminPushCampaigns, /Campaign paused/);
  assert.doesNotMatch(adminPushCampaigns, /35\.8%/);
});

test("push campaign delete warning matches cascaded notification analytics behavior", () => {
  assert.match(adminPushCampaigns, /database cascade can also delete that campaign's notification analytics history/);
  assert.match(adminPushCampaigns, /Delivered pushes cannot be recalled/);
  assert.doesNotMatch(adminPushCampaigns, /It does not cancel or undo any notification events already created/);
});

test("push campaign targeting UI exposes only supported filters and flags legacy unsupported filters", () => {
  assert.match(adminPushCampaigns, /normalizeSupportedSegment/);
  assert.match(adminPushCampaigns, /Unsupported targeting stored/);
  assert.match(adminPushCampaigns, /This preview uses gender, verified status, and age only/);

  assert.doesNotMatch(adminPushCampaigns, /User Activity/);
  assert.doesNotMatch(adminPushCampaigns, /Daily Drop Response/);
  assert.doesNotMatch(adminPushCampaigns, /Inactive for at least/);
  assert.doesNotMatch(adminPushCampaigns, /Has Matches/);
  assert.doesNotMatch(adminPushCampaigns, /Vibes & Interests/);
});

test("account deletion action copy is honest about completion-only behavior", () => {
  assert.doesNotMatch(adminDeletions, /Process Now/);
  assert.doesNotMatch(adminDeletions, /process deletion/i);
  assert.match(adminDeletions, /Mark Completed/);
  assert.match(adminDeletions, /This does not delete the Supabase auth user or profile/);
});
