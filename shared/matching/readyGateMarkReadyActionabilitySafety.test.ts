import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260608063016_video_date_mark_ready_actionability_safety.sql",
);
const packageJson = read("package.json");

test("mark-ready v2 locks the session and rejects queued before the decisive base", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.video_session_mark_ready_v2/);
  assert.match(
    migration,
    /FROM public\.video_sessions[\s\S]*WHERE id = p_session_id[\s\S]*FOR UPDATE/,
  );
  assert.match(migration, /IF v_ready_gate_status = 'queued' THEN/);
  assert.match(migration, /'code', 'READY_GATE_NOT_OPEN'/);
  assert.match(migration, /'reason', 'ready_gate_not_open'/);
  assert.match(migration, /'commandStatus', 'rejected'/);

  const queuedRejectIndex = migration.indexOf("IF v_ready_gate_status = 'queued' THEN");
  const decisiveBaseIndex = migration.indexOf(
    "v_result := public.video_session_mark_ready_v2_20260607123952_routeable_entry_base",
  );
  assert.ok(queuedRejectIndex > -1, "queued rejection should exist");
  assert.ok(decisiveBaseIndex > -1, "decisive base delegation should exist");
  assert.ok(
    queuedRejectIndex < decisiveBaseIndex,
    "queued sessions must be rejected before the ready commit base runs",
  );
});

test("mark-ready v2 repeats safety and partner-snooze gates inside the RPC", () => {
  assert.match(migration, /v_ready_gate_status = 'snoozed'[\s\S]*v_session\.snoozed_by <> v_actor/);
  assert.match(migration, /'code', 'PARTNER_SNOOZED'/);
  assert.match(migration, /public\.is_blocked\(v_session\.participant_1_id, v_session\.participant_2_id\)/);
  assert.match(
    migration,
    /FROM public\.user_reports ur[\s\S]*ur\.reporter_id = v_actor[\s\S]*ur\.reported_id = v_partner_id[\s\S]*ur\.reporter_id = v_partner_id[\s\S]*ur\.reported_id = v_actor/,
  );
  assert.match(migration, /v_actor_hidden := COALESCE\(public\.is_profile_hidden\(v_actor\), false\)/);
  assert.match(migration, /v_partner_hidden := COALESCE\(public\.is_profile_hidden\(v_partner_id\), false\)/);
  assert.match(migration, /'code', 'BLOCKED_PAIR'/);
  assert.match(migration, /'code', 'REPORTED_PAIR'/);
  assert.match(migration, /'ACTOR_NOT_ELIGIBLE'/);
  assert.match(migration, /'PARTNER_NOT_ELIGIBLE'/);
  assert.match(migration, /'code', 'SAFETY_CHECK_UNAVAILABLE'/);
});

test("mark-ready v2 still delegates to the fail-soft room base and both-ready protection", () => {
  assert.match(
    migration,
    /public\.video_session_mark_ready_v2_20260607123952_routeable_entry_base\(/,
  );
  assert.match(migration, /IF v_success AND v_ready_gate_status = 'both_ready' THEN/);
  assert.match(migration, /public\.video_date_protect_both_ready_entry_v1\(/);
  assert.match(migration, /'entry_protection', 'active'/);
  assert.match(migration, /'entry_protection', 'failed'/);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.video_session_mark_ready_v2\(uuid, text, text\)[\s\S]*TO authenticated, service_role/,
  );
});

test("start snapshot treats queued as retryable but not mark-ready actionable", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_video_date_start_snapshot_v1/);
  const canMarkReadyBlock = migration.match(/v_can_mark_ready :=[\s\S]*?;/)?.[0] ?? "";
  assert.match(
    canMarkReadyBlock,
    /v_ready_gate_status IN \('ready', 'ready_a', 'ready_b', 'snoozed'\)/,
  );
  assert.doesNotMatch(canMarkReadyBlock, /'queued'/);
  assert.match(canMarkReadyBlock, /v_session\.snoozed_by = v_uid/);
  assert.match(canMarkReadyBlock, /AND NOT COALESCE\(v_has_report, false\)/);
  assert.match(canMarkReadyBlock, /AND NOT COALESCE\(v_actor_hidden, false\)/);
  assert.match(canMarkReadyBlock, /AND NOT COALESCE\(v_partner_hidden, false\)/);

  assert.match(
    migration,
    /v_retryable :=[\s\S]*v_ready_gate_status IN \('queued', 'ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'\)/,
  );
  assert.match(migration, /WHEN v_can_mark_ready THEN ARRAY\['mark_ready', 'forfeit'\]::text\[\]/);
});

test("video-date v4 suite includes mark-ready actionability safety contracts", () => {
  assert.match(
    packageJson,
    /shared\/matching\/readyGateMarkReadyActionabilitySafety\.test\.ts/,
  );
});
