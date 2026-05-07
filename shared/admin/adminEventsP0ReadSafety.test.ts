import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const adminEventsPanel = readFileSync(join(root, "src/components/admin/AdminEventsPanel.tsx"), "utf8");
const adminEventControls = readFileSync(join(root, "src/components/admin/AdminEventControls.tsx"), "utf8");
const adminEventAttendees = readFileSync(join(root, "src/components/admin/AdminEventAttendeesModal.tsx"), "utf8");
const adminEventForm = readFileSync(join(root, "src/components/admin/AdminEventFormModal.tsx"), "utf8");
const batchEventImport = readFileSync(join(root, "src/components/admin/BatchEventImportModal.tsx"), "utf8");
const adminEventsHardeningMigration = readFileSync(
  join(root, "supabase/migrations/20260507150000_admin_events_tab_static_hardening.sql"),
  "utf8"
);
const adminEventScopeFollowupMigration = readFileSync(
  join(root, "supabase/migrations/20260507152000_admin_event_scope_legacy_location_specific_fix.sql"),
  "utf8"
);

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing source section start: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing source section end: ${endMarker}`);
  return source.slice(start, end);
}

test("admin events query uses the admin read model RPC", () => {
  const query = section(adminEventsPanel, "queryKey: ['admin-events'", "// Unique cities");

  assert.match(query, /callAdminRpc<AdminEventsPayload>\("admin_list_events"/);
  assert.match(query, /p_filters/);
  assert.match(query, /show_archived: showArchived/);
  assert.match(query, /p_limit: 1000/);
  assert.doesNotMatch(query, /\.from\(['"]events['"]\)/);
  assert.doesNotMatch(query, /\.select\(['"]\*['"]\)/);
  assert.doesNotMatch(query, /\.update\s*\(/);
  assert.doesNotMatch(query, /\.insert\s*\(/);
  assert.doesNotMatch(query, /\.upsert\s*\(/);
  assert.doesNotMatch(query, /\.delete\s*\(/);
});

test("admin event bulk selection is limited to rendered visible rows", () => {
  assert.match(adminEventsPanel, /const visibleEventIds = useMemo/);
  assert.match(adminEventsPanel, /expandedParents\.has\(event\.id\)/);
  assert.match(adminEventsPanel, /new Set\(visibleEventIds\)/);
  assert.match(adminEventsPanel, /const allVisibleSelected =/);
  assert.match(adminEventsPanel, /visible\.has\(id\)/);

  const toggleAll = section(adminEventsPanel, "const toggleSelectAll", "const renderEventRow");
  assert.match(toggleAll, /allVisibleSelected/);
  assert.match(toggleAll, /setSelectedIds\(new Set\(visibleEventIds\)\)/);
  assert.doesNotMatch(toggleAll, /filteredEvents\.map\(e => e\.id\)/);
});

test("admin event controls receive raw and computed lifecycle state", () => {
  assert.match(adminEventsPanel, /rawStatus=\{event\.status\}/);
  assert.match(adminEventsPanel, /computedStatus=\{computed\}/);
  assert.match(adminEventsPanel, /endedAt=\{event\.ended_at\}/);
  assert.match(adminEventsPanel, /archivedAt=\{event\.archived_at\}/);

  assert.match(adminEventControls, /rawStatus: string \| null/);
  assert.match(adminEventControls, /computedStatus: string/);
  assert.match(adminEventControls, /endedAt\?: string \| null/);
  assert.match(adminEventControls, /archivedAt\?: string \| null/);
  assert.match(adminEventControls, /normalizedComputedStatus === "ended"/);
  assert.match(adminEventControls, /normalizedComputedStatus === "live" && normalizedRawStatus !== "live"/);
  assert.match(adminEventControls, /isArchived \|\| isDraft \|\| isCancelled \|\| isCompleted \|\| endedAt/);
  assert.match(adminEventControls, /const showFinalizeEnd = isComputedEnded && !endedAt/);
  assert.match(adminEventControls, /kind: "finalize-end"/);
  assert.match(adminEventControls, /\{isLive && \(/);
  assert.match(adminEventControls, /\{\(isLive \|\| isUpcoming\) && \(/);
});

test("admin event computed lifecycle refreshes while the panel stays open", () => {
  assert.match(adminEventsPanel, /const \[lifecycleNowMs, setLifecycleNowMs\] = useState\(\(\) => Date\.now\(\)\)/);
  assert.match(adminEventsPanel, /window\.setInterval\(\(\) => setLifecycleNowMs\(Date\.now\(\)\), 30_000\)/);
  assert.match(adminEventsPanel, /getComputedStatus\(event, lifecycleNowMs\)/);
  assert.match(adminEventsPanel, /\[events, lifecycleNowMs, statusFilter, scopeFilter, cityFilter, dateFrom, dateTo\]/);
});

test("expired computed events cannot be cancelled from the row menu", () => {
  const rowRender = section(adminEventsPanel, "const renderEventRow", "return (");

  assert.match(rowRender, /computed !== 'ended'/);
  assert.match(rowRender, /!event\.ended_at/);
  assert.match(rowRender, /!\['cancelled', 'draft', 'completed'\]\.includes\(rawStatus\)/);
});

test("batch import emits only database-valid event statuses", () => {
  assert.match(batchEventImport, /const VALID_STATUSES = \["draft", "upcoming"\]/);
  assert.match(batchEventImport, /status: "upcoming"/);
  assert.match(batchEventImport, /status: ev\.status \|\| "upcoming"/);
  assert.match(batchEventImport, /Location-specific rows require coordinates/);
  assert.match(batchEventImport, /Local events require coordinates/);
  assert.match(batchEventImport, /Attendees must be 10000 or fewer/);
  assert.match(batchEventImport, /const genderCaps = \{/);
  assert.match(batchEventImport, /must be an integer/);
  assert.match(batchEventImport, /const scope = stringValue\(ev\.scope\)\.trim\(\)\.toLowerCase\(\) \|\| "global"/);
  assert.match(batchEventImport, /is_free must be true or false/);
  assert.match(batchEventImport, /is_location_specific must be true or false/);
  assert.match(batchEventImport, /VALID_VISIBILITIES/);
  assert.match(batchEventImport, /VALID_SCOPES/);
  assert.doesNotMatch(batchEventImport, /"scheduled"/);
});

test("attendees modal delegates attendance writes and removals to admin RPCs", () => {
  assert.match(adminEventAttendees, /callAdminRpc\("admin_remove_event_registration"/);
  assert.match(adminEventAttendees, /callAdminRpc<\{ affected_count\?: number \}>\("admin_mark_event_attendance"/);
  assert.match(adminEventAttendees, /p_registration_ids: \[registrationId\]/);
  assert.match(adminEventAttendees, /p_registration_ids: selectedAttendees/);
  assert.doesNotMatch(adminEventAttendees, /supabase\.rpc\("admin_remove_event_registration"/);
  assert.doesNotMatch(adminEventAttendees, /\.from\(['"]event_registrations['"]\)[\s\S]{0,300}\.update\(/);
});

test("admin events hardening migration owns reads, attendance writes, validation, and metrics semantics", () => {
  assert.match(adminEventsHardeningMigration, /CREATE OR REPLACE FUNCTION public\.admin_list_events/);
  assert.match(adminEventsHardeningMigration, /Event filters must be a JSON object/);
  assert.match(adminEventsHardeningMigration, /show_archived filter must be boolean/);
  assert.match(adminEventsHardeningMigration, /jsonb_build_object\(\s*'id', paged\.id/);
  assert.doesNotMatch(adminEventsHardeningMigration, /SELECT\s+e\.\*/);
  assert.doesNotMatch(adminEventsHardeningMigration, /to_jsonb\(paged\)/);
  assert.match(adminEventsHardeningMigration, /CREATE OR REPLACE FUNCTION public\.admin_mark_event_attendance/);
  assert.match(adminEventsHardeningMigration, /attendance_marked_by = v_admin_id/);
  assert.match(adminEventsHardeningMigration, /admin_idempotency_begin\(\s*v_admin_id,\s*'admin_mark_event_attendance'/);
  assert.match(adminEventsHardeningMigration, /CREATE OR REPLACE FUNCTION public\.admin_remove_event_registration/);
  assert.match(adminEventsHardeningMigration, /admin_idempotency_begin\(\s*v_admin_id,\s*'admin_remove_event_registration'/);
  assert.match(adminEventsHardeningMigration, /CREATE OR REPLACE FUNCTION public\.admin_validate_event_payload/);
  assert.match(adminEventsHardeningMigration, /status must be draft or upcoming when creating events/);
  assert.match(adminEventsHardeningMigration, /local events require latitude and longitude/);
  assert.match(adminEventsHardeningMigration, /location-specific events require latitude and longitude/);
  assert.match(adminEventsHardeningMigration, /v_limit integer := LEAST\(GREATEST\(COALESCE\(p_limit, 1000\), 1\), 1000\)/);
  assert.match(adminEventsHardeningMigration, /v_radius integer/);
  assert.doesNotMatch(adminEventsHardeningMigration, /radius_km'\), ''\)::double precision/);
  assert.match(adminEventsHardeningMigration, /CREATE OR REPLACE FUNCTION public\.admin_end_event/);
  assert.match(adminEventsHardeningMigration, /COALESCE\(v_before\.status, ''\) IN \('completed', 'cancelled'\)/);
  assert.doesNotMatch(adminEventsHardeningMigration, /COALESCE\(v_before\.status, ''\) IN \('ended', 'completed', 'cancelled'\)/);
  assert.match(adminEventsHardeningMigration, /confirmed_attendance', v_attended/);
  assert.match(adminEventsHardeningMigration, /attendance_marked_count', v_attendance_marked/);
  assert.match(adminEventsHardeningMigration, /no_show_count', v_no_show/);
  assert.match(adminEventsHardeningMigration, /WHERE event_id = p_event_id AND attended IS TRUE/);
  assert.doesNotMatch(adminEventsHardeningMigration, /attendance_marked IS TRUE OR attended IS TRUE/);
});

test("admin event updates clear legacy location-specific state when scope moves non-local", () => {
  assert.match(adminEventForm, /is_location_specific:\s*scope === ['"]local['"]/);
  assert.match(adminEventScopeFollowupMigration, /CREATE OR REPLACE FUNCTION public\.admin_update_event/);
  assert.match(adminEventScopeFollowupMigration, /v_effective := to_jsonb\(v_before\) \|\| p_payload/);
  assert.match(adminEventScopeFollowupMigration, /jsonb_set\(v_effective, '\{is_location_specific\}', 'false'::jsonb, true\)/);
  assert.match(adminEventScopeFollowupMigration, /admin_validate_event_payload\(v_effective, false\)/);
  assert.match(adminEventScopeFollowupMigration, /WHEN p_payload \? 'scope' AND COALESCE\(NULLIF\(lower\(p_payload ->> 'scope'\), ''\), 'global'\) <> 'local' THEN false/);
  assert.match(adminEventScopeFollowupMigration, /REVOKE ALL ON FUNCTION public\.admin_update_event\(uuid, jsonb, text\) FROM PUBLIC, anon, authenticated/);
  assert.match(adminEventScopeFollowupMigration, /GRANT EXECUTE ON FUNCTION public\.admin_update_event\(uuid, jsonb, text\) TO authenticated/);
});

test("admin event form footer submits through validation path", () => {
  const footer = section(adminEventForm, "{/* Footer */}", "</motion.div>");

  assert.match(adminEventForm, /<form id=\{formId\} onSubmit=\{handleSubmit\}/);
  assert.match(footer, /<Button type="submit" form=\{formId\}/);
  assert.doesNotMatch(footer, /saveEvent\.mutate\(\)/);
});
