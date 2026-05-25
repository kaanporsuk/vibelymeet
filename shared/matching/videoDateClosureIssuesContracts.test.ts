import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS,
} from "../featureFlags/videoDateV4Flags";

const snapshotFunction = readFileSync("supabase/functions/video-date-snapshot/index.ts", "utf8");
const packageJson = readFileSync("package.json", "utf8");
const requiredCertificationGate = readFileSync("scripts/certify-video-date-required.mjs", "utf8");
const runtimeRlsEnvGuard = readFileSync("scripts/require-video-date-runtime-rls-env.mjs", "utf8");
const phase8Runbook = readFileSync("docs/video-date-v4-phase8-certification-rollout.md", "utf8");
const monitoringRunbook = readFileSync("docs/video-date-post-release-monitoring-runbook.md", "utf8");
const requiredCertificationTemplate = readFileSync("docs/video-date-required-certification-template.json", "utf8");
const videoDateFlags = readFileSync("shared/featureFlags/videoDateV4Flags.ts", "utf8");
const aliasHelper = readFileSync("shared/featureFlags/featureFlagAliasResolution.ts", "utf8");

test("legacy snapshot token issuance uses shared Daily provider reliability", () => {
  assert.match(snapshotFunction, /from "\.\.\/_shared\/video-date-provider-reliability\.ts"/);
  for (const symbol of [
    "fetchWithTimeout",
    "enforceProviderRateLimit",
    "providerRateLimitConfig",
    "providerFetchTimeoutMs",
    "parseRetryAfterSeconds",
    "ProviderRateLimitError",
    "ProviderTimeoutError",
    "providerFailureCode",
    "providerFailureMessage",
    "providerFailureRetryAfter",
  ]) {
    assert.match(snapshotFunction, new RegExp(symbol));
  }

  assert.doesNotMatch(snapshotFunction, /await\s+fetch\s*\(\s*`\$\{DAILY_API_URL\}\/meeting-tokens/);
  assert.match(snapshotFunction, /fetchWithTimeout\(`\$\{DAILY_API_URL\}\/meeting-tokens`/);
  assert.match(snapshotFunction, /enforceProviderRateLimit\(reliabilityClient, providerRateLimitConfig\("daily", "meeting_token"\)\)/);
  assert.match(snapshotFunction, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(snapshotFunction, /operation: "snapshot_token"/);
});

test("snapshot token failures surface bounded 429 retry-after without leaking token material", () => {
  assert.match(snapshotFunction, /DAILY_SNAPSHOT_TOKEN_MAX_RETRY_SLEEP_SECONDS/);
  assert.match(snapshotFunction, /response\.status === 429 && retries > 0/);
  assert.match(snapshotFunction, /retryAfterSeconds <= DAILY_SNAPSHOT_TOKEN_MAX_RETRY_SLEEP_SECONDS/);
  assert.match(snapshotFunction, /ProviderRateLimitError/);
  assert.match(snapshotFunction, /status, retryAfterSeconds\)/);
  assert.match(snapshotFunction, /"Retry-After"/);
  assert.match(snapshotFunction, /retry_after_seconds/);
  assert.match(snapshotFunction, /retryAfterSeconds/);
  assert.match(snapshotFunction, /clientError: "daily_token_failed"/);
  assert.doesNotMatch(snapshotFunction, /clientError: "provider_rate_limited"/);
  assert.match(snapshotFunction, /error instanceof ProviderRateLimitError \|\| error instanceof ProviderTimeoutError/);
  assert.doesNotMatch(snapshotFunction, /snapshotTokenFailureStatus\(error\) === 429/);
  assert.match(snapshotFunction, /provider_status/);
  assert.doesNotMatch(snapshotFunction, /provider_payload|raw_payload|response_body/i);
  assert.doesNotMatch(snapshotFunction, /console\.(?:log|error|warn)\([^)]*DAILY_API_KEY/);
});

test("token-free snapshot path remains auth-preserving and does not require provider work", () => {
  const includeTokenGuard = snapshotFunction.indexOf("if (!includeToken)");
  const missingRoomGuard = snapshotFunction.indexOf("if (!roomName)");
  const tokenIssue = snapshotFunction.indexOf("const tokenResult = await createMeetingToken");
  assert.ok(includeTokenGuard > -1, "include-token guard must exist");
  assert.ok(missingRoomGuard > includeTokenGuard, "missing-room guard should follow include-token guard");
  assert.ok(tokenIssue > missingRoomGuard, "token issuance must happen after token-free returns");
  assert.match(snapshotFunction, /createClient\(supabaseUrl, supabaseAnonKey[\s\S]+global: \{ headers: \{ Authorization: authHeader \} \}/);
  assert.match(snapshotFunction, /get_video_date_snapshot_core/);
});

test("required runtime RLS command is explicit and fails fast when env is missing", () => {
  const packageConfig = JSON.parse(packageJson) as { scripts: Record<string, string> };
  const command = packageConfig.scripts["test:video-date-runtime-rls:required"];
  const certificationCommand = packageConfig.scripts["certify:video-date:required"];
  assert.ok(command, "required runtime RLS command should exist");
  assert.ok(certificationCommand, "required video-date certification command should exist");
  assert.match(command, /require-video-date-runtime-rls-env\.mjs/);
  assert.match(command, /videoDateRealtimeRlsRuntime\.test\.ts/);
  assert.match(command, /videoDatePublicApiRlsRuntime\.test\.ts/);
  assert.match(certificationCommand, /certify-video-date-required\.mjs/);
  assert.match(packageJson, /phase8:config-readiness/);
  assert.match(packageJson, /test:video-date-runtime-rls:required/);
  for (const requiredStep of [
    "npm run typecheck",
    "npm run test:video-date-v4",
    "npm run test:event-lobby-regression",
    "npm run test:daily-room-contract",
    "npm run test:video-date-runtime-rls:required",
    "npm run phase8:config-readiness",
  ]) {
    assert.match(requiredCertificationGate, new RegExp(requiredStep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(requiredCertificationGate, /pending_user_owned/);

  for (const envName of [
    "VIDEO_DATE_RLS_SUPABASE_URL",
    "VIDEO_DATE_RLS_SUPABASE_ANON_KEY",
    "VIDEO_DATE_RLS_SESSION_ID",
    "VIDEO_DATE_RLS_PARTICIPANT_JWT",
    "VIDEO_DATE_RLS_NON_PARTICIPANT_JWT",
    "VIDEO_DATE_PUBLIC_API_RLS_SUPABASE_URL",
    "VIDEO_DATE_PUBLIC_API_RLS_SUPABASE_ANON_KEY",
    "VIDEO_DATE_PUBLIC_API_RLS_EVENT_ID",
    "VIDEO_DATE_PUBLIC_API_RLS_USER_ID",
    "VIDEO_DATE_PUBLIC_API_RLS_OTHER_USER_ID",
    "VIDEO_DATE_PUBLIC_API_RLS_PARTICIPANT_JWT",
    "VIDEO_DATE_PUBLIC_API_RLS_NON_PARTICIPANT_JWT",
    "VIDEO_DATE_PUBLIC_API_RLS_SESSION_ID",
  ]) {
    assert.match(runtimeRlsEnvGuard, new RegExp(envName));
    assert.match(phase8Runbook, new RegExp(envName));
  }
  assert.match(runtimeRlsEnvGuard, /process\.exit\(1\)/);
  assert.match(phase8Runbook, /npm run test:video-date-runtime-rls:required/);
  assert.match(monitoringRunbook, /npm run test:video-date-runtime-rls:required/);
});

test("canonical video-date rollout flags and compatibility aliases are documented and typed", () => {
  assert.deepEqual(VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS.readyGateResilientClock.canonical, [
    "video_date.timeline_v2",
    "video_date.broadcast_v2",
  ]);
  assert.deepEqual(VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS.readyGateResilientClock.aliases, [
    "video_date.ready_gate_resilient_clock_v1",
  ]);
  assert.deepEqual(VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS.pushOpenDedupe.canonical, [
    "video_date.multi_device_dedup_v2",
  ]);
  assert.deepEqual(VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS.pushOpenDedupe.aliases, [
    "video_date.push_open_dedupe_v1",
  ]);
  assert.deepEqual(VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS.verdictConfirmation.canonical, [
    "video_date.verdict_confirm_v2",
  ]);
  assert.deepEqual(VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS.verdictConfirmation.aliases, [
    "video_date.verdict_confirm_v1",
  ]);
  assert.deepEqual(VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS.deckOptimisticPolish.canonical, [
    "video_date.deck_prefetch_polish_v2",
  ]);
  assert.deepEqual(VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS.deckOptimisticPolish.aliases, [
    "video_date.deck_optimistic_v1",
  ]);
  assert.match(videoDateFlags, /VIDEO_DATE_FEATURE_FLAG_ALIAS_GROUPS/);
  assert.match(aliasHelper, /canonical\?\.source === "kill_switched"/);
  assert.match(phase8Runbook, /v1 names are compatibility aliases/);
  assert.match(phase8Runbook, /canonical kill switch wins over an enabled alias/);
});

test("required certification template keeps original acceptance criteria explicit", () => {
  const template = JSON.parse(requiredCertificationTemplate) as Record<string, unknown>;
  const serialized = JSON.stringify(template);

  for (const requiredToken of [
    "feature_flags",
    "daily_env_readiness",
    "DAILY_API_KEY",
    "DAILY_DOMAIN",
    "DAILY_WEBHOOK_SECRET",
    "CRON_SECRET",
    "test:video-date-runtime-rls:required",
    "web_two_user_staging_e2e",
    "ios_two_user_manual",
    "android_two_user_manual",
    "daily_webhook_real_event",
    "rollback_owner",
    "incident_owner",
    "all_baseline_and_targeted_tests_pass",
    "two_user_staging_run_complete",
    "no_known_stuck_ready_gate_handshake_date_queued_or_pending_survey_path",
    "no_public_rpc_or_edge_contract_broken",
    "launch_runbook_has_secrets_flags_slos_dashboards_and_rollback",
  ]) {
    assert.match(serialized, new RegExp(requiredToken));
  }

  assert.match(serialized, /pending_user_owned/);
  assert.doesNotMatch(serialized, /"passed"/);
});

test("closure manual smoke and tooling notes are recorded without inventing new ledger work", () => {
  for (const phrase of [
    "Ready Gate reconnect after degraded/closed realtime",
    "push deep link on two devices",
    "post-date verdict confirmation plus next-surface fallback",
    "deck optimistic swipe rollback plus in-card 429 retry state",
    "Daily room cleanup dry-run/rate-limit response",
    "existing Phase 8 certification tooling",
    "Web and native builds plus real-device smoke are release activities",
    "Supabase CLI v2.101.0 or newer is recommended",
    "Node `DEP0205` warning is non-blocking",
  ]) {
    assert.match(phase8Runbook, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
