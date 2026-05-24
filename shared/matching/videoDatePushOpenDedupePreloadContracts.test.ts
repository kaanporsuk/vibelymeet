import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260525103000_video_date_push_open_dedupe_preload_v2.sql"),
  "utf8",
);
const sendNotification = readFileSync(join(root, "supabase/functions/send-notification/index.ts"), "utf8");
const outboxDrainer = readFileSync(join(root, "supabase/functions/video-date-outbox-drainer/index.ts"), "utf8");
const postDateVerdictReminders = readFileSync(join(root, "supabase/functions/post-date-verdict-reminders/index.ts"), "utf8");
const dateReminderCron = readFileSync(join(root, "supabase/functions/date-reminder-cron/index.ts"), "utf8");
const webAck = readFileSync(join(root, "src/lib/notificationDispatchAck.ts"), "utf8");
const nativeAck = readFileSync(join(root, "apps/mobile/lib/notificationDispatchAck.ts"), "utf8");
const webOneSignal = readFileSync(join(root, "src/lib/onesignal.ts"), "utf8");
const nativeDeepLink = readFileSync(join(root, "apps/mobile/components/NotificationDeepLinkHandler.tsx"), "utf8");
const nativePendingDeepLink = readFileSync(join(root, "apps/mobile/lib/pendingNotificationDeepLink.ts"), "utf8");
const webPreload = readFileSync(join(root, "src/lib/videoDatePushPreload.ts"), "utf8");
const nativePreload = readFileSync(join(root, "apps/mobile/lib/videoDatePushPreload.ts"), "utf8");
const types = readFileSync(join(root, "src/integrations/supabase/types.ts"), "utf8");

test("mark_notification_opened_v2 preserves ownership and first-open semantics", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.mark_notification_opened_v2\(notification_id uuid\)/);
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(migration, /WHERE id = notification_id\s+AND user_id = v_user_id\s+AND dismissed_at IS NULL\s+FOR UPDATE/);
  assert.match(migration, /v_first_open := v_existing_opened_at IS NULL/);
  assert.match(migration, /opened_at = COALESCE\(opened_at, now\(\)\)/);
  assert.match(migration, /'first_open', v_first_open/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.mark_notification_opened_v2\(uuid\) TO authenticated, service_role/);
  assert.match(types, /mark_notification_opened_v2: \{\s+Args: \{ notification_id: string \}\s+Returns: Json\s+\}/);
});

test("video-date OneSignal payloads carry canonical open, dedupe, route, and entity fields", () => {
  const ensureIndex = sendNotification.indexOf("await ensureInAppNotification(finalTitle, finalBody)");
  const attachIndex = sendNotification.indexOf("osData = attachVideoDateOneSignalContract");
  const payloadIndex = sendNotification.indexOf("const osPayload: any =");
  assert.ok(ensureIndex > 0, "in-app row must be ensured before provider payload assembly");
  assert.ok(attachIndex > ensureIndex, "OneSignal data contract must be attached after inbox UUID exists");
  assert.ok(payloadIndex > attachIndex, "OneSignal payload must use the canonicalized data");

  assert.match(sendNotification, /function attachVideoDateOneSignalContract/);
  assert.match(sendNotification, /category === 'post_date_feedback_reminder'/);
  assert.match(sendNotification, /recipientId: args\.recipientId/);
  assert.match(sendNotification, /dedupeKey[\s\S]+\? createNotificationDispatchGroupId/);
  assert.match(sendNotification, /next\.notification_id = notificationId/);
  assert.match(sendNotification, /next\.dedupe_key = dedupeKey/);
  assert.match(sendNotification, /next\.dispatch_group_id = dispatchGroupId/);
  assert.match(sendNotification, /next\.deep_link = deepLink/);
  assert.match(sendNotification, /next\.video_session_id = sessionId/);
  assert.match(sendNotification, /next\.event_id = eventId/);
  assert.match(sendNotification, /category: args\.category/);
  assert.match(postDateVerdictReminders, /const dedupeKey = `post_date_feedback:\$\{row\.session_id\}:\$\{row\.missing_user_id\}`/);
  assert.match(postDateVerdictReminders, /dedupe_key: dedupeKey/);
  assert.match(dateReminderCron, /const dedupeKey = `date_reminder:\$\{plan\.id\}:\$\{uid\}:30m`/);
  assert.match(dateReminderCron, /const dedupeKey = `date_reminder:\$\{plan\.id\}:\$\{uid\}:5m`/);
  assert.match(dateReminderCron, /dedupe_key: dedupeKey/);
});

