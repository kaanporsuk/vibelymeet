import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Video Date rebuild PR 4: the Ready Gate family RPCs are single
// self-contained bodies and the historical public generations are dropped.
// These pins hold the migration (and through the re-dumped truth-pin
// fixtures, the live catalog) to the preserved contract.

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260611201927_video_date_ready_gate_single_bodies.sql",
);
const supabaseTypes = read("src/integrations/supabase/types.ts");
const packageJson = read("package.json");
const gateFixture = read(
  "supabase/contract-fixtures/2026-06/functions/public-heads/ready_gate_transition.sql",
);
const markReadyFixture = read(
  "supabase/contract-fixtures/2026-06/functions/public-heads/video_session_mark_ready_v2.sql",
);

const DROPPED_FUNCTIONS = [
  "ready_gate_transition_20260603150106_start_snapshot_base",
  "ready_gate_transition_20260602231752_57014_base",
  "ready_gate_transition_20260524120000_clock_base",
  "ready_gate_transition_20260505214500_result_status_base",
  "ready_gate_transition_20260505203000_registration_desync_base",
  "rgt_preserve_warmup_base_v1",
  "rgt_pre_ready_room_meta_base_v1",
  "ready_gate_transition_20260501200000_event_inactive_base",
  "ready_gate_transition_20260501190000_expiry_rowcount_prior",
  "ready_gate_transition_20260501170000_both_ready_grace_base",
  "ready_gate_transition_20260501135000_observability_base",
  "vd_mark_ready_20260609130139_hot_base",
  "video_session_mark_ready_v2_20260609105249_active_entry_base",
  "vd_mark_ready_both_ready_owner_base",
  "vd_mark_ready_terminal_truth_base",
  "vd_mark_ready_partial_base",
  "video_session_mark_ready_v2_20260608114500_review_comments_base",
  "video_session_mark_ready_v2_20260607123952_routeable_entry_base",
  "video_session_mark_ready_v2_20260606212727_event_cleanup_base",
  "video_session_mark_ready_v2_20260604131708_event_active_base",
  "video_session_mark_ready_v2_20260604104154_grace_base",
  "video_session_mark_ready_v2_20260603150106_start_snapshot_base",
  "vd_ready_gate_actionability_owner_eligibility_base",
] as const;

function functionBody(source: string, name: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `migration must recreate public.${name}`);
  const end = source.indexOf("$function$;", start);
  assert.ok(end > start, `unterminated body for public.${name}`);
  return source.slice(start, end);
}

const gate = functionBody(migration, "ready_gate_transition");
const markReady = functionBody(migration, "video_session_mark_ready_v2");
const actionability = functionBody(migration, "video_date_ready_gate_actionability_v1");

test("signatures, security posture, and grants are unchanged", () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.ready_gate_transition\(\s*p_session_id uuid,\s*p_action text,\s*p_reason text DEFAULT NULL::text\s*\)/,
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.video_session_mark_ready_v2\(\s*p_session_id uuid,\s*p_idempotency_key text DEFAULT NULL::text,\s*p_request_hash text DEFAULT NULL::text\s*\)/,
  );
  // The actionability precheck signature is load-bearing for the daily-room
  // Edge function and video_date_transition.prepare_entry.
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.video_date_ready_gate_actionability_v1\(\s*p_session_id uuid,\s*p_actor_id uuid DEFAULT auth\.uid\(\),\s*p_source text DEFAULT 'video_date_ready_gate_actionability_v1'::text,\s*p_allow_actor_owned_snooze boolean DEFAULT false,\s*p_require_current_ready_gate_registration boolean DEFAULT true,\s*p_terminalize_invalid boolean DEFAULT false,\s*p_lock_rows boolean DEFAULT false\s*\)/,
  );

  for (const [name, args] of [
    ["ready_gate_transition", "uuid, text, text"],
    ["video_session_mark_ready_v2", "uuid, text, text"],
    ["video_date_ready_gate_actionability_v1", "uuid, uuid, text, boolean, boolean, boolean, boolean"],
  ] as const) {
    const escaped = args.replace(/[()]/g, "\\$&");
    assert.match(
      migration,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\(${escaped}\\)\\s+FROM PUBLIC, anon, authenticated, service_role;`,
      ),
      `${name} must revoke before grant`,
    );
    assert.match(
      migration,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${name}\\(${escaped}\\)\\s+TO authenticated, service_role;`,
      ),
      `${name} must stay authenticated + service_role only`,
    );
  }

  const definerCount = migration.match(/SECURITY DEFINER/g)?.length ?? 0;
  assert.equal(definerCount, 3, "exactly the three rewritten functions");
});

