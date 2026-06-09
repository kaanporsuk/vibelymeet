import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const sprint7Migration = read("supabase/migrations/20260525235000_video_date_sprint7_safety_privacy_ops.sql");
const sprint7FastPathMigration = read("supabase/migrations/20260525235500_video_date_sprint7_ops_health_fast_path.sql");
const reviewFollowupMigration = read("supabase/migrations/20260525235900_review_comments_1060_1070_followups.sql");
const validationPack = read("supabase/validation/video_date_sprint7_safety_privacy_ops.sql");
const adminOps = read("supabase/functions/admin-video-date-ops/index.ts");
const adminShared = read("supabase/functions/_shared/admin-video-date-ops.ts");
const safetyRpc = read("shared/safety/submitUserReportRpc.ts");
const webInCallSafety = read("src/components/video-date/InCallSafetyModal.tsx");
const nativeInCallSafety = read("apps/mobile/components/video-date/InCallSafetySheet.tsx");
const webSurvey = read("src/components/video-date/PostDateSurvey.tsx");
const nativeSurvey = read("apps/mobile/components/video-date/PostDateSurvey.tsx");
const webReportWizard = read("src/components/safety/ReportWizard.tsx");
const webUserProfile = read("src/pages/UserProfile.tsx");
const webLobbyProfileCard = read("src/components/lobby/LobbyProfileCard.tsx");
const webBlockHook = read("src/hooks/useBlockUser.ts");
const nativeReportFlow = read("apps/mobile/components/match/ReportFlowModal.tsx");
const nativeProfile = read("apps/mobile/app/user/[userId].tsx");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const nativeBlockHook = read("apps/mobile/lib/useBlockUser.ts");
const discoverabilityMigration = read("supabase/migrations/20260430190000_enforce_discovery_audience_in_discovery_surfaces.sql");
const finalDeckMigration = read("supabase/migrations/20260524170000_video_date_deck_prefetch_media_version.sql");
const postLockSwipe = read("supabase/migrations/20260508140000_handle_swipe_post_lock_block_race_recheck.sql");
const sprint2Queue = read("supabase/migrations/20260525213000_video_date_sprint2_queue_hint_drain_alignment.sql");
const sprint5Survey = read("supabase/migrations/20260525223000_video_date_sprint5_post_date_next_surface_authority.sql");
const dailyWebhook = read("supabase/functions/video-date-daily-webhook/index.ts");
const sendNotification = read("supabase/functions/send-notification/index.ts");
const v4Foundation = read("supabase/migrations/20260521150000_video_date_v4_foundation.sql");
const phase5Outbox = read("supabase/migrations/20260524203000_video_date_phase5_hardened_outbox_finalizer_cleanup.sql");
const providerReliability = read("supabase/migrations/20260524090000_video_date_phase1_provider_reliability.sql");
const sprint7Docs = read("docs/observability/video-date-sprint7-safety-privacy-ops.md");
const operatorDashboards = read("docs/observability/video-date-operator-dashboards.md");
const operatorMetrics = read("docs/observability/video-date-operator-metrics.md");
const packageJson = read("package.json");

function sourceBetween(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `${startNeedle} should exist`);
  const end = source.indexOf(endNeedle, start);
  assert.ok(end > start, `${endNeedle} should exist after ${startNeedle}`);
  return source.slice(start, end);
}

