import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readWebVideoCallFlowSource } from "../testUtils/webVideoDateFlowSources";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260607103100_video_date_provider_joined_absence_terminal.sql",
);
const webCall = readWebVideoCallFlowSource(root);
const nativeDate = read("apps/mobile/app/date/[id].tsx");
const supabaseTypes = read("src/integrations/supabase/types.ts");
const packageJson = read("package.json");

function functionBody(sql: string, functionName: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}`);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const end = sql.indexOf("$function$;", start);
  assert.notEqual(end, -1, `${functionName} should have a dollar-quoted body`);
  return sql.slice(start, end);
}

function rpcTypeBlock(types: string, rpcName: string): string {
  const header = `      ${rpcName}: {`;
  const start = types.indexOf(header);
  assert.notEqual(start, -1, `${rpcName} should exist in generated types`);
  const rest = types.slice(start + header.length);
  const next = rest.match(/\n {6}[A-Za-z0-9_]+: \{\n {8}Args:/);
  assert.ok(next?.index != null, `${rpcName} generated type block should terminate`);
  return types.slice(start, start + header.length + next.index);
}

test("joined confirmation is a provider-backed compatibility facade", () => {
  const markJoined = functionBody(migration, "mark_video_date_daily_joined");

  assert.match(migration, /DROP FUNCTION IF EXISTS public\.mark_video_date_daily_joined\(uuid\)/);
  assert.match(
    markJoined,
    /p_provider_session_id text DEFAULT NULL[\s\S]{0,180}p_owner_state text DEFAULT NULL/,
  );
  assert.match(markJoined, /public\.mark_video_date_daily_alive\(/);
  assert.match(markJoined, /'joined_delegated_to_daily_alive', true/);
  assert.match(markJoined, /'legacy_providerless_noop', v_provider_session_id IS NULL/);
  assert.match(markJoined, /'provider_presence_required', true/);
  assert.match(markJoined, /'join_stamp_accepted'/);
  assert.doesNotMatch(markJoined, /mark_video_date_daily_joined_20260605170249_outer_base/);
});

test("provider absence reconciler starts grace before terminal survey", () => {
  const reconciler = functionBody(migration, "video_date_reconcile_provider_absence_v1");

  assert.match(migration, /idx_video_date_daily_webhook_events_provider_latest/);
  assert.match(reconciler, /public\.video_date_session_has_confirmed_encounter/);
  assert.match(reconciler, /public\.video_date_actor_provider_presence_v1/);
  assert.match(reconciler, /v_grace_until := v_latest_left_at \+ interval '12 seconds'/);
  assert.match(reconciler, /provider_absence_reconnect_grace_started/);
  assert.match(reconciler, /provider_absence_after_confirmed_encounter/);
  assert.match(reconciler, /public\.video_date_session_is_post_date_survey_eligible_v2/);
  assert.match(reconciler, /queue_status = CASE WHEN v_should_open_survey THEN 'in_survey'/);
  assert.match(reconciler, /video_date_surface_claims[\s\S]{0,180}released_at = COALESCE\(released_at, v_now\)/);
  assert.match(reconciler, /provider_absence_terminal_survey/);
});

test("Daily webhook and reconnect expiry invoke provider absence reconciliation", () => {
  const webhook = functionBody(migration, "record_video_date_daily_webhook_event_v2");
  const expire = functionBody(migration, "expire_video_date_reconnect_graces");

  assert.match(
    migration,
    /ALTER FUNCTION public\.record_video_date_daily_webhook_event_v2\([\s\S]{0,140}RENAME TO record_vd_daily_webhook_v2_202606071031_base/s,
  );
  assert.match(webhook, /record_vd_daily_webhook_v2_202606071031_base/);
  assert.match(webhook, /v_event_kind IN \('participant\.joined', 'participant\.join', 'participant\.left', 'participant\.leave'\)/);
  assert.match(webhook, /public\.video_date_reconcile_provider_absence_v1/);
  assert.match(webhook, /'daily_webhook_' \|\| v_event_kind/);

  assert.match(
    migration,
    /ALTER FUNCTION public\.expire_video_date_reconnect_graces\(\)[\s\S]{0,100}RENAME TO expire_vd_reconnect_graces_202606071031_base/s,
  );
  assert.match(expire, /public\.video_date_reconcile_provider_absence_v1/);
  assert.match(expire, /expire_video_date_reconnect_graces_provider_absence/);
  assert.match(expire, /expire_vd_reconnect_graces_202606071031_base/);
});

test("web and native joined confirmation wait for provider proof before RPC", () => {
  for (const [name, source, providerReader] of [
    ["web", webCall, "readDailyProviderSessionId"],
    ["native", nativeDate, "readNativeDailyProviderSessionId"],
  ] as const) {
    assert.match(source, /const buildProviderBackedDailyJoinedArgs = \(\) =>/);
    assert.ok(
      source.includes(`const providerSessionId = ${providerReader}(call`),
      `${name} should read the provider session id from the active Daily call`,
    );
    assert.match(
      source,
      /const providerBackedJoined =[\s\S]{0,120}meetingState === "joined-meeting" && Boolean\(providerSessionId\)/,
      `${name} should require joined Daily state plus provider session id`,
    );
    assert.match(source, /p_provider_session_id: providerSessionId/);
    assert.match(source, /p_call_instance_id: dailyCallInstanceId/);
    assert.match(source, /p_entry_attempt_id:\s*entryAttemptId \?\? entryOwner\?\.entryAttemptId \?\? null/);
    assert.match(
      source,
      /if \(!joinedProof\.providerBackedJoined\) \{[\s\S]{0,1000}code: "provider_presence_missing"[\s\S]{0,360}retryable/s,
      `${name} should retry locally until provider proof exists`,
    );
    assert.match(
      source,
      /supabase\.rpc\(\s*"mark_video_date_daily_joined",\s*joinedProof\.args/,
      `${name} should send the provider-backed args to the RPC`,
    );
  }
});

test("typed Supabase RPC contract includes provider-backed joined args", () => {
  const markJoined = rpcTypeBlock(supabaseTypes, "mark_video_date_daily_joined");
  assert.match(markJoined, /p_call_instance_id\?: string/);
  assert.match(markJoined, /p_entry_attempt_id\?: string/);
  assert.match(markJoined, /p_owner_id\?: string/);
  assert.match(markJoined, /p_owner_state\?: string/);
  assert.match(markJoined, /p_provider_session_id\?: string/);
  assert.match(markJoined, /p_session_id: string/);
});

test("provider joined absence terminal contracts stay in the v4 suite", () => {
  assert.match(
    packageJson,
    /shared\/matching\/videoDateProviderJoinedAbsenceTerminal\.test\.ts/,
  );
});
