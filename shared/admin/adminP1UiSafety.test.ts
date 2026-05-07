import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { resolveReportSearchQuery } from "../../src/components/admin/adminReportSearch";
import { resolveSupabaseFunctionErrorMessage } from "../supabaseFunctionInvokeErrors";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const adminConfirmDialog = read("src/components/admin/AdminConfirmDialog.tsx");
const adminNotifications = read("src/components/admin/AdminNotificationsPanel.tsx");
const adminGrantCredits = read("src/components/admin/AdminGrantCreditsModal.tsx");
const userModeration = read("src/components/admin/UserModerationActions.tsx");
const adminReports = read("src/components/admin/AdminReportsPanel.tsx");
const adminReportSearch = read("src/components/admin/adminReportSearch.ts");
const adminStats = read("src/components/admin/AdminStatsCards.tsx");
const adminAnalytics = read("src/components/admin/AdminAnalyticsCharts.tsx");
const adminQuickActions = read("src/components/admin/AdminQuickActionsCards.tsx");
const adminDailyDrop = read("src/components/admin/AdminDailyDropCard.tsx");
const adminRealtime = read("src/hooks/useAdminRealtime.ts");
const adminOverviewHook = read("src/hooks/useAdminOverviewDashboard.ts");
const adminEngagement = read("src/components/admin/AdminEngagementAnalytics.tsx");
const useAdminEngagementAnalytics = read("src/hooks/useAdminEngagementAnalytics.ts");
const usePushAnalytics = read("src/hooks/usePushAnalytics.ts");
const usePushNotificationEvents = read("src/hooks/usePushNotificationEvents.ts");
const pushAnalyticsDashboard = read("src/components/admin/PushAnalyticsDashboard.tsx");
const liveNotificationMonitor = read("src/components/admin/LiveNotificationMonitor.tsx");
const adminUsers = read("src/components/admin/AdminUsersPanel.tsx");
const adminUserDetail = read("src/components/admin/AdminUserDetailDrawer.tsx");
const adminProfilePreview = read("src/components/admin/AdminProfilePreview.tsx");
const adminLiveEventMetrics = read("src/components/admin/AdminLiveEventMetrics.tsx");
const adminEvents = read("src/components/admin/AdminEventsPanel.tsx");
const adminEventControls = read("src/components/admin/AdminEventControls.tsx");
const adminPhotoVerification = read("src/components/admin/AdminPhotoVerificationPanel.tsx");
const supportInbox = read("src/components/admin/SupportInbox.tsx");
const adminFeedback = read("src/components/admin/AdminFeedbackPanel.tsx");
const adminPremium = read("src/components/admin/AdminPremiumModal.tsx");
const adminTierConfig = read("src/components/admin/AdminTierConfigPanel.tsx");
const adminMediaLifecycle = read("src/components/admin/AdminMediaLifecyclePanel.tsx");
const adminDeletions = read("src/components/admin/AdminDeletionsPanel.tsx");
const adminPushCampaigns = read("src/components/admin/AdminPushCampaignsPanel.tsx");
const adminMatchMessages = read("src/components/admin/AdminMatchMessagesDrawer.tsx");
const adminEventForm = read("src/components/admin/AdminEventFormModal.tsx");
const adminOverviewDashboardMigration = read("supabase/migrations/20260506135000_admin_overview_dashboard_read_model.sql");
const proofSelfieUrl = read("src/lib/proofSelfieUrl.ts");
const adminProofSelfieSign = read("supabase/functions/admin-proof-selfie-sign/index.ts");
const simplePhotoVerification = read("src/components/verification/SimplePhotoVerification.tsx");

function readTree(path: string): string[] {
  const dir = join(root, path);
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) return readTree(child);
    return /\.(ts|tsx)$/.test(entry.name) ? [read(child)] : [];
  });
}

