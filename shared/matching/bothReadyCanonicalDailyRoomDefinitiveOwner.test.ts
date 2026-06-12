import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decideCanonicalVideoDateRoute,
  type VideoDateRouteSessionTruth,
} from "./videoDateRouteDecision";
import {
  isActiveSessionDirectFallbackFresh,
  readyGateTransitionResultBlocksActiveSession,
} from "./activeSession";

const root = process.cwd();
const migration = read(
  "supabase/migrations/20260608193915_video_date_both_ready_definitive_owner_eligibility.sql",
);
const sendNotification = read("supabase/functions/send-notification/index.ts");
const webHydration = read("src/components/session/SessionRouteHydration.tsx");
const nativeHydration = read("apps/mobile/components/NativeSessionRouteHydration.tsx");
const webActiveSession = read("src/hooks/useActiveSession.ts");
const nativeActiveSession = read("apps/mobile/lib/useActiveSession.ts");
const packageJson = read("package.json");

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function blockBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing end marker after ${start}: ${end}`);
  return source.slice(startIndex, endIndex);
}

const NOW_MS = Date.parse("2026-06-08T12:00:00.000Z");
const SESSION_ID = "session-1";
const EVENT_ID = "event-1";

function bothReadySession(overrides: Partial<VideoDateRouteSessionTruth> = {}): VideoDateRouteSessionTruth {
  return {
    id: SESSION_ID,
    event_id: EVENT_ID,
    state: "ready_gate",
    phase: "ready_gate",
    ready_gate_status: "both_ready",
    ready_gate_expires_at: "2026-06-08T12:05:00.000Z",
    daily_room_name: null,
    daily_room_url: null,
    ended_at: null,
    ended_reason: null,
    participant_1_id: "user-a",
    participant_2_id: "user-b",
    ...overrides,
  };
}

test("both_ready without provider room is a canonical date owner on shared web/native route truth", () => {
  const truth = bothReadySession();
  const decision = decideCanonicalVideoDateRoute({
    sessionId: SESSION_ID,
    eventId: EVENT_ID,
    truth,
    nowMs: NOW_MS,
  });

  assert.equal(decision.target, "date");
  assert.equal(decision.reason, "both_ready_provider_prepare_pending");
  assert.equal(decision.canAttemptDaily, false);
  assert.equal(decision.hasProviderRoom, false);
  assert.equal(decision.legacyDecision, "navigate_date");

  assert.equal(isActiveSessionDirectFallbackFresh(truth, NOW_MS), true);
  assert.equal(
    readyGateTransitionResultBlocksActiveSession({
      success: true,
      terminal: true,
      status: "both_ready",
      ready_gate_status: "both_ready",
    }),
    false,
    "legacy terminal=true must not block a both_ready date owner",
  );
});

test("backend eligibility helper covers account deletion, suspensions, hidden profile truth, and age gates", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.video_date_participant_eligibility_v1/);
  assert.match(migration, /FROM auth\.users au/);
  assert.match(migration, /au\.deleted_at/);
  assert.match(migration, /au\.banned_until/);
  assert.match(migration, /FROM public\.user_suspensions us/);
  assert.match(migration, /us\.status = 'active'/);
  assert.match(migration, /us\.lifted_at IS NULL/);
  assert.match(migration, /us\.expires_at IS NULL OR us\.expires_at > now\(\)/);
  assert.match(migration, /public\.is_profile_hidden\(p_profile_id\)/);
  assert.match(migration, /v_profile\.birth_date > \(current_date - interval '18 years'\)::date/);
  assert.match(migration, /v_profile\.age IS NOT NULL AND v_profile\.age < 18/);
  assert.match(migration, /'code', 'ELIGIBILITY_CHECK_UNAVAILABLE'/);
});

test("actionability wrapper preserves the existing base and rejects invalid participants before date entry", () => {
  assert.match(
    migration,
    /ALTER FUNCTION public\.video_date_ready_gate_actionability_v1\(\s*uuid, uuid, text, boolean, boolean, boolean, boolean\s*\)\s+RENAME TO vd_ready_gate_actionability_owner_eligibility_base/,
  );
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.vd_ready_gate_actionability_owner_eligibility_base/);

  const actionabilityBlock = blockBetween(
    migration,
    "CREATE OR REPLACE FUNCTION public.video_date_ready_gate_actionability_v1",
    "CREATE OR REPLACE FUNCTION public.video_session_mark_ready_v2",
  );
  assert.match(actionabilityBlock, /public\.vd_ready_gate_actionability_owner_eligibility_base\(/);
  assert.match(actionabilityBlock, /public\.video_date_participant_eligibility_v1\(v_actor/);
  assert.match(actionabilityBlock, /public\.video_date_participant_eligibility_v1\(v_partner_id/);
  assert.match(actionabilityBlock, /public\.video_date_terminalize_ready_gate_session_v1\(/);
  assert.match(actionabilityBlock, /'actor_eligibility_invalid'/);
  assert.match(actionabilityBlock, /'partner_eligibility_invalid'/);
  assert.match(actionabilityBlock, /'actor_eligibility', v_actor_eligibility/);
  assert.match(actionabilityBlock, /'partner_eligibility', v_partner_eligibility/);
  assert.match(actionabilityBlock, /public\.video_date_both_ready_route_payload_v1\(/);
});

test("public ready, snapshot, and transition RPCs return explicit route and terminal semantics", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.video_date_both_ready_route_payload_v1/);
  assert.match(migration, /'route_decision', v_route_decision/);
  assert.match(migration, /'routeDecision', v_route_decision/);
  assert.match(migration, /'next_surface', jsonb_strip_nulls\(jsonb_build_object/);
  assert.match(migration, /'ready_gate_completed', v_ready_gate_completed/);
  assert.match(migration, /'ready_gate_terminal', v_ready_gate_terminal/);
  assert.match(migration, /'date_terminal', v_date_terminal/);
  assert.match(migration, /'both_ready_date_owned', v_ready_gate_completed AND NOT v_ended/);
  assert.match(migration, /'canonical_daily_room_name', v_session\.daily_room_name/);
  assert.match(migration, /'canonical_daily_room_url', v_session\.daily_room_url/);

  assert.match(migration, /ALTER FUNCTION public\.video_session_mark_ready_v2\(uuid, text, text\)[\s\S]*RENAME TO vd_mark_ready_both_ready_owner_base/);
  assert.match(migration, /ALTER FUNCTION public\.get_video_date_start_snapshot_v1\(uuid\)[\s\S]*RENAME TO vd_start_snapshot_both_ready_owner_base/);
  assert.match(migration, /ALTER FUNCTION public\.video_date_transition\(uuid, text, text\)[\s\S]*RENAME TO vd_transition_both_ready_owner_base/);
  assert.match(migration, /public\.video_date_both_ready_route_payload_v1\(\s*p_session_id,\s*v_actor,\s*COALESCE\(v_result, '\{\}'::jsonb\)/);
});

test("second-ready commit enqueues fail-soft date_starting notifications to the date route", () => {
  const markReadyBlock = blockBetween(
    migration,
    "CREATE OR REPLACE FUNCTION public.video_session_mark_ready_v2",
    "CREATE OR REPLACE FUNCTION public.get_video_date_start_snapshot_v1",
  );

  assert.match(markReadyBlock, /v_status = 'both_ready'/);
  assert.match(markReadyBlock, /FOREACH v_recipient IN ARRAY ARRAY\[v_session\.participant_1_id, v_session\.participant_2_id\]/);
  assert.match(markReadyBlock, /v_enqueue_result := public\.video_date_outbox_enqueue_v2\(/);
  assert.match(markReadyBlock, /v_enqueue_result ->> 'ok'/);
  assert.match(markReadyBlock, /v_enqueue_result ->> 'success'/);
  assert.match(markReadyBlock, /'category', 'date_starting'/);
  assert.match(markReadyBlock, /'url', v_path/);
  assert.match(markReadyBlock, /'deep_link', v_path/);
  assert.match(markReadyBlock, /'video_date:date_starting:' \|\| p_session_id::text/);
  assert.match(markReadyBlock, /v_date_starting_degraded := true;[\s\S]*EXCEPTION\s+WHEN OTHERS THEN\s+v_date_starting_degraded := true/);
  assert.match(markReadyBlock, /EXCEPTION\s+WHEN OTHERS THEN\s+v_date_starting_degraded := true/);
  assert.match(markReadyBlock, /'date_starting_notification_degraded', v_date_starting_degraded/);

  assert.match(sendNotification, /category === 'date_starting'/);
  assert.match(sendNotification, /return actionObject\('open_video_date'/);
  assert.match(sendNotification, /case 'open_video_date':\s+return sessionId \? `\/date\/\$\{sessionId\}` : null/);
});

test("web and native hydration/active-session consumers use canonical route decisions after both_ready", () => {
  for (const [name, source] of [
    ["web hydration", webHydration],
    ["native hydration", nativeHydration],
    ["web active session", webActiveSession],
    ["native active session", nativeActiveSession],
  ] as const) {
    assert.match(
      source,
      /decideCanonicalVideoDateRoute|decideVideoSessionRouteFromTruth|decideVideoDateSurfaceRoute/,
      name,
    );
    assert.match(
      source,
      /navigate_date|canonicalRoute\.target === ["']date["']|decision\.target === ["']date["']|freshDateRoute/,
      name,
    );
  }

  // PR 7: web hydration delegates to the shared single surface-route decision.
  assert.match(webHydration, /decideVideoDateSurfaceRoute/);
  assert.match(webHydration, /decision\.target === "date"/);
  assert.match(nativeHydration, /canonicalRoute\.target === ["']date["']/);
  assert.match(webActiveSession, /truthDecision === "navigate_date"/);
  assert.match(nativeActiveSession, /truthDecision === 'navigate_date'/);
});

test("service-only operator diagnostics cover stuck both_ready and survey/room drift categories", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.video_date_both_ready_operator_diagnostics_v1/);
  assert.match(migration, /both_ready_without_bilateral_join/);
  assert.match(migration, /daily_room_domain_mismatch/);
  assert.match(migration, /joined_without_bilateral_remote_seen/);
  assert.match(migration, /remote_seen_without_date_promotion/);
  assert.match(migration, /survey_required_without_bilateral_feedback/);
  assert.match(migration, /current_setting\('app\.daily_domain', true\)/);
  assert.match(migration, /'vibelyapp\.daily\.co'/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.video_date_both_ready_operator_diagnostics_v1\(uuid, integer\)[\s\S]*GRANT EXECUTE ON FUNCTION public\.video_date_both_ready_operator_diagnostics_v1\(uuid, integer\)[\s\S]*TO service_role/,
  );
});

test("definitive owner contract is wired into the red-flag suite", () => {
  assert.match(
    packageJson,
    /bothReadyCanonicalDailyRoomDefinitiveOwner\.test\.ts/,
  );
});
