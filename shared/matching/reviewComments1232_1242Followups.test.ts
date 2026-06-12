import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const packageJson = read("package.json");
const reviewMigration = read(
  "supabase/migrations/20260608114500_review_comments_1232_1242_followups.sql",
);
const identifierHygieneMigration = read(
  "supabase/migrations/20260608114600_review_comments_identifier_hygiene.sql",
);
const webHydration = read("src/components/session/SessionRouteHydration.tsx");
const nativeHydration = read("apps/mobile/components/NativeSessionRouteHydration.tsx");
const webReadyGateOverlay = read("src/components/lobby/ReadyGateOverlay.tsx");
const nativeDateRoute = read("apps/mobile/app/date/[id].tsx");
const invariantSql = read("docs/sql/video-date-invariants.sql");
const invariantRunner = read("scripts/check-video-date-invariants.mjs");
const functionVerifier = read("scripts/verify-video-date-functions.mjs");
const goldenFlowCertifier = read("scripts/certify-video-date-golden-flow.mjs");

function functionBody(sql: string, functionName: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}`);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const end = sql.indexOf("$function$;", start);
  assert.notEqual(end, -1, `${functionName} should have a dollar-quoted body`);
  return sql.slice(start, end);
}

function publicFunctionRefs(sql: string): string[] {
  return Array.from(sql.matchAll(/\b(?:FUNCTION|PROCEDURE)\s+public\.([A-Za-z0-9_]+)/g)).map(
    ([, identifier]) => identifier,
  );
}

test("Ready Gate canonical truth does not claim date route ownership", () => {
  for (const source of [webHydration, nativeHydration] as const) {
    assert.doesNotMatch(source, /ready_gate_bounce_suppressed_date_owner/);
  }
  assert.match(nativeHydration, /canonicalRoute\.target === "ready_gate"/);
  assert.match(nativeHydration, /clearVideoDateRouteOwnership/);
  // PR 7: web hydration delegates the ready-gate bounce to the shared
  // surface-route decision, which releases ownership before the redirect.
  const sharedSurfaceRouteDecision = read("shared/videoDate/routeDecision.ts");
  assert.match(webHydration, /decision\.target === "ready"/);
  assert.match(
    sharedSurfaceRouteDecision,
    /canonical\.target === "ready_gate"[\s\S]{0,200}clearLatch\(\);[\s\S]{0,200}clearOwnership\(\);/,
  );
  assert.match(webHydration, /session_route_hydration_ready_gate_canonical/);
  assert.match(nativeHydration, /route_bounced_to_ready/);
});

test("Ready Gate permission retry does not stop a newer consumer's pending capture", () => {
  assert.match(webReadyGateOverlay, /permissionPrewarmCaptureConsumerTokenRef/);
  assert.match(webReadyGateOverlay, /const captureConsumerToken =/);
  assert.match(webReadyGateOverlay, /shouldReleaseLateMedia/);
  assert.match(
    webReadyGateOverlay,
    /shouldReleaseLateMedia[\s\S]{0,120}stopMediaStreamTracks\(lateMedia\.stream\)/,
  );
});

test("native idle Daily singleton reuse is scoped to the same session and room", () => {
  const sessionMismatch = nativeDateRoute.indexOf("idleSingletonEntry.sessionId !== sessionId");
  const roomMismatch = nativeDateRoute.indexOf("idleSingletonEntry.roomName !== tokenResult.room_name");
  const participantsProbe = nativeDateRoute.indexOf("idleSingletonEntry.call.participants()");

  assert.ok(sessionMismatch > 0, "idle reuse should reject session mismatch");
  assert.ok(roomMismatch > sessionMismatch, "room mismatch should be checked after session mismatch");
  assert.ok(participantsProbe > roomMismatch, "call usability probe should only run after scope checks");
  assert.match(nativeDateRoute, /daily_call_singleton_reuse_cross_session_rejected/);
  assert.match(nativeDateRoute, /previousRoomName: idleSingletonEntry\.roomName/);
  assert.match(nativeDateRoute, /nextRoomName: tokenResult\.room_name/);
});

test("operator certification scripts parse exact current evidence", () => {
  assert.match(invariantRunner, /Array\.isArray\(parsed\)/);
  assert.match(invariantRunner, /Array\.isArray\(parsed\.rows\)/);
  assert.match(functionVerifier, /parseRemoteFunctionSlugs/);
  assert.match(functionVerifier, /remoteSlugs\.has\(name\)/);
  assert.doesNotMatch(functionVerifier, /remote\.includes\(name\)/);
  assert.match(goldenFlowCertifier, /const envFile = join\(repoRoot, "\.env\.cursor\.local"\)/);
  assert.match(goldenFlowCertifier, /loadLocalEnv\(\);\s*function hasDbUrl/);
});

test("survey-required invariant excludes pre-date ended sessions", () => {
  assert.match(invariantSql, /survey_required_unfinished_feedback_must_remain_in_survey/);
  assert.match(invariantSql, /public\.video_date_session_has_confirmed_encounter\(/);
  const criticalInvariant = invariantSql.slice(
    invariantSql.indexOf("survey_required_unfinished_feedback_must_remain_in_survey"),
    invariantSql.indexOf("survey_pending_feedback_held_in_survey"),
  );
  assert.doesNotMatch(criticalInvariant, /vs\.ended_at IS NOT NULL\s+OR vs\.date_started_at IS NOT NULL/);
});

test("follow-up migration sanitizes mark-ready safety failures", () => {
  const body = functionBody(reviewMigration, "video_session_mark_ready_v2");

  assert.match(reviewMigration, /RENAME TO video_session_mark_ready_v2_20260608114500_review_comments_base/);
  assert.match(body, /video_date_lifecycle_observe_exception_v2/);
  assert.match(body, /v_result[\s\S]{0,120}- 'sqlstate'[\s\S]{0,120}- 'message'/);
  assert.match(body, /'code', 'SAFETY_CHECK_UNAVAILABLE'/);
  assert.doesNotMatch(body, /'message', v_message/);
  assert.doesNotMatch(body, /'sqlstate', SQLSTATE/);
});

test("follow-up migration preserves idle resume status for inactive provider absence", () => {
  const body = functionBody(reviewMigration, "video_date_reconcile_provider_absence_v1");

  assert.match(reviewMigration, /RENAME TO video_date_reconcile_provider_absence_v1_20260608114500_review_comments_base/);
  assert.match(body, /v_resume_status := NULLIF\(v_result ->> 'resume_status', ''\)/);
  assert.match(body, /v_terminal AND NOT v_survey_required AND v_resume_status = 'idle'/);
  assert.match(body, /queue_status = 'idle'/);
  assert.doesNotMatch(body, /queue_status = CASE WHEN v_should_open_survey THEN 'in_survey' ELSE 'browsing' END/);
});

test("provider absence corrective migration removes the truncated base helper", () => {
  const body = functionBody(identifierHygieneMigration, "video_date_reconcile_provider_absence_v1");
  const functionRefs = publicFunctionRefs(identifierHygieneMigration);

  assert.match(
    identifierHygieneMigration,
    /RENAME TO vd_absence_review_1232_1242_base/,
  );
  assert.match(body, /v_result := public\.vd_absence_review_1232_1242_base/);
  assert.doesNotMatch(body, /video_date_reconcile_provider_absence_v1_20260608114500_review_/);
  assert.deepEqual(
    functionRefs.filter((identifier) => identifier.length > 63),
    [],
    "review-comments corrective migration must not rely on PostgreSQL identifier truncation",
  );
});

test("review comments 1232-1242 follow-up stays in the v4 suite", () => {
  assert.match(
    packageJson,
    /shared\/matching\/reviewComments1232_1242Followups\.test\.ts/,
  );
});
