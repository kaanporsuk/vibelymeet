import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260609003604_video_date_strict_daily_join_remote_seen.sql",
);
const joinedFacadeMigration = read(
  "supabase/migrations/20260607103100_video_date_provider_joined_absence_terminal.sql",
);
const webVideoCall = read("src/hooks/useVideoCall.ts");
const nativeDateRoute = read("apps/mobile/app/date/[id].tsx");
const supabaseTypes = read("src/integrations/supabase/types.ts");
const packageJson = read("package.json");

function functionBody(source: string, name: string): string {
  const start = source.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const end = source.indexOf("$function$;", start);
  assert.notEqual(end, -1, `${name} should have a dollar-quoted body`);
  return source.slice(start, end);
}

test("lifecycle helper blocks stale sessions before joined, remote-seen, or promotion truth", () => {
  const helper = functionBody(migration, "video_date_session_lifecycle_eligibility_v1");

  assert.match(helper, /public\.get_event_lobby_inactive_reason\(v_session\.event_id\)/);
  assert.match(helper, /FROM public\.event_registrations/);
  assert.match(helper, /current_room_id IS DISTINCT FROM p_session_id/);
  assert.match(helper, /queue_status[\s\S]+IN \(/);
  assert.match(helper, /'in_ready_gate'/);
  assert.match(helper, /'in_handshake'/);
  assert.match(helper, /'in_date'/);
  assert.match(helper, /public\.video_date_participant_eligibility_v1\(/);
  assert.match(helper, /ACTOR_SESSION_REGISTRATION_MISMATCH/);
  assert.match(helper, /PARTNER_SESSION_REGISTRATION_MISMATCH/);
  assert.match(helper, /ACTOR_NOT_ELIGIBLE/);
  assert.match(helper, /PARTNER_NOT_ELIGIBLE/);
  assert.match(helper, /SESSION_ENDED/);
  assert.match(helper, /EVENT_INACTIVE/);
});

test("daily joined/alive requires current Daily provider-session webhook proof", () => {
  const providerProof = functionBody(
    migration,
    "video_date_current_provider_session_proof_v1",
  );
  const dailyAlive = functionBody(migration, "mark_video_date_daily_alive");
  const joinedFacade = functionBody(joinedFacadeMigration, "mark_video_date_daily_joined");

  assert.match(providerProof, /event_type = 'participant\.joined'/);
  assert.match(providerProof, /event_type = 'participant\.left'/);
  assert.match(providerProof, /video_date_daily_provider_session_id_from_event_v1/);
  assert.match(providerProof, /= v_provider_session_id/);
  assert.match(providerProof, /DAILY_JOIN_PROVIDER_WEBHOOK_PENDING/);
  assert.match(providerProof, /DAILY_JOIN_PROVIDER_SESSION_LEFT/);
  assert.match(providerProof, /v_left_at IS NOT NULL AND v_left_at >= v_joined_at/);
  assert.doesNotMatch(
    providerProof,
    /latest_provider_event_type IS NULL/,
    "missing provider events must be retryable pending proof, not accepted joined proof",
  );

  assert.match(dailyAlive, /video_date_session_lifecycle_eligibility_v1/);
  assert.match(dailyAlive, /video_date_current_provider_session_proof_v1/);
  assert.match(dailyAlive, /DAILY_JOIN_PROVIDER_PROOF_MISSING/);
  assert.match(dailyAlive, /provider_join_webhook_required/);
  assert.match(dailyAlive, /join_stamp_accepted', false/);
  assert.match(dailyAlive, /vd_alive_strict_provider_base/);

  const proofBeforeBase =
    dailyAlive.indexOf("video_date_current_provider_session_proof_v1") <
    dailyAlive.indexOf("vd_alive_strict_provider_base");
  assert.equal(proofBeforeBase, true, "proof must run before delegating to the joined base");

  assert.match(joinedFacade, /public\.mark_video_date_daily_alive\(/);
});

test("remote-seen requires explicit render/media evidence before delegating to provider-current base", () => {
  const remoteSeen = functionBody(migration, "mark_video_date_remote_seen");

  assert.match(remoteSeen, /p_evidence_source text DEFAULT NULL/);
  assert.match(remoteSeen, /video_date_session_lifecycle_eligibility_v1/);
  assert.match(remoteSeen, /REMOTE_SEEN_RENDER_EVIDENCE_REQUIRED/);
  assert.match(remoteSeen, /loadeddata/);
  assert.match(remoteSeen, /playing/);
  assert.match(remoteSeen, /remote_track_mounted/);
  assert.match(remoteSeen, /first_remote_frame/);
  assert.match(remoteSeen, /request_video_frame_callback/);
  assert.match(remoteSeen, /vd_remote_seen_render_base/);
  assert.match(remoteSeen, /render_evidence_accepted/);

  const sourceBeforeBase =
    remoteSeen.indexOf("REMOTE_SEEN_RENDER_EVIDENCE_REQUIRED") <
    remoteSeen.indexOf("vd_remote_seen_render_base");
  assert.equal(sourceBeforeBase, true, "render evidence must be accepted before delegating");
});

test("promotion RPCs reuse lifecycle eligibility before date promotion", () => {
  const providerPromote = functionBody(migration, "video_date_promote_provider_overlap_v1");
  const autoPromote = functionBody(migration, "video_session_handshake_auto_promote_v2");

  for (const [name, body, base] of [
    ["provider promoter", providerPromote, "vd_provider_overlap_eligible_base"],
    ["auto promoter", autoPromote, "vd_auto_promote_eligible_base"],
  ] as const) {
    assert.match(body, /video_date_session_lifecycle_eligibility_v1/, name);
    assert.match(body, /promotion_blocked_by_lifecycle_eligibility/, name);
    assert.match(body, /provider_overlap_promoted_to_date', false/, name);
    assert.match(body, /confirmed_encounter_promoted_to_date', false/, name);
    assert.match(body, new RegExp(base), name);
    assert.ok(
      body.indexOf("video_date_session_lifecycle_eligibility_v1") < body.indexOf(base),
      `${name} must check eligibility before delegating`,
    );
  }
});

test("web remote-seen server stamps are render-bound, not participant/snapshot-bound", () => {
  assert.match(webVideoCall, /p_evidence_source: attemptSource/);
  assert.match(webVideoCall, /source === "loadeddata"/);
  assert.match(webVideoCall, /source === "playing"/);
  assert.match(
    webVideoCall,
    /markRemoteFirstFrameRendered\(\s*method === "request_video_frame_callback"[\s\S]{0,160}"request_video_frame_callback"[\s\S]{0,160}"first_remote_frame"/,
  );
  assert.doesNotMatch(webVideoCall, /markRemoteSeenOnServer\("participant_joined"\)/);
  assert.doesNotMatch(webVideoCall, /markRemoteSeenOnServer\("participant_updated"\)/);
  assert.doesNotMatch(webVideoCall, /markRemoteSeenOnServer\("post_join_snapshot"\)/);
});

test("native remote-seen server stamps are mounted-media-bound, not participant/snapshot-bound", () => {
  assert.match(nativeDateRoute, /p_evidence_source: attemptSource/);
  assert.match(nativeDateRoute, /source === "remote_track_mounted"/);
  assert.match(nativeDateRoute, /markRemoteSeenOnServer\("remote_track_mounted"\)/);
  assert.doesNotMatch(
    nativeDateRoute,
    /markRemoteSeenOnServerRef\.current\?\.\("participant_joined"\)/,
  );
  assert.doesNotMatch(
    nativeDateRoute,
    /markRemoteSeenOnServerRef\.current\?\.\("participant_updated"\)/,
  );
  assert.doesNotMatch(
    nativeDateRoute,
    /markRemoteSeenOnServerRef\.current\?\.\("shared_call_snapshot"\)/,
  );
  assert.doesNotMatch(
    nativeDateRoute,
    /markRemoteSeenOnServerRef\.current\?\.\("post_join_snapshot"\)/,
  );
});

test("generated RPC types and video-date suites include the strict contract", () => {
  assert.match(supabaseTypes, /mark_video_date_remote_seen: \{\s+Args: \{[\s\S]+p_evidence_source\?: string/);
  assert.match(packageJson, /videoDateStrictDailyJoinRemoteSeen\.test\.ts/);
});
