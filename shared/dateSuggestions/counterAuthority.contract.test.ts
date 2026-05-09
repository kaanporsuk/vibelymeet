import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const edgeFunction = read("supabase/functions/date-suggestion-actions/index.ts");
const migration = read("supabase/migrations/20260510000000_date_suggestion_counter_response_authority.sql");
const webActionClient = read("src/hooks/useDateSuggestionActions.ts");
const nativeActionClient = read("apps/mobile/lib/dateSuggestionApply.ts");
const webSchedule = read("src/pages/Schedule.tsx");
const nativeSchedule = read("apps/mobile/app/schedule.tsx");

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

test("web and native clients route date actions through the server-owned Edge function", () => {
  for (const [name, source] of [
    ["web action client", webActionClient],
    ["native action client", nativeActionClient],
  ] as const) {
    assert.match(source, /functions\.invoke\(["']date-suggestion-actions["']/, `${name} must use Edge function`);
    assert.doesNotMatch(source, /\.rpc\(["']date_suggestion_apply/, `${name} must not call date_suggestion_apply directly`);
  }

  assert.match(webSchedule, /dateSuggestionApply\("accept"/);
  assert.match(nativeSchedule, /dateSuggestionApply\(action/);
});

test("response actions are participant checked before latest-author transitions", () => {
  const responseActions = ["mark_viewed", "counter", "accept", "decline", "not_now"];
  for (const action of responseActions) {
    assert.match(migration, new RegExp(`p_action = '${action}'`), `${action} branch must exist`);
  }

  assert.match(migration, /v_suggestion\.proposer_id <> v_uid AND v_suggestion\.recipient_id <> v_uid[\s\S]*'forbidden'/);
  assert.match(migration, /v_suggestion\.recipient_id <> v_uid[\s\S]*'forbidden'/);
  assert.match(migration, /author_cannot_mark_viewed/);
  assert.match(migration, /cannot_counter_own_revision/);
  assert.match(migration, /author_cannot_accept_own_revision/);
  assert.match(migration, /author_cannot_decline_own_revision/);
  assert.match(migration, /author_cannot_not_now_own_revision/);
});
