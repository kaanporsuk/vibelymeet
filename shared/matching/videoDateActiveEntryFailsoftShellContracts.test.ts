import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260609105249_video_date_active_entry_failsoft_shell.sql",
);
const joinArgRepairMigration = read(
  "supabase/migrations/20260609112843_video_date_active_entry_join_arg_name_repair.sql",
);
const webVideoDate = read("src/pages/VideoDate.tsx");
const dailyRoomFunction = read("supabase/functions/daily-room/index.ts");
const packageJson = read("package.json");

function publicFunctionBody(source: string, name: string): string {
  const match = source.match(
    new RegExp(
      String.raw`CREATE OR REPLACE FUNCTION public\.${name}\([\s\S]*?\n\$function\$;`,
      "m",
    ),
  );
  assert.ok(match, `expected ${name} function body to exist`);
  return match[0];
}

test("web /date owns a stable surface shell before Daily joins", () => {
  assert.match(webVideoDate, /const videoDateRouteShellActive =/);
  assert.match(
    webVideoDate,
    /videoDateAccess === "allowed"[\s\S]{0,180}!showFeedback[\s\S]{0,180}!terminalSurveyRecoveryActive[\s\S]{0,180}phase !== "ended"/,
  );
  assert.match(
    webVideoDate,
    /const videoDateSurfaceLeaseActive =\s*\n\s*videoDateRouteShellActive/,
  );
  assert.match(webVideoDate, /useVideoDateDupTabGuard\([\s\S]{0,180}videoDateSurfaceLeaseActive/);
  assert.doesNotMatch(webVideoDate, /videoDateSurfaceClaimable/);
});

test("daily-room maps retryable prepare-entry failures away from raw 500", () => {
  assert.match(
    dailyRoomFunction,
    /status: preparePayload\?\.retryable === true \? 409 : statusForPrepareEntryCode\(code\)/,
  );
  assert.match(
    dailyRoomFunction,
    /status: confirmPayload\?\.retryable === true \? 409 : statusForPrepareEntryCode\(code\)/,
  );
  assert.match(
    dailyRoomFunction,
    /retryable: typeof confirmPayload\?\.retryable === "boolean" \? confirmPayload\.retryable : undefined/,
  );
});

test("active-entry RPCs have final no-throw fail-soft shells", () => {
  for (const [name, baseName, code] of [
    [
      "video_session_mark_ready_v2",
      "video_session_mark_ready_v2_20260609105249_active_entry_base",
      "MARK_READY_UNAVAILABLE",
    ],
    [
      "video_date_transition",
      "video_date_transition_20260609105249_active_entry_base",
      "VIDEO_DATE_TRANSITION_FAILED",
    ],
    [
      "mark_video_date_daily_joined",
      "mark_video_date_daily_joined_20260609105249_active_entry_base",
      "DAILY_JOIN_STAMP_FAILED",
    ],
    [
      "record_video_date_launch_latency_checkpoint",
      "record_vd_launch_lat_20260609105249_active_base",
      "LAUNCH_LATENCY_CHECKPOINT_FAILED",
    ],
  ] as const) {
    assert.match(migration, new RegExp(`RENAME TO ${baseName}`));
    const body = publicFunctionBody(migration, name);
    assert.match(body, new RegExp(`public\\.${baseName}\\(`));
    assert.match(body, /EXCEPTION\s+WHEN OTHERS THEN/);
    assert.match(body, new RegExp(`'${code}'`));
    assert.match(body, /'retryable', true/);
    assert.match(body, /'active_entry_failsoft_shell', true/);
  }
});

test("Daily joined shell preserves the generated PostgREST argument name", () => {
  const body = publicFunctionBody(joinArgRepairMigration, "mark_video_date_daily_joined");
  assert.match(body, /p_entry_attempt_id text DEFAULT NULL/);
  assert.doesNotMatch(body, /p_provider_participant_id/);
  assert.match(body, /mark_video_date_daily_joined_20260609105249_active_entry_base\([\s\S]*p_entry_attempt_id[\s\S]*p_owner_state/);
  assert.match(joinArgRepairMigration, /DROP FUNCTION IF EXISTS public\.mark_video_date_daily_joined\(uuid, text, text, text, text, text\)/);
});

test("active-entry fail-soft shell stays in required Video Date suites", () => {
  assert.match(packageJson, /shared\/matching\/videoDateActiveEntryFailsoftShellContracts\.test\.ts/);
});
