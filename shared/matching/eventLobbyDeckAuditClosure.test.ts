import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEventDeckResponse } from "../../supabase/functions/_shared/eventProfileAdapters";

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
  assert.notEqual(start, -1, `${startNeedle} section should exist`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `${endNeedle} section should follow`);
  return source.slice(start, end);
}

const migration = read("supabase/migrations/20260601213000_event_lobby_deck_audit_closure.sql");
const mutualMatchHandoffClosure = read("supabase/migrations/20260607103000_video_date_mutual_match_handoff_closure.sql");
const swipeActions = read("supabase/functions/swipe-actions/index.ts");
const outboxDrainer = read("supabase/functions/video-date-outbox-drainer/index.ts");
const adapters = read("supabase/functions/_shared/eventProfileAdapters.ts");

const cleanupSection = functionSection(migration, "cleanup_event_deck_card_reservations");
const mysterySection = functionSection(migration, "find_mystery_match_20260501180000_active_base");
const scheduledMysteryDelegateSection = functionSection(migration, "find_mystery_match_20260502083000_active_base");
const deckV3Section = functionSection(migration, "get_event_deck_v3");
const vibeNotificationBlock = sectionBetween(
  swipeActions,
  'category: "someone_vibed_you"',
  "logLifecycle({\n          event_id: eventIdStr",
);

test("reservation cleanup is service-only, bounded, and scheduled when pg_cron is available", () => {
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_event_deck_card_reservations_expires_cleanup[\s\S]+ON public\.event_deck_card_reservations\(expires_at\)/);
  assert.match(cleanupSection, /p_older_than interval DEFAULT interval '1 day'/);
  assert.match(cleanupSection, /v_limit integer := GREATEST\(1, LEAST\(COALESCE\(p_limit, 5000\), 50000\)\)/);
  assert.match(cleanupSection, /v_older_than < interval '5 minutes'/);
  assert.match(cleanupSection, /FROM public\.event_deck_card_reservations r/);
  assert.match(cleanupSection, /ORDER BY r\.expires_at/);
  assert.match(cleanupSection, /LIMIT v_limit/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.cleanup_event_deck_card_reservations\(interval, integer\)[\s\S]+FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.cleanup_event_deck_card_reservations\(interval, integer\)[\s\S]+TO service_role/);
  assert.match(migration, /pg_cron/);
  assert.match(migration, /cleanup-event-deck-card-reservations-hourly/);
  assert.match(migration, /cron\.schedule/);
  assert.match(deckV3Section, /public\.cleanup_event_deck_card_reservations\(interval '1 day', 5000\)/);
});

