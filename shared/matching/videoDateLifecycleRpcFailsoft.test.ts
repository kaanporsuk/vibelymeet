import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  videoDateLifecycleRpcCode,
  videoDateLifecycleRpcIndicatesTerminalStop,
  videoDateLifecycleRpcIndicatesTerminalSurvey,
  videoDateLifecycleRpcRetryable,
} from "./videoDateLifecycleRpc";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const lifecycleMigration = read(
  "supabase/migrations/20260607155414_video_date_lifecycle_rpc_terminal_contracts.sql",
);
const truthyAlignmentMigration = read(
  "supabase/migrations/20260607183100_video_date_lifecycle_truthy_helper_alignment.sql",
);
const definitiveRecoveryMigration = read(
  "supabase/migrations/20260607222923_video_date_daily_owner_definitive_recovery.sql",
);
const webHook = read("src/hooks/useVideoCall.ts");
const webDate = read("src/pages/VideoDate.tsx");
const nativeDate = read("apps/mobile/app/date/[id].tsx");
const nativeApi = read("apps/mobile/lib/videoDateApi.ts");
const packageJson = read("package.json");

function functionBody(sql: string, functionName: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}`);
  assert.notEqual(start, -1, `${functionName} should exist`);
  const end = sql.indexOf("$function$;", start);
  assert.notEqual(end, -1, `${functionName} should have a dollar-quoted body`);
  return sql.slice(start, end);
}

test("lifecycle RPC wrappers convert terminal-bound exceptions into fail-soft JSON", () => {
  for (const functionName of [
    "mark_video_date_daily_joined",
    "video_date_transition",
  ] as const) {
    const body = functionBody(lifecycleMigration, functionName);
    assert.match(body, /video_date_enrich_lifecycle_payload_v1/);
    assert.match(body, /EXCEPTION\s+WHEN OTHERS THEN/);
    assert.match(body, /video_date_lifecycle_failsoft_payload_v1/);
  }

  assert.match(lifecycleMigration, /video_date_lifecycle_terminal_context_v1/);
  assert.match(lifecycleMigration, /video_date_lifecycle_failsoft_payload_v1/);
  assert.match(lifecycleMigration, /video_date_session_is_post_date_survey_eligible_v2/);
  assert.match(truthyAlignmentMigration, /video_date_lifecycle_jsonb_true_v1/);
  assert.match(truthyAlignmentMigration, /video_date_lifecycle_failsoft_payload_v1/);
  assert.match(truthyAlignmentMigration, /video_date_enrich_lifecycle_payload_v1/);
  assert.doesNotMatch(truthyAlignmentMigration, /->>\s*'[^']+'\)::boolean/);
});

test("definitive recovery keeps provider-overlap RPCs behind final fail-soft wrappers", () => {
  assert.match(
    definitiveRecoveryMigration,
    /ALTER FUNCTION public\.mark_video_date_daily_alive\(uuid, text, text, text, text, text\)\s+RENAME TO mark_video_date_daily_alive_20260607222923_definitive_base/,
  );
  assert.match(
    definitiveRecoveryMigration,
    /ALTER FUNCTION public\.mark_video_date_daily_joined\(uuid, text, text, text, text, text\)\s+RENAME TO mark_video_date_daily_joined_20260607222923_definitive_base/,
  );
  assert.match(
    definitiveRecoveryMigration,
    /ALTER FUNCTION public\.video_date_transition\(uuid, text, text\)\s+RENAME TO video_date_transition_20260607222923_definitive_base/,
  );

  for (const functionName of [
    "mark_video_date_daily_alive",
    "mark_video_date_daily_joined",
    "video_date_transition",
  ] as const) {
    const body = functionBody(definitiveRecoveryMigration, functionName);
    assert.match(body, /video_date_enrich_lifecycle_payload_v1/);
    assert.match(body, /EXCEPTION\s+WHEN OTHERS THEN/);
    assert.match(body, /video_date_lifecycle_rpc_exception_observability_v1/);
    assert.match(body, /video_date_lifecycle_safe_failsoft_payload_v1/);
    assert.match(body, /video_date_lifecycle_safe_failsoft_payload_v1\([\s\S]*SQLSTATE,\s*NULL,\s*NULL,\s*NULL\s*\)/);
  }

  assert.match(definitiveRecoveryMigration, /video_date_lifecycle_failsoft_payload_v1/);
  assert.match(definitiveRecoveryMigration, /fallback_payload_builder_failed/);
  assert.match(definitiveRecoveryMigration, /NOTIFY pgrst, 'reload schema'/);
});

test("definitive recovery last-resort fail-soft payload is sanitized", () => {
  const telemetryBody = functionBody(
    definitiveRecoveryMigration,
    "video_date_lifecycle_rpc_exception_observability_v1",
  );
  const safeFailsoftBody = functionBody(
    definitiveRecoveryMigration,
    "video_date_lifecycle_safe_failsoft_payload_v1",
  );

  assert.match(telemetryBody, /'message', p_message/);
  assert.match(telemetryBody, /'detail', NULLIF\(p_detail, ''\)/);
  assert.match(telemetryBody, /'hint', NULLIF\(p_hint, ''\)/);

  assert.match(safeFailsoftBody, /fallback_payload_builder_failed/);
  assert.match(safeFailsoftBody, /video_date_lifecycle_rpc_exception_observability_v1/);
  assert.match(safeFailsoftBody, /retry_after_ms/);
  assert.doesNotMatch(safeFailsoftBody, /'message',\s*p_message/);
  assert.doesNotMatch(safeFailsoftBody, /'detail',\s*NULLIF\(p_detail, ''\)/);
  assert.doesNotMatch(safeFailsoftBody, /'hint',\s*NULLIF\(p_hint, ''\)/);
  assert.doesNotMatch(safeFailsoftBody, /'fallback_message'/);
  assert.doesNotMatch(safeFailsoftBody, /'fallback_detail'/);
  assert.doesNotMatch(safeFailsoftBody, /'fallback_hint'/);
});

test("shared lifecycle RPC classifier recognizes all terminal survey shapes", () => {
  assert.equal(
    videoDateLifecycleRpcCode({ code: "SESSION_ENDED" }),
    "session_ended",
  );
  assert.equal(
    videoDateLifecycleRpcIndicatesTerminalSurvey({ queue_status: "in_survey" }),
    true,
  );
  assert.equal(
    videoDateLifecycleRpcIndicatesTerminalSurvey({ survey_required: "true" }),
    true,
  );
  assert.equal(
    videoDateLifecycleRpcIndicatesTerminalSurvey({ error: "session_ended" }),
    true,
  );
  assert.equal(
    videoDateLifecycleRpcIndicatesTerminalStop({ phase: "ended" }),
    true,
  );
  assert.equal(
    videoDateLifecycleRpcRetryable({ session_ended: true }),
    false,
  );
  assert.equal(
    videoDateLifecycleRpcRetryable({ success: false, retryable: true }),
    true,
  );
});

test("web and native clients consume shared lifecycle terminal survey truth", () => {
  for (const [name, source] of [
    ["web hook", webHook],
    ["web route", webDate],
    ["native route", nativeDate],
    ["native api", nativeApi],
  ] as const) {
    assert.match(
      source,
      /videoDateLifecycleRpcIndicatesTerminalSurvey/,
      `${name} should use the shared terminal survey classifier`,
    );
    assert.match(
      source,
      /videoDateLifecycleRpcRetryable/,
      `${name} should use shared retryability for lifecycle fail-soft payloads`,
    );
  }

  assert.match(webHook, /daily_alive_terminal_survey_truth/);
  assert.match(webHook, /daily_joined_terminal_survey_truth/);
  assert.match(webHook, /sync_reconnect_terminal_survey_truth/);
  assert.match(webHook, /mark_reconnect_return_terminal_survey_truth/);

  assert.match(nativeDate, /daily_alive_terminal_survey_truth/);
  assert.match(nativeDate, /daily_joined_terminal_survey_truth/);

  assert.match(webDate, /recoverLifecycleRpcTerminalSurvey/);
  assert.match(webDate, /mark_reconnect_return_terminal_survey/);
  assert.match(webDate, /sync_reconnect_terminal_survey/);
  assert.match(webDate, /handshake_decision_terminal_survey/);
  assert.match(webDate, /complete_handshake_lifecycle_terminal_survey/);
});

test("lifecycle fail-soft contract stays in the v4 verification script", () => {
  assert.match(
    packageJson,
    /shared\/matching\/videoDateLifecycleRpcFailsoft\.test\.ts/,
  );
});
