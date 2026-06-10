import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260608160809_video_date_ready_gate_partial_ready_definitive_closure.sql",
);
const dailyRoom = read("supabase/functions/daily-room/index.ts");
const packageJson = read("package.json");
const webEventLobby = read("src/pages/EventLobby.tsx");
const webReadyGateOverlay = read("src/components/lobby/ReadyGateOverlay.tsx");
const nativeEventLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const nativeReadyGateOverlay = read(
  "apps/mobile/components/lobby/ReadyGateOverlay.tsx",
);
const nativeStandaloneReady = read("apps/mobile/app/ready/[id].tsx");

function blockBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing end marker after ${start}: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("partial-ready migration creates one canonical Ready Gate actionability gate", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.video_date_ready_gate_actionability_v1/);
  assert.match(migration, /p_allow_actor_owned_snooze boolean DEFAULT false/);
  assert.match(migration, /p_require_current_ready_gate_registration boolean DEFAULT true/);
  assert.match(migration, /p_terminalize_invalid boolean DEFAULT false/);
  assert.match(migration, /p_lock_rows boolean DEFAULT false/);
  assert.match(migration, /IF v_status = 'snoozed'[\s\S]*p_allow_actor_owned_snooze IS NOT TRUE/);
  assert.match(migration, /public\.get_event_lobby_inactive_reason\(v_session\.event_id\)/);
  assert.match(migration, /public\.is_blocked\(v_session\.participant_1_id, v_session\.participant_2_id\)/);
  assert.match(migration, /FROM public\.user_reports ur[\s\S]*ur\.reporter_id = v_actor[\s\S]*ur\.reported_id = v_partner_id/);
  assert.match(migration, /public\.is_profile_hidden\(v_actor\)/);
  assert.match(migration, /public\.is_profile_hidden\(v_partner_id\)/);
  assert.match(migration, /FROM public\.event_registrations er[\s\S]*FOR UPDATE/);
  assert.match(migration, /v_p1_current_room_id IS DISTINCT FROM v_session\.id/);
  assert.match(migration, /v_p2_current_room_id IS DISTINCT FROM v_session\.id/);
  assert.match(migration, /v_p1_current_partner_id IS DISTINCT FROM v_session\.participant_2_id/);
  assert.match(migration, /v_p2_current_partner_id IS DISTINCT FROM v_session\.participant_1_id/);
});

test("partial-ready migration terminalizes invalid pre-date Ready Gates and preserves date-owned sessions", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.video_date_terminalize_ready_gate_session_v1/);
  assert.match(migration, /v_session\.handshake_started_at IS NOT NULL/);
  assert.match(migration, /v_session\.date_started_at IS NOT NULL/);
  assert.match(migration, /'code', 'NOT_TERMINALIZABLE'/);
  assert.match(migration, /ready_gate_status = v_terminal_status/);
  assert.match(migration, /state = 'ended'::public\.video_date_state/);
  assert.match(migration, /phase = 'ended'/);
  assert.match(migration, /queue_status = 'idle'/);
  assert.match(migration, /current_room_id = NULL/);
  assert.match(migration, /daily_room_name = CASE WHEN v_session\.ready_gate_status = 'both_ready' THEN daily_room_name ELSE NULL END/);
  assert.match(migration, /public\.video_date_outbox_enqueue_v2\([\s\S]*'daily\.delete_video_date_room'/);
  assert.match(migration, /ready_gate_status IN \('queued', 'ready', 'ready_a', 'ready_b', 'snoozed', 'both_ready'\)/);

  const actionabilityBlock = blockBetween(
    migration,
    "CREATE OR REPLACE FUNCTION public.video_date_ready_gate_actionability_v1",
    "ALTER FUNCTION public.video_session_mark_ready_v2",
  );
  const terminalIndex = actionabilityBlock.indexOf("v_session.ended_at IS NOT NULL");
  const nonReadyGateOwnedIndex = actionabilityBlock.indexOf("'non_ready_gate_owned', true");
  assert.ok(terminalIndex >= 0, "missing terminal actionability guard");
  assert.ok(nonReadyGateOwnedIndex >= 0, "missing non-ready-gate ownership success");
  assert.ok(
    terminalIndex < nonReadyGateOwnedIndex,
    "terminal sessions must not pass the non-ready-gate-owned actionability branch",
  );
});

