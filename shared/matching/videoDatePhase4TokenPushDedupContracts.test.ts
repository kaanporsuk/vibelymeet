import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildVideoDatePushPreloadData,
  createNotificationDispatchGroupId,
  normalizeVideoDatePushPreload,
  resolveVideoDatePhase4TokenWindow,
  shouldRefreshDailyTokenBeforeReconnect,
  videoDateTimelineFromPushPreload,
} from "./videoDatePhase4";

const root = process.cwd();
const dailyRoom = readFileSync(join(root, "supabase/functions/daily-room/index.ts"), "utf8");
const tokenRefresh = readFileSync(join(root, "supabase/functions/video-date-token-refresh/index.ts"), "utf8");
const snapshotFunction = readFileSync(join(root, "supabase/functions/video-date-snapshot/index.ts"), "utf8");
const sendNotification = readFileSync(join(root, "supabase/functions/send-notification/index.ts"), "utf8");
const migration = readFileSync(
  join(root, "supabase/migrations/20260524190000_video_date_phase4_token_push_dedup.sql"),
  "utf8",
);
const webVideoCall = readFileSync(join(root, "src/hooks/useVideoCall.ts"), "utf8");
const nativeDate = readFileSync(join(root, "apps/mobile/app/date/[id].tsx"), "utf8");
const webOneSignal = readFileSync(join(root, "src/lib/onesignal.ts"), "utf8");
const nativeDeepLink = readFileSync(join(root, "apps/mobile/components/NotificationDeepLinkHandler.tsx"), "utf8");
const webConnectionOverlay = readFileSync(join(root, "src/components/video-date/ConnectionOverlay.tsx"), "utf8");
const nativeConnectionOverlay = readFileSync(join(root, "apps/mobile/components/video-date/ConnectionOverlay.tsx"), "utf8");

test("Phase 4 token windows are phase-bounded and reconnect-safe", () => {
  const nowMs = Date.parse("2026-05-24T10:00:00.000Z");
  const window = resolveVideoDatePhase4TokenWindow({
    nowMs,
    phaseDeadlineAtMs: nowMs + 60_000,
    dailyRoomExpiresAtIso: new Date(nowMs + 10 * 60_000).toISOString(),
    maxTtlSeconds: 14_400,
  });
  assert.equal(window.ttlSeconds, 180);
  assert.equal(window.reason, "phase_deadline");
  const stalePhaseWindow = resolveVideoDatePhase4TokenWindow({
    nowMs,
    phaseDeadlineAtMs: nowMs - 1_000,
    maxTtlSeconds: 14_400,
  });
  assert.equal(stalePhaseWindow.ttlSeconds, 180);
  assert.equal(stalePhaseWindow.reason, "phase_deadline");
  assert.equal(shouldRefreshDailyTokenBeforeReconnect(new Date(nowMs + 89_000).toISOString(), nowMs), true);
  assert.equal(shouldRefreshDailyTokenBeforeReconnect(new Date(nowMs + 91_000).toISOString(), nowMs), false);

  assert.match(dailyRoom, /resolveVideoDateMeetingTokenWindow/);
  assert.match(dailyRoom, /DAILY_VIDEO_DATE_TOKEN_PHASE_EXTENSION_BUFFER_MS/);
  assert.match(dailyRoom, /else if \(phaseDeadlineAtMs != null\)/);
  assert.match(dailyRoom, /token_ttl_seconds/);
  assert.match(tokenRefresh, /phaseDeadlineAt/);
  assert.match(tokenRefresh, /resolveTokenWindow/);
  assert.match(tokenRefresh, /evaluate_client_feature_flag/);
  assert.match(tokenRefresh, /else if \(phaseDeadlineAtMs !== null\)/);
  assert.match(snapshotFunction, /phaseDeadlineAt/);
  assert.match(snapshotFunction, /resolveSnapshotTokenWindow/);
  assert.match(snapshotFunction, /evaluate_client_feature_flag/);
  assert.match(snapshotFunction, /else if \(phaseDeadlineAtMs !== null\)/);
  assert.match(snapshotFunction, /tokenTtlSeconds: tokenWindow\.ttlSeconds/);
  assert.match(migration, /'video_date\.daily_token_refresh_v2', false, 0/);
  assert.match(migration, /'video_date\.push_payload_v2', false, 0/);
  assert.match(migration, /'video_date\.multi_device_dedup_v2', false, 0/);
  assert.doesNotMatch(migration, /enabled = EXCLUDED\.enabled/);
  assert.doesNotMatch(migration, /rollout_bps = EXCLUDED\.rollout_bps/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_video_date_snapshot_core/);
  assert.match(migration, /v_computed_deadline_at := CASE/);
  assert.match(migration, /WHEN v_phase = 'date'[\s\S]+date_extra_seconds/);
  assert.match(migration, /GREATEST\(v_deadline_row_at, v_computed_deadline_at\)/);
  assert.match(webVideoCall, /shouldRefreshDailyTokenBeforeReconnect/);
  assert.match(webVideoCall, /dailyTokenRefreshV2 === true/);
  assert.match(nativeDate, /shouldRefreshDailyTokenBeforeReconnect/);
  assert.match(nativeDate, /dailyTokenRefreshV2\.enabled/);
});

