import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const stableBilateralMediaMigration = read(
  "supabase/migrations/20260609014410_video_date_stable_bilateral_media_gate.sql",
);
const autoPromoteGateMigration = read(
  "supabase/migrations/20260609022729_video_date_auto_promote_stable_bilateral_media_gate.sql",
);
const oneSidedRemoteSeenGuardMigration = read(
  "supabase/migrations/20260609031421_video_date_stable_bilateral_media_one_sided_guard.sql",
);
const definitiveActiveMediaOwnershipMigration = read(
  "supabase/migrations/20260609035833_video_date_definitive_active_media_ownership.sql",
);
const preStableSurveyEligibilityMigration = read(
  "supabase/migrations/20260609045533_video_date_pre_stable_survey_eligibility.sql",
);
const videoDateGateMigrations = [
  stableBilateralMediaMigration,
  autoPromoteGateMigration,
  oneSidedRemoteSeenGuardMigration,
  definitiveActiveMediaOwnershipMigration,
].join("\n");
const webVideoDate = read("src/pages/VideoDate.tsx");
const webVideoCall = read("src/hooks/useVideoCall.ts");
const webSurfaceGuard = read("src/hooks/useVideoDateDupTabGuard.ts");
const webPostDateSurvey = read("src/components/video-date/PostDateSurvey.tsx");
const nativeDateRoute = read("apps/mobile/app/date/[id].tsx");
const nativePostDateSurvey = read("apps/mobile/components/video-date/PostDateSurvey.tsx");
const routeDecision = read("shared/matching/videoDateRouteDecision.ts");
const supabaseTypes = read("src/integrations/supabase/types.ts");
const packageJson = read("package.json");

function publicFunctionBody(source: string, name: string): string {
  const start = source.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = source.indexOf("$function$;", start);
  assert.notEqual(end, -1, `${name} should have a dollar-quoted body`);
  return source.slice(start, end);
}

test("web date route owns from allowed access while Daily singleton excludes terminal states", () => {
  const singletonStart = webVideoDate.indexOf("dailyCallSingletonEligible:");
  assert.notEqual(singletonStart, -1, "web Daily singleton eligibility should exist");
  const singletonEnd = webVideoDate.indexOf("videoSessionState: phase", singletonStart);
  assert.notEqual(
    singletonEnd,
    -1,
    "web Daily singleton eligibility should stay next to the hook options",
  );
  const singletonEligibility = webVideoDate.slice(singletonStart, singletonEnd);
  assert.match(singletonEligibility, /!showFeedback/);
  assert.match(singletonEligibility, /!terminalSurveyRecoveryActive/);
  assert.match(singletonEligibility, /phase !== "ended"/);
  assert.match(singletonEligibility, /videoDateAccess === "allowed"/);
  assert.match(singletonEligibility, /videoSessionHasEncounterExposureTruth\(handshakeTruth\)/);
  assert.ok(
    singletonEligibility.indexOf("!showFeedback") <
      singletonEligibility.indexOf('videoDateAccess === "allowed"'),
    "feedback/terminal exclusions must dominate allowed-route singleton preservation",
  );

  const routeOwnerEffect = webVideoDate.match(
    /useEffect\(\(\) => \{\s*\n\s*if \(!id \|\| !user\?\.id \|\| videoDateAccess !== "allowed"\) return;[\s\S]*?VIDEO_DATE_ROUTE_OWNERSHIP_REFRESH_MS,[\s\S]*?\}, \[[\s\S]*?videoDateAccess,[\s\S]*?\]\);/,
  );
  assert.ok(routeOwnerEffect, "web route ownership effect should be access-bound");
  assert.match(routeOwnerEffect[0], /if \(dupBlocked\) return/);
  assert.match(routeOwnerEffect[0], /markVideoDateRouteOwned\(id, user\.id\)/);
  assert.doesNotMatch(routeOwnerEffect[0], /shouldOwnDateRoute/);
  assert.doesNotMatch(routeOwnerEffect[0], /callStarted/);
  assert.doesNotMatch(routeOwnerEffect[0], /dailyMeetingState/);
  assert.doesNotMatch(routeOwnerEffect[0], /localInDailyRoom/);
});

