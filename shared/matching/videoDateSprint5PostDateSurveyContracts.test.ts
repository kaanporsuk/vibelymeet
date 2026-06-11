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
const legacyVerdictRemovalMigration = read(
  "supabase/migrations/20260611094913_remove_legacy_post_date_verdict_rpcs.sql",
);
const autoNextRemovalMigration = read(
  "supabase/migrations/20260610000100_remove_post_date_instant_next.sql",
);
const postDateVerdictFunction = read("supabase/functions/post-date-verdict/index.ts");
const webSurvey = read("src/components/video-date/PostDateSurvey.tsx");
const nativeSurvey = read("apps/mobile/components/video-date/PostDateSurvey.tsx");
const webPostDateOutbox = read("src/lib/postDateOutbox/execute.ts");
const nativePostDateOutbox = read("apps/mobile/lib/postDateOutbox/execute.ts");
const generatedTypes = read("src/integrations/supabase/types.ts");
const packageJson = read("package.json");

function functionBodyFrom(source: string, signature: string): string {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}[\\s\\S]+?\\$function\\$;`));
  assert.ok(match, `missing function body for ${signature}`);
  return match[0];
}

function sprint5FunctionBody(signature: string): string {
  return functionBodyFrom(sprint5Migration, signature);
}

function legacyRemovalFunctionBody(signature: string): string {
  return functionBodyFrom(legacyVerdictRemovalMigration, signature);
}

test("Sprint 5 survey eligibility treats reported/blocked terminalization as safety skip", () => {
  assert.ok(POST_DATE_SURVEY_INELIGIBLE_ENDED_REASONS.includes("blocked_or_reported_pair"));
  const eligibility = sprint5FunctionBody(
    "CREATE OR REPLACE FUNCTION public.video_date_session_is_post_date_survey_eligible",
  );
  assert.match(eligibility, /public\.video_date_session_has_encounter_exposure/);
  assert.match(eligibility, /'blocked_pair'/);
  assert.match(eligibility, /'blocked_or_reported_pair'/);
});

test("post-date verdict persistence is v3-only and keeps immutable feedback semantics", () => {
  const verdictV3 = legacyRemovalFunctionBody(
    "CREATE OR REPLACE FUNCTION public.submit_post_date_verdict_v3",
  );
  assert.match(verdictV3, /public\.video_session_command_begin_v2/);
  assert.match(verdictV3, /INSERT INTO public\.post_date_client_submissions/);
  assert.match(verdictV3, /v_submission\.result IS NOT NULL[\s\S]+v_submission\.result \|\| jsonb_build_object\('idempotent', true\)/);
  assert.match(verdictV3, /v_existing_liked boolean/);
  assert.match(verdictV3, /v_already_submitted boolean := false/);
  assert.match(verdictV3, /v_effective_liked boolean := CASE WHEN p_safety_report IS NULL THEN p_liked ELSE false END/);
  assert.match(verdictV3, /v_pair_reported boolean := false/);
  assert.match(verdictV3, /FROM public\.user_reports ur[\s\S]+ur\.reporter_id = v_actor[\s\S]+ur\.reported_id = v_target/);
  assert.match(verdictV3, /IF v_pair_reported THEN[\s\S]+v_effective_liked := false/);
  assert.match(
    verdictV3,
    /ELSIF COALESCE\(v_session\.ended_reason, ''\) IN \('blocked_pair', 'blocked_or_reported_pair'\)[\s\S]+UPDATE public\.post_date_pending_verdicts[\s\S]+status = 'completed'[\s\S]+v_result := jsonb_build_object\([\s\S]+'blocked', true/,
  );
  assert.match(verdictV3, /SELECT df\.liked INTO v_existing_liked[\s\S]+FROM public\.date_feedback df/);
  assert.match(verdictV3, /v_already_submitted := FOUND/);
  assert.match(verdictV3, /IF NOT v_already_submitted THEN[\s\S]+INSERT INTO public\.date_feedback/);
  assert.match(verdictV3, /VALUES \(p_session_id, v_actor, v_target, v_effective_liked\)/);
  assert.doesNotMatch(
    verdictV3,
    /ON CONFLICT \(session_id, user_id\)[\s\S]{0,200}DO UPDATE SET[\s\S]{0,80}liked\s*=/,
  );
  assert.match(verdictV3, /v_inner := public\.check_mutual_vibe_and_match\(p_session_id\)/);
  assert.match(verdictV3, /v_pair_reported := v_pair_reported OR COALESCE\(\(v_inner->>'reported_pair'\)::boolean, false\)/);
  assert.match(verdictV3, /ELSIF v_pair_reported THEN[\s\S]+'safety_reported', true[\s\S]+'awaiting_partner_verdict', false/);
  assert.match(verdictV3, /UPDATE public\.post_date_pending_verdicts[\s\S]+status = 'completed'/);
  assert.match(verdictV3, /'already_submitted', v_already_submitted/);
  assert.match(verdictV3, /'idempotent', v_already_submitted/);
  assert.match(verdictV3, /'liked', COALESCE\(v_existing_liked, v_effective_liked\)/);
  assert.match(verdictV3, /public\.resolve_post_date_next_surface\(p_session_id\)/);
  assert.doesNotMatch(verdictV3, /public\.submit_post_date_verdict_v2/);
  assert.doesNotMatch(verdictV3, /public\.submit_post_date_verdict\(/);
  assert.match(legacyVerdictRemovalMigration, /DROP FUNCTION IF EXISTS public\.submit_post_date_verdict_v2\(uuid, boolean, text, jsonb\)/);
  assert.match(legacyVerdictRemovalMigration, /DROP FUNCTION IF EXISTS public\.submit_post_date_verdict\(uuid, boolean\)/);
  assert.match(legacyVerdictRemovalMigration, /DROP FUNCTION IF EXISTS public\.submit_post_date_verdict_20260603090000_remote_seen_base\(uuid, boolean\)/);
});

test("Sprint 5 safety reports force a pass before any match or notification path", () => {
  const verdictV3 = legacyRemovalFunctionBody(
    "CREATE OR REPLACE FUNCTION public.submit_post_date_verdict_v3",
  );
  assert.match(verdictV3, /v_effective_liked boolean := CASE WHEN p_safety_report IS NULL THEN p_liked ELSE false END/);
  assert.match(verdictV3, /'liked', v_effective_liked/);
  assert.match(verdictV3, /INSERT INTO public\.user_reports/);
  assert.match(verdictV3, /v_block_result := public\.block_user_with_cleanup/);
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
  assert.match(postDateVerdictFunction, /unsupported_transition_version/);
  assert.match(postDateVerdictFunction, /missing_idempotency_key/);
  assert.doesNotMatch(postDateVerdictFunction, /deprecated_version_coerced_to_v3|verdict-legacy-keyless/);
  assert.doesNotMatch(postDateVerdictFunction, /rpc\("submit_post_date_verdict_v2"/);
  assert.doesNotMatch(postDateVerdictFunction, /rpc\("submit_post_date_verdict"/);
});

test("Sprint 5 next-surface authority suppresses unsafe chat and same-pair active surfaces", () => {
  const resolver = autoNextRemovalMigration.slice(
    autoNextRemovalMigration.indexOf("CREATE OR REPLACE FUNCTION public.resolve_post_date_next_surface"),
    autoNextRemovalMigration.indexOf("COMMENT ON FUNCTION public.resolve_post_date_next_surface"),
  );
  assert.match(resolver, /v_pair_blocked_or_reported boolean := false/);
  assert.match(resolver, /public\.is_blocked\(v_uid, v_target_id\)/);
  assert.match(resolver, /FROM public\.user_reports ur[\s\S]+ur\.reporter_id = v_uid[\s\S]+ur\.reported_id = v_target_id/);
  assert.match(
    resolver,
    /public\.video_date_session_is_post_date_survey_eligible\([\s\S]+AND NOT v_has_feedback[\s\S]+AND NOT COALESCE\(v_pair_blocked_or_reported, false\) THEN/,
  );
  assert.match(resolver, /IF NOT COALESCE\(v_pair_blocked_or_reported, false\) THEN[\s\S]+SELECT id INTO v_match_id/);
  assert.match(resolver, /IF v_match_id IS NOT NULL AND NOT COALESCE\(v_pair_blocked_or_reported, false\) THEN/);
  assert.match(resolver, /'reason', CASE[\s\S]+WHEN COALESCE\(v_pair_blocked_or_reported, false\) THEN 'pair_safety_blocked'/);
  assert.doesNotMatch(resolver, /'route', 'ready_gate'/);
  assert.doesNotMatch(resolver, /'action', 'video_date'/);
  assert.match(resolver, /'route', 'chat'/);
  assert.match(resolver, /'route', 'event_wrap_up'/);
});

test("web and native surveys use backend next-surface authority before fallbacks", () => {
  for (const source of [webSurvey, nativeSurvey]) {
    assert.match(source, /resolve_post_date_next_surface/);
    assert.match(source, /normalizeServerPostDateNextSurface/);
    assert.match(source, /decideCanonicalVideoDateRoute/);
    assert.match(source, /canonicalNextRoute\.target === ['"]survey['"]/);
    assert.match(source, /canonicalNextRoute\.target === ['"]chat['"]/);
    assert.match(source, /canonicalNextRoute\.target === ['"]lobby['"]/);
    assert.match(source, /canonicalNextRoute\.target === ['"]ended['"]/);
    assert.match(source, /canonicalNextRoute\.target === ['"]home['"]/);
    assert.match(source, /removed_auto_next_target_ignored/);
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

test("survey no longer drains queued sessions after post-date completion", () => {
  assert.match(webSurvey, /sourceSurface:\s*"post_date_survey"/);
  assert.match(nativeSurvey, /sourceSurface: ['"]post_date_survey['"]/);
  for (const source of [webSurvey, nativeSurvey]) {
    assert.match(source, /removed_auto_next_target_ignored/);
    assert.doesNotMatch(source, /enableSurveyPhaseDrain|survey_queue_drain|onQueuedVideoSessionReady/);
    assert.doesNotMatch(source, /drainMatchQueue|getQueuedMatchCount|useMatchQueue/);
  }
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
  }).target, "date");
});

test("v3-only verdict contract remains active in Edge, outbox, and generated types", () => {
  const verdictV3 = legacyRemovalFunctionBody(
    "CREATE OR REPLACE FUNCTION public.submit_post_date_verdict_v3",
  );
  assert.match(verdictV3, /IF COALESCE\(\(v_result->>'idempotent'\)::boolean, false\)[\s\S]+post_date_safety_report_recorded/);
  assert.match(verdictV3, /'report_id', v_result->>'report_id'/);
  assert.match(verdictV3, /'reported_participant_role'/);

  assert.match(webPostDateOutbox, /transition_version: "v3"/);
  assert.match(nativePostDateOutbox, /transition_version: ['"]v3['"]/);
  assert.match(postDateVerdictFunction, /userClient\.rpc\("submit_post_date_verdict_v3"/);
  for (const [name, source] of [
    ["edge", postDateVerdictFunction],
    ["web survey", webSurvey],
    ["native survey", nativeSurvey],
    ["web outbox", webPostDateOutbox],
    ["native outbox", nativePostDateOutbox],
  ] as const) {
    assert.doesNotMatch(source, /submit_post_date_verdict_v2/, name);
    assert.doesNotMatch(source, /rpc\(["']submit_post_date_verdict["']/, name);
  }

  assert.match(generatedTypes, /submit_post_date_verdict_v3:/);
  assert.doesNotMatch(generatedTypes, /submit_post_date_verdict:\s*\{/);
  assert.doesNotMatch(generatedTypes, /submit_post_date_verdict_v2:\s*\{/);
  assert.doesNotMatch(generatedTypes, /submit_post_date_verdict_20260603090000_remote_seen_base:\s*\{/);
});

test("Sprint 5 contracts are included in the video-date no-build suite", () => {
  assert.match(packageJson, /videoDateSprint5PostDateSurveyContracts\.test\.ts/);
});
