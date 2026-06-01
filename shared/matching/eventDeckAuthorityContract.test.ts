import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function functionSection(source: string, functionName: string): string {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${functionName}`);
  assert.notEqual(start, -1, `${functionName} definition should exist`);
  const revoke = source.indexOf(`REVOKE ALL ON FUNCTION public.${functionName}`, start);
  assert.notEqual(revoke, -1, `${functionName} revoke block should follow definition`);
  return source.slice(start, revoke);
}

function latestFunctionSection(source: string, functionName: string): string {
  const start = source.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${functionName}`);
  assert.notEqual(start, -1, `${functionName} definition should exist`);
  const revoke = source.indexOf(`REVOKE ALL ON FUNCTION public.${functionName}`, start);
  assert.notEqual(revoke, -1, `${functionName} revoke block should follow definition`);
  return source.slice(start, revoke);
}

function sectionBetween(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `${startNeedle.trim()} section should exist`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `${endNeedle.trim()} section should follow`);
  return source.slice(start, end);
}

const migration = read("supabase/migrations/20260601183000_event_deck_authority_contract.sql");
const tokenGuardMigration = read("supabase/migrations/20260601194000_event_deck_token_current_top_guard.sql");
const redealMigration = read("supabase/migrations/20260601220000_video_date_deck_redeal_unacted_visible_idempotent.sql");
const reservationReuseMigration = read("supabase/migrations/20260601223000_video_date_deck_reservation_reuse_visible_grace.sql");
const reviewFollowupMigration = read("supabase/migrations/20260601230000_review_comments_1132_1139_followups.sql");
const authoritySql = `${migration}\n${tokenGuardMigration}\n${redealMigration}\n${reservationReuseMigration}\n${reviewFollowupMigration}`;
const webLobby = read("src/pages/EventLobby.tsx");
const webSwipeHook = read("src/hooks/useSwipeAction.ts");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const nativeEventsApi = read("apps/mobile/lib/eventsApi.ts");
const swipeActions = read("supabase/functions/swipe-actions/index.ts");
const adapters = read("supabase/functions/_shared/eventProfileAdapters.ts");
const supabaseTypes = read("src/integrations/supabase/types.ts");

const eligibilitySection = functionSection(migration, "event_deck_candidate_eligibility");
const currentTopSection = functionSection(migration, "event_deck_current_top_candidate");
const validateSection = latestFunctionSection(authoritySql, "event_deck_validate_presented_card");
const deckV3Section = latestFunctionSection(authoritySql, "get_event_deck_v3");
const visibleCompatSection = sectionBetween(
  migration,
  "CREATE OR REPLACE FUNCTION public.record_event_deck_card_visible_v1(\n  p_event_id uuid,\n  p_viewer_id uuid,\n  p_target_id uuid\n)",
  "DROP FUNCTION IF EXISTS public.handle_swipe_20260601183000_deck_authority_base",
);
const handleSwipeV2Section = functionSection(migration, "handle_swipe_v2");
const latestVisibleSection = sectionBetween(
  redealMigration,
  "CREATE OR REPLACE FUNCTION public.record_event_deck_card_visible_v1(\n  p_event_id uuid,\n  p_viewer_id uuid,\n  p_target_id uuid,\n  p_deck_token text DEFAULT NULL\n)",
  "REVOKE ALL ON FUNCTION public.record_event_deck_card_visible_v1(uuid, uuid, uuid, text)",
);
const webTerminalVisibleErrorsSection = sectionBetween(
  webLobby,
  "const TERMINAL_VISIBLE_CARD_MARK_ERRORS = new Set([",
  "]);",
);
const nativeTerminalVisibleErrorsSection = sectionBetween(
  nativeLobby,
  "const TERMINAL_VISIBLE_CARD_MARK_ERRORS = new Set([",
  "]);",
);

test("server owns Event Deck presentation authority and direct swipe mutation is closed", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.event_deck_card_reservations/);
  assert.match(migration, /deck_token text NOT NULL UNIQUE/);
  assert.match(migration, /CHECK \(NOT public\.video_date_jsonb_has_secret_key\(metadata\)\)/);
  assert.match(migration, /ALTER TABLE public\.event_deck_card_reservations ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /idx_event_deck_card_reservations_cleanup[\s\S]*event_id, viewer_id, expires_at/);
  assert.doesNotMatch(migration, /idx_event_deck_card_reservations_expires_at[\s\S]*ON public\.event_deck_card_reservations\(expires_at\)/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.event_deck_card_reservations FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.event_deck_card_reservations TO service_role/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON TABLE public\.event_swipes FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /DROP POLICY IF EXISTS "Users can create own swipes" ON public\.event_swipes/);
});