test("Phase 4 push preload is compact, routeable, and ack-deduped", () => {
  const dispatchGroupId = createNotificationDispatchGroupId({
    recipientId: "11111111-1111-4111-8111-111111111111",
    category: "date_starting",
    sessionId: "22222222-2222-4222-8222-222222222222",
    dedupeKey: "dispatch-a",
  });
  const nextDispatchGroupId = createNotificationDispatchGroupId({
    recipientId: "11111111-1111-4111-8111-111111111111",
    category: "date_starting",
    sessionId: "22222222-2222-4222-8222-222222222222",
    dedupeKey: "dispatch-b",
  });
  assert.notEqual(dispatchGroupId, nextDispatchGroupId);
  const payload = buildVideoDatePushPreloadData({
    sessionId: "22222222-2222-4222-8222-222222222222",
    eventId: "33333333-3333-4333-8333-333333333333",
    state: "handshake",
    phaseStartedAtMs: 1_000,
    phaseDeadlineAtMs: 61_000,
    partnerThumbUrl: "https://example.com/avatar.jpg",
    correlationId: "corr",
    dispatchGroupId,
  });
  assert.equal(typeof payload.dispatch_group_id, "string");
  assert.ok(Buffer.byteLength(JSON.stringify(payload), "utf8") <= 3 * 1024);
  const timeline = videoDateTimelineFromPushPreload(normalizeVideoDatePushPreload(payload.video_date_preload), {
    clientNowMs: 10_000,
  });
  assert.equal(timeline?.phase, "handshake");
  assert.equal(timeline?.phaseDeadlineAtMs, 61_000);
  const lateDeliveredTimeline = videoDateTimelineFromPushPreload(
    normalizeVideoDatePushPreload({
      ...(payload.video_date_preload as Record<string, unknown>),
      clockSkewHintMs: 500,
      serverNowMs: 1_000,
    }),
    { clientNowMs: 30_000 },
  );
  assert.equal(lateDeliveredTimeline?.serverNowMs, 30_500);
  assert.equal(lateDeliveredTimeline?.clockSkewMs, 500);
  assert.equal(
    videoDateTimelineFromPushPreload(normalizeVideoDatePushPreload(payload.video_date_preload), {
      clientNowMs: 70_000,
    }),
    null,
  );
  const payloadWithoutDispatch = buildVideoDatePushPreloadData({
    sessionId: "22222222-2222-4222-8222-222222222222",
    state: "date",
    phaseDeadlineAtMs: 120_000,
    correlationId: "corr-no-dispatch",
  });
  const preloadWithoutDispatch = normalizeVideoDatePushPreload(payloadWithoutDispatch.video_date_preload);
  assert.equal(preloadWithoutDispatch?.dispatchGroupId, null);
  assert.equal(videoDateTimelineFromPushPreload(preloadWithoutDispatch, { clientNowMs: 10_000 })?.phase, "date");

  assert.match(sendNotification, /buildVideoDatePushPayloadV2/);
  assert.match(sendNotification, /video_date\.push_payload_v2/);
  assert.match(sendNotification, /video_date\.multi_device_dedup_v2/);
  assert.match(sendNotification, /dedupeKey: args\.dedupeKey \?\? correlationId/);
  assert.match(sendNotification, /compactVideoDateOsDataForPush/);
  assert.match(sendNotification, /osData = compactVideoDateOsDataForPush\(osData\)/);
  assert.match(sendNotification, /dispatch_group_id/);
  assert.match(sendNotification, /phaseDeadlineAt/);
  assert.match(sendNotification, /VIDEO_DATE_PRELOAD_DATA_MAX_BYTES = 3 \* 1024/);
  assert.match(sendNotification, /jsonByteLength\(payload\) <= VIDEO_DATE_PRELOAD_DATA_MAX_BYTES/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.notification_acks/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.ack_notification_dispatch/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS notification_acks_user_dispatch_group_uidx/);
  assert.match(migration, /pg_column_size\(v_payload\) > 8192/);
  assert.match(webOneSignal, /ackNotificationDispatchFromPayload/);
  assert.match(webOneSignal, /void ackNotificationDispatchFromPayload\(data, "web_click"/);
  assert.match(webOneSignal, /preloadVideoDatePushTargetsFromPayload/);
  assert.match(readFileSync(join(root, "src/lib/videoDatePushPreload.ts"), "utf8"), /if \(!timeline\) sessionStorage\.removeItem\(key\)/);
  assert.match(nativeDeepLink, /ackNotificationDispatchFromPayload/);
  assert.match(nativeDeepLink, /ackNotificationDispatchFromPayload\(data, 'native_click'/);
  assert.match(nativeDeepLink, /useFeatureFlag\('video_date\.multi_device_dedup_v2'\)/);
  assert.doesNotMatch(nativeDeepLink, /push_open_dedupe_v1/);
  assert.match(nativeDeepLink, /multiDeviceDedupEnabled/);
  assert.match(nativeDeepLink, /preloadVideoDatePushTargetsFromPayload/);
  assert.match(readFileSync(join(root, "apps/mobile/lib/videoDatePushPreload.ts"), "utf8"), /if \(!timeline\) preloadBySessionId\.delete\(sessionId\)/);
  assert.match(nativeDeepLink, /foreground_suppressed_dispatch_ack/);
});

test("Phase 4 long partner-wait escalation is present on web and native overlays", () => {
  for (const source of [webConnectionOverlay, nativeConnectionOverlay]) {
    assert.match(source, /resolveVideoDatePartnerWaitMaxState/);
    assert.match(source, /Partner appears to have left/);
    assert.match(source, /Keep waiting/);
    assert.match(source, /Return to deck/);
  }
});
