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
const handshakeDeadlineFinalizerMigration = readFileSync(
  join(root, "supabase/migrations/20260503090000_video_date_encounter_survey_and_pair_guard.sql"),
  "utf8",
);
const earlyConfirmedEncounterPromotionMigration = readFileSync(
  join(root, "supabase/migrations/20260605115657_video_date_early_confirmed_encounter_promotion.sql"),
  "utf8",
);
const surveyContinuityMigration = readFileSync(
  join(root, "supabase/migrations/20260503110000_video_date_survey_continuity_cleanup.sql"),
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

function migrationFunctionBody(source: string, name: string): string {
  const match =
    source.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]+?COMMENT ON FUNCTION public\\.${name}`)) ??
    source.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}[\\s\\S]+?REVOKE ALL ON FUNCTION public\\.${name}`));
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

test("confirmed encounter promotion bypasses client deadline not-due wrappers", () => {
  assert.match(earlyConfirmedEncounterPromotionMigration, /CREATE OR REPLACE FUNCTION public\.video_date_promote_confirmed_encounter_v1/);
  assert.match(earlyConfirmedEncounterPromotionMigration, /public\.video_date_session_has_confirmed_encounter/);
  assert.match(earlyConfirmedEncounterPromotionMigration, /confirmed_encounter_promoted_to_date/);
  assert.match(earlyConfirmedEncounterPromotionMigration, /public\.video_date_promote_confirmed_encounter_v1\([\s\S]+p_session_id[\s\S]+v_actor[\s\S]+'video_session_handshake_auto_promote_v2'[\s\S]+true/);
  assert.ok(
    earlyConfirmedEncounterPromotionMigration.indexOf("video_date_promote_confirmed_encounter_v1(") <
      earlyConfirmedEncounterPromotionMigration.indexOf("vs_handshake_auto_promote_20260605115657_base("),
    "auto-promote wrapper must test confirmed media before delegating to not-due/deadline idempotency",
  );
});

test("deadline transition helpers stay atomic under the v2 wrappers", () => {
  const handshake = functionBody("video_session_handshake_auto_promote_v2");
  const timeout = functionBody("video_session_date_timeout_v2");
  const finalizer = migrationFunctionBody(handshakeDeadlineFinalizerMigration, "finalize_video_date_handshake_deadline");
  const dateTransition = migrationFunctionBody(surveyContinuityMigration, "video_date_transition");

  assert.match(handshake, /public\.finalize_video_date_handshake_deadline\(/);
  assert.match(timeout, /public\.video_date_transition\(p_session_id, 'end', 'date_timeout'\)/);
  assert.match(finalizer, /FROM public\.video_sessions[\s\S]+WHERE id = p_session_id[\s\S]+FOR UPDATE;/);
  assert.match(finalizer, /UPDATE public\.video_sessions[\s\S]+state = 'date'::public\.video_date_state[\s\S]+state_updated_at = v_now/);
  assert.match(finalizer, /UPDATE public\.video_sessions[\s\S]+state = 'ended'::public\.video_date_state[\s\S]+state_updated_at = v_now/);
  assert.ok(
    finalizer.indexOf("FOR UPDATE;") < finalizer.indexOf("UPDATE public.video_sessions"),
    "handshake finalizer must lock the session before any terminal/date mutation",
  );
  assert.match(dateTransition, /v_result := public\.video_date_transition_20260503110000_survey_continuity_base\(/);
  assert.ok(
    dateTransition.indexOf("video_date_transition_20260503110000_survey_continuity_base") <
      dateTransition.indexOf("UPDATE public.event_registrations"),
    "survey continuity wrapper must delegate the canonical state transition before registration side effects",
  );
  for (const source of [handshake, timeout, finalizer, dateTransition]) {
    assert.doesNotMatch(source, /\b(COMMIT|ROLLBACK|START TRANSACTION|BEGIN TRANSACTION)\b/i);
  }
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
  const postSpend = extension.slice(extension.indexOf("public.spend_video_date_credit_extension("));
  assert.doesNotMatch(
    postSpend,
    /daily\.|DAILY_API_KEY|createMeetingToken|meeting[_-]?token|provider[_-]?token|fetch\(/i,
    "extension v2 must not perform provider work after spending credits; provider failure after charge is impossible in this RPC",
  );
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

  assert.match(webVideoDate, /useFeatureFlag\(\s*["']video_date\.outbox_v2\.handshake_auto_promote["'],?\s*\)/);
  assert.match(webVideoDate, /useFeatureFlag\(\s*["']video_date\.outbox_v2\.date_timeout["'],?\s*\)/);
  assert.match(webVideoDate, /useFeatureFlag\(\s*["']video_date\.outbox_v2\.extension["'],?\s*\)/);
  assert.match(webVideoDate, /video_session_entry_auto_promote_v2/);
  assert.match(webVideoDate, /video_session_date_timeout_v2/);
  assert.match(webVideoDate, /video_session_extend_date_v2/);
  assert.match(webVideoDate, /handleCallEndRef\.current\?\.\("date_timeout"\)/);

  assert.match(nativeVideoDateApi, /handshakeAutoPromoteV2\?: boolean/);
  assert.match(nativeVideoDateApi, /dateTimeoutV2\?: boolean/);
  assert.match(nativeVideoDateApi, /extensionV2\?: boolean/);
  assert.match(nativeVideoDateApi, /video_session_entry_auto_promote_v2/);
  assert.match(nativeVideoDateApi, /video_session_date_timeout_v2/);
  assert.match(nativeVideoDateApi, /video_session_extend_date_v2/);
  assert.match(nativeVideoDateScreen, /useFeatureFlag\(\s*["']video_date\.outbox_v2\.handshake_auto_promote["'],?\s*\)/);
  assert.match(nativeVideoDateScreen, /useFeatureFlag\(\s*["']video_date\.outbox_v2\.date_timeout["'],?\s*\)/);
  assert.match(nativeVideoDateScreen, /useFeatureFlag\(\s*["']video_date\.outbox_v2\.extension["'],?\s*\)/);
  assert.match(nativeVideoDateScreen, /handleCallEnd\(["']local_end["'], ["']date_timeout["']\)/);
});

test("date-timeout v2 only opens terminal UX after backend confirms the session ended", () => {
  assert.match(webVideoDate, /const useDateTimeoutV2 =\s*reason === ["']date_timeout["'] && dateTimeoutV2\.enabled/);
  assert.match(webVideoDate, /action: useDateTimeoutV2 \? ["']phase3:date_timeout["'] : ["']end["']/);
  assert.match(webVideoDate, /video_session_date_timeout_v2[\s\S]+p_idempotency_key: idempotencyKey/);
  assert.match(
    webVideoDate,
    /payload\?\.already_ended === true \|\|[\s\S]*payload\?\.state === ["']ended["'] \|\|[\s\S]*payload\?\.phase === ["']ended["']/,
  );
  assert.match(
    webVideoDate,
    /if \(reason === ["']date_timeout["']\) \{\s+countdownCompletionKeyRef\.current = null;\s+setTimingRefreshNonce\(\(n\) => n \+ 1\);\s+explicitEndRequestedRef\.current = ["']idle["'];\s+return;\s+\}/,
  );
  assert.match(webVideoDate, /if \(reason !== ["']date_timeout["']\) \{\s+emitConfirmedEndedAnalytics\(\);\s+\}/);
  assert.match(
    webVideoDate,
    /if \(reason === ["']date_timeout["']\) \{\s+toast\(["']Time flies! Thanks for a great date[\s\S]+emitConfirmedEndedAnalytics\(\);\s+\}/,
  );
  assert.doesNotMatch(
    webVideoDate,
    /toast\(["']Time flies! Thanks for a great date[\s\S]{0,160}handleCallEndRef\.current\?\.\(["']date_timeout["']\)/,
  );

  assert.match(nativeVideoDateApi, /const useDateTimeoutV2 = reason === ['"]date_timeout['"] && options\?\.dateTimeoutV2 === true/);
  assert.match(nativeVideoDateApi, /action: useDateTimeoutV2 \? ['"]phase3:date_timeout['"] : ['"]end['"]/);
  assert.match(nativeVideoDateApi, /video_session_date_timeout_v2[\s\S]+p_idempotency_key: idempotencyKey/);
  assert.match(
    nativeVideoDateApi,
    /payload\?\.already_ended === true \|\| payload\?\.state === ['"]ended['"] \|\| payload\?\.phase === ['"]ended['"]/,
  );
  assert.match(
    nativeVideoDateScreen,
    /if \(reason === ['"]date_timeout['"]\) \{\s+videoDateEndedRef\.current = false;\s+countdownCompletionKeyRef\.current = null;\s+setShowFeedback\(false\);\s+await refetchVideoSession\(\);\s+return;\s+\}/,
  );
  assert.match(nativeVideoDateScreen, /if \(reason !== ['"]date_timeout['"]\) \{\s+emitConfirmedEndedAnalytics\(\);\s+\}/);
  assert.match(nativeVideoDateScreen, /if \(reason === ['"]date_timeout['"]\) \{\s+emitConfirmedEndedAnalytics\(\);\s+\}/);

  const nativeDateTimeoutRecoveryIndex = Math.max(
    nativeVideoDateScreen.indexOf("if (reason === 'date_timeout') {"),
    nativeVideoDateScreen.indexOf('if (reason === "date_timeout") {'),
  );
  const nativeManualEndAlertIndex = nativeVideoDateScreen.indexOf("Could not end date yet", nativeDateTimeoutRecoveryIndex);
  assert.ok(nativeDateTimeoutRecoveryIndex > -1, "missing native automatic date-timeout recovery branch");
  assert.ok(
    nativeManualEndAlertIndex === -1 || nativeDateTimeoutRecoveryIndex < nativeManualEndAlertIndex,
    "native automatic timeout recovery must run before manual-end cleanup/alert UX",
  );
});

test("post-date outbox is hard-coded to verdict v3 without changing report-only safety path", () => {
  // The flag-gated v2/v3 selection was collapsed 2026-06-10: clients always
  // send v3, and the Edge Function now rejects stale or keyless verdict callers.
  assert.doesNotMatch(outboxTypes, /backendVersion/);
  assert.doesNotMatch(webSurvey, /outbox_v2\.submit_verdict|backendVersion/);
  assert.match(webPostDateOutbox, /transition_version: "v3"/);
  assert.match(nativePostDateOutbox, /transition_version: ['"]v3['"]/);
  assert.doesNotMatch(nativeVideoDateScreen, /submitVerdictV3/);
  assert.match(postDateVerdictEdge, /unsupported_transition_version/);
  assert.match(postDateVerdictEdge, /missing_idempotency_key/);
  assert.doesNotMatch(postDateVerdictEdge, /deprecated_version_coerced_to_v3|verdict-legacy-keyless/);
  assert.match(postDateVerdictEdge, /submit_post_date_verdict_v3/);
  assert.doesNotMatch(postDateVerdictEdge, /submit_post_date_verdict_v2|"submit_post_date_verdict"/);
  assert.match(postDateVerdictEdge, /action === "report"[\s\S]+submit_post_date_safety_report_v1/);
});

test("remaining Phase 3 contracts are included in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDatePhase3RemainingContracts\.test\.ts/);
});
