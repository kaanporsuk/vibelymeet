import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  claimVideoDateEntryOwner,
  getVideoDateDailyOwner,
  getVideoDateEntryOwner,
  releaseVideoDateEntryOwner,
  subscribeVideoDateDailyOwner,
  updateVideoDateDailyOwnerState,
  updateVideoDateEntryOwnerState,
} from "./videoDateEntryOwner";

import { readWebVideoCallFlowSource } from "../testUtils/webVideoDateFlowSources";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const webPrepare = read("src/lib/videoDatePrepareEntry.ts");
const nativePrepare = read("apps/mobile/lib/videoDatePrepareEntry.ts");
const webDate = readWebVideoCallFlowSource(root);
const nativeDate = read("apps/mobile/app/date/[id].tsx");
const webReadyGate = read("src/components/lobby/ReadyGateOverlay.tsx");
const nativeReadyGate = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
const nativeReadyRoute = read("apps/mobile/app/ready/[id].tsx");
const webLobby = read("src/pages/EventLobby.tsx");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const migration = read(
  "supabase/migrations/20260606180000_video_date_stable_copresence_handshake_guard.sql",
);
const providerAuthoritativeMigration = read(
  "supabase/migrations/20260606203000_video_date_provider_authoritative_presence.sql",
);
const providerParticipantIdRepairMigration = read(
  "supabase/migrations/20260606205211_video_date_provider_participant_id_presence_repair.sql",
);

test("entry owner is single-flight per session and user", () => {
  const sessionId = `session-${Date.now()}-${Math.random()}`;
  const userId = `user-${Date.now()}-${Math.random()}`;
  const first = claimVideoDateEntryOwner({
    sessionId,
    userId,
    source: "test_first",
    entryAttemptId: "attempt-1",
  });
  assert.equal(first.ok, true);
  assert.equal(first.owner.state, "preparing");

  const second = claimVideoDateEntryOwner({
    sessionId,
    userId,
    source: "test_second",
    entryAttemptId: "attempt-2",
  });
  assert.equal(second.ok, false);
  assert.equal(second.owner.ownerId, first.owner.ownerId);
  assert.equal(second.owner.entryAttemptId, "attempt-1");

  const prepared = updateVideoDateEntryOwnerState({
    sessionId,
    userId,
    ownerId: first.owner.ownerId,
    state: "prepared",
    roomName: "room_a",
    entryAttemptId: "attempt-1",
  });
  assert.equal(prepared?.state, "prepared");
  assert.equal(getVideoDateEntryOwner(sessionId, userId)?.roomName, "room_a");

  assert.equal(
    releaseVideoDateEntryOwner({
      sessionId,
      userId,
      ownerId: "wrong-owner",
    }),
    false,
  );
  assert.equal(
    releaseVideoDateEntryOwner({
      sessionId,
      userId,
      ownerId: first.owner.ownerId,
    }),
    true,
  );
  assert.equal(getVideoDateEntryOwner(sessionId, userId), null);
});

test("Daily owner subscribers observe joined and lost states", () => {
  const sessionId = `session-${Date.now()}-${Math.random()}`;
  const userId = `user-${Date.now()}-${Math.random()}`;
  const seen: Array<string | null> = [];
  const unsubscribe = subscribeVideoDateDailyOwner((owner) => {
    seen.push(owner?.state ?? null);
  });
  updateVideoDateDailyOwnerState({
    sessionId,
    userId,
    roomName: "room_b",
    state: "joined",
    ownerId: "owner-b",
  });
  updateVideoDateDailyOwnerState({
    sessionId,
    userId,
    roomName: "room_b",
    state: "lost",
    ownerId: "owner-b",
  });
  unsubscribe();

  assert.deepEqual(seen, ["joined", "lost"]);
  assert.equal(
    getVideoDateDailyOwner({ sessionId, userId, roomName: "room_b" })?.state,
    "lost",
  );
});

