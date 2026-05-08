import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const eventsPage = read("src/pages/Events.tsx");
const filterBar = read("src/components/events/EventsFilterBar.tsx");
const nativeEventsPage = read("apps/mobile/app/(tabs)/events/index.tsx");
const nativeFilterSheet = read("apps/mobile/components/events/EventFilterSheet.tsx");
const nativeEventsApi = read("apps/mobile/lib/eventsApi.ts");
const tierBackendAuthority = read("supabase/migrations/20260507190000_tier_config_backend_authority.sql");

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing source section start: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing source section end: ${endMarker}`);
  return source.slice(start, end);
}

test("free web users can reveal city browse upsell without sending city browse coordinates", () => {
  const entitlementReset = section(eventsPage, "useEffect(() => {\n    if (!canCityBrowse", "const visibleOpts");
  assert.match(entitlementReset, /setSelectedCity\(null\)/);
  assert.doesNotMatch(entitlementReset, /setLocationMode\("nearby"\)/);

  const visibleOptions = section(eventsPage, "const visibleOpts = useMemo", "const { data: events = []");
  assert.match(visibleOptions, /const mode: "nearby" \| "city" = !canCityBrowse \? "nearby" : locationMode/);
  assert.match(visibleOptions, /const city = mode === "city" && canCityBrowse \? selectedCity : null/);
  assert.match(visibleOptions, /selectedCity: city/);
});

test("events filter bar keeps locked city guidance distinct from premium city search", () => {
  assert.match(filterBar, /locationMode === 'city' && !canCityBrowse/);
  assert.match(filterBar, /Discover events in other cities/);
  assert.match(filterBar, /Search and join events anywhere in the world with Vibely Premium/);
  assert.match(filterBar, /Upgrade to Premium/);
  assert.match(filterBar, /locationMode === 'city' && canCityBrowse/);
  assert.match(filterBar, /placeholder="Search for a city\.\.\."/);
});

test("native event filter sheet preserves the same free and premium city browse split", () => {
  assert.match(nativeFilterSheet, /if \(f\.locationMode === 'city' && !canCityBrowse\)/);
  assert.match(nativeFilterSheet, /setDraft\(prev => \(\{ \.\.\.prev, locationMode: 'city', distanceKm: 25 \}\)\)/);
  assert.match(nativeFilterSheet, /draft\.locationMode === 'city' && !canCityBrowse/);
  assert.match(nativeFilterSheet, /Discover events in other cities/);
  assert.match(nativeFilterSheet, /draft\.locationMode === 'city' && canCityBrowse/);
  assert.match(nativeFilterSheet, /placeholder="Search for a city\.\.\."/);

  assert.match(nativeEventsPage, /locationMode: !canCityBrowse \? 'nearby' : filters\.locationMode/);
  assert.match(nativeEventsPage, /selectedCity: canCityBrowse && filters\.locationMode === 'city' \? filters\.selectedCity : null/);
  assert.match(nativeEventsApi, /const mode = !d\?\.canCityBrowse \? 'nearby' : \(d\.locationMode \?\? 'nearby'\)/);
  assert.match(nativeEventsApi, /if \(mode === 'city' && d\?\.canCityBrowse && d\.selectedCity\)/);
});

test("backend city browse remains server-authoritative even if a client sends browse coordinates", () => {
  assert.match(tierBackendAuthority, /_get_user_tier_capability_bool_unchecked\(p_user_id, 'canCityBrowse'\)/);
  assert.match(tierBackendAuthority, /v_browse_requested := p_browse_lat IS NOT NULL OR p_browse_lng IS NOT NULL/);
  assert.match(tierBackendAuthority, /IF NOT v_can_city_browse AND v_browse_requested THEN/);
  assert.match(tierBackendAuthority, /WHEN v_can_city_browse AND v_valid_browse_coords THEN p_browse_lat/);
  assert.match(tierBackendAuthority, /WHEN v_can_city_browse AND v_valid_browse_coords THEN p_browse_lng/);
});
