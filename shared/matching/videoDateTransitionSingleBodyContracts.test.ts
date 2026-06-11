import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Video Date rebuild PR 2: public.video_date_transition becomes a single
// self-contained body and the private_video_date delegation chain is dropped.
// These pins hold the migration to the effective contract reconstructed from
// the PR-1 truth-pin fixtures (supabase/contract-fixtures/2026-06/).

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260611175511_video_date_transition_single_body.sql",
);

// The function body proper: CREATE FUNCTION through its dollar-quoted
// terminator (the COMMENT and DROP statements after it legitimately name
// private_video_date).
const functionBody = migration.slice(
  migration.indexOf("CREATE OR REPLACE FUNCTION public.video_date_transition"),
  migration.indexOf("$function$;") + "$function$;".length,
);

const PRIVATE_CHAIN_FUNCTIONS = [
  "vdt_current_base",
  "vdt_hot_path_no_throw",
  "vdt_active_entry_failsoft",
  "vdt_both_ready_owner",
  "vdt_partial_ready_gate",
  "vdt_last_resort",
  "vdt_definitive_owner",
  "vdt_terminal_lifecycle",
  "vdt_routeable_entry",
  "vdt_single_owner",
  "vdt_lifecycle_presence",
  "vdt_latest_presence",
  "vdt_warmup_stability",
  "vdt_failsoft_base",
  "vdt_remote_seen",
  "vdt_prepare_payload",
  "vdt_prepare_lease",
  "vdt_survey_continuity",
  "vdt_deadline",
  "vdt_event_inactive",
  "vdt_peer_missing_end",
  "vdt_provider_atomic_entry",
  "vdt_prepare_entry_prewarm",
  "vdt_pre_date_end_cleanup",
  "vdt_core_legacy_01",
] as const;

test("single-body migration preserves the public signature, grants, and search_path", () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.video_date_transition\(\s*p_session_id uuid,\s*p_action text,\s*p_reason text DEFAULT NULL\s*\)/,
  );
  assert.match(migration, /RETURNS jsonb\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path TO 'public', 'pg_catalog'/);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.video_date_transition\(uuid, text, text\)\s+FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.video_date_transition\(uuid, text, text\)\s+TO authenticated, service_role/,
  );
  assert.match(migration, /NOTIFY pgrst, 'reload schema'/);
});

test("single body keeps entry aliases and the pinned enter_handshake rejection", () => {
  assert.match(functionBody, /WHEN 'complete_entry' THEN 'complete_handshake'/);
  assert.match(functionBody, /WHEN 'continue_entry' THEN 'continue_handshake'/);

  assert.match(functionBody, /'code', 'ENTER_HANDSHAKE_REMOVED'/);
  assert.match(functionBody, /'error', 'standalone_enter_handshake_removed'/);
  assert.match(functionBody, /'supported_action', 'prepare_entry'/);
  assert.match(functionBody, /'entry_command', 'prepare_date_entry'/);
  assert.match(functionBody, /'prepare_entry_required', true/);
  const rejectionStart = functionBody.indexOf("IF v_action = 'enter_handshake' THEN");
  const rejection = functionBody.slice(rejectionStart, functionBody.indexOf("END IF;", rejectionStart));
  assert.match(rejection, /'retryable', false/);
  assert.match(rejection, /'terminal', false/);
});

test("single body contains no private_video_date delegation", () => {
  assert.doesNotMatch(functionBody, /private_video_date/);
});

