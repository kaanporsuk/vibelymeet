import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS,
} from "../featureFlags/videoDateV4Flags";
import {
  VIDEO_DATE_READINESS_PENDING_COPY,
  resolveVideoDateReadinessDiagnostic,
} from "./videoDateReadinessV2";

const snapshotFunction = readFileSync("supabase/functions/video-date-snapshot/index.ts", "utf8");
const tokenRefreshFunction = readFileSync("supabase/functions/video-date-token-refresh/index.ts", "utf8");
const dailyRoomFunction = readFileSync("supabase/functions/daily-room/index.ts", "utf8");
const sendNotificationFunction = readFileSync("supabase/functions/send-notification/index.ts", "utf8");
const swipeActionsFunction = readFileSync("supabase/functions/swipe-actions/index.ts", "utf8");
const postDateVerdictFunction = readFileSync("supabase/functions/post-date-verdict/index.ts", "utf8");
const webLobby = readFileSync("src/pages/EventLobby.tsx", "utf8");
const webSwipeAction = readFileSync("src/hooks/useSwipeAction.ts", "utf8");
const webReadyGateOverlay = readFileSync("src/components/lobby/ReadyGateOverlay.tsx", "utf8");
const nativeLobby = readFileSync("apps/mobile/app/event/[eventId]/lobby.tsx", "utf8");
const nativeReadyGateOverlay = readFileSync("apps/mobile/components/lobby/ReadyGateOverlay.tsx", "utf8");
const eventDeckAuthorityMigration = readFileSync(
  "supabase/migrations/20260601183000_event_deck_authority_contract.sql",
  "utf8",
);
const flowHardeningFollowupsMigration = readFileSync(
  "supabase/migrations/20260602000000_video_date_flow_hardening_followups.sql",
  "utf8",
);
const definitiveFlowHardeningMigration = readFileSync(
  "supabase/migrations/20260602010000_video_date_definitive_flow_hardening.sql",
  "utf8",
);
const definitiveCloudAlignmentMigration = readFileSync(
  "supabase/migrations/20260602005051_video_date_definitive_cloud_alignment.sql",
  "utf8",
);
const legacyQueueSessionRpcRemovalMigration = readFileSync(
  "supabase/migrations/20260609163130_remove_legacy_queue_session_rpcs.sql",
  "utf8",
);
const legacyQueueCleanupRpcRemovalMigration = readFileSync(
  "supabase/migrations/20260609165218_remove_leave_matching_queue.sql",
  "utf8",
);
const sessionSourceRemovalMigration = readFileSync(
  "supabase/migrations/20260609171950_remove_video_sessions_session_source.sql",
  "utf8",
);
const eventRegistrationDmlLockdownMigration = readFileSync(
  "supabase/migrations/20260606164737_event_registration_rpc_owned_dml_lockdown.sql",
  "utf8",
);
const packageJson = readFileSync("package.json", "utf8");
const certificationEnvExample = readFileSync(".env.certification.example", "utf8");
const requiredCertificationGate = readFileSync("scripts/certify-video-date-required.mjs", "utf8");
const runtimeRlsEnvGuard = readFileSync("scripts/require-video-date-runtime-rls-env.mjs", "utf8");
const phase8Runbook = readFileSync("docs/video-date-v4-phase8-certification-rollout.md", "utf8");
const monitoringRunbook = readFileSync("docs/video-date-post-release-monitoring-runbook.md", "utf8");
const requiredCertificationTemplate = readFileSync("docs/video-date-required-certification-template.json", "utf8");
const videoDateFlags = readFileSync("shared/featureFlags/videoDateV4Flags.ts", "utf8");
const aliasHelper = readFileSync("shared/featureFlags/featureFlagAliasResolution.ts", "utf8");

