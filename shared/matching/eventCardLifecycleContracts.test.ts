import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readProjectFile(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

test("premium and featured event cards use shared lifecycle badge resolution", () => {
  const eventCardPremium = readProjectFile("src/components/events/EventCardPremium.tsx");
  const featuredEventCard = readProjectFile("src/components/events/FeaturedEventCard.tsx");
  const mobileEventsScreen = readProjectFile("apps/mobile/app/(tabs)/events/index.tsx");

  assert.match(eventCardPremium, /@clientShared\/eventCardLifecycle/);
  assert.match(eventCardPremium, /resolveEventCardLifecycle/);
  assert.doesNotMatch(eventCardPremium, /status === "live"/);
  assert.doesNotMatch(eventCardPremium, /isEventExpired/);

  assert.match(featuredEventCard, /@clientShared\/eventCardLifecycle/);
  assert.match(featuredEventCard, /resolveEventCardLifecycle/);
  assert.match(featuredEventCard, /setCardLifecycle\(nextLifecycle\)/);
  assert.doesNotMatch(featuredEventCard, /status === "live"/);
  assert.doesNotMatch(featuredEventCard, /now\.getTime\(\) >= startTime && now\.getTime\(\) < endTime/);
  assert.doesNotMatch(featuredEventCard, /setIsLive\(true\)/);

  assert.match(mobileEventsScreen, /@clientShared\/eventCardLifecycle/);
  assert.match(mobileEventsScreen, /resolveEventCardLifecycle/);
  assert.match(mobileEventsScreen, /resolveMobileEventCardLifecycle/);
  assert.doesNotMatch(mobileEventsScreen, /const isLive = event\.status === 'live'/);
  assert.doesNotMatch(mobileEventsScreen, /setIsLive\(true\)/);
});

test("event list surfaces pass terminal lifecycle fields into cards", () => {
  const useEvents = readProjectFile("src/hooks/useEvents.ts");
  const eventsPage = readProjectFile("src/pages/Events.tsx");
  const eventsRail = readProjectFile("src/components/events/EventsRail.tsx");
  const mobileEventsApi = readProjectFile("apps/mobile/lib/eventsApi.ts");

  assert.match(useEvents, /archived_at: event\.archived_at/);
  assert.match(useEvents, /ended_at: event\.ended_at/);
  assert.match(eventsPage, /archived_at: e\.archived_at \?\? null/);
  assert.match(eventsPage, /ended_at: e\.ended_at \?\? null/);
  assert.match(eventsPage, /archivedAt=\{event\.archived_at\}/);
  assert.match(eventsPage, /endedAt=\{event\.ended_at\}/);
  assert.match(eventsPage, /archivedAt=\{featuredEvent\.archived_at\}/);
  assert.match(eventsPage, /endedAt=\{featuredEvent\.ended_at\}/);
  assert.match(eventsRail, /archivedAt=\{event\.archived_at\}/);
  assert.match(eventsRail, /endedAt=\{event\.ended_at\}/);
  assert.match(mobileEventsApi, /@clientShared\/eventCardLifecycle/);
  assert.match(mobileEventsApi, /archived_at\?: string \| null/);
  assert.match(mobileEventsApi, /ended_at\?: string \| null/);
  assert.match(mobileEventsApi, /resolveEventCardLifecycle/);
  assert.match(mobileEventsApi, /archived_at: row\.archived_at/);
  assert.match(mobileEventsApi, /ended_at: row\.ended_at/);
  assert.match(mobileEventsApi, /archived_at: e\.archived_at/);
  assert.match(mobileEventsApi, /ended_at: e\.ended_at/);
});
