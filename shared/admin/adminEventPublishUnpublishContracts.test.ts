import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20260601120000_admin_event_publish_unpublish_lifecycle.sql");
const adminEventsPanel = read("src/components/admin/AdminEventsPanel.tsx");
const adminEventForm = read("src/components/admin/AdminEventFormModal.tsx");
const adminActivityLog = read("src/components/admin/AdminActivityLog.tsx");
const webEventDetails = read("src/pages/EventDetails.tsx");
const nativeEventDetails = read("apps/mobile/app/(tabs)/events/[id].tsx");
const discoverVisibility = read("shared/discoverEventVisibility.ts");
const visibleEventsMigration = read("supabase/migrations/20260521161000_video_date_phase0_observability_flags.sql");

function fnSection(source: string, fnName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${fnName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing function ${fnName}`);
  const next = source.indexOf("\nCREATE OR REPLACE FUNCTION public.", start + marker.length);
  const revoke = source.indexOf("\nREVOKE ALL ON FUNCTION", start + marker.length);
  const comment = source.indexOf("\nCOMMENT ON FUNCTION", start + marker.length);
  const candidates = [next, revoke, comment].filter((index) => index !== -1);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

test("admin publish and unpublish RPCs are explicit lifecycle actions", () => {
  for (const fn of [
    "admin_publish_event",
    "admin_unpublish_event",
    "admin_publish_event_series",
    "admin_unpublish_event_series",
  ]) {
    const source = fnSection(migration, fn);

    assert.match(source, /SECURITY DEFINER/);
    assert.match(source, /SET search_path = public, pg_catalog/);
    assert.match(source, /auth\.uid\(\)/);
    assert.match(source, /has_role\(v_admin_id, 'admin'::public\.app_role\)/);
    assert.match(source, new RegExp(`admin_idempotency_begin\\(v_admin_id, '${fn}'`));
    assert.match(source, new RegExp(`admin_idempotency_complete\\(v_admin_id, '${fn}'`));
    assert.match(source, /FOR UPDATE/);
    assert.match(source, /log_admin_action\([\s\S]{0,80}'event\.(publish|unpublish)(_series)?'/);
  }

  assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_publish_event\(uuid, text, text\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_publish_event\(uuid, text, text\) TO authenticated/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_unpublish_event\(uuid, text, text\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_unpublish_event\(uuid, text, text\) TO authenticated/);
});

test("unpublish blocks hidden-with-registrations cases", () => {
  const unpublish = fnSection(migration, "admin_unpublish_event");
  const unpublishSeries = fnSection(migration, "admin_unpublish_event_series");

  assert.match(unpublish, /admission_status IN \('confirmed', 'waitlisted'\)/);
  assert.match(unpublish, /active_registration_count/);
  assert.match(unpublish, /Events with confirmed or waitlisted registrations cannot be unpublished/);
  assert.match(unpublish, /SET status = 'draft'/);

  assert.match(unpublishSeries, /event_id = ANY\(v_candidate_ids\)/);
  assert.match(unpublishSeries, /admission_status IN \('confirmed', 'waitlisted'\)/);
  assert.match(unpublishSeries, /Series with confirmed or waitlisted registrations cannot be unpublished/);
  assert.match(unpublishSeries, /SET status = 'draft'/);
});

test("generic event updates cannot mutate lifecycle fields", () => {
  const update = fnSection(migration, "admin_update_event");

  assert.match(update, /ARRAY\['archived_at', 'archived_by', 'ended_at', 'status'\]/);
  assert.match(update, /Event lifecycle fields must be changed through lifecycle admin actions/);
  assert.match(update, /INVALID_TRANSITION/);
  assert.doesNotMatch(update, /SET[\s\S]{0,120}status = CASE WHEN p_payload \? 'status'/);
});

test("recurrence generation preserves draft status and blocks invalid parents", () => {
  const generator = fnSection(migration, "generate_recurring_events");
  const wrapper = fnSection(migration, "admin_generate_recurring_events");

  assert.match(generator, /v_child_status := CASE WHEN lower\(COALESCE\(v_parent\.status, ''\)\) = 'draft' THEN 'draft' ELSE 'upcoming' END/);
  assert.match(generator, /v_parent\.tags, v_child_status/);
  assert.doesNotMatch(generator, /v_parent\.tags, 'upcoming'/);

  assert.match(wrapper, /v_parent_status IN \('archived', 'cancelled'\)/);
  assert.match(wrapper, /Archived or cancelled recurring parents cannot generate occurrences/);
});

test("admin Events UI exposes publish and unpublish actions without a generic status editor", () => {
  assert.match(adminEventsPanel, /callAdminRpc\(unpublish \? "admin_unpublish_event" : "admin_publish_event"/);
  assert.match(adminEventsPanel, /callAdminRpc\(unpublish \? "admin_unpublish_event_series" : "admin_publish_event_series"/);
  assert.match(adminEventsPanel, /rawStatus === 'draft'/);
  assert.match(adminEventsPanel, /rawStatus === 'upcoming'/);
  assert.match(adminEventsPanel, /computed === 'upcoming'/);
  assert.match(adminEventsPanel, /kind: "publish-series"/);
  assert.match(adminEventsPanel, /kind: "unpublish-series"/);
  assert.match(adminEventsPanel, /The backend blocks this if the event has confirmed or waitlisted registrations/);
  assert.match(adminEventsPanel, /visible-events/);
  assert.match(adminEventsPanel, /events-discover/);
  assert.match(adminEventsPanel, /other-city-events/);

  assert.doesNotMatch(adminEventForm, /<SelectItem value="draft"/);
  assert.doesNotMatch(adminEventForm, /<SelectItem value="upcoming"/);
  assert.doesNotMatch(adminEventForm, /status:\s*event\?\.status/);
});

test("create modal supports save as draft without announcement notifications", () => {
  assert.match(adminEventForm, /type EventCreateStatus = "draft" \| "upcoming"/);
  assert.match(adminEventForm, /eventData\.status = createStatus/);
  assert.match(adminEventForm, /Save as Draft/);
  assert.match(adminEventForm, /const createdAsDraft = result\.status === "draft"/);
  assert.match(adminEventForm, /if \(!createdAsDraft\) \{/);
  assert.match(adminEventForm, /event-notifications/);
  assert.match(adminEventForm, /The event is not discoverable until it is published/);
});

test("activity log and discovery surfaces recognize the lifecycle model", () => {
  assert.match(adminActivityLog, /"event\.publish": \{ label: "Event Published"/);
  assert.match(adminActivityLog, /"event\.unpublish": \{ label: "Event Unpublished"/);
  assert.match(adminActivityLog, /"event\.publish_series": \{ label: "Event Series Published"/);
  assert.match(adminActivityLog, /"event\.unpublish_series": \{ label: "Event Series Unpublished"/);

  assert.match(visibleEventsMigration, /e\.status != 'draft'/);
  assert.match(visibleEventsMigration, /e\.status IS DISTINCT FROM 'cancelled'/);
  assert.match(discoverVisibility, /st === "draft"/);
  assert.match(discoverVisibility, /return false/);
});

test("web and native direct event details block draft or archived registration attempts", () => {
  assert.match(webEventDetails, /const eventStatus = \(event\.status \?\? ""\)\.toLowerCase\(\)/);
  assert.match(webEventDetails, /eventStatus === "draft"/);
  assert.match(webEventDetails, /eventStatus === "archived"/);
  assert.match(webEventDetails, /Boolean\(event\.archivedAt\)/);
  assert.match(webEventDetails, /showEventPhoneNudge && !hasEventAdmission && !isUnavailableStatus/);
  assert.match(webEventDetails, /const purchaseCtaDisabled = soldOut \|\| eventEnded \|\| freeRegisterBusy \|\| isUnavailableStatus/);
  assert.match(webEventDetails, /onAccessPress=\{!isConfirmed && !isUnavailableStatus/);
  assert.match(webEventDetails, /!hasEventAdmission && !isUnavailableStatus/);
  assert.match(webEventDetails, /\.not\('status', 'in', '\(draft,cancelled,archived\)'\)/);

  assert.match(nativeEventDetails, /function getUnavailableEventState/);
  assert.match(nativeEventDetails, /status === 'draft'/);
  assert.match(nativeEventDetails, /status === 'archived'/);
  assert.match(nativeEventDetails, /Boolean\(event\?\.archived_at\)/);
  assert.match(nativeEventDetails, /if \(unavailable\.isUnavailable\)/);
  assert.match(nativeEventDetails, /showInviteSheet && !isUnavailableStatus/);
  assert.match(nativeEventDetails, /!isUnavailableStatus \? \(\s+<Pressable[\s\S]*Invite friends to this event/);
  assert.match(nativeEventDetails, /onAccessPress=\{!hasAdmission && !isUnavailableStatus/);
  assert.match(nativeEventDetails, /accessDisabled=\{isPurchasing \|\| isRegistering \|\| soldOut \|\| eventEnded \|\| isUnavailableStatus\}/);
  assert.match(nativeEventDetails, /!hasAdmission && !isUnavailableStatus/);
  assert.match(nativeEventDetails, /\.not\('status', 'in', '\(draft,cancelled,archived\)'\)/);
});
