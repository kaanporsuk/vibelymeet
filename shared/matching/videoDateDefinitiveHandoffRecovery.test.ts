import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isVideoDateDailyMeetingEnded,
  isVideoDateTokenRefreshRateLimited,
  isVideoDateTokenRefreshTerminal,
  videoDateTokenRefreshRetryAfterMs,
} from "./videoDatePublicApi";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260603215948_video_date_definitive_ready_gate_handoff_recovery.sql"),
  "utf8",
);
const webVideoCallHook = readFileSync(join(process.cwd(), "src/hooks/useVideoCall.ts"), "utf8");
const webVideoDatePage = readFileSync(join(process.cwd(), "src/pages/VideoDate.tsx"), "utf8");
const nativeVideoDateRoute = readFileSync(join(process.cwd(), "apps/mobile/app/date/[id].tsx"), "utf8");

test("Daily token refresh failures are classified before retrying or rejoining", () => {
  assert.equal(isVideoDateDailyMeetingEnded({ errorMsg: "Meeting has ended" }), true);
  assert.equal(isVideoDateDailyMeetingEnded({ message: "Daily token expired" }), false);

  assert.equal(
    isVideoDateTokenRefreshTerminal({
      ok: false,
      error: "session_not_active",
      retryable: true,
      phase: "ended",
    }),
    true,
  );
  assert.equal(
    isVideoDateTokenRefreshTerminal({
      ok: false,
      error: "temporary_provider_error",
      retryable: true,
    }),
    false,
  );

  const rateLimited = {
    ok: false as const,
    error: "provider_rate_limited",
    retryAfterSeconds: 30,
  };
  assert.equal(isVideoDateTokenRefreshRateLimited(rateLimited), true);
  assert.equal(videoDateTokenRefreshRetryAfterMs(rateLimited), 30_000);
  assert.equal(
    videoDateTokenRefreshRetryAfterMs({
      ok: false,
      error: "provider_rate_limited",
      retryAfterSeconds: 0.2,
    }),
    1_000,
  );
});

test("backend restores canonical Daily room metadata before webhook and handshake finalizer decisions", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.video_date_uuid_from_daily_room_name_v1/);
  assert.equal((migration.match(/SET search_path TO ''/g) ?? []).length, 4);
  assert.match(migration, /substring\(lower\(btrim\(COALESCE\(p_room_name, ''\)\)\) from '\^date-\(\[0-9a-f\]\{32\}\)\$'\)/);
  assert.match(migration, /v_expected_room_name text := 'date-' \|\| replace\(p_session_id::text, '-', ''\)/);
  assert.match(migration, /COALESCE\(v_domain, 'vibelyapp\.daily\.co'\)/);
  assert.match(migration, /daily_room_name = v_expected_room_name/);
  assert.match(migration, /daily_room_url = v_url/);
  assert.match(migration, /v_restored := FOUND/);
  assert.match(migration, /'restored', v_restored/);

  assert.match(migration, /ALTER FUNCTION public\.record_video_date_daily_webhook_event_v2\(/);
  assert.match(migration, /daily_webhook_room_name_restore/);
  assert.match(migration, /record_video_date_daily_webhook_event_v2_20260603215948_handoff_base/);

  assert.match(migration, /ALTER FUNCTION public\.finalize_video_date_handshake_deadline\(uuid, uuid, text, text\)/);
  assert.match(migration, /handshake_deadline_preflight/);
  assert.match(migration, /participant_1_joined_at IS NOT NULL[\s\S]*participant_2_joined_at IS NOT NULL/);
  assert.match(migration, /v_has_explicit_pass :=/);
  assert.match(migration, /NOT v_has_explicit_pass[\s\S]*NOT v_both_decided/);
  assert.match(migration, /handshake_started_at = LEAST\(v_now, v_latest_launch_evidence_at\)/);
  assert.match(migration, /handshake_deadline_extended_for_launch_evidence/);
  assert.match(migration, /'reason', 'handshake_launch_evidence_extension'/);
});

test("web and native stop state cycling on terminal refresh, rate limits, and missing-peer watchdogs", () => {
  for (const source of [webVideoCallHook, nativeVideoDateRoute]) {
    assert.match(source, /isVideoDateDailyMeetingEnded/);
    assert.match(source, /isVideoDateTokenRefreshTerminal/);
    assert.match(source, /isVideoDateTokenRefreshRateLimited/);
    assert.match(source, /videoDateTokenRefreshRetryAfterMs/);
    assert.match(source, /daily_meeting_ended_truth_refetch/);
    assert.match(source, /daily_token_refresh_terminal_before_join/);
    assert.match(source, /daily_token_refresh_rate_limited_before_join/);
    assert.match(source, /daily_token_refresh_rate_limited/);
    assert.match(source, /peerMissingTruthRefreshCountRef\.current \+= 1/);
    assert.match(source, /daily_no_remote_watchdog_truth_refetched/);
    assert.doesNotMatch(source, /no_remote_auto_recovery/);
    assert.doesNotMatch(source, /VIDEO_DATE_NO_REMOTE_RECOVERY_ATTEMPT/);
  }

  assert.match(webVideoCallHook, /fetchVideoDateTruth\(sessionId\)\.then/);
  assert.match(webVideoCallHook, /cleanupCallObject\("daily_token_refresh", "daily_token_refresh_terminal"\)/);
  assert.match(webVideoCallHook, /cleanupCallObject\("daily_error", "daily_meeting_ended_event"\)/);
  assert.match(webVideoDatePage, /VIDEO_DATE_PEER_MISSING_RETRY_TAP/);
  assert.doesNotMatch(webVideoDatePage, /VIDEO_DATE_NO_REMOTE_RECOVERY_ATTEMPT/);
  assert.match(nativeVideoDateRoute, /cleanupTerminalDailyCall\(call, 'daily_token_refresh_terminal'\)/);
  assert.match(nativeVideoDateRoute, /cleanupTerminalDailyCall\(call, 'daily_meeting_ended_event'\)/);
  assert.match(nativeVideoDateRoute, /refetchVideoSession\(\)[\s\S]*daily_no_remote_watchdog_truth_refetched/);
  assert.doesNotMatch(
    webVideoCallHook,
    /cleanupCallObject\("startCall", "no_remote_auto_recovery"\)[\s\S]*startCall\(sessionId/,
  );
  assert.doesNotMatch(
    nativeVideoDateRoute,
    /destroyNativeVideoDateDailyCall\(call, 'no_remote_auto_recovery'[\s\S]*setJoinAttemptNonce/,
  );
});
