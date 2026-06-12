import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import {
  decideCanonicalVideoDateRoute,
  nativePathForCanonicalVideoDateRoute,
  webPathForCanonicalVideoDateRoute,
  type VideoDateRouteSessionTruth,
} from "./videoDateRouteDecision";

import { readWebVideoCallFlowSource, readWebVideoDatePageFlowSource } from "../testUtils/webVideoDateFlowSources";
import { readNativeVideoDateScreenFlowSource } from "../testUtils/nativeVideoDateFlowSources";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function listRuntimeFiles(dir: string): string[] {
  const absolute = join(root, dir);
  const entries = readdirSync(absolute);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(absolute, entry);
    const relPath = relative(root, fullPath);
    if (
      relPath.includes("node_modules/") ||
      relPath.includes("/dist/") ||
      relPath.includes("/.expo/") ||
      relPath === "src/integrations/supabase/types.ts"
    ) {
      continue;
    }
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listRuntimeFiles(relPath));
      continue;
    }
    if (stat.isFile() && [".ts", ".tsx"].includes(extname(fullPath))) {
      files.push(relPath);
    }
  }
  return files.sort();
}

function filesWithRpcCall(rpcName: string): string[] {
  const rpcPattern = new RegExp(
    String.raw`\.rpc\(\s*["']${rpcName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
  );
  return listRuntimeFiles("src")
    .concat(listRuntimeFiles("apps/mobile"))
    .filter((path) => rpcPattern.test(read(path)))
    .sort();
}

function filesWithDateFeedbackWrite(): string[] {
  const writePattern =
    /\.from\(\s*["']date_feedback["']\s*\)[\s\S]{0,900}\.(insert|update|upsert|delete)\(/;
  return listRuntimeFiles("src")
    .concat(listRuntimeFiles("apps/mobile"))
    .filter((path) => writePattern.test(read(path)))
    .sort();
}

function blockBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `missing end marker after ${start}: ${end}`);
  return source.slice(startIndex, endIndex);
}

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const NOW_MS = Date.parse("2026-06-09T12:00:00.000Z");

function sessionTruth(
  overrides: Partial<VideoDateRouteSessionTruth> = {},
): VideoDateRouteSessionTruth {
  return {
    id: SESSION_ID,
    event_id: EVENT_ID,
    participant_1_id: "user-a",
    participant_2_id: "user-b",
    state: "ready_gate",
    phase: "ready_gate",
    ready_gate_status: "ready",
    ready_gate_expires_at: "2026-06-09T12:05:00.000Z",
    daily_room_name: null,
    daily_room_url: null,
    ended_at: null,
    ended_reason: null,
    ...overrides,
  };
}

test("canonical route ownership preserves every false finish line before feedback completion", () => {
  const bothReady = decideCanonicalVideoDateRoute({
    sessionId: SESSION_ID,
    eventId: EVENT_ID,
    nowMs: NOW_MS,
    truth: sessionTruth({
      ready_gate_status: "both_ready",
      daily_room_name: null,
      daily_room_url: null,
    }),
  });
  assert.equal(bothReady.target, "date");
  assert.equal(bothReady.reason, "both_ready_provider_prepare_pending");
  assert.equal(bothReady.canAttemptDaily, false);
  assert.equal(
    webPathForCanonicalVideoDateRoute(bothReady),
    `/date/${SESSION_ID}`,
  );
  assert.equal(
    nativePathForCanonicalVideoDateRoute(bothReady),
    `/date/${SESSION_ID}`,
  );

  const dailyRoomMetadataOnly = decideCanonicalVideoDateRoute({
    sessionId: SESSION_ID,
    eventId: EVENT_ID,
    nowMs: NOW_MS,
    truth: sessionTruth({
      ready_gate_status: "ready",
      daily_room_name: "date-11111111111141118111111111111111",
      daily_room_url:
        "https://vibelyapp.daily.co/date-11111111111141118111111111111111",
    }),
  });
  assert.equal(dailyRoomMetadataOnly.target, "ready_gate");
  assert.equal(dailyRoomMetadataOnly.reason, "ready_gate_active");
  assert.equal(dailyRoomMetadataOnly.canAttemptDaily, false);

  const serverReadyGateAfterBothReady = decideCanonicalVideoDateRoute({
    sessionId: SESSION_ID,
    eventId: EVENT_ID,
    nowMs: NOW_MS,
    truth: sessionTruth({
      ready_gate_status: "both_ready",
      daily_room_name: null,
      daily_room_url: null,
    }),
    serverNextSurface: {
      action: "ready_gate",
      session_id: SESSION_ID,
      event_id: EVENT_ID,
    },
  });
  assert.equal(serverReadyGateAfterBothReady.target, "date");
  assert.equal(
    serverReadyGateAfterBothReady.reason,
    "server_next_ready_gate_both_ready_date_owner",
  );

  const routeEntryOnlyEnded = decideCanonicalVideoDateRoute({
    sessionId: SESSION_ID,
    eventId: EVENT_ID,
    nowMs: NOW_MS,
    truth: sessionTruth({
      state: "ended",
      phase: "ended",
      ready_gate_status: "both_ready",
      ended_at: "2026-06-09T12:01:00.000Z",
      ended_reason: "handshake_timeout",
      participant_1_joined_at: "2026-06-09T12:00:10.000Z",
      participant_2_joined_at: null,
      participant_1_remote_seen_at: null,
      participant_2_remote_seen_at: null,
    }),
  });
  assert.equal(routeEntryOnlyEnded.target, "ended");
  assert.equal(routeEntryOnlyEnded.reason, "session_ended");

  const pendingSurvey = decideCanonicalVideoDateRoute({
    sessionId: SESSION_ID,
    eventId: EVENT_ID,
    nowMs: NOW_MS,
    registration: {
      queue_status: "in_survey",
      current_room_id: SESSION_ID,
      event_id: EVENT_ID,
    },
    truth: sessionTruth({
      state: "ended",
      phase: "ended",
      ended_at: "2026-06-09T12:05:00.000Z",
      ended_reason: "date_completed",
      participant_1_joined_at: "2026-06-09T12:00:05.000Z",
      participant_2_joined_at: "2026-06-09T12:00:06.000Z",
      participant_1_remote_seen_at: "2026-06-09T12:00:08.000Z",
      participant_2_remote_seen_at: "2026-06-09T12:00:09.000Z",
    }),
  });
  assert.equal(pendingSurvey.target, "survey");
  assert.equal(pendingSurvey.reason, "registration_pending_survey");
  assert.equal(
    webPathForCanonicalVideoDateRoute(pendingSurvey),
    `/date/${SESSION_ID}`,
  );
  assert.equal(
    nativePathForCanonicalVideoDateRoute(pendingSurvey),
    `/date/${SESSION_ID}`,
  );

  const feedbackCompleted = decideCanonicalVideoDateRoute({
    sessionId: SESSION_ID,
    eventId: EVENT_ID,
    nowMs: NOW_MS,
    userFeedbackSubmitted: true,
    registration: {
      queue_status: "in_survey",
      current_room_id: SESSION_ID,
      event_id: EVENT_ID,
    },
    truth: sessionTruth({
      state: "ended",
      phase: "ended",
      ended_at: "2026-06-09T12:05:00.000Z",
      ended_reason: "date_completed",
      participant_1_joined_at: "2026-06-09T12:00:05.000Z",
      participant_2_joined_at: "2026-06-09T12:00:06.000Z",
      participant_1_remote_seen_at: "2026-06-09T12:00:08.000Z",
      participant_2_remote_seen_at: "2026-06-09T12:00:09.000Z",
    }),
  });
  assert.equal(feedbackCompleted.target, "ended");
  assert.equal(feedbackCompleted.reason, "session_ended");
});

test("Daily/provider evidence RPCs are owned only by the date surfaces", () => {
  // PR 7.5 split the web date call surface into the videoCall concern
  // family; each evidence RPC now has exactly one web concern owner plus
  // the native date route (a strictly tighter contract than the previous
  // single-file ownership).
  const evidenceRpcOwners: Record<string, string[]> = {
    // PR 8 moved the native daily_alive heartbeat into its concern hook.
    mark_video_date_daily_alive: [
      "apps/mobile/lib/videoDate/useNativeDailyAliveHeartbeat.ts",
      "src/hooks/videoCall/useDailyAliveHeartbeat.ts",
    ],
    // PR 8.5 moved the native bodies into their concern hooks too.
    mark_video_date_daily_joined: [
      "apps/mobile/lib/videoDate/useNativeVideoDateStartCall.ts",
      "src/hooks/videoCall/useVideoDateStartCall.ts",
    ],
    mark_video_date_remote_seen: [
      "apps/mobile/lib/videoDate/useNativeVideoDateRemoteSeen.ts",
      "src/hooks/videoCall/useVideoDateRemoteSeen.ts",
    ],
  };

  for (const [rpcName, owners] of Object.entries(evidenceRpcOwners)) {
    assert.deepEqual(filesWithRpcCall(rpcName), owners, rpcName);
  }
});

test("surface claim, ready commit, and post-date writes keep separate owners", () => {
  assert.deepEqual(filesWithRpcCall("claim_video_date_surface"), [
    // PR 8.5: the native claim loop lives in its concern hook.
    "apps/mobile/lib/videoDate/useNativeVideoDateSurfaceClaim.ts",
    "src/hooks/useVideoDateDupTabGuard.ts",
  ]);
  assert.deepEqual(filesWithRpcCall("video_session_mark_ready_v2"), [
    "apps/mobile/lib/readyGateApi.ts",
    "src/hooks/useReadyGate.ts",
  ]);
  assert.deepEqual(filesWithRpcCall("update_post_date_feedback_details"), [
    "apps/mobile/components/video-date/PostDateSurvey.tsx",
    "src/components/video-date/PostDateSurvey.tsx",
  ]);
  assert.deepEqual(filesWithDateFeedbackWrite(), []);
});

test("web date pre-date failure exits use the manual server-end path", () => {
  const webVideoDatePage = readWebVideoDatePageFlowSource(root);
  const mediaPermissionBlock = blockBetween(
    webVideoDatePage,
    "const permissionBlock =",
    "if (entryStartFailed)",
  );
  const handshakeFailureBlock = blockBetween(
    webVideoDatePage,
    "if (entryStartFailed)",
    "if (callStartFailure?.retryable)",
  );
  const retryableStartFailureBlock = blockBetween(
    webVideoDatePage,
    "if (callStartFailure?.retryable)",
    "showDuplicateTabConflict &&",
  );

  for (const [block, source] of [
    [mediaPermissionBlock, "camera_permission_denied_exit"],
    [handshakeFailureBlock, "entry_start_failed_back"],
    [retryableStartFailureBlock, "retryable_call_start_back"],
  ] as const) {
    assert.match(block, /handlePreDateExit\(/, source);
    assert.match(block, new RegExp(`source:\\s*"${source}"`), source);
    assert.doesNotMatch(block, /navigate\(target/, source);
    assert.doesNotMatch(block, /clearDateEntryTransition\(id\)/, source);
  }

  const duplicateTabBlock = blockBetween(
    webVideoDatePage,
    "showDuplicateTabConflict &&",
    "data-video-date-stage",
  );
  assert.match(duplicateTabBlock, /duplicate_tab_back/);
  assert.match(duplicateTabBlock, /navigate\(target\)/);
  assert.doesNotMatch(duplicateTabBlock, /handlePreDateExit\(/);
});

test("web and native Daily guards adopt same-session owners before reporting busy", () => {
  const webGuard = read("src/lib/dailyCallInstance.ts");
  const nativeGuard = read("apps/mobile/lib/nativeDailyCallInstance.ts");
  const webVideoCall = readWebVideoCallFlowSource(root);
  const webPrewarm = read("src/lib/videoDateDailyPrewarm.ts");
  const nativeDateRoute = readNativeVideoDateScreenFlowSource();
  const nativePrewarm = read("apps/mobile/lib/videoDateDailyPrewarm.ts");

  for (const [source, adoptEvent, currentEvent] of [
    [
      webGuard,
      "daily_guard_adopted_same_session_external_call",
      "daily_guard_adopted_current_call_object",
    ],
    [
      nativeGuard,
      "native_daily_guard_adopted_same_session_external_call",
      "native_daily_guard_adopted_current_call_object",
    ],
  ] as const) {
    assert.match(source, /adoptMatchingExternalCall\?: boolean/);
    assert.match(source, /videoDateSessionId\?: string \| null/);
    assert.match(source, /videoDateRoomName\?: string \| null/);
    assert.match(source, /adoptedExternalCall: true/);
    assert.match(source, new RegExp(adoptEvent));
    assert.match(source, new RegExp(currentEvent));
  }

  const webStartGuard = blockBetween(
    webVideoCall,
    "const guarded = await createDailyCallObjectGuarded(",
    "onDiagnostic: (eventName, payload)",
  );
  const webPrewarmGuard = blockBetween(
    webPrewarm,
    "const guardedCall = await createDailyCallObjectGuarded(",
    "onDiagnostic: (eventName, payload)",
  );
  const nativeStartGuard = blockBetween(
    nativeDateRoute,
    "const guarded = await createVideoDateDailyCallObjectGuarded(",
    "onDiagnostic: (eventName, payload)",
  );
  const nativePrewarmGuard = blockBetween(
    nativePrewarm,
    "const guardedCall = await createVideoDateDailyCallObjectGuarded(",
    "onDiagnostic: (eventName, payload)",
  );

  for (const [block, adoptionPattern, sessionPattern, roomPattern] of [
    [
      webStartGuard,
      /adoptMatchingExternalCall: true/,
      /videoDateSessionId: sessionId/,
      /videoDateRoomName: roomData\.room_name/,
    ],
    [
      webPrewarmGuard,
      /adoptMatchingExternalCall: false/,
      /videoDateSessionId: params\.sessionId/,
      /videoDateRoomName: params\.roomName/,
    ],
    [
      nativeStartGuard,
      /adoptMatchingExternalCall: true/,
      /videoDateSessionId: sessionId/,
      /videoDateRoomName: tokenResult\.room_name/,
    ],
    [
      nativePrewarmGuard,
      /adoptMatchingExternalCall: false/,
      /videoDateSessionId: params\.sessionId/,
      /videoDateRoomName: params\.roomName/,
    ],
  ] as const) {
    assert.match(block, adoptionPattern);
    assert.match(block, sessionPattern);
    assert.match(block, roomPattern);
  }
});

test("definitive ownership contract is wired into Video Date suites", () => {
  const packageJson = read("package.json");
  assert.match(packageJson, /videoDateDefinitiveOwnershipContracts\.test\.ts/);
});
