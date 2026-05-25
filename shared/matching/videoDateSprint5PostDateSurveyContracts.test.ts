import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decideCanonicalVideoDateRoute,
  POST_DATE_SURVEY_INELIGIBLE_ENDED_REASONS,
} from "./videoDateRouteDecision";
import { normalizeServerPostDateNextSurface } from "./postDateContinuity";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const sprint5Migration = read(
  "supabase/migrations/20260525223000_video_date_sprint5_post_date_next_surface_authority.sql",
);
const reviewFollowupMigration = read(
  "supabase/migrations/20260525235900_review_comments_1060_1070_followups.sql",
);
const postDateVerdictFunction = read("supabase/functions/post-date-verdict/index.ts");
const webSurvey = read("src/components/video-date/PostDateSurvey.tsx");
const nativeSurvey = read("apps/mobile/components/video-date/PostDateSurvey.tsx");
const packageJson = read("package.json");

function functionBody(signature: string): string {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sprint5Migration.match(new RegExp(`${escaped}[\\s\\S]+?\\$function\\$;`));
  assert.ok(match, `missing function body for ${signature}`);
  return match[0];
}

test("Sprint 5 survey eligibility treats reported/blocked terminalization as safety skip", () => {
  assert.ok(POST_DATE_SURVEY_INELIGIBLE_ENDED_REASONS.includes("blocked_or_reported_pair"));
  const eligibility = functionBody(
    "CREATE OR REPLACE FUNCTION public.video_date_session_is_post_date_survey_eligible",
  );
  assert.match(eligibility, /public\.video_date_session_has_encounter_exposure/);
  assert.match(eligibility, /'blocked_pair'/);
  assert.match(eligibility, /'blocked_or_reported_pair'/);
});

