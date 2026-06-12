import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readWebVideoCallFlowSource } from "../testUtils/webVideoDateFlowSources";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260608224048_review_comments_1242_1256_followups.sql",
);
const activeOwnerMigration = read(
  "supabase/migrations/20260608171837_video_date_active_owner_terminal_truth.sql",
);
const invariantSql = read("docs/sql/video-date-invariants.sql");
const webSurvey = read("src/components/video-date/PostDateSurvey.tsx");
const nativeSurvey = read("apps/mobile/components/video-date/PostDateSurvey.tsx");
const nativeReadyOverlay = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
const nativeReadyRoute = read("apps/mobile/app/ready/[id].tsx");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const webVideoCall = readWebVideoCallFlowSource(root);
const packageJson = read("package.json");

function blockBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `missing end marker after ${start}: ${end}`);
  return source.slice(startIndex, endIndex);
}

function functionBody(source: string, name: string): string {
  const start = source.search(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\s*\\(`),
  );
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = source.indexOf("$function$;", start);
  assert.notEqual(end, -1, `missing function terminator for ${name}`);
  return source.slice(start, end);
}

test("certification exceptions suppress every missing-feedback warning row", () => {
  const pendingWarning = blockBetween(
    invariantSql,
    "'survey_pending_feedback_held_in_survey'::text",
    "'stale_survey_pending_feedback_blocks_certification'::text",
  );
  assert.match(pendingWarning, /FROM public\.video_date_certification_feedback_exceptions ex/);
  assert.match(pendingWarning, /ex\.session_id = sr\.session_id/);
  assert.match(pendingWarning, /ex\.missing_user_id = sr\.user_id/);
  assert.match(pendingWarning, /ex\.revoked_at IS NULL/);

  const staleWarning = blockBetween(
    invariantSql,
    "'stale_survey_pending_feedback_blocks_certification'::text",
    "'provider_join_webhook_evidence_present_for_recent_joined_sessions'::text",
  );
  assert.match(staleWarning, /FROM public\.video_date_certification_feedback_exceptions ex/);
});

test("zero-feedback reminders stay scoped to the current survey room", () => {
  const syncBody = functionBody(migration, "sync_post_date_zero_feedback_reminders_v1");
  assert.match(syncBody, /er\.current_room_id = vs\.id/);
  assert.match(
    syncBody,
    /JOIN public\.event_registrations er[\s\S]+er\.profile_id = vs\.participant_1_id[\s\S]+er\.current_room_id = vs\.id/,
  );
  assert.match(
    syncBody,
    /JOIN public\.event_registrations er[\s\S]+er\.profile_id = vs\.participant_2_id[\s\S]+er\.current_room_id = vs\.id/,
  );
  assert.match(syncBody, /zr\.completed_at IS NULL[\s\S]+er\.current_room_id = vs\.id/);
});

test("retryable eligibility failures cannot terminalize Ready Gate", () => {
  const actionability = functionBody(migration, "video_date_ready_gate_actionability_v1");
  assert.match(actionability, /v_invalid_retryable :=/);
  assert.match(actionability, /v_invalid_terminal :=/);
  assert.match(actionability, /IF p_terminalize_invalid AND NOT v_invalid_retryable AND v_invalid_terminal THEN/);
  assert.match(actionability, /'retryable', v_invalid_retryable/);
  assert.match(actionability, /'terminal', NOT v_invalid_retryable AND v_invalid_terminal/);
  assert.match(actionability, /'eligibility_code', v_invalid_code/);
});

test("remote-seen stamps require current owner and call heartbeat proof", () => {
  const remoteSeen = functionBody(migration, "mark_video_date_remote_seen");
  assert.match(remoteSeen, /FROM public\.video_date_presence_events vpe/);
  assert.match(remoteSeen, /vpe\.event_type = 'client_daily_alive'/);
  assert.match(remoteSeen, /v_owner_call_current :=/);
  assert.match(remoteSeen, /v_latest_alive_owner_id = v_owner_id/);
  assert.match(remoteSeen, /v_latest_alive_call_instance_id = v_call_instance_id/);
  assert.match(remoteSeen, /v_latest_alive_provider_session_id = v_provider_session_id/);
  assert.match(remoteSeen, /v_latest_alive_at >= now\(\) - interval '15 seconds'/);
  assert.match(remoteSeen, /v_owner_call_current := COALESCE\(/);
  assert.match(remoteSeen, /v_provider_backed_current := COALESCE\(/);
  assert.match(remoteSeen, /IF v_provider_backed_current IS NOT TRUE THEN/);
  assert.match(remoteSeen, /'owner_call_presence_required', true/);
  assert.match(remoteSeen, /REMOTE_SEEN_CALL_INSTANCE_MISSING/);
  assert.match(remoteSeen, /REMOTE_SEEN_OWNER_HEARTBEAT_STALE/);
});

test("active-owner migration replay keeps DO block syntax closed", () => {
  assert.match(
    activeOwnerMigration,
    /RENAME TO vd_daily_webhook_terminal_truth_base;\n\s+END IF;\nEND;\n\$\$;/,
  );
});

test("mark-ready safety failures strip nested auxiliary diagnostics", () => {
  const markReady = functionBody(migration, "video_session_mark_ready_v2");
  assert.match(markReady, /SAFETY_CHECK_UNAVAILABLE/);
  assert.match(markReady, /- 'auxiliary_errors'/);
  assert.match(markReady, /- 'sqlstate'/);
  assert.match(markReady, /- 'message'/);
});

test("post-date surveys removed stale pending-feedback queue-drain handling", () => {
  for (const [name, source] of [
    ["web survey", webSurvey],
    ["native survey", nativeSurvey],
  ] as const) {
    assert.doesNotMatch(source, /stale_pending_post_date_feedback|pending_post_date_feedback/, name);
    assert.doesNotMatch(source, /drainMatchQueue|getQueuedMatchCount|onQueuedVideoSessionReady/, name);
    assert.match(source, /verdictUiState === ["']submitting["']/, name);
    assert.match(source, /verdictUiState === ["']confirmed["']/, name);
    assert.match(source, /awaiting_partner/, name);
    assert.match(source, /finishSurveyInFlightRef\.current/, name);
  }
});

test("native prepare-entry terminal failures do not create date-route ownership", () => {
  assert.match(nativeReadyOverlay, /isReadyGatePrepareEntryNonRetryable\(recoveryInput\)/);
  assert.match(nativeReadyOverlay, /setPrepareEntryStatus\('failed'\)/);
  assert.match(nativeReadyOverlay, /READY_GATE_STALE_OR_ENDED_USER_MESSAGE/);
  assert.match(nativeReadyOverlay, /navigateWithLatency\(`\$\{source\}_prepare_failed_date_owned`\)/);

  assert.match(nativeReadyRoute, /isReadyGatePrepareEntryNonRetryable\(prepareRecoveryInput\)/);
  assert.match(nativeReadyRoute, /clearDateEntryTransition\(sid\)/);
  assert.match(nativeReadyRoute, /setTerminalActionError\(recovery\.body\)/);

  assert.doesNotMatch(nativeLobby, /isReadyGatePrepareEntryNonRetryable/);
  assert.doesNotMatch(nativeLobby, /prepareVideoDateEntry/);
  assert.match(nativeLobby, /ensureVideoDateStartableBeforeNavigation/);
});

test("web parked Daily singleton transfers stale heartbeat cleanup on consume", () => {
  assert.match(webVideoCall, /stopHeartbeat\?: \(reason: string\) => void/);
  assert.match(webVideoCall, /stopHeartbeat: clearDailyAliveHeartbeatTimer/);
  assert.match(webVideoCall, /entry\.stopHeartbeat\?\.\("daily_call_singleton_consumed"\)/);
  assert.match(webVideoCall, /heartbeatTransferred: Boolean\(entry\.stopHeartbeat\)/);
});

test("review comments 1242-1256 follow-up stays in Video Date suites", () => {
  assert.match(packageJson, /reviewComments1242_1256Followups\.test\.ts/);
});
