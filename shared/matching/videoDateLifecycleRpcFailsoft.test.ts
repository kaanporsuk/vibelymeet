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

import { readWebVideoCallFlowSource, readWebVideoDatePageFlowSource } from "../testUtils/webVideoDateFlowSources";

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
const correctiveSanitizationMigration = read(
  "supabase/migrations/20260608001000_video_date_base_failsoft_payload_sanitization.sql",
);
const lastResortFailsoftMigration = read(
  "supabase/migrations/20260608080938_video_date_lifecycle_rpc_last_resort_failsoft.sql",
);
const providerBoundRemoteSeenMigration = read(
  "supabase/migrations/20260608120000_video_date_provider_bound_remote_seen.sql",
);
const remoteSeenIdentifierHygieneMigration = read(
  "supabase/migrations/20260608121834_video_date_remote_seen_identifier_hygiene.sql",
);
const remoteSeenLintCleanupMigration = read(
  "supabase/migrations/20260608122623_video_date_remote_seen_lint_cleanup.sql",
);
const activeOwnerTerminalTruthMigration = read(
  "supabase/migrations/20260608171837_video_date_active_owner_terminal_truth.sql",
);
const webHook = readWebVideoCallFlowSource(root);
const webDate = readWebVideoDatePageFlowSource(root);
const nativeDate = read("apps/mobile/app/date/[id].tsx");
const nativeApi = read("apps/mobile/lib/videoDateApi.ts");
const supabaseTypes = read("src/integrations/supabase/types.ts");
const packageJson = read("package.json");
const postgrestRuntimeProbe = read(
  "shared/matching/videoDateLifecycleRpcPostgrestRuntime.test.ts",
);

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

test("corrective recovery sanitizes base-returned fail-soft payloads", () => {
  const sanitizerBody = functionBody(
    correctiveSanitizationMigration,
    "video_date_lifecycle_sanitize_client_failsoft_payload_v1",
  );

  assert.match(sanitizerBody, /v_has_failure_shape/);
  assert.match(sanitizerBody, /video_date_lifecycle_jsonb_true_v1\(v_payload, 'ok'\)/);
  assert.match(sanitizerBody, /video_date_lifecycle_jsonb_true_v1\(v_payload, 'success'\)/);
  assert.match(sanitizerBody, /- 'message'/);
  assert.match(sanitizerBody, /- 'detail'/);
  assert.match(sanitizerBody, /- 'hint'/);
  assert.match(sanitizerBody, /- 'fallback_message'/);
  assert.match(sanitizerBody, /- 'fallback_detail'/);
  assert.match(sanitizerBody, /- 'fallback_hint'/);

  for (const functionName of [
    "mark_video_date_daily_alive",
    "mark_video_date_daily_joined",
    "video_date_transition",
  ] as const) {
    const body = functionBody(correctiveSanitizationMigration, functionName);
    assert.match(body, /_20260607222923_definitive_base/);
    assert.match(body, /video_date_enrich_lifecycle_payload_v1/);
    assert.match(body, /RETURN public\.video_date_lifecycle_sanitize_client_failsoft_payload_v1\(v_result\)/);
    assert.match(body, /video_date_lifecycle_safe_failsoft_payload_v1\([\s\S]*SQLSTATE,\s*NULL,\s*NULL,\s*NULL\s*\)/);
  }

  assert.match(correctiveSanitizationMigration, /NOTIFY pgrst, 'reload schema'/);
});

