import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const recoveryMigration = read(
  "supabase/migrations/20260606224200_video_date_provider_terminal_recovery.sql",
);
const webCall = read("src/hooks/useVideoCall.ts");
const webDate = read("src/pages/VideoDate.tsx");
const nativeDate = read("apps/mobile/app/date/[id].tsx");
const packageJson = read("package.json");

function functionBody(sql: string, functionName: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}`);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const end = sql.indexOf("$function$;", start);
  assert.notEqual(end, -1, `${functionName} should have a dollar-quoted body`);
  return sql.slice(start, end);
}

test("provider-terminal recovery bounds stale Daily alive writes server-side", () => {
  const markAlive = functionBody(recoveryMigration, "mark_video_date_daily_alive");

  assert.match(recoveryMigration, /idx_video_date_presence_events_alive_recent/);
  assert.match(
    recoveryMigration,
    /idx_event_loop_observability_video_date_noop_recent/,
  );
  assert.match(markAlive, /v_presence_throttle := CASE/);
  assert.match(markAlive, /WHEN v_provider_backed_current THEN interval '6 seconds'/);
  assert.match(markAlive, /ELSE interval '30 seconds'/);
  assert.match(
    markAlive,
    /IF NOT v_provider_backed_current THEN[\s\S]{0,900}daily_alive_without_current_provider_presence/s,
  );
  assert.match(
    markAlive,
    /reason_code = 'daily_alive_without_current_provider_presence'[\s\S]{0,180}created_at >= v_now - interval '30 seconds'/s,
  );
  assert.match(markAlive, /'provider_presence_missing', true/);
  assert.match(markAlive, /'provider_presence_terminal', v_latest_provider_event_type = 'participant\.left'/);
  assert.match(markAlive, /'join_stamp_accepted', v_provider_backed_current/);
});

test("provider-terminal recovery preserves first provider-backed join evidence", () => {
  const markAlive = functionBody(recoveryMigration, "mark_video_date_daily_alive");

  assert.match(
    markAlive,
    /participant_1_joined_at = COALESCE\(participant_1_joined_at, v_now\)/,
  );
  assert.match(
    markAlive,
    /participant_2_joined_at = COALESCE\(participant_2_joined_at, v_now\)/,
  );
  assert.doesNotMatch(markAlive, /participant_1_joined_at\s*=\s*v_now/);
  assert.doesNotMatch(markAlive, /participant_2_joined_at\s*=\s*v_now/);
  assert.match(
    markAlive,
    /queue_status IS DISTINCT FROM v_status[\s\S]{0,420}last_active_at < v_now - interval '15 seconds'/s,
  );
  assert.match(
    markAlive,
    /video_date_surface_claims[\s\S]{0,220}released_at = COALESCE\(released_at, v_now\)/s,
  );
});

test("web and native clients skip Daily alive RPCs without current provider proof", () => {
  for (const [name, source] of [
    ["web", webCall],
    ["native", nativeDate],
  ] as const) {
    assert.match(
      source,
      /const providerBackedJoined =[\s\S]{0,90}meetingState === "joined-meeting" && Boolean\(providerSessionId\)/,
      `${name} should require provider session proof`,
    );
    assert.match(
      source,
      /if \(!providerBackedJoined\) \{[\s\S]{0,1200}mark_video_date_daily_alive_skipped_provider_missing[\s\S]{0,1200}return;[\s\S]{0,180}const args = \{/s,
      `${name} should return before building the RPC payload when provider proof is missing`,
    );
    assert.match(
      source,
      /videoDateLifecycleRpcIndicatesTerminalSurvey/,
      `${name} should recognize terminal survey truth through the shared lifecycle classifier`,
    );
    assert.match(
      source,
      /videoDateLifecycleRpcIndicatesTerminalStop[\s\S]{0,180}provider_presence_terminal === true/s,
      `${name} should stop the heartbeat on terminal server or provider terminal truth`,
    );
  }

  assert.match(webCall, /onTerminalSurveyTruth\?\.\(\s*["']daily_alive_terminal_survey_truth["']/);
  assert.match(
    nativeDate,
    /openNativePostDateSurveyFromTerminalTruth\(\s*['"]daily_alive_terminal_survey_truth['"]/,
  );
});

test("web and native terminal survey recovery falls back to in_survey registration truth", () => {
  assert.match(webDate, /TERMINAL_SURVEY_REGISTRATION_FALLBACK_SELECT/);
  assert.match(
    webDate,
    /terminal_post_date_survey_session_fetch_failed[\s\S]{0,1400}event_registrations[\s\S]{0,260}\.eq\("queue_status", "in_survey"\)/s,
  );
  assert.match(
    webDate,
    /terminal_post_date_survey_registration_fallback[\s\S]{0,900}openPostDateSurvey\(`\$\{source\}_registration_recovery`\)/s,
  );

  assert.match(nativeDate, /NATIVE_TERMINAL_SURVEY_REGISTRATION_FALLBACK_SELECT/);
  assert.match(
    nativeDate,
    /terminal_post_date_survey_session_fetch_failed[\s\S]{0,1800}event_registrations[\s\S]{0,260}\.eq\("queue_status", "in_survey"\)/s,
  );
  assert.match(
    nativeDate,
    /terminal_post_date_survey_registration_fallback[\s\S]{0,1200}openNativePostDateSurvey\(\s*`\$\{source\}_registration_recovery`/s,
  );
});

test("provider-terminal recovery contracts stay in the v4 verification script", () => {
  assert.match(
    packageJson,
    /shared\/matching\/videoDateProviderTerminalRecovery\.test\.ts/,
  );
});
