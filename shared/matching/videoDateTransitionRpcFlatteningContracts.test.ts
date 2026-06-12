import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { readWebVideoCallFlowSource, readWebVideoDatePageFlowSource } from "../testUtils/webVideoDateFlowSources";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const flattenMigration = read(
  "supabase/migrations/20260611130225_flatten_video_date_transition_rpc_family.sql",
);

const activeRpcSources = [
  ["src/pages/VideoDate.tsx", readWebVideoDatePageFlowSource(root)],
  ["src/hooks/useReconnection.ts", read("src/hooks/useReconnection.ts")],
  ["src/hooks/useVideoCall.ts", readWebVideoCallFlowSource(root)],
  ["src/pages/Dashboard.tsx", read("src/pages/Dashboard.tsx")],
  ["apps/mobile/lib/videoDateApi.ts", read("apps/mobile/lib/videoDateApi.ts")],
  ["supabase/functions/daily-room/index.ts", read("supabase/functions/daily-room/index.ts")],
] as const;

const removedPublicHelpers = [
  "video_date_transition_20260430180000_last_chance_grace_10s",
  "video_date_transition_20260501091000_pre_date_end_cleanup",
  "video_date_transition_20260501103000_prepare_entry_queue_guard",
  "video_date_transition_20260501110000_provider_atomic_base",
  "video_date_transition_20260501145000_peer_missing_end_base",
  "video_date_transition_20260501200000_event_inactive_base",
  "video_date_transition_20260502143000_handshake_deadline_base",
  "video_date_transition_20260503110000_survey_continuity_base",
  "video_date_transition_20260503130000_prepare_lease_base",
  "video_date_transition_20260505153000_prepare_payload_base",
  "video_date_transition_20260603090000_remote_seen_base",
  "video_date_transition_20260604093000_failsoft_base",
  "video_date_transition_20260604170438_warmup_stability_base",
  "video_date_transition_20260604193140_latest_presence_base",
  "video_date_transition_20260605200729_lifecycle_base",
  "video_date_transition_20260605232304_single_owner_base",
  "video_date_transition_20260607123952_routeable_entry_base",
  "video_date_transition_20260607155414_lifecycle_base",
  "video_date_transition_20260607222923_definitive_base",
  "video_date_transition_20260608080938_last_resort_base",
  "video_date_transition_20260609105249_active_entry_base",
  "vd_transition_partial_base",
  "vd_transition_both_ready_owner_base",
  "vd_transition_20260609130139_hot_base",
  "vd_transition_20260609202707_enter_hs_base",
] as const;

test("video_date_transition public RPC remains the only active client/server call target", () => {
  for (const [path, source] of activeRpcSources) {
    assert.match(source, /rpc\(["']video_date_transition["']/, `${path} should use the public transition RPC`);
    for (const helper of removedPublicHelpers) {
      assert.doesNotMatch(source, new RegExp(helper), `${path} must not call ${helper}`);
    }
  }
});

test("flatten migration preserves public signature, grants, search_path, and entry action aliases", () => {
  assert.match(flattenMigration, /CREATE OR REPLACE FUNCTION public\.video_date_transition\(\s*p_session_id uuid,\s*p_action text,\s*p_reason text DEFAULT NULL\s*\)/);
  assert.match(flattenMigration, /RETURNS jsonb\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path TO 'public', 'pg_catalog'/);
  assert.match(flattenMigration, /GRANT EXECUTE ON FUNCTION public\.video_date_transition\(uuid, text, text\)\s+TO authenticated, service_role/);
  assert.match(flattenMigration, /WHEN 'complete_entry' THEN 'complete_handshake'/);
  assert.match(flattenMigration, /WHEN 'continue_entry' THEN 'continue_handshake'/);
  assert.match(flattenMigration, /private_video_date\.vdt_current_base/);
  assert.match(flattenMigration, /'code', 'ENTER_HANDSHAKE_REMOVED'/);
  assert.match(flattenMigration, /'active_entry_failsoft_shell', true/);
  assert.match(flattenMigration, /'hot_path_no_throw_shell', true/);
  assert.match(flattenMigration, /'standalone_enter_handshake_removed_shell', true/);
});

test("flatten migration removes timestamped transition helpers from the public RPC catalog", () => {
  assert.match(flattenMigration, /CREATE SCHEMA IF NOT EXISTS private_video_date/);
  assert.match(flattenMigration, /pg_get_functiondef\(v_reg\)/);
  assert.match(flattenMigration, /COMMENT ON FUNCTION private_video_date\.vdt_current_base\(uuid, text, text\)/);

  for (const helper of removedPublicHelpers) {
    assert.match(
      flattenMigration,
      new RegExp(`DROP FUNCTION IF EXISTS public\\.${helper}\\(uuid, text, text\\)`),
      `${helper} should be dropped from public`,
    );
  }
});

test("video_date_transition flattening is scoped to this RPC family", () => {
  assert.doesNotMatch(flattenMigration, /ready_gate_transition_/);
  assert.doesNotMatch(flattenMigration, /video_session_mark_ready_v2_/);
  assert.doesNotMatch(flattenMigration, /handle_swipe_/);
});
