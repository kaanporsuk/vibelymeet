import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260524090000_video_date_phase1_provider_reliability.sql");
const helper = read("supabase/functions/_shared/video-date-provider-reliability.ts");
const outboxDrainer = read("supabase/functions/video-date-outbox-drainer/index.ts");
const deadlineFinalizer = read("supabase/functions/video-date-deadline-finalizer/index.ts");
const dailyRoom = read("supabase/functions/daily-room/index.ts");
const tokenRefresh = read("supabase/functions/video-date-token-refresh/index.ts");
const sendNotification = read("supabase/functions/send-notification/index.ts");
const packageJson = read("package.json");

test("Phase 1 reliability migration adds worker leases, row refresh, rate limits, and failure stores", () => {
  for (const table of [
    "video_date_worker_runs",
    "video_date_provider_rate_limits",
    "video_date_provider_outbox_failure_log",
    "video_date_provider_dead_letters",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(migration, new RegExp(`REVOKE ALL ON TABLE public\\.${table} FROM PUBLIC, anon, authenticated`));
    assert.match(migration, new RegExp(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\\.${table} TO service_role`));
  }

  for (const fn of [
    "begin_video_date_worker_run_v1",
    "refresh_video_date_worker_run_v1",
    "finish_video_date_worker_run_v1",
    "refresh_video_date_provider_outbox_claim_v1",
    "refresh_video_session_deadline_claim_v1",
    "take_provider_rate_limit_token_v1",
  ]) {
    assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}`));
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]+TO service_role`));
  }

  assert.match(migration, /take_video_date_token_refresh_rate_limit_v1/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.take_video_date_token_refresh_rate_limit_v1\(\)[\s\S]+TO authenticated, service_role/);
  assert.match(migration, /meeting_token_refresh_user:' \|\| v_uid::text/);
  assert.match(migration, /'scope', 'user'/);
  assert.match(migration, /'scope', 'provider'/);
  assert.match(migration, /RETURN jsonb_build_object\('ok', true, 'scope', 'provider'\)/);
  assert.doesNotMatch(migration, /RETURN v_(?:user|provider)_result \|\|/);
  assert.match(migration, /worker_already_running/);
  assert.match(migration, /lease_lost/);
  assert.match(migration, /provider_rate_limited/);
});

test("Phase 1 reliability helper provides bounded fetch, rate limiting, leases, Sentry, and DLQ logging", () => {
  assert.match(helper, /class ProviderTimeoutError extends Error/);
  assert.match(helper, /class ProviderRateLimitError extends Error/);
  assert.match(helper, /readonly clientError: string/);
  assert.match(helper, /export async function fetchWithTimeout/);
  assert.match(helper, /AbortController/);
  assert.match(helper, /take_provider_rate_limit_token_v1/);
  assert.match(helper, /error\.message\.match\(\//);
  assert.match(helper, /begin_video_date_worker_run_v1/);
  assert.match(helper, /refresh_video_date_provider_outbox_claim_v1/);
  assert.match(helper, /refresh_video_session_deadline_claim_v1/);
  assert.match(helper, /video_date_provider_outbox_failure_log/);
  assert.match(helper, /video_date_provider_dead_letters/);
  assert.match(helper, /Sentry\.captureException/);
  assert.match(helper, /SECRET_KEY_PATTERN/);
});

test("Phase 1 outbox and deadline workers use mutexes, row lease refresh, failure logs, and no raw provider fetch", () => {
  for (const source of [outboxDrainer, deadlineFinalizer]) {
    assert.match(source, /beginWorkerRun/);
    assert.match(source, /createWorkerRunRefresher/);
    assert.match(source, /finishWorkerRun/);
    assert.match(source, /createClaimLeaseRefresher/);
    assert.match(source, /logVideoDateProviderFailure/);
    assert.match(source, /deadLetterVideoDateProviderFailure/);
    assert.match(source, /captureVideoDateProviderException/);
    assert.doesNotMatch(source, /(?<!WithTimeout)fetch\(/);
  }

  assert.match(outboxDrainer, /enforceProviderRateLimit\(supabase, providerRateLimitConfig\("daily", "room_create"\)\)/);
  assert.match(outboxDrainer, /fetchWithTimeout\(`\$\{DAILY_API_URL\}\/rooms`/);
  assert.match(outboxDrainer, /completion\.state === "failed" && completion\.permanent/);
  assert.match(deadlineFinalizer, /completion\.state === "failed" && completion\.permanent/);
  assert.match(outboxDrainer, /isDailyRoomUrlForName\(session\.daily_room_url, roomName, DAILY_DOMAIN\)/);
  assert.match(outboxDrainer, /body\.name !== roomName/);
  assert.match(outboxDrainer, /isDailyRoomUrlForName\(body\.url, roomName, DAILY_DOMAIN\)/);
  assert.match(outboxDrainer, /body\.config\?\.max_participants !== 2/);
  assert.match(outboxDrainer, /result\.success \|\| result\.permanent === true \? null : result\.retryAfterSeconds/);
  assert.match(outboxDrainer, /daily_create_failed:invalid_room_response/);
  assert.match(outboxDrainer, /providerFailureRetryAfter/);
  assert.match(deadlineFinalizer, /finalize_video_session_deadline_v2/);
});

test("Phase 1 Daily and OneSignal provider calls are timeout and rate-limit guarded", () => {
  for (const source of [dailyRoom, tokenRefresh, sendNotification]) {
    assert.match(source, /fetchWithTimeout/);
    assert.doesNotMatch(source, /(?<!WithTimeout)fetch\(/);
  }

  assert.match(dailyRoom, /DAILY_VIDEO_DATE_SOLO_PREJOIN_TOKEN_TTL_SECONDS = 180/);
  assert.match(dailyRoom, /providerRateLimitConfig\("daily", bucket\)/);
  assert.match(dailyRoom, /providerFetchTimeoutMs\("daily", operation\)/);
  assert.match(dailyRoom, /room\.name !== roomName/);
  assert.match(dailyRoom, /isDailyRoomUrlForName\(room\.url, roomName, DAILY_DOMAIN\)/);
  assert.match(dailyRoom, /room\.config\?\.max_participants !== expectedMaxParticipants/);
  assert.match(dailyRoom, /dailyRoomExpiresAt = providerRoom\.expiresAt/);
  assert.match(tokenRefresh, /take_video_date_token_refresh_rate_limit_v1/);
  assert.match(tokenRefresh, /ProviderRateLimitError/);
  assert.match(tokenRefresh, /error: tokenError\.clientError/);
  assert.match(tokenRefresh, /retry_after_seconds: tokenError\.retryAfterSeconds/);
  assert.match(sendNotification, /providerRateLimitConfig\('onesignal', 'notification_create'\)/);
  assert.match(sendNotification, /providerFetchTimeoutMs\('onesignal', 'notification_create'\)/);
});

test("Phase 1 event-log hardening explicitly protects internal and safety rows", () => {
  assert.match(migration, /Staff can read internal video session events/);
  assert.match(migration, /visibility IN \('internal', 'safety_review'\)/);
  assert.match(migration, /Video session internal events require staff/);
  assert.match(migration, /AS RESTRICTIVE/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.broadcast_video_session_event_v2\(\)/);
  assert.match(migration, /IF TG_OP <> 'INSERT' OR NEW\.visibility IS DISTINCT FROM 'participants' THEN/);
  assert.match(migration, /video_date_broadcast_batched_v2_enabled\(\)/);
  assert.match(migration, /NEW\.sanitized_payload/);
  assert.doesNotMatch(migration, /NEW\.payload/);
});

test("Phase 1 reliability contracts are included in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDatePhase1ProviderReliabilityContracts\.test\.ts/);
});
