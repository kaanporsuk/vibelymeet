import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const MIGRATION = "supabase/migrations/20260517103000_date_suggestion_active_window_expiry.sql";
const FOLLOWUP_MIGRATION =
  "supabase/migrations/20260517114500_schedule_share_active_window_expiry_followup.sql";

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

test("web chat preserves active-card focus and opens warning dialog on active conflicts", () => {
  const chat = readRepoFile("src/pages/Chat.tsx");

  assert.match(chat, /ActiveDateSuggestionWarningDialog/);
  assert.match(chat, /findBlockingDateSuggestion/);
  assert.match(
    chat,
    /const warnAboutActiveSuggestion = useCallback\([\s\S]*focusExistingSuggestion\(suggestionId\);[\s\S]*setShowActiveDateSuggestionWarning\(true\);/,
  );
  assert.match(chat, /warnAboutActiveSuggestion\(existing\.id\)/);
  assert.match(chat, /onActiveSuggestionConflict=\{warnAboutActiveSuggestion\}/);
  assert.match(chat, /open=\{showActiveDateSuggestionWarning\}/);
  assert.doesNotMatch(chat, /onActiveSuggestionConflict=\{focusExistingSuggestion\}/);

  const dialog = readRepoFile("src/components/chat/ActiveDateSuggestionWarningDialog.tsx");
  assert.match(dialog, /AlertDialog/);
  assert.match(dialog, /Date suggestion already active/);
  assert.match(dialog, /Use the card in the conversation to continue, respond, or cancel it/);
});

test("native date composer delegates active conflicts to the parent warning path", () => {
  const sheet = readRepoFile("apps/mobile/components/chat/DateSuggestionSheet.tsx");
  const chat = readRepoFile("apps/mobile/app/chat/[id].tsx");

  assert.match(sheet, /onActiveSuggestionConflict\?: \(suggestionId: string \| null\) => void/);
  assert.match(sheet, /onActiveSuggestionConflict\(e\.suggestionId \?\? null\)/);
  assert.match(chat, /findBlockingDateSuggestion/);
  assert.match(chat, /<ActiveDateSuggestionWarningModal/);
  assert.match(
    chat,
    /const warnAboutActiveSuggestion = useCallback\([\s\S]*focusExistingSuggestion\(suggestionId\);[\s\S]*setShowActiveDateSuggestionWarning\(true\);/,
  );
  assert.match(chat, /warnAboutActiveSuggestion\(existing\.id\)/);
  assert.match(chat, /highlightToken=\{focusedSuggestionId === msg\.refId \? focusToken : undefined\}/);
  assert.match(
    chat,
    /<DateSuggestionSheet[\s\S]*onActiveSuggestionConflict=\{\(suggestionId\) => \{[\s\S]*refetchDateSuggestions\(\);[\s\S]*warnAboutActiveSuggestion\(suggestionId\);/,
  );

  const card = readRepoFile("apps/mobile/components/chat/DateSuggestionChatCard.tsx");
  assert.match(card, /highlightToken\?: number/);
  assert.match(card, /Animated\.sequence/);
});

test("proposal payloads carry local_timezone for active-window expiry", () => {
  const webComposer = readRepoFile("src/components/chat/DateSuggestionComposer.tsx");
  const nativeComposer = readRepoFile("apps/mobile/components/chat/DateSuggestionSheet.tsx");
  const webSchedule = readRepoFile("src/components/chat/ScheduleShareSheet.tsx");
  const nativeSchedule = readRepoFile("apps/mobile/components/chat/ScheduleShareSheet.tsx");
  const helper = readRepoFile("shared/dateSuggestions/localTimezone.ts");

  for (const source of [webComposer, nativeComposer, webSchedule, nativeSchedule]) {
    assert.match(source, /localTimezoneOrUtc/);
    assert.match(source, /local_timezone:\s*localTimezoneOrUtc\(\)/);
  }
  assert.match(helper, /Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
  assert.match(helper, /return "UTC"/);
});

test("backend expires stale proposal windows before the one-open-per-match gate", () => {
  const sql = readRepoFile(MIGRATION);
  const followupSql = readRepoFile(FOLLOWUP_MIGRATION);
  const edge = readRepoFile("supabase/functions/date-suggestion-expiry/index.ts");

  assert.match(sql, /ADD COLUMN IF NOT EXISTS local_timezone text/);
  assert.match(sql, /_date_suggestion_window_end/);
  assert.match(sql, /p_time_choice_key NOT IN \('tonight', 'tomorrow', 'this_weekend', 'next_week'\)/);
  assert.match(sql, /WHEN 'this_weekend' THEN 8 - v_iso_dow/);
  assert.match(sql, /WHEN 'next_week' THEN 15 - v_iso_dow/);
  assert.match(sql, /date_suggestion_expire_stale_open_suggestions/);
  assert.match(sql, /LEFT JOIN LATERAL \(/);
  assert.match(sql, /ORDER BY \(candidate\.id = ds\.current_revision_id\) DESC, candidate\.revision_number DESC/);
  assert.match(sql, /ALTER FUNCTION public\.date_suggestion_apply_v2\(text, jsonb\)[\s\S]*RENAME TO date_suggestion_apply_v2_stale_window_dispatch_20260517/);
  assert.match(sql, /v_suggestion_id := NULLIF\(v_payload->>'suggestion_id', ''\)::uuid/);
  assert.match(sql, /SELECT match_id INTO v_match_id[\s\S]*FROM public\.date_suggestions[\s\S]*WHERE id = v_suggestion_id/);
  assert.match(sql, /PERFORM public\.date_suggestion_expire_stale_open_suggestions\(v_match_id, now\(\)\)/);
  assert.match(sql, /RETURN public\.date_suggestion_apply_v2_stale_window_dispatch_20260517\(p_action, v_payload\)/);
  assert.match(followupSql, /RETURN COALESCE\(p_schedule_share_expires_at, p_expires_at\)/);
  assert.match(followupSql, /ds\.schedule_share_expires_at/);
  assert.match(
    followupSql,
    /DROP FUNCTION IF EXISTS public\._date_suggestion_blocks_new_proposal\(text, text, timestamptz, timestamptz, timestamptz, timestamptz, boolean, text, timestamptz\)/,
  );
  assert.match(
    followupSql,
    /DROP FUNCTION IF EXISTS public\._date_suggestion_window_end\(text, timestamptz, timestamptz, timestamptz, boolean, text\)/,
  );
  assert.match(edge, /date_suggestion_expire_stale_open_suggestions/);
  assert.doesNotMatch(edge, /\.lt\("expires_at", now\)/);
});
