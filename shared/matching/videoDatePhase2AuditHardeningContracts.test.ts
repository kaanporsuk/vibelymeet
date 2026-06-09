import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  VIDEO_DATE_CLIENT_REQUEST_ID_LENGTH,
  VIDEO_DATE_IDEMPOTENCY_KEY_MAX_LENGTH,
  VIDEO_DATE_IDEMPOTENCY_KEY_MIN_LENGTH,
  generateIdempotencyKey,
  isUuidV4IdempotencyKey,
} from "./idempotentRpc";

const root = process.cwd();
const hardening = readFileSync(
  join(root, "supabase/migrations/20260522002000_video_date_phase2_audit_hardening.sql"),
  "utf8",
);
const dispatchClaims = readFileSync(
  join(root, "supabase/migrations/20260522012000_video_date_recovery_alert_dispatch_claims.sql"),
  "utf8",
);
const config = readFileSync(join(root, "supabase/config.toml"), "utf8");
const dispatcher = readFileSync(
  join(root, "supabase/functions/video-date-recovery-alert-dispatcher/index.ts"),
  "utf8",
);
const dailyWebhook = readFileSync(
  join(root, "supabase/functions/video-date-daily-webhook/index.ts"),
  "utf8",
);
const syntheticMonitor = readFileSync(
  join(root, "supabase/functions/synthetic-video-date-monitor/index.ts"),
  "utf8",
);
const snapshotFunction = readFileSync(
  join(root, "supabase/functions/video-date-snapshot/index.ts"),
  "utf8",
);
const webReadiness = readFileSync(join(root, "src/hooks/useVideoDateReadiness.ts"), "utf8");
const nativeReadiness = readFileSync(join(root, "apps/mobile/lib/videoDateReadiness.ts"), "utf8");
const idempotentRpc = readFileSync(join(root, "shared/matching/idempotentRpc.ts"), "utf8");
const transitionCommands = readFileSync(
  join(root, "shared/matching/videoDateTransitionCommands.ts"),
  "utf8",
);
const legacyCleanup = readFileSync(
  join(root, "docs/video-date-v4-legacy-cleanup-checklist.md"),
  "utf8",
);

