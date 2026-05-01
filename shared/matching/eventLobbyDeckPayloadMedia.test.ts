import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { parseEventDeckProfiles } from "../../supabase/functions/_shared/eventProfileAdapters";

const root = process.cwd();
const migrationPath = "supabase/migrations/20260501230000_event_lobby_deck_payload_media.sql";
const migration = read(migrationPath);
const validation = read("supabase/validation/event_lobby_deck_payload_media.sql");
const readyQueueValidation = read("supabase/validation/event_lobby_ready_queue_contract.sql");
const adapter = read("supabase/functions/_shared/eventProfileAdapters.ts");
const webCard = read("src/components/lobby/LobbyProfileCard.tsx");
const profilePhoto = read("src/components/ui/ProfilePhoto.tsx");
const webImageUrl = read("src/utils/imageUrl.ts");
const nativeLobby = read("apps/mobile/app/event/[eventId]/lobby.tsx");
const generatedTypes = read("src/integrations/supabase/types.ts");
const deckContract = read("docs/contracts/event-lobby-deck-payload-contract.md");

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

function sqlWithoutCommentsOrStringLiterals(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/'(?:''|[^'])*'/g, "''");
}

function functionResultSection(sql: string): string {
  const start = sql.indexOf("RETURNS TABLE(");
  assert.notEqual(start, -1, "migration should declare a table return shape");
  const end = sql.indexOf(")\nLANGUAGE plpgsql", start);
  assert.notEqual(end, -1, "migration should close the table return shape");
  return sql.slice(start, end);
}

function sectionBetween(content: string, startMarker: string, endMarker: string): string {
  const start = content.indexOf(startMarker);
  assert.notEqual(start, -1, `expected ${startMarker} section to exist`);
  const end = content.indexOf(endMarker, start);
  assert.notEqual(end, -1, `expected ${endMarker} marker after ${startMarker}`);
  return content.slice(start, end);
}

test("deck payload migration sorts after Ready Gate / queue contract", () => {
  const versions = readdirSync(join(root, "supabase/migrations"))
    .map((name) => name.slice(0, 14))
    .filter((version) => /^\d{14}$/.test(version))
    .sort();

  assert.ok(versions.includes("20260501225000"), "Ready Gate queue contract migration should be present");
  assert.ok(versions.includes("20260501230000"), "deck payload media migration should be present");
  assert.ok(
    versions.indexOf("20260501230000") > versions.indexOf("20260501225000"),
    "deck payload migration must sort after Prompt 4",
  );
});

test("get_event_deck exposes only the safe card rendering payload additions", () => {
  const result = functionResultSection(migration);
  for (const field of [
    "primary_photo_path text",
    "photo_verified boolean",
    "premium_badge text",
    "availability_state text",
  ]) {
    assert.match(result, new RegExp(field));
  }
  for (const forbidden of [
    "proof_selfie",
    "moderation",
    "suspension",
    "report",
    "block",
    "phone",
    "email",
    "photo_verified_at",
    "premium_until",
    "subscription_tier",
  ]) {
    assert.doesNotMatch(result, new RegExp(forbidden, "i"));
  }
});

test("get_event_deck preserves active-event, busy-user, auth, security, and grants", () => {
  assert.match(migration, /DROP FUNCTION IF EXISTS public\.get_event_deck\(uuid, uuid, integer\)/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path TO 'public'/);
  assert.match(migration, /v_viewer IS NULL OR v_viewer <> p_user_id/);
  assert.match(migration, /public\.get_event_lobby_active_state\(p_event_id, now\(\)\)/);
  assert.match(migration, /RAISE EXCEPTION 'event_not_active'/);
  assert.match(migration, /public\.get_event_deck_20260501180000_active_base/);
  assert.match(migration, /COALESCE\(base\.queue_status, 'idle'\) IN \('browsing', 'idle'\)/);
  assert.match(migration, /vs\.ready_gate_status IN \('ready', 'ready_a', 'ready_b', 'both_ready', 'snoozed'\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_event_deck\(uuid, uuid, integer\)[\s\S]*TO authenticated, service_role/);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.get_event_deck\(uuid, uuid, integer\)[\s\S]*TO anon/);
});

test("adapter parses safe payload fields and normalizes media fallback", () => {
  const parsed = parseEventDeckProfiles([
    {
      profile_id: "11111111-1111-4111-8111-111111111111",
      name: "Ada",
      age: 31,
      gender: "woman",
      avatar_url: "photos/avatar.jpg",
      photos: [" ", "\"\"", "'photos/second.jpg'"],
      about_me: "Builder",
      job: "Engineer",
      location: "Istanbul",
      height_cm: 172,
      tagline: "Curious",
      looking_for: "relationship",
      queue_status: "browsing",
      has_met_before: false,
      is_already_connected: false,
      has_super_vibed: true,
      shared_vibe_count: 3,
      photo_verified: true,
      premium_badge: "vip",
      availability_state: "available",
    },
  ]);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].primary_photo_path, "photos/second.jpg");
  assert.equal(parsed[0].photo_verified, true);
  assert.equal(parsed[0].premium_badge, "vip");
  assert.equal(parsed[0].availability_state, "available");
  assert.deepEqual(parsed[0].photos, ["photos/second.jpg"]);
});

