import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Video Date rebuild PR 3: the evidence-family RPCs (claim_video_date_surface,
// mark_video_date_daily_alive, mark_video_date_daily_joined,
// mark_video_date_remote_seen) become single self-contained bodies and their
// historical public generations are dropped. These pins hold the migration to
// the effective contract reconstructed from the PR-1 truth-pin fixtures
// (supabase/contract-fixtures/2026-06/).

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260611190852_video_date_evidence_single_bodies.sql",
);
const supabaseTypes = read("src/integrations/supabase/types.ts");

function functionBody(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  assert.notEqual(start, -1, `${name} should be recreated by the migration`);
  const end = migration.indexOf("$function$;", start);
  assert.notEqual(end, -1, `${name} should have a dollar-quoted body`);
  return migration.slice(start, end);
}

const claimBody = functionBody("claim_video_date_surface");
const aliveBody = functionBody("mark_video_date_daily_alive");
const joinedBody = functionBody("mark_video_date_daily_joined");
const remoteSeenBody = functionBody("mark_video_date_remote_seen");

const DROPPED_GENERATIONS = [
  // claim family
  "claim_video_date_surface_20260604093000_failsoft_base",
  "claim_video_date_surface_20260605170249_outer_base",
  "claim_video_date_surface_20260605232304_single_owner_base",
  "claim_video_date_surface_20260607155414_lifecycle_base",
  "claim_video_date_surface_20260608080938_last_resort_base",
  "vd_claim_surface_terminal_truth_base",
  "vd_claim_surface_20260609130139_hot_base",
  // daily_joined family
  "mark_video_date_daily_joined_20260604093000_failsoft_base",
  "mark_video_date_daily_joined_20260605170249_outer_base",
  "mark_video_date_daily_joined_20260607155414_lifecycle_base",
  "mark_video_date_daily_joined_20260607222923_definitive_base",
  "mark_video_date_daily_joined_20260608080938_last_resort_base",
  "mark_video_date_daily_joined_20260609105249_active_entry_base",
  "vd_daily_joined_20260609130139_hot_base",
  // daily_alive family (vd_alive_strict_provider_base was a live chain layer
  // discovered during the rebuild inventory and is dropped with the family)
  "mark_video_date_daily_alive_20260607155414_lifecycle_base",
  "mark_video_date_daily_alive_20260607222923_definitive_base",
  "mark_video_date_daily_alive_20260608080938_last_resort_base",
  "vd_daily_alive_remote_seen_base",
  "vd_alive_strict_provider_base",
  "vd_daily_alive_20260609130139_hot_base",
  // remote_seen family
  "mark_video_date_remote_seen_20260605115657_base",
  "mark_video_date_remote_seen_20260605170249_outer_base",
  "mark_video_date_remote_seen_20260605200729_grace_base",
  "mark_video_date_remote_seen_20260607155414_lifecycle_base",
  "mark_video_date_remote_seen_20260608120000_provider_base",
  "vd_remote_seen_render_base",
] as const;

test("migration preserves signatures, grants, and search_path for all four heads", () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.claim_video_date_surface\(\s*p_session_id uuid,\s*p_surface text,\s*p_client_instance_id text,\s*p_takeover boolean DEFAULT false,\s*p_ttl_seconds integer DEFAULT 12\s*\)/,
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.mark_video_date_daily_joined\([\s\S]{0,400}?p_owner_state text DEFAULT 'joined'\s*\)/,
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.mark_video_date_remote_seen\([\s\S]{0,500}?p_evidence_source text DEFAULT NULL\s*\)/,
  );

  for (const [name, args] of [
    ["claim_video_date_surface", "uuid, text, text, boolean, integer"],
    ["mark_video_date_daily_alive", "uuid, text, text, text, text, text"],
    ["mark_video_date_daily_joined", "uuid, text, text, text, text, text"],
    ["mark_video_date_remote_seen", "uuid, text, text, text, text, text, text"],
  ] as const) {
    assert.match(
      migration,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\(${args}\\)\\s+FROM PUBLIC, anon, authenticated, service_role`,
      ),
      `${name} must re-pin the REVOKE posture`,
    );
    assert.match(
      migration,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${name}\\(${args}\\)\\s+TO authenticated, service_role`,
      ),
      `${name} must stay authenticated/service_role only`,
    );
  }

  for (const body of [claimBody, aliveBody, joinedBody, remoteSeenBody]) {
    assert.match(
      body,
      /RETURNS jsonb\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path TO 'public', 'pg_catalog'/,
    );
  }

  assert.match(migration, /NOTIFY pgrst, 'reload schema'/);
});

