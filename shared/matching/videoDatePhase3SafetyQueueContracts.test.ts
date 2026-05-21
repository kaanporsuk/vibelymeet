import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260522001000_video_date_phase3_safety_queue_rpcs.sql"),
  "utf8",
);
const transitionCommands = readFileSync(
  join(root, "shared/matching/videoDateTransitionCommands.ts"),
  "utf8",
);
const safetyRpc = readFileSync(join(root, "shared/safety/submitUserReportRpc.ts"), "utf8");
const webSafetyModal = readFileSync(join(root, "src/components/video-date/InCallSafetyModal.tsx"), "utf8");
const webVideoDate = readFileSync(join(root, "src/pages/VideoDate.tsx"), "utf8");
const webMatchQueue = readFileSync(join(root, "src/hooks/useMatchQueue.ts"), "utf8");
const nativeSafetySheet = readFileSync(
  join(root, "apps/mobile/components/video-date/InCallSafetySheet.tsx"),
  "utf8",
);
const nativeVideoDate = readFileSync(join(root, "apps/mobile/app/date/[id].tsx"), "utf8");
const nativeEventsApi = readFileSync(join(root, "apps/mobile/lib/eventsApi.ts"), "utf8");
const nativeLobby = readFileSync(join(root, "apps/mobile/app/event/[eventId]/lobby.tsx"), "utf8");
const nativePostDateSurvey = readFileSync(
  join(root, "apps/mobile/components/video-date/PostDateSurvey.tsx"),
  "utf8",
);
const nativeNotificationDeepLink = readFileSync(
  join(root, "apps/mobile/components/NotificationDeepLinkHandler.tsx"),
  "utf8",
);
const eventLobbyObservability = readFileSync(
  join(root, "shared/observability/eventLobbyObservability.ts"),
  "utf8",
);
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

