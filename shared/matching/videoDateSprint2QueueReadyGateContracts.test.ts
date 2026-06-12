import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

const sprint2Migration = read(
  "supabase/migrations/20260525213000_video_date_sprint2_queue_hint_drain_alignment.sql",
);
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

test("Sprint 2 historical queue hint used the same base eligibility as queue drain", () => {
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

test("Sprint 2 historical legacy queue drain delegates to v2 semantics", () => {
  assert.match(sprint2Migration, /CREATE OR REPLACE FUNCTION public\.drain_match_queue\(\s*p_event_id uuid\s*\)/s);
  assert.match(sprint2Migration, /'legacy:' \|\|/);
  assert.match(sprint2Migration, /RETURN public\.drain_match_queue_v2\(p_event_id, v_key\)/);
  assert.match(sprint2Migration, /'legacy_wrapper', true/);
  assert.match(sprint2Migration, /REVOKE ALL ON FUNCTION public\.drain_match_queue\(uuid\) FROM PUBLIC, anon/);
  assert.match(sprint2Migration, /GRANT EXECUTE ON FUNCTION public\.drain_match_queue\(uuid\)\s+TO authenticated, service_role/s);
  assert.match(sprint2Migration, /queue eligibility, locking, TTL, safety, active-session, and Ready Gate promotion semantics/);
});

test("Sprint 2 web queue recovery is removed from current source", () => {
  assert.equal(existsSync(join(root, "src/hooks/useMatchQueue.ts")), false);
  assert.doesNotMatch(webEventLobby, /queued_recovery_poll|refreshQueueCount|drainQueueOnce|useMatchQueue/);
});

test("Sprint 2 web lobby opens only direct mutual match sessions", () => {
  assert.match(webEventLobby, /onVideoSessionReady: \(videoSessionId\) => \{/);
  assert.doesNotMatch(webEventLobby, /onVideoSessionQueued|swipe_queued|refreshQueueCount|match_queue/);
});

test("Sprint 2 native lobby and events API no longer expose queue count or drain paths", () => {
  assert.doesNotMatch(nativeLobby, /fetchVideoDateQueueHint|getQueuedMatchCount|queue_drain_interval|video_session_insert_queue_drain|queueRefreshSeqRef/);
  assert.doesNotMatch(nativeEventsApi, /export async function getQueuedMatchCount|fetchVideoDateQueueHint|drainMatchQueue/);
});

test("Sprint 2 post-date survey queue drain is removed on web and native", () => {
  assert.doesNotMatch(webPostDateSurvey, /useMatchQueue|enableSurveyPhaseDrain|drain_match_queue|onQueuedVideoSessionReady|onVideoDateReady/);
  assert.doesNotMatch(nativePostDateSurvey, /getQueuedMatchCount|drainMatchQueueV2|drain_match_queue|onQueuedVideoSessionReady|onVideoDateReady/);
});

test("Sprint 2 Ready Gate actions keep server truth authoritative across web and native", () => {
  assert.match(webUseReadyGate, /video_session_mark_ready_v2/);
  assert.doesNotMatch(webUseReadyGate, /video_session_forfeit_v2/);
  assert.match(webUseReadyGate, /ready_gate_transition/);
  assert.match(webUseReadyGate, /both_ready_observed_via_rpc_short_circuit/);
  assert.match(webUseReadyGate, /ReadyGateTransitionAction = "mark_ready" \| "forfeit" \| "snooze" \| "sync"/);
  assert.match(nativeReadyGateApi, /video_session_mark_ready_v2/);
  assert.doesNotMatch(nativeReadyGateApi, /video_session_forfeit_v2/);
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
