import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260525103000_video_date_push_open_dedupe_preload_v2.sql"),
  "utf8",
);
const outboxProviderIdempotencyMigration = readFileSync(
  join(root, "supabase/migrations/20260601184653_video_date_outbox_provider_idempotency.sql"),
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
  assert.match(types, /ack_notification_dispatch: \{\s+Args: \{\s+p_ack_source\?: string\s+p_dispatch_group_id: string\s+p_payload\?: Json\s+p_provider_notification_id\?: string\s+\}\s+Returns: Json\s+\}/);
  assert.match(types, /mark_notification_opened_v2: \{\s+Args: \{ notification_id: string \}\s+Returns: Json\s+\}/);
});

test("video-date OneSignal payloads carry canonical open, dedupe, route, and entity fields", () => {
  const ensureIndex = sendNotification.indexOf("await ensureInAppNotification(finalTitle, finalBody)");
  const attachIndex = sendNotification.indexOf("osData = attachVideoDateOneSignalContract");
  const compactIndex = sendNotification.indexOf("osData = compactVideoDateOsDataForPush(osData)");
  const collapseIndex = sendNotification.indexOf("collapseId = osData.dispatch_group_id.trim().slice(0, 64)");
  const payloadIndex = sendNotification.indexOf("const osPayload: any =");
  assert.ok(ensureIndex > 0, "in-app row must be ensured before provider payload assembly");
  assert.ok(attachIndex > ensureIndex, "OneSignal data contract must be attached after inbox UUID exists");
  assert.ok(compactIndex > attachIndex, "OneSignal data must be compacted after canonical fields are attached");
  assert.ok(collapseIndex > compactIndex, "collapse_id fallback must see dispatch_group_id added by attach/compaction");
  assert.ok(payloadIndex > attachIndex, "OneSignal payload must use the canonicalized data");

  assert.match(sendNotification, /function attachVideoDateOneSignalContract/);
  assert.match(sendNotification, /category === ['"]post_date_feedback_reminder['"]/);
  assert.match(sendNotification, /category === ['"]date_starting['"] \|\| category === ['"]reconnection['"] \|\| category === ['"]date_reminder['"] \|\| category === ['"]post_date_feedback_reminder['"]/);
  assert.match(sendNotification, /recipientId: args\.recipientId/);
  assert.match(sendNotification, /dedupeKey[\s\S]+\? createNotificationDispatchGroupId/);
  assert.match(sendNotification, /next\.notification_id = notificationId/);
  assert.match(sendNotification, /next\.dedupe_key = dedupeKey/);
  assert.match(sendNotification, /next\.dispatch_group_id = dispatchGroupId/);
  assert.match(sendNotification, /next\.deep_link = deepLink/);
  assert.match(sendNotification, /next\.video_session_id = sessionId/);
  assert.match(sendNotification, /next\.event_id = eventId/);
  assert.match(sendNotification, /category: args\.category/);
  assert.match(sendNotification, /ONESIGNAL_DATA_MAX_BYTES = 2048/);
  assert.match(sendNotification, /VIDEO_DATE_PRELOAD_DATA_MAX_BYTES = 3 \* 1024/);
  assert.match(sendNotification, /compactVideoDateOsDataForPush\(osData\)/);
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

test("video-date push outbox retries reuse a stable provider idempotency key", () => {
  assert.match(outboxProviderIdempotencyMigration, /ADD COLUMN IF NOT EXISTS provider_idempotency_key uuid/);
  assert.match(outboxProviderIdempotencyMigration, /SET provider_idempotency_key = gen_random_uuid\(\)/);
  assert.match(outboxProviderIdempotencyMigration, /ALTER COLUMN provider_idempotency_key SET NOT NULL/);
  assert.match(outboxProviderIdempotencyMigration, /DROP FUNCTION IF EXISTS public\.claim_video_date_provider_outbox_v2\(text, integer, integer\)/);
  assert.match(outboxProviderIdempotencyMigration, /provider_idempotency_key uuid/);
  assert.match(outboxProviderIdempotencyMigration, /o\.provider_idempotency_key/);

  assert.match(outboxDrainer, /provider_idempotency_key\?: string \| null/);
  assert.match(outboxDrainer, /stringField\(row\.payload, "provider_idempotency_key", "providerIdempotencyKey"\)/);
  assert.match(outboxDrainer, /row\.provider_idempotency_key\.trim\(\)/);
  assert.match(outboxDrainer, /requestBody\.provider_idempotency_key = providerIdempotencyKey/);
  assert.match(outboxDrainer, /isMissingProviderIdempotencyColumnError/);
  assert.match(outboxDrainer, /previewColumns\},provider_idempotency_key/);
  assert.match(outboxDrainer, /\.select\(previewColumns\)/);
  assert.match(sendNotification, /let requestProviderIdempotencyKey = validProviderIdempotencyKey\(provider_idempotency_key\)/);
  assert.match(sendNotification, /osPayload\.idempotency_key = requestProviderIdempotencyKey/);
});

test("web and native push clicks ack dispatch, mark opens, and keep navigation canonical", () => {
  for (const source of [webAck, nativeAck]) {
    assert.match(source, /markNotificationOpenedV2FromPayload/);
    assert.match(source, /mark_notification_opened_v2/);
    assert.doesNotMatch(source, /mark_notification_opened_v2["'] as never/);
    assert.doesNotMatch(source, /ack_notification_dispatch["'] as never/);
    assert.match(source, /firstOpen: ok && record\.first_open === true/);
    assert.match(source, /return \{ ok: false, firstOpen: false, openedAt: null, notificationId \}/);
    assert.match(source, /notification_id/);
    assert.match(source, /preload\?\.dispatch_group_id/);
  }

  assert.match(webOneSignal, /ackNotificationDispatchFromPayload\(data, "web_click"/);
  assert.match(webOneSignal, /markNotificationOpenedV2FromPayload\(data\)/);
  assert.match(webOneSignal, /preloadVideoDatePushTargetsFromPayload\(data\)/);
  assert.match(webOneSignal, /resolveNotificationActionRoute\(data\?\.action\)/);
  assert.match(webOneSignal, /settingsDrawerActionRoute = actionRoute === "\/settings\?drawer=notifications"/);
  assert.match(webOneSignal, /const safeHref = normalizePushDeepLinkHref\(actionRoute \?\? payloadUrl\)/);
  assert.match(webOneSignal, /resolveVideoDatePushHrefFromCanonicalTruth\(safeHref\)/);
  assert.match(webOneSignal, /window\.location\.href = normalizePushDeepLinkHref\(href\) \?\? safeHref/);
  assert.match(webOneSignal, /window\.location\.href = safeHref/);

  assert.match(nativeDeepLink, /ackNotificationDispatchFromPayload\(data, 'native_click'/);
  assert.match(nativeDeepLink, /markNotificationOpenedV2FromPayload\(data\)/);
  assert.match(nativeDeepLink, /useFeatureFlag\('video_date\.push_open_dedupe_v1'\)/);
  assert.match(nativeDeepLink, /isFeatureFlagEnabledWithAlias\(multiDeviceDedupV2, pushOpenDedupeAliasV1\)/);
  assert.match(nativeDeepLink, /multiDeviceDedupEnabled && hasDispatchGroupPayload\(raw\)/);
  assert.match(nativeDeepLink, /allowOneShotSideEffects/);
  assert.match(nativeDeepLink, /NOTIFICATION_OPEN_ACK_TIMEOUT_MS = 1200/);
  assert.match(nativeDeepLink, /withNotificationOpenAckTimeout/);
  assert.match(nativeDeepLink, /Promise\.race/);
  assert.doesNotMatch(nativeDeepLink, /Promise\.all\(\[\s*ackNotificationDispatchFromPayload[\s\S]+markNotificationOpenedV2FromPayload/);
  assert.match(nativeDeepLink, /defaultWhenUnconfirmed = !\(hasDispatchGroup \|\| hasNotificationId\)/);
  assert.match(nativeDeepLink, /if \(ack\?\.dispatchGroupId\) return ack\.ok === true && ack\.firstAck === true/);
  assert.match(nativeDeepLink, /if \(opened\?\.notificationId\) return opened\.ok === true && opened\.firstOpen === true/);
  assert.match(nativeDeepLink, /if \(!ack && !opened\) return defaultWhenUnconfirmed/);
  assert.match(nativeDeepLink, /queueNotificationDeepLinkPath\(pathStr, \{ allowOneShotSideEffects \}\)/);
  assert.match(nativeDeepLink, /allowOneShotSideEffects: pending\.allowOneShotSideEffects/);
  assert.match(nativeDeepLink, /reconcileHrefWithRegistration\(pathStr, user\.id/);
  assert.match(nativeDeepLink, /notification_tap_reconcile_failed/);
  assert.doesNotMatch(nativeDeepLink, /reconcile failed; using resolved path/);
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
    assert.doesNotMatch(source, /get_event_deck["'] as never/);
    assert.doesNotMatch(source, /get_event_deck_v3|fetchEventDeck/);
    assert.match(source, /getVideoDateDeckPrefetchItems\(deck\.profiles, PUSH_DECK_PREFETCH_MEDIA_LIMIT\)/);
    assert.match(source, /PUSH_DECK_PREFETCH_MEDIA_LIMIT = 3/);
  }
  assert.match(webPreload, /new Image\(\)/);
  assert.match(nativePreload, /supabase\.rpc\('get_event_deck'/);
  assert.match(nativePreload, /Image\.prefetch/);
});
