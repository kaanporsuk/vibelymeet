import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const followupMigration = read(
  "supabase/migrations/20260606212727_review_comments_1205_1216_followups.sql",
);
const packageJson = read("package.json");

function functionBody(sql: string, functionName: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}`);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const end = sql.indexOf("$function$;", start);
  assert.notEqual(end, -1, `${functionName} should have a dollar-quoted body`);
  return sql.slice(start, end);
}

test("promotion wrapper binds authenticated callers to auth uid before privileged delegation", () => {
  const wrapper = functionBody(followupMigration, "video_date_promote_confirmed_encounter_v1");
  const authUidIndex = wrapper.indexOf("v_auth_actor uuid := auth.uid()");
  const nonServiceIndex = wrapper.indexOf("IF v_is_service_role THEN");
  const actorMismatchIndex = wrapper.indexOf("actor_mismatch");
  const participantRequiredIndex = wrapper.indexOf("v_require_participant := true");
  const participantCheckIndex = wrapper.indexOf("not_participant");
  const delegateIndex = wrapper.indexOf("vd_promote_ce_auth_20260605221535_base");

  assert.ok(authUidIndex > -1, "wrapper should derive caller from auth.uid()");
  assert.ok(nonServiceIndex > authUidIndex, "caller role branch should follow auth uid derivation");
  assert.ok(actorMismatchIndex > nonServiceIndex, "spoofed p_actor should be rejected for authenticated callers");
  assert.ok(participantRequiredIndex > nonServiceIndex, "authenticated callers should force participant auth");
  assert.ok(participantCheckIndex > participantRequiredIndex, "participant check should run before delegation");
  assert.ok(delegateIndex > participantCheckIndex, "privileged base should only run after caller-bound auth checks");
  assert.match(wrapper, /auth\.role\(\) = 'service_role'/);
  assert.match(wrapper, /p_actor IS NOT NULL AND p_actor IS DISTINCT FROM v_auth_actor/);
});

test("surface claim audit derives normal outcomes from success and conflict code", () => {
  const wrapper = functionBody(followupMigration, "claim_video_date_surface");
  assert.match(wrapper, /COALESCE\(v_result->>'ok', v_result->>'success', ''\)/);
  assert.match(wrapper, /WHEN v_result_code = 'SURFACE_CLAIM_CONFLICT' THEN true/);
  assert.match(wrapper, /'ok_source'[\s\S]*WHEN v_result \? 'success' THEN 'success'/);
  assert.match(wrapper, /'blocked_source'[\s\S]*WHEN v_result_code = 'SURFACE_CLAIM_CONFLICT' THEN 'code'/);
});

test("mark-ready restores event-wide inactive cleanup before decisive base delegation", () => {
  const wrapper = functionBody(followupMigration, "video_session_mark_ready_v2");
  const inactiveIndex = wrapper.indexOf("public.get_event_lobby_inactive_reason(v_session.event_id)");
  const cleanupIndex = wrapper.indexOf("public.terminalize_event_ready_gates(v_session.event_id, v_inactive_reason)");
  const delegateIndex = wrapper.indexOf("video_session_mark_ready_v2_20260606212727_event_cleanup_base");

  assert.match(followupMigration, /ALTER FUNCTION public\.video_session_mark_ready_v2\(uuid, text, text\)[\s\S]*RENAME TO video_session_mark_ready_v2_20260606212727_event_cleanup_base/);
  assert.ok(inactiveIndex > -1, "wrapper should re-check event inactive state");
  assert.ok(cleanupIndex > inactiveIndex, "event-wide cleanup should follow inactive detection");
  assert.ok(delegateIndex > cleanupIndex, "decisive base delegation should happen after the event sweep");
  assert.match(wrapper, /ready_gate_status[\s\S]*'queued', 'ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'/);
});

test("review comment follow-up contracts stay in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/reviewComments1205_1216Followups\.test\.ts/);
});
