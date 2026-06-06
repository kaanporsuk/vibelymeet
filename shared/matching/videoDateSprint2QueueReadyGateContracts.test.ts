import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const sprint2Migration = read(
  "supabase/migrations/20260525213000_video_date_sprint2_queue_hint_drain_alignment.sql",
);
const webUseMatchQueue = read("src/hooks/useMatchQueue.ts");
const webEventLobby = read("src/pages/EventLobby.tsx");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const nativeEventsApi = read("apps/mobile/lib/eventsApi.ts");
const webPostDateSurvey = read("src/components/video-date/PostDateSurvey.tsx");
const nativePostDateSurvey = read("apps/mobile/components/video-date/PostDateSurvey.tsx");
const webUseReadyGate = read("src/hooks/useReadyGate.ts");
const nativeReadyGateApi = read("apps/mobile/lib/readyGateApi.ts");
const webReadyGateOverlay = read("src/components/lobby/ReadyGateOverlay.tsx");
const nativeReadyGateOverlay = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
const eventEndedReadyGateMigration = read(
  "supabase/migrations/20260501200000_ready_gate_event_ended_terminalization.sql",
);
const packageJson = read("package.json");

test("Sprint 2 queue hint uses the same base eligibility as queue drain", () => {
  assert.match(sprint2Migration, /CREATE OR REPLACE FUNCTION public\.get_video_date_queue_hint_v1/);
  assert.match(sprint2Migration, /public\.get_event_lobby_active_state\(p_event_id, now\(\)\)/);
  assert.match(sprint2Migration, /WITH eligible_queue AS/);
  assert.match(sprint2Migration, /er\.admission_status = 'confirmed'/);
  assert.match(sprint2Migration, /public\.video_date_pair_has_terminal_encounter/);
  assert.match(sprint2Migration, /public\.is_blocked\(vs\.participant_1_id, vs\.participant_2_id\)/);
  assert.match(sprint2Migration, /FROM public\.user_reports ur/);
  assert.match(sprint2Migration, /public\.event_lobby_video_session_blocks_new_match/);
  assert.match(sprint2Migration, /COALESCE\(vs\.queued_expires_at/);
  assert.match(sprint2Migration, /FROM eligible_queue eq/);
  assert.match(sprint2Migration, /FROM user_queue uq/);
  assert.match(sprint2Migration, /JOIN eligible_queue eq\s+ON eq\.id = c\.session_id/s);
  assert.match(sprint2Migration, /public\.v_video_date_queue_fairness_candidates/);
});

test("Sprint 2 legacy queue drain delegates to v2 semantics", () => {
  assert.match(sprint2Migration, /CREATE OR REPLACE FUNCTION public\.drain_match_queue\(\s*p_event_id uuid\s*\)/s);
  assert.match(sprint2Migration, /'legacy:' \|\|/);
  assert.match(sprint2Migration, /RETURN public\.drain_match_queue_v2\(p_event_id, v_key\)/);
  assert.match(sprint2Migration, /'legacy_wrapper', true/);
  assert.match(sprint2Migration, /REVOKE ALL ON FUNCTION public\.drain_match_queue\(uuid\) FROM PUBLIC, anon/);
  assert.match(sprint2Migration, /GRANT EXECUTE ON FUNCTION public\.drain_match_queue\(uuid\)\s+TO authenticated, service_role/s);
  assert.match(sprint2Migration, /queue eligibility, locking, TTL, safety, active-session, and Ready Gate promotion semantics/);
});

test("Sprint 2 web queue recovery cannot leave a user silently queued", () => {
  assert.match(webUseMatchQueue, /QUEUED_SESSION_RECOVERY_FIRST_DRAIN_MS = 1_200/);
  assert.match(webUseMatchQueue, /QUEUED_SESSION_RECOVERY_DRAIN_MS = 5_000/);
  assert.match(webUseMatchQueue, /drainInFlightRef/);
  assert.match(webUseMatchQueue, /activeDrainSeqRef/);
  assert.match(webUseMatchQueue, /activeRefreshSeqRef/);
  assert.match(webUseMatchQueue, /scopeRef/);
  assert.match(webUseMatchQueue, /const isCurrentScope = useCallback/);
  assert.match(webUseMatchQueue, /!isCurrentScope\(requestEventId, requestUserId\)/);
  assert.match(webUseMatchQueue, /const drainQueueOnce = useCallback/);
  assert.match(webUseMatchQueue, /sourceAction,/);
  assert.match(webUseMatchQueue, /queued_recovery_poll/);
  assert.match(webUseMatchQueue, /setInterval\(\(\) =>\s*{\s*void drainQueueOnce\("queued_recovery_poll"\)/s);
  assert.match(webUseMatchQueue, /void refreshQueueCount\(\)/);
  assert.match(webUseMatchQueue, /minimumOnFailure = 0/);
  assert.match(webUseMatchQueue, /shouldRetainQueueCountOnHintFailure/);
  assert.match(webUseMatchQueue, /RETRYABLE_QUEUE_HINT_FAILURE_REASONS/);
  assert.match(webUseMatchQueue, /code === "not_registered"/);
  assert.match(webUseMatchQueue, /code === "missing_args"/);
  assert.match(webUseMatchQueue, /code === "42501"/);
  assert.match(webUseMatchQueue, /code === "22P02"/);
  assert.match(webUseMatchQueue, /setQueuedCount\(0\)/);
  assert.match(webUseMatchQueue, /isVideoDateReadyGateActiveStatus\(session\.ready_gate_status\)/);
  assert.doesNotMatch(
    webUseMatchQueue,
    /session\.ready_gate_status === "ready" && payload\.old\?\.ready_gate_status === "queued"/,
  );
});

test("Sprint 2 web lobby starts convergence immediately after queued swipe and queue promotion", () => {
  assert.match(webEventLobby, /onVideoSessionReady: \(videoSessionId\) => \{\s*openReadyGateSession\(videoSessionId, "match_queue"\)/s);
  assert.match(webEventLobby, /scheduleLobbyConvergenceRefresh\(videoSessionId, "match_queue"\)/);
  assert.match(webEventLobby, /onVideoSessionQueued: \(videoSessionId\) => \{/);
  assert.match(webEventLobby, /void refreshQueueCount\(1\)/);
  assert.match(webEventLobby, /scheduleLobbyConvergenceRefresh\(videoSessionId, "swipe_queued"\)/);
});

test("Sprint 2 native lobby and queue count stay on the shared hint and drain path", () => {
  assert.match(nativeLobby, /fetchVideoDateQueueHint/);
  assert.match(nativeLobby, /getQueuedMatchCount\(requestEventId, requestUserId\)/);
  assert.match(nativeLobby, /sourceAction: ['"]queue_drain_interval['"]/);
  assert.match(nativeLobby, /openReadyGateWithSession\(promotedSessionId, ['"]queue_drain_interval['"]\)/);
  assert.match(nativeLobby, /sourceAction: ['"]video_session_insert_queue_drain['"]/);
  assert.match(nativeLobby, /scheduleLobbyRefreshBurst\(['"]video_session_insert_queue_drain['"]\)/);
  assert.match(nativeLobby, /queueRefreshSeqRef/);
  assert.match(nativeLobby, /queueRefreshScopeRef/);
  assert.match(nativeLobby, /!isActiveLobbyContextRef\.current/);
  assert.match(nativeEventsApi, /export async function getQueuedMatchCount/);
  assert.match(nativeEventsApi, /const hint = await fetchVideoDateQueueHint\(eventId, userId\)/);
  assert.match(nativeEventsApi, /hint\.ok \? hint\.userQueuedCount : 0/);
});

test("Sprint 2 post-date survey queue drain uses the same eligibility surface on web and native", () => {
  assert.match(webPostDateSurvey, /useMatchQueue/);
  assert.match(webPostDateSurvey, /enableSurveyPhaseDrain: true/);
  assert.match(webPostDateSurvey, /sourceSurface: "post_date_survey"/);
  assert.match(nativePostDateSurvey, /getQueuedMatchCount\(eventId, userId\)/);
  assert.match(nativePostDateSurvey, /drainMatchQueueV2: drainQueueV2\.enabled/);
  assert.match(nativePostDateSurvey, /sourceSurface: ['"]post_date_survey['"]/);
});

test("Sprint 2 Ready Gate actions keep server truth authoritative across web and native", () => {
  assert.match(webUseReadyGate, /video_session_mark_ready_v2/);
  assert.match(webUseReadyGate, /video_session_forfeit_v2/);
  assert.match(webUseReadyGate, /ready_gate_transition/);
  assert.match(webUseReadyGate, /both_ready_observed_via_rpc_short_circuit/);
  assert.match(webUseReadyGate, /ReadyGateTransitionAction = "mark_ready" \| "forfeit" \| "snooze" \| "sync"/);
  assert.match(nativeReadyGateApi, /video_session_mark_ready_v2/);
  assert.match(nativeReadyGateApi, /video_session_forfeit_v2/);
  assert.match(nativeReadyGateApi, /ready_gate_transition/);
  assert.match(nativeReadyGateApi, /both_ready_observed_via_rpc_short_circuit/);
  assert.match(nativeReadyGateApi, /ReadyGateTransitionAction = 'mark_ready' \| 'forfeit' \| 'snooze' \| 'sync'/);
  assert.match(webReadyGateOverlay, /reconcileSession\("poll"\)/);
  assert.match(nativeReadyGateOverlay, /READY_GATE_TRUTH_RECONCILE_MS = 10_000/);
  assert.match(eventEndedReadyGateMigration, /ready_gate_transition_20260501200000_event_inactive_base/);
  assert.match(eventEndedReadyGateMigration, /READY_GATE_EVENT_ENDED/);
});

test("Sprint 2 queue and Ready Gate contracts are included in the v4 verification script", () => {
  assert.match(packageJson, /shared\/matching\/videoDateSprint2QueueReadyGateContracts\.test\.ts/);
});
