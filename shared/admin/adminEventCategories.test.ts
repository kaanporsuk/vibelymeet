import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260509120000_admin_managed_event_categories.sql");
const adminForm = read("src/components/admin/AdminEventFormModal.tsx");
const adminPanel = read("src/components/admin/AdminEventsPanel.tsx");
const adminCreateEvent = read("src/pages/AdminCreateEvent.tsx");
const batchImport = read("src/components/admin/BatchEventImportModal.tsx");
const webFilters = read("src/components/events/EventsFilterBar.tsx");
const webEvents = read("src/pages/Events.tsx");
const mobileFilters = read("apps/mobile/components/events/EventFilterSheet.tsx");
const mobileEvents = read("apps/mobile/app/(tabs)/events/index.tsx");
const visibleHook = read("src/hooks/useVisibleEvents.ts");
const eventDetailsHook = read("src/hooks/useEventDetails.ts");

test("migration creates admin-managed event categories and category key storage", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.event_categories/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS category_keys text\[\] NOT NULL DEFAULT ARRAY\[\]::text\[\]/);
  assert.match(migration, /admin_create_event_category/);
  assert.match(migration, /admin_update_event_category/);
  assert.match(migration, /infer_event_category_keys_from_legacy_tags/);
  assert.match(migration, /category_keys\s+text\[\]/);
  assert.match(migration, /categories\s+jsonb/);
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS unaccent/);
  assert.match(migration, /unaccent\(lower/);
});

test("admin event form creates and saves category keys separately from vibes and tags", () => {
  assert.match(adminForm, /CollapsibleSection title="Categories"/);
  assert.match(adminForm, /admin_create_event_category/);
  assert.match(adminForm, /selectedCategoryKeys/);
  assert.match(adminForm, /category_keys: selectedCategoryKeys/);
  assert.match(adminForm, /inferEventCategoryKeysFromLegacyTags/);
  assert.doesNotMatch(adminForm, /const eventThemes =/);
});

test("admin events panel includes lightweight category manager", () => {
  assert.match(adminPanel, /AdminEventCategoryManager/);
  assert.match(adminPanel, /admin_update_event_category/);
  assert.match(adminPanel, /onToggleActive/);
  assert.match(adminPanel, /sortOrder/);
  assert.match(adminPanel, /searchParams\.get\("create"\) !== "event"/);
  assert.match(adminCreateEvent, /Navigate to="\/kaan\/dashboard\?panel=events&create=event"/);
  assert.doesNotMatch(adminCreateEvent, /eventThemes/);
});

test("batch import maps legacy tags into category keys", () => {
  assert.match(batchImport, /inferEventCategoryKeysFromLegacyTags/);
  assert.match(batchImport, /category_keys/);
  assert.match(batchImport, /ev\.category_keys \|\| inferEventCategoryKeysFromLegacyTags/);
});

test("web and mobile filters load active categories from event_categories", () => {
  assert.match(webFilters, /useEventCategories/);
  assert.match(mobileFilters, /useEventCategories/);
  assert.match(webFilters, /usingPlaceholderCategories/);
  assert.match(mobileEvents, /usingPlaceholderCategories/);
  assert.match(webFilters, /activeCategoryKeys/);
  assert.match(mobileEvents, /activeCategoryKeys/);
  assert.match(webEvents, /event\.category_keys\.some/);
  assert.match(mobileEvents, /e\.category_keys \?\? \[\]/);
  assert.match(webEvents, /e\.categories\.some/);
  assert.match(mobileEvents, /e\.categories \?\? \[\]/);
});

test("discovery and details surfaces expose category display metadata", () => {
  assert.match(visibleHook, /categories\?: EventCategory\[\]/);
  assert.match(eventDetailsHook, /categories: EventCategory\[\]/);
  assert.match(eventDetailsHook, /\.from\("event_categories"\)/);
});
