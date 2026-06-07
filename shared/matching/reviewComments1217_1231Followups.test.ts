import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260607185652_review_comments_1217_1231_followups.sql",
);
const lintRepairMigration = read(
  "supabase/migrations/20260607190533_review_comments_1217_1231_lint_repair.sql",
);
const nativeReadyGateOverlay = read(
  "apps/mobile/components/lobby/ReadyGateOverlay.tsx",
);
const packageJson = read("package.json");

function functionBody(sql: string, functionName: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}`);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const end = sql.indexOf("$function$;", start);
  assert.notEqual(end, -1, `${functionName} should have a dollar-quoted body`);
  return sql.slice(start, end);
}

test("mark-ready follow-up pre-authorizes participant before preserved event cleanup base", () => {
  const body = functionBody(migration, "video_session_mark_ready_v2");
  const deniedIndex = body.indexOf("'event_cleanup_prechecked', true");
  const baseIndex = body.indexOf(
    "video_session_mark_ready_v2_20260607123952_routeable_entry_base",
  );

  assert.ok(deniedIndex > 0, "nonparticipant branch should be explicit");
  assert.ok(baseIndex > deniedIndex, "base call should happen after precheck");
  assert.doesNotMatch(body.slice(0, baseIndex), /terminalize_event_ready_gates/);
  assert.match(body, /video_date_protect_both_ready_entry_v1/);
});

test("provider absence reconciliation clears grace and away markers on Daily rejoin", () => {
  const body = functionBody(lintRepairMigration, "video_date_reconcile_provider_absence_v1");

  assert.match(body, /IF v_p1_active OR v_p2_active THEN/);
  assert.match(body, /reconnect_grace_ends_at = NULL/);
  assert.match(body, /WHEN v_p1_active THEN NULL/);
  assert.match(body, /WHEN v_p2_active THEN NULL/);
  assert.match(body, /provider_absence_grace_cleared_by_rejoin/);
  assert.match(body, /'provider_absence_grace_cleared', v_rows_changed > 0/);
  assert.match(body, /UPDATE public\.video_date_surface_claims/);
  assert.match(body, /released_at = COALESCE\(released_at, v_now\)/);
  assert.doesNotMatch(body, /release_reason/);
});

test("registration drift validation and repair exclude queued sessions", () => {
  for (const functionName of [
    "validate_video_date_registration_session_drift_v1",
    "repair_video_date_registration_session_drift_v1",
  ] as const) {
    const body = functionBody(migration, functionName);

    assert.match(
      body,
      /ready_gate_status IN \('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'\)/,
    );
    assert.doesNotMatch(body, /ready_gate_status IN \('queued'/);
    assert.match(body, /'queued_excluded', true/);
  }

  assert.doesNotMatch(
    migration,
    /WHEN v_row\.ready_gate_status = 'queued' THEN er\.queue_status/,
  );
});

test("terminal lifecycle context returns only minimal context to nonparticipants", () => {
  const body = functionBody(migration, "video_date_lifecycle_terminal_context_v1");
  const deniedIndex = body.indexOf("IF NOT v_authorized_context THEN");
  const afterDeniedIndex = body.indexOf("  IF p_actor_id IS NOT NULL THEN", deniedIndex);
  const fullIndex = body.indexOf("'daily_room_url', v_row.daily_room_url");
  const deniedBlock = body.slice(deniedIndex, afterDeniedIndex);

  assert.ok(deniedIndex > 0, "nonparticipant branch should exist");
  assert.ok(afterDeniedIndex > deniedIndex, "denied branch should terminate");
  assert.ok(fullIndex > deniedIndex, "full context should be after access gate");
  assert.match(body, /v_authorized_context :=/);
  assert.match(deniedBlock, /'access_denied', true/);
  assert.match(deniedBlock, /'session_ended', false/);
  assert.doesNotMatch(deniedBlock, /'event_id'/);
  assert.doesNotMatch(deniedBlock, /'daily_room_name'/);
  assert.doesNotMatch(deniedBlock, /'daily_room_url'/);
  assert.doesNotMatch(deniedBlock, /'ended_at'/);
});

test("native Ready Gate only uses routeable truth recovery after retryable prepare failures", () => {
  assert.match(
    nativeReadyGateOverlay,
    /const latestTruth = retryable\s*\?\s*await fetchVideoSessionDateEntryTruthCoalesced\(sessionId\)\s*:\s*null/s,
  );
  assert.match(
    nativeReadyGateOverlay,
    /if \(retryable && isRouteableVideoDateTruth\(latestTruth\)\)/,
  );
  assert.match(
    nativeReadyGateOverlay,
    /if \(retryable && isTerminalReadyGateTruth\(latestTruth\)\)/,
  );
});

test("review comments 1217-1231 follow-up stays in the v4 suite", () => {
  assert.match(
    packageJson,
    /shared\/matching\/reviewComments1217_1231Followups\.test\.ts/,
  );
});
