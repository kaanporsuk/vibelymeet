import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260430170000_video_date_explicit_handshake_decisions.sql"),
  "utf8",
);

test("migration adds explicit handshake decision timestamps", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS participant_1_decided_at timestamptz/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS participant_2_decided_at timestamptz/);
});

test("RPC accepts explicit vibe and pass decisions", () => {
  assert.match(migration, /IF p_action IN \('vibe', 'pass'\) THEN/);
  assert.match(migration, /v_decision := \(p_action = 'vibe'\)/);
});

test("expiry preserves null undecided likes instead of coercing them to pass", () => {
  assert.doesNotMatch(migration, /participant_1_liked = COALESCE\(participant_1_liked, FALSE\)/);
  assert.doesNotMatch(migration, /participant_2_liked = COALESCE\(participant_2_liked, FALSE\)/);
});

test("complete_handshake uses decided_at before date or non-mutual completion", () => {
  assert.match(
    migration,
    /participant_1_decided_at IS NOT NULL\s+AND v_session\.participant_2_decided_at IS NOT NULL\s+AND v_session\.participant_1_liked IS TRUE/s,
  );
  assert.match(
    migration,
    /participant_1_decided_at IS NOT NULL\s+AND v_session\.participant_2_decided_at IS NOT NULL THEN/s,
  );
});

test("safe client payload exposes actor-relative waiting state", () => {
  assert.match(migration, /'waiting_for_self', v_waiting_for_self/);
  assert.match(migration, /'waiting_for_partner', v_waiting_for_partner/);
  assert.match(migration, /'local_decision_persisted', NOT v_waiting_for_self/);
  assert.match(migration, /'partner_decision_persisted', NOT v_waiting_for_partner/);
});