test("last-resort lifecycle shell covers all browser/native callable date-room RPCs", () => {
  for (const [functionName, baseName, failureCode] of [
    [
      "claim_video_date_surface",
      "claim_video_date_surface_20260608080938_last_resort_base",
      "SURFACE_CLAIM_FAILED",
    ],
    [
      "mark_video_date_daily_alive",
      "mark_video_date_daily_alive_20260608080938_last_resort_base",
      "DAILY_ALIVE_STAMP_FAILED",
    ],
    [
      "mark_video_date_daily_joined",
      "mark_video_date_daily_joined_20260608080938_last_resort_base",
      "DAILY_JOIN_STAMP_FAILED",
    ],
    [
      "video_date_transition",
      "video_date_transition_20260608080938_last_resort_base",
      "VIDEO_DATE_TRANSITION_FAILED",
    ],
  ] as const) {
    assert.match(
      lastResortFailsoftMigration,
      new RegExp(`RENAME TO ${baseName}`),
      `${functionName} should preserve the previous public wrapper stack as its base`,
    );
    const body = functionBody(lastResortFailsoftMigration, functionName);
    assert.match(body, new RegExp(baseName));
    assert.match(body, /video_date_lifecycle_exception_payload_v2/);
    assert.match(body, /video_date_lifecycle_enrich_and_sanitize_payload_v2/);
    assert.match(body, new RegExp(failureCode));
  }

  const safeClientBody = functionBody(
    lastResortFailsoftMigration,
    "video_date_lifecycle_client_safe_payload_v2",
  );
  const exceptionBody = functionBody(
    lastResortFailsoftMigration,
    "video_date_lifecycle_exception_payload_v2",
  );
  const enrichBody = functionBody(
    lastResortFailsoftMigration,
    "video_date_lifecycle_enrich_and_sanitize_payload_v2",
  );

  assert.match(safeClientBody, /video_date_lifecycle_sanitize_client_failsoft_payload_v1/);
  assert.match(safeClientBody, /client_payload_sanitizer_failed/);
  assert.match(safeClientBody, /- 'message'/);
  assert.match(safeClientBody, /- 'detail'/);
  assert.match(safeClientBody, /- 'hint'/);

  assert.match(exceptionBody, /video_date_lifecycle_observe_exception_v2/);
  assert.match(exceptionBody, /video_date_lifecycle_safe_failsoft_payload_v1/);
  assert.match(exceptionBody, /video_date_lifecycle_last_resort_payload_v2/);
  assert.match(exceptionBody, /RETURN public\.video_date_lifecycle_client_safe_payload_v2\(v_payload\)/);

  assert.match(enrichBody, /video_date_enrich_lifecycle_payload_v1/);
  assert.match(enrichBody, /lifecycle_enrich_failed/);
  assert.match(
    enrichBody,
    /video_date_lifecycle_last_resort_payload_v2\([\s\S]*?\)\s*\|\|\s*v_payload\s*\|\|\s*jsonb_build_object\('enrichment_failed', true\)/,
    "enrichment fallback must not overwrite base terminal/survey truth",
  );
  assert.match(enrichBody, /video_date_lifecycle_client_safe_payload_v2/);
  assert.match(lastResortFailsoftMigration, /NOTIFY pgrst, 'reload schema'/);
});