test("prepare_entry stays preflight-only with actionability, protection, lease, and event-inactive ordering", () => {
  // Actionability precheck before everything else.
  assert.match(functionBody, /video_date_ready_gate_actionability_v1\(\s*p_session_id,\s*v_actor,\s*'video_date_transition\.prepare_entry',\s*false,\s*true,\s*true,\s*true\s*\)/);
  // Prepare-lease protection with the entry_attempt reason channel.
  assert.match(functionBody, /FROM '\^entry_attempt:\(\.\+\)\$'/);
  assert.match(functionBody, /video_date_protect_both_ready_entry_v1\(\s*p_session_id,\s*v_actor,\s*v_attempt_id,\s*'video_date_transition_prepare_entry'\s*\)/);
  assert.match(functionBody, /'SESSION_NOT_FOUND', 'SESSION_ENDED', 'ACCESS_DENIED', 'EVENT_INACTIVE'/);
  // 90 second lease on a virgin both_ready gate only.
  assert.match(functionBody, /v_now \+ interval '90 seconds'/);
  assert.match(functionBody, /'prepare_entry_lease_started'/);
  assert.match(functionBody, /'prepare_entry_lease_refreshed'/);
  assert.match(functionBody, /'routeable', false/);
  // Event-inactive block.
  assert.match(functionBody, /get_event_lobby_inactive_reason/);
  assert.match(functionBody, /terminalize_event_ready_gates/);
  assert.match(functionBody, /'error_code', 'EVENT_NOT_ACTIVE'/);
  // Preflight semantics: success mutates nothing and says so.
  assert.match(functionBody, /'preflight_only', true/);
  assert.match(functionBody, /'registration_status', 'deferred_until_confirm_prepare_entry'/);
  assert.match(functionBody, /'prepare_entry_preflight_ok'/);
  assert.match(functionBody, /'prepare_entry_preflight_already_active'/);
  // Rejection vocabulary preserved.
  for (const code of ["'READY_GATE_NOT_READY'", "'BLOCKED_PAIR'", "'RECONNECT_SYNC_REQUIRED'", "'SESSION_ENDED'"]) {
    assert.match(functionBody, new RegExp(code), `prepare_entry must keep ${code}`);
  }
});

test("complete_handshake and late vibe/pass delegate to the handshake deadline finalizer", () => {
  assert.match(functionBody, /finalize_video_date_handshake_deadline\(\s*p_session_id,\s*v_actor,\s*'rpc_complete_handshake',\s*p_reason\s*\)/);
  assert.match(functionBody, /'late_' \|\| v_delegate_action \|\| '_after_handshake_deadline'/);
  assert.match(functionBody, /handshake_started_at \+ interval '60 seconds' <= now\(\)/);
});

test("presence suppression layers keep their evidence vocabulary", () => {
  // Self-away suppression reasons and evidence channels.
  for (const reason of ["'web_visibilitychange'", "'web_freeze'", "'web_beforeunload'", "'web_pagehide'", "'app_background'"]) {
    assert.match(functionBody, new RegExp(reason), `self-away suppression must include ${reason}`);
  }
  assert.match(functionBody, /video_date_latest_presence_is_active/);
  assert.match(functionBody, /video_date_surface_claims/);
  assert.match(functionBody, /'suppression_reason', 'active_daily_presence'/);
  assert.match(functionBody, /bump_video_session_seq/);
  // Partner-away suppression honours the transport grace channel.
  assert.match(functionBody, /'daily_transport_grace_expired'/);
  assert.match(functionBody, /'suppression_reason', 'daily_transport_grace_required'/);
  assert.match(functionBody, /interval '20 seconds'/);
});

