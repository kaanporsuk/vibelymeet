import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const followupMigration = read("supabase/migrations/20260605221535_review_comments_1199_1204_followups.sql");
const helperNameRepairMigration = read("supabase/migrations/20260605222458_review_comments_helper_name_repair.sql");
const webVideoCall = read("src/hooks/useVideoCall.ts");
const nativeDateRoute = read("apps/mobile/app/date/[id].tsx");
const packageJson = read("package.json");

function functionBody(sql: string, functionName: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}`);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const end = sql.indexOf("$function$;", start);
  assert.notEqual(end, -1, `${functionName} should have a dollar-quoted body`);
  return sql.slice(start, end);
}

test("confirmed encounter promotion authorizes participants before room metadata repair can run", () => {
  const wrapper = functionBody(helperNameRepairMigration, "video_date_promote_confirmed_encounter_v1");
  const authCheck = wrapper.indexOf("IF p_require_participant THEN");
  const delegate = wrapper.indexOf("vd_promote_ce_auth_20260605221535_base");
  assert.ok(authCheck > -1, "wrapper should have participant auth gate");
  assert.ok(delegate > authCheck, "wrapper should delegate only after participant auth gate");
  assert.ok(wrapper.indexOf("not_participant") < delegate, "not-participant response should happen before base call");
  assert.doesNotMatch(wrapper, /video_date_restore_canonical_room_metadata_v1/);
  assert.match(helperNameRepairMigration, /ALTER FUNCTION public\.video_date_promote_confirmed_encounter_v1_20260605221535_partic/);
});

test("reconnect grace expiry only treats the latest away participant rejoining as recovery", () => {
  const expiry = functionBody(followupMigration, "expire_video_date_reconnect_graces");
  assert.match(expiry, /v_participant_1_join_after_away boolean := false/);
  assert.match(expiry, /v_participant_2_join_after_away boolean := false/);
  assert.match(expiry, /r\.participant_1_away_at = v_latest_away_at[\s\S]+AND v_participant_1_join_after_away/);
  assert.match(expiry, /r\.participant_2_away_at = v_latest_away_at[\s\S]+AND v_participant_2_join_after_away/);
  assert.match(expiry, /participant_1_join_after_away', v_participant_1_join_after_away/);
  assert.match(expiry, /participant_2_join_after_away', v_participant_2_join_after_away/);
  assert.doesNotMatch(
    expiry,
    /GREATEST\(\s*COALESCE\(r\.participant_1_joined_at[\s\S]+COALESCE\(r\.participant_2_joined_at[\s\S]+\)\s*> v_latest_away_at/,
  );
});

test("web first-remote terminal survey truth clears connecting state before survey recovery", () => {
  const terminalBranchStart = webVideoCall.indexOf("if (hasTerminalSurveyTruth) {");
  assert.notEqual(terminalBranchStart, -1, "terminal survey truth branch should exist");
  const terminalBranchEnd = webVideoCall.indexOf("return;", terminalBranchStart);
  const terminalBranch = webVideoCall.slice(terminalBranchStart, terminalBranchEnd);
  assert.match(terminalBranch, /setIsConnected\(false\)/);
  assert.match(terminalBranch, /setIsConnecting\(false\)/);
  assert.doesNotMatch(terminalBranch, /setIsConnecting\(true\)/);
});

test("native prejoin awaits a confirmed surface claim before Daily join", () => {
  assert.match(nativeDateRoute, /surfaceClaimInFlightPromiseRef/);
  assert.match(nativeDateRoute, /return surfaceClaimInFlightPromiseRef\.current/);
  assert.match(nativeDateRoute, /const surfaceClaim = await claimNativeVideoDateSurface\(false\)/);
  assert.match(nativeDateRoute, /!surfaceClaim\.canContinue \|\| !surfaceClaim\.confirmed/);
  assert.match(nativeDateRoute, /surface_claim_unconfirmed/);
  assert.ok(
    nativeDateRoute.indexOf("!surfaceClaim.canContinue || !surfaceClaim.confirmed") <
      nativeDateRoute.indexOf("currentStep = setPrejoinStep('daily_room_guard')"),
    "Daily guard should only run after a confirmed surface claim",
  );
});

test("review follow-up contracts stay in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/reviewComments1198_1204Followups\.test\.ts/);
});