test("all 26 historical generations are dropped and none are called by the new bodies", () => {
  for (const name of DROPPED_GENERATIONS) {
    assert.match(
      migration,
      new RegExp(`DROP FUNCTION public\\.${name}\\(`),
      `${name} must be dropped`,
    );
    for (const [head, body] of [
      ["claim_video_date_surface", claimBody],
      ["mark_video_date_daily_alive", aliveBody],
      ["mark_video_date_daily_joined", joinedBody],
      ["mark_video_date_remote_seen", remoteSeenBody],
    ] as const) {
      assert.doesNotMatch(
        body,
        new RegExp(`${name}\\(`),
        `${head} must not call dropped generation ${name}`,
      );
    }
  }
});

test("no raw SQL diagnostics enter client payloads; exceptions go to server observability", () => {
  for (const [name, body] of [
    ["claim_video_date_surface", claimBody],
    ["mark_video_date_daily_alive", aliveBody],
    ["mark_video_date_daily_joined", joinedBody],
    ["mark_video_date_remote_seen", remoteSeenBody],
  ] as const) {
    assert.doesNotMatch(body, /'sqlstate',/, `${name} must not leak sqlstate`);
    assert.doesNotMatch(body, /'sql_message',/, `${name} must not leak sql_message`);
    assert.doesNotMatch(body, /'message', v_message/, `${name} must not leak raw message`);
    assert.doesNotMatch(body, /'detail', NULLIF\(v_detail/, `${name} must not leak raw detail`);
    assert.doesNotMatch(body, /'hint', NULLIF\(v_hint/, `${name} must not leak raw hint`);
  }
  for (const body of [claimBody, aliveBody, remoteSeenBody]) {
    assert.match(body, /video_date_lifecycle_observe_exception_v2\(/);
    assert.match(body, /single_body_core/);
  }
});

test("claim single body keeps single-active-owner semantics, claim events, and terminal audit", () => {
  // Surface vocabulary + per-surface gating.
  assert.match(claimBody, /'ready_gate', 'video_date', 'post_date_survey'/);
  assert.match(claimBody, /video_date_session_is_active_surface\(/);
  assert.match(claimBody, /video_date_session_is_post_date_survey_eligible\(/);

  // Single-active-owner: stale expiry, conflict gating behind takeover.
  assert.match(claimBody, /AND expires_at <= v_now/);
  assert.match(claimBody, /AND NOT p_takeover/);
  assert.match(claimBody, /'code', 'SURFACE_CLAIM_CONFLICT'/);
  assert.match(claimBody, /'conflict_session_id', v_existing\.session_id/);
  assert.match(claimBody, /ON CONFLICT \(profile_id\)/);

  // Claim-event ledger + terminal-truth audit stamping.
  assert.match(claimBody, /'claim',/);
  assert.match(claimBody, /'claim_terminal_audit'/);
  assert.match(claimBody, /session_terminal_generation = v_term\.terminal_generation/);
  assert.match(claimBody, /LIMIT 3/);

  // Pipeline + shell markers.
  assert.match(claimBody, /video_date_enrich_lifecycle_payload_v1\(/);
  assert.match(claimBody, /video_date_lifecycle_enrich_and_sanitize_payload_v2\(/);
  assert.match(claimBody, /'hot_path_no_throw_shell', true/);
  assert.match(claimBody, /'SURFACE_CLAIM_WRAPPER_FAILED'/);
});

test("alive single body keeps eligibility/proof prechecks, heartbeat, and stable-copresence handshake start", () => {
  // Prechecks (order: eligibility, then provider proof).
  const eligibilityIndex = aliveBody.indexOf(
    "video_date_session_lifecycle_eligibility_v1(",
  );
  const proofIndex = aliveBody.indexOf(
    "video_date_current_provider_session_proof_v1(",
  );
  assert.ok(eligibilityIndex > 0, "eligibility precheck must exist");
  assert.ok(proofIndex > eligibilityIndex, "provider proof must follow eligibility");

  // Proof-missing calls stay structured ok:true no-ops.
  assert.match(aliveBody, /'DAILY_JOIN_PROVIDER_PROOF_MISSING'/);
  assert.match(aliveBody, /'waiting_for_stable_copresence', true/);
  assert.match(aliveBody, /daily_alive_provider_session_left/);
  assert.match(aliveBody, /daily_alive_provider_join_pending/);

  // Heartbeat machine: routeable gate, presence throttle, webhook-backed gate.
  assert.match(aliveBody, /'error', 'not_routeable'/);
  assert.match(aliveBody, /interval '6 seconds'/);
  assert.match(aliveBody, /interval '30 seconds'/);
  assert.match(aliveBody, /'client_daily_alive'/);
  assert.match(aliveBody, /daily_alive_without_current_provider_presence/);
  assert.match(aliveBody, /video_date_daily_provider_session_id_from_event_v1\(/);

  // Session-ended terminal path releases the video_date surface claim.
  assert.match(aliveBody, /'queue_status', 'in_survey'/);
  assert.match(aliveBody, /'surface_claim_released', true/);

  // Stable-copresence handshake start + registration continuity.
  assert.match(aliveBody, /video_date_stable_copresence_v1\(/);
  assert.match(aliveBody, /handshake_started_after_stable_daily_alive/);
  assert.match(aliveBody, /UPDATE public\.event_registrations/);

  // Promotion pass + markers.
  assert.match(aliveBody, /'provider_backed_alive'/);
  assert.match(aliveBody, /'strict_provider_join_proof_checked', true/);
  assert.match(aliveBody, /'DAILY_ALIVE_STAMP_FAILED'/);
  assert.match(aliveBody, /'DAILY_ALIVE_FAILED'/);
});

test("joined single body delegates to canonical daily_alive and keeps joined markers", () => {
  assert.match(joinedBody, /public\.mark_video_date_daily_alive\(/);
  assert.match(joinedBody, /'joined_delegated_to_daily_alive', true/);
  assert.match(joinedBody, /'legacy_providerless_noop', v_provider_session_id IS NULL/);
  assert.match(joinedBody, /'provider_backed_joined'/);
  assert.match(joinedBody, /'active_entry_failsoft_shell', true/);
  assert.match(joinedBody, /'hot_path_no_throw_shell', true/);
  assert.match(joinedBody, /'DAILY_JOIN_STAMP_FAILED'/);
});

test("remote_seen single body keeps the provider-proof matrix and structured no-op rejections", () => {
  // Render-evidence allow-list unchanged.
  assert.match(
    remoteSeenBody,
    /'loadeddata',\s+'playing',\s+'remote_track_mounted',\s+'first_remote_frame',\s+'request_video_frame_callback'/,
  );
  assert.match(remoteSeenBody, /'REMOTE_SEEN_RENDER_EVIDENCE_REQUIRED'/);

  // Full rejection-code matrix preserved.
  for (const code of [
    "REMOTE_SEEN_OWNER_MISSING",
    "REMOTE_SEEN_CALL_INSTANCE_MISSING",
    "REMOTE_SEEN_PROVIDER_SESSION_MISSING",
    "REMOTE_SEEN_OWNER_NOT_JOINED",
    "REMOTE_SEEN_PROVIDER_SESSION_LEFT",
    "REMOTE_SEEN_OWNER_HEARTBEAT_MISSING",
    "REMOTE_SEEN_OWNER_HEARTBEAT_STALE",
    "REMOTE_SEEN_OWNER_MISMATCH",
    "REMOTE_SEEN_CALL_INSTANCE_MISMATCH",
    "REMOTE_SEEN_OWNER_PROVIDER_MISMATCH",
    "REMOTE_SEEN_PROVIDER_NOT_CURRENT",
  ]) {
    assert.match(remoteSeenBody, new RegExp(`'${code}'`), `${code} must stay pinned`);
  }

  // Proof matrix requires owner heartbeat freshness and current provider join.
  assert.match(remoteSeenBody, /v_latest_alive_at >= now\(\) - interval '15 seconds'/);
  assert.match(remoteSeenBody, /'participant\.joined', 'participant\.left'/);
  assert.match(remoteSeenBody, /remote_seen_rejected_stale_provider_session/);
  assert.match(remoteSeenBody, /'remote_seen_stamp_accepted', false/);

  // Rejections never mutate encounter truth: the stamp UPDATE only runs after
  // the provider-backed gate.
  const rejectionReturn = remoteSeenBody.indexOf(
    "'remote_seen_rejected_stale_provider_session', true",
  );
  const stampUpdate = remoteSeenBody.indexOf("participant_1_remote_seen_at = GREATEST(");
  assert.ok(rejectionReturn > 0 && stampUpdate > rejectionReturn);
});

test("remote_seen single body keeps stamp, survey continuity, grace clearing, and both promotion passes", () => {
  // Canonical stamp + survey-eligibility v2 continuity with safety guards.
  assert.match(remoteSeenBody, /video_date_session_is_post_date_survey_eligible_v2\(/);
  assert.match(remoteSeenBody, /queue_status = 'in_survey'/);
  assert.match(remoteSeenBody, /FROM public\.date_feedback df1/);
  assert.match(remoteSeenBody, /NOT public\.is_blocked\(/);
  assert.match(remoteSeenBody, /FROM public\.user_reports ur/);
  assert.match(remoteSeenBody, /'remote_video_seen'/);
  assert.match(remoteSeenBody, /video_date_session_has_confirmed_encounter\(/);

  // Promotion order: confirmed-encounter before grace clear before overlap.
  const cePromotion = remoteSeenBody.indexOf("video_date_promote_confirmed_encounter_v1(");
  const graceClear = remoteSeenBody.indexOf("reconnect_grace_cleared_by_remote_seen");
  const overlap = remoteSeenBody.indexOf("'remote_media_or_provider_overlap'");
  assert.ok(cePromotion > 0, "confirmed-encounter promotion must exist");
  assert.ok(graceClear > cePromotion, "grace clear must follow CE promotion");
  assert.ok(overlap > graceClear, "overlap promotion must follow grace clear");
  assert.match(remoteSeenBody, /'remote_media_observed'/);
  assert.match(remoteSeenBody, /early_confirmed_encounter_promoted/);
  assert.match(remoteSeenBody, /bump_video_session_seq\(/);

  // Success markers + head render markers.
  assert.match(remoteSeenBody, /'remote_seen_stamp_accepted', true/);
  assert.match(remoteSeenBody, /'render_evidence_accepted', true/);
  assert.match(remoteSeenBody, /'REMOTE_SEEN_STAMP_FAILED'/);
});

test("generated types expose only the canonical evidence heads", () => {
  for (const name of DROPPED_GENERATIONS) {
    assert.doesNotMatch(
      supabaseTypes,
      new RegExp(`${name}:`),
      `generated types must not expose ${name}`,
    );
  }
  for (const name of [
    "claim_video_date_surface",
    "release_video_date_surface_claim",
    "mark_video_date_daily_alive",
    "mark_video_date_daily_joined",
    "mark_video_date_remote_seen",
  ]) {
    assert.match(
      supabaseTypes,
      new RegExp(`${name}: \\{`),
      `generated types must keep ${name}`,
    );
  }
});

test("intentionally retained: the Daily webhook ledger base is not dropped", () => {
  assert.doesNotMatch(migration, /DROP FUNCTION public\.vd_daily_webhook_terminal_truth_base/);
});
