import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read(
  "supabase/migrations/20260607183000_video_date_ready_gate_entry_proof.sql",
);
const webOverlay = read("src/components/lobby/ReadyGateOverlay.tsx");
const nativeOverlay = read("apps/mobile/components/lobby/ReadyGateOverlay.tsx");
const nativeReadyRoute = read("apps/mobile/app/ready/[id].tsx");
const webHelper = read("src/lib/readyGateEntryProof.ts");
const nativeHelper = read("apps/mobile/lib/readyGateEntryProof.ts");

test("ready gate entry proof stores durable first-entry columns and append-only support ledger", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS ready_gate_participant_1_entered_at timestamptz/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS ready_gate_participant_2_entered_at timestamptz/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.video_date_ready_gate_entries/);
  assert.match(migration, /first_entry_for_participant boolean NOT NULL DEFAULT false/);
  assert.match(migration, /both_participants_entered boolean NOT NULL DEFAULT false/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.video_date_ready_gate_entries FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.video_date_ready_gate_entries TO service_role/);
});

test("entry proof RPC is participant-owned and excludes queued, both_ready, date-owned, and terminal truth", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.record_video_date_ready_gate_entered_v1/);
  assert.match(migration, /v_actor uuid := auth\.uid\(\)/);
  assert.match(migration, /v_session\.participant_1_id = v_actor/);
  assert.match(migration, /v_session\.participant_2_id = v_actor/);
  assert.match(migration, /public\.is_blocked\(v_session\.participant_1_id, v_session\.participant_2_id\)/);
  assert.match(migration, /public\.get_event_lobby_inactive_reason\(v_session\.event_id\)/);
  assert.match(
    migration,
    /v_session\.ready_gate_status NOT IN \('ready', 'ready_a', 'ready_b', 'snoozed'\)/,
  );
  assert.doesNotMatch(migration, /ready_gate_status NOT IN \('ready', 'ready_a', 'ready_b', 'both_ready'/);
  assert.match(migration, /'code', 'NOT_ACTIONABLE_READY_GATE'/);
  assert.match(migration, /'code', 'READY_GATE_EXPIRED'/);
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.record_video_date_ready_gate_entered_v1\(uuid, text, text, text, text, text, text\)[\s\S]*TO authenticated, service_role/,
  );
});

test("first participant entry can extend an active Ready Gate without marking Ready or date-owned truth", () => {
  assert.match(migration, /v_min_expires_at timestamptz := v_now \+ interval '45 seconds'/);
  assert.match(
    migration,
    /v_ttl_extended := v_first_entry_for_participant[\s\S]*COALESCE\(v_session\.ready_gate_expires_at, v_now\) < v_min_expires_at/,
  );
  assert.match(migration, /ready_gate_expires_at = CASE[\s\S]*WHEN v_ttl_extended THEN GREATEST/);
  assert.match(migration, /ready_gate_participant_1_entered_at = CASE[\s\S]*COALESCE\(ready_gate_participant_1_entered_at, v_now\)/);
  assert.match(migration, /ready_gate_participant_2_entered_at = CASE[\s\S]*COALESCE\(ready_gate_participant_2_entered_at, v_now\)/);
  assert.doesNotMatch(migration, /ready_participant_1_at\s*=/);
  assert.doesNotMatch(migration, /ready_participant_2_at\s*=/);
  assert.doesNotMatch(migration, /handshake_started_at\s*=/);
  assert.doesNotMatch(migration, /date_started_at\s*=/);
});

test("web and native overlays record entry proof only after hydrated actionable Ready Gate state", () => {
  for (const [label, source] of [
    ["web", webOverlay],
    ["native", nativeOverlay],
  ] as const) {
    assert.match(source, /recordReadyGateEntered/, `${label} overlay should call entry proof helper`);
    assert.match(source, /readyGateStateSessionId !== sessionId/, `${label} should wait for hydrated session state`);
    assert.match(source, /isReadyGateEntryProofStatus\(readyGateStatus\)/, `${label} should gate by active entry status`);
    assert.match(source, /source:\s*["']mounted_active_ready_gate["']/, `${label} should identify mounted entry source`);
    assert.match(source, /if \(result\.ttl_extended\)[\s\S]*syncSession\(\)/, `${label} should refresh countdown after grace extension`);
  }

  assert.match(webOverlay, /platform:\s*"web"/);
  assert.match(nativeOverlay, /platform:\s*'native'/);
});

test("native standalone Ready route records entry proof after hydrated actionable Ready Gate state", () => {
  assert.match(nativeReadyRoute, /recordReadyGateEntered/);
  assert.match(nativeReadyRoute, /isReadyGateEntryProofStatus\(status\)/);
  assert.match(nativeReadyRoute, /source:\s*'mounted_active_ready_gate'/);
  assert.match(nativeReadyRoute, /platform:\s*'native'/);
  assert.match(nativeReadyRoute, /surface:\s*'ready_gate_standalone'/);
  assert.match(nativeReadyRoute, /routePath:\s*pathname \?\? null/);
  assert.match(nativeReadyRoute, /if \(result\.ttl_extended\)[\s\S]*syncSession\(\)/);
  assert.match(nativeReadyRoute, /readyGateEntryProofKeyRef\.current = null/);
});

test("web and native helpers use the authenticated RPC with platform-specific client instance ids", () => {
  assert.match(webHelper, /"record_video_date_ready_gate_entered_v1" as never/);
  assert.match(nativeHelper, /'record_video_date_ready_gate_entered_v1' as never/);
  assert.match(webHelper, /rg-web-/);
  assert.match(nativeHelper, /rg-native-/);
  assert.match(webHelper, /p_client_ready_gate_status: readyGateStatus \?\? null/);
  assert.match(nativeHelper, /p_client_ready_gate_status: readyGateStatus \?\? null/);
});
