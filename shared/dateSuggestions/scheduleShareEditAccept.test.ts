/**
 * Surgical-fix contracts for the shared Vibely Schedule card:
 *   1. Accept on schedule-share cards opens the block chooser (no direct accept).
 *   2. The chooser only exposes the offered selected slot keys (never any
 *      open/busy/unset/event blocks outside the offer).
 *   3. Schedule-share Accept is START-TIME-ONLY: payload includes
 *      chosen_slot_key + starts_at + local_start_hour and MUST NOT carry
 *      ends_at. Date duration is not part of the commitment; the product
 *      source of truth for the locked Vibely Schedule block is
 *      chosen_slot_key + starts_at.
 *   4. The exact-time pin sheet pins start time only (no end-time UI) and
 *      stays inside the chosen Morning/Afternoon/Evening/Night block range
 *      (mirror of `_block_hour_range` in SQL).
 *   5. Single offered block still requires the user to pass through the
 *      chooser step.
 *   6. Edit selected blocks uses `edit_schedule_share_slots` on the SAME
 *      suggestion_id and NEVER `send_proposal`.
 *   7. The edit action only replaces the caller's own selected blocks; it
 *      MUST NOT carry partner slot information in the payload. Authorization
 *      is grant-owner based ("caller has an existing schedule_share_grants
 *      row attached to this suggestion as subject"), NOT gated on whether
 *      the caller authored the current revision.
 *
 * These are static text/JSON contracts (no live Supabase). They guard against
 * regressions and are wired into `npm run test:date-suggestion-contracts` via
 * the existing tsx runner.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  BLOCK_HOUR_RANGES,
  TIME_BLOCKS,
  hourInBlock,
  parseSlotKey,
  type TimeBlock,
} from "./scheduleShare";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

const REVIEW_FIX_MIGRATION =
  "supabase/migrations/20260511174500_date_suggestion_review_comment_fixes.sql";
const UUID_GUARD_MIGRATION =
  "supabase/migrations/20260511180500_date_suggestion_uuid_payload_guards.sql";
const COUNTER_SLOT_GUARD_MIGRATION =
  "supabase/migrations/20260511185500_counter_selected_slot_keys_guard.sql";
const COUNTER_PAYLOAD_REVIEW_FOLLOWUP_MIGRATION =
  "supabase/migrations/20260511195200_counter_payload_review_followups.sql";
const EDIT_SLOT_NULL_PAYLOAD_FOLLOWUP_MIGRATION =
  "supabase/migrations/20260512000500_edit_schedule_share_slots_null_payload_followup.sql";

test("DateSuggestionCard Accept on schedule-share opens the block chooser (no direct accept)", () => {
  const src = readRepoFile("src/components/chat/DateSuggestionCard.tsx");

  // Accept handler must route schedule-share suggestions to the chooser sheet,
  // not call dateSuggestionApply("accept", ...) without a chosen_slot_key.
  assert.match(
    src,
    /if \(isScheduleShare\)\s*\{\s*setChooserOpen\(true\);\s*return;\s*\}/,
    "handleAccept must open the chooser when isScheduleShare",
  );

  // The card must mount the chooser sheet.
  assert.match(src, /<ChooseSharedBlockSheet\b/, "Card must mount ChooseSharedBlockSheet");

  // After picking a block, the existing pin sheet must be opened.
  assert.match(
    src,
    /handleChooserContinue[\s\S]{0,160}setPendingChosenSlotKey\(slotKey\)/,
    "Chooser Continue must hand off to ExactTimePinSheet via setPendingChosenSlotKey",
  );

  // The pin sheet must still ultimately call handleAcceptWithSlot, now with
  // the start-time-only signature (slotKey, startsAtIso, localStartHour).
  assert.match(
    src,
    /handleAcceptWithSlot\(pendingChosenSlotKey, startsAt, localHour\)/,
    "Pin confirm must forward to handleAcceptWithSlot with the start-time-only signature",
  );
});

test("Native DateSuggestionChatCard Accept on schedule-share opens the block chooser", () => {
  const src = readRepoFile("apps/mobile/components/chat/DateSuggestionChatCard.tsx");

  assert.match(
    src,
    /if \(isScheduleShare\)\s*\{\s*setChooserOpen\(true\);\s*return;\s*\}/,
    "Native handleAccept must open the chooser when isScheduleShare",
  );
  assert.doesNotMatch(
    src,
    /Plain Accept is a no-op/,
    "Native schedule-share Accept must not remain a no-op",
  );
  assert.match(src, /<ChooseSharedBlockSheet\b/, "Native card must mount ChooseSharedBlockSheet");
  assert.match(
    src,
    /handleChooserContinue[\s\S]{0,160}setPendingSlotKey\(slotKey\)/,
    "Native chooser Continue must hand off to ExactTimePinSheet via setPendingSlotKey",
  );
  assert.match(
    src,
    /handleAcceptWithSlot\(pendingSlotKey,\s*startsAt,\s*localHour\)/,
    "Native pin confirm must forward to handleAcceptWithSlot with the start-time-only signature",
  );
});

test("Schedule-share Accept payload is start-time-only (no ends_at)", () => {
  const src = readRepoFile("src/components/chat/DateSuggestionCard.tsx");

  // Schedule-share accept lives in handleAcceptWithSlot. Scope the assertion
  // to that function body so we don't collide with the legacy accept path
  // (which intentionally remains single-argument for non-share suggestions).
  const fnStart = src.indexOf("handleAcceptWithSlot = async (");
  assert.notEqual(fnStart, -1, "expected handleAcceptWithSlot function");
  const fnEnd = src.indexOf("};", fnStart);
  assert.notEqual(fnEnd, -1, "expected end of handleAcceptWithSlot");
  const body = src.slice(fnStart, fnEnd);

  assert.match(
    body,
    /dateSuggestionApply\("accept"/,
    "Schedule-share accept must call dateSuggestionApply(\"accept\", ...)",
  );

  for (const field of [
    "suggestion_id",
    "chosen_slot_key",
    "starts_at",
    "local_timezone",
    "local_start_hour",
  ]) {
    assert.match(body, new RegExp(`\\b${field}\\b`), `accept payload must include ${field}`);
  }

  // local_timezone MUST be derived from the browser's IANA zone at accept
  // time. The server uses this to AT TIME ZONE the starts_at instant for
  // local-date / local-hour consistency checks; we must not silently fall
  // back to a hardcoded value the user didn't actually pick.
  assert.match(
    body,
    /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/,
    "Accept payload must pull local_timezone from the browser's IANA zone",
  );
  assert.doesNotMatch(
    body,
    /\|\|\s*["']UTC["']/,
    "Accept payload must not silently fall back to UTC when the browser timezone is unavailable",
  );

  // Date duration is not part of the commitment. The accept payload MUST NOT
  // carry ends_at, and the inline parameter list MUST NOT plumb an end-time
  // ISO through to the server.
  const handlerSignature = body.match(/handleAcceptWithSlot = async \([\s\S]*?\) => \{/);
  assert.ok(handlerSignature, "expected handleAcceptWithSlot signature");
  assert.doesNotMatch(
    handlerSignature![0],
    /endsAt|ends_at/i,
    "handleAcceptWithSlot must not accept an end-time argument",
  );

  // The mutation call body itself must not reference ends_at.
  const callMatch = body.match(/dateSuggestionApply\("accept",[\s\S]*?\}\)/);
  assert.ok(callMatch, "expected dateSuggestionApply(\"accept\", { ... })");
  assert.doesNotMatch(
    callMatch![0],
    /\bends_at\b/,
    "schedule-share accept payload must not include ends_at",
  );
});

test("Native schedule-share Accept payload is start-time-only (no ends_at)", () => {
  const src = readRepoFile("apps/mobile/components/chat/DateSuggestionChatCard.tsx");

  const fnStart = src.indexOf("handleAcceptWithSlot = async (");
  assert.notEqual(fnStart, -1, "expected native handleAcceptWithSlot function");
  const fnEnd = src.indexOf("};", fnStart);
  assert.notEqual(fnEnd, -1, "expected end of native handleAcceptWithSlot");
  const body = src.slice(fnStart, fnEnd);

  assert.match(
    body,
    /dateSuggestionApply\('accept'/,
    "Native schedule-share accept must call dateSuggestionApply('accept', ...)",
  );

  for (const field of [
    "suggestion_id",
    "chosen_slot_key",
    "starts_at",
    "local_timezone",
    "local_start_hour",
  ]) {
    assert.match(body, new RegExp(`\\b${field}\\b`), `native accept payload must include ${field}`);
  }

  assert.match(
    body,
    /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/,
    "Native accept payload must pull local_timezone from the device Intl timezone",
  );
  assert.doesNotMatch(
    body,
    /\|\|\s*["']UTC["']/,
    "Native accept payload must not silently fall back to UTC",
  );

  const handlerSignature = body.match(/handleAcceptWithSlot = async \([\s\S]*?\) => \{/);
  assert.ok(handlerSignature, "expected native handleAcceptWithSlot signature");
  assert.doesNotMatch(
    handlerSignature![0],
    /endsAt|ends_at/i,
    "Native handleAcceptWithSlot must not accept an end-time argument",
  );

  const callMatch = body.match(/dateSuggestionApply\('accept',[\s\S]*?\}\)/);
  assert.ok(callMatch, "expected native dateSuggestionApply('accept', { ... })");
  assert.doesNotMatch(
    callMatch![0],
    /\bends_at\b/,
    "native schedule-share accept payload must not include ends_at",
  );
});

test("ExactTimePinSheet onConfirm is start-time-only (no ends_at)", () => {
  const src = readRepoFile("src/components/chat/ExactTimePinSheet.tsx");

  // Public surface: the onConfirm signature must be (startsAtIso, localStartHour).
  const propMatch = src.match(/onConfirm:\s*\(([\s\S]*?)\)\s*=>/);
  assert.ok(propMatch, "expected onConfirm signature on ExactTimePinSheet props");
  const params = propMatch![1];
  assert.match(params, /startsAtIso:\s*string/);
  assert.match(params, /localStartHour:\s*number/);
  assert.doesNotMatch(
    params,
    /endsAtIso|endsAt/,
    "onConfirm must not take an end-time argument",
  );

  // Internal implementation must not compute, clamp, or emit an end-time.
  assert.doesNotMatch(
    src,
    /DEFAULT_DURATION_MINUTES/,
    "Pin sheet must not carry a duration constant",
  );
  assert.doesNotMatch(
    src,
    /\bendsAt\b/,
    "Pin sheet must not compute endsAt locally",
  );

  // The confirmation call must hand back (startsAt.toISOString(), slot.hour).
  assert.match(
    src,
    /onConfirm\(startsAt\.toISOString\(\),\s*slot\.hour\)/,
    "Pin sheet must invoke onConfirm with (startsAtIso, localStartHour)",
  );

  // Callsite parity: the card's <ExactTimePinSheet onConfirm=...> must use the
  // 2-arg signature.
  const cardSrc = readRepoFile("src/components/chat/DateSuggestionCard.tsx");
  assert.match(
    cardSrc,
    /onConfirm=\{\(startsAt,\s*localHour\)\s*=>/,
    "Card must wire ExactTimePinSheet onConfirm with 2 args",
  );
});

test("Native ExactTimePinSheet onConfirm is start-time-only (no ends_at)", () => {
  const src = readRepoFile("apps/mobile/components/chat/ExactTimePinSheet.tsx");

  const propMatch = src.match(/onConfirm:\s*\(([\s\S]*?)\)\s*=>/);
  assert.ok(propMatch, "expected native onConfirm signature on ExactTimePinSheet props");
  const params = propMatch![1];
  assert.match(params, /startsAtIso:\s*string/);
  assert.match(params, /localStartHour:\s*number/);
  assert.doesNotMatch(
    params,
    /endsAtIso|endsAt/,
    "Native onConfirm must not take an end-time argument",
  );
  assert.doesNotMatch(
    src,
    /DEFAULT_DURATION_MINUTES/,
    "Native pin sheet must not carry a duration constant",
  );
  assert.doesNotMatch(
    src,
    /\bendsAt\b/,
    "Native pin sheet must not compute endsAt locally",
  );
  assert.match(
    src,
    /onConfirm\(startsAt\.toISOString\(\),\s*slot\.hour\)/,
    "Native pin sheet must invoke onConfirm with (startsAtIso, localStartHour)",
  );

  const cardSrc = readRepoFile("apps/mobile/components/chat/DateSuggestionChatCard.tsx");
  assert.match(
    cardSrc,
    /onConfirm=\{\(startsAt,\s*localHour\)\s*=>/,
    "Native card must wire ExactTimePinSheet onConfirm with 2 args",
  );
});

test("ChooseSharedBlockSheet only renders blocks passed in via offeredBlocks", () => {
  const src = readRepoFile("src/components/chat/ChooseSharedBlockSheet.tsx");

  // The chooser must derive its list strictly from offeredBlocks. It must not
  // read user_schedules, scheduleRecord, or any open-block source on its own.
  assert.match(src, /offeredBlocks: OfferedBlock\[\]/);
  assert.doesNotMatch(
    src,
    /user_schedules|useSchedule\(|scheduleRecord|getSlotStatus/,
    "Chooser must not derive selectable blocks from the user's schedule",
  );

  // Single-offered-block case: preselect, but the user still passes through.
  assert.match(
    src,
    /offeredBlocks\.length === 1[\s\S]{0,80}setSelectedKey\(offeredBlocks\[0\]\.slot_key\)/,
    "Single offered block must be preselected without skipping the chooser",
  );

  // Continue button must require a selected key (i.e., always one explicit confirm).
  assert.match(
    src,
    /disabled=\{!selectedKey/,
    "Continue must require an explicit selection (even when preselected)",
  );
});

test("Native ChooseSharedBlockSheet only renders blocks passed in via offeredBlocks", () => {
  const src = readRepoFile("apps/mobile/components/chat/ChooseSharedBlockSheet.tsx");

  assert.match(src, /offeredBlocks: OfferedBlock\[\]/);
  assert.doesNotMatch(
    src,
    /user_schedules|useSchedule\(|scheduleRecord|getSlotStatus/,
    "Native chooser must not derive selectable blocks from the user's schedule",
  );
  assert.match(
    src,
    /offeredBlocks\.length === 1[\s\S]{0,80}setSelectedKey\(offeredBlocks\[0\]\.slot_key\)/,
    "Native single offered block must be preselected without skipping the chooser",
  );
  assert.match(
    src,
    /disabled=\{!selectedKey/,
    "Native Continue must require an explicit selection",
  );
});

test("DateSuggestionCard passes only offered blocks to the chooser", () => {
  const src = readRepoFile("src/components/chat/DateSuggestionCard.tsx");

  // chooserOfferedBlocks must be derived from accepterOffer.data (the grant
  // RPC), not from user_schedules or any selected-anywhere source.
  assert.match(
    src,
    /const chooserOfferedBlocks[\s\S]{0,200}accepterOffer\.data/,
    "chooserOfferedBlocks must come from useSharedPartnerSchedule (offer-author grant)",
  );

  // The hook subject is the OFFER author (current revision proposed_by) — the
  // sender of the most recent share. This is what gates accept eligibility.
  assert.match(
    src,
    /useSharedPartnerSchedule\(\s*suggestion\.match_id,\s*offerAuthorId,/,
    "Chooser must use the offer author's grant slots (proposed_by of current revision)",
  );
});

test("Native DateSuggestionChatCard passes only offered blocks to the chooser", () => {
  const src = readRepoFile("apps/mobile/components/chat/DateSuggestionChatCard.tsx");

  assert.match(
    src,
    /const chooserOfferedBlocks[\s\S]{0,200}accepterOffer\.data/,
    "Native chooserOfferedBlocks must come from useSharedPartnerSchedule (offer-author grant)",
  );
  assert.match(
    src,
    /useSharedPartnerSchedule\(\s*suggestion\.match_id,\s*offerAuthorId,/,
    "Native chooser must use the offer author's grant slots",
  );
});

test("Exact-time pin enforces the chosen block range (morning/afternoon/evening/night)", () => {
  // Smoke-test the shared block range constants. This is the same authority
  // ExactTimePinSheet uses to constrain the time-of-day grid, and what the
  // server enforces server-side in date_suggestion_apply_v2.accept.
  const expectations: Array<{ block: TimeBlock; startHour: number; endHour: number }> = [
    { block: "morning", startHour: 8, endHour: 12 },
    { block: "afternoon", startHour: 12, endHour: 17 },
    { block: "evening", startHour: 17, endHour: 21 },
    { block: "night", startHour: 21, endHour: 24 },
  ];
  for (const { block, startHour, endHour } of expectations) {
    assert.equal(BLOCK_HOUR_RANGES[block].startHour, startHour);
    assert.equal(BLOCK_HOUR_RANGES[block].endHour, endHour);
    // Inside-block hours must validate.
    for (let h = startHour; h < endHour; h += 1) {
      assert.equal(hourInBlock(h, block), true, `${h}:00 must fall inside ${block}`);
    }
    // Block end is exclusive — endHour itself is NOT inside.
    assert.equal(hourInBlock(endHour, block), false, `endHour ${endHour} is exclusive on ${block}`);
  }

  // Adjacent blocks must not overlap.
  for (const a of TIME_BLOCKS) {
    for (const b of TIME_BLOCKS) {
      if (a === b) continue;
      const ra = BLOCK_HOUR_RANGES[a];
      const rb = BLOCK_HOUR_RANGES[b];
      const overlap = Math.max(ra.startHour, rb.startHour) < Math.min(ra.endHour, rb.endHour);
      assert.equal(overlap, false, `${a} and ${b} must not overlap`);
    }
  }
});

test("ScheduleShareEditSheet persists via edit_schedule_share_slots on the SAME suggestion", () => {
  const src = readRepoFile("src/components/chat/ScheduleShareEditSheet.tsx");

  // Must NOT call send_proposal under any circumstance.
  assert.doesNotMatch(
    src,
    /dateSuggestionApply\(\s*["']send_proposal["']/,
    "Edit sheet must never call send_proposal",
  );

  // Must call edit_schedule_share_slots with the same suggestion_id.
  assert.match(
    src,
    /dateSuggestionApply\(\s*["']edit_schedule_share_slots["'][\s\S]{0,200}suggestion_id/,
    "Edit sheet must call edit_schedule_share_slots with suggestion_id",
  );

  // Payload must carry only the current actor's selected_slot_keys — never the
  // partner's selection. (Partner grant has its own subject_user_id row server-side.)
  const callMatch = src.match(
    /dateSuggestionApply\(\s*["']edit_schedule_share_slots["'][\s\S]*?\}\)/,
  );
  assert.ok(callMatch, "expected dateSuggestionApply(\"edit_schedule_share_slots\", { ... })");
  const callBody = callMatch![0];
  assert.match(callBody, /selected_slot_keys: selectedSlotKeys/);
  assert.doesNotMatch(
    callBody,
    /partner_slot_keys|other_selected_slot_keys|partner_selected_slot_keys/,
    "Edit payload must not carry partner slot keys",
  );

  // Initial selection must preload from the sender's own current grant slots
  // (subject = currentUserId), so editing starts from what is shared today.
  assert.match(
    src,
    /useSharedPartnerSchedule\(matchId,\s*currentUserId/,
    "Edit sheet must preload current actor's grant (subject = currentUserId)",
  );
});

test("Sender-card Edit button is gated by caller's own grant, not current-revision authorship", () => {
  const src = readRepoFile("src/components/chat/DateSuggestionCard.tsx");

  // The caller-has-grant derivation must use the grant-backed hook scoped to
  // (match_id, suggestion_id, currentUserId). This mirrors the server-side
  // grant-owner authorization for `edit_schedule_share_slots`, so the UI
  // affordance cannot show when the RPC would refuse the request.
  assert.match(
    src,
    /useCallerScheduleShareGrant\(\s*suggestion\.match_id,\s*suggestion\.id,\s*currentUserId,/,
    "Edit visibility must call useCallerScheduleShareGrant(match_id, suggestion.id, currentUserId, ...)",
  );

  // The revision-inferred derivation MUST be removed. Edit visibility cannot
  // be inferred from past revisions because a revision-author may no longer
  // own a grant on this suggestion (or never did, if the grant was rotated).
  assert.doesNotMatch(
    src,
    /const callerHasShared = useMemo\(/,
    "Revision-inferred callerHasShared must be removed in favor of grant-backed lookup",
  );
  assert.doesNotMatch(
    src,
    /suggestion\.revisions\.some\([\s\S]{0,200}schedule_share_enabled === true/,
    "Edit gate must not infer share status from revision history",
  );

  // canEditScheduleShareSlots must require: schedule-share card, caller has
  // an active grant on THIS suggestion, current revision present, active
  // status. It must NOT require the caller to author the current revision.
  const canEditBlock = src.match(/const canEditScheduleShareSlots = Boolean\([\s\S]*?\);/);
  assert.ok(canEditBlock, "expected canEditScheduleShareSlots derivation");
  const body = canEditBlock![0];
  assert.match(body, /isScheduleShare/);
  assert.match(body, /callerHasGrant/);
  assert.doesNotMatch(
    body,
    /actionPolicy\.isAuthorOfCurrent/,
    "Edit gate must NOT require the caller to be the current revision author",
  );
  for (const s of ["draft", "proposed", "viewed", "countered"]) {
    assert.match(body, new RegExp(`["']${s}["']`), `active status whitelist must include ${s}`);
  }
  for (const terminal of ["accepted", "declined", "cancelled", "expired", "not_now", "completed"]) {
    assert.doesNotMatch(
      body,
      new RegExp(`["']${terminal}["']`),
      `Edit button must not be enabled for terminal status ${terminal}`,
    );
  }

  // Button label and onClick must use the same-suggestion callback.
  assert.match(
    src,
    /onEditScheduleShareSlots\(suggestion\.id\)/,
    "Edit button must invoke onEditScheduleShareSlots with the existing suggestion id",
  );
});

test("useCallerScheduleShareGrant scopes the grant lookup to the active suggestion", () => {
  const src = readRepoFile("src/hooks/useCallerScheduleShareGrant.ts");

  // The hook must read schedule_share_grants where subject_user_id is the
  // caller AND source_date_suggestion_id matches THIS suggestion AND the
  // grant is still active (expires_at in the future). Anything looser would
  // let a match-level grant (e.g. from a different past suggestion) show
  // Edit on an unrelated active suggestion.
  assert.match(src, /from\(["']schedule_share_grants["']\)/);
  assert.match(src, /\.eq\(["']match_id["'],\s*matchId\)/);
  assert.match(src, /\.eq\(["']subject_user_id["'],\s*currentUserId\)/);
  assert.match(src, /\.eq\(["']source_date_suggestion_id["'],\s*suggestionId\)/);
  assert.match(src, /\.gt\(["']expires_at["']/);

  // Defensive default: on error, the hook must report no grant rather than
  // optimistically allowing Edit.
  assert.match(
    src,
    /return\s*\{\s*hasGrant:\s*false\s*\}/,
    "On error or missing inputs, the hook must return hasGrant: false",
  );
});

test("Chat.tsx wires the same-suggestion edit handler and ScheduleShareEditSheet without create-side calls", () => {
  const src = readRepoFile("src/pages/Chat.tsx");

  assert.match(src, /openEditScheduleShareSlots/);
  assert.match(src, /<ScheduleShareEditSheet\b/);
  assert.match(
    src,
    /onEditScheduleShareSlots=\{openEditScheduleShareSlots\}/,
    "DateSuggestionCard must receive the edit handler",
  );

  // The new edit mount must NOT pipe through ScheduleShareSheet.onSent /
  // send_proposal infrastructure.
  const editMount = src.match(/<ScheduleShareEditSheet[\s\S]*?\/>/);
  assert.ok(editMount, "expected <ScheduleShareEditSheet ... /> mount");
  assert.doesNotMatch(editMount![0], /send_proposal/);
});

test("date_suggestion_apply_v2 edit_schedule_share_slots is grant-owner gated, not authorship gated", () => {
  const sql = readRepoFile(
    "supabase/migrations/20260511150000_date_suggestion_edit_schedule_share_slots.sql",
  );

  // Tier gate must require canUseVibeSchedule for the new action.
  assert.match(
    sql,
    /p_action = 'edit_schedule_share_slots'\s*AND NOT public\._get_user_tier_capability_bool_unchecked\(v_uid, 'canUseVibeSchedule'\)/,
  );

  // Same-suggestion semantics: explicit ELSIF branch, requires suggestion_id.
  assert.match(sql, /ELSIF p_action = 'edit_schedule_share_slots' THEN/);

  // Scope all body assertions to the edit branch so we don't bleed into other
  // ELSIF arms (which legitimately reference proposed_by, schedule_share_enabled,
  // etc. as part of their own logic).
  const editStart = sql.indexOf("ELSIF p_action = 'edit_schedule_share_slots' THEN");
  assert.notEqual(editStart, -1);
  const editEnd = sql.indexOf("END IF;\n\n  -- Non-handled actions", editStart);
  assert.notEqual(editEnd, -1);
  const editBranch = sql.slice(editStart, editEnd);

  assert.match(editBranch, /'suggestion_id_required'/);
  assert.match(editBranch, /'selected_slots_required'/);

  // Status whitelist mirrors the client gate (draft/proposed/viewed/countered).
  assert.match(
    editBranch,
    /v_suggestion\.status NOT IN \('draft', 'proposed', 'viewed', 'countered'\)/,
  );

  // Authorization: caller must have an existing grant on THIS suggestion
  // (subject = caller, source_date_suggestion_id = this suggestion). This is
  // the grant-owner gate that replaces the old "authored current revision"
  // requirement.
  assert.match(editBranch, /schedule_share_grants/);
  assert.match(editBranch, /g\.subject_user_id\s*=\s*v_uid/);
  assert.match(editBranch, /g\.source_date_suggestion_id\s*=\s*v_suggestion_id/);
  assert.match(editBranch, /'no_share_grant_to_edit'/);

  // MUST NOT include the old current-revision-author gate. The partner who
  // shared back must still be able to edit their own selected blocks even
  // after the current revision flipped to the other side.
  assert.doesNotMatch(
    editBranch,
    /v_rev\.proposed_by\s*<>\s*v_uid/,
    "Edit branch must NOT reject the caller for not authoring the current revision",
  );
  assert.doesNotMatch(
    editBranch,
    /v_rev\.schedule_share_enabled IS NOT TRUE/,
    "Edit branch must NOT require the CURRENT revision to be a schedule-share",
  );
  assert.doesNotMatch(
    editBranch,
    /v_rev\.time_choice_key\s*<>\s*'share_schedule'/,
    "Edit branch must NOT require the CURRENT revision time_choice to be share_schedule",
  );
  assert.doesNotMatch(
    editBranch,
    /'not_a_schedule_share_revision'/,
    "Edit branch must not emit not_a_schedule_share_revision (grant existence implies share state)",
  );

  // Slot-open defense-in-depth: every submitted slot must be currently 'open'
  // in the caller's own user_schedules.
  assert.match(editBranch, /user_schedules/);
  assert.match(editBranch, /us\.user_id\s*=\s*v_uid/);
  assert.match(editBranch, /us\.status\s*=\s*'open'/);
  assert.match(editBranch, /'selected_slot_not_open'/);

  // Atomic replace of THIS caller's grant slot set only. Partner grant
  // (subject_user_id = partner) is a different row and is untouched.
  assert.match(
    editBranch,
    /PERFORM public\._date_suggestion_upsert_share_grant\([\s\S]*?v_suggestion\.match_id,\s*v_partner,\s*v_uid,/,
  );

  // Must NOT change status / current_revision_id / accept the suggestion.
  assert.doesNotMatch(
    editBranch,
    /current_revision_id\s*=\s*[^\s,]+/,
    "Edit must not rewrite current_revision_id",
  );
  assert.doesNotMatch(
    editBranch,
    /status\s*=\s*'accepted'|status\s*=\s*'countered'/,
    "Edit must not change suggestion status",
  );
});

test("Schedule-share Accept stores NULL ends_at in date_plans (start-time-only)", () => {
  const sql = readRepoFile(
    "supabase/migrations/20260511150000_date_suggestion_edit_schedule_share_slots.sql",
  );

  // Scope to the accept branch.
  const acceptStart = sql.indexOf("ELSIF p_action = 'accept' THEN");
  assert.notEqual(acceptStart, -1, "expected accept branch in v2 migration");
  const acceptEnd = sql.indexOf("ELSIF p_action = 'decline'", acceptStart);
  assert.notEqual(acceptEnd, -1, "expected end of accept branch");
  const acceptBranch = sql.slice(acceptStart, acceptEnd);

  // ends_at MUST be NULL for the schedule-share accept path. Legacy accept
  // paths (no chosen_slot_key) keep using v_rev.ends_at — that branch is
  // preserved as the ELSE arm of the CASE.
  assert.match(
    acceptBranch,
    /CASE WHEN a_chosen_slot_key IS NOT NULL THEN NULL ELSE v_rev\.ends_at END/,
  );

  // Accept must NOT validate ends_at against the block range. The duration
  // validity check (`exact_time_invalid_range`) is gone.
  assert.doesNotMatch(
    acceptBranch,
    /exact_time_invalid_range/,
    "Accept must not emit exact_time_invalid_range (duration is no longer part of the commitment)",
  );
  assert.doesNotMatch(
    acceptBranch,
    /a_ends_ts\s*<=\s*a_starts_ts/,
    "Accept must not enforce a_ends_ts > a_starts_ts (duration is out of scope)",
  );

  // Server must still require starts_at for the schedule-share path.
  assert.match(acceptBranch, /'exact_time_required'/);

  // local_timezone is mandatory for the schedule-share accept path: the
  // server derives the user's local calendar date and local hour from
  // `starts_at AT TIME ZONE local_timezone` and enforces consistency.
  assert.match(acceptBranch, /'local_timezone_required'/);
  assert.match(acceptBranch, /'invalid_local_timezone'/);

  // (a) Local calendar date of starts_at MUST equal the chosen_slot_key
  // date. This is the day-shift guard that the precision review flagged.
  assert.match(acceptBranch, /'local_date_mismatch'/);
  assert.match(
    acceptBranch,
    /a_local_date\s*<>\s*a_slot_date/,
    "Accept must compare server-derived local date to the chosen_slot_key date",
  );

  // local date and local hour are derived server-side via AT TIME ZONE so
  // the client cannot lie about its wall clock.
  assert.match(
    acceptBranch,
    /\(a_starts_ts AT TIME ZONE a_local_tz\)::date/,
    "Server must derive local calendar date from starts_at AT TIME ZONE local_timezone",
  );
  assert.match(
    acceptBranch,
    /EXTRACT\(HOUR FROM \(a_starts_ts AT TIME ZONE a_local_tz\)\)::int/,
    "Server must derive local hour from starts_at AT TIME ZONE local_timezone",
  );

  // (b) Block range still validated end-exclusively, now against the
  // server-derived local hour rather than a client-asserted one.
  assert.match(acceptBranch, /'exact_time_outside_block'/);
  assert.match(
    acceptBranch,
    /a_local_hour NOT BETWEEN lower\(a_block_range\) AND upper\(a_block_range\) - 1/,
  );

  // local_start_hour stays as defense-in-depth only: if provided it must
  // agree with the server-derived hour. The migration must NOT make this
  // field load-bearing for the accept path.
  assert.match(acceptBranch, /'local_start_hour_mismatch'/);
  assert.doesNotMatch(
    acceptBranch,
    /'local_start_hour_required'/,
    "local_start_hour must not be load-bearing once local_timezone is the authority",
  );

  // Grant-membership and lock guards remain.
  assert.match(acceptBranch, /'slot_not_in_share_grant'/);
  assert.match(
    acceptBranch,
    /_apply_date_plan_event_lock\(v_plan\.id,\s*v_suggestion\.proposer_id/,
  );
  assert.match(
    acceptBranch,
    /_apply_date_plan_event_lock\(v_plan\.id,\s*v_suggestion\.recipient_id/,
  );
});

test("PR review follow-up guards schedule-share casts and active edit grants", () => {
  const sql = readRepoFile(REVIEW_FIX_MIGRATION);

  const acceptStart = sql.indexOf("ELSIF p_action = 'accept' THEN");
  assert.notEqual(acceptStart, -1, "expected accept branch in review fix migration");
  const acceptEnd = sql.indexOf("ELSIF p_action = 'decline'", acceptStart);
  assert.notEqual(acceptEnd, -1, "expected end of accept branch");
  const acceptBranch = sql.slice(acceptStart, acceptEnd);

  assert.match(
    acceptBranch,
    /BEGIN\s+a_slot_date := substring\(a_chosen_slot_key from 1 for 10\)::date;\s+EXCEPTION WHEN OTHERS THEN\s+RETURN jsonb_build_object\('ok', false, 'error', 'invalid_slot_key'\);/,
    "Invalid chosen_slot_key dates must return invalid_slot_key instead of throwing",
  );
  assert.match(
    acceptBranch,
    /BEGIN\s+a_starts_ts := a_starts::timestamptz;\s+EXCEPTION WHEN OTHERS THEN\s+RETURN jsonb_build_object\('ok', false, 'error', 'exact_time_required'\);/,
    "Invalid starts_at timestamps must return exact_time_required instead of throwing",
  );
  assert.match(
    acceptBranch,
    /BEGIN\s+a_starts_hour := nullif\(p_payload->>'local_start_hour', ''\)::int;\s+EXCEPTION WHEN OTHERS THEN\s+RETURN jsonb_build_object\('ok', false, 'error', 'local_start_hour_mismatch'\);/,
    "Invalid local_start_hour values must return local_start_hour_mismatch instead of throwing",
  );

  const editStart = sql.indexOf("ELSIF p_action = 'edit_schedule_share_slots' THEN");
  assert.notEqual(editStart, -1, "expected edit branch in review fix migration");
  const editEnd = sql.indexOf("END IF;\n\n  -- Non-handled actions", editStart);
  assert.notEqual(editEnd, -1, "expected end of edit branch");
  const editBranch = sql.slice(editStart, editEnd);

  assert.match(editBranch, /g\.viewer_user_id\s*=\s*v_partner/);
  assert.match(editBranch, /g\.expires_at\s*>\s*now\(\)/);
});

test("PR 839 follow-up guards UUID and selected slot payload parsing", () => {
  const sql = readRepoFile(UUID_GUARD_MIGRATION);

  assert.match(sql, /v_match_id_raw text := nullif\(p_payload->>'match_id', ''\);/);
  assert.match(sql, /v_suggestion_id_raw text := nullif\(p_payload->>'suggestion_id', ''\);/);
  assert.doesNotMatch(
    sql,
    /v_match_id uuid := nullif\(p_payload->>'match_id', ''\)::uuid/,
    "match_id must not be cast during DECLARE initialization",
  );
  assert.doesNotMatch(
    sql,
    /v_suggestion_id uuid := nullif\(p_payload->>'suggestion_id', ''\)::uuid/,
    "suggestion_id must not be cast during DECLARE initialization",
  );
  assert.match(
    sql,
    /v_match_id := v_match_id_raw::uuid;[\s\S]*?'invalid_match_id'/,
    "Malformed match_id must return invalid_match_id instead of throwing",
  );
  assert.match(
    sql,
    /v_suggestion_id := v_suggestion_id_raw::uuid;[\s\S]*?'invalid_suggestion_id'/,
    "Malformed suggestion_id must return invalid_suggestion_id instead of throwing",
  );

  const editStart = sql.indexOf("ELSIF p_action = 'edit_schedule_share_slots' THEN");
  assert.notEqual(editStart, -1, "expected edit branch in UUID guard migration");
  const editEnd = sql.indexOf("END IF;\n\n  -- Non-handled actions", editStart);
  assert.notEqual(editEnd, -1, "expected end of edit branch");
  const editBranch = sql.slice(editStart, editEnd);

  assert.match(editBranch, /jsonb_typeof\(v_payload->'selected_slot_keys'\) <> 'array'/);
  assert.match(editBranch, /'invalid_selected_slot_keys'/);
  assert.match(editBranch, /jsonb_array_elements_text\(v_payload->'selected_slot_keys'\)/);
});

test("PR 840 follow-up guards counter selected slot payload parsing", () => {
  const sql = readRepoFile(COUNTER_SLOT_GUARD_MIGRATION);

  const counterStart = sql.indexOf("ELSIF p_action = 'counter' THEN");
  assert.notEqual(counterStart, -1, "expected counter branch in counter slot guard migration");
  const counterEnd = sql.indexOf("    IF v_suggestion_id IS NULL", counterStart);
  assert.notEqual(counterEnd, -1, "expected counter payload parsing section");
  const counterPayloadParsing = sql.slice(counterStart, counterEnd);

  assert.match(
    counterPayloadParsing,
    /jsonb_typeof\(v_payload->'revision'->'selected_slot_keys'\) <> 'array'/,
  );
  assert.match(counterPayloadParsing, /'invalid_selected_slot_keys'/);
  assert.match(
    counterPayloadParsing,
    /jsonb_array_elements_text\(v_payload->'revision'->'selected_slot_keys'\)/,
  );
  assert.ok(
    counterPayloadParsing.indexOf("invalid_selected_slot_keys") <
      counterPayloadParsing.indexOf("jsonb_array_elements_text"),
    "counter branch must reject non-array selected_slot_keys before parsing it",
  );
});

test("PR 841 review follow-up parses counter booleans and JSON null slots safely", () => {
  const sql = readRepoFile(COUNTER_PAYLOAD_REVIEW_FOLLOWUP_MIGRATION);

  const counterStart = sql.indexOf("ELSIF p_action = 'counter' THEN");
  assert.notEqual(counterStart, -1, "expected counter branch in payload follow-up migration");
  const counterEnd = sql.indexOf("    IF v_suggestion_id IS NULL", counterStart);
  assert.notEqual(counterEnd, -1, "expected counter payload parsing section");
  const counterPayloadParsing = sql.slice(counterStart, counterEnd);

  assert.match(
    counterPayloadParsing,
    /r_share_raw := lower\(coalesce\(v_payload->'revision'->>'schedule_share_enabled', 'false'\)\);/,
  );
  assert.doesNotMatch(
    counterPayloadParsing,
    /schedule_share_enabled'\)::boolean/,
    "counter branch must not directly cast schedule_share_enabled to boolean",
  );
  assert.doesNotMatch(
    counterPayloadParsing,
    new RegExp(String.raw`r_share_raw IN \([^)]*'on'[^)]*\)`),
    "counter branch schedule_share_enabled truthy set must match truthyFlag (no 'on')",
  );
  assert.match(counterPayloadParsing, /'invalid_schedule_share_enabled'/);
  assert.match(
    counterPayloadParsing,
    /jsonb_typeof\(v_payload->'revision'->'selected_slot_keys'\) = 'null'/,
  );
  assert.ok(
    counterPayloadParsing.indexOf("= 'null'") <
      counterPayloadParsing.indexOf("invalid_selected_slot_keys"),
    "counter branch must treat JSON null selected_slot_keys as absent before invalidating non-arrays",
  );
});

test("PR 842 Copilot follow-up treats edit selected_slot_keys JSON null as absent", () => {
  const sql = readRepoFile(EDIT_SLOT_NULL_PAYLOAD_FOLLOWUP_MIGRATION);

  const editStart = sql.indexOf("ELSIF p_action = 'edit_schedule_share_slots' THEN");
  assert.notEqual(editStart, -1, "expected edit_schedule_share_slots branch");
  const editEnd = sql.indexOf("    SELECT * INTO v_suggestion", editStart);
  assert.notEqual(editEnd, -1, "expected edit slot payload parsing section");
  const editPayloadParsing = sql.slice(editStart, editEnd);

  assert.match(
    editPayloadParsing,
    /jsonb_typeof\(v_payload->'selected_slot_keys'\) = 'null'/,
  );
  assert.ok(
    editPayloadParsing.indexOf("= 'null'") <
      editPayloadParsing.indexOf("invalid_selected_slot_keys"),
    "edit branch must treat JSON null selected_slot_keys as absent before invalidating non-arrays",
  );
  assert.ok(
    editPayloadParsing.indexOf("r_slot_keys := NULL") <
      editPayloadParsing.indexOf("selected_slots_required"),
    "edit branch JSON null handling must fall through to selected_slots_required",
  );
});

test("Edge function require-share-capability set includes edit_schedule_share_slots", () => {
  const src = readRepoFile("supabase/functions/date-suggestion-actions/index.ts");

  assert.match(
    src,
    /p_action === "edit_schedule_share_slots"/,
    "Edge function shareRequested gate must include edit_schedule_share_slots",
  );
});

test("Schedule-share edit notifications map to a send-notification category", () => {
  const actions = readRepoFile("supabase/functions/date-suggestion-actions/index.ts");
  const sender = readRepoFile("supabase/functions/send-notification/index.ts");

  assert.match(actions, /schedule_share_updated:\s*"date_suggestion_schedule_share_updated"/);
  assert.match(sender, /date_suggestion_schedule_share_updated:\s*'notify_messages'/);
  assert.match(sender, /date_suggestion_schedule_share_updated:\s*\{\s*title:/);
});

test("Slot-key parsing rejects keys that could escape the offered set", () => {
  // Sanity: the slot-key format is the same across client + server. The Accept
  // mutation includes the chosen_slot_key the user picked from the chooser, and
  // both the chooser and the server bind to this exact format. If the parser
  // drifts, the server-side `slot_not_in_share_grant` invariant still holds,
  // but the client UI would silently swallow malformed offers — guard here.
  for (const evil of [
    "2026/05/15_morning",
    "26-05-15_morning",
    "2026-05-15_dawn",
    "2026-05-15morning",
    "",
  ]) {
    assert.equal(parseSlotKey(evil), null, `must reject malformed slot key: ${evil}`);
  }
});