test("canonical eligibility covers every deck and swipe exclusion root cause", () => {
  assert.match(eligibilitySection, /get_event_lobby_active_state\(p_event_id, now\(\)\)/);
  assert.match(eligibilitySection, /v_viewer_reg\.admission_status/);
  assert.match(eligibilitySection, /v_target_reg\.admission_status/);
  assert.match(eligibilitySection, /public\.is_profile_hidden\(p_viewer_id\)/);
  assert.match(eligibilitySection, /public\.is_blocked\(p_viewer_id, p_target_id\)/);
  assert.match(eligibilitySection, /user_reports/);
  assert.match(eligibilitySection, /public\.is_profile_discoverable\(p_target_id, p_viewer_id\)/);
  assert.match(eligibilitySection, /COALESCE\(v_target_reg\.queue_status, 'idle'\) NOT IN \('browsing', 'idle'\)/);
  assert.match(eligibilitySection, /public\.preference_allows_gender\(v_viewer\.interested_in, v_target\.gender\)/);
  assert.match(eligibilitySection, /public\.preference_allows_gender\(v_target\.interested_in, v_viewer\.gender\)/);
  assert.match(eligibilitySection, /v_viewer\.preferred_age_min/);
  assert.match(eligibilitySection, /v_target\.preferred_age_min/);
  assert.match(eligibilitySection, /p_check_existing_swipe/);
  assert.match(eligibilitySection, /FROM public\.matches m/);
  assert.match(eligibilitySection, /public\.video_date_pair_has_terminal_encounter\(p_event_id, p_viewer_id, p_target_id\)/);
  assert.match(eligibilitySection, /pair_already_in_session/);
  assert.match(eligibilitySection, /participant_has_active_session_conflict/);
  assert.match(eligibilitySection, /target_active_session_conflict/);
});

test("current-top validation uses reservations, not a fresh randomized deck", () => {
  assert.match(currentTopSection, /FROM public\.event_deck_card_reservations r/);
  assert.match(currentTopSection, /max\(r\.issued_at\) AS issued_at/);
  assert.match(currentTopSection, /r\.swiped_at IS NULL/);
  assert.match(currentTopSection, /public\.event_deck_candidate_eligibility/);
  assert.match(currentTopSection, /ORDER BY candidates\.deck_rank/);
  assert.doesNotMatch(currentTopSection, /public\.get_event_deck/);
  assert.doesNotMatch(currentTopSection, /random\(\)/);

  assert.match(validateSection, /p_deck_token text DEFAULT NULL/);
  assert.match(validateSection, /FOR UPDATE/);
  assert.match(validateSection, /invalid_deck_token/);
  assert.match(validateSection, /v_visible_grace interval := interval '20 minutes'/);
  assert.match(validateSection, /r\.expires_at > now\(\)[\s\S]*r\.visible_at IS NOT NULL AND r\.visible_at > now\(\) - v_visible_grace/);
  assert.match(validateSection, /r\.issued_at/);
  assert.match(validateSection, /r\.deck_rank/);
  assert.match(validateSection, /lower_rank\.issued_at = v_reservation\.issued_at/);
  assert.match(validateSection, /lower_rank\.deck_rank < v_reservation\.deck_rank/);
  assert.match(validateSection, /lower_rank\.expires_at > now\(\)[\s\S]*lower_rank\.visible_at IS NOT NULL AND lower_rank\.visible_at > now\(\) - v_visible_grace/);
  assert.match(validateSection, /v_current_top := public\.event_deck_current_top_candidate/);
  assert.match(validateSection, /not_current_top_card/);
  assert.match(validateSection, /valid_deck_token/);
  assert.match(validateSection, /'visible_grace_seconds', 1200/);
  assert.match(validateSection, /current_top_card/);

  const validTokenIndex = validateSection.indexOf("'reason', 'valid_deck_token'");
  const lowerRankIndex = validateSection.indexOf("lower_rank.deck_rank < v_reservation.deck_rank");
  const currentTopIndex = validateSection.indexOf("v_current_top := public.event_deck_current_top_candidate");
  assert.ok(
    validTokenIndex > -1 && lowerRankIndex > -1 && lowerRankIndex < validTokenIndex,
    "a deck token must be topmost within its own reservation batch before valid_deck_token is returned",
  );
  assert.ok(
    currentTopIndex > validTokenIndex,
    "tokenless legacy fallback should use the latest active current-top reservation after token handling",
  );
});

