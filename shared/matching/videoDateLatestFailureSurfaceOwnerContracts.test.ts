import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { readWebVideoDateNavigationIntentsSource } from "../testUtils/webVideoDateFlowSources";
import { readNativeVideoDateNavigationIntentsSource, readNativeVideoDateScreenFlowSource } from "../testUtils/nativeVideoDateFlowSources";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function publicFunctionBody(migration: string, name: string): string {
  const match = migration.match(
    new RegExp(
      String.raw`CREATE OR REPLACE FUNCTION public\.${name}\([\s\S]*?\n\$function\$;`,
      "m",
    ),
  );
  assert.ok(match, `expected ${name} function body to exist`);
  return match[0];
}

const webRouteHydration = read(
  "src/components/session/SessionRouteHydration.tsx",
);
const webLobby = read("src/pages/EventLobby.tsx");
const webDateNavGuard = readWebVideoDateNavigationIntentsSource(root);
const nativeRouteHydration = read(
  "apps/mobile/components/NativeSessionRouteHydration.tsx",
);
const nativeDateNavGuard = readNativeVideoDateNavigationIntentsSource(root);
// PR 8.5: ready screen body split across lib/videoDate sub-hooks; read the family.
const nativeReadyRoute = [
  "apps/mobile/lib/videoDate/useNativeReadyGateMediaPermissions.ts",
  "apps/mobile/lib/videoDate/useNativeReadyGateTruthReconcile.ts",
  "apps/mobile/lib/videoDate/useNativeReadyGateForfeitExpiry.ts",
  "apps/mobile/app/ready/[id].tsx",
]
  .map(read)
  .join("\n");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const nativeDateRoute = readNativeVideoDateScreenFlowSource();
const nativeActiveSessionRoutes = read(
  "apps/mobile/lib/activeSessionRoutes.ts",
);
const outerFailsoftMigration = read(
  "supabase/migrations/20260605170249_video_date_surface_owner_outer_failsoft.sql",
);
const singleOwnerRuntimeMigration = read(
  "supabase/migrations/20260605232304_video_date_single_owner_runtime_hardening.sql",
);
const autoNextRemovalMigration = read(
  "supabase/migrations/20260610000100_remove_post_date_instant_next.sql",
);
const vibeQuestionBaseNameRepairMigration = read(
  "supabase/migrations/20260605174703_video_date_vibe_question_outer_base_name_repair.sql",
);