test("provider-bound remote-seen rejects stale provider sessions before canonical evidence changes", () => {
  const remoteSeenBody = functionBody(
    providerBoundRemoteSeenMigration,
    "mark_video_date_remote_seen",
  );

  const providerGuardIndex = remoteSeenBody.indexOf("IF NOT v_provider_backed_current THEN");
  const baseCallIndex = remoteSeenBody.indexOf(
    "mark_video_date_remote_seen_20260608120000_provider_base",
  );
  assert.ok(providerGuardIndex > -1, "remote_seen should have a provider-current guard");
  assert.ok(
    baseCallIndex > providerGuardIndex,
    "remote_seen must reject stale provider evidence before calling the old canonical mutator",
  );

  assert.match(
    providerBoundRemoteSeenMigration,
    /ALTER FUNCTION public\.mark_video_date_remote_seen\(uuid\)\s+RENAME TO mark_video_date_remote_seen_20260608120000_provider_base/,
  );
  assert.match(remoteSeenBody, /p_provider_session_id text DEFAULT NULL/);
  assert.match(remoteSeenBody, /p_call_instance_id text DEFAULT NULL/);
  assert.match(remoteSeenBody, /p_owner_state text DEFAULT NULL/);
  assert.match(remoteSeenBody, /v_latest_provider_event_type = 'participant.joined'/);
  assert.match(remoteSeenBody, /v_latest_provider_session_id = v_provider_session_id/);
  assert.match(remoteSeenBody, /REMOTE_SEEN_PROVIDER_SESSION_MISSING/);
  assert.match(remoteSeenBody, /REMOTE_SEEN_OWNER_NOT_JOINED/);
  assert.match(remoteSeenBody, /REMOTE_SEEN_PROVIDER_SESSION_LEFT/);
  assert.match(remoteSeenBody, /REMOTE_SEEN_PROVIDER_NOT_CURRENT/);
  assert.match(remoteSeenBody, /remote_seen_rejected_stale_provider_session/);
  assert.match(remoteSeenBody, /remote_seen_stamp_accepted', false/);
  assert.match(remoteSeenBody, /provider_presence_terminal/);
  assert.match(remoteSeenBody, /EXCEPTION\s+WHEN OTHERS THEN\s+NULL/);
  assert.match(
    providerBoundRemoteSeenMigration,
    /GRANT EXECUTE ON FUNCTION public\.mark_video_date_remote_seen\(\s*uuid, text, text, text, text, text\s*\) TO authenticated/,
  );
});

test("daily alive and remote-seen RPCs keep direct JSON fail-soft fallbacks", () => {
  const dailyAliveBody = functionBody(
    providerBoundRemoteSeenMigration,
    "mark_video_date_daily_alive",
  );
  const remoteSeenBody = functionBody(
    providerBoundRemoteSeenMigration,
    "mark_video_date_remote_seen",
  );

  assert.match(
    providerBoundRemoteSeenMigration,
    /ALTER FUNCTION public\.mark_video_date_daily_alive\(uuid, text, text, text, text, text\)\s+RENAME TO mark_video_date_daily_alive_20260608120000_provider_remote_seen_base/,
  );
  assert.match(dailyAliveBody, /video_date_lifecycle_exception_payload_v2/);
  assert.match(dailyAliveBody, /direct_json_fallback/);
  assert.match(dailyAliveBody, /DAILY_ALIVE_STAMP_FAILED/);
  assert.match(remoteSeenBody, /video_date_lifecycle_exception_payload_v2/);
  assert.match(remoteSeenBody, /direct_json_fallback/);
  assert.match(remoteSeenBody, /REMOTE_SEEN_STAMP_FAILED/);
  assert.match(providerBoundRemoteSeenMigration, /NOTIFY pgrst, 'reload schema'/);
});

test("provider-bound Daily alive uses an explicit short base after identifier hygiene", () => {
  const dailyAliveBody = functionBody(
    remoteSeenIdentifierHygieneMigration,
    "mark_video_date_daily_alive",
  );

  assert.match(
    remoteSeenIdentifierHygieneMigration,
    /ALTER FUNCTION public\.mark_video_date_daily_alive_20260608120000_provider_remote_seen\(\s*uuid, text, text, text, text, text\s*\) RENAME TO vd_daily_alive_remote_seen_base/,
  );
  assert.match(dailyAliveBody, /RETURN public\.vd_daily_alive_remote_seen_base\(/);
  assert.doesNotMatch(
    dailyAliveBody,
    /mark_video_date_daily_alive_20260608120000_provider_remote_seen/,
  );
  assert.match(
    remoteSeenIdentifierHygieneMigration,
    /GRANT EXECUTE ON FUNCTION public\.vd_daily_alive_remote_seen_base\(\s*uuid, text, text, text, text, text\s*\) TO service_role/,
  );
  assert.match(
    remoteSeenIdentifierHygieneMigration,
    /GRANT EXECUTE ON FUNCTION public\.mark_video_date_daily_alive\(\s*uuid, text, text, text, text, text\s*\) TO authenticated/,
  );
  assert.match(remoteSeenIdentifierHygieneMigration, /NOTIFY pgrst, 'reload schema'/);
});

test("provider-bound remote-seen lint cleanup keeps guard semantics without unused locals", () => {
  const remoteSeenBody = functionBody(
    remoteSeenLintCleanupMigration,
    "mark_video_date_remote_seen",
  );

  assert.doesNotMatch(remoteSeenBody, /\bv_now\b/);
  assert.match(remoteSeenBody, /IF NOT v_provider_backed_current THEN/);
  assert.match(remoteSeenBody, /REMOTE_SEEN_PROVIDER_SESSION_LEFT/);
  assert.match(remoteSeenBody, /remote_seen_rejected_stale_provider_session/);
  assert.match(
    remoteSeenBody,
    /mark_video_date_remote_seen_20260608120000_provider_base\(p_session_id\)/,
  );
  assert.match(
    remoteSeenLintCleanupMigration,
    /GRANT EXECUTE ON FUNCTION public\.mark_video_date_remote_seen\(\s*uuid, text, text, text, text, text\s*\) TO authenticated/,
  );
  assert.match(remoteSeenLintCleanupMigration, /NOTIFY pgrst, 'reload schema'/);
});

test("active-owner terminal truth migration preserves one chronological terminal story", () => {
  assert.match(activeOwnerTerminalTruthMigration, /terminal_generation integer NOT NULL DEFAULT 0/);
  assert.match(activeOwnerTerminalTruthMigration, /terminal_audit_at timestamptz/);
  assert.match(activeOwnerTerminalTruthMigration, /terminal_audit_reason text/);
  assert.match(activeOwnerTerminalTruthMigration, /terminal_audit_detail jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(activeOwnerTerminalTruthMigration, /session_terminal_generation integer/);
  assert.match(activeOwnerTerminalTruthMigration, /session_state_updated_at timestamptz/);
  assert.match(activeOwnerTerminalTruthMigration, /session_ended_at timestamptz/);
  assert.match(activeOwnerTerminalTruthMigration, /session_ended_reason text/);
  assert.match(activeOwnerTerminalTruthMigration, /CREATE TRIGGER trg_video_sessions_terminal_audit_stamp/);
  assert.match(activeOwnerTerminalTruthMigration, /state_updated_at := v_terminal_at/);
  assert.match(activeOwnerTerminalTruthMigration, /claim_terminal_audit/);
  assert.match(activeOwnerTerminalTruthMigration, /session_terminal_generation', v_session\.terminal_generation/);
  assert.match(supabaseTypes, /terminal_generation: number/);
  assert.match(supabaseTypes, /terminal_audit_detail: Json/);
  assert.match(supabaseTypes, /session_terminal_generation: number \| null/);
  assert.match(supabaseTypes, /session_ended_reason: string \| null/);
});

test("delayed Daily webhook provider truth survives terminal state by occurred_at", () => {
  assert.match(activeOwnerTerminalTruthMigration, /participant_1_provider_joined_at timestamptz/);
  assert.match(activeOwnerTerminalTruthMigration, /participant_2_provider_joined_at timestamptz/);
  assert.match(activeOwnerTerminalTruthMigration, /video_date_preserve_provider_webhook_truth_v1/);
  assert.match(activeOwnerTerminalTruthMigration, /p_occurred_at timestamptz DEFAULT now\(\)/);
  assert.match(activeOwnerTerminalTruthMigration, /GREATEST\(\s*COALESCE\(participant_1_provider_joined_at, v_occurred_at\),\s*v_occurred_at\s*\)/);
  assert.match(activeOwnerTerminalTruthMigration, /GREATEST\(\s*COALESCE\(participant_2_provider_joined_at, v_occurred_at\),\s*v_occurred_at\s*\)/);
  assert.match(activeOwnerTerminalTruthMigration, /daily_webhook_historical_truth/);
  assert.match(activeOwnerTerminalTruthMigration, /delayed_provider_truth_preserved_after_terminal/);
  assert.match(activeOwnerTerminalTruthMigration, /historical_provider_truth/);
  assert.match(activeOwnerTerminalTruthMigration, /ignored_terminal_session/);
  assert.match(
    activeOwnerTerminalTruthMigration,
    /ignored_terminal_session[\s\S]*v_base->>'result'/,
    "terminal-ignored Daily webhook returns must still preserve historical provider truth",
  );
  assert.match(activeOwnerTerminalTruthMigration, /state_mutation_allowed', v_session\.ended_at IS NULL/);
  assert.match(supabaseTypes, /participant_1_provider_joined_at: string \| null/);
  assert.match(supabaseTypes, /participant_2_provider_joined_at: string \| null/);
});

test("PostgREST lifecycle RPC probes cover duplicate, terminal, and invalid-state JSON contracts", () => {
  for (const rpcName of [
    "video_session_mark_ready_v2",
    "mark_video_date_daily_alive",
    "claim_video_date_surface",
    "video_date_transition",
  ] as const) {
    assert.match(postgrestRuntimeProbe, new RegExp(rpcName));
  }

  assert.match(postgrestRuntimeProbe, /rest\/v1\/rpc/);
  assert.match(postgrestRuntimeProbe, /result\.status < 500/);
  assert.match(postgrestRuntimeProbe, /structuredKeys/);
  assert.match(postgrestRuntimeProbe, /duplicate mark-ready/);
  assert.match(postgrestRuntimeProbe, /terminal transition/);
  assert.match(postgrestRuntimeProbe, /invalid transition session/);
  assert.match(
    packageJson,
    /shared\/matching\/videoDateLifecycleRpcPostgrestRuntime\.test\.ts/,
  );
});

test("web and native remote-seen clients bind stamps to current provider call identity", () => {
  for (const [name, source, identityRef] of [
    ["web hook", webHook, "activeDailyCallIdentityRef"],
    ["native route", nativeDate, "activeNativeDailyCallIdentityRef"],
  ] as const) {
    assert.match(source, new RegExp(identityRef), `${name} should keep active provider call identity`);
    assert.match(source, /supabase\.rpc\(["']mark_video_date_remote_seen["'], proof\.args\)/);
    assert.match(source, /p_provider_session_id: providerSessionId/);
    assert.match(source, /p_call_instance_id: callInstanceId/);
    assert.match(source, /p_owner_state: ["']joined["']/);
    assert.match(source, /mark_video_date_remote_seen_skipped_provider_missing/);
    assert.match(source, /provider_presence_terminal/);
    assert.match(source, /videoDateLifecycleRpcRetryable\(payload\)/);
    assert.match(source, /callInstanceId: proof\.callInstanceId/);
    assert.match(source, /providerSessionId: proof\.providerSessionId/);
    assert.doesNotMatch(
      source,
      /\.rpc\(["']mark_video_date_remote_seen["'],\s*\{\s*p_session_id:\s*sessionId\s*\}\)/,
      `${name} must not use session-only remote_seen anymore`,
    );
  }

  assert.match(
    supabaseTypes,
    /mark_video_date_remote_seen:[\s\S]*p_call_instance_id\?: string[\s\S]*p_provider_session_id\?: string[\s\S]*p_session_id: string/,
  );
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
    videoDateLifecycleRpcIndicatesTerminalSurvey({ surveyRequired: true }),
    true,
  );
  assert.equal(
    videoDateLifecycleRpcIndicatesTerminalSurvey({ error: "session_ended" }),
    false,
  );
  assert.equal(
    videoDateLifecycleRpcIndicatesTerminalSurvey({ session_ended: true }),
    false,
  );
  assert.equal(
    videoDateLifecycleRpcIndicatesTerminalStop({ phase: "ended" }),
    true,
  );
  assert.equal(
    videoDateLifecycleRpcIndicatesTerminalStop({ error: "session_ended" }),
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
  assert.match(webDate, /entry_decision_terminal_survey/);
  assert.match(webDate, /complete_entry_lifecycle_terminal_survey/);
});

test("lifecycle fail-soft contract stays in the v4 verification script", () => {
  assert.match(
    packageJson,
    /shared\/matching\/videoDateLifecycleRpcFailsoft\.test\.ts/,
  );
});
