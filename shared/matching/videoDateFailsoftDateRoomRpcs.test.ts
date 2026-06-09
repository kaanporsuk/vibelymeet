import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const failsoftMigration = read(
  "supabase/migrations/20260604093000_video_date_failsoft_date_room_rpcs.sql",
);
const transitionCompatibilityMigration = read(
  "supabase/migrations/20260604094500_video_date_transition_preserve_raise_semantics.sql",
);
const webVideoDate = read("src/pages/VideoDate.tsx");
const webVideoCall = read("src/hooks/useVideoCall.ts");
const webReconnectionHook = read("src/hooks/useReconnection.ts");
const webDupTabGuard = read("src/hooks/useVideoDateDupTabGuard.ts");
const nativeDateRoute = read("apps/mobile/app/date/[id].tsx");
const nativeVideoDateApi = read("apps/mobile/lib/videoDateApi.ts");
const handshakePersistence = read(
  "shared/matching/videoDateHandshakePersistence.ts",
);
const dailyRoomFunction = read("supabase/functions/daily-room/index.ts");
const dailyRoomFailure = read("shared/matching/dailyRoomFailure.ts");

function publicFunctionBody(migration: string, name: string): string {
  const match = migration.match(
    new RegExp(
      String.raw`CREATE OR REPLACE FUNCTION public\.${name}\([\s\S]*?\n\$function\$;`,
      "m",
    ),
  );
  assert.ok(match, `expected ${name} function body to exist`);
  return match[0];
}

function stripSqlLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

test("date-room fail-soft migration keeps claim and Daily-joined retryable", () => {
  const claimBody = publicFunctionBody(
    failsoftMigration,
    "claim_video_date_surface",
  );
  const markJoinedBody = publicFunctionBody(
    failsoftMigration,
    "mark_video_date_daily_joined",
  );

  for (const body of [claimBody, markJoinedBody]) {
    assert.match(body, /EXCEPTION\s+WHEN OTHERS THEN/);
    assert.match(body, /'retryable', true/);
    assert.match(body, /'retry_after_ms', 1500/);
    assert.match(body, /GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT/);
  }

  assert.match(claimBody, /'code', 'SURFACE_CLAIM_FAILED'/);
  assert.match(markJoinedBody, /'code', 'DAILY_JOIN_STAMP_FAILED'/);
});

test("video_date_transition preserves HTTP-error retry semantics for older clients", () => {
  const transitionBody = publicFunctionBody(
    transitionCompatibilityMigration,
    "video_date_transition",
  );
  const executableTransitionBody = stripSqlLineComments(transitionBody);

  assert.match(
    executableTransitionBody,
    /RETURN public\.video_date_transition_20260604093000_failsoft_base\(/,
  );
  assert.doesNotMatch(executableTransitionBody, /EXCEPTION\s+WHEN OTHERS/);
  assert.match(
    transitionCompatibilityMigration,
    /backend errors propagate as RPC errors so web\/native callers retry/,
  );
  assert.match(
    transitionCompatibilityMigration,
    /NOTIFY pgrst, 'reload schema'/,
  );
});

test("web and native clients consume retryable fail-soft payloads instead of ending the date", () => {
  assert.match(
    webVideoDate,
    /payload\?\.success === false && payload\.retryable === true[\s\S]{0,180}scheduleRetry/,
  );
  assert.match(
    nativeVideoDateApi,
    /payload\?\.success === false && payload\.retryable === true\) return null/,
  );
  assert.match(
    handshakePersistence,
    /const rpcRejectedRetryable = rpcRejected && lastPayload\?\.retryable === true/,
  );
  assert.match(
    handshakePersistence,
    /if \(rpcRejectedRetryable && attempt <= delays\.length\) continue/,
  );
});