test("video-date push outbox rows without stable dedupe keys fail permanently", () => {
  assert.match(outboxDrainer, /function isVideoDateNotificationCategory/);
  assert.match(outboxDrainer, /const dedupeKey = stringField\(row\.payload, "dedupe_key", "dedupeKey"\) \?\? row\.dedupe_key \?\? null/);
  assert.match(outboxDrainer, /isVideoDateNotificationCategory\(category\) && !dedupeKey/);
  assert.match(outboxDrainer, /reason: "missing_stable_notification_dedupe_key", permanent: true/);
});

test("web and native push clicks ack dispatch, mark opens, and keep navigation canonical", () => {
  for (const source of [webAck, nativeAck]) {
    assert.match(source, /markNotificationOpenedV2FromPayload/);
    assert.match(source, /mark_notification_opened_v2/);
    assert.match(source, /firstOpen: ok && record\.first_open === true/);
    assert.match(source, /return \{ ok: false, firstOpen: false, openedAt: null, notificationId \}/);
    assert.match(source, /notification_id/);
    assert.match(source, /preload\?\.dispatch_group_id/);
  }

  assert.match(webOneSignal, /ackNotificationDispatchFromPayload\(data, "web_click"/);
  assert.match(webOneSignal, /markNotificationOpenedV2FromPayload\(data\)/);
  assert.match(webOneSignal, /preloadVideoDatePushTargetsFromPayload\(data\)/);
  assert.match(webOneSignal, /resolveVideoDatePushHrefFromCanonicalTruth\(url\)/);

  assert.match(nativeDeepLink, /ackNotificationDispatchFromPayload\(data, 'native_click'/);
  assert.match(nativeDeepLink, /markNotificationOpenedV2FromPayload\(data\)/);
  assert.match(nativeDeepLink, /allowOneShotSideEffects/);
  assert.match(nativeDeepLink, /NOTIFICATION_OPEN_ACK_TIMEOUT_MS = 1200/);
  assert.match(nativeDeepLink, /Promise\.race/);
  assert.match(nativeDeepLink, /defaultWhenUnconfirmed = !\(hasDispatchGroup \|\| hasNotificationId\)/);
  assert.match(nativeDeepLink, /if \(ack\.dispatchGroupId\) return ack\.ok === true && ack\.firstAck === true/);
  assert.match(nativeDeepLink, /if \(opened\.notificationId\) return opened\.ok === true && opened\.firstOpen === true/);
  assert.match(nativeDeepLink, /queueNotificationDeepLinkPath\(pathStr, \{ allowOneShotSideEffects \}\)/);
  assert.match(nativeDeepLink, /allowOneShotSideEffects: pending\.allowOneShotSideEffects/);
  assert.match(nativeDeepLink, /reconcileHrefWithRegistration\(pathStr, user\.id/);
  assert.match(nativePendingDeepLink, /type PendingNotificationDeepLink/);
  assert.match(nativePendingDeepLink, /allowOneShotSideEffects: options\?\.allowOneShotSideEffects !== false/);
});

test("push preloads are real, bounded, and do not block navigation", () => {
  for (const source of [webPreload, nativePreload]) {
    assert.match(source, /VIDEO_DATE_PUSH_PRELOAD_TIMEOUT_MS = 5_000/);
    assert.match(source, /preloadVideoDatePushTargetsFromPayload/);
    assert.match(source, /withTimeout\(preloadVideoDatePushTargets\(payload, viewerId\), VIDEO_DATE_PUSH_PRELOAD_TIMEOUT_MS\)/);
    assert.match(source, /fetchVideoDateSnapshot\(sessionId, \{ includeToken: false \}\)/);
    assert.match(source, /get_event_deck/);
    assert.doesNotMatch(source, /get_event_deck_v3|fetchEventDeck/);
    assert.match(source, /getVideoDateDeckPrefetchItems\(deck\.profiles, PUSH_DECK_PREFETCH_MEDIA_LIMIT\)/);
    assert.match(source, /PUSH_DECK_PREFETCH_MEDIA_LIMIT = 3/);
  }
  assert.match(webPreload, /new Image\(\)/);
  assert.match(nativePreload, /supabase\.rpc\('get_event_deck'/);
  assert.match(nativePreload, /Image\.prefetch/);
});
