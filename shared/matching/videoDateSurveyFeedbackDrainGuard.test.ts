import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260608211359_video_date_survey_feedback_drain_guard.sql",
);
const lintRepairMigration = read(
  "supabase/migrations/20260608214714_video_date_survey_feedback_gate_lint_repair.sql",
);
const videoSessionFlow = read("supabase/functions/_shared/matching/videoSessionFlow.ts");
const webMatchQueue = read("src/hooks/useMatchQueue.ts");
const webSurvey = read("src/components/video-date/PostDateSurvey.tsx");
const webLobby = read("src/pages/EventLobby.tsx");
const nativeSurvey = read("apps/mobile/components/video-date/PostDateSurvey.tsx");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const nativeNotificationHandler = read("apps/mobile/components/NotificationDeepLinkHandler.tsx");
const reasonCopy = read("shared/matching/matchQueueDrainReasonCopy.ts");
const packageJson = read("package.json");

function functionBody(source: string, name: string): string {
  const start = source.search(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\s*\\(`),
  );
  assert.notEqual(start, -1, `missing function ${name}`);
  const end = source.indexOf("$function$;", start);
  assert.notEqual(end, -1, `missing function terminator for ${name}`);
  return source.slice(start, end);
}

test("queue drain wraps both public RPC names with an actor date_feedback gate", () => {
  assert.match(
    migration,
    /RENAME TO drain_match_queue_v2_20260608211359_survey_feedback_base/,
  );
  assert.match(
    migration,
    /RENAME TO drain_match_queue_20260608211359_survey_feedback_base/,
  );
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.video_date_actor_pending_feedback_gate_v1/);
  assert.match(migration, /public\.video_date_session_is_post_date_survey_eligible_v2/);
  assert.match(migration, /FROM public\.date_feedback df[\s\S]+df\.session_id = vs\.id[\s\S]+df\.user_id = v_actor/);
  assert.match(migration, /NOT public\.is_blocked\(v_actor, partner\.partner_id\)/);
  assert.match(migration, /NOT public\.is_blocked\(partner\.partner_id, v_actor\)/);
  assert.match(migration, /FROM public\.user_reports ur/);
  assert.match(migration, /'found', false[\s\S]+'queued', false[\s\S]+'blocked', true/);
  assert.match(migration, /'reason', 'pending_post_date_feedback'/);
  assert.match(migration, /'code', 'PENDING_POST_DATE_FEEDBACK'/);
  assert.match(migration, /'next_surface', jsonb_build_object\(/);
});

test("guarded drain RPCs return pending feedback before any Ready Gate promotion delegate", () => {
  const drainV2 = functionBody(migration, "drain_match_queue_v2");
  assert.ok(
    drainV2.indexOf("video_date_actor_pending_feedback_gate_v1") <
      drainV2.indexOf("drain_match_queue_v2_20260608211359_survey_feedback_base"),
    "v2 drain must check pending feedback before delegating to promotion base",
  );
  assert.match(drainV2, /record_event_loop_observability\([\s\S]+'drain_match_queue_v2'[\s\S]+'blocked'[\s\S]+'pending_post_date_feedback'/);
  assert.match(drainV2, /'commandStatus', 'rejected'/);
  assert.match(drainV2, /'drain_blocked', true/);

  const legacyDrain = functionBody(migration, "drain_match_queue");
  assert.ok(
    legacyDrain.indexOf("video_date_actor_pending_feedback_gate_v1") <
      legacyDrain.indexOf("drain_match_queue_v2_20260608211359_survey_feedback_base"),
    "legacy drain must check pending feedback before delegating to the v2 base",
  );
  assert.match(legacyDrain, /record_event_loop_observability\([\s\S]+'drain_match_queue'[\s\S]+'blocked'[\s\S]+'pending_post_date_feedback'/);
  assert.match(legacyDrain, /'legacy_wrapper', true/);
});

test("pending feedback helper orders by real video_sessions columns after lint repair", () => {
  assert.match(lintRepairMigration, /CREATE OR REPLACE FUNCTION public\.video_date_actor_pending_feedback_gate_v1/);
  assert.match(
    lintRepairMigration,
    /COALESCE\(vs\.ended_at,\s*vs\.state_updated_at,\s*vs\.started_at\) DESC/,
  );
  assert.doesNotMatch(lintRepairMigration, /vs\.created_at/);
});

test("date_feedback direct authenticated writes are closed while backend RPC ownership remains", () => {
  assert.match(migration, /ALTER TABLE public\.date_feedback ENABLE ROW LEVEL SECURITY/);
  assert.match(
    migration,
    /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE public\.date_feedback\s+FROM authenticated/,
  );
  assert.match(migration, /GRANT SELECT ON TABLE public\.date_feedback TO authenticated/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.date_feedback TO service_role/);
  assert.match(migration, /DROP POLICY IF EXISTS "Users can create own feedback"/);
  assert.match(migration, /DROP POLICY IF EXISTS "Users can update own feedback"/);
  assert.doesNotMatch(
    migration,
    /GRANT SELECT, INSERT, UPDATE ON TABLE public\.date_feedback TO authenticated/,
  );
  assert.match(migration, /mandatory verdict writes are backend-owned through submit_post_date_verdict_v3/);
  assert.match(migration, /optional patches through update_post_date_feedback_details/);
});

test("shared drain payload helpers classify pending post-date feedback", () => {
  assert.match(videoSessionFlow, /session_id\?: string/);
  assert.match(videoSessionFlow, /next_surface\?: \{/);
  assert.match(videoSessionFlow, /export function isPendingPostDateFeedbackDrainResult/);
  assert.match(videoSessionFlow, /payload\.reason === "pending_post_date_feedback"/);
  assert.match(videoSessionFlow, /payload\.code === "PENDING_POST_DATE_FEEDBACK"/);
  assert.match(videoSessionFlow, /payload\.next_surface\?\.reason === "pending_post_date_feedback"/);
  assert.match(videoSessionFlow, /export function pendingPostDateFeedbackSessionIdFromDrainPayload/);
  assert.match(videoSessionFlow, /payload\?\.next_surface\?\.session_id/);
  assert.match(videoSessionFlow, /payload\.video_session_id \?\? payload\.session_id \?\? payload\.match_id/);

  assert.match(reasonCopy, /pending_post_date_feedback/);
  assert.match(reasonCopy, /Finish your post-date feedback before the next Ready Gate opens\./);
});

test("web drains route pending feedback to survey before Ready Gate callbacks", () => {
  assert.match(webMatchQueue, /onPendingPostDateFeedback\?: \(videoSessionId: string\) => void/);
  assert.match(webMatchQueue, /isPendingPostDateFeedbackDrainResult\(result\)/);
  assert.ok(
    webMatchQueue.indexOf("isPendingPostDateFeedbackDrainResult(result)") <
      webMatchQueue.indexOf("result?.found && sessionId && result.partner_id"),
    "web hook must handle pending feedback before found Ready Gate handling",
  );
  assert.match(webMatchQueue, /notifyPendingPostDateFeedbackOnce\(pendingSessionId\)/);
  assert.match(webSurvey, /onPendingPostDateFeedback: handlePendingPostDateFeedback/);
  assert.match(webSurvey, /setStep\("verdict"\)/);
  assert.match(webSurvey, /const target = `\/date\/\$\{encodeURIComponent\(pendingSessionId\)\}`/);
  assert.match(webLobby, /onPendingPostDateFeedback: handlePendingPostDateFeedbackDrain/);
  assert.match(webLobby, /"match_queue_pending_post_date_feedback"/);
  assert.match(webLobby, /forceSurvey: true/);
});

test("native drains route pending feedback to survey before Ready Gate callbacks", () => {
  assert.match(nativeSurvey, /isPendingPostDateFeedbackDrainResult\(result \?\? undefined\)/);
  assert.ok(
    nativeSurvey.indexOf("isPendingPostDateFeedbackDrainResult(result ?? undefined)") <
      nativeSurvey.indexOf("result?.found && nextSessionId"),
    "native survey must handle pending feedback before found Ready Gate handling",
  );
  assert.match(nativeSurvey, /onVideoDateReady\(pendingSessionId\)/);
  assert.doesNotMatch(nativeSurvey, /onQueuedVideoSessionReady\?\.\(pendingSessionId\)/);
  assert.match(nativeSurvey, /setStep\('verdict'\)/);

  assert.match(nativeLobby, /handlePendingPostDateFeedbackDrain/);
  assert.match(nativeLobby, /pendingPostDateFeedbackSessionIdFromDrainPayload/);
  assert.match(nativeLobby, /forceSurvey: true/);
  assert.ok(
    nativeLobby.indexOf("handlePendingPostDateFeedbackDrain(") <
      nativeLobby.indexOf("openReadyGateWithSession(promotedSessionId"),
    "native lobby interval drain must handle pending feedback before opening Ready Gate",
  );
  assert.match(nativeLobby, /queue_drain_initial_pending_post_date_feedback/);
  assert.match(nativeLobby, /video_session_insert_queue_drain_pending_post_date_feedback/);

  assert.match(nativeNotificationHandler, /isPendingPostDateFeedbackDrainResult/);
  assert.match(nativeNotificationHandler, /pendingPostDateFeedbackSessionIdFromDrainPayload/);
  assert.match(nativeNotificationHandler, /queued_session_rescue_pending_feedback/);
  assert.match(nativeNotificationHandler, /return videoDateHref\(pendingSessionId\)/);
});

test("survey feedback drain guard is wired into Video Date suites", () => {
  assert.match(packageJson, /videoDateSurveyFeedbackDrainGuard\.test\.ts/);
});
