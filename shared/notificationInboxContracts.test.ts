import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  isAllowedNotificationAppPath,
  normalizeNotificationAppPath,
  resolveNotificationActionToNativeRoute,
  resolveNotificationActionToWebRoute,
} from "./notifications";

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
  assert.match(sharedNotifications, /SAFE_NOTIFICATION_ROUTE_SEGMENT/);
  assert.match(sharedNotifications, /WEB_NOTIFICATION_STATIC_APP_PATHS/);
  assert.match(sharedNotifications, /NATIVE_NOTIFICATION_STATIC_APP_PATHS/);
  assert.match(sharedNotifications, /NotificationRoutePlatform/);
  assert.match(sharedNotifications, /routeSegment\(action\.eventId\)/);
  assert.match(sharedNotifications, /case 'open_daily_drop':\s+return '\/matches'/);
  assert.match(sharedNotifications, /case 'open_daily_drop':\s+return '\/daily-drop'/);
  assert.equal(exists("src/lib/notificationActions.ts"), true);
  assert.equal(exists("apps/mobile/lib/notificationActions.ts"), true);
  assert.match(mobileDeepLinkHandler, /resolveNotificationActionRoute\(additionalData\?\.action\)/);
  assert.match(mobileDeepLinkHandler, /function shouldPreferNativeActionRoute/);
  assert.match(mobileDeepLinkHandler, /function sanitizeDiagnosticHref/);
  assert.match(mobileDeepLinkHandler, /from '@clientShared\/notifications'/);
  assert.match(mobileDeepLinkHandler, /normalizeNotificationAppPath\(trimmed, 'native'\)/);
  assert.match(mobileDeepLinkHandler, /normalizeNotificationAppPath\(`\$\{u\.pathname \|\| '\/'\}\$\{u\.search\}\$\{u\.hash\}`, 'native'\)/);
  assert.match(mobileDeepLinkHandler, /normalizeNotificationRouteSegment\(additionalData\?\.other_user_id\)/);
  assert.match(mobileDeepLinkHandler, /const ticketId = normalizeNotificationRouteSegment\(data\.ticket_id\)/);
  assert.match(mobileDeepLinkHandler, /DIAGNOSTIC_HREF_KEYS/);
  assert.match(mobileDeepLinkHandler, /route: sanitizeDiagnosticHref\(route\)/);
  assert.match(mobileDeepLinkHandler, /rawHref: sanitizeDiagnosticHref\(rawHref\)/);
  assert.match(mobileDeepLinkHandler, /case 'open_event_lobby':/);
  assert.match(mobileDeepLinkHandler, /case 'open_ready_gate':/);
  assert.match(mobileDeepLinkHandler, /case 'open_video_date':/);
  assert.match(mobileDeepLinkHandler, /case 'open_daily_drop':\s+return true/);
});

test("notification action route builders reject dynamic segment injection", () => {
  for (const resolver of [resolveNotificationActionToWebRoute, resolveNotificationActionToNativeRoute]) {
    assert.equal(resolver({ kind: "open_chat", otherUserId: "../settings" }), null);
    assert.equal(resolver({ kind: "open_chat", otherUserId: "abc/def" }), null);
    assert.equal(resolver({ kind: "open_chat", otherUserId: "abc%2Fdef" }), null);
    assert.equal(resolver({ kind: "open_event_lobby", eventId: "event?next=/settings" }), null);
    assert.equal(resolver({ kind: "open_ready_gate", sessionId: "ready#fragment" }), null);
    assert.equal(resolver({ kind: "open_profile", userId: ".." }), null);
  }
  assert.equal(
    resolveNotificationActionToWebRoute({ kind: "open_chat", otherUserId: "11111111-1111-4111-8111-111111111111" }),
    "/chat/11111111-1111-4111-8111-111111111111",
  );
  assert.equal(
    resolveNotificationActionToNativeRoute({ kind: "open_event_lobby", eventId: "22222222-2222-4222-8222-222222222222" }),
    "/event/22222222-2222-4222-8222-222222222222/lobby",
  );
});

test("notification app path normalization strips payload query and hash state", () => {
  assert.equal(normalizeNotificationAppPath("/settings?drawer=support"), "/settings");
  assert.equal(
    normalizeNotificationAppPath("/chat/11111111-1111-4111-8111-111111111111?next=/settings#x"),
    "/chat/11111111-1111-4111-8111-111111111111",
  );
  assert.equal(normalizeNotificationAppPath("/home?drawer=notifications", "web"), "/home");
  assert.equal(normalizeNotificationAppPath("/dashboard", "web"), "/dashboard");
  assert.equal(normalizeNotificationAppPath("/(tabs)/profile", "native"), "/(tabs)/profile");
  assert.equal(isAllowedNotificationAppPath("/home", "native"), false);
  assert.equal(isAllowedNotificationAppPath("/(tabs)/profile", "web"), false);
  assert.equal(normalizeNotificationAppPath("/settings/ticket/../account"), null);
  assert.equal(normalizeNotificationAppPath("//evil.example/chat/abc"), null);
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