test("web and native prepare wrappers claim the shared owner and neutralize duplicate force retries", () => {
  for (const [name, source] of [
    ["web", webPrepare],
    ["native", nativePrepare],
  ] as const) {
    assert.match(source, /videoDateEntryOwnerV2Enabled/);
    assert.match(source, /claimVideoDateEntryOwner\(/);
    assert.match(source, /getCachedPreparedVideoDateEntry\(sessionId, userId\)/);
    assert.match(source, /effectiveForce = false/);
    assert.match(source, /updateVideoDateEntryOwnerState\(/);
    assert.match(
      source,
      /state:\s*['"]prepared['"][\s\S]{0,220}roomName:\s*result\.data\.room_name/,
      `${name} prepare should publish the prepared owner state`,
    );
  }
});

test("Ready Gate and ready-route handoffs mark a shared navigating owner", () => {
  for (const [name, source] of [
    ["web ReadyGate", webReadyGate],
    ["native ReadyGate", nativeReadyGate],
    ["native ready route", nativeReadyRoute],
  ] as const) {
    assert.match(
      source,
      /updateVideoDateEntryOwnerState\([\s\S]{0,260}state:\s*['"]navigating['"]/,
      `${name} should mark the owner navigating before date transfer`,
    );
  }
});

test("web and native date routes keep owner-alive heartbeats after Daily join", () => {
  for (const [name, source, heartbeatConst] of [
    ["web date", webDate, "VIDEO_DATE_DAILY_ALIVE_HEARTBEAT_MS"],
    [
      "native date",
      nativeDate,
      "NATIVE_VIDEO_DATE_DAILY_ALIVE_HEARTBEAT_MS",
    ],
  ] as const) {
    assert.match(source, new RegExp(heartbeatConst));
    assert.match(source, /mark_video_date_daily_alive/);
    assert.match(source, /startDailyAliveHeartbeat\(/);
    assert.match(source, /state:\s*["']joining["']/);
    assert.match(source, /state:\s*dailyOwnerState/);
    assert.match(source, /state:\s*["']remote_seen["']/);
    assert.match(source, /daily_owner_provider_left_unexpected/);
  }
});

test("web parked Daily singleton cleanup preserves the active alive heartbeat", () => {
  const cleanupStart = webDate.indexOf("const shouldParkLiveSingleton =");
  assert.notEqual(cleanupStart, -1, "web cleanup block should exist");
  const clearHeartbeatIndex = webDate.indexOf(
    'clearDailyAliveHeartbeatTimer(`daily_call_cleanup:${reason}`)',
    cleanupStart,
  );
  const clearHeartbeatGuardIndex = webDate.lastIndexOf(
    "if (!parkedSingleton) {",
    clearHeartbeatIndex,
  );
  const preserveContinuityIndex = webDate.indexOf(
    "if (!parkedSingleton) {\n          activeCallSessionIdRef.current = null;",
    cleanupStart,
  );
  assert.ok(clearHeartbeatIndex > cleanupStart, "cleanup should clear the alive heartbeat");
  assert.ok(
    clearHeartbeatGuardIndex > cleanupStart,
    "heartbeat cleanup should be guarded by non-parked cleanup",
  );
  assert.ok(
    preserveContinuityIndex > clearHeartbeatIndex,
    "destructive heartbeat cleanup should still precede destructive continuity clearing",
  );
  assert.match(webDate, /daily_call_live_remount_heartbeat_preserved/);
  assert.match(webDate, /daily_call_live_remount_identity_preserved/);
});

test("web and native date routes only report joined owner state with current provider proof", () => {
  assert.match(webDate, /function safeMeetingState/);
  assert.match(webDate, /function readDailyProviderSessionId/);
  assert.match(webDate, /const providerSessionId = readDailyProviderSessionId\(call\)/);
  assert.match(webDate, /const meetingState = safeMeetingState\(call\)/);
  assert.match(
    webDate,
    /const providerBackedJoined =[\s\S]{0,90}meetingState === "joined-meeting" && Boolean\(providerSessionId\)/,
  );
  assert.match(
    webDate,
    /const dailyOwnerState =[\s\S]{0,90}providerBackedJoined[\s\S]{0,90}\? "joined"[\s\S]{0,120}: meetingState === "left-meeting" \|\| meetingState === "error"[\s\S]{0,90}\? "lost"[\s\S]{0,90}: "joining"/,
  );
  assert.match(webDate, /p_provider_session_id: providerSessionId/);
  assert.match(webDate, /p_owner_state: dailyOwnerState/);
  assert.match(webDate, /state: providerBackedJoined \? "joined" : "joining"/);

  assert.match(nativeDate, /function safeNativeDailyMeetingState/);
  assert.match(nativeDate, /function readNativeDailyProviderSessionId/);
  assert.match(
    nativeDate,
    /const providerSessionId = readNativeDailyProviderSessionId\(call\)/,
  );
  assert.match(nativeDate, /const meetingState = safeNativeDailyMeetingState\(call\)/);
  assert.match(
    nativeDate,
    /const providerBackedJoined =[\s\S]{0,90}meetingState === "joined-meeting" && Boolean\(providerSessionId\)/,
  );
  assert.match(
    nativeDate,
    /const dailyOwnerState =[\s\S]{0,90}providerBackedJoined[\s\S]{0,90}\? "joined"[\s\S]{0,120}: meetingState === "left-meeting" \|\| meetingState === "error"[\s\S]{0,90}\? "lost"[\s\S]{0,90}: "joining"/,
  );
  assert.match(nativeDate, /p_provider_session_id: providerSessionId/);
  assert.match(nativeDate, /p_owner_state: dailyOwnerState/);
  assert.match(nativeDate, /state: providerBackedJoined \? ['"]joined['"] : ['"]joining['"]/);
});

test("lobbies recover terminal in_survey registrations even after current_room_id is cleared", () => {
  assert.match(
    webLobby,
    /queueStatus === "in_survey" && currentRoomId[\s\S]{0,760}forceSurvey: true/s,
  );
  assert.match(
    webLobby,
    /queueStatus === "in_survey"[\s\S]{0,220}pending survey detected without current room from registration realtime/,
  );
  assert.doesNotMatch(webLobby, /setCheckingNextDateAfterSurvey/);
  assert.match(webLobby, /setPostSurveyReturnContext\(true\)/);
  assert.match(webLobby, /clearReadyGateSession\("registration_realtime_pending_survey"\)/);
  assert.match(webLobby, /void refetchScopedSession\(\)/);

  assert.match(
    nativeLobby,
    /queueStatus === "in_survey" && currentRoomId[\s\S]{0,560}forceSurvey: true/s,
  );
  assert.match(nativeLobby, /native_lobby_pending_survey_without_room_realtime/);
  assert.match(nativeLobby, /native_lobby_pending_survey_without_room_refetch/);
  assert.match(nativeLobby, /setPostSurveyReturnContext\(true\)/);
  assert.match(nativeLobby, /setPostSurveyBridgeVisible\(true\)/);
  assert.match(nativeLobby, /setActiveSessionId\(null\)/);
  assert.match(nativeLobby, /void refetchActiveSession\(\)/);
  assert.match(
    nativeLobby,
    /scheduleLobbyRefreshBurst\("registration_realtime_pending_survey"\)/,
  );
  assert.match(
    nativeLobby,
    /scheduleLobbyRefreshBurst\([\s\S]{0,60}"registration_realtime_refetch_pending_survey"/,
  );
});

test("stable copresence migration blocks handshake promotion from stale joined state", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.video_date_presence_events/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.video_date_stable_copresence_v1/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.mark_video_date_daily_alive/);
  assert.match(migration, /owner_heartbeat/);
  assert.match(migration, /client_daily_alive/);
  assert.match(migration, /missing_owner_heartbeat_after_latest_join/);
  assert.match(migration, /owner_heartbeat_stale/);
  assert.match(migration, /owner_heartbeat_stabilizing/);
  assert.match(migration, /min\(vpe\.occurred_at\), max\(vpe\.occurred_at\)/);
  assert.match(migration, /stable_copresence_since_at/);
  assert.match(migration, /v_copresence_since_at <= v_now - interval '2 seconds'/);
  assert.doesNotMatch(
    migration,
    /v_latest_heartbeat_at <= v_now - interval '2 seconds'/,
  );
  assert.match(migration, /remote_seen/);
  assert.match(migration, /handshake_started_after_stable_copresence/);
  assert.match(migration, /handshake_started_after_stable_daily_alive/);
  assert.doesNotMatch(
    migration,
    /handshake_started_after_active_daily_copresence/,
  );
  assert.match(
    migration,
    /AND v_stable_copresence THEN[\s\S]{0,220}handshake_started_at = v_now/,
  );
});

test("provider-authoritative presence migration blocks stale client heartbeats after Daily left", () => {
  assert.match(
    providerAuthoritativeMigration,
    /CREATE OR REPLACE FUNCTION public\.video_date_actor_provider_presence_v1/,
  );
  assert.match(
    providerAuthoritativeMigration,
    /public\.video_date_daily_webhook_events[\s\S]{0,180}event_type IN \('participant\.joined', 'participant\.left'\)/,
  );
  assert.match(
    providerAuthoritativeMigration,
    /v_latest_client_provider_session_id IS NOT NULL[\s\S]{0,420}event_type = 'participant\.left'[\s\S]{0,220}v_latest_client_provider_session_id/s,
  );
  assert.match(providerAuthoritativeMigration, /v_left_after_client_alive/);
  assert.match(providerAuthoritativeMigration, /provider_left_after_client_alive/);
  assert.match(
    providerAuthoritativeMigration,
    /v_latest_provider_event_type = 'participant\.left'[\s\S]{0,180}v_latest_provider_session_id IS NOT NULL[\s\S]{0,180}v_latest_provider_session_id IS DISTINCT FROM[\s\S]{0,80}v_latest_client_provider_session_id/s,
  );
  assert.match(
    providerAuthoritativeMigration,
    /v_client_provider_active :=[\s\S]{0,240}v_latest_client_provider_session_id IS NOT NULL[\s\S]{0,240}v_latest_client_owner_state = 'joined'[\s\S]{0,240}NOT v_left_after_client_alive/s,
  );
  assert.match(providerAuthoritativeMigration, /provider_presence_required', true/);
  assert.match(providerAuthoritativeMigration, /already_date_provider_missing/);
  assert.match(providerAuthoritativeMigration, /already_date_provider_current/);
  assert.match(providerAuthoritativeMigration, /remote_seen_provider_current/);
  assert.match(providerAuthoritativeMigration, /stable_provider_owner_heartbeat/);
  assert.match(
    providerAuthoritativeMigration,
    /v_remote_seen :=[\s\S]{0,120}v_participant_1_active[\s\S]{0,80}AND v_participant_2_active/s,
  );
  assert.doesNotMatch(
    providerAuthoritativeMigration,
    /IF v_row\.date_started_at IS NOT NULL[\s\S]{0,180}stable_copresence', true/,
  );
});

test("provider presence reads Daily webhook provider participant id before payload fallbacks", () => {
  assert.match(
    providerParticipantIdRepairMigration,
    /CREATE OR REPLACE FUNCTION public\.video_date_daily_provider_session_id_from_event_v1/,
  );
  assert.match(providerParticipantIdRepairMigration, /p_provider_participant_id/);
  assert.match(providerParticipantIdRepairMigration, /vde\.provider_participant_id/);
  assert.match(providerParticipantIdRepairMigration, /participantId/);
  assert.match(providerParticipantIdRepairMigration, /participant_id/);
  assert.match(
    providerParticipantIdRepairMigration,
    /CREATE OR REPLACE FUNCTION public\.video_date_actor_provider_presence_v1/,
  );
  assert.match(
    providerParticipantIdRepairMigration,
    /public\.video_date_daily_provider_session_id_from_event_v1\([\s\S]{0,80}vde\.provider_participant_id[\s\S]{0,80}vde\.payload/s,
  );
  assert.match(
    providerParticipantIdRepairMigration,
    /CREATE OR REPLACE FUNCTION public\.mark_video_date_daily_alive/,
  );
  assert.doesNotMatch(
    providerParticipantIdRepairMigration,
    /NULLIF\(vde\.payload->'payload'->>'session_id', ''\)/,
  );
});

test("daily alive RPC records but does not join-stamp without current provider-backed state", () => {
  assert.match(
    providerAuthoritativeMigration,
    /CREATE OR REPLACE FUNCTION public\.mark_video_date_daily_alive/,
  );
  assert.match(providerAuthoritativeMigration, /v_provider_session_id text := NULLIF/);
  assert.match(providerAuthoritativeMigration, /v_owner_state text := COALESCE/);
  assert.match(
    providerAuthoritativeMigration,
    /v_provider_backed_current :=[\s\S]{0,100}v_owner_state = 'joined'[\s\S]{0,100}v_provider_session_id IS NOT NULL[\s\S]{0,260}v_latest_provider_event_type = 'participant\.joined'[\s\S]{0,120}v_latest_provider_session_id = v_provider_session_id/s,
  );
  assert.match(
    providerAuthoritativeMigration,
    /v_latest_provider_event_type = 'participant\.left'[\s\S]{0,120}v_latest_provider_session_id IS NOT NULL[\s\S]{0,120}v_latest_provider_session_id IS DISTINCT FROM v_provider_session_id/s,
  );
  assert.match(
    providerAuthoritativeMigration,
    /IF v_provider_backed_current THEN[\s\S]{0,520}participant_1_away_at = NULL[\s\S]{0,520}participant_2_away_at = NULL/s,
  );
  assert.match(
    providerAuthoritativeMigration,
    /IF NOT v_provider_backed_current THEN[\s\S]{0,320}'daily_alive_without_current_provider_presence'/s,
  );
  assert.match(providerAuthoritativeMigration, /'provider_backed_current', v_provider_backed_current/);
  assert.match(providerAuthoritativeMigration, /'join_stamp_accepted', v_join_stamp_accepted/);
  assert.match(providerAuthoritativeMigration, /'provider_presence', v_provider_presence/);
  assert.match(providerAuthoritativeMigration, /GRANT EXECUTE ON FUNCTION public\.mark_video_date_daily_alive/);
});