test("deck v3 reserves buffered cards without burning them as dealt", () => {
  assert.match(deckV3Section, /WITH ORDINALITY AS gd/);
  assert.match(deckV3Section, /latest_active_batch AS/);
  assert.match(deckV3Section, /latest_active_reservations AS/);
  assert.match(deckV3Section, /active_reusable_reservations AS/);
  assert.match(deckV3Section, /reservation_reused/);
  assert.match(deckV3Section, /reservation_reuse_scope', 'card'/);
  assert.match(deckV3Section, /deck_rank = ranked\.rn::integer/);
  assert.match(deckV3Section, /reservation_previous_deck_rank', r\.deck_rank/);
  assert.match(deckV3Section, /active_reservation_deck_rank IS NOT NULL/);
  assert.match(deckV3Section, /filtered\.active_reservation_deck_rank/);
  assert.match(deckV3Section, /INSERT INTO public\.event_deck_card_reservations/);
  assert.match(deckV3Section, /deck_token/);
  assert.match(deckV3Section, /deck_rank/);
  assert.match(deckV3Section, /rb\.issued_at/);
  assert.match(deckV3Section, /now\(\) \+ interval '2 minutes'/);
  assert.match(deckV3Section, /'prefetched'/);
  assert.match(deckV3Section, /WHERE COALESCE\(\(result->>'ok'\)::boolean, false\)/);
  assert.match(deckV3Section, /'reservation_ttl_seconds', 120/);
  assert.match(deckV3Section, /'reused_reservation_count', v_reused_reservation_count/);
  assert.match(deckV3Section, /'preserves_active_reservations', true/);
  assert.match(deckV3Section, /- 'ordinality'/);
  assert.match(deckV3Section, /- 'active_reservation_deck_token'/);
  assert.doesNotMatch(deckV3Section, /ranked\.profile_id,\s+'dealt',\s+'get_event_deck_v3_buffer'/);
});

test("deck v3 re-deals visible unacted cards without repeated prefetch writes", () => {
  assert.match(deckV3Section, /eligible_raw AS/);
  assert.match(deckV3Section, /public\.event_deck_candidate_eligibility/);
  assert.match(deckV3Section, /COALESCE\(\(SELECT n FROM eligible_count\), 0\)/);
  assert.match(deckV3Section, /< public\.video_date_impression_rank\('pass'\)/);
  assert.match(deckV3Section, /'redeal_unacted', true/);
  assert.match(deckV3Section, /existing_prefetch\.prefetch_expires_at > now\(\)/);
  assert.match(deckV3Section, /video_date_impression_rank\(existing_prefetch\.strongest_exclusion_reason\)[\s\S]*>= public\.video_date_impression_rank\('dealt'\)/);
  assert.doesNotMatch(deckV3Section, /< public\.video_date_impression_rank\('dealt'\)/);
});

test("visible-card and swipe paths validate the same presented-card contract", () => {
  assert.match(latestVisibleSection, /p_deck_token text DEFAULT NULL/);
  assert.match(latestVisibleSection, /public\.event_deck_validate_presented_card/);
  assert.match(latestVisibleSection, /visible_at = COALESCE\(visible_at, now\(\)\)/);
  assert.match(latestVisibleSection, /'event_lobby_top_card_visible'/);
  assert.match(visibleCompatSection, /RETURN public\.record_event_deck_card_visible_v1\(/);
  assert.match(visibleCompatSection, /NULL/);

  assert.match(handleSwipeV2Section, /public\.event_deck_validate_presented_card/);
  assert.match(handleSwipeV2Section, /public\.event_deck_swipe_failure_response/);
  assert.match(handleSwipeV2Section, /swiped_at = COALESCE\(swiped_at, now\(\)\)/);
  assert.match(handleSwipeV2Section, /public\.record_event_profile_impression_v2/);
  assert.match(handleSwipeV2Section, /handle_swipe_20260601183000_deck_authority_base/);
});

test("visible-card marking is idempotent and no longer consumes unacted cards", () => {
  assert.match(latestVisibleSection, /visible_dealt_already_recorded/);
  assert.match(latestVisibleSection, /'idempotent', true/);
  assert.match(latestVisibleSection, /video_date_impression_rank\(epi\.strongest_exclusion_reason\)[\s\S]*>= public\.video_date_impression_rank\('dealt'\)/);
  assert.match(redealMigration, /Repeated visible marks are idempotent and do not consume unacted cards/);
});

test("web, native, and edge clients pass deck tokens and stop retrying terminal visible-mark failures", () => {
  assert.match(webSwipeHook, /deck_token: deckToken \?\? null/);
  assert.match(nativeEventsApi, /deck_token: deckToken \?\? null/);
  assert.match(swipeActions, /handle_swipe_v2/);
  assert.match(swipeActions, /p_deck_token: normalizedDeckToken/);

  assert.match(webLobby, /TERMINAL_VISIBLE_CARD_MARK_ERRORS/);
  assert.match(webLobby, /VISIBLE_CARD_MARK_MAX_RETRIES = 5/);
  assert.match(webLobby, /retryCount >= VISIBLE_CARD_MARK_MAX_RETRIES/);
  assert.match(webLobby, /p_deck_token: deckToken/);
  assert.match(webLobby, /currentProfile\?\.deck_token/);
  assert.match(webLobby, /eventDeckVisibleCardKey\(eventId, viewerId, targetId, deckToken\)/);
  assert.match(webLobby, /if \(cancelled \|\| visibleDeckMarkAttempts\.get\(key\) !== attemptId\) return;/);
  assert.match(webLobby, /event_deck_card_visible_mark_result/);
  assert.match(webLobby, /event_deck_card_visible_terminal_removed/);
  assert.match(webLobby, /const removeDeckProfileAfterTerminalVisibleMark = useCallback/);
  assert.match(webLobby, /\(cachedTopProfile\.deck_token \?\? null\) !== expectedDeckToken/);
  assert.match(webLobby, /skipReason = "stale_deck_token"/);
  assert.match(webLobby, /if \(removed && shouldTopUpVideoDateDeck\(remainingVisible\)\) \{[\s\S]*invalidateQueries\(\{ queryKey: \["event-deck", eventId, user\?\.id\] \}\)/);
  assert.match(webLobby, /if \(shouldRetryVisibleCardMark\(reason\)\) \{[\s\S]*scheduleRetry\(\);[\s\S]*\} else \{[\s\S]*removeDeckProfileAfterTerminalVisibleMark\(targetId, deckToken, reason\);/);
  assert.doesNotMatch(webTerminalVisibleErrorsSection, /not_current_top_card/);
  assert.match(nativeLobby, /TERMINAL_VISIBLE_CARD_MARK_ERRORS/);
  assert.match(nativeLobby, /VISIBLE_CARD_MARK_MAX_RETRIES = 5/);
  assert.match(nativeLobby, /retryCount >= VISIBLE_CARD_MARK_MAX_RETRIES/);
  assert.match(nativeLobby, /p_deck_token: deckToken/);
  assert.match(nativeLobby, /current\?\.deck_token/);
  assert.match(nativeLobby, /eventDeckVisibleCardKey\(eventId, viewerId, targetId, deckToken\)/);
  assert.match(nativeLobby, /if \(cancelled \|\| visibleDeckMarkAttempts\.get\(key\) !== attemptId\) return;/);
  assert.match(nativeLobby, /event_deck_card_visible_mark_result/);
  assert.match(nativeLobby, /event_deck_card_visible_terminal_removed/);
  assert.match(nativeLobby, /const removeDeckProfileAfterTerminalVisibleMark = useCallback/);
  assert.match(nativeLobby, /\(cachedTopProfile\.deck_token \?\? null\) !== expectedDeckToken/);
  assert.match(nativeLobby, /skipReason = 'stale_deck_token'/);
  assert.match(nativeLobby, /if \(removed && shouldTopUpVideoDateDeck\(remainingVisible\)\) \{[\s\S]*scheduleDeckRefresh\('visible_mark_terminal_deck_empty', 0\)/);
  assert.match(nativeLobby, /if \(shouldRetryVisibleCardMark\(reason\)\) \{[\s\S]*scheduleRetry\(\);[\s\S]*\} else \{[\s\S]*removeDeckProfileAfterTerminalVisibleMark\(targetId, deckToken, reason\);/);
  assert.doesNotMatch(nativeTerminalVisibleErrorsSection, /not_current_top_card/);
});

test("shared adapters and generated types expose the new contract", () => {
  assert.match(adapters, /deck_token: string \| null/);
  assert.match(adapters, /deck_rank: number \| null/);
  assert.match(adapters, /reservation_ttl_seconds\?: number \| null/);
  assert.match(adapters, /sanitizeDeckString\(source\.mark_action/);
  assert.match(supabaseTypes, /event_deck_card_reservations: \{/);
  assert.match(supabaseTypes, /handle_swipe_v2: \{/);
  assert.match(supabaseTypes, /p_deck_token\?: string \| null/);
  assert.match(supabaseTypes, /event_deck_validate_presented_card: \{/);
});
