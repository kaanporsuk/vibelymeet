import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Golden-flow simplification PR 1: Ready Gate entry-proof telemetry removed.
// The mount-time proof stack (recordReadyGateEntered helpers, the
// record_video_date_ready_gate_entered_v1 RPC, the video_date_ready_gate_entries
// ledger, and the video_sessions.ready_gate_participant_*_entered_at stamps)
// mutated the hot session row on every Ready Gate mount and was implicated in
// the 2026-06-10 lock convoy. Ready Gate timing is owned by session creation
// and mark_ready; mount telemetry must never mutate the session row again.

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const removalMigration = read(
  "supabase/migrations/20260611091620_remove_ready_gate_entry_proof.sql",
);
const convoyMigration = read(
  "supabase/migrations/20260610201512_video_date_ready_gate_convoy_hardening.sql",
);
const webOverlay = read("src/components/lobby/ReadyGateOverlay.tsx");
const nativeOverlay = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
const nativeReadyRoute = read("apps/mobile/app/ready/[id].tsx");

test("ready gate mount performs no entry-proof call or session-row mutation on any platform", () => {
  for (const [label, source] of [
    ["web overlay", webOverlay],
    ["native overlay", nativeOverlay],
    ["native standalone ready route", nativeReadyRoute],
  ] as const) {
    assert.doesNotMatch(source, /recordReadyGateEntered/, `${label} must not record entry proof`);
    assert.doesNotMatch(source, /readyGateEntryProof/, `${label} must not retain entry-proof plumbing`);
    assert.doesNotMatch(
      source,
      /record_video_date_ready_gate_entered_v1/,
      `${label} must not call the dropped RPC`,
    );
  }
  assert.equal(existsSync(join(root, "src/lib/readyGateEntryProof.ts")), false);
  assert.equal(existsSync(join(root, "apps/mobile/lib/readyGateEntryProof.ts")), false);
});

test("forward migration drops the entry-proof RPC, ledger, and stamps without relocating TTL", () => {
  assert.match(
    removalMigration,
    /DROP FUNCTION IF EXISTS public\.record_video_date_ready_gate_entered_v1\(uuid, text, text, text, text, text, text\);/,
  );
  assert.match(removalMigration, /DROP TABLE IF EXISTS public\.video_date_ready_gate_entries;/);
  assert.match(removalMigration, /DROP COLUMN IF EXISTS ready_gate_participant_1_entered_at/);
  assert.match(removalMigration, /DROP COLUMN IF EXISTS ready_gate_participant_2_entered_at/);
  // Diagnostics keeps working without the dropped ledger.
  assert.match(
    removalMigration,
    /CREATE OR REPLACE FUNCTION public\.video_date_partial_ready_diagnostics_v1/,
  );
  assert.doesNotMatch(removalMigration, /LEFT JOIN LATERAL/);
  // The mount-time TTL extension dies with the RPC: Ready Gate timing is owned
  // by session creation and mark_ready, not proof logging.
  assert.doesNotMatch(removalMigration, /interval '45 seconds'/);
});

test("convoy-hardening role timeout config remains pinned after the entry-proof removal", () => {
  // This pin lived in the deleted entry-proof contract file; the 15s
  // authenticated statement_timeout is live cloud config and must stay
  // contracted.
  assert.match(convoyMigration, /ALTER ROLE authenticated SET statement_timeout = '15s';/);
  assert.match(convoyMigration, /NOTIFY pgrst, 'reload config';/);
});
