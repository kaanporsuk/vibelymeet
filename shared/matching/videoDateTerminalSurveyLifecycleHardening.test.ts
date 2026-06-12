import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { readWebVideoCallFlowSource, readWebVideoDatePageFlowSource } from "../testUtils/webVideoDateFlowSources";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function functionBody(source: string, signature: RegExp): string {
  const signatureMatch = source.match(signature);
  assert.ok(signatureMatch?.index != null, `expected function signature ${signature}`);
  const tail = source.slice(signatureMatch.index);
  const bodyStart = tail.indexOf("AS $function$");
  assert.notEqual(bodyStart, -1, "expected plpgsql function body marker");
  const afterBodyStart = tail.slice(bodyStart);
  const bodyEnd = afterBodyStart.indexOf("$function$;");
  assert.notEqual(bodyEnd, -1, "expected plpgsql function body end");
  return afterBodyStart.slice(0, bodyEnd);
}

const migration = read("supabase/migrations/20260605135616_video_date_terminal_survey_lifecycle_hardening.sql");
const backfillMigration = read("supabase/migrations/20260605143637_video_date_terminal_room_metadata_backfill.sql");
const correctiveBackfillMigration = read(
  "supabase/migrations/20260605144003_video_date_terminal_room_metadata_corrective_backfill.sql",
);
const finalRepairMigration = read("supabase/migrations/20260605145926_video_date_terminal_room_metadata_final_repair.sql");
const historicalDeleteMarkerMigration = read(
  "supabase/migrations/20260605150130_video_date_terminal_room_metadata_historical_delete_marker.sql",
);
const pendingSurveyRegistrationRepairMigration = read(
  "supabase/migrations/20260605152058_video_date_pending_survey_registration_repair.sql",
);
const webDateRoute = readWebVideoDatePageFlowSource(root);
const webVideoCall = readWebVideoCallFlowSource(root);
const nativeDateRoute = read("apps/mobile/app/date/[id].tsx");
const observability = read("shared/observability/videoDateClientStuckObservability.ts");
const activeSession = read("shared/matching/activeSession.ts");
const packageJson = read("package.json");
const outboxDrainer = read("supabase/functions/video-date-outbox-drainer/index.ts");
const roomCleanup = read("supabase/functions/video-date-room-cleanup/index.ts");
const orphanCleanup = read("supabase/functions/video-date-orphan-room-cleanup/index.ts");

test("participant status cannot overwrite a pending post-date survey with offline", () => {
  const body = functionBody(migration, /CREATE OR REPLACE FUNCTION public\.update_participant_status/);

  assert.match(body, /v_has_pending_post_date_survey/);
  assert.match(body, /v_current_status = 'in_survey'/);
  assert.match(body, /v_status IN \('browsing', 'idle', 'offline'\)/);
  assert.match(body, /video_date_session_is_post_date_survey_eligible_v2/);
  assert.match(body, /date_feedback df/);
  assert.match(body, /df\.user_id = v_uid/);
  assert.doesNotMatch(body, /interval '30 seconds'/);
});

test("date-timeout terminal flow repairs and returns canonical Daily room metadata", () => {
  const body = functionBody(migration, /CREATE OR REPLACE FUNCTION public\.video_session_date_timeout_v2/);

  assert.match(body, /already_ended_room_repair/);
  assert.match(body, /locked_already_ended_room_repair/);
  assert.match(body, /replay_room_repair/);
  assert.match(body, /post_transition_room_repair/);
  assert.match(body, /daily_room_name/);
  assert.match(body, /daily_room_url/);
  assert.match(body, /v_delete_room_name := COALESCE\(NULLIF\(v_after\.daily_room_name, ''\), NULLIF\(v_before\.daily_room_name, ''\)\)/);
  assert.match(body, /append_video_session_event_v2[\s\S]*'daily_room_name'/);
});

