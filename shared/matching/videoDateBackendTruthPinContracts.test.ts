import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Truth pin for the 2026-06 Video Date backend rebuild (PR 1 of the staged
// re-foundation). Unlike the other contract suites, these tests pin against
// supabase/contract-fixtures/2026-06/ — raw pg_get_functiondef() dumps of the
// LIVE catalog — not against migration files, so drift between migration
// history and live state cannot silently weaken the pinned contract. Later
// rebuild PRs must keep these observable JSON contracts intact or update the
// fixtures + pins explicitly in the same change.

const root = process.cwd();
const fixtureRoot = "supabase/contract-fixtures/2026-06";
const read = (path: string) => readFileSync(join(root, path), "utf8");
const fixture = (path: string) => read(join(fixtureRoot, path));

const PRIVATE_VIDEO_DATE_FUNCTIONS = [
  "vdt_active_entry_failsoft",
  "vdt_both_ready_owner",
  "vdt_core_legacy_01",
  "vdt_current_base",
  "vdt_deadline",
  "vdt_definitive_owner",
  "vdt_event_inactive",
  "vdt_failsoft_base",
  "vdt_hot_path_no_throw",
  "vdt_last_resort",
  "vdt_latest_presence",
  "vdt_lifecycle_presence",
  "vdt_partial_ready_gate",
  "vdt_peer_missing_end",
  "vdt_pre_date_end_cleanup",
  "vdt_prepare_entry_prewarm",
  "vdt_prepare_lease",
  "vdt_prepare_payload",
  "vdt_provider_atomic_entry",
  "vdt_remote_seen",
  "vdt_routeable_entry",
  "vdt_single_owner",
  "vdt_survey_continuity",
  "vdt_terminal_lifecycle",
  "vdt_warmup_stability",
] as const;

const PUBLIC_HEAD_FUNCTIONS = [
  "claim_video_date_surface",
  "confirm_video_date_entry_prepared",
  "expire_stale_video_sessions",
  "finalize_video_date_entry_deadline",
  "finalize_video_date_handshake_deadline",
  "mark_video_date_daily_alive",
  "mark_video_date_daily_joined",
  "mark_video_date_remote_seen",
  "ready_gate_transition",
  "release_video_date_surface_claim",
  "submit_post_date_verdict_v3",
  "video_date_transition",
  "video_session_date_timeout_v2",
  "video_session_forfeit_v2",
  "video_session_handshake_auto_promote_v2",
  "video_session_mark_ready_v2",
] as const;

test("2026-06 truth-pin fixture inventory is complete and reference-only", () => {
  for (const fn of PRIVATE_VIDEO_DATE_FUNCTIONS) {
    const path = join(root, fixtureRoot, "functions/private_video_date", `${fn}.sql`);
    assert.ok(existsSync(path), `missing private_video_date fixture ${fn}.sql`);
  }
  for (const fn of PUBLIC_HEAD_FUNCTIONS) {
    const path = join(root, fixtureRoot, "functions/public-heads", `${fn}.sql`);
    assert.ok(existsSync(path), `missing public-head fixture ${fn}.sql`);
  }
  for (const snapshot of [
    "snapshots/public_archived_functions_manifest.json",
    "snapshots/cron_jobs.json",
    "snapshots/video_sessions_triggers.sql",
    "snapshots/video_sessions_columns.json",
  ]) {
    assert.ok(existsSync(join(root, fixtureRoot, snapshot)), `missing snapshot ${snapshot}`);
  }

  const readme = fixture("README.md");
  assert.match(readme, /Reference only\. Never executable\. Never deployed\./);
  assert.match(readme, /schdyxcunwcvddlcshwd/);
});

test("archived public function manifest pins 91 dated functions by name, args, and body hash", () => {
  const manifest = JSON.parse(fixture("snapshots/public_archived_functions_manifest.json")) as Array<{
    proname: string;
    args: string;
    def_md5: string;
  }>;
  assert.equal(manifest.length, 91);
  for (const row of manifest) {
    assert.match(row.proname, /_20[0-9]{6}/, `${row.proname} should be a dated archive name`);
    assert.match(row.def_md5, /^[0-9a-f]{32}$/, `${row.proname} should pin an md5 body hash`);
    assert.equal(typeof row.args, "string");
  }
});

test("cron snapshot pins the Video Date scheduler surface", () => {
  const jobs = JSON.parse(fixture("snapshots/cron_jobs.json")) as Array<{
    jobname: string;
    schedule: string;
    command: string;
    active: boolean;
  }>;
  const byName = new Map(jobs.map((job) => [job.jobname, job]));

  for (const required of [
    "expire-stale-video-sessions",
    "expire-video-date-reconnect-graces",
    "video-date-outbox-drainer",
    "video-date-deadline-finalizer",
    "video-date-room-cleanup",
    "video-date-orphan-room-cleanup",
    "video-date-recovery-alert-dispatcher",
    "synthetic-video-date-monitor",
    "daily-room-keepwarm",
    "post-date-verdict-reminders",
    "post-date-half-verdict-timeout-detection",
  ]) {
    const job = byName.get(required);
    assert.ok(job, `cron snapshot must include ${required}`);
    assert.equal(job?.active, true, `${required} should be active`);
  }

  assert.match(byName.get("expire-stale-video-sessions")?.command ?? "", /public\.expire_stale_video_sessions\(\)/);
  assert.equal(byName.get("expire-stale-video-sessions")?.schedule, "* * * * *");
  assert.match(byName.get("video-date-outbox-drainer")?.command ?? "", /video-date-outbox-drainer/);
  assert.match(byName.get("video-date-deadline-finalizer")?.command ?? "", /video-date-deadline-finalizer/);
});

test("video_sessions trigger snapshot pins the four live triggers", () => {
  const triggers = fixture("snapshots/video_sessions_triggers.sql");
  assert.match(triggers, /CREATE TRIGGER emit_video_date_match_eta_hint_v2 AFTER UPDATE OF ready_gate_status/);
  assert.match(
    triggers,
    /CREATE TRIGGER enforce_one_active_video_session_before_write BEFORE INSERT OR UPDATE OF participant_1_id, participant_2_id, ended_at, state, phase/,
  );
  assert.match(triggers, /EXECUTE FUNCTION enforce_one_active_video_session\(\)/);
  assert.match(triggers, /CREATE TRIGGER trg_video_sessions_terminal_audit_stamp BEFORE INSERT OR UPDATE/);
  assert.match(
    triggers,
    /CREATE TRIGGER video_session_refund_on_end AFTER UPDATE OF ended_reason[\s\S]*new\.refund_status IS NULL/,
  );
});

test("video_sessions column snapshot pins the server-owned truth columns", () => {
  const columns = JSON.parse(fixture("snapshots/video_sessions_columns.json")) as Array<{
    column_name: string;
    is_nullable: string;
    column_default: string | null;
  }>;
  const byName = new Map(columns.map((column) => [column.column_name, column]));

  for (const required of [
    "id",
    "event_id",
    "participant_1_id",
    "participant_2_id",
    "state",
    "phase",
    "ready_gate_status",
    "daily_room_name",
    "daily_room_url",
    "handshake_started_at",
    "date_started_at",
    "ended_at",
    "ended_reason",
    "prepare_entry_started_at",
    "prepare_entry_expires_at",
  ]) {
    assert.ok(byName.has(required), `video_sessions snapshot must include ${required}`);
  }

  assert.equal(byName.get("state")?.column_default, "'ready_gate'::video_date_state");
  assert.equal(byName.get("phase")?.column_default, "'ready_gate'::text");
  assert.equal(byName.get("ready_gate_status")?.column_default, "'waiting'::text");
});

test("video_date_transition head pins entry aliases and the enter_handshake rejection payload", () => {
  const head = fixture("functions/public-heads/video_date_transition.sql");

  assert.match(
    head,
    /CREATE OR REPLACE FUNCTION public\.video_date_transition\(p_session_id uuid, p_action text, p_reason text DEFAULT NULL::text\)/,
  );
  assert.match(head, /SECURITY DEFINER/);
  assert.match(head, /SET search_path TO 'public', 'pg_catalog'/);

  // PR-5 vocabulary flip: entry names are canonical; legacy handshake action
  // names stay accepted as aliases. (The fixture pinned the pre-flip
  // direction until the 2026-06-12 acceptance-follow-up re-dump.)
  assert.match(head, /WHEN 'complete_handshake' THEN 'complete_entry'/);
  assert.match(head, /WHEN 'continue_handshake' THEN 'continue_entry'/);
  // Rebuild PR 2: the head is a single body; the private chain is gone and
  // the fixture was re-dumped from live after that migration (and again on
  // 2026-06-12 for the terminal in_survey feedback guard).
  assert.doesNotMatch(head, /private_video_date/);
  assert.match(head, /'single_body_rpc', true/);

  // Standalone enter_handshake is a stable non-terminal, non-retryable rejection.
  assert.match(head, /'code', 'ENTER_HANDSHAKE_REMOVED'/);
  assert.match(head, /'error', 'standalone_enter_handshake_removed'/);
  assert.match(head, /'supported_action', 'prepare_entry'/);
  assert.match(head, /'entry_command', 'prepare_date_entry'/);
  assert.match(head, /'prepare_entry_required', true/);
  const rejectionStart = head.indexOf("IF v_action = 'enter_handshake' THEN");
  const rejection = head.slice(rejectionStart, head.indexOf("END IF;", rejectionStart));
  assert.match(rejection, /'retryable', false/);
  assert.match(rejection, /'terminal', false/);

  // Failure shells stay retryable JSON with dual-cased server clock keys.
  assert.match(head, /'code', 'VIDEO_DATE_TRANSITION_FAILED'/);
  assert.match(head, /'retryable', true/);
  assert.match(head, /'flattened_public_shell', true/);
  assert.match(head, /'hot_path_no_throw_shell', true/);
  assert.match(head, /'server_now_ms', floor\(extract\(epoch from clock_timestamp\(\)\) \* 1000\)::bigint/);
  assert.match(head, /'serverNowMs', floor\(extract\(epoch from clock_timestamp\(\)\) \* 1000\)::bigint/);
});

test("prepare_entry lease layer pins both_ready-only leasing and the 90 second window", () => {
  const lease = fixture("functions/private_video_date/vdt_prepare_payload.sql");

  assert.match(lease, /IF p_action IS DISTINCT FROM 'prepare_entry' THEN/);
  assert.match(lease, /FROM '\^entry_attempt:\(\.\+\)\$'/);
  assert.match(lease, /v_now \+ interval '90 seconds'/);
  assert.match(lease, /ready_gate_status = 'both_ready'/);
  assert.match(lease, /AND daily_room_name IS NULL\s+AND daily_room_url IS NULL/);
  assert.match(lease, /'prepare_entry_lease_started'/);
  assert.match(lease, /'prepare_entry_lease_refreshed'/);
  assert.match(lease, /'routeable', false/);
});

test("forfeit truth: video_session_forfeit_v2 normalizes vocabulary and delegates to ready_gate_transition", () => {
  const forfeit = fixture("functions/public-heads/video_session_forfeit_v2.sql");

  assert.match(
    forfeit,
    /IF v_reason NOT IN \('ready_gate_forfeit', 'not_now', 'timeout', 'skip', 'user_exit', 'manual_exit'\) THEN/,
  );
  assert.match(forfeit, /v_reason := 'ready_gate_forfeit'/);
  assert.match(forfeit, /p_session_id::text \|\| ':phase3:forfeit'/);
  assert.match(forfeit, /public\.ready_gate_transition\(p_session_id, 'forfeit', v_reason\)/);
  assert.match(forfeit, /'error', 'not_authenticated'/);
  assert.match(forfeit, /'error', 'command_in_progress'/);
  assert.match(forfeit, /'error', 'session_not_found'/);
  assert.match(forfeit, /'commandStatus', CASE WHEN v_success THEN 'committed' ELSE 'rejected' END/);
});

test("date_timeout truth: video_session_date_timeout_v2 pins guards and not-due soft success", () => {
  const timeout = fixture("functions/public-heads/video_session_date_timeout_v2.sql");

  assert.match(timeout, /p_session_id::text \|\| ':phase3:date_timeout'/);
  assert.match(timeout, /jsonb_build_object\('action', 'date_timeout'\)/);
  assert.match(timeout, /'error', 'not_authenticated'/);
  assert.match(timeout, /'error', 'session_not_found'/);
  assert.match(timeout, /'error', 'not_participant'/);
  // A timeout request before the date is actually due is a soft success, not an error.
  const notDueIndex = timeout.indexOf("'reason', 'date_timeout_not_due'");
  assert.ok(notDueIndex > 0, "date_timeout_not_due reason must be pinned");
  assert.match(timeout.slice(Math.max(0, notDueIndex - 400), notDueIndex), /'success', true/);
  assert.match(timeout, /'error', 'command_in_progress'/);
});

test("evidence truth: mark_video_date_remote_seen pins render-evidence vocabulary and retryable rejection", () => {
  const remoteSeen = fixture("functions/public-heads/mark_video_date_remote_seen.sql");

  assert.match(
    remoteSeen,
    /'loadeddata',\s+'playing',\s+'remote_track_mounted',\s+'first_remote_frame',\s+'request_video_frame_callback'/,
  );
  assert.match(remoteSeen, /video_date_session_lifecycle_eligibility_v1\(/);
  assert.match(remoteSeen, /video_date_lifecycle_enrich_and_sanitize_payload_v2\(/);
  assert.match(remoteSeen, /'code', 'REMOTE_SEEN_RENDER_EVIDENCE_REQUIRED'/);
  assert.match(remoteSeen, /'retry_after_ms', 1500/);
  assert.match(remoteSeen, /'remote_seen_stamp_accepted', false/);
  assert.match(remoteSeen, /'render_evidence_required', true/);
  assert.match(remoteSeen, /'render_evidence_accepted', true/);
  // Rebuild PR 3: the render/provider-proof chain is inlined into the head.
  assert.match(remoteSeen, /'remote_seen_rejected_stale_provider_session', true/);
  assert.match(remoteSeen, /mark_video_date_remote_seen\.single_body_core/);
  assert.match(remoteSeen, /'REMOTE_SEEN_STAMP_FAILED'/);
});

test("evidence truth: daily joined/alive heads pin provider-presence failure payloads", () => {
  const joined = fixture("functions/public-heads/mark_video_date_daily_joined.sql");
  const alive = fixture("functions/public-heads/mark_video_date_daily_alive.sql");

  assert.match(joined, /p_owner_state text DEFAULT 'joined'::text/);
  // Rebuild PR 3: joined delegates to the canonical heartbeat owner.
  assert.match(joined, /public\.mark_video_date_daily_alive\(/);
  assert.match(joined, /'joined_delegated_to_daily_alive', true/);
  assert.match(joined, /'code', 'DAILY_JOIN_STAMP_FAILED'/);
  assert.match(joined, /'join_stamp_accepted', false/);

  assert.match(alive, /p_owner_state text DEFAULT NULL::text/);
  // Rebuild PR 3: eligibility + provider proof prechecks are inlined.
  assert.match(alive, /video_date_session_lifecycle_eligibility_v1\(/);
  assert.match(alive, /video_date_current_provider_session_proof_v1\(/);
  assert.match(alive, /'code', 'DAILY_ALIVE_FAILED'/);

  for (const [name, head] of [
    ["joined", joined],
    ["alive", alive],
  ] as const) {
    assert.match(head, /'retryable', true/, `${name} failure payload must stay retryable`);
    assert.match(head, /'terminal', false/, `${name} failure payload must stay non-terminal`);
    assert.match(head, /'provider_presence_required', true/, `${name} must pin provider presence requirement`);
    assert.match(head, /'provider_backed_current', false/, `${name} must pin provider-backed-current false on failure`);
    assert.match(head, /'provider_presence_missing', true/, `${name} must pin provider-presence-missing on failure`);
    assert.match(head, /'hot_path_no_throw_shell', true/, `${name} must keep the no-throw shell marker`);
  }
});

test("surface truth: claim/release pin defaults, failsoft, and own-claim-only release", () => {
  const claim = fixture("functions/public-heads/claim_video_date_surface.sql");
  const release = fixture("functions/public-heads/release_video_date_surface_claim.sql");

  assert.match(claim, /p_takeover boolean DEFAULT false, p_ttl_seconds integer DEFAULT 12/);
  // Rebuild PR 3: the claim chain is inlined; the terminal-truth audit stays.
  assert.match(claim, /'claim_terminal_audit'/);
  assert.match(claim, /'code', 'SURFACE_CLAIM_CONFLICT'/);
  assert.match(claim, /'code', 'SURFACE_CLAIM_FAILED'/);
  assert.match(claim, /'retryable', true/);
  assert.match(claim, /'terminal', false/);

  assert.match(release, /'code', 'UNAUTHORIZED', 'error', 'not_authenticated'/);
  assert.match(release, /WHERE profile_id = v_uid\s+AND session_id = p_session_id\s+AND client_instance_id = v_client_instance_id\s+AND released_at IS NULL/);
  assert.match(release, /released_at = COALESCE\(released_at, v_now\)/);
  assert.match(release, /jsonb_build_object\('success', true, 'released', v_count\)/);
});

test("ready_gate_transition pins the sync fast path, mark_ready bridge, and retryable failure payload", () => {
  const gate = fixture("functions/public-heads/ready_gate_transition.sql");

  // mark_ready is a bridge onto the idempotent v2 command.
  assert.match(gate, /public\.video_session_mark_ready_v2\(/);
  assert.match(gate, /':phase3:mark_ready:legacy_ready_gate_transition'/);
  assert.match(gate, /'legacy_ready_gate_transition_bridge', true/);

  // sync fast path only serves live, participant-owned gates; both_ready is expiry-exempt.
  assert.match(gate, /ready_gate_status IN \('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'\)/);
  assert.match(gate, /OR v_session\.ready_gate_status = 'both_ready'/);
  assert.match(gate, /get_video_date_start_snapshot_v1\(p_session_id\)/);
  assert.match(gate, /v_snapshot->>'inactive_reason', v_snapshot->>'inactiveReason'/);
  for (const key of ["'status'", "'ready_gate_status'", "'result_status'", "'result_ready_gate_status'", "'startup_snapshot'"]) {
    assert.match(gate, new RegExp(`${key}, v_(status|snapshot)`), `sync payload must pin ${key}`);
  }

  // Rebuild PR 4: the generation chain is inlined; the head is a single body.
  assert.match(gate, /ready_gate_transition\.single_body_core/);
  assert.doesNotMatch(gate, /ready_gate_transition_20260603150106_start_snapshot_base/);

  assert.match(gate, /'code', 'READY_GATE_TRANSITION_FAILED'/);
  assert.match(gate, /'retryable', true/);
  assert.match(gate, /'retry_after_seconds', 2/);
  assert.match(gate, /'retry_after_ms', 2000/);
});

test("video_session_mark_ready_v2 pins the hot base delegation and rejected command shells", () => {
  const markReady = fixture("functions/public-heads/video_session_mark_ready_v2.sql");

  assert.match(
    markReady,
    /CREATE OR REPLACE FUNCTION public\.video_session_mark_ready_v2\(p_session_id uuid, p_idempotency_key text DEFAULT NULL::text, p_request_hash text DEFAULT NULL::text\)/,
  );
  // Rebuild PR 4: the hot-base chain is inlined; the head is a single body.
  assert.match(markReady, /video_session_mark_ready_v2\.single_body_core/);
  assert.doesNotMatch(markReady, /vd_mark_ready_20260609130139_hot_base/);
  assert.match(markReady, /'code', 'MARK_READY_UNAVAILABLE'/);
  assert.match(markReady, /'retryable', true/);
  assert.match(markReady, /'commandStatus', 'rejected'/);
  assert.match(markReady, /'hot_path_no_throw_shell', true/);
});

test("verdict truth: submit_post_date_verdict_v3 pins idempotency, terminal vocabulary, and command result", () => {
  const verdict = fixture("functions/public-heads/submit_post_date_verdict_v3.sql");

  assert.match(
    verdict,
    /CREATE OR REPLACE FUNCTION public\.submit_post_date_verdict_v3\(p_session_id uuid, p_liked boolean, p_idempotency_key text, p_safety_report jsonb DEFAULT NULL::jsonb, p_request_hash text DEFAULT NULL::text\)/,
  );

  // Idempotency vocabulary.
  assert.match(verdict, /'error', 'invalid_idempotency_key'/);
  assert.match(verdict, /ON CONFLICT \(actor_id, idempotency_key\) DO NOTHING/);
  assert.match(verdict, /'error', 'idempotency_key_missing'/);
  assert.match(verdict, /'error', 'idempotency_key_conflict'/);

  // Terminal vocabulary.
  assert.match(verdict, /'code', 'session_not_survey_eligible'/);
  assert.match(verdict, /'code', 'blocked_pair'/);
  assert.match(verdict, /'verdict_recorded', false/);
  assert.match(verdict, /'verdict_recorded', true/);
  assert.match(verdict, /'already_submitted', v_already_submitted/);

  // Actor-visible command result enrichment.
  assert.match(verdict, /'backend_version', 'v3'/);
  assert.match(verdict, /'commandStatus', CASE WHEN v_success THEN 'committed' ELSE 'rejected' END/);
  assert.match(verdict, /'commandId', v_command_id/);
  assert.match(verdict, /'requestHash', v_begin->>'requestHash'/);

  // Mutuality requires both liked verdicts and no block/report between the pair.
  assert.match(verdict, /v_confirmed_mutual := v_actor_liked AND v_partner_liked AND NOT COALESCE\(v_pair_blocked_or_reported, false\)/);
});

test("confirm_video_date_entry_prepared pins provider-proof confirmation before lease clearing", () => {
  const confirm = fixture("functions/public-heads/confirm_video_date_entry_prepared.sql");

  assert.match(confirm, /public\.confirm_vde_prepared_202605031300_base\(/);
  assert.match(confirm, /v_success := COALESCE\(\(v_result ->> 'success'\)::boolean, false\)/);
  assert.match(
    confirm,
    /IF v_success THEN[\s\S]*prepare_entry_started_at = NULL,[\s\S]*prepare_entry_expires_at = NULL,[\s\S]*prepare_entry_attempt_id = NULL,[\s\S]*prepare_entry_actor_id = NULL/,
  );
});

test("deadline and expiry heads pin their live delegation targets", () => {
  const expire = fixture("functions/public-heads/expire_stale_video_sessions.sql");
  const entryDeadline = fixture("functions/public-heads/finalize_video_date_entry_deadline.sql");
  const handshakeDeadline = fixture("functions/public-heads/finalize_video_date_handshake_deadline.sql");
  const autoPromote = fixture("functions/public-heads/video_session_handshake_auto_promote_v2.sql");

  assert.match(expire, /RETURN public\.expire_stale_video_sessions_bounded\(100\)/);
  // The handshake-named head was absorbed into finalize_video_date_entry_deadline
  // (vocab flip + chain inlining); the entry head is the live full body. The
  // handshake fixture stays as a dropped-name historical reference (inventory
  // test pins its existence); live delegation pins live on the entry head.
  assert.match(entryDeadline, /public\.video_date_promote_confirmed_encounter_v1\(/);
  assert.match(entryDeadline, /public\.video_date_restore_canonical_room_metadata_v1\(/);
  // Survey-eligibility consolidation (20260612200500): v2 confirmed-encounter
  // semantics are the only survey gate in the deadline finalizer.
  assert.match(entryDeadline, /public\.video_date_session_is_post_date_survey_eligible_v2\(/);
  assert.doesNotMatch(entryDeadline, /video_date_session_is_post_date_survey_eligible\(/);
  assert.match(handshakeDeadline, /public\.video_date_promote_confirmed_encounter_v1\(/);
  assert.match(autoPromote, /public\.video_date_session_lifecycle_eligibility_v1\(/);
  assert.match(autoPromote, /public\.video_date_stable_bilateral_media_gate_v1\(p_session_id\)/);
  assert.match(autoPromote, /public\.video_date_mark_stable_bilateral_media_v1\(/);
});