test("Sprint 7 service-role operator health RPC is aggregate-only and wired into admin metrics", () => {
  assert.match(sprint7Migration, /CREATE OR REPLACE FUNCTION public\.get_video_date_sprint7_ops_health\(/);
  assert.match(sprint7Migration, /SECURITY DEFINER/);
  assert.match(sprint7Migration, /auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  assert.match(sprint7Migration, /REVOKE ALL ON FUNCTION public\.get_video_date_sprint7_ops_health\(uuid\)[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(sprint7Migration, /GRANT EXECUTE ON FUNCTION public\.get_video_date_sprint7_ops_health\(uuid\)[\s\S]+TO service_role/);

  for (const metric of [
    "stuck_ready_gate_count",
    "stuck_handshake_count",
    "overdue_date_count",
    "silently_queued_count",
    "pending_survey_recovery_count",
    "prepare_entry_failure_count",
    "daily_join_failure_count",
    "webhook_dlq_count",
    "orphan_room_cleanup_failed_count",
    "report_with_block_count",
    "block_count",
  ]) {
    assert.match(sprint7Migration, new RegExp(metric), `${metric} missing from Sprint 7 health RPC`);
  }

  for (const excluded of [
    "daily_tokens",
    "provider_secrets",
    "auth_headers",
    "profile_text",
    "profile_names",
    "emails",
    "phone_numbers",
    "media_urls",
    "freeform_report_details",
  ]) {
    assert.match(sprint7Migration, new RegExp(excluded), `${excluded} missing from privacy contract`);
  }

  assert.match(adminOps, /getSprint7SafetyPrivacyOpsHealthPayload/);
  assert.match(adminOps, /SPRINT7_OPS_HEALTH_RPC_TIMEOUT_MS/);
  assert.match(adminOps, /withOpsTimeout/);
  assert.match(adminOps, /sprint7_ops_health_timeout/);
  assert.match(adminOps, /service\.rpc\("get_video_date_sprint7_ops_health"/);
  assert.match(adminOps, /safety_privacy_ops_health:\s*selectSprint7SafetyPrivacyOpsHealth/);
  assert.match(adminOps, /SPRINT7_PRIVACY_CONTRACT_FALLBACK/);
  assert.match(adminShared, /SENSITIVE_TIMELINE_KEY_PATTERN/);
  assert.match(sprint7Migration, /COALESCE\(sa\.pending_report_count, 0\) > 0 THEN 'warning'/);
  assert.match(sprint7Migration, /public\.event_registrations er_reporter/);
  assert.match(sprint7Migration, /public\.event_registrations er_reported/);
  assert.match(sprint7Migration, /public\.event_registrations er_blocker/);
  assert.match(sprint7Migration, /public\.event_registrations er_blocked/);
  assert.match(sprint7FastPathMigration, /CREATE OR REPLACE FUNCTION public\.get_video_date_sprint7_ops_health\(/);
  assert.match(sprint7FastPathMigration, /LEFT JOIN LATERAL \([\s\S]+public\.event_loop_observability_events eo[\s\S]+eo\.operation IN/);
  assert.match(sprint7FastPathMigration, /LEFT JOIN LATERAL \([\s\S]+FROM public\.user_reports ur/);
  assert.match(sprint7FastPathMigration, /LEFT JOIN LATERAL \([\s\S]+FROM public\.blocked_users bu/);
  assert.match(sprint7FastPathMigration, /REVOKE ALL ON FUNCTION public\.get_video_date_sprint7_ops_health\(uuid\)[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(sprint7Migration, /RESET statement_timeout/);
  assert.match(sprint7FastPathMigration, /RESET statement_timeout/);
  assert.match(reviewFollowupMigration, /eo\.outcome NOT IN \('success', 'no_op', 'blocked'\)/);
  assert.match(reviewFollowupMigration, /CREATE OR REPLACE FUNCTION public\.get_video_date_sprint7_ops_health\(/);
  assert.match(validationPack, /video_date_sprint7_ops_health_service_role_only/);
  assert.match(validationPack, /video_date_sprint7_ops_health_dashboard_dimensions/);
  assert.match(packageJson, /videoDateSprint7SafetyPrivacyOpsContracts\.test\.ts/);
});

test("Sprint 7 safety actions are present in lobby/profile, in-call, and post-date surfaces on web and native", () => {
  assert.match(safetyRpc, /submitUserReportRpc/);
  assert.match(safetyRpc, /submitVideoDateSafetyReportRpc/);
  assert.match(safetyRpc, /submit_video_date_safety_report_v2/);
  assert.match(safetyRpc, /p_also_block: params\.alsoBlock/);
  assert.match(safetyRpc, /p_end_session: params\.endSession/);
  assert.match(safetyRpc, /p_idempotency_key: params\.idempotencyKey/);

  for (const source of [webInCallSafety, nativeInCallSafety]) {
    assert.match(source, /submitVideoDateSafetyReportRpc/);
    assert.match(source, /submitUserReportRpc/);
    assert.match(source, /buildVideoDateSafetyIdempotencyKey/);
    assert.match(source, /alsoBlock/);
    assert.match(source, /endSession: mode === ['"]end['"]/);
    assert.match(source, /safetyV2 && sessionId/);
  }

  assert.match(webSurvey, /submitWebPostDateOutboxItem/);
  assert.match(webSurvey, /recordReportPassVerdict\(reportPayload\)/);
  assert.match(webSurvey, /reportBeforeVerdictRef/);
  assert.match(webSurvey, /alsoBlock/);
  assert.match(nativeSurvey, /submitPostDateReportWithOutbox/);
  assert.match(nativeSurvey, /recordReportPassVerdict\(reportPayload\)/);
  assert.match(nativeSurvey, /reportBeforeVerdictRef/);
  assert.match(nativeSurvey, /alsoBlock: wantsBlock/);

  assert.match(webReportWizard, /submitUserReportRpc/);
  assert.match(webReportWizard, /alsoBlock/);
  assert.match(webReportWizard, /invalidateQueries\(\{ queryKey: \["event-deck"\] \}\)/);
  assert.match(webReportWizard, /void Promise\.all/);
  assert.match(webLobbyProfileCard, /navigate\(`\/user\/\$\{profile\.id\}`\)/);
  assert.match(webUserProfile, /ReportWizard/);
  assert.match(webUserProfile, /BlockUserDialog/);
  assert.match(webUserProfile, /blockUserAsync/);
  assert.match(webUserProfile, /interactionType: "Event Lobby"/);
  assert.match(webBlockHook, /invalidateQueries\(\{ queryKey: \["event-deck"\] \}\)/);
  assert.match(nativeReportFlow, /submitReport/);
  assert.match(nativeReportFlow, /alsoBlock/);
  assert.match(nativeReportFlow, /invalidateQueries\(\{ queryKey: \['event-deck'\] \}\)/);
  assert.match(nativeReportFlow, /void Promise\.all/);
  assert.match(nativeLobby, /router\.push\(`\/user\/\$\{profile\.id\}`\)/);
  assert.match(nativeProfile, /ReportFlowModal/);
  assert.match(nativeProfile, /blockUser/);
  assert.match(nativeBlockHook, /invalidateQueries\(\{ queryKey: \['event-deck'\] \}\)/);
});

test("Sprint 7 blocked and reported pairs cannot rematch, re-enter queue, route to unsafe surfaces, or receive unsafe notifications", () => {
  assert.match(discoverabilityMigration, /public\.is_blocked\(p_viewer_id, p_target_id\)/);
  assert.match(discoverabilityMigration, /FROM public\.user_reports ur[\s\S]+ur\.reporter_id = p_viewer_id[\s\S]+ur\.reported_id = p_target_id/);
  assert.match(discoverabilityMigration, /AND public\.is_profile_discoverable\(p\.id, p_user_id\)/);
  assert.match(finalDeckMigration, /get_event_deck_20260501180000_active_base/);

  assert.match(postLockSwipe, /public\.is_blocked\(p_actor_id, p_target_id\)/);
  assert.match(postLockSwipe, /blocked_pair_post_lock_recheck/);
  assert.match(postLockSwipe, /FROM public\.user_reports[\s\S]+reported_pair_post_lock_recheck/);

  assert.match(sprint2Queue, /NOT public\.is_blocked\(vs\.participant_1_id, vs\.participant_2_id\)/);
  assert.match(sprint2Queue, /FROM public\.user_reports ur[\s\S]+ur\.reporter_id = vs\.participant_1_id[\s\S]+ur\.reporter_id = vs\.participant_2_id/);
  assert.match(sprint2Queue, /event_lobby_video_session_blocks_new_match/);

  assert.match(sprint5Survey, /COALESCE\(v_session\.ended_reason, ''\) IN \('blocked_pair', 'blocked_or_reported_pair'\)/);
  assert.match(sprint5Survey, /FROM public\.user_reports ur[\s\S]+ur\.reporter_id = v_uid[\s\S]+ur\.reported_id = v_target/);
  assert.match(sprint5Survey, /v_pair_blocked_or_reported/);
  assert.match(sprint5Survey, /pair_safety_blocked/);
  assert.match(sprint5Survey, /resolve_post_date_next_surface/);

  assert.match(sendNotification, /async function isPairBlocked/);
  assert.match(sendNotification, /async function isPairReported/);
  const resolveActorBlock = sourceBetween(
    sendNotification,
    "async function resolveActorId",
    "async function isPairBlocked",
  );
  assert.match(resolveActorBlock, /category === ['"]date_reminder['"]/);
  assert.match(resolveActorBlock, /otherParticipantFromMatch/);
  assert.match(resolveActorBlock, /sessionId && isVideoDatePairNotificationCategory\(category\)/);
  assert.doesNotMatch(
    sourceBetween(sendNotification, "async function isPairBlocked", "async function isPairReported"),
    /maybeSingle/,
  );
  assert.doesNotMatch(
    sourceBetween(sendNotification, "async function isPairReported", "async function unsafeNotificationPairReason"),
    /maybeSingle/,
  );
  assert.match(sendNotification, /unsafeNotificationPairReason/);
  assert.match(sendNotification, /return ['"]reported_pair['"]/);
  assert.match(sendNotification, /function isVideoDatePairNotificationCategory/);
  for (const category of [
    "ready_gate",
    "partner_ready",
    "date_starting",
    "reconnection",
    "date_reminder",
    "post_date_feedback_reminder",
  ]) {
    assert.match(sendNotification, new RegExp(`category === ['"]${category}['"]`));
  }
  assert.match(sendNotification, /sessionId && isVideoDatePairNotificationCategory\(category\)/);
  assert.match(sendNotification, /send_notification_suppressed_unsafe_pair/);
  assert.match(sendNotification, /suppressed_\$\{pairSafetyReason\}/);
  assert.match(sendNotification, /skipsPerBucketPreferenceCheck\(category\)/);
});

test("Sprint 7 RLS and payload privacy boundaries cover sessions, feedback, reports, snapshots, tokens, outbox, webhook, and ops data", () => {
  assert.match(validationPack, /video_date_sprint7_private_operator_tables/);
  assert.match(validationPack, /video_date_sprint7_runtime_access_boundaries/);
  assert.match(validationPack, /video_date_sprint7_payload_sanitization_contract/);
  assert.match(validationPack, /event_loop_observability_events/);
  assert.match(validationPack, /video_date_webhook_dlq/);
  assert.match(validationPack, /video_date_provider_dead_letters/);
  assert.match(validationPack, /get_video_date_snapshot_core/);
  assert.match(validationPack, /record_video_date_launch_latency_checkpoint/);
  assert.match(validationPack, /record_video_date_client_stuck_observability/);

  assert.match(v4Foundation, /ALTER TABLE public\.video_date_provider_outbox ENABLE ROW LEVEL SECURITY/);
  assert.match(v4Foundation, /REVOKE ALL ON TABLE public\.video_date_provider_outbox FROM PUBLIC, anon, authenticated/);
  assert.match(v4Foundation, /video_date_provider_outbox_no_top_level_token/);
  assert.match(v4Foundation, /video_date_provider_outbox_no_secret_keys/);
  assert.match(providerReliability, /ALTER TABLE public\.video_date_provider_dead_letters ENABLE ROW LEVEL SECURITY/);
  assert.match(providerReliability, /REVOKE ALL ON TABLE public\.video_date_provider_dead_letters FROM PUBLIC, anon, authenticated/);

  assert.match(dailyWebhook, /SECRETISH_EXACT_KEYS/);
  assert.match(dailyWebhook, /function sanitizeWebhookPayload/);
  assert.match(dailyWebhook, /raw_body_sha256: payloadHash/);
  assert.match(dailyWebhook, /p_payload: sanitizeWebhookPayload\(payload\)/);
  assert.match(dailyWebhook, /record_video_date_webhook_dlq_v1/);
  assert.doesNotMatch(dailyWebhook, /p_sanitized_payload:\s*payload/);

  assert.match(phase5Outbox, /CONSTRAINT video_date_webhook_dlq_no_secret_keys/);
  assert.match(phase5Outbox, /video_date_jsonb_has_secret_key\(v_payload\)/);
  assert.match(phase5Outbox, /secret_payload_rejected/);
  assert.match(phase5Outbox, /video_date_orphan_safety_interlock_v1/);
  assert.match(phase5Outbox, /safety_review_pending/);

  const pushPreloadBlock = sourceBetween(
    sendNotification,
    "async function buildVideoDatePushPayloadV2",
    "function compactVideoDateOsDataForPush",
  );
  assert.match(sendNotification, /video_date_push_preload_v2/);
  assert.match(pushPreloadBlock, /partnerThumbUrl = null/);
  assert.doesNotMatch(pushPreloadBlock, /meeting_token|daily_token|DAILY_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
});

test("Sprint 7 dashboards, runbooks, launch checklist, and final certification are documented", () => {
  for (const dashboard of [
    "Stuck Ready Gate",
    "Prepare Entry Failures",
    "Daily Join Failures",
    "Survey Recovery",
    "Queue Drain Misses",
    "Webhook DLQ",
    "Orphan Rooms",
    "Safety Actions",
  ]) {
    assert.match(sprint7Docs, new RegExp(dashboard), `${dashboard} dashboard missing`);
  }

  for (const runbook of [
    "Daily Outage",
    "Webhook Failure",
    "Queue Backlog",
    "Stuck Session",
    "Missed Survey",
    "Event-End Cleanup",
    "Room Cleanup",
  ]) {
    assert.match(sprint7Docs, new RegExp(runbook), `${runbook} runbook missing`);
  }

  for (const checklistItem of [
    "Flags",
    "Secrets",
    "SLOs",
    "Required dashboards",
    "Rollback",
    "Incident owners",
    "Full typecheck passes",
    "Web two-user staging E2E passes",
    "iOS two-user manual run passes",
    "Android two-user manual run passes",
  ]) {
    assert.match(sprint7Docs, new RegExp(checklistItem), `${checklistItem} certification item missing`);
  }

  assert.match(operatorDashboards, /video-date-sprint7-safety-privacy-ops\.md/);
  assert.match(operatorDashboards, /application-level timeout/);
  assert.match(operatorDashboards, /source_error/);
  assert.match(operatorMetrics, /get_video_date_sprint7_ops_health/);
  assert.match(operatorMetrics, /safety_privacy_ops_health/);
});