test("audit hardening dispatches recovery alerts without exposing them to clients", () => {
  assert.match(config, /\[functions\.video-date-recovery-alert-dispatcher\]\s+verify_jwt = false/);
  assert.match(hardening, /CREATE TABLE IF NOT EXISTS public\.video_date_recovery_alert_dispatches/);
  assert.match(hardening, /UNIQUE INDEX[\s\S]+severity, fingerprint, hour_bucket/);
  assert.match(hardening, /video_date_recovery_alert_dispatches_no_secret_keys/);
  assert.match(dispatchClaims, /sentry_claimed_at timestamptz/);
  assert.match(dispatchClaims, /slack_claimed_at timestamptz/);
  assert.match(dispatchClaims, /idx_video_date_recovery_alert_dispatches_sentry_claims/);
  assert.match(dispatchClaims, /idx_video_date_recovery_alert_dispatches_slack_claims/);
  assert.match(hardening, /REVOKE ALL ON TABLE public\.video_date_recovery_alert_dispatches FROM PUBLIC, anon, authenticated/);
  assert.match(hardening, /video-date-recovery-alert-dispatcher/);
  assert.match(hardening, /\*\/5 \* \* \* \*/);
  assert.match(dispatcher, /CRON_SECRET/);
  assert.match(dispatcher, /safeEqual/);
  assert.match(dispatcher, /get_video_date_phase2_recovery_health/);
  assert.match(dispatcher, /video_date_recovery_alert_dispatches/);
  assert.match(dispatcher, /SENTRY_DSN/);
  assert.match(dispatcher, /captureMessage\("video_date_recovery_alert_page"/);
  assert.match(dispatcher, /VIDEO_DATE_RECOVERY_SLACK_WEBHOOK_URL/);
  assert.match(dispatcher, /insert\.error\.code === "23505"/);
  assert.match(dispatcher, /\.eq\("fingerprint", fingerprint\)/);
  assert.match(dispatcher, /shouldSendSentry/);
  assert.match(dispatcher, /shouldSendSlack/);
  assert.match(dispatcher, /claimDispatchChannel/);
  assert.match(dispatcher, /DISPATCH_CLAIM_STALE_MS = 15 \* 60 \* 1000/);
  assert.match(dispatcher, /reclaimStaleDispatchClaims/);
  assert.match(dispatcher, /isStaleDispatchClaim/);
  assert.match(dispatcher, /stale_claim_reclaim_error/);
  assert.match(dispatcher, /\.is\(sentColumn, null\)[\s\S]+\.is\(claimedColumn, null\)/);
  assert.match(dispatcher, /sentryClaimedAt[\s\S]+\.is\(guard\.sentColumn, null\)[\s\S]+\.eq\(guard\.claimedColumn, guard\.claimedAt\)/);
  assert.match(dispatcher, /slackClaimedAt[\s\S]+\.is\(guard\.sentColumn, null\)[\s\S]+\.eq\(guard\.claimedColumn, guard\.claimedAt\)/);
  assert.match(dispatcher, /finishDispatchChannel/);
  assert.match(dispatcher, /retried/);
  assert.doesNotMatch(dispatcher, /meeting-tokens|createMeetingToken|daily_token|tokenExpiresAt/);
});

test("snapshot wrapper has a correct token type and strips tokens when token issuance is not requested", () => {
  assert.match(snapshotFunction, /token\?: string/);
  assert.match(snapshotFunction, /tokenExpiresAt\?: number/);
  assert.match(snapshotFunction, /function withoutToken/);
  assert.match(snapshotFunction, /const \{[\s\S]*token: _token,[\s\S]*tokenExpiresAt: _tokenExpiresAt/);
  assert.match(snapshotFunction, /tokenTtlSeconds: _tokenTtlSeconds/);
  assert.match(snapshotFunction, /tokenExpiryReason: _tokenExpiryReason/);
  assert.match(snapshotFunction, /if \(!includeToken\)[\s\S]+withoutToken\(snapshot\)/);
  assert.match(snapshotFunction, /phase !== "handshake" && phase !== "date"[\s\S]+withoutToken\(snapshot\)/);
  assert.doesNotMatch(snapshotFunction, /token\?: never/);
});

test("deadline no-op finalization, manual cleanup, schema inventory, and stale webhook alerts are wired", () => {
  assert.match(hardening, /CREATE OR REPLACE FUNCTION public\.finalize_video_session_deadline_v2/);
  assert.match(hardening, /'deadline_finalized',\s+'internal'/);
  assert.match(hardening, /'stateChanged', false/);
  assert.match(hardening, /false,\s+gen_random_uuid\(\)/);
  assert.match(hardening, /'signature_rejected_stale'/);
  assert.match(hardening, /operation = 'video_date_daily_webhook'/);
  assert.match(hardening, /CREATE OR REPLACE FUNCTION public\.trigger_video_date_orphan_cleanup_now/);
  assert.match(hardening, /video-date-orphan-room-cleanup/);
  assert.match(hardening, /'dry_run', COALESCE\(p_dry_run, true\)/);
  assert.match(hardening, /GRANT EXECUTE ON FUNCTION public\.trigger_video_date_orphan_cleanup_now\(boolean\)[\s\S]+TO service_role/);
  assert.match(hardening, /CREATE OR REPLACE VIEW public\.vw_video_date_v4_schema_inventory/);
  assert.match(hardening, /video-date-recovery-alert-dispatcher/);
});

test("Daily webhook skew is tightened and stale signature rejects are observable", () => {
  assert.match(dailyWebhook, /MAX_TIMESTAMP_SKEW_MS = 2 \* 60 \* 1000/);
  assert.match(dailyWebhook, /recordWebhookSecurityMetric/);
  assert.match(dailyWebhook, /signature_rejected_stale/);
  assert.match(dailyWebhook, /p_operation: "video_date_daily_webhook"/);
  assert.match(dailyWebhook, /max_timestamp_skew_ms: MAX_TIMESTAMP_SKEW_MS/);
});

test("synthetic monitor covers webhook and orphan cleanup paths", () => {
  assert.match(syntheticMonitor, /probeDailyWebhookPath/);
  assert.match(syntheticMonitor, /dailyWebhookProbeTarget/);
  assert.match(syntheticMonitor, /requested_event_id/);
  assert.match(syntheticMonitor, /selectedEventId = selected\?\.event_id \?\? null/);
  assert.doesNotMatch(syntheticMonitor, /selected\?\.event_id \?\? body\.event_id/);
  assert.match(syntheticMonitor, /participant_1_id,participant_2_id/);
  assert.match(syntheticMonitor, /daily_room_name/);
  assert.match(syntheticMonitor, /participant\.joined/);
  assert.match(syntheticMonitor, /x-webhook-signature/);
  assert.match(syntheticMonitor, /DAILY_WEBHOOK_SECRET/);
  assert.match(syntheticMonitor, /base64ToBytes\(secret\)/);
  assert.match(syntheticMonitor, /hmacSha256Base64\(secretBytes, `\$\{timestamp\}\.\$\{rawBody\}`\)/);
  assert.match(syntheticMonitor, /"x-webhook-signature": correctSignature/);
  assert.doesNotMatch(syntheticMonitor, /v0:|v0=|hmacSha256Hex/);
  assert.match(syntheticMonitor, /synthetic_session_reconciled/);
  assert.match(syntheticMonitor, /synthetic_session_guarded/);
  assert.match(syntheticMonitor, /endpoint_only_no_synthetic_room/);
  assert.match(syntheticMonitor, /probeOrphanCleanupDryRun/);
  assert.match(syntheticMonitor, /video-date-orphan-room-cleanup/);
  assert.match(syntheticMonitor, /dry_run: true/);
  assert.match(syntheticMonitor, /phase2_path_probe_failed/);
});

test("Daily readiness diagnostics remain local capability checks on web and native", () => {
  assert.match(webReadiness, /recordVideoDateReadinessCheckV2/);
  assert.match(webReadiness, /inspectWebVideoDateCapabilities/);
  assert.match(webReadiness, /queryPermissionState\("camera"\)/);
  assert.match(webReadiness, /queryPermissionState\("microphone"\)/);
  assert.match(webReadiness, /enumerateMediaDevices/);
  assert.match(webReadiness, /dailyRoomDiagnosticRemoved: true/);
  assert.doesNotMatch(webReadiness, /runDailyCallQualityAdvisory|createDailyCallObjectGuarded|testCallQuality/);

  assert.match(nativeReadiness, /recordVideoDateReadinessCheckV2/);
  assert.match(nativeReadiness, /inspectNativeVideoDateCapabilities/);
  assert.match(nativeReadiness, /Camera\.getCameraPermissionsAsync/);
  assert.match(nativeReadiness, /Camera\.getMicrophonePermissionsAsync/);
  assert.match(nativeReadiness, /dailyRoomDiagnosticRemoved: true/);
  assert.doesNotMatch(
    nativeReadiness,
    /runNativeDailyCallQualityAdvisory|createVideoDateDailyDiagnosticCallObjectGuarded|testCallQuality|testWebsocketConnectivity/,
  );
});

test("shared idempotency helper documents server bounds and emits UUID v4 request ids", () => {
  const key = generateIdempotencyKey();
  assert.equal(key.length, VIDEO_DATE_CLIENT_REQUEST_ID_LENGTH);
  assert.equal(isUuidV4IdempotencyKey(key), true);
  assert.equal(VIDEO_DATE_IDEMPOTENCY_KEY_MIN_LENGTH, 8);
  assert.equal(VIDEO_DATE_IDEMPOTENCY_KEY_MAX_LENGTH, 160);
  assert.match(idempotentRpc, /36-char UUID v4/);
  assert.match(hardening, /Idempotency keys must be 8-160 characters/);
  assert.match(transitionCommands, /generateIdempotencyKey/);
});

test("legacy duplicate-card fallback cleanup is explicit", () => {
  assert.match(legacyCleanup, /get_event_deck_v2/);
  assert.match(legacyCleanup, /record_deck_deal_v2/);
  assert.match(legacyCleanup, /server-dealt/);
  assert.match(legacyCleanup, /Do not restore client-only seen-card memory/);
});
