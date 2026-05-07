import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const migration = read("supabase/migrations/20260507215000_event_registration_self_cancel_cutoff.sql");
const liveCutoffMigration = read(
  "supabase/migrations/20260508094500_admin_post_publish_grants_and_live_cancel_cutoff.sql",
);

test("authenticated event self-cancel closes at start and terminal event truth", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.cancel_event_registration\(p_event_id uuid\)/);
  assert.match(migration, /v_event\.event_date IS NULL/);
  assert.match(migration, /now\(\) >= v_event\.event_date/);
  assert.match(migration, /v_event\.ended_at IS NOT NULL/);
  assert.match(migration, /v_event\.archived_at IS NOT NULL/);
  assert.match(migration, /lower\(COALESCE\(v_event\.status, ''\)\) IN \('draft', 'cancelled', 'ended', 'completed'\)/);
  assert.match(
    liveCutoffMigration,
    /btrim\(lower\(COALESCE\(v_event\.status, ''\)\)\) IN \('draft', 'cancelled', 'live', 'ended', 'completed'\)/,
  );
  assert.match(migration, /'code', 'CANCELLATION_CLOSED'/);
  assert.match(migration, /DELETE FROM public\.event_registrations/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.cancel_event_registration\(uuid\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.cancel_event_registration\(uuid\) TO authenticated/);
  assert.match(migration, /'20260507215000'/);
  assert.match(liveCutoffMigration, /'20260508094500'/);
});