function sqlFunctionSection(source: string, functionName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} definition should exist`);
  const end = source.indexOf("$function$;", start);
  assert.notEqual(end, -1, `${functionName} definition should be dollar-quoted`);
  return source.slice(start, end);
}

test("legacy snapshot token issuance uses shared Daily provider reliability", () => {
  assert.match(snapshotFunction, /from "\.\.\/_shared\/video-date-provider-reliability\.ts"/);
  for (const symbol of [
    "fetchWithTimeout",
    "enforceProviderRateLimit",
    "providerRateLimitConfig",
    "providerFetchTimeoutMs",
    "parseRetryAfterSeconds",
    "ProviderRateLimitError",
    "ProviderTimeoutError",
    "providerFailureCode",
    "providerFailureMessage",
    "providerFailureRetryAfter",
  ]) {
    assert.match(snapshotFunction, new RegExp(symbol));
  }

  assert.doesNotMatch(snapshotFunction, /await\s+fetch\s*\(\s*`\$\{DAILY_API_URL\}\/meeting-tokens/);
  assert.match(snapshotFunction, /fetchWithTimeout\(`\$\{DAILY_API_URL\}\/meeting-tokens`/);
  assert.match(snapshotFunction, /enforceProviderRateLimit\(reliabilityClient, providerRateLimitConfig\("daily", "meeting_token"\)\)/);
  assert.match(snapshotFunction, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(snapshotFunction, /operation: "snapshot_token"/);
});

test("warning readiness is diagnostics-only and does not define deck pairing eligibility", () => {
  const warning = resolveVideoDateReadinessDiagnostic("warning");
  const blocked = resolveVideoDateReadinessDiagnostic("blocked");
  const ready = resolveVideoDateReadinessDiagnostic("ready");

  assert.equal(warning.diagnosticMessage, VIDEO_DATE_READINESS_PENDING_COPY);
  assert.match(blocked.diagnosticMessage ?? "", /join a video date/);
  assert.equal(ready.diagnosticMessage, null);
});

test("snapshot token failures surface bounded 429 retry-after without leaking token material", () => {
  assert.match(snapshotFunction, /DAILY_SNAPSHOT_TOKEN_MAX_RETRY_SLEEP_SECONDS/);
  assert.match(snapshotFunction, /response\.status === 429 && retries > 0/);
  assert.match(snapshotFunction, /retryAfterSeconds <= DAILY_SNAPSHOT_TOKEN_MAX_RETRY_SLEEP_SECONDS/);
  assert.match(snapshotFunction, /ProviderRateLimitError/);
  assert.match(snapshotFunction, /status, retryAfterSeconds\)/);
  assert.match(snapshotFunction, /"Retry-After"/);
  assert.match(snapshotFunction, /retry_after_seconds/);
  assert.match(snapshotFunction, /retryAfterSeconds/);
  assert.match(snapshotFunction, /clientError: "daily_token_failed"/);
  assert.doesNotMatch(snapshotFunction, /clientError: "provider_rate_limited"/);
  assert.match(snapshotFunction, /error instanceof ProviderRateLimitError \|\| error instanceof ProviderTimeoutError/);
  assert.doesNotMatch(snapshotFunction, /snapshotTokenFailureStatus\(error\) === 429/);
  assert.match(snapshotFunction, /provider_status/);
  assert.doesNotMatch(snapshotFunction, /provider_payload|raw_payload|provider_error|response_body_(?:snippet|text)/i);
  assert.doesNotMatch(snapshotFunction, /console\.(?:log|error|warn)\([^)]*DAILY_API_KEY/);
});

