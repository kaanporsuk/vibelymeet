import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const historicalDrainGuardMigration = read(
  "supabase/migrations/20260608211359_video_date_survey_feedback_drain_guard.sql",
);
const autoNextRemovalMigration = read(
  "supabase/migrations/20260610000100_remove_post_date_instant_next.sql",
);
const videoSessionFlow = read("supabase/functions/_shared/matching/videoSessionFlow.ts");
const webSurvey = read("src/components/video-date/PostDateSurvey.tsx");
const webLobby = read("src/pages/EventLobby.tsx");
const nativeSurvey = read("apps/mobile/components/video-date/PostDateSurvey.tsx");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const nativeNotificationHandler = read("apps/mobile/components/NotificationDeepLinkHandler.tsx");
const packageJson = read("package.json");

test("historical date_feedback write ownership remains intact", () => {
  assert.match(historicalDrainGuardMigration, /ALTER TABLE public\.date_feedback ENABLE ROW LEVEL SECURITY/);
  assert.match(
    historicalDrainGuardMigration,
    /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE public\.date_feedback\s+FROM authenticated/,
  );
  assert.match(historicalDrainGuardMigration, /GRANT SELECT ON TABLE public\.date_feedback TO authenticated/);
  assert.match(historicalDrainGuardMigration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.date_feedback TO service_role/);
  assert.match(historicalDrainGuardMigration, /mandatory verdict writes are backend-owned through submit_post_date_verdict_v3/);
});

test("post-date auto-next removal drops the pending-feedback drain gate and drain RPCs", () => {
  assert.match(autoNextRemovalMigration, /DROP FUNCTION IF EXISTS public\.video_date_actor_pending_feedback_gate_v1\(uuid, uuid\)/);
  assert.match(autoNextRemovalMigration, /DROP FUNCTION IF EXISTS public\.drain_match_queue\(uuid\)/);
  assert.match(autoNextRemovalMigration, /DROP FUNCTION IF EXISTS public\.drain_match_queue_v2\(uuid, text\)/);
  assert.match(autoNextRemovalMigration, /DROP FUNCTION IF EXISTS public\.get_video_date_queue_hint_v1\(uuid, uuid\)/);
});

test("shared drain payload helpers are gone with the drain surface", () => {
  assert.doesNotMatch(videoSessionFlow, /DrainMatchQueueResult/);
  assert.doesNotMatch(videoSessionFlow, /isPendingPostDateFeedbackDrainResult/);
  assert.doesNotMatch(videoSessionFlow, /pendingPostDateFeedbackSessionIdFromDrainPayload/);
  assert.doesNotMatch(videoSessionFlow, /pending_post_date_feedback/);
});

test("web and native clients no longer route pending feedback through queue drain", () => {
  for (const [name, source] of [
    ["web survey", webSurvey],
    ["web lobby", webLobby],
    ["native survey", nativeSurvey],
    ["native lobby", nativeLobby],
    ["native notifications", nativeNotificationHandler],
  ] as const) {
    assert.doesNotMatch(source, /pendingPostDateFeedback|pending_post_date_feedback/, name);
    assert.doesNotMatch(source, /drainMatchQueue|drain_match_queue|getQueuedMatchCount|fetchVideoDateQueueHint/, name);
    assert.doesNotMatch(source, /queue_drain_initial|video_session_insert_queue_drain|queued_session_rescue/, name);
  }
});

test("survey feedback drain guard replacement stays wired into Video Date suites", () => {
  assert.match(packageJson, /videoDateSurveyFeedbackDrainGuard\.test\.ts/);
});
