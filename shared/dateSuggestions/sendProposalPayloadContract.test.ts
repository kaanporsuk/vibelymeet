import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  dateSuggestionRpcErrorCode,
  normalizeDateSuggestionActionPayload,
} from "../../supabase/functions/_shared/dateSuggestionActionContract.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const PAYLOAD_GUARD_MIGRATION =
  "supabase/migrations/20260512170000_date_suggestion_send_payload_shape_guard.sql";
const LAST6_CODEX_FOLLOWUP_MIGRATION =
  "supabase/migrations/20260513003000_last6_codex_review_followups.sql";

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

test("flexible send_proposal omits selected_slot_keys instead of sending JSON null", () => {
  const result = normalizeDateSuggestionActionPayload("send_proposal", {
    match_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    revision: {
      date_type_key: "walk",
      time_choice_key: "this_weekend",
      place_mode_key: "near_you",
      optional_message: "Easy walk, good company.",
      schedule_share_enabled: false,
      selected_slot_keys: null,
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const revision = result.payload.revision as Record<string, unknown>;
  assert.equal(revision.time_choice_key, "this_weekend");
  assert.equal(Object.prototype.hasOwnProperty.call(revision, "selected_slot_keys"), false);
  assert.equal(result.shareRequested, false);
});

test("schedule-share selected_slot_keys is explicit array only", () => {
  const scalar = normalizeDateSuggestionActionPayload("send_proposal", {
    match_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    revision: {
      date_type_key: "walk",
      time_choice_key: "share_schedule",
      place_mode_key: "near_you",
      schedule_share_enabled: true,
      selected_slot_keys: "2026-05-16_morning",
    },
  });
  assert.equal(scalar.ok, false);
  if (!scalar.ok) assert.equal(scalar.error_code, "invalid_selected_slot_keys");

  const array = normalizeDateSuggestionActionPayload("send_proposal", {
    match_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    revision: {
      date_type_key: "walk",
      time_choice_key: "share_schedule",
      place_mode_key: "near_you",
      schedule_share_enabled: true,
      selected_slot_keys: ["2026-05-16_morning"],
    },
  });
  assert.equal(array.ok, true);
  if (!array.ok) return;
  assert.deepEqual(
    (array.payload.revision as Record<string, unknown>).selected_slot_keys,
    ["2026-05-16_morning"],
  );
  assert.equal(array.shareRequested, true);
});

test("share_schedule time choice is normalized as schedule share and requires slots", () => {
  const missingSlots = normalizeDateSuggestionActionPayload("send_proposal", {
    match_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    revision: {
      date_type_key: "walk",
      time_choice_key: "share_schedule",
      place_mode_key: "near_you",
      schedule_share_enabled: false,
    },
  });
  assert.equal(missingSlots.ok, false);
  if (!missingSlots.ok) assert.equal(missingSlots.error_code, "selected_slots_required");

  const withSlots = normalizeDateSuggestionActionPayload("send_proposal", {
    match_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    revision: {
      date_type_key: "walk",
      time_choice_key: "share_schedule",
      place_mode_key: "near_you",
      schedule_share_enabled: false,
      selected_slot_keys: ["2026-05-16_morning"],
    },
  });
  assert.equal(withSlots.ok, true);
  if (!withSlots.ok) return;
  const revision = withSlots.payload.revision as Record<string, unknown>;
  assert.equal(revision.schedule_share_enabled, true);
  assert.deepEqual(revision.selected_slot_keys, ["2026-05-16_morning"]);
  assert.equal(withSlots.shareRequested, true);
});

test("web and native composers do not emit selected_slot_keys null", () => {
  const webComposer = readRepoFile("src/components/chat/DateSuggestionComposer.tsx");
  const nativeComposer = readRepoFile("apps/mobile/components/chat/DateSuggestionSheet.tsx");
  const webHook = readRepoFile("src/hooks/useDateSuggestionActions.ts");
  const nativeHook = readRepoFile("apps/mobile/lib/dateSuggestionApply.ts");

  for (const source of [webComposer, nativeComposer]) {
    assert.match(source, /revision\.selected_slot_keys = w\.selectedSlotKeys/);
    assert.doesNotMatch(source, /selected_slot_keys:\s*share[\s\S]{0,100}:\s*null/);
  }
  assert.match(webHook, /normalizeDateSuggestionActionPayload/);
  assert.match(
    webHook,
    /export async function dateSuggestionApply[\s\S]*normalizeDateSuggestionActionPayload[\s\S]*payload: normalized\.payload/,
  );
  assert.match(nativeHook, /normalizeDateSuggestionActionPayload/);
  assert.match(nativeHook, /payload: normalized\.payload/);
});

test("Edge maps scalar extraction to stable validation error", () => {
  const edge = readRepoFile("supabase/functions/date-suggestion-actions/index.ts");

  assert.equal(
    dateSuggestionRpcErrorCode("cannot extract elements from a scalar"),
    "invalid_selected_slot_keys",
  );
  assert.match(edge, /normalizeDateSuggestionActionPayload/);
  assert.match(edge, /dateSuggestionRpcErrorCode\(rpcError\.message\)/);
  assert.match(edge, /dateSuggestionRpcErrorCode\(result\?\.error\)/);
  assert.doesNotMatch(edge, /error:\s*rpcError\.message/);
});

test("RPC wrapper guards selected_slot_keys before legacy JSON array extraction", () => {
  const sql = readRepoFile(PAYLOAD_GUARD_MIGRATION);
  const guardIndex = sql.indexOf("jsonb_typeof(v_revision->'selected_slot_keys') <> 'array'");
  const nullIndex = sql.indexOf("jsonb_typeof(v_revision->'selected_slot_keys') = 'null'");
  const delegateIndex = sql.indexOf("date_suggestion_apply_legacy_dispatch_20260512(p_action, v_payload)");

  assert.ok(nullIndex > 0, "wrapper should treat JSON null selected_slot_keys as absent");
  assert.ok(guardIndex > nullIndex, "wrapper should reject scalar selected_slot_keys");
  assert.ok(delegateIndex > guardIndex, "wrapper must guard before legacy dispatch");
  assert.match(sql, /v_time_choice = 'share_schedule'/);
  assert.match(sql, /jsonb_set\(v_revision, '\{schedule_share_enabled\}', 'true'::jsonb, true\)/);
  assert.match(sql, /jsonb_array_length\(v_revision->'selected_slot_keys'\) = 0/);
  assert.match(sql, /v_share AND NOT \(v_revision \? 'selected_slot_keys'\)/);
  assert.match(sql, /jsonb_array_elements\(v_revision->'selected_slot_keys'\)/);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.date_suggestion_apply\(text, jsonb\) FROM PUBLIC, anon, authenticated/,
  );
  assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.date_suggestion_apply\(text, jsonb\) TO authenticated/);
  assert.doesNotMatch(
    sql.slice(0, delegateIndex),
    /jsonb_array_elements_text\(v_revision->'selected_slot_keys'\)/,
    "wrapper must not use text extraction before type checks",
  );
});

test("RPC wrapper entitlement-checks share_schedule before normalization dispatch", () => {
  const sql = readRepoFile(LAST6_CODEX_FOLLOWUP_MIGRATION);
  const shareChoiceIndex = sql.indexOf("v_time_choice = 'share_schedule'");
  const entitlementIndex = sql.indexOf("_get_user_tier_capability_bool_unchecked(v_uid, 'canUseVibeSchedule')");
  const normalizeIndex = sql.indexOf("jsonb_set(v_revision, '{schedule_share_enabled}', 'true'::jsonb, true)");
  const delegateIndex = sql.indexOf("date_suggestion_apply_legacy_dispatch_20260512(p_action, v_payload)");

  assert.ok(shareChoiceIndex > 0, "wrapper should treat share_schedule as schedule-share");
  assert.ok(entitlementIndex > shareChoiceIndex, "wrapper should check canUseVibeSchedule for normalized share_schedule");
  assert.ok(normalizeIndex > entitlementIndex, "wrapper should not flip schedule_share_enabled before entitlement");
  assert.ok(delegateIndex > entitlementIndex, "wrapper must entitlement-check before legacy dispatch");
  assert.match(sql, /'error_code', 'tier_capability_disabled'/);
  assert.match(sql, /'capability', 'canUseVibeSchedule'/);
});

test("date suggestion dialog has a useful Radix description", () => {
  const composer = readRepoFile("src/components/chat/DateSuggestionComposer.tsx");

  assert.match(composer, /DialogDescription/);
  assert.match(composer, /Review and send your date suggestion\./);
});