test("token-free snapshot path remains auth-preserving and does not require provider work", () => {
  const includeTokenGuard = snapshotFunction.indexOf("if (!includeToken)");
  const missingRoomGuard = snapshotFunction.indexOf("if (!roomName)");
  const tokenIssue = snapshotFunction.indexOf("const tokenResult = await createMeetingToken");
  assert.ok(includeTokenGuard > -1, "include-token guard must exist");
  assert.ok(missingRoomGuard > includeTokenGuard, "missing-room guard should follow include-token guard");
  assert.ok(tokenIssue > missingRoomGuard, "token issuance must happen after token-free returns");
  assert.match(snapshotFunction, /createClient\(supabaseUrl, supabaseAnonKey[\s\S]+global: \{ headers: \{ Authorization: authHeader \} \}/);
  assert.match(snapshotFunction, /get_video_date_snapshot_core/);
});

test("required runtime RLS command is explicit and fails fast when env is missing", () => {
  const packageConfig = JSON.parse(packageJson) as { scripts: Record<string, string> };
  const command = packageConfig.scripts["test:video-date-runtime-rls:required"];
  const certificationCommand = packageConfig.scripts["certify:video-date:required"];
  assert.ok(command, "required runtime RLS command should exist");
  assert.ok(certificationCommand, "required video-date certification command should exist");
  assert.match(command, /require-video-date-runtime-rls-env\.mjs/);
  assert.match(command, /videoDateRealtimeRlsRuntime\.test\.ts/);
  assert.match(command, /videoDatePublicApiRlsRuntime\.test\.ts/);
  assert.match(certificationCommand, /certify-video-date-required\.mjs/);
  assert.match(packageJson, /phase8:config-readiness/);
  assert.match(packageJson, /test:video-date-runtime-rls:required/);
  for (const requiredStep of [
    "npm run typecheck",
    "npm run test:video-date-v4",
    "npm run test:event-lobby-regression",
    "npm run test:daily-room-contract",
    "npm run test:video-date-runtime-rls:required",
    "npm run phase8:config-readiness",
    "npm run phase8:live-certify",
  ]) {
    assert.match(requiredCertificationGate, new RegExp(requiredStep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(requiredCertificationGate, /pending_user_owned/);
  assert.match(requiredCertificationGate, /provider_dashboard_daily_quota/);
  assert.match(requiredCertificationGate, /cron_worker_schedule_health/);
  assert.match(requiredCertificationGate, /recovery_alert_delivery/);
  assert.match(certificationEnvExample, /SENTRY_DSN/);
  assert.match(certificationEnvExample, /VIDEO_DATE_RECOVERY_SLACK_WEBHOOK_URL/);
  assert.match(certificationEnvExample, /PHASE8_SENTRY_DSN/);

  for (const envName of [
    "VIDEO_DATE_RLS_SUPABASE_URL",
    "VIDEO_DATE_RLS_SUPABASE_ANON_KEY",
    "VIDEO_DATE_RLS_SESSION_ID",
    "VIDEO_DATE_RLS_PARTICIPANT_JWT",
    "VIDEO_DATE_RLS_NON_PARTICIPANT_JWT",
    "VIDEO_DATE_PUBLIC_API_RLS_SUPABASE_URL",
    "VIDEO_DATE_PUBLIC_API_RLS_SUPABASE_ANON_KEY",
    "VIDEO_DATE_PUBLIC_API_RLS_EVENT_ID",
    "VIDEO_DATE_PUBLIC_API_RLS_USER_ID",
    "VIDEO_DATE_PUBLIC_API_RLS_OTHER_USER_ID",
    "VIDEO_DATE_PUBLIC_API_RLS_PARTICIPANT_JWT",
    "VIDEO_DATE_PUBLIC_API_RLS_NON_PARTICIPANT_JWT",
    "VIDEO_DATE_PUBLIC_API_RLS_SESSION_ID",
  ]) {
    assert.match(runtimeRlsEnvGuard, new RegExp(envName));
    assert.match(phase8Runbook, new RegExp(envName));
  }
  assert.match(runtimeRlsEnvGuard, /process\.exit\(1\)/);
  assert.match(phase8Runbook, /npm run test:video-date-runtime-rls:required/);
  assert.match(monitoringRunbook, /npm run test:video-date-runtime-rls:required/);
});

test("video-date browser Edge functions reject unapproved origins through shared CORS helpers", () => {
  for (const source of [
    snapshotFunction,
    tokenRefreshFunction,
    sendNotificationFunction,
    swipeActionsFunction,
    postDateVerdictFunction,
  ]) {
    assert.match(source, /from ['"]\.\.\/_shared\/cors\.ts['"]/);
    assert.match(source, /preflightResponse\(req\)/);
    assert.match(source, /isBrowserOriginRejected\(req\)/);
    assert.match(source, /origin_not_allowed|ORIGIN_NOT_ALLOWED/);
    assert.doesNotMatch(source, /Access-Control-Allow-Origin['"]:\s*['"]\*/);
  }
  assert.match(dailyRoomFunction, /from "\.\.\/_shared\/cors\.ts"/);
  assert.match(dailyRoomFunction, /preflightResponse\(req\)/);
  assert.match(dailyRoomFunction, /isBrowserOriginRejected\(req\)/);
  assert.doesNotMatch(dailyRoomFunction, /Access-Control-Allow-Origin['"]:\s*['"]\*/);
  assert.match(dailyRoomFunction, /const corsHeaders = corsHeadersForRequest\(req\)/);
  assert.match(dailyRoomFunction, /ORIGIN_NOT_ALLOWED/);
});

test("video-date SQL followups remove Ready Gate anon execute and gate legacy extension key hardening", () => {
  assert.match(flowHardeningFollowupsMigration, /REVOKE EXECUTE ON FUNCTION public\.ready_gate_transition\(uuid, text, text\) FROM anon/);
  assert.match(flowHardeningFollowupsMigration, /video_date\.require_legacy_extension_idempotency_key/);
  assert.match(flowHardeningFollowupsMigration, /evaluate_client_feature_flag\(/);
  assert.match(flowHardeningFollowupsMigration, /missing_idempotency_key/);
  assert.match(flowHardeningFollowupsMigration, /REVOKE ALL ON FUNCTION public\.spend_video_date_credit_extension\(uuid, text, text\) FROM PUBLIC, anon/);
});

test("definitive flow hardening activates core flags and keeps legacy extension retries idempotent", () => {
  for (const flag of [
    "video_date.readiness_v2",
    "video_date.broadcast_v2",
    "video_date.timeline_v2",
    "video_date.extension_mutual_v2",
    "video_date.outbox_v2.extension",
    "video_date.daily_token_refresh_v2",
    "video_date.multi_device_dedup_v2",
  ]) {
    assert.match(definitiveFlowHardeningMigration, new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(definitiveFlowHardeningMigration, /enabled = true/);
  assert.match(definitiveFlowHardeningMigration, /rollout_bps = 10000/);
  assert.match(definitiveFlowHardeningMigration, /kill_switch_active = public\.client_feature_flags\.kill_switch_active/);
  assert.doesNotMatch(definitiveFlowHardeningMigration, /ON CONFLICT \(flag_key\) DO UPDATE[\s\S]{0,160}kill_switch_active = false/);
  assert.match(definitiveCloudAlignmentMigration, /UPDATE public\.client_feature_flags f[\s\S]*rollout_bps = 10000/);
  assert.doesNotMatch(definitiveCloudAlignmentMigration, /kill_switch_active\s*=/);
  assert.doesNotMatch(definitiveFlowHardeningMigration, /'video_date\.daily_pool_v2'/);
  assert.match(definitiveFlowHardeningMigration, /legacy-no-key-v1:/);
  assert.match(definitiveFlowHardeningMigration, /legacy_idempotency/);
  assert.match(definitiveFlowHardeningMigration, /NOT v_client_supplied_key/);
  assert.doesNotMatch(definitiveFlowHardeningMigration, /missing_idempotency_key/);
});

test("definitive cloud alignment closes anon Video Date RPC and table grants without breaking clients", () => {
  for (const rpc of [
    "advance_video_session_vibe_question\\(uuid\\)",
    "get_or_seed_video_session_vibe_questions\\(uuid, jsonb\\)",
    "find_video_date_match\\(uuid, uuid\\)",
    "repair_stale_video_date_prepare_entries\\(integer\\)",
    "video_date_pair_has_terminal_encounter\\(uuid, uuid, uuid, uuid\\)",
    "enforce_one_active_video_session\\(\\)",
    "enrich_video_date_transition_observability\\(\\)",
  ]) {
    assert.match(definitiveCloudAlignmentMigration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}[\\s\\S]+FROM PUBLIC, anon`));
  }

  assert.match(definitiveCloudAlignmentMigration, /GRANT EXECUTE ON FUNCTION public\.advance_video_session_vibe_question\(uuid\)[\s\S]+TO authenticated, service_role/);
  assert.match(definitiveCloudAlignmentMigration, /GRANT EXECUTE ON FUNCTION public\.get_or_seed_video_session_vibe_questions\(uuid, jsonb\)[\s\S]+TO authenticated, service_role/);
  assert.match(definitiveCloudAlignmentMigration, /GRANT EXECUTE ON FUNCTION public\.repair_stale_video_date_prepare_entries\(integer\)[\s\S]+TO service_role/);
  assert.match(definitiveCloudAlignmentMigration, /REVOKE ALL ON TABLE public\.date_feedback FROM PUBLIC, anon/);
  assert.match(definitiveCloudAlignmentMigration, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.date_feedback TO authenticated/);
  assert.match(definitiveCloudAlignmentMigration, /REVOKE ALL ON TABLE public\.event_registrations FROM PUBLIC, anon/);
  assert.match(definitiveCloudAlignmentMigration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.event_registrations TO authenticated/);
  assert.match(eventRegistrationDmlLockdownMigration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER[\s\S]+ON TABLE public\.event_registrations[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(eventRegistrationDmlLockdownMigration, /GRANT SELECT ON TABLE public\.event_registrations TO authenticated/);
  assert.doesNotMatch(eventRegistrationDmlLockdownMigration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.event_registrations TO authenticated/);
  assert.match(definitiveCloudAlignmentMigration, /REVOKE ALL ON TABLE public\.event_swipes FROM PUBLIC, anon/);
  assert.match(definitiveCloudAlignmentMigration, /GRANT SELECT ON TABLE public\.event_swipes TO authenticated/);
  assert.match(definitiveCloudAlignmentMigration, /REVOKE ALL ON TABLE public\.video_sessions FROM PUBLIC, anon/);
  assert.match(definitiveCloudAlignmentMigration, /GRANT SELECT ON TABLE public\.video_sessions TO authenticated/);
  assert.match(definitiveCloudAlignmentMigration, /REVOKE ALL ON TABLE public\.video_date_credit_extension_spends FROM PUBLIC, anon, authenticated/);
});

test("legacy direct queue and session RPCs are removed from the current backend contract", () => {
  assert.match(
    legacyQueueSessionRpcRemovalMigration,
    /DROP FUNCTION IF EXISTS public\.find_video_date_match\(uuid, uuid\)/,
  );
  assert.match(
    legacyQueueSessionRpcRemovalMigration,
    /DROP FUNCTION IF EXISTS public\.join_matching_queue\(uuid, uuid\)/,
  );
  assert.doesNotMatch(legacyQueueSessionRpcRemovalMigration, /DROP FUNCTION IF EXISTS public\.leave_matching_queue/i);
  assert.match(
    legacyQueueCleanupRpcRemovalMigration,
    /DROP FUNCTION IF EXISTS public\.leave_matching_queue\(uuid\)/,
  );
  assert.doesNotMatch(legacyQueueCleanupRpcRemovalMigration, /DROP FUNCTION IF EXISTS public\.drain_match_queue/i);
  assert.doesNotMatch(legacyQueueCleanupRpcRemovalMigration, /DROP FUNCTION IF EXISTS public\.promote_ready_gate_if_eligible/i);
  assert.doesNotMatch(legacyQueueCleanupRpcRemovalMigration, /ALTER TABLE[\s\S]*session_source/i);
  assert.doesNotMatch(legacyQueueCleanupRpcRemovalMigration, /DROP COLUMN[\s\S]*session_source/i);
  assert.match(sessionSourceRemovalMigration, /DROP COLUMN IF EXISTS session_source/);
  assert.doesNotMatch(sessionSourceRemovalMigration, /DROP FUNCTION IF EXISTS public\.drain_match_queue/i);
  assert.doesNotMatch(sessionSourceRemovalMigration, /DROP FUNCTION IF EXISTS public\.promote_ready_gate_if_eligible/i);
});

test("web lobby treats readiness as non-blocking diagnostics for deck swipes", () => {
  assert.match(webLobby, /useNonBlockingVideoDateReadiness\(\s*eventId,/);
  assert.match(webLobby, /disabled=\{swipeControlsDisabled \|\| superVibeRemaining <= 0\}/);
  assert.match(webLobby, /disabled=\{swipeControlsDisabled\}/);
  assert.match(webLobby, /onSwipeRight=\{handleVibe\}/);
  assert.match(webLobby, /if \(event\.key === "ArrowLeft"\)[\s\S]*if \(swipeControlsDisabled\) return[\s\S]*else if \(event\.key === "ArrowRight"\)[\s\S]*if \(swipeControlsDisabled\) return/);
  assert.match(webLobby, /if \(info\.offset\.x > threshold\) \{[\s\S]*haptics\.light\(\);[\s\S]*onSwipeRight\(\);/);
  assert.doesNotMatch(webLobby, /pairingBlockedByReadiness|pairingControlsDisabled|pairingReadinessMessage|rightSwipeDisabled/);
  assert.doesNotMatch(webLobby, /canAttemptPairing|readinessBlockMessage/);
  assert.doesNotMatch(webSwipeAction, /requestWebPairingMediaReadiness|canAttemptPairing|readinessBlockMessage/);
  assert.doesNotMatch(webSwipeAction, /navigator\.mediaDevices\.getUserMedia\(\{ video: true, audio: true \}\)/);
});

test("native lobby treats readiness as non-blocking diagnostics for deck swipes", () => {
  assert.match(nativeLobby, /useNonBlockingVideoDateReadiness\(\s*id,/);
  assert.match(nativeLobby, /disabled=\{\s*swipeActionsDisabled \|\| superVibeRemaining <= 0\s*\}/);
  assert.match(nativeLobby, /disabled=\{swipeActionsDisabled\}/);
  assert.match(nativeLobby, /accessibilityRole="button"[\s\S]*accessibilityLabel="Pass"[\s\S]*accessibilityState=\{\{\s*disabled: swipeActionsDisabled\s*\}\}/);
  assert.match(nativeLobby, /accessibilityRole="button"[\s\S]*accessibilityLabel="Super vibe"[\s\S]*accessibilityState=\{\{\s*disabled:\s*swipeActionsDisabled \|\| superVibeRemaining <= 0,?\s*\}\}/);
  assert.match(nativeLobby, /accessibilityRole="button"[\s\S]*accessibilityLabel="Vibe"[\s\S]*accessibilityState=\{\{\s*disabled: swipeActionsDisabled\s*\}\}/);
  assert.doesNotMatch(nativeLobby, /pairingBlockedByReadiness|pairingActionsDisabled|pairingReadinessMessage/);
  assert.doesNotMatch(nativeLobby, /recoverPairingReadinessAndRetry|requestNativeCameraMicrophonePermissions/);
  assert.doesNotMatch(nativeLobby, /canAttemptPairing|options\.bypassReadiness/);
});

test("Ready Gate remains the media permission enforcement surface", () => {
  assert.match(webReadyGateOverlay, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(webReadyGateOverlay, /ready_tap_permission_not_ready/);
  assert.match(nativeReadyGateOverlay, /requestNativeCameraMicrophonePermissions/);
  assert.match(nativeReadyGateOverlay, /ready_tap_permission_not_ready/);
});

test("handle_swipe_v2 does not use runtime media readiness as deck swipe eligibility", () => {
  const handleSwipeV2 = sqlFunctionSection(eventDeckAuthorityMigration, "handle_swipe_v2");
  assert.match(handleSwipeV2, /event_deck_validate_presented_card/);
  assert.doesNotMatch(handleSwipeV2, /readiness_status|record_readiness_check_v2|camera|microphone/i);
});

test("canonical video-date rollout flags and compatibility aliases are documented and typed", () => {
  assert.deepEqual(VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS.readyGateResilientClock.canonical, [
    "video_date.timeline_v2",
    "video_date.broadcast_v2",
  ]);
  assert.deepEqual(VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS.readyGateResilientClock.aliases, [
    "video_date.ready_gate_resilient_clock_v1",
  ]);
  assert.deepEqual(VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS.pushOpenDedupe.canonical, [
    "video_date.multi_device_dedup_v2",
  ]);
  assert.deepEqual(VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS.pushOpenDedupe.aliases, [
    "video_date.push_open_dedupe_v1",
  ]);
  assert.deepEqual(VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS.verdictConfirmation.canonical, [
    "video_date.verdict_confirm_v2",
  ]);
  assert.deepEqual(VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS.verdictConfirmation.aliases, [
    "video_date.verdict_confirm_v1",
  ]);
  assert.deepEqual(VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS.deckOptimisticPolish.canonical, [
    "video_date.deck_prefetch_polish_v2",
  ]);
  assert.deepEqual(VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS.deckOptimisticPolish.aliases, [
    "video_date.deck_optimistic_v1",
  ]);
  assert.match(videoDateFlags, /VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS/);
  assert.match(aliasHelper, /canonical\?\.source === "kill_switched"/);
  assert.match(phase8Runbook, /v1 names are compatibility aliases/);
  assert.match(phase8Runbook, /canonical kill switch wins over an enabled alias/);
});

test("required certification template keeps original acceptance criteria explicit", () => {
  const template = JSON.parse(requiredCertificationTemplate) as Record<string, unknown>;
  const serialized = JSON.stringify(template);

  for (const requiredToken of [
    "feature_flags",
    "daily_env_readiness",
    "DAILY_API_KEY",
    "DAILY_DOMAIN",
    "DAILY_WEBHOOK_SECRET",
    "CRON_SECRET",
    "test:video-date-runtime-rls:required",
    "web_two_user_staging_e2e",
    "ios_two_user_manual",
    "android_two_user_manual",
    "daily_webhook_real_event",
    "rollback_owner",
    "incident_owner",
    "all_baseline_and_targeted_tests_pass",
    "two_user_staging_run_complete",
    "no_known_stuck_ready_gate_handshake_date_queued_or_pending_survey_path",
    "no_public_rpc_or_edge_contract_broken",
    "launch_runbook_has_secrets_flags_slos_dashboards_and_rollback",
  ]) {
    assert.match(serialized, new RegExp(requiredToken));
  }

  assert.match(serialized, /pending_user_owned/);
  assert.doesNotMatch(serialized, /"passed"/);
});

test("closure manual smoke and tooling notes are recorded without inventing new ledger work", () => {
  for (const phrase of [
    "Ready Gate reconnect after degraded/closed realtime",
    "push deep link on two devices",
    "post-date verdict confirmation plus next-surface fallback",
    "deck optimistic swipe rollback plus in-card 429 retry state",
    "Daily room cleanup dry-run/rate-limit response",
    "existing Phase 8 certification tooling",
    "Web and native builds plus real-device smoke are release activities",
    "Supabase CLI v2.101.0 or newer is recommended",
    "Node `DEP0205` warning is non-blocking",
  ]) {
    assert.match(phase8Runbook, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