test("web route hydration makes active video or survey the single route owner", () => {
  assert.match(webRouteHydration, /lastActiveVideoRedirectKey/);
  assert.match(
    webRouteHydration,
    /activeSession\?\.kind === "video" && activeSession\.sessionId/,
  );
  assert.match(
    webRouteHydration,
    /markVideoDateRouteOwned\(activeSession\.sessionId, user\.id\)/,
  );
  assert.match(webRouteHydration, /activeSession\.queueStatus === "in_survey"/);
  assert.match(webRouteHydration, /forceSurvey/);
  assert.match(webRouteHydration, /route_hydration_active_video_redirect/);
  assert.match(
    webRouteHydration,
    /route_hydration_active_video_same_session_survey/,
  );
  assert.match(
    webRouteHydration,
    /navigate\(target,\s*\{[\s\S]*source: "session_route_hydration_active_video"[\s\S]*forceSurvey/s,
  );
  assert.match(
    webRouteHydration,
    /source: "session_route_hydration_active_video_same_session_survey"[\s\S]*forceSurvey: true/s,
  );
});

test("web EventLobby treats in_survey as date-stack owned and never prepares Daily for it", () => {
  assert.match(
    webLobby,
    /status === "in_handshake" \|\| status === "in_date" \|\| status === "in_survey"/,
  );
  assert.match(
    webLobby,
    /function isDailyEntryQueueStatus\([\s\S]{0,90}status: unknown,[\s\S]{0,90}\): status is "in_handshake" \| "in_date"/,
  );
  assert.match(webDateNavGuard, /force\?: boolean/);
  assert.match(webDateNavGuard, /const force = options\.force === true/);
  assert.match(
    webDateNavGuard,
    /!force && isDateNavigationSuppressedAfterManualExit/,
  );
  assert.match(
    webDateNavGuard,
    /!force &&[\s\S]{0,160}lastDateNavigation\?\.sessionId === sessionId/,
  );
  assert.match(
    webLobby,
    /const force = options\.force === true \|\| options\.forceSurvey === true/,
  );
  assert.match(
    webLobby,
    /claimDateNavigation\(sessionId, location\.pathname, \{[\s\S]{0,40}force,[\s\S]{0,40}\}\)/,
  );
  assert.match(
    webLobby,
    /scopedSessionQueueStatus === "in_survey"[\s\S]{0,120}\{ force: true, forceSurvey: true \}/,
  );
  assert.match(
    webLobby,
    /queueStatus === "in_survey" && currentRoomId[\s\S]{0,760}navigateToDateSession\([\s\S]{0,160}"registration_realtime_pending_survey"[\s\S]{0,140}force: true,[\s\S]{0,120}forceSurvey: true/s,
  );
  assert.match(
    webLobby,
    /isDailyEntryQueueStatus\(queueStatus\) && currentRoomId[\s\S]{0,620}navigateToDateSession\([\s\S]{0,120}"registration_realtime_active_date"/,
  );
  assert.doesNotMatch(
    webLobby,
    /registration_realtime_active_date[\s\S]{0,260}prepareAndNavigateToDateSession/,
  );
  assert.match(
    webLobby,
    /ready_gate_open_suppressed_by_video_session_ownership/,
  );
  assert.match(
    webLobby,
    /routeDecision\.target === "survey"[\s\S]{0,620}navigateToDateSession\(sessionId, `\$\{source\}_pending_survey`, \{[\s\S]{0,120}force: true,[\s\S]{0,120}forceSurvey: true/s,
  );
  assert.match(
    webLobby,
    /state:[\s\S]{0,80}options\.forceSurvey === true[\s\S]{0,80}\? \{ source, forceSurvey: true \}[\s\S]{0,80}: \{ source \}/,
  );
  assert.doesNotMatch(
    webLobby,
    /routeDecision\.target === "survey"[\s\S]{0,520}prepareAndNavigateToDateSession/,
  );
});

test("native route hydration and navigation guard force terminal survey ownership", () => {
  assert.match(nativeRouteHydration, /lastActiveVideoKey/);
  assert.match(
    nativeRouteHydration,
    /activeSession\?\.kind === ["']video["'] && activeSession\.sessionId/,
  );
  assert.match(
    nativeRouteHydration,
    /markVideoDateRouteOwned\(activeSession\.sessionId, user\.id\)/,
  );
  assert.match(nativeRouteHydration, /active_video_route_owner_redirect/);
  assert.match(
    nativeRouteHydration,
    /force_survey: activeSession\.queueStatus === ["']in_survey["']/,
  );
  assert.match(nativeRouteHydration, /router\.replace\(target\)/);

  assert.match(nativeDateNavGuard, /force\?: boolean/);
  assert.match(
    nativeDateNavGuard,
    /const \{ sessionId, pathname, mode = 'replace', force = false/,
  );
  assert.match(
    nativeDateNavGuard,
    /!force && isDateNavigationSuppressedAfterManualExit/,
  );
  assert.match(
    nativeDateNavGuard,
    /!force &&[\s\S]{0,120}lastDateNavigation\?\.sessionId === sessionId/,
  );
  assert.match(
    nativeReadyRoute,
    /recovery\.action === ["']go_survey["'][\s\S]{0,260}force: true/s,
  );
});

test("native lobby treats in_survey as date-stack owned across active session, registration, and video realtime", () => {
  assert.match(nativeActiveSessionRoutes, /terminal `in_survey` recovery/);
  assert.match(
    nativeActiveSessionRoutes,
    /in_survey` is modeled as `ActiveSession\.kind === 'video'`/,
  );
  assert.match(nativeLobby, /sameEventActiveSession\?\.kind === ["']video["']/);
  assert.match(
    nativeLobby,
    /sameEventActiveSessionQueueStatus === ["']in_survey["']/,
  );
  assert.match(
    nativeLobby,
    /options:\s*\{[\s\S]{0,80}force\?: boolean;[\s\S]{0,80}forceSurvey\?: boolean;/,
  );
  assert.match(nativeLobby, /const forceSurvey = options\.forceSurvey === true/);
  assert.match(
    nativeLobby,
    /const forceNavigation = options\.force === true \|\| forceSurvey/,
  );
  assert.doesNotMatch(nativeLobby, /skipPrepare/);
  assert.doesNotMatch(nativeLobby, /prepareVideoDateEntry/);
  assert.match(nativeLobby, /ensureVideoDateStartableBeforeNavigation/);
  assert.match(
    nativeLobby,
    /ready_gate_open_suppressed_by_video_session_ownership/,
  );
  assert.match(
    nativeLobby,
    /queueStatus === ["']in_survey["'] && currentRoomId[\s\S]{0,560}force: true,[\s\S]{0,80}forceSurvey: true/,
  );
  assert.match(
    nativeLobby,
    /registration_realtime_active_date[\s\S]{0,160}["']replace["']/s,
  );
  assert.match(
    nativeLobby,
    /latestReg\?\.queue_status === ["']in_survey["'][\s\S]{0,600}force: true,[\s\S]{0,80}forceSurvey: true/,
  );
  assert.match(
    nativeLobby,
    /registration_realtime_refetch_active_date[\s\S]{0,160}["']replace["']/s,
  );
  assert.match(
    nativeLobby,
    /routeDecision\.target === ["']survey["'][\s\S]{0,340}video_session_update_pending_survey[\s\S]{0,140}force: true,[\s\S]{0,80}forceSurvey: true/,
  );
  assert.match(
    nativeLobby,
    /routeDecision\.target === ["']survey["'][\s\S]{0,340}video_session_insert_pending_survey[\s\S]{0,140}force: true,[\s\S]{0,80}forceSurvey: true/,
  );
  assert.match(
    nativeLobby,
    /video_session_update_active_date[\s\S]{0,160}["']replace["']/s,
  );
  assert.match(
    nativeLobby,
    /video_session_insert_active_date[\s\S]{0,160}["']replace["']/s,
  );
  assert.match(
    nativeLobby,
    /canonicalRoute\.target === ["']survey["'][\s\S]{0,900}navigateToDateSession\([\s\S]{0,80}sessionId,[\s\S]{0,80}`ready_gate_open_\$\{trigger\}_pending_survey`,[\s\S]{0,80}["']replace["'],[\s\S]{0,140}force: true,[\s\S]{0,80}forceSurvey: true/,
  );
});

test("native date guard opens terminal survey for explicit recovery actions, not only legacy ended decisions", () => {
  assert.match(
    nativeDateRoute,
    // PR 8.5 guard port: the shared date_route decision owns terminal opens.
    /decision\.target === ["']survey["'] \|\| decision\.target === ["']ended["']/,
  );
  assert.match(nativeDateRoute, /go_survey_route_guard/);
  assert.match(nativeDateRoute, /terminalSurveyHardStopRef/);
  assert.match(
    nativeDateRoute,
    /terminalSurveyHardStopRef\.current = true[\s\S]{0,260}setDateEntryPermissionEligible\(false\)/,
  );
  assert.match(
    nativeDateRoute,
    /phaseRef\.current = terminalSurveyHardStopActive \? ["']ended["'] : phase/,
  );
  assert.match(
    nativeDateRoute,
    /latestDateRouteEndedRef\.current = Boolean\([\s\S]{0,140}terminalSurveyHardStopActive/,
  );
  assert.match(
    nativeDateRoute,
    /const terminalSurveyOwner =[\s\S]{0,180}showFeedback \|\| phase === ["']ended["'] \|\| terminalSurveyHardStopRef\.current/,
  );
  assert.match(
    nativeDateRoute,
    /if \(!dateEntryPermissionEligible && !terminalSurveyOwner\) return/,
  );
});

test("outer fail-soft migration wraps every exposed RPC that showed raw 500s in the latest test", () => {
  for (const [name, baseName, code] of [
    [
      "claim_video_date_surface",
      "claim_video_date_surface_20260605170249_outer_base",
      "SURFACE_CLAIM_FAILED",
    ],
    [
      "mark_video_date_daily_joined",
      "mark_video_date_daily_joined_20260605170249_outer_base",
      "DAILY_JOIN_STAMP_FAILED",
    ],
    [
      "mark_video_date_remote_seen",
      "mark_video_date_remote_seen_20260605170249_outer_base",
      "REMOTE_SEEN_FAILED",
    ],
    [
      "get_or_seed_video_session_vibe_questions",
      "vd_vibe_q_outer_20260605170249_base",
      "VIBE_QUESTIONS_SEED_FAILED",
    ],
  ] as const) {
    assert.match(outerFailsoftMigration, new RegExp(`RENAME TO ${baseName}`));
    assert.match(
      outerFailsoftMigration,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      ),
    );
    const body = publicFunctionBody(outerFailsoftMigration, name);
    assert.match(body, new RegExp(`RETURN public\\.${baseName}`));
    assert.match(body, /EXCEPTION\s+WHEN OTHERS THEN/);
    assert.match(body, /GET STACKED DIAGNOSTICS/);
    assert.match(body, new RegExp(`'code', '${code}'`));
    assert.match(body, /'retryable', true/);
    assert.match(body, /'retry_after_ms', 1500/);
    assert.match(body, /'server_now_ms'/);
  }
  assert.match(outerFailsoftMigration, /NOTIFY pgrst, 'reload schema'/);
});

test("single-owner runtime migration makes remaining public hot RPCs fail-soft and auditable", () => {
  assert.match(
    singleOwnerRuntimeMigration,
    /CREATE TABLE IF NOT EXISTS public\.video_date_surface_claim_events/,
  );
  assert.match(
    singleOwnerRuntimeMigration,
    /ALTER TABLE public\.video_date_surface_claim_events ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(
    singleOwnerRuntimeMigration,
    /REVOKE ALL ON TABLE public\.video_date_surface_claim_events FROM PUBLIC, anon, authenticated/,
  );
  assert.doesNotMatch(
    singleOwnerRuntimeMigration,
    /GRANT .*video_date_surface_claim_events TO authenticated/,
  );

  for (const [name, baseName, code] of [
    [
      "video_date_transition",
      "video_date_transition_20260605232304_single_owner_base",
      "VIDEO_DATE_TRANSITION_FAILED",
    ],
    [
      "claim_video_date_surface",
      "claim_video_date_surface_20260605232304_single_owner_base",
      "SURFACE_CLAIM_FAILED",
    ],
  ] as const) {
    assert.match(
      singleOwnerRuntimeMigration,
      new RegExp(`RENAME TO ${baseName}`),
    );
    const body = publicFunctionBody(singleOwnerRuntimeMigration, name);
    assert.match(body, new RegExp(`public\\.${baseName}\\(`));
    assert.match(body, /EXCEPTION\s+WHEN OTHERS THEN/);
    assert.match(body, /GET STACKED DIAGNOSTICS/);
    assert.match(body, new RegExp(`'code', '${code}'`));
    assert.match(body, /'sqlstate', SQLSTATE/);
    assert.match(body, /'retry_after_ms', 1500/);
  }

  assert.match(autoNextRemovalMigration, /DROP FUNCTION IF EXISTS public\.get_video_date_queue_hint_v1\(uuid, uuid\)/);
  assert.match(autoNextRemovalMigration, /DROP FUNCTION IF EXISTS public\.drain_match_queue_v2\(uuid, text\)/);

  assert.match(
    singleOwnerRuntimeMigration,
    /INSERT INTO public\.video_date_surface_claim_events/,
  );
  assert.match(singleOwnerRuntimeMigration, /action,/);
  assert.match(singleOwnerRuntimeMigration, /'claim_exception'/);
  assert.match(
    singleOwnerRuntimeMigration,
    /same_session_daily_continuity_latched/,
  );
  assert.match(singleOwnerRuntimeMigration, /will_park_singleton/);
  assert.match(singleOwnerRuntimeMigration, /willParkSingleton/);
  assert.match(singleOwnerRuntimeMigration, /parked_singleton/);
  assert.match(singleOwnerRuntimeMigration, /route_owned/);
  assert.match(singleOwnerRuntimeMigration, /truth_refresh_attempt/);
  assert.match(singleOwnerRuntimeMigration, /historical_remote_seen_truth/);
  assert.match(singleOwnerRuntimeMigration, /NOTIFY pgrst, 'reload schema'/);
});

test("vibe-question fail-soft base helper avoids PostgreSQL identifier truncation", () => {
  assert.doesNotMatch(
    outerFailsoftMigration,
    /get_or_seed_video_session_vibe_questions_20260605170249_outer_base/,
  );
  assert.match(
    outerFailsoftMigration,
    /RENAME TO vd_vibe_q_outer_20260605170249_base/,
  );
  assert.match(
    vibeQuestionBaseNameRepairMigration,
    /get_or_seed_video_session_vibe_questions_20260605170249_outer_b/,
  );
  assert.match(
    vibeQuestionBaseNameRepairMigration,
    /RENAME TO vd_vibe_q_outer_20260605170249_base/,
  );
  assert.match(
    vibeQuestionBaseNameRepairMigration,
    /RETURN public\.vd_vibe_q_outer_20260605170249_base\(/,
  );
  assert.match(
    vibeQuestionBaseNameRepairMigration,
    /NOTIFY pgrst, 'reload schema'/,
  );
});