test("terminal survey truth stays v2 and the unconfirmed-date guard is preserved", () => {
  assert.match(functionBody, /video_date_session_is_post_date_survey_eligible_v2/);
  // The superseded v1 eligibility pass must not come back.
  assert.doesNotMatch(functionBody, /video_date_session_is_post_date_survey_eligible\(/);
  assert.match(functionBody, /'survey_required', v_should_open_survey/);
  assert.match(functionBody, /queue_status = 'in_survey'/);
  assert.match(functionBody, /video_date_session_has_confirmed_encounter/);
  assert.match(functionBody, /end_unconfirmed_video_date_start/);
  assert.match(functionBody, /'transition_' \|\| COALESCE\(NULLIF\(v_delegate_action, ''\), 'unknown'\)/);
});

test("end keeps partial-join peer timeout and pre-date cleanup vocabulary", () => {
  assert.match(functionBody, /'partial_join_peer_timeout', 'peer_missing_timeout'/);
  assert.match(functionBody, /'partial_join_peer_manual_end'/);
  assert.match(functionBody, /'ended_from_client'/);
  assert.match(functionBody, /'pre_date_manual_end'/);
  assert.match(functionBody, /'date_end_survey'/);
  assert.match(functionBody, /'pre_date_end_cleanup'/);
  for (const reason of [
    "'ready_gate_forfeit'",
    "'ready_gate_expired'",
    "'queued_ttl_expired'",
    "'handshake_not_mutual'",
    "'handshake_grace_expired'",
    "'handshake_timeout'",
    "'blocked_pair'",
    "'reconnect_grace_expired'",
  ]) {
    assert.match(functionBody, new RegExp(reason), `pre-date end must keep ${reason}`);
  }
});

test("failure payloads stay retryable JSON without raw SQL diagnostics", () => {
  assert.match(functionBody, /'code', 'VIDEO_DATE_TRANSITION_FAILED'/);
  assert.match(functionBody, /'retryable', SQLSTATE IS DISTINCT FROM '42501'/);
  assert.match(functionBody, /'retry_after_ms', 1500/);
  assert.match(functionBody, /'retry_after_seconds', 2/);
  assert.match(functionBody, /video_date_lifecycle_observe_exception_v2/);
  assert.match(functionBody, /video_date_lifecycle_exception_payload_v2/);
  // Raw diagnostics never enter client payloads from this body.
  assert.doesNotMatch(functionBody, /'sqlstate',/);
  assert.doesNotMatch(functionBody, /'sql_message',/);
  // Dual-cased server clock keys survive.
  assert.match(functionBody, /'server_now_ms', floor\(extract\(epoch from clock_timestamp\(\)\) \* 1000\)::bigint/);
  assert.match(functionBody, /'serverNowMs', floor\(extract\(epoch from clock_timestamp\(\)\) \* 1000\)::bigint/);
});

test("the enrichment pipeline and shell markers are preserved in chain order", () => {
  const firstEnrich = functionBody.indexOf("video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result)");
  const secondEnrich = functionBody.indexOf("video_date_enrich_lifecycle_payload_v1(p_session_id, v_actor, v_result)", firstEnrich + 1);
  const sanitizeV1 = functionBody.indexOf("video_date_lifecycle_sanitize_client_failsoft_payload_v1(v_result)");
  const enrichSanitizeV2 = functionBody.lastIndexOf("video_date_lifecycle_enrich_and_sanitize_payload_v2(");
  const routePayload = functionBody.indexOf("video_date_both_ready_route_payload_v1(");
  assert.ok(firstEnrich > 0 && secondEnrich > firstEnrich, "enrich v1 must run twice (definitive + last_resort)");
  assert.ok(sanitizeV1 > secondEnrich, "sanitize v1 must follow the v1 enrichment");
  assert.ok(enrichSanitizeV2 > sanitizeV1, "enrich+sanitize v2 must follow sanitize v1");
  assert.ok(routePayload > 0, "route payload wrapper must be present");

  assert.match(functionBody, /'video_date_transition\.both_ready_owner'/);
  assert.match(functionBody, /'ready_gate_actionability_checked', v_norm_action = 'prepare_entry'/);
  assert.match(functionBody, /'both_ready_route_owner_checked', v_norm_action = 'prepare_entry'/);
  for (const marker of [
    "'active_entry_failsoft_shell', true",
    "'hot_path_no_throw_shell', true",
    "'standalone_enter_handshake_removed_shell', true",
    "'flattened_public_shell', true",
    "'single_body_rpc', true",
  ]) {
    assert.match(functionBody, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `marker ${marker} must be present`);
  }
});

test("the migration drops every private chain generation and the schema itself", () => {
  for (const fn of PRIVATE_CHAIN_FUNCTIONS) {
    assert.match(
      migration,
      new RegExp(`DROP FUNCTION private_video_date\\.${fn}\\(uuid, text, text\\);`),
      `${fn} must be dropped`,
    );
  }
  assert.match(migration, /DROP SCHEMA private_video_date;/);
  // No CASCADE: the schema must already be empty when dropped.
  assert.doesNotMatch(migration, /DROP SCHEMA private_video_date CASCADE/);
});

test("single-body flattening is scoped to the video_date_transition family", () => {
  assert.doesNotMatch(migration, /ready_gate_transition_/);
  assert.doesNotMatch(migration, /video_session_mark_ready_v2_/);
  assert.doesNotMatch(migration, /handle_swipe_/);
  assert.doesNotMatch(migration, /submit_post_date_verdict/);
});