test("PR 3.8 safety v2 stores report details only in user_reports and keeps events participant-safe", () => {
  const safety = functionBody("submit_video_date_safety_report_v2");

  assert.match(safety, /public\.video_session_command_begin_v2\(/);
  assert.match(safety, /public\.video_session_command_finish_v2\(/);
  assert.match(safety, /'safety_report'/);
  assert.match(safety, /'details_hash', v_details_hash/);
  assert.match(safety, /'has_details', v_details IS NOT NULL/);
  assert.doesNotMatch(safety, /v_request :=[\s\S]+p_details/);
  assert.match(safety, /INSERT INTO public\.user_reports/);
  assert.match(safety, /details,\s+also_blocked/);
  assert.match(safety, /'video_date_safety_report_recorded'[\s\S]+'safety_review'/);
  assert.match(safety, /'video_date_safety_report_submitted'[\s\S]+'actor_only'/);
  assert.match(safety, /'video_date_ended'[\s\S]+'participants'/);
  assert.match(safety, /v_was_ended/);
  assert.match(safety, /AND NOT v_was_ended/);
  assert.match(safety, /public\.video_date_session_is_post_date_survey_eligible/);
  assert.match(safety, /queue_status = 'in_survey'/);
  assert.match(safety, /public\.block_user_with_cleanup/);
  assert.match(safety, /public\.video_date_transition\(p_session_id, 'end', 'ended_from_client'\)/);
  assert.match(safety, /public\.video_date_outbox_enqueue_v2\(/);
  assert.match(safety, /'daily\.delete_video_date_room'/);
  assert.doesNotMatch(safety, /'reason',\s*v_reason[\s\S]{0,240}'participants'/);
  assert.doesNotMatch(safety, /meeting[_-]?token|daily_token|DAILY_API_KEY|createMeetingToken/i);
});

test("PR 3.9 queue drain v2 revalidates hot eligibility before promotion", () => {
  const drain = functionBody("drain_match_queue_v2");

  assert.match(drain, /pg_advisory_xact_lock\(\s+hashtextextended\('video_session_command:' \|\| v_actor::text \|\| ':' \|\| v_key/);
  assert.match(drain, /v_existing_command public\.video_session_commands%ROWTYPE/);
  assert.ok(
    drain.indexOf("FROM public.video_session_commands") <
      drain.indexOf("FROM public.lock_event_lobby_scheduled_active_state"),
    "existing command replay must happen before event/queue state can move away",
  );
  assert.match(drain, /v_existing_command\.request_payload->>'event_id' IS DISTINCT FROM p_event_id::text/);
  assert.match(drain, /'idempotency_conflict'/);
  assert.match(drain, /v_begin := public\.video_session_command_begin_v2\(\s+v_existing_command\.session_id/);
  assert.match(drain, /v_begin->>'status' IN \('replay', 'replay_rejected'\)/);
  assert.match(drain, /FOR UPDATE OF vs SKIP LOCKED/);
  assert.match(drain, /'no_queued_session'[\s\S]+RETURN jsonb_build_object\('found', false/);
  assert.match(drain, /public\.video_session_command_begin_v2\(/);
  assert.match(drain, /'drain_match_queue'/);
  assert.match(drain, /public\.video_date_pair_has_terminal_encounter/);
  assert.match(drain, /public\.event_participant_runtime_state/);
  assert.match(drain, /last_heartbeat_at >= now\(\) - interval '45 seconds'/);
  assert.match(drain, /readiness_status IN \('ready', 'warning'\)/);
  assert.match(drain, /public\.is_blocked\(v_actor, v_partner_id\)/);
  assert.match(drain, /public\.user_reports ur[\s\S]+ur\.reporter_id = v_actor[\s\S]+ur\.reporter_id = v_partner_id/);
  assert.match(drain, /current_partner_id IN \(v_actor, v_partner_id\)/);
  assert.match(drain, /ended_reason = COALESCE\(ended_reason, 'registration_missing'\)/);
  assert.match(drain, /ended_reason = COALESCE\(ended_reason, 'admission_not_confirmed'\)/);
  assert.match(drain, /ended_reason = COALESCE\(ended_reason, v_inactive_reason\)/);
  assert.match(drain, /ended_reason = COALESCE\(ended_reason, 'queued_session_not_promotable'\)/);
  assert.match(drain, /ended_reason = COALESCE\(ended_reason, 'participant_has_active_session_conflict'\)/);
  assert.match(drain, /queue_status = 'queued'[\s\S]+current_room_id IS NULL[\s\S]+current_partner_id IS NULL/);
  assert.match(drain, /public\.event_lobby_video_session_blocks_new_match/);
  assert.match(drain, /ready_gate_status = 'ready'/);
  assert.match(drain, /queue_status = 'in_ready_gate'/);
  assert.match(drain, /record_event_profile_impression_v2\([\s\S]+'paired'/);
  assert.match(drain, /INSERT INTO public\.event_profile_impressions[\s\S]+'paired'/);
  assert.match(drain, /'queue_promoted_to_ready_gate'[\s\S]+'participants'/);
  assert.match(drain, /'notification\.send'/);
  assert.doesNotMatch(drain, /meeting[_-]?token|daily_token|DAILY_API_KEY|createMeetingToken/i);
});

test("web and native adapters route safety and queue drain behind default-off flags", () => {
  assert.match(transitionCommands, /buildVideoDateSafetyIdempotencyKey/);
  assert.match(transitionCommands, /buildVideoDateQueueDrainIdempotencyKey/);
  assert.match(transitionCommands, /createVideoDateClientRequestId/);

  assert.match(safetyRpc, /submitVideoDateSafetyReportRpc/);
  assert.match(safetyRpc, /submit_video_date_safety_report_v2/);

  assert.match(webVideoDate, /useFeatureFlag\("video_date\.outbox_v2\.safety"\)/);
  assert.match(webVideoDate, /safetyV2=\{safetyV2\.enabled\}/);
  assert.match(webVideoDate, /onServerEndedAfterReport=\{handleServerEndedAfterInCallReport\}/);
  assert.match(webSafetyModal, /submitVideoDateSafetyReportRpc/);
  assert.match(webSafetyModal, /buildVideoDateSafetyIdempotencyKey/);
  assert.match(webSafetyModal, /payloadSignature/);
  assert.match(webSafetyModal, /catch \(error\)/);
  assert.match(webSafetyModal, /safetyV2 && sessionId/);

  assert.match(nativeVideoDate, /useFeatureFlag\('video_date\.outbox_v2\.safety'\)/);
  assert.match(nativeVideoDate, /safetyV2=\{safetyV2\.enabled\}/);
  assert.match(nativeVideoDate, /onServerEndedAfterReport=\{handleServerEndedAfterInCallReport\}/);
  assert.match(nativeSafetySheet, /submitVideoDateSafetyReportRpc/);
  assert.match(nativeSafetySheet, /buildVideoDateSafetyIdempotencyKey/);
  assert.match(nativeSafetySheet, /payloadSignature/);
  assert.match(nativeSafetySheet, /catch \(error\)/);
  assert.match(nativeSafetySheet, /safetyV2 && sessionId/);

  assert.match(webMatchQueue, /useFeatureFlag\("video_date\.outbox_v2\.drain_match_queue"\)/);
  assert.match(webMatchQueue, /drain_match_queue_v2/);
  assert.match(webMatchQueue, /buildVideoDateQueueDrainIdempotencyKey/);
  assert.match(webMatchQueue, /if \(error\)/);
  assert.match(eventLobbyObservability, /type QueueDrainSourceSurface/);
  assert.match(eventLobbyObservability, /source_surface: input\.sourceSurface \?\? "event_lobby"/);
  assert.match(nativeEventsApi, /drainMatchQueueV2\?: boolean/);
  assert.match(nativeEventsApi, /sourceSurface\?: QueueDrainSourceSurface/);
  assert.match(nativeEventsApi, /drain_match_queue_v2/);
  assert.match(nativeEventsApi, /buildVideoDateQueueDrainIdempotencyKey/);
  assert.match(nativeEventsApi, /catch \(error\)/);
  assert.match(nativeLobby, /useFeatureFlag\('video_date\.outbox_v2\.drain_match_queue'\)/);
  assert.match(nativeLobby, /drainMatchQueueV2: drainQueueV2\.enabled/);
  assert.match(nativePostDateSurvey, /useFeatureFlag\('video_date\.outbox_v2\.drain_match_queue'\)/);
  assert.match(nativePostDateSurvey, /drainQueueV2\.enabled \? 'v2' : 'legacy'/);
  assert.match(nativePostDateSurvey, /sourceAction: 'survey_queue_drain'/);
  assert.match(nativePostDateSurvey, /sourceSurface: 'post_date_survey'/);
  assert.match(nativePostDateSurvey, /drainMatchQueueV2: drainQueueV2\.enabled/);
  assert.match(nativeNotificationDeepLink, /useFeatureFlag\('video_date\.outbox_v2\.drain_match_queue'\)/);
  assert.match(nativeNotificationDeepLink, /sourceAction: 'notification_queued_session_rescue'/);
  assert.match(nativeNotificationDeepLink, /sourceSurface: 'notification_deep_link'/);
  assert.match(nativeNotificationDeepLink, /drainMatchQueueV2: drainQueueV2\.enabled/);
});

test("Phase 3.8-3.10 contracts are included in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDatePhase3SafetyQueueContracts\.test\.ts/);
});