test("all 23 historical generations are dropped and never invoked by the new bodies", () => {
  for (const name of DROPPED_FUNCTIONS) {
    assert.match(
      migration,
      new RegExp(`DROP FUNCTION public\\.${name}\\(`),
      `${name} must be dropped`,
    );
  }
  const drops = migration.match(/DROP FUNCTION public\./g)?.length ?? 0;
  assert.equal(drops, DROPPED_FUNCTIONS.length);

  for (const body of [gate, markReady, actionability]) {
    for (const name of DROPPED_FUNCTIONS) {
      assert.ok(
        !body.includes(`public.${name}(`),
        `single body must not call dropped ${name}`,
      );
    }
  }
});

test("dropped generations are out of the generated Supabase types; heads and preserved helpers remain", () => {
  for (const name of DROPPED_FUNCTIONS) {
    assert.ok(
      !supabaseTypes.includes(`${name}: {`),
      `generated types must not expose dropped ${name}`,
    );
  }
  for (const name of [
    "ready_gate_transition",
    "video_session_mark_ready_v2",
    "video_date_ready_gate_actionability_v1",
    "video_date_terminalize_ready_gate_session_v1",
    "video_session_mark_ready_grace_extend_v1",
    "terminalize_event_ready_gates",
    "terminalize_stale_pre_date_ready_gate_blockers",
    "recover_ready_gate_missing_rooms_v1",
  ]) {
    assert.ok(
      supabaseTypes.includes(`${name}: {`),
      `generated types must keep ${name}`,
    );
  }
});

test("raw SQL diagnostics stay out of authenticated client payloads", () => {
  for (const [label, body] of [
    ["ready_gate_transition", gate],
    ["video_session_mark_ready_v2", markReady],
    ["video_date_ready_gate_actionability_v1", actionability],
  ] as const) {
    assert.doesNotMatch(body, /'sqlstate', SQLSTATE/, `${label} must not emit raw sqlstate`);
    assert.doesNotMatch(body, /'sql_message'/, `${label} must not emit raw sql_message`);
    assert.doesNotMatch(body, /'message', v_message/, `${label} must not emit raw message text`);
    assert.match(
      body,
      /video_date_lifecycle_observe_exception_v2/,
      `${label} must observe exceptions server-side`,
    );
  }
});