test("Sprint 5 verdict submit is immutable and retries are idempotent", () => {
  const verdict = functionBody(
    "CREATE OR REPLACE FUNCTION public.submit_post_date_verdict(p_session_id uuid, p_liked boolean)",
  );
  assert.match(verdict, /v_existing_liked boolean/);
  assert.match(verdict, /v_already_submitted boolean := false/);
  assert.match(verdict, /v_effective_liked boolean := p_liked/);
  assert.match(verdict, /v_pair_reported boolean := false/);
  assert.match(verdict, /FROM public\.user_reports ur[\s\S]+ur\.reporter_id = v_uid[\s\S]+ur\.reported_id = v_target/);
  assert.match(verdict, /IF v_pair_reported THEN[\s\S]+v_effective_liked := false/);
  assert.match(
    verdict,
    /IF COALESCE\(v_session\.ended_reason, ''\) IN \('blocked_pair', 'blocked_or_reported_pair'\)[\s\S]+UPDATE public\.post_date_pending_verdicts[\s\S]+status = 'completed'[\s\S]+RETURN jsonb_build_object\([\s\S]+'blocked', true/,
  );
  assert.match(verdict, /SELECT df\.liked INTO v_existing_liked[\s\S]+FROM public\.date_feedback df/);
  assert.match(verdict, /v_already_submitted := FOUND/);
  assert.match(verdict, /IF NOT v_already_submitted THEN[\s\S]+INSERT INTO public\.date_feedback/);
  assert.match(verdict, /VALUES \(p_session_id, v_uid, v_target, v_effective_liked\)/);
  assert.doesNotMatch(
    verdict,
    /ON CONFLICT \(session_id, user_id\)[\s\S]{0,200}DO UPDATE SET[\s\S]{0,80}liked\s*=/,
  );
  assert.match(verdict, /v_pair_reported := v_pair_reported OR COALESCE\(\(v_inner->>'reported_pair'\)::boolean, false\)/);
  assert.match(verdict, /IF v_pair_reported THEN[\s\S]+'safety_reported', true[\s\S]+'awaiting_partner_verdict', false/);
  assert.match(verdict, /UPDATE public\.post_date_pending_verdicts[\s\S]+status = 'completed'/);
  assert.match(verdict, /'already_submitted', v_already_submitted/);
  assert.match(verdict, /'idempotent', v_already_submitted/);
  assert.match(verdict, /'liked', COALESCE\(v_existing_liked, v_effective_liked\)/);

  const verdictV2 = functionBody(
    "CREATE OR REPLACE FUNCTION public.submit_post_date_verdict_v2",
  );
  assert.match(verdictV2, /v_effective_liked boolean := CASE WHEN p_safety_report IS NULL THEN p_liked ELSE false END/);
  assert.match(verdictV2, /VALUES \(v_uid, p_session_id, 'verdict', v_key, v_effective_liked, p_safety_report\)/);
  assert.match(verdictV2, /v_result := public\.submit_post_date_verdict\(p_session_id, v_effective_liked\)/);
  assert.match(
    verdictV2,
    /IF p_safety_report IS NOT NULL THEN[\s\S]+UPDATE public\.post_date_pending_verdicts[\s\S]+status = 'completed'/,
  );
  assert.match(verdictV2, /'safety_reported', true/);
  assert.match(verdictV2, /'awaiting_partner_verdict', false/);
  assert.match(
    verdictV2,
    /'idempotent', COALESCE\(\(v_result->>'idempotent'\)::boolean, false\)/,
  );
});

test("Sprint 5 safety reports force a pass before any match or notification path", () => {
  const verdictV3 = functionBody(
    "CREATE OR REPLACE FUNCTION public.submit_post_date_verdict_v3",
  );
  assert.match(verdictV3, /v_effective_liked boolean := CASE WHEN p_safety_report IS NULL THEN p_liked ELSE false END/);
  assert.match(verdictV3, /'liked', v_effective_liked/);
  assert.match(verdictV3, /public\.submit_post_date_verdict_v2\([\s\S]+v_effective_liked/);
  assert.match(verdictV3, /v_pair_blocked_or_reported boolean := false/);
  assert.match(verdictV3, /v_confirmed_mutual := v_actor_liked AND v_partner_liked AND NOT COALESCE\(v_pair_blocked_or_reported, false\)/);
  assert.match(verdictV3, /WHEN v_pair_blocked_or_reported THEN 'safety_reported'/);
  assert.match(verdictV3, /WHEN v_confirmed_mutual THEN 'resolved_mutual'/);
  assert.match(verdictV3, /'mutual', v_confirmed_mutual/);
  assert.match(verdictV3, /v_event_payload := jsonb_build_object\([\s\S]+'mutual', v_confirmed_mutual/);
  assert.equal(
    [...verdictV3.matchAll(/'awaiting_partner_verdict', v_verdict_state = 'awaiting_partner'/g)].length,
    2,
  );
  assert.doesNotMatch(verdictV3, /'awaiting_partner_verdict', NOT v_partner_has_feedback/);

  assert.match(
    postDateVerdictFunction,
    /const effectiveLiked = action === "verdict" && body\?\.safety_report != null \? false : liked/,
  );
  assert.match(
    postDateVerdictFunction,
    /submit_post_date_verdict_v3[\s\S]+p_liked: effectiveLiked as boolean/,
  );
  assert.match(
    postDateVerdictFunction,
    /submit_post_date_verdict_v2[\s\S]+p_liked: effectiveLiked as boolean/,
  );
  assert.match(
    postDateVerdictFunction,
    /submit_post_date_verdict"[\s\S]+p_liked: effectiveLiked as boolean/,
  );
});

test("Sprint 5 next-surface authority suppresses unsafe chat and same-pair active surfaces", () => {
  const resolver = functionBody(
    "CREATE OR REPLACE FUNCTION public.resolve_post_date_next_surface",
  );
  assert.match(resolver, /v_pair_blocked_or_reported boolean := false/);
  assert.match(resolver, /public\.is_blocked\(v_uid, v_target_id\)/);
  assert.match(resolver, /FROM public\.user_reports ur[\s\S]+ur\.reporter_id = v_uid[\s\S]+ur\.reported_id = v_target_id/);
  assert.match(
    resolver,
    /public\.video_date_session_is_post_date_survey_eligible\([\s\S]+AND NOT v_has_feedback[\s\S]+AND NOT COALESCE\(v_pair_blocked_or_reported, false\) THEN/,
  );
  assert.match(resolver, /IF NOT COALESCE\(v_pair_blocked_or_reported, false\) THEN[\s\S]+SELECT id INTO v_match_id/);
  assert.match(resolver, /AND NOT public\.is_blocked\([\s\S]+v_uid,[\s\S]+CASE[\s\S]+vs\.participant_1_id = v_uid/);
  assert.match(resolver, /AND NOT EXISTS \([\s\S]+FROM public\.user_reports ur[\s\S]+vs\.participant_1_id = v_uid/);
  assert.match(resolver, /IF v_match_id IS NOT NULL AND NOT COALESCE\(v_pair_blocked_or_reported, false\) THEN/);
  assert.match(resolver, /'reason', CASE[\s\S]+WHEN COALESCE\(v_pair_blocked_or_reported, false\) THEN 'pair_safety_blocked'/);
  assert.match(resolver, /'route', 'ready_gate'/);
  assert.match(resolver, /'route', 'date'/);
  assert.match(resolver, /'route', 'chat'/);
  assert.match(resolver, /'route', 'event_wrap_up'/);
});

test("web and native surveys use backend next-surface authority before fallbacks", () => {
  for (const source of [webSurvey, nativeSurvey]) {
    assert.match(source, /resolve_post_date_next_surface/);
    assert.match(source, /normalizeServerPostDateNextSurface/);
    assert.match(source, /fetchPostDateNextSessionTruth/);
    assert.match(source, /decideCanonicalVideoDateRoute/);
    assert.match(source, /canonicalNextRoute\.target === ['"]ready_gate['"]/);
    assert.match(source, /canonicalNextRoute\.target === ['"]date['"]/);
    assert.match(source, /canonicalNextRoute\.target === ['"]survey['"]/);
    assert.match(source, /canonicalNextRoute\.target === ['"]chat['"]/);
    assert.match(source, /canonicalNextRoute\.target === ['"]lobby['"]/);
    assert.match(source, /canonicalNextRoute\.target === ['"]ended['"]/);
    assert.match(source, /canonicalNextRoute\.target === ['"]home['"]/);
  }
  assert.doesNotMatch(
    webSurvey,
    /serverNext\.action === ["']ready_gate["'][\s\S]{0,80}canonicalNextRoute\.target === ["']ready_gate["']/,
  );
  assert.ok(
    webSurvey.indexOf("resolve_post_date_next_surface") < webSurvey.indexOf("const active = await checkEventActive"),
    "web must ask backend next-surface authority before event-active fallback",
  );
  assert.ok(
    nativeSurvey.indexOf("resolve_post_date_next_surface") <
      nativeSurvey.indexOf("const continuation = await getEventContinuationSnapshot"),
    "native must ask backend next-surface authority before event-active fallback",
  );
});

test("survey queue drain opens standalone Ready Gate instead of stale lobby state", () => {
  assert.match(webSurvey, /sourceSurface:\s*"post_date_survey"/);
  assert.match(webSurvey, /enableSurveyPhaseDrain:\s*true/);
  assert.match(webSurvey, /const target = `\/ready\/\$\{encodeURIComponent\(videoSessionId\)\}`/);
  assert.match(webSurvey, /vdbgRedirect\(target, "survey_queue_match_ready"/);
  assert.match(nativeSurvey, /sourceSurface: 'post_date_survey'/);
  assert.match(nativeSurvey, /sourceAction: 'survey_queue_drain'/);
  assert.match(nativeSurvey, /onQueuedVideoSessionReady\?\.\(nextSessionId\)/);
  assert.match(nativeSurvey, /route: 'ready_gate'/);
});

test("shared canonical routing consumes final post-date next surfaces consistently", () => {
  assert.equal(
    normalizeServerPostDateNextSurface({ success: true, action: "ready_gate", next_session_id: "next-ready" })
      ?.nextSessionId,
    "next-ready",
  );

  assert.equal(decideCanonicalVideoDateRoute({
    sessionId: "current",
    eventId: "event",
    serverNextSurface: { action: "ready_gate", next_session_id: "next-ready", event_id: "event" },
  }).target, "ready_gate");

  assert.equal(decideCanonicalVideoDateRoute({
    sessionId: "current",
    eventId: "event",
    serverNextSurface: { action: "video_date", next_session_id: "next-date", event_id: "event" },
  }).target, "date");

  assert.equal(decideCanonicalVideoDateRoute({
    sessionId: "current",
    eventId: "event",
    serverNextSurface: { action: "chat", match_id: "match", target_id: "partner" },
  }).target, "chat");

  assert.equal(decideCanonicalVideoDateRoute({
    sessionId: "current",
    eventId: "event",
    serverNextSurface: { action: "wrap_up", event_id: "event" },
  }).target, "ended");

  assert.equal(decideCanonicalVideoDateRoute({
    sessionId: "current",
    eventId: "event",
    truth: {
      id: "next-date",
      event_id: "event",
      state: "handshake",
      phase: "handshake",
      daily_room_name: null,
      daily_room_url: null,
    },
    serverNextSurface: { action: "video_date", next_session_id: "next-date", event_id: "event" },
  }).target, "lobby");

  assert.equal(decideCanonicalVideoDateRoute({
    sessionId: "current",
    eventId: "event",
    truth: {
      id: "next-date",
      event_id: "event",
      state: "ready_gate",
      phase: "ready_gate",
      ready_gate_status: "both_ready",
      ready_gate_expires_at: "2026-05-25T12:00:30.000Z",
      daily_room_name: null,
      daily_room_url: null,
    },
    serverNextSurface: { action: "video_date", next_session_id: "next-date", event_id: "event" },
    nowMs: Date.parse("2026-05-25T12:00:00.000Z"),
  }).target, "ready_gate");
});

test("Sprint 5 follow-up emits safety-report events for immutable verdict retries", () => {
  assert.match(reviewFollowupMigration, /CREATE OR REPLACE FUNCTION public\.submit_post_date_verdict_v2/);
  assert.match(reviewFollowupMigration, /IF COALESCE\(\(v_result->>'idempotent'\)::boolean, false\)[\s\S]+post_date_safety_report_recorded/);
  assert.match(reviewFollowupMigration, /'report_id', v_result->>'report_id'/);
  assert.match(reviewFollowupMigration, /'reported_participant_role'/);
});

test("Sprint 5 contracts are included in the video-date no-build suite", () => {
  assert.match(packageJson, /videoDateSprint5PostDateSurveyContracts\.test\.ts/);
});
