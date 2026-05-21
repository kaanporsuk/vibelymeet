import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260521234500_video_date_phase3_remaining_transition_rpcs.sql"),
  "utf8",
);
const replayMigration = readFileSync(
  join(root, "supabase/migrations/20260522011500_video_date_phase3_replay_and_safety_errors.sql"),
  "utf8",
);
const transitionCommands = readFileSync(
  join(root, "shared/matching/videoDateTransitionCommands.ts"),
  "utf8",
);
const webVideoDate = readFileSync(join(root, "src/pages/VideoDate.tsx"), "utf8");
const webSurvey = readFileSync(join(root, "src/components/video-date/PostDateSurvey.tsx"), "utf8");
const webPostDateOutbox = readFileSync(join(root, "src/lib/postDateOutbox/execute.ts"), "utf8");
const nativeVideoDateApi = readFileSync(join(root, "apps/mobile/lib/videoDateApi.ts"), "utf8");
const nativeVideoDateScreen = readFileSync(join(root, "apps/mobile/app/date/[id].tsx"), "utf8");
const nativePostDateOutbox = readFileSync(join(root, "apps/mobile/lib/postDateOutbox/execute.ts"), "utf8");
const postDateVerdictEdge = readFileSync(join(root, "supabase/functions/post-date-verdict/index.ts"), "utf8");
const outboxTypes = readFileSync(join(root, "shared/postDateOutbox/types.ts"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

function functionBody(name: string): string {
  const match = migration.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]+?COMMENT ON FUNCTION public\\.${name}`,
    ),
  );
  assert.ok(match, `missing ${name} function block`);
  return match[0];
}

test("PR 3.4-3.7 RPCs exist, use v4 commands, and remain Daily-token free", () => {
  for (const fn of [
    "video_session_handshake_auto_promote_v2",
    "video_session_date_timeout_v2",
    "submit_post_date_verdict_v3",
    "video_session_extend_date_v2",
  ]) {
    assert.match(migration, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}`));
    assert.match(migration, new RegExp(`COMMENT ON FUNCTION public\\.${fn}`));
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}`));
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]+TO authenticated, service_role`));
  }

  assert.match(migration, /public\.video_session_command_begin_v2\(/);
  assert.match(migration, /public\.video_session_command_finish_v2\(/);
  assert.match(migration, /'status' IN \('replay', 'replay_rejected'\)/);
  assert.match(migration, /'error', 'command_in_progress'/);
  assert.match(migration, /'requestHash', v_begin->>'requestHash'/);
  assert.match(migration, /'commandStatus', CASE WHEN v_success THEN 'committed' ELSE 'rejected' END/);
  assert.doesNotMatch(migration, /meeting[_-]?token|daily_token|DAILY_API_KEY|createMeetingToken/i);
});

