import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const edgeFunction = read("supabase/functions/date-suggestion-actions/index.ts");
const migration = read("supabase/migrations/20260510000000_date_suggestion_counter_response_authority.sql");

function quotedItemsFromArray(source: string, arrayName: string): string[] {
  const match = source.match(new RegExp(`const ${arrayName} = \\[([\\s\\S]*?)\\]\\.includes\\(p_action\\)`));
  assert.ok(match, `Missing ${arrayName} array`);
  return Array.from(match[1].matchAll(/"([^"]+)"/g)).map((item) => item[1]);
}

test("counter is treated as a response action, not date initiation entitlement", () => {
  assert.deepEqual(quotedItemsFromArray(edgeFunction, "requiresDateSuggestionCapability"), [
    "create_draft",
    "update_draft",
    "send_proposal",
  ]);

  assert.match(migration, /p_action IN \('create_draft', 'update_draft', 'send_proposal'\)/);
  assert.doesNotMatch(migration, /p_action IN \('create_draft', 'update_draft', 'send_proposal', 'counter'\)/);
});

test("schedule sharing remains gated for new proposals and counters only when requested", () => {
  assert.match(edgeFunction, /\["send_proposal", "counter"\]\.includes\(p_action\)[\s\S]*truthyFlag\(revision\.schedule_share_enabled\)/);
  assert.match(migration, /p_action IN \('send_proposal', 'counter'\)[\s\S]*v_share_requested[\s\S]*canUseVibeSchedule/);
});

test("latest revision author cannot respond to their own proposal", () => {
  assert.match(migration, /IF v_prev\.proposed_by = v_uid THEN[\s\S]*cannot_counter_own_revision/);
  assert.match(migration, /IF v_rev\.proposed_by = v_uid THEN[\s\S]*author_cannot_accept_own_revision/);
  assert.match(migration, /IF v_rev\.proposed_by = v_uid THEN[\s\S]*author_cannot_decline_own_revision/);
  assert.match(migration, /IF v_rev\.proposed_by = v_uid THEN[\s\S]*author_cannot_not_now_own_revision/);
});

test("public callers must enter through hardened v2 response checks", () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.date_suggestion_apply\(text, jsonb\) FROM authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.date_suggestion_apply_v2\(text, jsonb\) TO authenticated/);
  assert.match(migration, /recipient_id', v_rev\.proposed_by/);
});
