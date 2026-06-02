import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260602103339_video_date_identifier_hygiene_v2.sql"),
  "utf8",
);
const supabaseTypes = readFileSync(join(root, "src/integrations/supabase/types.ts"), "utf8");

const historicalOverlongIdentifiers = [
  "ready_gate_transition_20260505140000_pre_ready_room_metadata_base",
  "ready_gate_transition_20260505154500_preserve_after_ready_room_base",
  "confirm_video_date_entry_prepared_20260501200000_event_inactive_base",
  "repair_stale_video_date_prepare_entries_20260501170000_both_join_base",
];

test("identifier hygiene migration uses explicit short bases instead of overlong historical names", () => {
  for (const identifier of historicalOverlongIdentifiers) {
    assert.doesNotMatch(migration, new RegExp(identifier));
  }

  for (const identifier of [
    "rgt_pre_ready_room_meta_base_v1",
    "rgt_preserve_warmup_base_v1",
    "confirm_vde_event_inactive_base_v1",
    "repair_stale_vd_prepare_both_join_v1",
  ]) {
    assert.match(migration, new RegExp(identifier));
  }

  const functionRefs = Array.from(migration.matchAll(/\b(?:FUNCTION|PROCEDURE)\s+public\.([A-Za-z0-9_]+)/g)).map(
    ([, identifier]) => identifier,
  );
  assert.ok(functionRefs.length > 0);
  assert.deepEqual(
    functionRefs.filter((identifier) => identifier.length > 63),
    [],
  );
});

test("generated Supabase types mirror the short internal function names", () => {
  for (const identifier of [
    "rgt_pre_ready_room_meta_base_v1",
    "rgt_preserve_warmup_base_v1",
    "confirm_vde_event_inactive_base_v1",
    "repair_stale_vd_prepare_both_join_v1",
  ]) {
    assert.match(supabaseTypes, new RegExp(`${identifier}: \\{`));
  }

  for (const identifier of [
    "ready_gate_transition_20260505140000_pre_ready_room_metadata_ba",
    "ready_gate_transition_20260505154500_preserve_after_ready_room_",
    "confirm_video_date_entry_prepared_20260501200000_event_inactive",
    "repair_stale_video_date_prepare_entries_20260501170000_both_joi",
  ]) {
    assert.doesNotMatch(supabaseTypes, new RegExp(`${identifier}: \\{`));
  }
});

test("identifier hygiene preserves Ready Gate wrapper delegation order", () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.rgt_preserve_warmup_base_v1[\s\S]*v_result := public\.rgt_pre_ready_room_meta_base_v1/s,
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.ready_gate_transition_20260505203000_registration_desync_base[\s\S]*v_result := public\.rgt_preserve_warmup_base_v1/s,
  );
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.rgt_pre_ready_room_meta_base_v1\(uuid, text, text\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.rgt_preserve_warmup_base_v1\(uuid, text, text\)/);
});

test("identifier hygiene preserves confirm and stale repair delegation", () => {
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.confirm_vde_prepared_202605031300_base[\s\S]*RETURN public\.confirm_vde_event_inactive_base_v1/s,
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.repair_stale_video_date_prepare_entries[\s\S]*v_base := public\.repair_stale_vd_prepare_both_join_v1\(v_limit\)/s,
  );
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.confirm_vde_event_inactive_base_v1\(uuid, text, text, text\)[\s\S]*TO service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.repair_stale_vd_prepare_both_join_v1\(integer\)[\s\S]*TO service_role/);
});