test("web and native reconnect consumers treat fail-soft transition payloads as retryable uncertainty", () => {
  assert.match(
    webReconnectionHook,
    /p\?\.success === false[\s\S]{0,500}p\.code === "SESSION_ENDED"[\s\S]{0,220}return null/,
  );
  assert.match(
    webVideoCall,
    /const failsoftRejected = payload\?\.success === false/,
  );
  assert.match(
    webVideoCall,
    /retryable: error\s*\? true\s*:\s*videoDateLifecycleRpcRetryable\(payload\) === true/,
  );
  assert.match(
    webVideoDate,
    /const reconnectRejected = reconnectPayload\?\.success === false/,
  );
  assert.match(
    webVideoDate,
    /if\s*\(\s*videoDateLifecycleRpcRetryable\(reconnectPayload\) === true\s*\)\s*return/,
  );
  assert.match(
    nativeVideoDateApi,
    /p\?\.success === false[\s\S]{0,500}const terminalStop =[\s\S]{0,220}videoDateLifecycleRpcIndicatesTerminalStop\(p\)/,
  );
  assert.match(
    nativeVideoDateApi,
    /if \(terminalStop\) \{[\s\S]{0,260}ended: true/,
  );
});

test("web duplicate-tab surface claims ignore retryable fail-soft rejections", () => {
  assert.match(
    webDupTabGuard,
    /payload\?\.code === "SURFACE_CLAIM_CONFLICT" && payload\.retryable !== true/,
  );
});

test("web and native Daily-joined confirmation both retry 200 retryable payloads", () => {
  assert.match(
    webVideoCall,
    /retryable: joinedError\s*\? true\s*:\s*videoDateLifecycleRpcRetryable\(payload\)/,
  );
  assert.match(
    nativeDateRoute,
    /retryable: joinedError\s*\? true\s*:\s*videoDateLifecycleRpcRetryable\(payload\)/,
  );
});

test("native surface claim does not block takeover on transient fail-soft errors", () => {
  assert.match(
    nativeDateRoute,
    /const blocked =\s*payload\?\.code === ['"]SURFACE_CLAIM_CONFLICT['"]\s*&&\s*payload\.retryable !== true/,
  );
  assert.match(nativeDateRoute, /setSurfaceClaimBlockedState\(blocked\)/);
  assert.doesNotMatch(
    nativeDateRoute,
    /setSurfaceClaimBlocked\(blocked \|\| takeover\)/,
  );
  assert.match(nativeDateRoute, /retryable: payload\?\.retryable === true/);
});

test("native prejoin no longer exposes a standalone enter-handshake retry path", () => {
  assert.doesNotMatch(
    nativeVideoDateApi,
    /EnterHandshakeResult|enterHandshakeWithTimeout|export async function enterHandshake|p_action:\s*['"]enter_handshake['"]/,
  );
  assert.doesNotMatch(
    nativeDateRoute,
    /enterHandshakeWithTimeout|isReadyGateRace\(hs\.code\)|previousRetryable: hs\.retryable|enter_handshake_fail/,
  );
  assert.match(
    nativeDateRoute,
    /currentStep = setPrejoinStep\("prepare_entry_routeable"\)/,
  );
  assert.match(
    nativeDateRoute,
    /await recoverFromNotStartableDateTruth\("prepare_date_entry"\)/,
  );
});

test("native date prejoin retries retryable prepare-entry failures like web", () => {
  assert.match(nativeVideoDateApi, /retryable: boolean/);
  assert.match(nativeVideoDateApi, /retryable: result\.retryable/);
  assert.match(nativeVideoDateApi, /retryAfterMs: result\.retryAfterMs/);
  assert.match(nativeDateRoute, /NATIVE_PREPARE_DATE_ENTRY_RETRY_DELAYS_MS/);
  assert.match(nativeDateRoute, /dailyRoomTokenRetryDelayMs\(\s*tokenRes/);
  assert.match(
    nativeDateRoute,
    /tokenRes\.retryable[\s\S]{0,160}tokenRes\.code !== ['"]READY_GATE_NOT_READY['"]/,
  );
  assert.match(nativeDateRoute, /retryable: tokenRes\.retryable/);
});

test("prepare-entry Edge failures preserve retryable payloads for shared clients", () => {
  assert.match(dailyRoomFunction, /retryable\?: boolean/);
  assert.match(
    dailyRoomFunction,
    /typeof params\.retryable === "boolean" \? \{ retryable: params\.retryable \} : \{\}/,
  );
  assert.match(
    dailyRoomFunction,
    /retryable: typeof preparePayload\?\.retryable === "boolean"/,
  );
  assert.match(
    dailyRoomFailure,
    /const bodyRetryable = readRetryableFromBody\(input\.data\)/,
  );
  assert.match(
    dailyRoomFailure,
    /const contextRetryable = fromResponse\.retryable \?\? fromErrorContext\.retryable/,
  );
  assert.match(
    dailyRoomFailure,
    /bodyRetryable \?\? contextRetryable \?\? isRetryableDailyRoomFailure\(kind\)/,
  );
});

test("daily-room leave proxy preserves retryable transition payloads", () => {
  assert.match(
    dailyRoomFunction,
    /action === "video_date_leave"[\s\S]*retryable: typeof payload\?\.retryable === "boolean" \? payload\.retryable : error \? true : undefined/,
  );
  assert.match(
    dailyRoomFunction,
    /retryAfterSeconds: payload\?\.retry_after_seconds \?\? null/,
  );
  assert.match(dailyRoomFunction, /retry_after_ms: payload\.retry_after_ms/);
});

test("new date-room migrations avoid overlong PostgreSQL identifiers", () => {
  for (const [name, migration] of [
    ["20260604093000", failsoftMigration],
    ["20260604094500", transitionCompatibilityMigration],
  ] as const) {
    const functionRefs = Array.from(
      migration.matchAll(/\b(?:FUNCTION|PROCEDURE)\s+public\.([A-Za-z0-9_]+)/g),
    ).map(([, identifier]) => identifier);
    assert.ok(
      functionRefs.length > 0,
      `${name} should contain explicit function refs`,
    );
    assert.deepEqual(
      functionRefs.filter((identifier) => identifier.length > 63),
      [],
      `${name} must not rely on PostgreSQL identifier truncation`,
    );
  }
});