test("Mystery Match delegates candidate choice to canonical deck eligibility", () => {
  assert.match(mysterySection, /public\.event_deck_candidate_eligibility\(/);
  assert.match(mysterySection, /p_event_id,\s+p_user_id,\s+er\.profile_id,\s+true,\s+true/);
  assert.match(mysterySection, /COALESCE\(er\.queue_status, 'idle'\) = 'browsing'/);
  assert.match(mysterySection, /FOR UPDATE OF er SKIP LOCKED/);
  assert.match(mysterySection, /pg_try_advisory_xact_lock/);
  assert.match(mysterySection, /event_lobby_participant_session:/);
  assert.match(mysterySection, /FOR UPDATE NOWAIT/);
  assert.match(mysterySection, /GET DIAGNOSTICS v_locked_count = ROW_COUNT/);
  assert.match(mysterySection, /ON CONFLICT \(event_id, participant_1_id, participant_2_id\) DO NOTHING/);
  assert.match(mysterySection, /pair_already_in_session/);
  assert.match(mysterySection, /viewer_unavailable/);
  assert.doesNotMatch(mysterySection, /JOIN public\.profiles p ON p\.id = er\.profile_id/);

  assert.match(scheduledMysteryDelegateSection, /public\.get_event_lobby_active_state\(p_event_id, now\(\)\)/);
  assert.match(scheduledMysteryDelegateSection, /RETURN public\.find_mystery_match_20260501180000_active_base\(/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.find_mystery_match_20260502083000_active_base\(uuid, uuid\)[\s\S]+TO service_role/);
});

test("Mystery Match sessions are durably labelled separately from reciprocal swipes", () => {
  assert.match(mutualMatchHandoffClosure, /ADD COLUMN IF NOT EXISTS session_source text/);
  assert.match(mutualMatchHandoffClosure, /session_source = 'mystery_match'/);
  assert.match(mutualMatchHandoffClosure, /'session_source', 'mystery_match'/);
  assert.match(mutualMatchHandoffClosure, /find_mystery_match_20260607103000_session_source_base/);
});

test("deck v3 filters returned cards through swipe-authority eligibility and emits precise empty reasons", () => {
  assert.match(deckV3Section, /v_confirmed_candidate_count integer := 0/);
  assert.match(deckV3Section, /v_eligible_unswiped_count integer := 0/);
  assert.match(deckV3Section, /v_eligible_count integer := 0/);
  assert.match(deckV3Section, /eligible_raw AS \(/);
  assert.match(deckV3Section, /public\.event_deck_candidate_eligibility\(/);
  assert.match(deckV3Section, /eligible_count AS \(/);
  assert.match(deckV3Section, /confirmed_candidate_count/);
  assert.match(deckV3Section, /eligible_unswiped_count/);
  assert.match(deckV3Section, /WHEN v_profile_count > 0 THEN 'has_profiles'/);
  assert.match(deckV3Section, /WHEN v_eligible_count > 0 THEN 'no_remaining_profiles'/);
  assert.match(deckV3Section, /WHEN v_raw_count > 0 THEN 'scan_window_exhausted'/);
  assert.match(deckV3Section, /WHEN v_eligible_unswiped_count > 0 THEN 'no_remaining_profiles'/);
  assert.match(deckV3Section, /WHEN v_confirmed_candidate_count = 0 THEN 'no_confirmed_candidates'/);
  assert.match(deckV3Section, /ELSE 'scan_window_exhausted'/);
  assert.doesNotMatch(deckV3Section, /ranked\.profile_id,\s+'dealt',\s+'get_event_deck_v3_buffer'/);
});

test("web and native adapters preserve granular empty states", () => {
  assert.match(adapters, /"no_confirmed_candidates"/);
  assert.match(adapters, /"scan_window_exhausted"/);
  assert.doesNotMatch(
    adapters,
    /value === "no_confirmed_candidates" \|\| value === "scan_window_exhausted"[\s\S]+return "no_remaining_profiles"/,
  );

  assert.equal(
    parseEventDeckResponse({ ok: true, profiles: [], deck_state: { reason: "ready" } }).deckState.reason,
    "has_profiles",
  );
  assert.equal(
    parseEventDeckResponse({
      ok: true,
      profiles: [],
      deck_state: { reason: "no_confirmed_candidates", confirmed_candidate_count: 0 },
    }).deckState.reason,
    "no_confirmed_candidates",
  );
  assert.equal(
    parseEventDeckResponse({
      ok: true,
      profiles: [],
      deck_state: { reason: "scan_window_exhausted", confirmed_candidate_count: 12, raw_count: 0 },
    }).deckState.reason,
    "scan_window_exhausted",
  );
});

test("one-way vibe push data stays anonymous while server notification attribution remains available", () => {
  assert.match(vibeNotificationBlock, /data: \{ url: "\/events", event_id: eventIdStr \}/);
  assert.match(vibeNotificationBlock, /actorId,\s+targetId: String\(target_id\)/);
  assert.doesNotMatch(
    sectionBetween(vibeNotificationBlock, "data:", "dedupeKey:"),
    /actor_id|actorId/,
  );
  assert.match(outboxDrainer, /if \(typeof row\.payload\.actor_id === "string"\) requestBody\.actor_id = row\.payload\.actor_id/);
  assert.match(outboxDrainer, /if \(typeof row\.payload\.actorId === "string"\) requestBody\.actor_id = row\.payload\.actorId/);
});
