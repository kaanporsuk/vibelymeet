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
const adminQuickActions = read("src/components/admin/AdminQuickActionsCards.tsx");
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
  assert.match(adminGrantCredits, /if \(creditError\) throw creditError/);
  assert.match(adminGrantCredits, /Credit adjustment audit failed after credits were granted/);
  assert.match(adminGrantCredits, /Do not retry this grant/);
  assert.match(userModeration, /Suspend .*?\?/);
  assert.match(userModeration, /Lift suspension/);
  assert.match(userModeration, /Send warning/);
  assert.match(adminReports, /showActionConfirm/);
  assert.match(adminReports, /mark this report as action taken only after the warning write succeeds/);
  assert.match(adminReports, /so the report was not marked complete/);

  assert.match(adminEventControls, /Set "\$?\{eventTitle\}" live\?/);
  assert.match(adminEventControls, /events\.status = live/);
  assert.match(adminEventControls, /events\.status = ended and ended_at/);
  assert.match(adminEventControls, /updates events\.duration_minutes/);
  assert.match(adminEventControls, /sends push notifications to confirmed attendees and waitlisted users/);
  assert.match(adminEvents, /Generate \$?\{pendingEventAction\.count\} more occurrences\?/);
  assert.match(adminEvents, /Archive recurring series/);
  assert.match(adminEvents, /Archive Selected/);

  assert.match(adminPhotoVerification, /Approve photo verification\?/);
  assert.match(adminPhotoVerification, /Reject photo verification\?/);
  assert.match(adminPhotoVerification, /records the reason/);
  assert.match(supportInbox, /Open payment exception case\?/);
  assert.match(supportInbox, /Save payment exception transition\?/);
  assert.match(supportInbox, /does not process a refund in-app/);
  assert.match(adminPremium, /Premium profile updates and premium_history writes happen in separate steps/);
  assert.match(adminPremium, /These writes are not atomic in this P1 frontend pass/);

  assert.match(adminTierConfig, /requestSetOverride/);
  assert.match(adminTierConfig, /requestResetOverride/);
  assert.match(adminMediaLifecycle, /Retry all failed media delete jobs\?/);
  assert.match(adminMediaLifecycle, /Requeue all stale claimed jobs\?/);
  assert.match(adminMediaLifecycle, /Save chat media policy\?/);
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

test("report actions create real warning rows and fail before marking reports when side effects fail", () => {
  assert.match(adminReports, /\.from\("user_warnings"\)\.insert/);
  assert.match(adminReports, /if \(profileError\) throw profileError/);
  assert.match(adminReports, /if \(suspensionError\) throw suspensionError/);

  const actionHandler = section(adminReports, "const handleTakeAction", "const requestReportActionConfirmation");
  assert.match(actionHandler, /await suspendUser\.mutateAsync/);
  assert.match(actionHandler, /await issueWarning\.mutateAsync/);
  assert.match(actionHandler, /await updateReport\.mutateAsync/);
  assert.ok(
    actionHandler.indexOf("await suspendUser.mutateAsync") < actionHandler.indexOf("await updateReport.mutateAsync"),
    "suspension must happen before report status update",
  );
  assert.ok(
    actionHandler.indexOf("await issueWarning.mutateAsync") < actionHandler.indexOf("await updateReport.mutateAsync"),
    "warning must happen before report status update",
  );
});

test("overview metrics and event analytics labels match query semantics", () => {
  assert.doesNotMatch(adminStats, /Active Events/);
  assert.match(adminStats, /Total Events/);
  assert.match(adminStats, /All event rows, including draft\/cancelled\/archived\/ended/);
  assert.doesNotMatch(adminStats, /Match Rate/);
  assert.match(adminStats, /Matches\/User/);
  assert.match(adminStats, /matchesCount \/ usersCount\)\.toFixed\(2\)/);

  assert.match(adminLiveEventMetrics, /Platform Reports/);
  assert.match(adminLiveEventMetrics, /Global\/platform count; not scoped to this event/);
  assert.match(adminLiveEventMetrics, /true event-scoped reports are deferred/);
});

test("quick actions show only actionable upcoming events", () => {
  assert.match(adminQuickActions, /resolveEventLifecycle/);
  assert.match(adminQuickActions, /status, ended_at, archived_at/);
  assert.match(adminQuickActions, /\.is\('archived_at', null\)/);
  assert.match(adminQuickActions, /terminalRawStatuses/);
  assert.match(adminQuickActions, /event\.archived_at \|\| event\.ended_at/);
  assert.match(adminQuickActions, /\.lifecycle === 'upcoming'/);
  assert.match(adminQuickActions, /Actionable Upcoming Events/);
  assert.match(adminQuickActions, /Registered seats/);
});

test("push analytics uses the admin-safe telemetry view and honest states", () => {
  assert.match(usePushAnalytics, /\.from\("push_notification_events_admin"\)/);
  assert.doesNotMatch(usePushAnalytics, /\.from\("push_notification_events"\)/);
  assert.match(usePushAnalytics, /telemetrySource: "push_notification_events_admin"/);

  assert.match(pushAnalyticsDashboard, /Unable to read push analytics from the admin telemetry view/);
  assert.match(pushAnalyticsDashboard, /No telemetry available in this range; this does not prove no notifications were sent/);
  assert.match(pushAnalyticsDashboard, /provider sends may exist outside these rows/);
});

test("users panel labels registration-derived counts honestly", () => {
  assert.match(adminUsers, /Event registration counts are derived from registration rows for the loaded users; they are not confirmed attendance/);
  assert.match(adminUsers, /Event registrations/);
  assert.match(adminUsers, /Could not load users or derived event registration counts/);
  assert.match(adminUsers, /Vibes unavailable/);

  assert.match(adminUserDetail, /Event registrations/);
  assert.match(adminUserDetail, /Not confirmed attendance/);
});

test("notifications copy is scoped to the latest 100 and broad actions say so", () => {
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

test("premium operations surface profile and history failures separately", () => {
  assert.match(adminPremium, /const \{ error: updateErr \}/);
  assert.match(adminPremium, /const \{ error: historyError \} = await supabase\.from\("premium_history"\)\.insert/);
  assert.match(adminPremium, /if \(historyError\)/);
  assert.match(adminPremium, /Premium history insert failed after profile update/);
  assert.match(adminPremium, /Profile state changed, but premium_history did not record it/);
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