test("ready_gate_transition single body preserves the pinned machine", () => {
  assert.match(gate, /ready_gate_transition\.single_body_core/);

  // mark_ready bridge onto the idempotent v2 command.
  assert.match(gate, /public\.video_session_mark_ready_v2\(/);
  assert.match(gate, /':phase3:mark_ready:legacy_ready_gate_transition'/);
  assert.match(gate, /'legacy_ready_gate_transition_bridge', true/);

  // Both sync fast paths.
  assert.match(gate, /ready_gate_status IN \('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'\)/);
  assert.match(gate, /ready_gate_status IN \('queued', 'ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'\)/);
  assert.match(gate, /get_video_date_start_snapshot_v1\(p_session_id\)/);
  assert.match(gate, /'startup_snapshot', v_snapshot/);

  // Pre-ready room-metadata repair + event-inactive ownership.
  assert.match(gate, /'pre_ready_room_metadata_repaired'/);
  assert.match(gate, /public\.terminalize_event_ready_gates\(v_session\.event_id, v_inactive_reason\)/);
  assert.match(gate, /'READY_GATE_EVENT_ENDED'/);
  assert.match(gate, /'code', 'EVENT_NOT_ACTIVE'/);

  // Core machine: expire sweep, expiry re-check under lock, snooze, forfeit,
  // terminal idempotency, full observability.
  assert.match(gate, /public\.expire_stale_video_sessions\(\)/);
  assert.match(gate, /IF p_action IN \('mark_ready', 'snooze'\)/);
  assert.match(gate, /'reason', 'ready_gate_expired'/);
  assert.match(gate, /'error', 'stale_transition'/);
  assert.match(gate, /snooze_expires_at = v_now \+ interval '2 minutes'/);
  assert.match(gate, /COALESCE\(p_reason, ended_reason, 'ready_gate_forfeit'\)/);
  assert.match(gate, /'error', 'unknown_action'/);
  assert.match(gate, /record_event_loop_observability/);
  assert.match(gate, /'row_count_checked', true/);

  // Canonical both_ready room re-derivation + registration-desync forfeit.
  assert.match(gate, /'ready_gate_both_ready_canonical_rederive'/);
  assert.match(gate, /'both_ready_canonical_room_metadata_rederived'/);
  assert.match(gate, /vibelyapp\.daily\.co/);
  assert.match(gate, /'ready_gate_registration_desync'/);
  assert.match(gate, /IF NOT \(v_p1_ready_gate AND v_p2_ready_gate\) THEN/);

  // Failure shells: timeout inside the machine, retryable failure at the head.
  assert.match(gate, /WHEN query_canceled OR lock_not_available THEN/);
  assert.match(gate, /'code', 'READY_GATE_TRANSITION_TIMEOUT'/);
  assert.match(gate, /'code', 'READY_GATE_TRANSITION_FAILED'/);
  assert.match(gate, /'retry_after_seconds', 2/);
  assert.match(gate, /'single_body_rpc', true/);

  // The legacy in-chain mark_ready machine is not carried over.
  assert.doesNotMatch(gate, /both_ready_provider_prepare_grace_extended/);
});

test("video_session_mark_ready_v2 single body preserves the decisive command core", () => {
  assert.match(markReady, /video_session_mark_ready_v2\.single_body_core/);

  // Actionability precheck with the exact decisive argument tuple.
  assert.match(
    markReady,
    /video_date_ready_gate_actionability_v1\(\s*p_session_id,\s*v_actor,\s*'video_session_mark_ready_v2',\s*false,\s*true,\s*true,\s*true\s*\)/,
  );
  assert.match(markReady, /'decisive_mark_ready_prechecked', true/);

  // Idempotent command machinery.
  assert.match(markReady, /video_session_command_begin_v2/);
  assert.match(markReady, /video_session_command_finish_v2/);
  assert.match(markReady, /'commandStatus', 'replay'/);
  assert.match(markReady, /'commandStatus', 'replay_rejected'/);
  assert.match(markReady, /'error', 'command_in_progress'/);
  assert.match(markReady, /interval '6 seconds'/);

  // Decisive commit: 45s both-ready grace, deterministic room, ensure-room
  // outbox, observability + session event, auxiliary error accounting.
  assert.match(markReady, /v_now \+ interval '45 seconds'/);
  assert.match(markReady, /'ready_gate_mark_ready_decisive_commit'/);
  assert.match(markReady, /'daily\.ensure_video_date_room'/);
  assert.match(markReady, /'phase3:ensure_room:' \|\| p_session_id::text/);
  assert.match(markReady, /append_video_session_event_v2/);
  assert.match(markReady, /'decisive_mark_ready_commit', true/);
  assert.match(markReady, /'provider_outbox_degraded', jsonb_array_length\(v_auxiliary_errors\) > 0/);

  // Both-ready protection + notifications + enrichment + route owner.
  assert.match(markReady, /video_date_protect_both_ready_entry_v1/);
  assert.match(markReady, /'entry_protection', 'active'/);
  assert.match(markReady, /'category', 'partner_ready'/);
  assert.match(markReady, /'category', 'date_starting'/);
  assert.match(markReady, /video_date_lifecycle_enrich_and_sanitize_payload_v2/);
  assert.match(markReady, /video_date_both_ready_route_payload_v1/);
  assert.match(markReady, /'video_session_mark_ready_v2\.both_ready_owner'/);

  // Failure shells and codes.
  assert.match(markReady, /'code', 'READY_GATE_TRANSITION_TIMEOUT'/);
  assert.match(markReady, /'code', 'MARK_READY_FAILED'/);
  assert.match(markReady, /'MARK_READY_UNAVAILABLE'/);
  assert.match(markReady, /'MARK_READY_ENRICHMENT_FAILED'/);
  assert.match(markReady, /'MARK_READY_WRAPPER_FAILED'/);
  assert.match(markReady, /'hot_path_no_throw_shell', true/);
  assert.match(markReady, /'active_entry_failsoft_shell', true/);
  assert.match(markReady, /'outer_last_resort_payload', true/);
});

test("actionability single body preserves the owner-eligibility matrix and route wrap", () => {
  assert.match(actionability, /video_date_ready_gate_actionability_v1\.single_body_core/);
  for (const code of [
    "AUTH_REQUIRED",
    "SESSION_NOT_FOUND",
    "ACCESS_DENIED",
    "SESSION_ENDED",
    "READY_GATE_NOT_OPEN",
    "PARTNER_SNOOZED",
    "READY_GATE_SNOOZED",
    "READY_GATE_NOT_READY",
    "READY_GATE_STATUS_TIMESTAMP_DESYNC",
    "READY_GATE_EXPIRED",
    "EVENT_ACTIVE_CHECK_UNAVAILABLE",
    "EVENT_NOT_ACTIVE",
    "SAFETY_CHECK_UNAVAILABLE",
    "BLOCKED_PAIR",
    "REPORTED_PAIR",
    "READY_GATE_REGISTRATION_DESYNC",
    "READY_GATE_ACTIONABILITY_UNAVAILABLE",
  ]) {
    assert.match(actionability, new RegExp(`'${code}'`), `matrix code ${code}`);
  }

  // both_ready survives an elapsed gate while the prepare-entry lease is open.
  assert.match(
    actionability,
    /v_status = 'both_ready'\s+AND v_session\.prepare_entry_expires_at IS NOT NULL\s+AND v_session\.prepare_entry_expires_at > v_now/,
  );
  assert.match(actionability, /video_date_terminalize_ready_gate_session_v1/);
  assert.match(actionability, /video_date_participant_eligibility_v1/);
  assert.match(actionability, /video_date_both_ready_route_payload_v1/);
  assert.match(actionability, /'non_ready_gate_owned', true/);
  assert.match(actionability, /'invalid_eligibility_role', v_invalid_role/);
});

test("already-single-body maintenance helpers are untouched by this migration", () => {
  for (const name of [
    "terminalize_event_ready_gates",
    "terminalize_stale_pre_date_ready_gate_blockers",
    "recover_ready_gate_missing_rooms_v1",
    "video_date_terminalize_ready_gate_session_v1",
    "video_session_mark_ready_grace_extend_v1",
    "handle_event_ready_gate_terminalization",
    "persist_ready_gate_suppression_v2",
  ]) {
    assert.ok(
      !migration.includes(`CREATE OR REPLACE FUNCTION public.${name}(`),
      `${name} must not be redefined here`,
    );
    assert.ok(
      !migration.includes(`DROP FUNCTION public.${name}(`),
      `${name} must not be dropped here`,
    );
  }
});

test("re-dumped truth-pin head fixtures carry the single-body markers", () => {
  assert.match(gateFixture, /ready_gate_transition\.single_body_core/);
  assert.doesNotMatch(gateFixture, /ready_gate_transition_20260603150106_start_snapshot_base/);
  assert.match(markReadyFixture, /video_session_mark_ready_v2\.single_body_core/);
  assert.doesNotMatch(markReadyFixture, /vd_mark_ready_20260609130139_hot_base/);
});

test("contract suite wiring includes these pins in v4 and red-flag batteries", () => {
  const wiring = /videoDateReadyGateSingleBodyContracts\.test\.ts/g;
  const hits = packageJson.match(wiring)?.length ?? 0;
  assert.ok(hits >= 2, "must run in test:video-date-v4 and test:video-date:red-flags");
});
