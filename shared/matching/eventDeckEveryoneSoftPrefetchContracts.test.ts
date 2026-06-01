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

function sectionBetween(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `${startNeedle.trim()} section should exist`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `${endNeedle.trim()} section should follow ${startNeedle.trim()}`);
  return source.slice(start, end);
}

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const migration = read("supabase/migrations/20260601170000_event_deck_everyone_and_soft_prefetch.sql");
const latestDailyDropSql = read("supabase/migrations/20260507190000_tier_config_backend_authority.sql");
const dailyDropMatcher = read("supabase/functions/_shared/dailyDropMatcher.ts");
const webLobby = read("src/pages/EventLobby.tsx");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const supabaseTypes = read("src/integrations/supabase/types.ts");

const preferenceSection = functionSection(migration, "preference_allows_gender");
const baseDeckSection = functionSection(migration, "get_event_deck_20260501180000_active_base");
const mysteryMatchSection = functionSection(migration, "find_mystery_match_20260501180000_active_base");
const impressionSection = functionSection(migration, "record_event_profile_impression_v2");
const deckV3Section = functionSection(migration, "get_event_deck_v3");
const visibleSection = functionSection(migration, "record_event_deck_card_visible_v1");
const latestDailyDropCandidatesSection = functionSection(latestDailyDropSql, "get_daily_drop_candidates");
const eventLogTypesSection = sectionBetween(
  supabaseTypes,
  "      event_profile_impression_events: {",
  "      event_profile_impressions: {",
);
const impressionTypesSection = sectionBetween(
  supabaseTypes,
  "      event_profile_impressions: {",
  "      event_registrations: {",
);

test("Event Deck gender compatibility treats everyone as unrestricted everywhere it matters", () => {
  assert.match(preferenceSection, /'everyone' = ANY\(prefs\)/);
  assert.match(preferenceSection, /replace\(lower\(btrim\(COALESCE\(p_gender, ''\)\)\), '_', '-'\) AS gender/);
  assert.match(preferenceSection, /replace\(lower\(btrim\(pref\.value\)\), '_', '-'\)/);
  assert.match(preferenceSection, /ARRAY\['man', 'men', 'm', 'male'\]/);
  assert.match(preferenceSection, /ARRAY\['woman', 'women', 'w', 'f', 'female'\]/);
  assert.match(preferenceSection, /ARRAY\['non-binary', 'nonbinary', 'non binary', 'nb'\]/);
  assert.match(baseDeckSection, /public\.preference_allows_gender\(viewer\.interested_in, p\.gender\)/);
  assert.match(baseDeckSection, /public\.preference_allows_gender\(p\.interested_in, viewer\.gender\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.check_gender_compatibility/);
  assert.match(migration, /public\.preference_allows_gender\(viewer\.interested_in, _target_gender\)/);
  assert.match(migration, /public\.preference_allows_gender\(_target_interested_in, viewer\.gender\)/);
  assert.match(mysteryMatchSection, /public\.preference_allows_gender\(v_user_interested_in, p\.gender\)/);
  assert.match(mysteryMatchSection, /public\.preference_allows_gender\(p\.interested_in, v_user_gender\)/);
});

test("Daily Drop matcher shares everyone and alias semantics", () => {
  assert.match(latestDailyDropCandidatesSection, /check_gender_compatibility\(p_user_id, p\.gender, p\.interested_in\)/);
  assert.match(dailyDropMatcher, /prefs\.includes\("everyone"\)/);
  assert.match(dailyDropMatcher, /replace\(\/_\/g, "-"\)/);
  assert.match(dailyDropMatcher, /"man", "men", "m", "male"/);
  assert.match(dailyDropMatcher, /"woman", "women", "w", "f", "female"/);
  assert.match(dailyDropMatcher, /"non-binary", "nonbinary", "non binary", "nb"/);
});

test("Deck v3 soft-prefetches buffered cards and visible top card records dealt", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS prefetch_expires_at timestamptz/);
  assert.match(migration, /WHEN 'prefetched' THEN 5/);
  assert.match(impressionSection, /EXCLUDED\.strongest_exclusion_reason IN \('prefetched', 'dealt'\)/);
  assert.match(impressionSection, /THEN event_profile_impressions\.last_action/);
  assert.match(impressionSection, /THEN event_profile_impressions\.source/);
  assert.match(impressionSection, /THEN event_profile_impressions\.session_id/);
  assert.match(impressionSection, /THEN event_profile_impressions\.metadata/);
  assert.match(impressionSection, /THEN event_profile_impressions\.updated_at/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.record_event_profile_impression_v2\(uuid, uuid, uuid, text, text, uuid, jsonb\)[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.record_event_profile_impression_v2\(uuid, uuid, uuid, text, text, uuid, jsonb\)[\s\S]*TO service_role/);
  assert.match(deckV3Section, /'prefetched'/);
  assert.match(deckV3Section, /'server_prefetched', true/);
  assert.match(deckV3Section, /'prefetch_ttl_seconds', 120/);
  assert.doesNotMatch(deckV3Section, /ranked\.profile_id,\s+'dealt',\s+'get_event_deck_v3_buffer'/);
  assert.match(visibleSection, /'dealt'/);
  assert.match(visibleSection, /public\.is_profile_hidden\(p_viewer_id\)/);
  assert.match(visibleSection, /'viewer_paused'/);
  assert.match(visibleSection, /'event_lobby_top_card_visible'/);
  assert.match(visibleSection, /'visible_top_card', true/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.record_event_deck_card_visible_v1\(uuid, uuid, uuid\)[\s\S]*TO authenticated, service_role/);
});