test("deadline wrappers avoid poisoning idempotency before server deadlines are due", () => {
  const handshake = functionBody("video_session_handshake_auto_promote_v2");
  const timeout = functionBody("video_session_date_timeout_v2");

  assert.match(handshake, /'reason', 'handshake_auto_promote_not_due'/);
  assert.match(handshake, /v_seconds_remaining > 0[\s\S]+RETURN jsonb_build_object[\s\S]+handshake_auto_promote_not_due/);
  assert.match(handshake, /public\.finalize_video_date_handshake_deadline\(/);
  assert.ok(
    handshake.indexOf("handshake_auto_promote_not_due") < handshake.indexOf("public.video_session_command_begin_v2("),
    "handshake not-due return must occur before command insert",
  );
  assert.match(
    handshake,
    /FOR UPDATE;[\s\S]+'reason', 'handshake_auto_promote_not_due'[\s\S]+v_begin := public\.video_session_command_begin_v2\(/,
  );

  assert.match(timeout, /'reason', 'date_timeout_not_due'/);
  assert.match(timeout, /v_seconds_remaining > 0[\s\S]+RETURN jsonb_build_object[\s\S]+date_timeout_not_due/);
  assert.match(timeout, /public\.video_date_transition\(p_session_id, 'end', 'date_timeout'\)/);
  assert.ok(
    timeout.indexOf("date_timeout_not_due") < timeout.indexOf("public.video_session_command_begin_v2("),
    "date timeout not-due return must occur before command insert",
  );
  assert.match(
    timeout,
    /FOR UPDATE;[\s\S]+'reason', 'date_timeout_not_due'[\s\S]+v_begin := public\.video_session_command_begin_v2\(/,
  );
});

test("remaining Phase 3 events are visibility-safe and sequence-aware", () => {
  assert.match(migration, /'handshake_auto_promoted_to_date'/);
  assert.match(migration, /'handshake_auto_promoted_terminal'/);
  assert.match(migration, /'date_timeout_ended'/);
  assert.match(migration, /'post_date_verdict_recorded'/);
  assert.match(migration, /'post_date_verdict_resolved'/);
  assert.match(migration, /'post_date_safety_report_recorded'/);
  assert.match(migration, /'date_extension_applied'/);
  assert.match(migration, /'participants'/);
  assert.match(migration, /'actor_only'/);
  assert.match(migration, /'safety_review'/);
  assert.match(migration, /v_visibility = 'participants'/);
  assert.match(migration, /public\.video_date_outbox_enqueue_v2\(/);
  assert.match(migration, /'daily\.delete_video_date_room'/);
});

test("verdict v3 hashes safety details for command idempotency and never makes report reasons participant-visible", () => {
  const verdict = functionBody("submit_post_date_verdict_v3");
  const requestBlock = verdict.match(/v_request := jsonb_build_object\([\s\S]+?\);/);
  assert.ok(requestBlock, "missing v3 verdict request block");

  assert.match(requestBlock[0], /'has_safety_report'/);
  assert.match(requestBlock[0], /'safety_report_hash'/);
  assert.doesNotMatch(requestBlock[0], /'safety_report',\s*p_safety_report/);
  assert.match(verdict, /COALESCE\(v_result, '\{\}'::jsonb\) - 'block'/);
  assert.match(verdict, /'post_date_safety_report_recorded'[\s\S]+'safety_review'/);
  assert.match(verdict, /v_visibility text := 'actor_only'[\s\S]+v_kind text := 'post_date_verdict_recorded'/);
  assert.match(verdict, /v_visibility := 'participants'[\s\S]+v_kind := 'post_date_verdict_resolved'/);
  assert.doesNotMatch(verdict, /'reason',\s*v_report_reason|'details',\s*v_report_details/);
});

test("extension v2 refuses charge when known Daily room expiry cannot cover max session budget", () => {
  const extension = functionBody("video_session_extend_date_v2");
  assert.match(extension, /v_key := NULLIF\(btrim\(COALESCE\(p_idempotency_key, ''\)\), ''\)/);
  assert.match(extension, /IF v_key IS NULL THEN[\s\S]+'error', 'invalid_idempotency_key'/);
  assert.doesNotMatch(extension, /p_session_id::text \|\| ':phase3:extension:'/);
  assert.match(extension, /v_required_until :=[\s\S]+300 \+ COALESCE\(v_before\.date_extra_seconds, 0\) \+ v_add_seconds \+ 120 \+ 600/);
  assert.match(extension, /v_before\.daily_room_expires_at IS NULL OR v_before\.daily_room_expires_at <= v_required_until/);
  assert.match(extension, /'error', 'daily_room_expiring_before_extension'/);
  assert.ok(
    extension.indexOf("v_begin := public.video_session_command_begin_v2(") <
      extension.indexOf("v_required_until :="),
    "extension idempotent replay must be checked before mutable room-expiry guard",
  );
  assert.match(extension, /daily_room_expiring_before_extension[\s\S]+public\.video_session_command_finish_v2\(v_command_id, v_actor, 'rejected', v_result\)/);
  assert.match(extension, /public\.spend_video_date_credit_extension\(/);
  assert.match(extension, /'date_extension_applied'/);
  assert.match(replayMigration, /ALTER FUNCTION public\.video_session_extend_date_v2\(uuid, text, text, text\)[\s\S]+RENAME TO video_session_extend_date_v2_20260522011000_replay_base/);
  assert.match(replayMigration, /FROM public\.video_session_commands[\s\S]+idempotency_key = v_key[\s\S]+FOR UPDATE/);
  assert.match(replayMigration, /v_command\.status IN \('committed', 'rejected'\)/);
  assert.match(replayMigration, /video_session_extend_date_v2_20260522011000_replay_base/);
});

test("web and native route PR 3.4-3.7 behind default-off feature flags", () => {
  assert.match(transitionCommands, /VideoDatePhase3DeadlineAction = "handshake_auto_promote" \| "date_timeout"/);
  assert.match(transitionCommands, /buildVideoDateExtensionIdempotencyKey/);
  assert.match(transitionCommands, /clientRequestId: string/);
  assert.match(transitionCommands, /`phase3:extension:\$\{creditType\}:\$\{clientRequestId\}`/);

  assert.match(webVideoDate, /useFeatureFlag\("video_date\.outbox_v2\.handshake_auto_promote"\)/);
  assert.match(webVideoDate, /useFeatureFlag\("video_date\.outbox_v2\.date_timeout"\)/);
  assert.match(webVideoDate, /useFeatureFlag\("video_date\.outbox_v2\.extension"\)/);
  assert.match(webVideoDate, /video_session_handshake_auto_promote_v2/);
  assert.match(webVideoDate, /video_session_date_timeout_v2/);
  assert.match(webVideoDate, /video_session_extend_date_v2/);
  assert.match(webVideoDate, /handleCallEndRef\.current\?\.\("date_timeout"\)/);

  assert.match(nativeVideoDateApi, /handshakeAutoPromoteV2\?: boolean/);
  assert.match(nativeVideoDateApi, /dateTimeoutV2\?: boolean/);
  assert.match(nativeVideoDateApi, /submitVerdictV3\?: boolean/);
  assert.match(nativeVideoDateApi, /extensionV2\?: boolean/);
  assert.match(nativeVideoDateApi, /video_session_handshake_auto_promote_v2/);
  assert.match(nativeVideoDateApi, /video_session_date_timeout_v2/);
  assert.match(nativeVideoDateApi, /video_session_extend_date_v2/);
  assert.match(nativeVideoDateScreen, /useFeatureFlag\('video_date\.outbox_v2\.handshake_auto_promote'\)/);
  assert.match(nativeVideoDateScreen, /useFeatureFlag\('video_date\.outbox_v2\.date_timeout'\)/);
  assert.match(nativeVideoDateScreen, /useFeatureFlag\('video_date\.outbox_v2\.submit_verdict'\)/);
  assert.match(nativeVideoDateScreen, /useFeatureFlag\('video_date\.outbox_v2\.extension'\)/);
  assert.match(nativeVideoDateScreen, /handleCallEnd\('local_end', 'date_timeout'\)/);
});

test("date-timeout v2 only opens terminal UX after backend confirms the session ended", () => {
  assert.match(webVideoDate, /const useDateTimeoutV2 = reason === "date_timeout" && dateTimeoutV2\.enabled/);
  assert.match(webVideoDate, /action: useDateTimeoutV2 \? "phase3:date_timeout" : "end"/);
  assert.match(webVideoDate, /video_session_date_timeout_v2[\s\S]+p_idempotency_key: idempotencyKey/);
  assert.match(
    webVideoDate,
    /payload\?\.already_ended === true \|\| payload\?\.state === "ended" \|\| payload\?\.phase === "ended"/,
  );
  assert.match(
    webVideoDate,
    /if \(reason === "date_timeout"\) \{\s+countdownCompletionKeyRef\.current = null;\s+setTimingRefreshNonce\(\(n\) => n \+ 1\);\s+explicitEndRequestedRef\.current = "idle";\s+return;\s+\}/,
  );
  assert.match(webVideoDate, /if \(reason !== "date_timeout"\) \{\s+emitConfirmedEndedAnalytics\(\);\s+\}/);
  assert.match(
    webVideoDate,
    /if \(reason === "date_timeout"\) \{\s+toast\("Time flies! Thanks for a great date[\s\S]+emitConfirmedEndedAnalytics\(\);\s+\}/,
  );
  assert.doesNotMatch(
    webVideoDate,
    /toast\("Time flies! Thanks for a great date[\s\S]{0,160}handleCallEndRef\.current\?\.\("date_timeout"\)/,
  );

  assert.match(nativeVideoDateApi, /const useDateTimeoutV2 = reason === 'date_timeout' && options\?\.dateTimeoutV2 === true/);
  assert.match(nativeVideoDateApi, /action: useDateTimeoutV2 \? 'phase3:date_timeout' : 'end'/);
  assert.match(nativeVideoDateApi, /video_session_date_timeout_v2[\s\S]+p_idempotency_key: idempotencyKey/);
  assert.match(
    nativeVideoDateApi,
    /payload\?\.already_ended === true \|\| payload\?\.state === 'ended' \|\| payload\?\.phase === 'ended'/,
  );
  assert.match(
    nativeVideoDateScreen,
    /if \(reason === 'date_timeout'\) \{\s+videoDateEndedRef\.current = false;\s+countdownCompletionKeyRef\.current = null;\s+setShowFeedback\(false\);\s+await refetchVideoSession\(\);\s+return;\s+\}/,
  );
  assert.match(nativeVideoDateScreen, /if \(reason !== 'date_timeout'\) \{\s+emitConfirmedEndedAnalytics\(\);\s+\}/);
  assert.match(nativeVideoDateScreen, /if \(reason === 'date_timeout'\) \{\s+emitConfirmedEndedAnalytics\(\);\s+\}/);

  const nativeDateTimeoutRecoveryIndex = nativeVideoDateScreen.indexOf("if (reason === 'date_timeout') {");
  const nativeManualEndAlertIndex = nativeVideoDateScreen.indexOf("Could not end date yet", nativeDateTimeoutRecoveryIndex);
  assert.ok(nativeDateTimeoutRecoveryIndex > -1, "missing native automatic date-timeout recovery branch");
  assert.ok(
    nativeManualEndAlertIndex === -1 || nativeDateTimeoutRecoveryIndex < nativeManualEndAlertIndex,
    "native automatic timeout recovery must run before manual-end cleanup/alert UX",
  );
});

test("post-date outbox can opt into verdict v3 without changing report-only safety path", () => {
  assert.match(outboxTypes, /backendVersion\?: "v2" \| "v3"/);
  assert.match(webSurvey, /useFeatureFlag\("video_date\.outbox_v2\.submit_verdict"\)/);
  assert.match(webSurvey, /backendVersion: submitVerdictV3\.enabled \? "v3" : "v2"/);
  assert.match(webPostDateOutbox, /transition_version: item\.payload\.backendVersion \?\? "v2"/);
  assert.match(nativePostDateOutbox, /transition_version: item\.payload\.backendVersion \?\? 'v2'/);
  assert.match(nativeVideoDateScreen, /submitVerdictV3: submitVerdictV3\.enabled/);
  assert.match(postDateVerdictEdge, /transition_version\?: "v2" \| "v3"/);
  assert.match(postDateVerdictEdge, /body\?\.transition_version === "v3"[\s\S]+submit_post_date_verdict_v3/);
  assert.match(postDateVerdictEdge, /action === "report"[\s\S]+submit_post_date_safety_report_v1/);
});

test("remaining Phase 3 contracts are included in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDatePhase3RemainingContracts\.test\.ts/);
});
