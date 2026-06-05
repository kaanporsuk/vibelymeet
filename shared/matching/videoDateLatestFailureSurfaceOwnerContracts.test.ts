import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

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

const webRouteHydration = read("src/components/session/SessionRouteHydration.tsx");
const webLobby = read("src/pages/EventLobby.tsx");
const webDateNavGuard = read("src/lib/dateNavigationGuard.ts");
const nativeRouteHydration = read("apps/mobile/components/NativeSessionRouteHydration.tsx");
const nativeDateNavGuard = read("apps/mobile/lib/dateNavigationGuard.ts");
const nativeReadyRoute = read("apps/mobile/app/ready/[id].tsx");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const nativeDateRoute = read("apps/mobile/app/date/[id].tsx");
const nativeActiveSessionRoutes = read("apps/mobile/lib/activeSessionRoutes.ts");
const outerFailsoftMigration = read(
  "supabase/migrations/20260605170249_video_date_surface_owner_outer_failsoft.sql",
);
const vibeQuestionBaseNameRepairMigration = read(
  "supabase/migrations/20260605174703_video_date_vibe_question_outer_base_name_repair.sql",
);

test("web route hydration makes active video or survey the single route owner", () => {
  assert.match(webRouteHydration, /lastActiveVideoRedirectKey/);
  assert.match(webRouteHydration, /activeSession\?\.kind === "video" && activeSession\.sessionId/);
  assert.match(webRouteHydration, /activeSession\.queueStatus === "in_survey"/);
  assert.match(webRouteHydration, /forceSurvey/);
  assert.match(webRouteHydration, /route_hydration_active_video_redirect/);
  assert.match(webRouteHydration, /navigate\(target,\s*\{[\s\S]*source: "session_route_hydration_active_video"[\s\S]*forceSurvey/s);
});

test("web EventLobby treats in_survey as date-stack owned and never prepares Daily for it", () => {
  assert.match(webLobby, /status === "in_handshake" \|\| status === "in_date" \|\| status === "in_survey"/);
  assert.match(webLobby, /function isDailyEntryQueueStatus\(status: unknown\): status is "in_handshake" \| "in_date"/);
  assert.match(webDateNavGuard, /force\?: boolean/);
  assert.match(webDateNavGuard, /const force = options\.force === true/);
  assert.match(webDateNavGuard, /!force && isDateNavigationSuppressedAfterManualExit/);
  assert.match(webDateNavGuard, /!force &&[\s\S]{0,160}lastDateNavigation\?\.sessionId === sessionId/);
  assert.match(webLobby, /const force = options\.force === true \|\| options\.forceSurvey === true/);
  assert.match(webLobby, /claimDateNavigation\(sessionId, location\.pathname, \{ force \}\)/);
  assert.match(
    webLobby,
    /scopedSessionQueueStatus === "in_survey"[\s\S]{0,120}\{ force: true, forceSurvey: true \}/,
  );
  assert.match(
    webLobby,
    /queueStatus === "in_survey" && currentRoomId[\s\S]{0,360}navigateToDateSession\(currentRoomId, "registration_realtime_pending_survey", \{[\s\S]{0,120}force: true,[\s\S]{0,120}forceSurvey: true/s,
  );
  assert.match(webLobby, /isDailyEntryQueueStatus\(queueStatus\) && currentRoomId[\s\S]{0,320}prepareAndNavigateToDateSession\(currentRoomId, "registration_realtime"\)/);
  assert.match(webLobby, /ready_gate_open_suppressed_by_video_session_ownership/);
  assert.match(
    webLobby,
    /routeDecision\.target === "survey"[\s\S]{0,620}navigateToDateSession\(sessionId, `\$\{source\}_pending_survey`, \{[\s\S]{0,120}force: true,[\s\S]{0,120}forceSurvey: true/s,
  );
  assert.match(webLobby, /state: options\.forceSurvey === true \? \{ source, forceSurvey: true \} : \{ source \}/);
  assert.doesNotMatch(
    webLobby,
    /routeDecision\.target === "survey"[\s\S]{0,520}prepareAndNavigateToDateSession/,
  );
});

test("native route hydration and navigation guard force terminal survey ownership", () => {
  assert.match(nativeRouteHydration, /lastActiveVideoKey/);
  assert.match(nativeRouteHydration, /activeSession\?\.kind === 'video' && activeSession\.sessionId/);
  assert.match(nativeRouteHydration, /active_video_route_owner_redirect/);
  assert.match(nativeRouteHydration, /force_survey: activeSession\.queueStatus === 'in_survey'/);
  assert.match(nativeRouteHydration, /router\.replace\(target\)/);

  assert.match(nativeDateNavGuard, /force\?: boolean/);
  assert.match(nativeDateNavGuard, /const \{ sessionId, pathname, mode = 'replace', force = false/);
  assert.match(nativeDateNavGuard, /!force && isDateNavigationSuppressedAfterManualExit/);
  assert.match(nativeDateNavGuard, /!force &&[\s\S]{0,120}lastDateNav\?\.sessionId === sessionId/);
  assert.match(nativeReadyRoute, /recovery\.action === 'go_survey'[\s\S]{0,260}force: true/s);
});

test("native lobby treats in_survey as date-stack owned across active session, registration, and video realtime", () => {
  assert.match(nativeActiveSessionRoutes, /terminal `in_survey` recovery/);
  assert.match(nativeActiveSessionRoutes, /in_survey` is modeled as `ActiveSession\.kind === 'video'`/);
  assert.match(nativeLobby, /sameEventActiveSession\?\.kind === 'video'/);
  assert.match(nativeLobby, /sameEventActiveSessionQueueStatus === 'in_survey'/);
  assert.match(nativeLobby, /ready_gate_open_suppressed_by_video_session_ownership/);
  assert.match(nativeLobby, /queueStatus === 'in_survey' && currentRoomId[\s\S]{0,240}force: true/);
  assert.match(nativeLobby, /latestReg\?\.queue_status === 'in_survey'[\s\S]{0,260}force: true/);
  assert.match(nativeLobby, /routeDecision\.target === 'survey'[\s\S]{0,300}video_session_update_pending_survey[\s\S]{0,120}force: true/);
  assert.match(nativeLobby, /routeDecision\.target === 'survey'[\s\S]{0,300}video_session_insert_pending_survey[\s\S]{0,120}force: true/);
  assert.match(
    nativeLobby,
    /canonicalRoute\.target === 'survey'[\s\S]{0,700}navigateToDateSession\(sessionId, `ready_gate_open_\$\{trigger\}_pending_survey`, 'replace', \{[\s\S]{0,120}force: true/,
  );
});

test("native date guard opens terminal survey for explicit recovery actions, not only legacy ended decisions", () => {
  assert.match(
    nativeDateRoute,
    /truthDecision === 'ended' \|\|[\s\S]{0,120}recovery\.action === 'show_terminal' \|\|[\s\S]{0,120}recovery\.action === 'go_survey'/,
  );
  assert.match(nativeDateRoute, /go_survey_route_guard/);
});

test("outer fail-soft migration wraps every exposed RPC that showed raw 500s in the latest test", () => {
  for (const [name, baseName, code] of [
    ["claim_video_date_surface", "claim_video_date_surface_20260605170249_outer_base", "SURFACE_CLAIM_FAILED"],
    ["mark_video_date_daily_joined", "mark_video_date_daily_joined_20260605170249_outer_base", "DAILY_JOIN_STAMP_FAILED"],
    ["mark_video_date_remote_seen", "mark_video_date_remote_seen_20260605170249_outer_base", "REMOTE_SEEN_FAILED"],
    [
      "get_or_seed_video_session_vibe_questions",
      "vd_vibe_q_outer_20260605170249_base",
      "VIBE_QUESTIONS_SEED_FAILED",
    ],
  ] as const) {
    assert.match(outerFailsoftMigration, new RegExp(`RENAME TO ${baseName}`));
    assert.match(outerFailsoftMigration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
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

test("vibe-question fail-soft base helper avoids PostgreSQL identifier truncation", () => {
  assert.doesNotMatch(
    outerFailsoftMigration,
    /get_or_seed_video_session_vibe_questions_20260605170249_outer_base/,
  );
  assert.match(outerFailsoftMigration, /RENAME TO vd_vibe_q_outer_20260605170249_base/);
  assert.match(
    vibeQuestionBaseNameRepairMigration,
    /get_or_seed_video_session_vibe_questions_20260605170249_outer_b/,
  );
  assert.match(vibeQuestionBaseNameRepairMigration, /RENAME TO vd_vibe_q_outer_20260605170249_base/);
  assert.match(
    vibeQuestionBaseNameRepairMigration,
    /RETURN public\.vd_vibe_q_outer_20260605170249_base\(/,
  );
  assert.match(vibeQuestionBaseNameRepairMigration, /NOTIFY pgrst, 'reload schema'/);
});
