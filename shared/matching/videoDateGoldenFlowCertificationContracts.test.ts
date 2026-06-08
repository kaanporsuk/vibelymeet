import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { buildVideoDateCertificationDiagnostic } from "./videoDateDiagnostics";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const packageJson = read("package.json");
const invariantSql = read("docs/sql/video-date-invariants.sql");
const invariantRunner = read("scripts/check-video-date-invariants.mjs");
const functionVerifier = read("scripts/verify-video-date-functions.mjs");
const goldenFlowCertifier = read("scripts/certify-video-date-golden-flow.mjs");
const goldenFlowDoc = read("docs/qa/video-date-golden-flow-certification.md");
const nativeDeviceDoc = read("docs/qa/video-date-native-device-certification.md");
const edgeRunbook = read("docs/runbooks/video-date-edge-function-release-verification.md");

test("red-flag and certification commands are first-class package scripts", () => {
  for (const scriptName of [
    "test:video-date:red-flags",
    "check:video-date:invariants",
    "verify:video-date:functions",
    "certify:video-date:golden-flow",
  ]) {
    assert.match(packageJson, new RegExp(`"${scriptName}"`));
  }
  assert.match(packageJson, /shared\/matching\/videoDateFailsoftDateRoomRpcs\.test\.ts/);
  assert.match(packageJson, /shared\/matching\/nativeReadyGateParityContract\.test\.ts/);
});

test("invariant pack is read-only and covers the Golden Flow failure boundaries", () => {
  assert.doesNotMatch(invariantSql, /\b(insert|update|delete|alter|drop|create|truncate)\b/i);
  for (const invariant of [
    "both_ready_requires_both_ready_stamps",
    "both_ready_requires_canonical_daily_room",
    "active_date_requires_confirmed_encounter_evidence",
    "date_route_must_own_after_handshake_or_date",
    "active_video_registration_points_to_live_session",
    "survey_required_unfinished_feedback_must_remain_in_survey",
    "survey_pending_feedback_held_in_survey",
    "provider_join_webhook_evidence_present_for_recent_joined_sessions",
    "video_date_surface_claims_are_bounded_per_session",
  ]) {
    assert.match(invariantSql, new RegExp(invariant));
  }
  assert.match(invariantSql, /date_feedback/);
  assert.match(invariantSql, /video_date_daily_webhook_events/);
});

test("operator scripts are non-deploying by default", () => {
  assert.match(invariantRunner, /SUPABASE_DB_URL/);
  assert.match(invariantRunner, /PHASE8_STAGING_DB_URL/);
  assert.match(invariantRunner, /docs\/sql\/video-date-invariants\.sql/);
  assert.doesNotMatch(invariantRunner, /db push|functions deploy/);

  assert.match(functionVerifier, /functions",\s*"list"/);
  assert.match(functionVerifier, /--skip-remote/);
  assert.match(functionVerifier, /--require-remote/);
  assert.match(functionVerifier, /remoteSlugs\.has\(name\)/);
  assert.doesNotMatch(functionVerifier, /remote\.includes\(name\)/);
  assert.doesNotMatch(functionVerifier, /functions",\s*"deploy"|db",\s*"push"/);

  assert.match(invariantRunner, /Array\.isArray\(parsed\)/);
  assert.match(invariantRunner, /Array\.isArray\(parsed\.rows\)/);
  assert.match(goldenFlowCertifier, /loadLocalEnv\(\);\s*function hasDbUrl/);
  assert.match(goldenFlowCertifier, /certified: false/);
  assert.match(
    goldenFlowCertifier,
    /fresh_two_user_runtime_run_through_both_date_feedback_is_required/,
  );
});

test("certification documents keep runtime proof and native device proof explicit", () => {
  assert.match(goldenFlowDoc, /both users saving `date_feedback`/);
  assert.match(goldenFlowDoc, /Do not classify the flow as fixed/);
  assert.match(goldenFlowDoc, /npm run test:video-date:red-flags/);
  assert.match(goldenFlowDoc, /npm run check:video-date:invariants/);
  assert.match(nativeDeviceDoc, /physical-device proof/);
  assert.match(nativeDeviceDoc, /Run each scenario on both platforms/);
  assert.match(edgeRunbook, /Exact byte-for-byte equality/);
  assert.match(edgeRunbook, /npm run verify:video-date:functions -- --require-remote/);
});

test("certification diagnostics are redacted and role-based", () => {
  const rawInput: Record<string, unknown> = {
    platform: "native",
    session_id: "session-1",
    event_id: "event-1",
    surface_owner: "date",
    ready_gate_status: "both_ready",
    daily_room_name: "date-session-1",
    daily_room_url_present: true,
    token_fetch_state: "ready",
    joined_roles: ["participant_1", "participant_2", "unknown" as never],
    provider_joined_roles: ["participant_2", "participant_1"],
    remote_seen_roles: ["participant_1"],
    survey_state: "persisted",
    next_surface: "event_lobby",
    terminal: true,
    code: "SESSION_ENDED",
    retryable: false,
    timestamp_ms: 123.9,
    daily_token: "secret",
    daily_room_url: "https://example.daily.co/date-session-1",
  };
  const diagnostic = buildVideoDateCertificationDiagnostic(rawInput);

  assert.deepEqual(diagnostic.joined_roles, ["participant_1", "participant_2"]);
  assert.deepEqual(diagnostic.provider_joined_roles, ["participant_1", "participant_2"]);
  assert.equal(diagnostic.timestamp_ms, 123);
  const serialized = JSON.stringify(diagnostic);
  assert.doesNotMatch(serialized, /secret|daily_token|"daily_room_url":|https:\/\//);
});
