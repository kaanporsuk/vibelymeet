import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  isReadyGatePrepareEntryNonRetryable,
  resolveReadyGateTerminalRecovery,
} from "./readyGateTerminalRecovery";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function classNameLiterals(source: string): string[] {
  return Array.from(source.matchAll(/className\s*=\s*(["'])([\s\S]*?)\1/g), (match) => match[2] ?? "");
}

function assertHasClassNameTokens(source: string, tokens: string[]) {
  const classes = classNameLiterals(source).map((className) => new Set(className.trim().split(/\s+/).filter(Boolean)));
  assert.ok(
    classes.some((classNames) => tokens.every((token) => classNames.has(token))),
    `expected one className literal containing tokens: ${tokens.join(", ")}`,
  );
}

function assertNoClassNameToken(source: string, token: string) {
  assert.ok(
    classNameLiterals(source).every((className) => !className.trim().split(/\s+/).includes(token)),
    `expected no className literal to contain token: ${token}`,
  );
}

function assertStyleStringValue(source: string, property: string, value: string) {
  assert.match(source, new RegExp(String.raw`\b${escapeRegExp(property)}:\s*['"]${escapeRegExp(value)}['"]`));
}

function assertNoStyleStringValue(source: string, property: string, value: string) {
  assert.doesNotMatch(source, new RegExp(String.raw`\b${escapeRegExp(property)}:\s*['"]${escapeRegExp(value)}['"]`));
}

const webReadyGate = read("src/components/lobby/ReadyGateOverlay.tsx");
const webReadyGateHook = read("src/hooks/useReadyGate.ts");
const nativeReadyGateApi = read("apps/mobile/lib/readyGateApi.ts");
const analytics = read("shared/analytics/lobbyToPostDateJourney.ts");

const webConsumerFiles = [
  "src/components/lobby/ReadyGateOverlay.tsx",
  "src/hooks/useReadyGate.ts",
  "src/pages/EventLobby.tsx",
  "src/pages/ReadyRedirect.tsx",
  "src/lib/videoDatePrepareEntry.ts",
  "src/hooks/useMatchQueue.ts",
  "src/hooks/useActiveSession.ts",
  "src/hooks/useEventStatus.ts",
  "src/hooks/useVideoCall.ts",
  "src/pages/VideoDate.tsx",
];

const forbiddenVideoSessionFields = [
  "ready_gate_status",
  "ready_participant_1_at",
  "ready_participant_2_at",
  "ready_gate_expires_at",
  "snoozed_by",
  "snooze_expires_at",
  "state",
  "phase",
  "ended_at",
  "ended_reason",
];

const forbiddenRegistrationFields = [
  "queue_status",
  "current_room_id",
  "current_partner_id",
];

function assertNoForbiddenSupabaseWrites(paths: string[], table: string, fields: readonly string[]) {
  const fieldPattern = fields.join("|");
  const mutationPattern = new RegExp(
    String.raw`\.from\(\s*['"]${table}['"]\s*\)[\s\S]{0,1400}\.(?:update|insert|upsert)\(\s*(?:\{[\s\S]{0,900})?(?:${fieldPattern})`,
    "m",
  );

  for (const path of paths) {
    const source = read(path);
    assert.doesNotMatch(source, mutationPattern, `${path} must not directly mutate ${table} lifecycle fields`);
  }
}

test("terminal recovery mapping distinguishes partner forfeit from timeout", () => {
  const forfeited = resolveReadyGateTerminalRecovery({ status: "forfeited", reason: "ready_gate_forfeit" });
  const expired = resolveReadyGateTerminalRecovery({ status: "expired", reason: "ready_gate_expired" });

  assert.equal(forfeited.category, "partner_forfeited");
  assert.match(forfeited.toast, /stepped away/i);
  assert.equal(expired.category, "expired");
  assert.match(expired.toast, /timed out/i);
  assert.notEqual(forfeited.toast, expired.toast);
});

test("terminal recovery mapping handles event ended, cancelled, archived, and inactive reasons", () => {
  assert.equal(resolveReadyGateTerminalRecovery({ reason: "ready_gate_event_ended" }).category, "event_ended");
  assert.equal(resolveReadyGateTerminalRecovery({ inactiveReason: "event_outside_live_window" }).category, "event_ended");
  assert.equal(resolveReadyGateTerminalRecovery({ reason: "ready_gate_event_cancelled" }).category, "event_cancelled");
  assert.equal(resolveReadyGateTerminalRecovery({ reason: "ready_gate_event_archived" }).category, "event_archived");
  assert.equal(resolveReadyGateTerminalRecovery({ errorCode: "EVENT_NOT_ACTIVE" }).category, "event_inactive");
});

test("EVENT_NOT_ACTIVE prepare-entry blocker is non-retryable stale handoff truth", () => {
  const input = {
    code: "READY_GATE_NOT_READY",
    errorCode: "EVENT_NOT_ACTIVE",
    inactiveReason: "event_ended",
    source: "prepare_entry",
  };
  const recovery = resolveReadyGateTerminalRecovery(input);

  assert.equal(isReadyGatePrepareEntryNonRetryable(input), true);
  assert.equal(recovery.retryable, false);
  assert.equal(recovery.terminal, true);
});

test("prepare-entry terminal blocker covers access, safety, session, and provider-auth failures", () => {
  const terminalInputs = [
    { code: "ACCESS_DENIED" },
    { code: "BLOCKED_PAIR" },
    { code: "SESSION_ENDED" },
    { code: "SESSION_NOT_FOUND" },
    { code: "ROOM_NOT_FOUND" },
    { code: "DAILY_AUTH_FAILED" },
    { code: "DAILY_CREDENTIALS_INVALID" },
    { code: "DAILY_REQUEST_REJECTED" },
    { httpStatus: 401 },
    { httpStatus: 403 },
    { httpStatus: 404 },
    { httpStatus: 410 },
  ];

  for (const input of terminalInputs) {
    const recoveryInput = { ...input, source: "prepare_entry" };
    const recovery = resolveReadyGateTerminalRecovery(recoveryInput);

    assert.equal(
      isReadyGatePrepareEntryNonRetryable(recoveryInput),
      true,
      JSON.stringify(input),
    );
    assert.equal(recovery.retryable, false, JSON.stringify(input));
    assert.equal(recovery.terminal, true, JSON.stringify(input));
  }

  for (const code of [
    "READY_GATE_NOT_READY",
    "DAILY_PROVIDER_ERROR",
    "DAILY_PROVIDER_UNAVAILABLE",
    "DAILY_RATE_LIMIT",
    "DB_ROOM_PERSIST_FAILED",
    "REGISTRATION_PERSIST_FAILED",
    "network",
  ]) {
    assert.equal(
      isReadyGatePrepareEntryNonRetryable({
        code,
        errorCode: code,
        httpStatus: code === "READY_GATE_NOT_READY" ? 403 : undefined,
        source: "prepare_entry",
      }),
      false,
      code,
    );
  }
});

test("web Ready Gate still gates date navigation through prepareVideoDateEntry", () => {
  assert.match(webReadyGate, /prepareVideoDateEntry\(sessionId/);
  assert.match(webReadyGate, /navigateToDate\("both_ready_prepare_success"\)/);
  assert.match(webReadyGate, /adviseVideoSessionTruthRecovery/);
  assert.match(webReadyGate, /recovery\.action === "go_date"/);
});

test("web Ready Gate consumers do not directly write backend-owned lifecycle fields", () => {
  assertNoForbiddenSupabaseWrites(webConsumerFiles, "video_sessions", forbiddenVideoSessionFields);
  assertNoForbiddenSupabaseWrites(webConsumerFiles, "event_registrations", forbiddenRegistrationFields);
});

test("duplicate navigation and terminal side effects are session-latched", () => {
  assert.match(webReadyGate, /duplicateNavSuppressionKeysRef/);
  assert.match(webReadyGate, /duplicateTerminalSuppressionKeysRef/);
  assert.match(webReadyGate, /nonRetryablePrepareFailureRef/);
  assert.match(webReadyGate, /READY_GATE_CLIENT_DUPLICATE_NAV_SUPPRESSED/);
  assert.match(webReadyGate, /READY_GATE_CLIENT_DUPLICATE_TERMINAL_SUPPRESSED/);
});

test("client observability covers transition, terminal, and prepare-entry failures", () => {
  for (const eventName of [
    "READY_GATE_CLIENT_TRANSITION_FAILURE",
    "READY_GATE_CLIENT_TERMINAL",
    "READY_GATE_CLIENT_PREPARE_ENTRY_FAILURE",
    "READY_GATE_CLIENT_PREPARE_ENTRY_EVENT_INACTIVE",
  ]) {
    assert.match(analytics, new RegExp(eventName));
    assert.match(webReadyGate + webReadyGateHook, new RegExp(eventName));
  }
  assert.match(webReadyGate, /Sentry\.addBreadcrumb/);
});

test("ReadyGateOverlay exposes basic dialog accessibility and reduced-motion hooks", () => {
  for (const marker of [
    'role="dialog"',
    'aria-modal="true"',
    'aria-labelledby="ready-gate-title"',
    'aria-describedby="ready-gate-description"',
    'role="status"',
    'aria-live="polite"',
    'role="alert"',
    'aria-label=',
    'aria-busy=',
    "useReducedMotion",
  ]) {
    assert.match(webReadyGate, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("web ReadyGateOverlay stays centered on mobile instead of becoming a bottom sheet", () => {
  assertHasClassNameTokens(webReadyGate, ["fixed", "inset-0", "items-center", "justify-center", "overflow-y-auto"]);
  assertStyleStringValue(webReadyGate, "height", "100dvh");
  assertNoStyleStringValue(webReadyGate, "minHeight", "100vh");
  assertStyleStringValue(webReadyGate, "paddingTop", "max(1.5rem, calc(env(safe-area-inset-top) + 1rem))");
  assertStyleStringValue(webReadyGate, "paddingBottom", "max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))");
  assertHasClassNameTokens(webReadyGate, ["max-h-full", "overflow-y-auto"]);
  assertNoClassNameToken(webReadyGate, "items-end");
  assertNoClassNameToken(webReadyGate, "mb-4");
  assertNoClassNameToken(webReadyGate, "sm:mb-0");
});

test("native Ready Gate preserves backend terminal distinction without full parity rewrite", () => {
  assert.match(nativeReadyGateApi, /status === EXPIRED \? 'timeout' : 'skip'/);
  assert.match(nativeReadyGateApi, /ready_gate_transition/);
});

test("backend Streams 1-4 artifacts remain present and migrations untouched", () => {
  assert.match(
    read("supabase/migrations/20260501180000_event_lobby_active_event_contract.sql"),
    /CREATE OR REPLACE FUNCTION public\.get_event_lobby_inactive_reason/,
  );
  assert.match(
    read("supabase/migrations/20260501190000_ready_gate_transition_expiry_rowcount.sql"),
    /GET DIAGNOSTICS v_row_count = ROW_COUNT/,
  );
  assert.match(
    read("supabase/migrations/20260501200000_ready_gate_event_ended_terminalization.sql"),
    /CREATE OR REPLACE FUNCTION public\.terminalize_event_ready_gates/,
  );
  assert.match(read("docs/ready-gate-backend-contract.md"), /Ready Gate Backend Contract/);
});
