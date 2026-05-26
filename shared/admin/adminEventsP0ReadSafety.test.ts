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
const adminEventNonLocalScopeFollowupMigration = readFileSync(
  join(root, "supabase/migrations/20260507210000_admin_event_non_local_scope_force_legacy_flag.sql"),
  "utf8"
);
const eventLifecycleAutoFinalizationMigration = readFileSync(
  join(root, "supabase/migrations/20260508114500_event_lifecycle_archived_status_guards.sql"),
  "utf8"
);
const unarchiveStatusOnlyRepairMigration = readFileSync(
  join(root, "supabase/migrations/20260508131000_admin_unarchive_status_only_archived_repair.sql"),
  "utf8"
);
const profileDirectPrivacyMigration = readFileSync(
  join(root, "supabase/migrations/20260517123000_profile_direct_select_self_only.sql"),
  "utf8"
);
const adminGapClosureDefinitiveMigration = readFileSync(
  join(root, "supabase/migrations/20260526100000_admin_gap_closure_definitive.sql"),
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
  const query = section(adminEventsPanel, "queryKey: ['admin-events'", "// Filtered events are now server-side paginated");

  assert.match(query, /callAdminRpc<AdminEventsPayload>\("admin_list_events"/);
  assert.match(query, /p_filters/);
  assert.match(query, /debouncedSearchQuery/);
  assert.match(query, /show_archived: showArchived/);
  assert.match(query, /status: statusFilter === "all" \? null : statusFilter/);
  assert.match(query, /scope: scopeFilter === "all" \? null : scopeFilter/);
  assert.match(query, /city: cityFilter === "all" \? null : cityFilter\.trim\(\) \|\| null/);
  assert.match(query, /date_from: dateFrom \|\| null/);
  assert.match(query, /date_to: dateTo \|\| null/);
  assert.match(query, /p_limit: EVENTS_PAGE_SIZE/);
  assert.match(query, /p_offset: pageIndex \* EVENTS_PAGE_SIZE/);
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
  assert.match(adminEventsPanel, /isInFinalizationGrace=\{lifecycle\.isInFinalizationGrace\}/);
  assert.match(adminEventsPanel, /autoFinalizeAt=\{lifecycle\.autoFinalizeAt\}/);

  assert.match(adminEventControls, /rawStatus: string \| null/);
  assert.match(adminEventControls, /computedStatus: string/);
  assert.match(adminEventControls, /endedAt\?: string \| null/);
  assert.match(adminEventControls, /archivedAt\?: string \| null/);
  assert.match(adminEventControls, /isInFinalizationGrace\?: boolean/);
  assert.match(adminEventControls, /autoFinalizeAt\?: Date \| null/);
  assert.match(adminEventControls, /normalizedComputedStatus === "ended"/);
  assert.match(adminEventControls, /normalizedComputedStatus === "live" && normalizedRawStatus !== "live"/);
  assert.match(adminEventControls, /Boolean\(archivedAt\) \|\| normalizedRawStatus === "archived"/);
  assert.match(adminEventControls, /isArchived \|\| isDraft \|\| isCancelled \|\| isCompleted \|\| endedAt/);
  assert.match(adminEventControls, /const showWrapUpGrace = isComputedEnded && isInFinalizationGrace && !endedAt/);
  assert.match(adminEventControls, /Wrap-up\{autoFinalizeLabel/);
  assert.match(adminEventControls, /\+15 min/);
  assert.match(adminEventControls, /End now/);
  assert.doesNotMatch(adminEventControls, /Finalize End/);
  assert.doesNotMatch(adminEventControls, /kind: "finalize-end"/);
  assert.match(adminEventControls, /\{isLive && \(/);
  assert.match(adminEventControls, /\{\(isLive \|\| isUpcoming\) && \(/);
});

test("admin event computed lifecycle refreshes while the panel stays open", () => {
  assert.match(adminEventsPanel, /const \[lifecycleNowMs, setLifecycleNowMs\] = useState\(\(\) => Date\.now\(\)\)/);
  assert.match(adminEventsPanel, /window\.setInterval\(\(\) => setLifecycleNowMs\(Date\.now\(\)\), 30_000\)/);
  assert.match(adminEventsPanel, /const lifecycleMinuteBucket = Math\.floor\(lifecycleNowMs \/ 60_000\)/);
  assert.match(adminEventsPanel, /const lifecycleQueryBucket = TIME_SENSITIVE_STATUS_FILTERS\.has\(statusFilter\) \? lifecycleMinuteBucket : "static"/);
  assert.match(adminEventsPanel, /lifecycleQueryBucket, pageIndex/);
  assert.match(adminEventsPanel, /getLifecycleSnapshot\(event, lifecycleNowMs\)/);
});

test("admin event date filters and recurrence summaries use UTC dates", () => {
  const recurrenceHelpers = section(adminEventsPanel, "const UTC_DAYS_SHORT", "type CategoryUpdateInput");
  const query = section(adminEventsPanel, "queryKey: ['admin-events'", "// Filtered events are now server-side paginated");

  assert.match(recurrenceHelpers, /getUTCDate\(\)/);
  assert.match(recurrenceHelpers, /getUTCDay\(\)/);
  assert.doesNotMatch(recurrenceHelpers, /\.getDate\(\)/);
  assert.doesNotMatch(recurrenceHelpers, /\.getDay\(\)/);

  assert.match(query, /date_from: dateFrom \|\| null/);
  assert.match(query, /date_to: dateTo \|\| null/);
  assert.match(adminGapClosureDefinitiveMigration, /v_date_from::timestamp AT TIME ZONE 'UTC'/);
  assert.match(adminGapClosureDefinitiveMigration, /\(v_date_to \+ 1\)::timestamp AT TIME ZONE 'UTC'/);
  assert.match(adminEventsPanel, /aria-label="Filter events from UTC date"/);
  assert.match(adminEventsPanel, /aria-label="Filter events to UTC date"/);
  assert.match(adminEventsPanel, /w-\[7\.5rem\] sm:w-36/);
});

test("admin events definitive gap closure migration owns server-side pagination filters", () => {
  assert.match(adminGapClosureDefinitiveMigration, /CREATE OR REPLACE FUNCTION public\.admin_list_events/);
  assert.match(adminGapClosureDefinitiveMigration, /v_limit integer := LEAST\(GREATEST\(COALESCE\(p_limit, 50\), 1\), 200\)/);
  assert.match(adminGapClosureDefinitiveMigration, /v_status := NULLIF/);
  assert.match(adminGapClosureDefinitiveMigration, /admin_status_display/);
  assert.match(adminGapClosureDefinitiveMigration, /needs_finalization_repair/);
  assert.match(adminGapClosureDefinitiveMigration, /wrap_up_grace/);
  assert.match(adminGapClosureDefinitiveMigration, /v_scope IS NULL OR v_scope = 'all'/);
  assert.match(adminGapClosureDefinitiveMigration, /v_city IS NULL OR v_city = 'all'/);
  assert.match(adminGapClosureDefinitiveMigration, /lower\(btrim\(COALESCE\(e\.city, ''\)\)\) = lower\(v_city\)/);
  assert.match(adminGapClosureDefinitiveMigration, /total_count/);
  assert.match(adminEventsPanel, /EVENTS_PAGE_SIZE = 50/);
  assert.match(adminEventsPanel, /Page \{pageIndex \+ 1\} of \{totalPages\}/);
});

test("expired computed events cannot be cancelled from the row menu", () => {
  const rowRender = section(adminEventsPanel, "const renderEventRow", "return (");

  assert.match(rowRender, /const isArchived = lifecycle\.isArchived/);
  assert.match(rowRender, /!isArchived/);
  assert.match(rowRender, /computed !== 'ended'/);
  assert.match(rowRender, /!event\.ended_at/);
  assert.match(rowRender, /!\['cancelled', 'draft', 'completed'\]\.includes\(rawStatus\)/);
});

test("admin Events UI moves finalization into grace and repair states", () => {
  assert.match(adminEventsPanel, /wrap_up_grace/);
  assert.match(adminEventsPanel, /needs_finalization_repair/);
  assert.match(adminEventsPanel, /Auto-finalizes/);
  assert.match(adminEventsPanel, /Missing ended_at/);
  assert.match(adminEventsPanel, /kind: "finalize-repair"/);
  assert.match(adminEventsPanel, /Finalize now/);
  assert.match(adminEventsPanel, /Finalization repair from \/kaan dashboard/);
  assert.match(adminEventsPanel, /lifecycle\.needsFinalizationRepair && !event\.ended_at && !isArchived/);
  assert.match(adminEventsPanel, /kind: "unarchive"/);
  assert.doesNotMatch(adminEventsPanel, /\{event\.archived_at && \(/);
  assert.doesNotMatch(adminEventsPanel, /Finalize End/);
});

test("admin event unarchive remains reachable for status-only archived rows", () => {
  assert.match(adminEventsPanel, /kind: "unarchive"/);
  assert.doesNotMatch(adminEventsPanel, /\{event\.archived_at && \(/);
  assert.match(unarchiveStatusOnlyRepairMigration, /CREATE OR REPLACE FUNCTION public\.admin_unarchive_event/);
  assert.match(unarchiveStatusOnlyRepairMigration, /lower\(COALESCE\(status, ''\)\) = 'archived' THEN NULL/);
});

test("event lifecycle auto-finalization backend contract is cron-safe and closes user access at scheduled end", () => {
  assert.match(eventLifecycleAutoFinalizationMigration, /CREATE OR REPLACE FUNCTION public\.finalize_due_events/);
  assert.match(eventLifecycleAutoFinalizationMigration, /FOR UPDATE SKIP LOCKED/);
  assert.match(eventLifecycleAutoFinalizationMigration, /e\.ended_at IS NULL/);
  assert.match(eventLifecycleAutoFinalizationMigration, /e\.archived_at IS NULL/);
  assert.match(eventLifecycleAutoFinalizationMigration, /NOT IN \('draft', 'cancelled', 'archived'\)/);
  assert.match(eventLifecycleAutoFinalizationMigration, /ended_at = candidates\.scheduled_end/);
  assert.match(eventLifecycleAutoFinalizationMigration, /'event\.auto_finalize'/);
  assert.match(eventLifecycleAutoFinalizationMigration, /'actor_type', 'system'/);
  assert.match(eventLifecycleAutoFinalizationMigration, /cron\.schedule\(\s*'event-lifecycle-auto-finalize'/);
  assert.match(eventLifecycleAutoFinalizationMigration, /'\* \* \* \* \*'/);

  assert.match(eventLifecycleAutoFinalizationMigration, /CREATE OR REPLACE FUNCTION public\.admin_extend_event/);
  assert.match(eventLifecycleAutoFinalizationMigration, /v_before\.ended_at IS NOT NULL/);
  assert.match(eventLifecycleAutoFinalizationMigration, /v_now >= v_scheduled_end \+ interval '10 minutes'/);
  assert.match(eventLifecycleAutoFinalizationMigration, /v_extended_end <= v_now/);
  assert.match(eventLifecycleAutoFinalizationMigration, /CREATE OR REPLACE FUNCTION public\.admin_send_event_reminder/);
  assert.match(eventLifecycleAutoFinalizationMigration, /now\(\) >= v_scheduled_end/);
  assert.match(eventLifecycleAutoFinalizationMigration, /CREATE OR REPLACE FUNCTION public\.register_for_event/);
  assert.match(eventLifecycleAutoFinalizationMigration, /now\(\) >= v_event_date \+ COALESCE\(v_duration_minutes, 60\) \* interval '1 minute'/);
  assert.match(eventLifecycleAutoFinalizationMigration, /CREATE OR REPLACE FUNCTION public\.settle_event_ticket_checkout/);
  assert.match(eventLifecycleAutoFinalizationMigration, /code', 'EVENT_CLOSED'/);
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

test("attendees modal delegates roster reads, attendance writes, and removals to admin RPCs", () => {
  assert.match(adminEventAttendees, /callAdminRpc<AdminEventAttendeesPayload>\("admin_list_event_attendees"/);
  assert.match(adminEventAttendees, /p_event_id: event\.id/);
  assert.match(adminEventAttendees, /p_search: searchQuery\.trim\(\) \|\| null/);
  assert.match(adminEventAttendees, /callAdminRpc\("admin_remove_event_registration"/);
  assert.match(adminEventAttendees, /callAdminRpc<\{ affected_count\?: number \}>\("admin_mark_event_attendance"/);
  assert.match(adminEventAttendees, /p_registration_ids: \[registrationId\]/);
  assert.match(adminEventAttendees, /p_registration_ids: selectedAttendees/);
  assert.doesNotMatch(adminEventAttendees, /\.from\(['"]event_registrations['"]\)/);
  assert.doesNotMatch(adminEventAttendees, /profiles:profile_id/);
  assert.doesNotMatch(adminEventAttendees, /supabase\.rpc\("admin_remove_event_registration"/);
  assert.doesNotMatch(adminEventAttendees, /\.from\(['"]event_registrations['"]\)[\s\S]{0,300}\.update\(/);

  assert.match(profileDirectPrivacyMigration, /CREATE OR REPLACE FUNCTION public\.admin_list_event_attendees/);
  assert.match(profileDirectPrivacyMigration, /IF NOT public\.has_role\(v_admin_id, 'admin'::public\.app_role\)/);
  assert.match(profileDirectPrivacyMigration, /LEFT JOIN public\.profiles p ON p\.id = er\.profile_id/);
  assert.match(profileDirectPrivacyMigration, /GRANT EXECUTE ON FUNCTION public\.admin_list_event_attendees\(uuid, text\) TO authenticated, service_role;/);
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
  assert.match(adminEventScopeFollowupMigration, /jsonb_set\(v_effective, '\{is_location_specific\}', 'false'::jsonb, true\)/);

  assert.match(adminEventNonLocalScopeFollowupMigration, /CREATE OR REPLACE FUNCTION public\.admin_update_event/);
  assert.match(adminEventNonLocalScopeFollowupMigration, /v_effective := to_jsonb\(v_before\) \|\| p_payload/);
  assert.match(adminEventNonLocalScopeFollowupMigration, /jsonb_set\(v_effective, '\{is_location_specific\}', 'false'::jsonb, true\)/);
  assert.match(adminEventNonLocalScopeFollowupMigration, /admin_validate_event_payload\(v_effective, false\)/);
  assert.doesNotMatch(adminEventNonLocalScopeFollowupMigration, /AND NOT \(p_payload \? 'is_location_specific'\)/);
  assert.match(adminEventNonLocalScopeFollowupMigration, /WHEN p_payload \? 'scope' AND COALESCE\(NULLIF\(lower\(p_payload ->> 'scope'\), ''\), 'global'\) <> 'local' THEN false/);
  assert.ok(
    adminEventNonLocalScopeFollowupMigration.indexOf("WHEN p_payload ? 'scope' AND COALESCE(NULLIF(lower(p_payload ->> 'scope'), ''), 'global') <> 'local' THEN false") <
      adminEventNonLocalScopeFollowupMigration.indexOf("WHEN p_payload ? 'is_location_specific'"),
    "non-local scope must override stale full-object is_location_specific=true payloads",
  );
  assert.match(adminEventNonLocalScopeFollowupMigration, /REVOKE ALL ON FUNCTION public\.admin_update_event\(uuid, jsonb, text\) FROM PUBLIC, anon, authenticated/);
  assert.match(adminEventNonLocalScopeFollowupMigration, /GRANT EXECUTE ON FUNCTION public\.admin_update_event\(uuid, jsonb, text\) TO authenticated/);
});

test("admin event form footer submits through validation path", () => {
  const footer = section(adminEventForm, "{/* Footer */}", "</motion.div>");

  assert.match(adminEventForm, /<form id=\{formId\} onSubmit=\{handleSubmit\}/);
  assert.match(footer, /<Button type="submit" form=\{formId\}/);
  assert.doesNotMatch(footer, /saveEvent\.mutate\(\)/);
});