test("both-ready prepare failures hand off to /date only on routeable truth (single prepare-owner)", () => {
  // Web Event Lobby is no longer a competing prepare owner: it mounts/routes the
  // Ready Gate overlay but never runs its own prepare_date_entry or date-owned nav.
  assert.doesNotMatch(webEventLobby, /prepareAndNavigateToDateSession/);
  assert.doesNotMatch(webEventLobby, /prepareVideoDateEntry/);
  assert.doesNotMatch(webEventLobby, /navigateAfterPrepare/);
  assert.match(webEventLobby, /Single prepare-owner/);

  // Web overlay stays the canonical prepare owner, but only hands off to /date on
  // an exhausted/exception prepare failure when backend truth proves it routeable.
  assert.match(
    webReadyGateOverlay,
    /source_action: "prepare_entry_failed_date_owned"/,
  );
  assert.match(
    webReadyGateOverlay,
    /source: "ready_gate_prepare_failed_date_owned"/,
  );
  assert.match(
    webReadyGateOverlay,
    /isRouteableVideoDateTruth\(exhaustedTruth\)/,
  );
  assert.match(
    webReadyGateOverlay,
    /isRouteableVideoDateTruth\(exceptionTruth\)/,
  );
  assert.match(
    webReadyGateOverlay,
    /navigateToDate\("both_ready_prepare_failed_date_owned"\)/,
  );
  assert.match(
    webReadyGateOverlay,
    /navigateToDate\("both_ready_prepare_exception_date_owned"\)/,
  );

  // Native Event Lobby keeps the overlay as the prepare owner: the overlay handoff
  // skips the lobby re-prepare but still passes the startable (routeable-truth) gate.
  assert.match(nativeEventLobby, /Single prepare-owner/);
  assert.match(nativeEventLobby, /skipPrepare: true/);
  assert.match(
    nativeEventLobby,
    /"date_navigation_prepare_entry_failed_date_owned"/,
  );
  assert.match(
    nativeEventLobby,
    /markVideoDateRouteOwned\(sessionIdToOpen, user\.id\);/,
  );

  // Native overlay already gates retryable failures on routeable truth; its
  // exhausted/exception handoffs route through the lobby startable gate above.
  assert.match(
    nativeReadyGateOverlay,
    /source_action: 'prepare_entry_failed_date_owned'/,
  );
  assert.match(
    nativeReadyGateOverlay,
    /isRouteableVideoDateTruth\(latestTruth\)/,
  );
  assert.match(
    nativeReadyGateOverlay,
    /navigateWithLatency\(`\$\{source\}_prepare_failed_date_owned`\)/,
  );
  assert.match(
    nativeReadyGateOverlay,
    /navigateWithLatency\(`\$\{source\}_prepare_exception_date_owned`\)/,
  );

  assert.match(
    nativeStandaloneReady,
    /'standalone_prepare_entry_failed_date_owned'/,
  );
  assert.match(
    nativeStandaloneReady,
    /source: 'ready_standalone_prepare_failed_date_owned'/,
  );
  assert.match(nativeStandaloneReady, /markVideoDateRouteOwned\(sid, user\.id\);/);
  assert.match(nativeStandaloneReady, /navigateToDateSessionGuarded\(\{/);
  assert.doesNotMatch(
    nativeStandaloneReady,
    /standalone_prepare_entry_failed_before_date_nav/,
  );
});

test("event-ended cleanup no longer exempts pre-date rows just because room metadata exists", () => {
  const cleanupBlock = blockBetween(
    migration,
    "CREATE OR REPLACE FUNCTION public.terminalize_event_ready_gates",
    "CREATE OR REPLACE FUNCTION public.video_date_ready_gate_actionability_v1",
  );
  assert.match(cleanupBlock, /Daily room metadata alone is not provider-prepared\/date-capable evidence/);
  assert.match(cleanupBlock, /vs\.handshake_started_at IS NULL/);
  assert.match(cleanupBlock, /vs\.date_started_at IS NULL/);
  assert.match(cleanupBlock, /vs\.participant_1_joined_at IS NULL/);
  assert.match(cleanupBlock, /vs\.participant_2_joined_at IS NULL/);
  assert.match(cleanupBlock, /COALESCE\(vs\.phase, 'ready_gate'\) NOT IN \('handshake', 'date'\)/);
  assert.doesNotMatch(cleanupBlock, /vs\.daily_room_name IS NULL/);
  assert.doesNotMatch(cleanupBlock, /vs\.daily_room_url IS NULL/);
  assert.match(cleanupBlock, /public\.video_date_terminalize_ready_gate_session_v1\(/);
  assert.match(cleanupBlock, /'room_metadata_not_provider_prepared_evidence', true/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.terminalize_event_ready_gates\(uuid, text\)[\s\S]*TO service_role/);
});

test("public ready, snapshot, and prepare RPCs are wrapped through actionability", () => {
  assert.match(migration, /ALTER FUNCTION public\.video_session_mark_ready_v2\(uuid, text, text\)[\s\S]*RENAME TO vd_mark_ready_partial_base/);
  assert.match(migration, /ALTER FUNCTION public\.get_video_date_start_snapshot_v1\(uuid\)[\s\S]*RENAME TO vd_start_snapshot_partial_base/);
  assert.match(migration, /ALTER FUNCTION public\.video_date_transition\(uuid, text, text\)[\s\S]*RENAME TO vd_transition_partial_base/);

  const markReadyBlock = blockBetween(
    migration,
    "CREATE OR REPLACE FUNCTION public.video_session_mark_ready_v2",
    "CREATE OR REPLACE FUNCTION public.get_video_date_start_snapshot_v1",
  );
  assert.match(markReadyBlock, /public\.video_date_ready_gate_actionability_v1\(\s*p_session_id,\s*v_actor,\s*'video_session_mark_ready_v2',\s*false,\s*true,\s*true,\s*true/s);
  assert.ok(markReadyBlock.indexOf("video_date_ready_gate_actionability_v1") < markReadyBlock.indexOf("public.vd_mark_ready_partial_base"));
  assert.match(markReadyBlock, /v_status IN \('ready_a', 'ready_b'\)/);
  assert.match(markReadyBlock, /'notification\.send'/);
  assert.match(markReadyBlock, /'category', 'partner_ready'/);
  assert.match(markReadyBlock, /'video_date:partner_ready:' \|\| p_session_id::text/);

  const snapshotBlock = blockBetween(
    migration,
    "CREATE OR REPLACE FUNCTION public.get_video_date_start_snapshot_v1",
    "CREATE OR REPLACE FUNCTION public.video_date_transition",
  );
  assert.match(snapshotBlock, /public\.video_date_ready_gate_actionability_v1\(\s*p_session_id,\s*v_actor,\s*'get_video_date_start_snapshot_v1',\s*false,\s*true,\s*false,\s*false/s);
  assert.match(snapshotBlock, /'can_mark_ready', false/);
  assert.match(snapshotBlock, /'can_enter_date', false/);
  assert.match(snapshotBlock, /'allowedActions', '\[\]'::jsonb/);

  const transitionBlock = blockBetween(
    migration,
    "CREATE OR REPLACE FUNCTION public.video_date_transition",
    "CREATE OR REPLACE FUNCTION public.video_date_partial_ready_diagnostics_v1",
  );
  assert.match(transitionBlock, /IF v_action = 'prepare_entry' THEN/);
  assert.match(transitionBlock, /public\.video_date_ready_gate_actionability_v1\(\s*p_session_id,\s*v_actor,\s*'video_date_transition\.prepare_entry',\s*false,\s*true,\s*true,\s*true/s);
  assert.ok(transitionBlock.indexOf("video_date_ready_gate_actionability_v1") < transitionBlock.indexOf("public.vd_transition_partial_base"));
});

test("partial-ready timestamp invariant and diagnostics cover support cleanup", () => {
  assert.match(migration, /ADD CONSTRAINT video_sessions_ready_gate_timestamp_consistency/);
  assert.match(migration, /ready_gate_status IS DISTINCT FROM 'ready_a'[\s\S]*ready_participant_1_at IS NOT NULL AND ready_participant_2_at IS NULL/);
  assert.match(migration, /ready_gate_status IS DISTINCT FROM 'ready_b'[\s\S]*ready_participant_2_at IS NOT NULL AND ready_participant_1_at IS NULL/);
  assert.match(migration, /ready_gate_status IS DISTINCT FROM 'both_ready'[\s\S]*ready_participant_1_at IS NOT NULL AND ready_participant_2_at IS NOT NULL/);
  assert.match(migration, /NOT VALID/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.video_date_partial_ready_diagnostics_v1/);
  assert.match(migration, /LEFT JOIN LATERAL \([\s\S]*FROM public\.video_date_ready_gate_entries e[\s\S]*ORDER BY e\.inserted_at DESC[\s\S]*LIMIT 1/);
  assert.doesNotMatch(migration, /\.entered_at/);
  assert.match(migration, /'daily_room_present'/);
  assert.match(migration, /'partial_ready_expired'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.video_date_partial_ready_diagnostics_v1\(uuid, integer\)[\s\S]*TO service_role/);
});

test("daily-room has one actionability-gated Video Date provider/token entry path", () => {
  assert.match(dailyRoom, /type ReadyGateActionabilityPayload =/);
  assert.match(dailyRoom, /async function requireVideoDateReadyGateActionability/);
  assert.match(dailyRoom, /rpc\("video_date_ready_gate_actionability_v1"/);
  assert.match(dailyRoom, /p_allow_actor_owned_snooze: false/);
  assert.match(dailyRoom, /p_require_current_ready_gate_registration: true/);
  assert.match(dailyRoom, /p_terminalize_invalid: true/);
  assert.match(dailyRoom, /p_lock_rows: true/);

  assert.doesNotMatch(dailyRoom, /if \(action === "ensure_date_room"\)/);
  assert.doesNotMatch(dailyRoom, /if \(action === "prepare_solo_entry"\)/);
  assert.doesNotMatch(dailyRoom, /source: "daily_room\.ensure_date_room"/);
  assert.doesNotMatch(dailyRoom, /source: "daily_room\.prepare_solo_entry"/);

  const prepareBlock = blockBetween(
    dailyRoom,
    'if (action === "prepare_date_entry")',
    'return new Response(JSON.stringify({ error: "Unknown action" })',
  );
  assert.match(prepareBlock, /source: "daily_room\.prepare_date_entry"/);
  assert.ok(prepareBlock.indexOf("requireVideoDateReadyGateActionability") < prepareBlock.indexOf('p_action: "prepare_entry"'));
  assert.ok(prepareBlock.indexOf("requireVideoDateReadyGateActionability") < prepareBlock.indexOf("createMeetingToken"));
});

test("solo prejoin is removed and cannot mask behind Daily config", () => {
  const requiredActionsBlock = dailyRoom.match(/const DAILY_CONFIG_REQUIRED_ACTIONS = new Set\(\[[\s\S]*?\]\);/)?.[0] ?? "";
  assert.ok(requiredActionsBlock.length > 0);
  assert.doesNotMatch(requiredActionsBlock, /"prepare_solo_entry"/);
  assert.doesNotMatch(dailyRoom, /function videoDateSoloPrejoinServerEnabled/);
  assert.doesNotMatch(dailyRoom, /SOLO_PREJOIN_DISABLED/);
  assert.doesNotMatch(dailyRoom, /DAILY_VIDEO_DATE_SOLO_PREJOIN_TOKEN_TTL_SECONDS/);
  assert.doesNotMatch(dailyRoom, /canIssueSoloPrejoinVideoDateToken/);
  assert.doesNotMatch(dailyRoom, /solo_prejoin/);
});

test("partial-ready closure contracts are in the full and red-flag suites", () => {
  assert.match(packageJson, /shared\/matching\/readyGatePartialReadyDefinitiveClosure\.test\.ts/);
  const scripts = JSON.parse(packageJson).scripts as Record<string, string>;
  assert.match(scripts["test:video-date-v4"], /readyGateMarkReadyActionabilitySafety\.test\.ts && npx tsx shared\/matching\/readyGatePartialReadyDefinitiveClosure\.test\.ts/);
  assert.match(scripts["test:video-date:red-flags"], /readyGateMarkReadyActionabilitySafety\.test\.ts && npx tsx shared\/matching\/readyGatePartialReadyDefinitiveClosure\.test\.ts/);
});