test("adapter ignores unsafe or unknown premium payload values", () => {
  const parsed = parseEventDeckProfiles([
    {
      profile_id: "22222222-2222-4222-8222-222222222222",
      name: "Grace",
      age: null,
      gender: "woman",
      avatar_url: "'photos/avatar.jpg'",
      photos: [],
      about_me: null,
      job: null,
      location: null,
      height_cm: null,
      tagline: null,
      looking_for: null,
      queue_status: "idle",
      has_met_before: false,
      is_already_connected: false,
      has_super_vibed: false,
      shared_vibe_count: 0,
      primary_photo_path: null,
      photo_verified: false,
      premium_badge: "internal_admin",
      availability_state: null,
    },
  ]);

  assert.equal(parsed[0].primary_photo_path, "photos/avatar.jpg");
  assert.equal(parsed[0].premium_badge, null);
  assert.equal(parsed[0].availability_state, "available");
});

test("web card renders premium and photo verification from deck payload without per-card profile fetch", () => {
  assert.doesNotMatch(webCard, /\.from\(["']profiles["']\)/);
  assert.doesNotMatch(webCard, /subscription_tier, photo_verified/);
  assert.doesNotMatch(webCard, /useEffect\(/);
  assert.match(webCard, /const profileBadge = profile\.premium_badge/);
  assert.match(webCard, /const photoVerified = profile\.photo_verified === true/);
  assert.match(webCard, /primaryPhotoPath=\{profile\.primary_photo_path\}/);
});

test("web media fallback uses first valid photo, then avatar, and full cards use deck-card preset", () => {
  assert.match(profilePhoto, /resolvePrimaryProfilePhotoPath/);
  assert.match(profilePhoto, /primaryPhotoPath \?\?/);
  assert.match(profilePhoto, /avatarUrl \? sizePreset\(avatarUrl\) : null/);
  assert.match(profilePhoto, /size === "full" \? deckCardPreset/);
  assert.match(webImageUrl, /export const deckCardUrl/);
  assert.match(webImageUrl, /width: 1080,\s*height: 1440,\s*crop: "center",\s*quality: 88/s);
});

test("native lobby card consumes the same payload and avoids per-card profile RPC", () => {
  const nativeCard = sectionBetween(nativeLobby, "function LobbyProfileCard({", "\nconst styles = StyleSheet.create");

  assert.doesNotMatch(nativeCard, /get_profile_for_viewer/);
  assert.match(nativeCard, /const photoVerified = profile\.photo_verified === true/);
  assert.match(nativeCard, /const premiumBadge = profile\.premium_badge/);
  assert.match(nativeCard, /profile\.primary_photo_path \?\?/);
  assert.match(nativeCard, /deckCardUrl\(photo\)/);
});

test("generated Supabase types include the RPC return-shape additions", () => {
  const getDeckStart = generatedTypes.indexOf("get_event_deck:");
  assert.notEqual(getDeckStart, -1, "generated types should include get_event_deck");
  const getDeckEnd = generatedTypes.indexOf("get_event_visible_attendees:", getDeckStart);
  assert.notEqual(getDeckEnd, -1, "generated types should include the next function marker");
  const getDeck = generatedTypes.slice(getDeckStart, getDeckEnd);

  for (const field of ["primary_photo_path", "photo_verified", "premium_badge", "availability_state"]) {
    assert.match(getDeck, new RegExp(`${field}:`));
  }
});

test("contract docs and validation cover rebuild delta and forbidden fields", () => {
  assert.match(deckContract, /Safe Payload/);
  assert.match(deckContract, /Forbidden Fields/);
  assert.match(deckContract, /first valid `photos\[\]` entry/);
  assert.match(deckContract, /deck-card image preset/);
  assert.match(validation, /forbidden_private_fields_not_returned/);
  assert.match(validation, /primary_photo_path text/);
  assert.match(readyQueueValidation, /COALESCE\(%queue_status/);
  assert.doesNotMatch(sqlWithoutCommentsOrStringLiterals(validation), /\b(insert|update|delete|truncate|alter|drop|create|grant|revoke)\b/i);
  assert.doesNotMatch(adapter, /proof_selfie|phone_number|verified_email|photo_verified_at|premium_until/);
});
