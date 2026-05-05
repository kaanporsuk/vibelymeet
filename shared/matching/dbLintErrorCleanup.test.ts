import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260506100000_db_lint_error_cleanup.sql"),
  "utf8",
);

function section(startMarker: string, endMarker: string): string {
  const start = migration.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing migration section start: ${startMarker}`);
  const end = migration.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing migration section end: ${endMarker}`);
  return migration.slice(start, end);
}

test("admin payment exception audit inserts keep uuid target ids", () => {
  const createException = section(
    "CREATE OR REPLACE FUNCTION public.admin_create_event_payment_exception",
    "COMMENT ON FUNCTION public.admin_create_event_payment_exception",
  );
  const transitionException = section(
    "CREATE OR REPLACE FUNCTION public.admin_transition_event_payment_exception",
    "COMMENT ON FUNCTION public.admin_transition_event_payment_exception",
  );

  assert.match(createException, /'event_payment_exception',\s+v_id,/);
  assert.match(transitionException, /'event_payment_exception',\s+p_exception_id,/);
  assert.doesNotMatch(createException, /target_id[\s\S]*v_id::text/);
  assert.doesNotMatch(transitionException, /target_id[\s\S]*p_exception_id::text/);
});

test("stale Vibe Video repair helper avoids temp-table lint failures", () => {
  const repair = section(
    "CREATE OR REPLACE FUNCTION public.mark_stale_vibe_video_uploads_failed",
    "COMMENT ON FUNCTION public.mark_stale_vibe_video_uploads_failed",
  );

  assert.doesNotMatch(repair, /CREATE TEMP TABLE/i);
  assert.doesNotMatch(repair, /pg_temp\.stale_vibe_video_repair_candidates/i);
  assert.match(repair, /v_candidates jsonb := '\[\]'::jsonb/);
  assert.match(repair, /jsonb_to_recordset\(v_candidates\)/);
  assert.match(repair, /'candidate_count', v_candidate_count/);
  assert.match(repair, /'classifications', v_classifications/);
  assert.match(repair, /profile_vibe_video_rows_marked_failed/);
});

test("lint cleanup preserves existing RPC signatures and grants", () => {
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.admin_create_event_payment_exception\(uuid, uuid, text, text, text, uuid, text\)/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.admin_create_event_payment_exception\(uuid, uuid, text, text, text, uuid, text\) TO authenticated/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.admin_transition_event_payment_exception\(uuid, text, text, text, text, boolean, text, uuid\)/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.admin_transition_event_payment_exception\(uuid, text, text, text, text, boolean, text, uuid\) TO authenticated/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.mark_stale_vibe_video_uploads_failed\(int, int\) FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.mark_stale_vibe_video_uploads_failed\(int, int\) TO service_role/,
  );
});