test("web Daily start is coalesced by a module-scope gate across full remounts", () => {
  assert.match(webVideoCall, /WEB_VIDEO_DATE_START_GATE_TTL_MS = 60_000/);
  assert.match(webVideoCall, /const webVideoDateStartGateEntries = new Map/);
  assert.match(webVideoCall, /skipStartGate\?: boolean/);
  assert.match(webVideoCall, /getWebVideoDateStartGateEntry\(sessionId, userId\)/);
  assert.match(webVideoCall, /daily_call_start_gate_joined/);
  assert.match(webVideoCall, /const activeGateResult = await activeGate\.promise/);
  assert.match(webVideoCall, /daily_call_start_gate_adopt_current_owner/);
  assert.match(webVideoCall, /internalRetry: true,[\s\S]*skipStartGate: true/);
  assert.match(webVideoCall, /daily_call_start_gate_registered/);
  assert.match(webVideoCall, /void promise\.then\(clearEntry, clearEntry\)/);
  assert.match(webVideoCall, /registerWebVideoDateStartGateEntry\(\s*sessionId,\s*userId,\s*gatedPromise/s);
  assert.match(webVideoCall, /skipStartGate: true/);
  assert.match(webVideoCall, /WEB_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS = 6/);
  assert.match(webVideoCall, /daily_call_busy_exhausted/);
  assert.match(webVideoCall, /attempt_count: WEB_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS/);
});

test("native date route owns pre-join and preserves live Daily handoff before date establishment", () => {
  const routeOwnerEffect = nativeDateRoute.match(
    /useEffect\(\(\) => \{\s*\n\s*if \(!sessionId \|\| !user\?\.id\) return;[\s\S]*?if \(!dateEntryPermissionEligible && !terminalSurveyOwner\) return;[\s\S]*?VIDEO_DATE_ROUTE_OWNERSHIP_REFRESH_MS,[\s\S]*?\}, \[[\s\S]*?dateEntryPermissionEligible,[\s\S]*?user\?\.id,[\s\S]*?\]\);/,
  );
  assert.ok(routeOwnerEffect, "native route ownership effect should be permission-bound");
  assert.match(routeOwnerEffect[0], /markVideoDateRouteOwned\(sessionId, user\.id\)/);
  assert.doesNotMatch(routeOwnerEffect[0], /shouldOwnDateRoute/);
  assert.doesNotMatch(routeOwnerEffect[0], /hasStartedJoinRef\.current/);
  assert.doesNotMatch(routeOwnerEffect[0], /joining/);
  assert.doesNotMatch(routeOwnerEffect[0], /localInDailyRoom/);

  const cleanupBlock = nativeDateRoute.match(
    /const meetingStateBeforeCleanup = safeNativeDailyMeetingState\(call\);[\s\S]*?if \(shouldParkSingleton && parkSharedCallForWarmHandoff\(call, cleanupReason\)\)/,
  );
  assert.ok(cleanupBlock, "native cleanup should inspect meeting state before parking");
  assert.doesNotMatch(cleanupBlock[0], /dateEstablishedRef\.current/);
  assert.match(cleanupBlock[0], /meetingStateBeforeCleanup !== "left-meeting"/);
  assert.match(cleanupBlock[0], /meetingStateBeforeCleanup !== "error"/);
  assert.match(nativeDateRoute, /heartbeatPreserved: true/);
  assert.match(nativeDateRoute, /NATIVE_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS = 6/);
  assert.match(nativeDateRoute, /attempt <= NATIVE_VIDEO_DATE_DAILY_GUARD_CREATE_MAX_ATTEMPTS/);
  assert.match(nativeDateRoute, /dateEntryPermissionEligible \|\|[\s\S]{0,180}phase === "handshake"[\s\S]{0,180}phase === "date"/);
});

test("server promotion requires stable bilateral media, surface ownership, and no already-date shortcut", () => {
  const gate = publicFunctionBody(
    videoDateGateMigrations,
    "video_date_stable_bilateral_media_gate_v1",
  );
  const surfaceClaims = publicFunctionBody(
    videoDateGateMigrations,
    "video_date_active_surface_claims_v1",
  );
  const marker = publicFunctionBody(
    videoDateGateMigrations,
    "video_date_mark_stable_bilateral_media_v1",
  );
  const provider = publicFunctionBody(
    videoDateGateMigrations,
    "video_date_promote_provider_overlap_v1",
  );
  const confirmed = publicFunctionBody(
    videoDateGateMigrations,
    "video_date_promote_confirmed_encounter_v1",
  );
  const autoPromote = publicFunctionBody(
    videoDateGateMigrations,
    "video_session_handshake_auto_promote_v2",
  );

  assert.match(definitiveActiveMediaOwnershipMigration, /ADD COLUMN IF NOT EXISTS stable_bilateral_media_at timestamptz/);
  assert.match(definitiveActiveMediaOwnershipMigration, /ADD COLUMN IF NOT EXISTS stable_bilateral_media_detail jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(surfaceClaims, /video_date_surface_claims c/);
  assert.match(surfaceClaims, /c\.surface = 'video_date'/);
  assert.match(surfaceClaims, /c\.released_at IS NULL/);
  assert.match(surfaceClaims, /c\.expires_at > v_now/);
  assert.match(surfaceClaims, /'both_active', v_p1_active AND v_p2_active/);
  assert.match(gate, /video_date_stable_copresence_v1\(p_session_id\)/);
  assert.match(gate, /video_date_active_surface_claims_v1\(p_session_id\)/);
  assert.match(gate, /heartbeat_overlap/);
  assert.match(gate, /heartbeat_fresh/);
  assert.match(gate, /remote_seen/);
  assert.match(gate, /NOT v_one_remote_seen/);
  assert.match(gate, /v_surface_ready := COALESCE\(\(v_surface->>'both_active'\)::boolean, false\)/);
  assert.match(gate, /v_stable_bilateral_media := v_surface_ready AND \(v_heartbeat_ready OR v_bilateral_remote_seen\)/);
  assert.match(
    gate,
    /v_heartbeat_ready :=[\s\S]{0,180}AND NOT v_one_remote_seen[\s\S]{0,240}heartbeat_overlap[\s\S]{0,240}heartbeat_fresh/,
  );
  assert.match(gate, /already_date_requires_stable_bilateral_media_certification/);
  assert.doesNotMatch(gate, /'reason', 'already_date'/);
  assert.match(gate, /bilateral_remote_seen_required/);
  assert.match(gate, /stable_bilateral_owner_heartbeat/);
  assert.match(gate, /stable_bilateral_remote_seen/);
  assert.match(marker, /stable_bilateral_media_at = COALESCE\(stable_bilateral_media_at, v_now\)/);
  assert.match(marker, /stable_bilateral_media_detail = CASE/);

  assert.match(provider, /video_date_session_lifecycle_eligibility_v1/);
  assert.match(provider, /video_date_stable_bilateral_media_gate_v1\(p_session_id\)/);
  assert.match(provider, /video_date_mark_stable_bilateral_media_v1/);
  assert.match(provider, /stable_bilateral_media_promotion_waiting/);
  assert.match(provider, /promotion_blocked_by_stable_bilateral_media/);
  assert.match(provider, /vd_provider_overlap_stable_media_base/);
  assert.ok(
    provider.indexOf("video_date_stable_bilateral_media_gate_v1") <
      provider.indexOf("vd_provider_overlap_stable_media_base"),
    "provider promotion must gate before delegating to the old promoter",
  );

  assert.match(confirmed, /video_date_stable_bilateral_media_gate_v1\(p_session_id\)/);
  assert.match(confirmed, /video_date_mark_stable_bilateral_media_v1/);
  assert.match(confirmed, /confirmed_encounter_stable_bilateral_media_waiting/);
  assert.match(confirmed, /promotion_blocked_by_stable_bilateral_media/);
  assert.match(confirmed, /vd_promote_ce_stable_media_base/);

  assert.match(autoPromote, /video_date_session_lifecycle_eligibility_v1/);
  assert.match(autoPromote, /video_date_stable_bilateral_media_gate_v1\(p_session_id\)/);
  assert.match(autoPromote, /video_date_mark_stable_bilateral_media_v1/);
  assert.match(autoPromote, /stable_bilateral_media_auto_promotion_waiting/);
  assert.match(autoPromote, /promotion_blocked_by_stable_bilateral_media/);
  assert.match(autoPromote, /vd_auto_promote_stable_media_base/);
  assert.match(autoPromote, /stable_bilateral_media_gate_checked/);
  assert.ok(
    autoPromote.indexOf("video_date_stable_bilateral_media_gate_v1") <
      autoPromote.indexOf("vd_auto_promote_stable_media_base"),
    "auto-promotion must gate before delegating to the old promoter",
  );
});

test("pre-stable provider absence resumes users instead of opening survey", () => {
  const absence = publicFunctionBody(
    videoDateGateMigrations,
    "video_date_reconcile_provider_absence_v1",
  );
  const legacyEligibility = publicFunctionBody(
    preStableSurveyEligibilityMigration,
    "video_date_session_is_post_date_survey_eligible",
  );
  const confirmedEligibility = publicFunctionBody(
    preStableSurveyEligibilityMigration,
    "video_date_session_is_post_date_survey_eligible_v2",
  );

  assert.match(absence, /vd_absence_stable_media_base/);
  assert.match(absence, /v_session\.stable_bilateral_media_at IS NOT NULL/);
  assert.match(absence, /ended_reason = 'pre_stable_media_failed'/);
  assert.match(absence, /queue_status = v_resume_status/);
  assert.match(absence, /current_room_id = NULL/);
  assert.match(absence, /current_partner_id = NULL/);
  assert.match(absence, /pre_stable_media_failed_no_survey/);
  assert.match(absence, /'survey_required', false/);
  assert.match(absence, /'stable_bilateral_media_required_for_survey', true/);
  assert.match(legacyEligibility, /'pre_stable_media_failed'/);
  assert.match(confirmedEligibility, /'pre_stable_media_failed'/);
  assert.match(confirmedEligibility, /video_date_session_has_confirmed_encounter/);
  assert.match(routeDecision, /"pre_stable_media_failed"/);
});

test("active surface ownership is continuous across web and native route churn", () => {
  assert.match(webSurfaceGuard, /SERVER_CLAIM_BRIDGE_MS = 45_000/);
  assert.match(webSurfaceGuard, /const bridgedServerSurfaceOwners = new Map/);
  assert.match(webSurfaceGuard, /startServerSurfaceClaimBridge/);
  assert.match(webSurfaceGuard, /claim_video_date_surface/);
  assert.match(webSurfaceGuard, /release_video_date_surface_claim/);
  assert.match(webSurfaceGuard, /shouldBridgeOnCleanup\?: \(\) => boolean/);
  assert.match(webSurfaceGuard, /useLayoutEffect/);
  assert.match(webSurfaceGuard, /Passive lease cleanup must see the newest terminal\/exit bridge decision/);
  assert.match(webSurfaceGuard, /shouldBridgeOnCleanupRef\.current = shouldBridgeOnCleanup/);
  assert.match(webSurfaceGuard, /waitingForClaimableTruth = payload\?\.code === "SURFACE_NOT_CLAIMABLE"/);
  assert.match(webSurfaceGuard, /if \(waitingForClaimableTruth\) \{[\s\S]{0,180}serverClaimBackoffUntilRef\.current = 0/);
  assert.match(webSurfaceGuard, /const shouldBridge = shouldBridgeOnCleanupRef\.current\?\.\(\) \?\? true/);
  assert.match(webSurfaceGuard, /clearServerSurfaceClaimBridge\(activeKey, serverClientInstanceId\)/);
  assert.match(webVideoDate, /const videoDateSurfaceClaimable =/);
  assert.match(webVideoDate, /Boolean\(handshakeStartedAt\)/);
  assert.match(webVideoDate, /Boolean\(dateStartedAt\)/);
  assert.match(webVideoDate, /serverTimeline\?\.phase === "handshake"[\s\S]{0,120}serverTimeline\.phaseStartedAtMs !== null/);
  assert.match(webVideoDate, /const videoDateSurfaceLeaseActive =/);
  assert.match(webVideoDate, /videoDateAccess === "allowed" &&[\s\S]{0,80}videoDateSurfaceClaimable/);
  assert.match(webVideoDate, /shouldBridgeVideoDateSurfaceOnCleanup/);
  assert.match(webVideoDate, /!manualExitInFlightRef\.current/);
  assert.match(webVideoDate, /!terminalSurveyRecoveryInFlightRef\.current/);
  assert.match(webVideoDate, /!surveyOpenedRef\.current/);
  assert.match(webVideoDate, /explicitEndRequestedRef\.current === "idle"/);
  assert.match(webVideoDate, /useVideoDateDupTabGuard\([\s\S]{0,180}videoDateSurfaceLeaseActive,[\s\S]{0,120}shouldBridgeVideoDateSurfaceOnCleanup/);
  assert.match(webVideoDate, /routeMountIdRef/);
  assert.match(webVideoDate, /date_route_ownership_refresh/);
  assert.match(webVideoDate, /routeOwnerId: `\$\{user\.id\}:\$\{id\}`/);
  assert.match(nativeDateRoute, /routeMountIdRef/);
  assert.match(nativeDateRoute, /native_date_route_ownership_refresh/);
  assert.match(nativeDateRoute, /routeOwnerId: `\$\{user\.id\}:\$\{sessionId\}`/);
  assert.match(nativeDateRoute, /dateEntryPermissionEligible \|\|[\s\S]{0,240}isConnecting[\s\S]{0,120}joining[\s\S]{0,120}localInDailyRoom/);
});

test("survey verdict cannot advance until the actor date_feedback row is visible", () => {
  for (const [name, source] of [
    ["web", webPostDateSurvey],
    ["native", nativePostDateSurvey],
  ] as const) {
    assert.match(source, /confirmActorFeedbackRow/);
    assert.match(source, /\.from\(["']date_feedback["']\)[\s\S]{0,240}\.select\(["']session_id,user_id,liked,created_at["']\)/, name);
    assert.match(source, /\.eq\(["']session_id["'], sessionId\)[\s\S]{0,180}\.eq\(["']user_id["'],/);
    assert.match(source, /date_feedback_row_missing_after_verdict/);
    assert.match(source, /const feedbackRowConfirmed = await confirmActorFeedbackRow\(liked, ['"]verdict_submitted['"]\)/);
    assert.match(source, /confirmActorFeedbackRow\(false, ['"]report_before_verdict['"]\)/);
  }
});

test("stable bilateral media gate is part of the required video-date suites", () => {
  assert.match(packageJson, /videoDateStableBilateralMediaGateContracts\.test\.ts/);
  assert.match(supabaseTypes, /stable_bilateral_media_at: string \| null/);
  assert.match(supabaseTypes, /stable_bilateral_media_detail: Json/);
  assert.match(supabaseTypes, /video_date_active_surface_claims_v1/);
  assert.match(supabaseTypes, /video_date_mark_stable_bilateral_media_v1/);
  assert.match(supabaseTypes, /video_date_stable_bilateral_media_gate_v1/);
  assert.match(supabaseTypes, /vd_provider_overlap_stable_media_base/);
  assert.match(supabaseTypes, /vd_promote_ce_stable_media_base/);
  assert.match(supabaseTypes, /vd_auto_promote_stable_media_base/);
});