test("Web and native mark only rendered top cards as visible", () => {
  assert.match(webLobby, /visibleDeckCardsRef/);
  assert.match(webLobby, /visibleDeckMarkAttemptsRef/);
  assert.match(webLobby, /record_event_deck_card_visible_v1/);
  assert.match(webLobby, /currentProfile\.id/);
  assert.match(webLobby, /document\.visibilityState !== "visible"/);
  assert.match(webLobby, /result\?\.ok === false/);
  assert.match(webLobby, /scheduleRetry/);

  assert.match(nativeLobby, /visibleDeckCardsRef/);
  assert.match(nativeLobby, /visibleDeckMarkAttemptsRef/);
  assert.match(nativeLobby, /record_event_deck_card_visible_v1/);
  assert.match(nativeLobby, /current\.id/);
  assert.match(nativeLobby, /appState !== 'active'/);
  assert.match(nativeLobby, /showQueuedStyleConvergenceUi/);
  assert.match(nativeLobby, /result\?\.ok === false/);
  assert.match(nativeLobby, /scheduleRetry/);
});

test("Generated Supabase types know the new deck visibility and prefetch schema", () => {
  assert.equal(countOccurrences(eventLogTypesSection, "prefetch_expires_at"), 0);
  assert.equal(countOccurrences(impressionTypesSection, "prefetch_expires_at"), 3);
  assert.match(impressionTypesSection, /Row: \{[\s\S]*prefetch_expires_at: string \| null/);
  assert.match(impressionTypesSection, /Insert: \{[\s\S]*prefetch_expires_at\?: string \| null/);
  assert.match(impressionTypesSection, /Update: \{[\s\S]*prefetch_expires_at\?: string \| null/);
  assert.match(supabaseTypes, /record_event_deck_card_visible_v1/);
  assert.match(supabaseTypes, /record_event_deck_card_visible_v1: \{\s*Args: \{[\s\S]*p_deck_token\?: string \| null[\s\S]*p_event_id: string[\s\S]*p_target_id: string[\s\S]*p_viewer_id: string/);
  assert.match(supabaseTypes, /preference_allows_gender/);
});
