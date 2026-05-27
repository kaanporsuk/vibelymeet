import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const exists = (path: string) => existsSync(join(root, path));

const migration = read("supabase/migrations/20260509143000_user_notifications_live_attention_center.sql");
const sendNotification = read("supabase/functions/send-notification/index.ts");
const sharedNotifications = read("shared/notifications.ts");
const webHook = read("src/hooks/useNotificationInbox.ts");
const mobileHook = read("apps/mobile/lib/useNotificationInbox.ts");
const webDashboard = read("src/pages/Dashboard.tsx");
const mobileDashboard = read("apps/mobile/app/(tabs)/index.tsx");
const webSettings = read("src/pages/Settings.tsx");
const webCenter = read("src/components/notifications/NotificationCenterSheet.tsx");
const mobileCenter = read("apps/mobile/components/notifications/NotificationCenterSheet.tsx");
const mobileDeepLinkHandler = read("apps/mobile/components/NotificationDeepLinkHandler.tsx");

test("notification inbox migration creates durable user-owned attention center", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.user_notifications/);
  assert.match(migration, /UNIQUE \(user_id, dedupe_key\)/);
  assert.match(migration, /ALTER TABLE public\.user_notifications ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /USING \(auth\.uid\(\) = user_id\)/);
  assert.match(migration, /GRANT SELECT ON public\.user_notifications TO authenticated/);
  assert.match(migration, /GRANT ALL ON public\.user_notifications TO service_role/);
  assert.match(migration, /mark_notifications_seen/);
  assert.match(migration, /mark_notification_opened/);
  assert.match(migration, /dismiss_notification/);
  assert.match(migration, /mark_all_notifications_read/);
  assert.match(migration, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.user_notifications/);
});

test("send-notification writes in-app notifications without weakening push gates", () => {
  assert.match(sendNotification, /type NotificationChannel = 'in_app' \| 'push'/);
  assert.match(sendNotification, /const DEFAULT_CHANNELS: NotificationChannel\[\] = \['in_app', 'push'\]/);
  assert.match(sendNotification, /function normalizeChannels/);
  assert.match(sendNotification, /createOrUpdateUserNotification/);
  assert.match(sendNotification, /\.from\('user_notifications'\)/);
  assert.match(sendNotification, /validateClientNotificationRequest/);
  assert.match(sendNotification, /event_vibes/);
  assert.match(sendNotification, /dismissed_at: null/);
  assert.match(sendNotification, /await ensureInAppNotification\(finalTitle, finalBody\)/);
  assert.match(sendNotification, /if \(!wantsPush\)/);
  assert.match(sendNotification, /push_skipped: true/);
  assert.match(sendNotification, /if \(wantsPush && !prefs\.push_enabled && !bypass_preferences\)/);
  assert.match(sendNotification, /if \(wantsPush && !skipsPerBucketPreferenceCheck\(category\)\)/);
  assert.match(sendNotification, /if \(wantsPush && prefs\.quiet_hours_enabled/);
  assert.match(sendNotification, /CATEGORY_TO_COLUMN/);
  assert.match(sendNotification, /unknown_category/);
  assert.match(sendNotification, /reason: 'unknown_category', in_app_notification_id: inAppNotificationId/);
  assert.match(sendNotification, /isPairBlocked/);
  assert.match(sendNotification, /quiet_hours/);
  assert.match(sendNotification, /OneSignal/);
});

test("web and native clients share notification action normalization while keeping platform routes", () => {
  assert.match(sharedNotifications, /normalizeNotificationAction/);
  assert.match(sharedNotifications, /resolveNotificationActionToWebRoute/);
  assert.match(sharedNotifications, /resolveNotificationActionToNativeRoute/);
  assert.match(sharedNotifications, /case 'open_event_lobby':\s+return `\/event\/\$\{action\.eventId\}\/lobby`/);
  assert.match(sharedNotifications, /case 'open_daily_drop':\s+return '\/matches'/);
  assert.match(sharedNotifications, /case 'open_daily_drop':\s+return '\/daily-drop'/);
  assert.equal(exists("src/lib/notificationActions.ts"), true);
  assert.equal(exists("apps/mobile/lib/notificationActions.ts"), true);
  assert.match(mobileDeepLinkHandler, /resolveNotificationActionRoute\(additionalData\?\.action\)/);
  assert.match(mobileDeepLinkHandler, /function shouldPreferNativeActionRoute/);
  assert.match(mobileDeepLinkHandler, /function sanitizeDiagnosticHref/);
  assert.match(mobileDeepLinkHandler, /\^\(chat\|daily-drop\|ready\|date\|event\|events\|settings\|premium\|user\|matches\)/);
  assert.match(mobileDeepLinkHandler, /DIAGNOSTIC_HREF_KEYS/);
  assert.match(mobileDeepLinkHandler, /route: sanitizeDiagnosticHref\(route\)/);
  assert.match(mobileDeepLinkHandler, /rawHref: sanitizeDiagnosticHref\(rawHref\)/);
  assert.match(mobileDeepLinkHandler, /case 'open_event_lobby':/);
  assert.match(mobileDeepLinkHandler, /case 'open_ready_gate':/);
  assert.match(mobileDeepLinkHandler, /case 'open_video_date':/);
  assert.match(mobileDeepLinkHandler, /case 'open_daily_drop':\s+return true/);
});

test("web and mobile inbox hooks use the same table, realtime channel, and RPC mutations", () => {
  for (const source of [webHook, mobileHook]) {
    assert.match(source, /\.from\(["']user_notifications["']\)/);
    assert.match(source, /postgres_changes/);
    assert.match(source, /mark_notifications_seen/);
    assert.match(source, /mark_notification_opened/);
    assert.match(source, /dismiss_notification/);
    assert.match(source, /mark_all_notifications_read/);
    assert.match(source, /activeExpiryFilter/);
    assert.match(source, /groupRows/);
  }
});

test("web and mobile dashboard surfaces mount the bell, center, and deep-link handlers", () => {
  assert.match(webDashboard, /NotificationBell/);
  assert.match(webDashboard, /NotificationCenterSheet/);
  assert.match(webDashboard, /useNotificationInbox/);
  assert.match(mobileDashboard, /NotificationBell/);
  assert.match(mobileDashboard, /NotificationCenterSheet/);
  assert.match(mobileDashboard, /useNotificationInbox/);
  assert.match(webCenter, /notification_seen/);
  assert.match(webCenter, /notification_opened/);
  assert.match(webCenter, /\/settings\?drawer=notifications/);
  assert.match(webCenter, /onClose\(\);\s+onRequestPushSetup\(\);/);
  assert.match(webSettings, /searchParams\.get\("drawer"\)/);
  assert.match(webSettings, /drawer === "notifications"/);
  assert.match(mobileCenter, /notification_seen/);
  assert.match(mobileCenter, /notification_opened/);
  assert.match(mobileCenter, /onClose\(\);\s+onRequestPushSetup\(\);/);
  assert.match(mobileDeepLinkHandler, /resolveNotificationActionRoute/);
});
