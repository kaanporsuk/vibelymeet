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
  assert.match(adminNotifications, /Clear all admin notifications\?/);

  assert.match(adminGrantCredits, /Grant credits to/);
  assert.match(adminGrantCredits, /if \(creditError\) throw creditError/);
  assert.match(adminGrantCredits, /Credit adjustment audit failed after credits were granted/);
  assert.match(adminGrantCredits, /Do not retry this grant/);
  assert.match(userModeration, /Suspend .*?\?/);
  assert.match(userModeration, /Lift suspension/);
  assert.match(userModeration, /Send warning/);
  assert.match(adminReports, /showActionConfirm/);

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
