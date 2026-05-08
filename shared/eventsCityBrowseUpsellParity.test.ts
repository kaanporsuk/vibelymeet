import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const eventsPage = read("src/pages/Events.tsx");
const filterBar = read("src/components/events/EventsFilterBar.tsx");

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