const adminComponentAndPageSources = [
  ...readTree("src/components/admin"),
  ...readTree("src/pages/admin"),
].join("\n");

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
  assert.match(supportInbox, /Refund-related exception cases require notes before submit/);
  assert.match(supportInbox, /Save context/);
  assert.match(supportInbox, /admin_update_support_ticket/);
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

  const actionSuccess = section(adminReports, "onSuccess: () => {", "onError");
  assert.match(actionSuccess, /\["admin-reports"\]/);
  assert.match(actionSuccess, /\["admin-reports-summary"\]/);
  assert.match(actionSuccess, /ADMIN_OVERVIEW_DASHBOARD_QUERY_KEY/);
});

test("reports list distinguishes fetch failures from true empty results", () => {
  assert.match(adminReports, /isError/);
  assert.match(adminReports, /reportsUnavailable = isError/);
  assert.doesNotMatch(adminReports, /reportsUnavailable = isError &&/);
  assert.match(adminReports, /Reports unavailable/);
  assert.match(adminReports, /This is a fetch failure, not proof that no reports exist/);
  assert.match(adminReports, /No reports found/);
});

test("reports search maps visible reason labels while preserving client-side label filtering", () => {
  assert.match(adminReports, /resolveReportSearchQuery/);
  assert.match(adminReports, /normalizeReportSearchText/);
  assert.match(adminReportSearch, /word\.length >= 4/);
  assert.doesNotMatch(adminReportSearch, /"profile", "content"/);
  assert.match(adminReports, /p_search: reportSearchQuery \|\| null/);
  assert.match(adminReports, /reasonLabels\[report\.reason\]/);
  assert.match(adminReports, /normalizeReportSearchText\(reasonLabel\)\.includes\(normalizedSearch\)/);
});

test("reports reason-label search normalization covers visible label terms", () => {
  assert.equal(resolveReportSearchQuery("Fake profile / catfish"), "fake");
  assert.equal(resolveReportSearchQuery("fake catfish"), "fake");
  assert.equal(resolveReportSearchQuery("catfish"), "fake");
  assert.equal(resolveReportSearchQuery("profile"), "fake");
  assert.equal(resolveReportSearchQuery("Harassment or bullying"), "harassment");
  assert.equal(resolveReportSearchQuery("harassment bullying"), "harassment");
  assert.equal(resolveReportSearchQuery("bullying"), "harassment");
  assert.equal(resolveReportSearchQuery("sexual content"), "inappropriate");
  assert.equal(resolveReportSearchQuery("scam"), "spam");
  assert.equal(resolveReportSearchQuery("content"), "inappropriate");
  assert.equal(resolveReportSearchQuery("concern"), "concern");
  assert.equal(resolveReportSearchQuery("ali"), "ali");
});