test("terminal room metadata backfill is bounded to ended survey-eligible encounters", () => {
  for (const [name, source] of [
    ["helper", backfillMigration],
    ["corrective", correctiveBackfillMigration],
  ] as Array<[string, string]>) {
    assert.match(source, /video_date_session_is_post_date_survey_eligible_v2/, `${name} uses survey eligibility`);
    assert.match(source, /vs\.ended_at IS NOT NULL/, `${name} only targets ended sessions`);
    assert.match(source, /daily_room_name IS NULL/, `${name} repairs missing room names`);
    assert.match(source, /daily_room_url IS NULL/, `${name} repairs missing room URLs`);
    assert.match(source, /date-' \|\| replace\(vs\.id::text, '-', ''\)/, `${name} uses deterministic room names`);
  }

  assert.match(backfillMigration, /video_date_restore_canonical_room_metadata_v1/);
  assert.match(backfillMigration, /migration:20260605143637_terminal_room_metadata_backfill/);
  assert.match(correctiveBackfillMigration, /UPDATE public\.video_sessions vs/);
  assert.match(correctiveBackfillMigration, /canonical_room_metadata_recovered_after_outbox_drainer_v2/);
  assert.match(finalRepairMigration, /historical_outbox_drainer_v2_metadata_repair/);
  assert.match(finalRepairMigration, /daily_room_provider_deleted_at/);
  assert.match(historicalDeleteMarkerMigration, /canonical_room_metadata_recovered_after_outbox_drainer_v2/);
  assert.match(historicalDeleteMarkerMigration, /daily_room_provider_deleted_at = now\(\)/);
  assert.match(historicalDeleteMarkerMigration, /video_date_session_is_post_date_survey_eligible_v2/);
});

test("provider cleanup marks deletion without erasing terminal room forensics", () => {
  const cleanupMarkerMigration = read(
    "supabase/migrations/20260605145306_video_date_terminal_room_cleanup_preserve_metadata.sql",
  );

  assert.match(cleanupMarkerMigration, /daily_room_provider_deleted_at/);
  assert.match(cleanupMarkerMigration, /daily_room_provider_delete_reason/);
  assert.match(cleanupMarkerMigration, /idx_video_sessions_terminal_room_cleanup_pending/);

  for (const [name, source] of [
    ["outbox", outboxDrainer],
    ["room cleanup", roomCleanup],
    ["orphan cleanup", orphanCleanup],
  ] as Array<[string, string]>) {
    assert.match(source, /daily_room_provider_deleted_at/, `${name} stamps provider deletion`);
    assert.match(source, /daily_room_provider_delete_reason/, `${name} keeps a bounded deletion reason`);
    assert.doesNotMatch(source, /update\(\{\s*daily_room_name:\s*null,\s*daily_room_url:\s*null\s*\}\)/);
  }

  assert.match(roomCleanup, /\.is\("daily_room_provider_deleted_at", null\)/);
  assert.match(outboxDrainer, /provider_room_already_marked_deleted/);
  assert.match(orphanCleanup, /markTerminalRoomProviderDeleted/);
});

test("existing downgraded pending-survey registrations are repaired", () => {
  assert.match(pendingSurveyRegistrationRepairMigration, /UPDATE public\.event_registrations er/);
  assert.match(pendingSurveyRegistrationRepairMigration, /queue_status = 'in_survey'/);
  assert.match(pendingSurveyRegistrationRepairMigration, /er\.current_room_id = vs\.id/);
  assert.match(pendingSurveyRegistrationRepairMigration, /er\.profile_id IN \(vs\.participant_1_id, vs\.participant_2_id\)/);
  assert.match(pendingSurveyRegistrationRepairMigration, /er\.queue_status IN \('browsing', 'idle', 'offline'\)/);
  assert.match(pendingSurveyRegistrationRepairMigration, /video_date_session_is_post_date_survey_eligible_v2/);
  assert.match(pendingSurveyRegistrationRepairMigration, /date_feedback df/);
  assert.match(pendingSurveyRegistrationRepairMigration, /df\.user_id = er\.profile_id/);
});

test("post-encounter automatic peer-missing is server-owned across web and native", () => {
  for (const [name, source] of [
    ["web", webDateRoute],
    ["native", nativeDateRoute],
  ] as Array<[string, string]>) {
    assert.match(source, /postEncounterPeerMissingSuppressedRef/, `${name} should dedupe peer-missing suppression`);
    assert.match(source, /post_encounter_peer_missing_terminal_end_suppressed/, `${name} should emit diagnostics`);
    assert.match(source, /provider_absence_server_owned_after_encounter/, `${name} should defer absence terminalization to server truth`);
    assert.match(source, /videoSessionHasEncounterExposureTruth/, `${name} should use server encounter truth`);
    assert.doesNotMatch(
      source,
      /post_encounter_peer_missing_terminal_end_suppressed[\s\S]{0,600}handleCallEnd\([^)]*partner_absent_after_confirmed_encounter/,
      `${name} should not auto-end a confirmed encounter from peer-missing watchdog state`,
    );
  }

  assert.doesNotMatch(
    activeSession,
    /POST_DATE_SURVEY_INELIGIBLE_ENDED_REASONS[\s\S]{0,500}partner_absent_after_confirmed_encounter/,
  );
  assert.match(webDateRoute, /handleLeave\(\{ reason: "partner_absent_after_confirmed_encounter" \}\)/);
  assert.match(
    nativeDateRoute,
    /const dateWasEstablished =[\s\S]{0,220}reason === ['"]partner_absent_after_confirmed_encounter['"]/,
  );
});

test("historical encounter truth suppresses client peer-missing terminalization", () => {
  for (const [name, source] of [
    ["web", webVideoCall],
    ["native", nativeDateRoute],
  ] as Array<[string, string]>) {
    assert.match(source, /hasTerminalSurveyTruth/, `${name} should still detect terminal survey truth`);
    assert.match(source, /hasHistoricalRemoteSeenTruth/, `${name} should still log historical encounter truth`);
    assert.match(source, /daily_no_remote_watchdog_historical_truth_suppressed/);
    assert.match(source, /peer_missing_suppressed_remote_seen/);
    assert.doesNotMatch(source, /daily_no_remote_watchdog_historical_truth_requires_current_peer/);
  }

  assert.match(observability, /"historical_remote_seen_truth"/);
  assert.match(observability, /"truth_refresh_attempt"/);
  assert.match(observability, /"daily_call_singleton_eligible"/);
});

test("terminal survey lifecycle hardening stays in the video-date v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDateTerminalSurveyLifecycleHardening\.test\.ts/);
});