test("reports realtime refreshes list, summary, and overview together", () => {
  const invalidateReports = section(adminRealtime, "const invalidateReports = useCallback", "const invalidatePhotoVerifications");
  assert.match(invalidateReports, /\["admin-reports"\]/);
  assert.match(invalidateReports, /\["admin-reports-summary"\]/);
  assert.match(invalidateReports, /invalidateOverview\(\)/);
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
  assert.match(adminLiveEventMetrics, /admin_list_event_analytics_options/);
  assert.match(adminLiveEventMetrics, /admin_get_event_live_analytics/);
  assert.match(adminLiveEventMetrics, /admin_get_event_post_analytics/);
  assert.match(adminLiveEventMetrics, /admin_get_event_lifecycle_feed/);
  assert.match(adminLiveEventMetrics, /computed: \{selectedEventPhase\.label\}/);
  assert.match(adminLiveEventMetrics, /Queue drain health/);
  assert.match(adminLiveEventMetrics, /deduped first-frame samples/);
  assert.match(adminLiveEventMetrics, /Unable to load Event Analytics metrics for the selected event/);
  assert.match(adminLiveEventMetrics, /Unable to load the Event Analytics event selector/);
  assert.match(adminLiveEventMetrics, /Backend lifecycle read model unavailable/);
  assert.match(adminLiveEventMetrics, /payment_exceptions/);
  assert.match(adminLiveEventMetrics, /Post-event feedback metrics are unavailable/);
  assert.match(adminLiveEventMetrics, /session: \{session\.session_id \? "linked" : "-"\}/);
  assert.match(adminLiveEventMetrics, /profile_ref: \{item\.profile_ref \? "present" : "-"\}/);
  assert.doesNotMatch(adminLiveEventMetrics, /exception_id: \{item\.id\}/);
  assert.doesNotMatch(adminLiveEventMetrics, /checkout_session_id: \{item\.checkout_session_id/);
  assert.doesNotMatch(adminLiveEventMetrics, /admin_get_event_metrics/);
  assert.doesNotMatch(adminLiveEventMetrics, /supabase\s*\.\s*from\(/);
  assert.doesNotMatch(adminLiveEventMetrics, /\.from\("events"\)/);
  assert.doesNotMatch(adminLiveEventMetrics, /\.from\("event_registrations"\)/);
  assert.doesNotMatch(adminLiveEventMetrics, /\.from\("video_sessions"\)/);
  assert.doesNotMatch(adminLiveEventMetrics, /\.from\("date_feedback"\)/);
  assert.doesNotMatch(adminLiveEventMetrics, /\.from\("event_payment_exceptions"\)/);
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
  assert.doesNotMatch(adminQuickActions, /\.not\(['"]status['"]/);
  assert.doesNotMatch(adminQuickActions, /admin-upcoming-events/);
  assert.match(adminOverviewDashboardMigration, /lower\(COALESCE\(status, 'upcoming'\)\) NOT IN \('draft', 'cancelled', 'completed', 'ended'\)/);
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
  assert.match(adminRealtime, /ADMIN_ENGAGEMENT_ANALYTICS_QUERY_KEY/);
  assert.match(adminRealtime, /admin-daily-drops-realtime/);
  assert.match(adminRealtime, /admin-engagement-push-telemetry-realtime/);
  assert.match(adminRealtime, /admin-engagement-notification-log-realtime/);
  assert.match(adminRealtime, /invalidateOverview/);
  assert.match(adminRealtime, /invalidateEngagement/);
  assert.doesNotMatch(adminRealtime, /admin-users-count/);
  assert.doesNotMatch(adminRealtime, /admin-matches-count/);
  assert.doesNotMatch(adminRealtime, /admin-event-attendance/);
});

test("photo verification realtime invalidates the admin list and stats query keys", () => {
  assert.match(adminRealtime, /admin-photo-verifications-realtime/);
  assert.match(adminRealtime, /table: "photo_verifications"/);
  assert.match(adminRealtime, /\["admin-photo-verifications"\]/);
  assert.match(adminRealtime, /\["admin-verification-stats"\]/);
});

test("Support Inbox has honest empty/error states and governed data access", () => {
  assert.match(supportInbox, /Unable to load support inbox/);
  assert.match(supportInbox, /No support tickets yet/);
  assert.match(supportInbox, /No tickets match these filters/);
  assert.match(supportInbox, /callAdminRpc<SupportInboxPayload>\("admin_get_support_inbox"/);
  assert.match(supportInbox, /callAdminRpc<SupportThreadPayload>\("admin_get_support_ticket_thread"/);
  assert.match(supportInbox, /callAdminRpc\("admin_update_support_ticket"/);
  assert.match(supportInbox, /supabase\.functions\.invoke<SendSupportReplyResponse>\("send-support-reply"/);
  assert.match(supportInbox, /resolveSupabaseFunctionErrorMessage/);
  assert.doesNotMatch(supportInbox, /\.from\(["']support_tickets["']\)/);
  assert.doesNotMatch(supportInbox, /\.from\(["']support_ticket_replies["']\)/);
  assert.doesNotMatch(supportInbox, /\.from\(["']event_payment_exceptions["']\)/);
  assert.doesNotMatch(supportInbox, /\.from\(["']profiles["']\)/);

  assert.match(adminRealtime, /admin-support-tickets-realtime/);
  assert.match(adminRealtime, /admin-support-replies-realtime/);
  assert.match(adminRealtime, /admin-support-events-realtime/);
  assert.match(adminRealtime, /\["admin-support-tickets"\]/);
  assert.match(adminRealtime, /\["admin-support-thread"\]/);
});

test("Support Inbox function errors preserve human server messages", async () => {
  const response = new Response(
    JSON.stringify({
      error: "INVALID_TRANSITION",
      message: "Reopen the support ticket before sending another reply.",
    }),
    { status: 409 },
  );

  const message = await resolveSupabaseFunctionErrorMessage(
    {
      name: "FunctionsHttpError",
      message: "Edge Function returned a non-2xx status code",
      context: response,
    },
    null,
    "Failed to send reply",
  );

  assert.equal(message, "Reopen the support ticket before sending another reply. (HTTP 409)");
});

test("push analytics uses the backend admin telemetry RPC and honest states", () => {
  assert.match(usePushAnalytics, /callAdminRpc<PushDeliveryMetricsPayload>\("admin_get_push_delivery_metrics"/);
  assert.match(usePushAnalytics, /telemetrySource: "admin_get_push_delivery_metrics"/);
  assert.match(usePushAnalytics, /windowLabel/);
  assert.match(usePushAnalytics, /pushTelemetry/);
  assert.match(usePushAnalytics, /appNotificationLog/);
  assert.match(usePushAnalytics, /function toCount\(value: unknown\)/);
  assert.match(usePushAnalytics, /Number\.isFinite/);
  assert.match(usePushAnalytics, /const end = new Date\(\)/);
  assert.match(usePushAnalytics, /const start = subDays\(end, days\)/);
  assert.doesNotMatch(usePushAnalytics, /\.from\("push_notification_events_admin"\)/);
  assert.doesNotMatch(usePushAnalytics, /\.from\("push_notification_events"\)/);

  assert.match(pushAnalyticsDashboard, /Unable to read push analytics from the backend admin metrics RPC/);
  assert.match(pushAnalyticsDashboard, /No telemetry available in this range; this does not prove no notifications were sent/);
  assert.match(pushAnalyticsDashboard, /provider sends may exist outside these rows/);
  assert.match(pushAnalyticsDashboard, /Selected-Window Summary/);
  assert.match(pushAnalyticsDashboard, /Provider\/Admin Telemetry/);
  assert.match(pushAnalyticsDashboard, /Transactional App Log/);
  assert.match(pushAnalyticsDashboard, /This RPC does not return per-day, device, campaign, or best-time breakdowns yet/);
  assert.doesNotMatch(pushAnalyticsDashboard, /LineChart|AreaChart|PieChart|BarChart/);
  assert.doesNotMatch(pushAnalyticsDashboard, /Delivery & Opens Trend/);
  assert.doesNotMatch(pushAnalyticsDashboard, /Device Distribution/);
  assert.doesNotMatch(pushAnalyticsDashboard, /Best Performing Send Times/);
});

test("engagement analytics uses one backend read model and honest states", () => {
  assert.match(adminEngagement, /useAdminEngagementAnalytics\(30\)/);
  assert.match(useAdminEngagementAnalytics, /callAdminRpc<AdminEngagementAnalyticsPayload>\("admin_get_engagement_analytics"/);
  assert.match(useAdminEngagementAnalytics, /queryKey: \[\.\.\.ADMIN_ENGAGEMENT_ANALYTICS_QUERY_KEY, days\]/);
  assert.match(useAdminEngagementAnalytics, /queryFn: \(\) => \{\s*const window = getUtcWindow\(days\)/);
  assert.match(useAdminEngagementAnalytics, /refetchInterval: 30_000/);
  assert.match(adminEngagement, /Push Delivery & Opens \(30 Days UTC\)/);
  assert.match(adminEngagement, /Notification Performance by Category/);
  assert.match(adminEngagement, /formatRate\(provider\.delivery_rate, provider\.sent_rows > 0\)/);
  assert.match(adminEngagement, /formatRate\(provider\.open_rate, provider\.delivered_rows > 0\)/);
  assert.match(adminEngagement, /formatRate\(dailyDrop\.engagement_rate, hasDailyDropRows\)/);
  assert.match(adminEngagement, /No provider telemetry in this UTC window/);
  assert.match(adminEngagement, /No Daily Drop rows in this UTC window/);
  assert.match(adminEngagement, /Metrics are hidden until the backend engagement read model succeeds/);
  assert.doesNotMatch(adminEngagement, /supabase\s*\.\s*from\(/);
  assert.doesNotMatch(adminEngagement, /\.from\(['"](admin_notifications|daily_drops|messages|matches|event_registrations|push_notification_events(?:_admin)?|notification_log)['"]\)/);
  assert.doesNotMatch(useAdminEngagementAnalytics, /supabase\s*\.\s*from\(/);
  assert.doesNotMatch(useAdminEngagementAnalytics, /useMemo/);
  assert.doesNotMatch(adminEngagement, /Notification Read Rate/);
  assert.doesNotMatch(adminEngagement, /status === ['"]pending['"]/);
  assert.doesNotMatch(adminEngagement, /status === ['"]liked['"]/);
  assert.doesNotMatch(adminEngagement, /status === ['"]expired['"]/);
});

test("live push monitor is labeled as admin telemetry rather than full delivery proof", () => {
  assert.match(liveNotificationMonitor, /Admin Telemetry Monitor/);
  assert.match(liveNotificationMonitor, /Latest admin telemetry events/);
  assert.match(liveNotificationMonitor, /This is not proof of every transactional push send/);
  assert.match(liveNotificationMonitor, /Auto Refresh/);
  assert.match(liveNotificationMonitor, /No telemetry rows yet/);
  assert.match(liveNotificationMonitor, /Provider\/Webhook Telemetry Endpoints/);
  assert.match(liveNotificationMonitor, /const hasProviderIdentifier = \(value: string \| null\) => Boolean\(value && value !== "\[REDACTED\]"\)/);
  assert.match(liveNotificationMonitor, /telemetry rows/);
  assert.match(usePushNotificationEvents, /admin_get_push_campaigns_read_model/);
  assert.match(usePushNotificationEvents, /userIds\.length > 0/);
  assert.match(usePushNotificationEvents, /campaignIds\.length > 0/);
  assert.match(usePushNotificationEvents, /Poll the redacted admin telemetry view/);
  assert.match(usePushNotificationEvents, /isNotificationPlatform/);
  assert.match(usePushNotificationEvents, /calculateNotificationStats/);
  assert.match(usePushNotificationEvents, /window\.setInterval/);
  assert.match(usePushNotificationEvents, /window\.clearInterval/);
  assert.match(usePushNotificationEvents, /void fetchEvents\(\)/);
  assert.doesNotMatch(usePushNotificationEvents, /useQueryClient/);
  assert.doesNotMatch(usePushNotificationEvents, /\.from\("push_campaigns"\)/);
  assert.doesNotMatch(usePushNotificationEvents, /\.channel\(/);
  assert.doesNotMatch(usePushNotificationEvents, /postgres_changes/);
  assert.doesNotMatch(usePushNotificationEvents, /table: "push_notification_events"/);
  assert.doesNotMatch(usePushNotificationEvents, /payload\.new/);
  assert.doesNotMatch(usePushNotificationEvents, /Push notification event update/);
});

test("users panel labels registration-derived counts honestly", () => {
  assert.match(adminUsers, /admin_search_users/);
  assert.match(adminUsers, /USERS_PAGE_SIZE = 50/);
  assert.match(adminUsers, /p_offset: pageIndex \* USERS_PAGE_SIZE/);
  assert.match(adminUsers, /Previous/);
  assert.match(adminUsers, /Next/);
  assert.match(adminUsers, /Event registration counts are derived server-side from registration rows; they are not confirmed attendance/);
  assert.match(adminUsers, /Event registrations/);
  assert.match(adminUsers, /LifecycleFilter/);
  assert.match(adminUsers, /All Lifecycle/);
  assert.match(adminUsers, /Bootstrap fresh/);
  assert.match(adminUsers, /filters\.lifecycle_status = lifecycleFilter/);
  assert.match(adminUsers, /age_is_placeholder/);
  assert.match(adminUsers, /Pending/);
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
  assert.match(adminNotifications, /admin-dashboard-badge-counts/);
  assert.match(adminNotifications, /Promise\.allSettled/);
});

test("tier config writes are confirmed, governed, and backend-authoritative", () => {
  assert.match(adminTierConfig, /AdminConfirmDialog/);
  assert.match(adminTierConfig, /set_tier_config_override/);
  assert.match(adminTierConfig, /reset_tier_config_override/);
  assert.match(adminTierConfig, /get_tier_capabilities/);
  assert.match(adminTierConfig, /sanitizeAdminRpcErrorMessage/);
  assert.match(adminTierConfig, /Backend reads use <code className="text-xs">get_user_tier_capabilities<\/code>/);
  assert.match(adminTierConfig, /parseNonNegativeInteger/);
  assert.match(adminTierConfig, /Unable to load Tier Config/);
  assert.match(adminTierConfig, /auditIsError/);
  assert.doesNotMatch(adminTierConfig, /\.from\(["']tier_config_overrides["']\)[\s\S]{0,300}\.(insert|update|upsert|delete)\(/);
  assert.doesNotMatch(adminTierConfig, /\.from\(["']tier_config_audit["']\)[\s\S]{0,300}\.(insert|update|upsert|delete)\(/);
});

test("photo verification selfie signing is row-resilient and redacts unexpected failures", () => {
  assert.match(adminPhotoVerification, /Promise\.allSettled/);
  assert.match(adminPhotoVerification, /selfie resolution failed/);
  assert.match(adminPhotoVerification, /sanitizeAdminRpcErrorMessage/);
  assert.match(adminPhotoVerification, /redactUrlForLog/);
  assert.match(adminPhotoVerification, /attemptedUrlRedacted/);
});

test("photo verification selfie signer path resolver stays aligned with the shared proof-selfie helper", () => {
  const shapes = [
    "raw_object_key",
    "bucket_prefixed_key",
    "supabase_storage_proof_selfies",
    "supabase_storage_public_missing_bucket",
    "supabase_storage_other_bucket",
    "absolute_non_supabase",
    "unusable",
  ];

  for (const shape of shapes) {
    assert.match(proofSelfieUrl, new RegExp(shape));
    assert.match(adminProofSelfieSign, new RegExp(shape));
  }

  assert.match(proofSelfieUrl, /resolveProofSelfieObjectPathForSigning/);
  assert.match(adminProofSelfieSign, /resolveProofSelfieObjectPathForSigning/);
  assert.match(adminProofSelfieSign, /createSignedUrl\(objectPath, 3600\)/);
  assert.match(adminProofSelfieSign, /proof_selfie_url/);
  assert.match(adminPhotoVerification, /admin-proof-selfie-sign/);
  assert.doesNotMatch(adminPhotoVerification, /resolvePhotoUrl\(v\.selfie_url/);
});

test("photo verification submission preflights pending rows and profile photo before selfie upload", () => {
  assert.match(simplePhotoVerification, /loadSubmissionPreflight/);
  assert.match(simplePhotoVerification, /\.from\("photo_verifications"\)[\s\S]*\.eq\("status", "pending"\)/);
  assert.match(simplePhotoVerification, /Your verification is already under review/);
  assert.match(simplePhotoVerification, /Please add a profile photo before starting photo verification/);
  assert.match(simplePhotoVerification, /const profilePhoto = await loadSubmissionPreflight\(\);[\s\S]*const blob = await/);
  assert.match(simplePhotoVerification, /profile_photo_url: profilePhoto/);
  assert.match(simplePhotoVerification, /isPostgrestCode\(insertError, "23505"\)/);
  assert.match(simplePhotoVerification, /\.from\("proof-selfies"\)\.remove\(\[fileName\]\)/);
  assert.match(simplePhotoVerification, /markPending: true/);
});

test("admin badge mutations invalidate the centralized dashboard badge count", () => {
  assert.doesNotMatch(adminNotifications, /admin-unread-notifications/);
  assert.doesNotMatch(adminFeedback, /admin-new-feedback-count/);
  assert.doesNotMatch(supportInbox, /admin-support-open-count/);
  assert.match(adminNotifications, /admin-dashboard-badge-counts/);
  assert.match(adminFeedback, /admin-dashboard-badge-counts/);
  assert.match(supportInbox, /admin-dashboard-badge-counts/);
});

test("admin component and dashboard sources avoid browser-side HEAD count reads", () => {
  assert.doesNotMatch(adminComponentAndPageSources, /head:\s*true/);
});

test("named admin residual panels use backend read-model RPCs instead of browser table reads", () => {
  assert.match(adminPhotoVerification, /admin_list_photo_verifications/);
  assert.match(adminReports, /admin_get_reports_read_model/);
  assert.match(adminPushCampaigns, /admin_get_push_campaigns_read_model/);
  assert.match(adminPushCampaigns, /admin_upsert_push_campaign_draft/);
  assert.match(adminPushCampaigns, /admin_delete_push_campaign_draft/);
  assert.match(adminUserDetail, /admin_get_user_detail_read_model/);
  assert.match(adminUserDetail, /profile=\{profile\}/);
  assert.match(adminUserDetail, /moderation=\{moderation\}/);
  assert.match(adminUserDetail, /history=\{premiumHistory\}/);
  assert.match(adminDeletions, /admin_list_account_deletions/);
  assert.match(adminDeletions, /admin_mark_account_deletion_completed/);
  assert.match(adminMatchMessages, /admin_get_user_match_threads/);
  assert.match(adminMatchMessages, /admin_get_match_thread_messages/);

  assert.doesNotMatch(adminPhotoVerification, /\.from\(['"]photo_verifications['"]\)/);
  assert.doesNotMatch(adminPhotoVerification, /\.from\(['"]profiles['"]\)/);
  assert.doesNotMatch(adminReports, /\.from\(['"]user_reports['"]\)/);
  assert.doesNotMatch(adminReports, /\.from\(['"]profiles['"]\)/);
  assert.doesNotMatch(adminPushCampaigns, /\.from\(['"]push_campaigns['"]\)/);
  assert.doesNotMatch(adminPushCampaigns, /\.from\(['"]push_notification_events(?:_admin)?['"]\)/);
  assert.doesNotMatch(adminPushCampaigns, /\.insert\(/);
  assert.doesNotMatch(adminPushCampaigns, /\.update\(/);
  assert.doesNotMatch(adminPushCampaigns, /\.delete\(/);
  assert.doesNotMatch(adminDeletions, /\.from\(['"]account_deletion_requests['"]\)/);
  assert.doesNotMatch(adminDeletions, /\.from\(['"]profiles['"]\)/);
  assert.doesNotMatch(adminUserDetail, /\.from\(['"]/);
  assert.doesNotMatch(adminProfilePreview, /\.from\(['"]/);
  assert.doesNotMatch(userModeration, /\.from\(['"]/);
  assert.doesNotMatch(adminPremium, /\.from\(['"]/);
  assert.doesNotMatch(adminMatchMessages, /\.from\(['"]/);
});

test("Users workflow nested tools consume backend read-model data instead of direct table reads", () => {
  const usersWorkflowSources = [
    adminUsers,
    adminUserDetail,
    adminProfilePreview,
    userModeration,
    adminPremium,
  ].join("\n");

  for (const table of [
    "profiles",
    "profile_vibes",
    "user_suspensions",
    "user_warnings",
    "premium_history",
  ]) {
    assert.doesNotMatch(usersWorkflowSources, new RegExp(`\\.from\\(['"]${table}['"]\\)`));
  }

  assert.match(adminProfilePreview, /profile: AdminPreviewProfile \| null/);
  assert.match(userModeration, /moderation\?: AdminModerationReadModel \| null/);
  assert.match(adminPremium, /history\?: PremiumHistoryEntry\[\]/);
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
  assert.match(adminPremium, /history = \[\]/);
  assert.match(adminPremium, /const closeModal = \(\) =>/);
  assert.match(adminPremium, /setPendingAction\(null\)/);
  assert.doesNotMatch(adminPremium, /\.from\("profiles"\)\.update/);
  assert.doesNotMatch(adminPremium, /\.from\("premium_history"\)\.insert/);
  assert.doesNotMatch(adminPremium, /\.from\(['"]premium_history['"]\)/);
  assert.doesNotMatch(adminPremium, /\.from\(['"]profiles['"]\)/);
  assert.match(adminPremium, /AdminConfirmDialog/);
});

test("Users nested admin dialogs reset confirmation state on close", () => {
  assert.match(userModeration, /const handleDialogOpenChange = \(open: boolean\) =>/);
  assert.match(userModeration, /setConfirmation\(null\)/);
  assert.match(adminPremium, /const closeModal = \(\) =>/);
  assert.match(adminPremium, /setPendingAction\(null\)/);
});

test("push campaigns are draft-only and do not enqueue browser notification events", () => {
  assert.doesNotMatch(adminPushCampaigns, /\.from\(['"]push_notification_events['"]\)[\s\S]*\.insert/);
  assert.doesNotMatch(adminPushCampaigns, /sendNotificationsToUsers/);
  assert.match(adminPushCampaigns, /status:\s*'draft'/);
  assert.match(adminPushCampaigns, /Delivery is disabled until a backend dispatcher exists/);
  assert.match(adminPushCampaigns, /Save Draft/);
  assert.match(adminPushCampaigns, /Update Campaign/);
  assert.match(adminPushCampaigns, /isSavingCampaign/);
  assert.match(adminPushCampaigns, /formData\.title\.trim\(\)/);
  assert.match(adminPushCampaigns, /formData\.body\.trim\(\)/);
  assert.match(adminPushCampaigns, /No campaign drafts yet/);
  assert.match(adminPushCampaigns, /Loading campaign drafts/);
  assert.match(adminPushCampaigns, /disabled=\{!isDraft\}/);
  assert.match(adminPushCampaigns, /Only draft campaigns can be edited/);
  assert.match(adminPushCampaigns, /Only draft campaigns can be deleted/);
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
  assert.match(adminPushCampaigns, /normalizeGenderValue/);
  assert.match(adminPushCampaigns, /clampAgeValue/);
  assert.match(adminPushCampaigns, /Number\.isFinite/);
  assert.match(adminPushCampaigns, /DEFAULT_AGE_RANGE: \[number, number\] = \[18, 99\]/);
  assert.match(adminPushCampaigns, /GENDER_TARGET_OPTIONS/);
  assert.match(adminPushCampaigns, /\{ label: "Man", value: "man" \}/);
  assert.match(adminPushCampaigns, /\{ label: "Woman", value: "woman" \}/);
  assert.match(adminPushCampaigns, /\{ label: "Non-binary", value: "non-binary" \}/);
  assert.match(adminPushCampaigns, /max=\{99\}/);
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
  assert.match(adminDeletions, /verified completion checkpoint/);
  assert.match(adminDeletions, /Eligible after scheduled date/);
  assert.match(adminDeletions, /Missing scheduled date/);
  assert.match(adminDeletions, /Unable to load account deletion requests/);
  assert.match(adminDeletions, /unsupported statuses and are hidden from/);
  assert.match(adminDeletions, />Recovered</);
  assert.doesNotMatch(adminDeletions, />Cancelled</);
});
